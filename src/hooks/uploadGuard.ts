import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'

import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeOperationHook,
} from 'payload'
import sharp from 'sharp'

import {
  ALLOWED_DOCUMENT_MIME,
  ALLOWED_IMAGE_MIME,
  ALLOWED_VIDEO_MIME,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE_PX,
  MAX_VIDEO_BYTES,
} from '@/lib/constants'
import { looksLikeMarkup, looksLikePdf, looksLikeSvg, sniff } from '@/media/sniff'

/**
 * THE UPLOAD GUARD — one `beforeOperation` hook, on CREATE **and** UPDATE.
 *
 * 🔴 Applying it to `update` too is load-bearing: without it, REPLACING a file
 * reverts to user-supplied filenames and skips every check.
 *
 * ORDERING INSIDE THE HOOK IS ITSELF A CONTROL. In particular the UUID rename
 * happens AFTER sniffing, so the extension reflects the file's real type rather
 * than what the uploader claimed.
 *
 * Everything here is ours. Payload contributes NOTHING to this list:
 * the SVG block, magic-byte sniffing, declared-vs-actual MIME mismatch, EXIF
 * stripping, re-encoding, the dimension bomb guard and UUID storage keys.
 * And defining `mimeTypes` actively DISABLES Payload's own restricted-type check.
 *
 * The documented lever this rests on: "You can customize the filename before
 * it's uploaded to the server by using a beforeOperation hook… The filename from
 * here will also be threaded to image sizes if they're enabled."
 */

/**
 * ⚠️ `video` JOINS `document` ON THE NON-RE-ENCODED PATH, NOT `image`.
 *
 * The split that matters here is not "what kind of media is it" but "does sharp
 * touch it". Images are re-encoded (EXIF strip, dimension read, bomb guard);
 * documents and video are NOT — they are sniffed, checked, renamed and handed
 * on with their bytes untouched. Video takes the document path for the same
 * reason a PDF does: there is no safe in-process re-encoder for it, and
 * pretending otherwise would mean shipping ffmpeg.
 *
 * The consequence is load-bearing further down the stack: because neither is
 * re-encoded, `adoptSanitisedBytes` is never called for them, `tempFilePath`
 * survives, and the Cloudinary adapter's STREAMING branch is what uploads the
 * file. That is exactly the path the PDF fix already built and proved.
 */
type GuardKind = 'image' | 'document' | 'video'

/**
 * ⚠️ MEASURED, NOT ASSUMED: mutating `req.data` inside `beforeOperation` does
 * NOT reach the saved document. The gate run proved it — `originalFilename`
 * came back `null` on every seeded asset while the hook was plainly running
 * (the UUID rename, which mutates `req.file`, worked).
 *
 * `req.file` IS the live object the upload pipeline consumes, so mutations to it
 * take effect. `req.data` is not that object for an upload create.
 *
 * So the values we own are stashed on `req.context` here and written onto the
 * document by a `beforeChange` hook, which is the stage that genuinely owns
 * `data`. Two hooks, one responsibility each.
 */
export type UploadGuardContext = {
  originalFilename?: string
  width?: number
  height?: number
}

/**
 * 🔴 THE TWO SHAPES AN UPLOADED FILE ARRIVES IN — AND WHY THIS EXISTS.
 *
 * MEASURED, NOT ASSUMED. `upload.useTempFiles: true` is a DELIBERATE preventive
 * control (MASTER-IMPLEMENTATION-PLAN.md §5621: "so large files are not buffered
 * in RAM"). Its consequence is documented in Payload's own source —
 * `uploads/generateFileData.js:39`: *"A file uploaded with `useTempFiles`
 * enabled arrives as a temp file path instead of"* an in-memory buffer. In that
 * mode `file.data` IS AN EMPTY BUFFER and the bytes live at `file.tempFilePath`.
 *
 * Payload handles both shapes itself, and this is its exact test —
 * `uploads/checkFileRestrictions.js:249`:
 *   `const isTempFile = !!tempFilePath && (!file.data || file.data.length === 0)`
 *
 * Reading only `file.data` therefore made EVERY HTTP upload fail with "That
 * file is empty." — the admin panel, the REST API, bulk upload, all of it — and
 * because the throw happens on the FIRST line of the guard it also meant the
 * SVG rejection, the declared-vs-actual MIME check, the size ceiling and the
 * decompression-bomb guard were UNREACHABLE and had never once executed on a
 * real upload. Nothing caught it: there is no test that posts a real multipart
 * body, and the seed uses the Local API, which supplies `data` directly.
 */
const readUploadBytes = async (file: {
  data?: unknown
  tempFilePath?: unknown
}): Promise<Buffer> => {
  if (Buffer.isBuffer(file.data) && file.data.byteLength > 0) return file.data
  if (typeof file.tempFilePath === 'string' && file.tempFilePath !== '') {
    return readFile(file.tempFilePath)
  }
  return Buffer.alloc(0)
}

/**
 * Hands the SANITISED bytes to Payload as an in-memory buffer, and RETIRES the
 * temp file so nothing downstream can read the original bytes back.
 *
 * 🔴 WHY THE TEMP FILE MUST BE DISOWNED AND NOT JUST OVERWRITTEN.
 * Downstream, Payload PREFERS the temp path wherever it is set —
 * `generateFileData.js:147` builds its sharp pipeline from
 * `sharp(file.tempFilePath, …)`. Setting `file.data` alone would therefore leave
 * the ORIGINAL, EXIF-BEARING bytes on disk for Payload to pick up, silently
 * discarding the metadata strip and the re-encode. Clearing `tempFilePath`
 * makes every one of those `if (file.tempFilePath)` branches fall through to
 * `file.data`, which is the shape this guard was written against.
 *
 * ⚠️ WRITING BACK TO THE TEMP PATH WAS TRIED FIRST AND REJECTED ON EVIDENCE.
 * `fs.writeFile(tempFilePath, out)` is Payload's own post-crop pattern
 * (`generateFileData.js:279`), but on Windows it left the descriptor contended:
 * WebP uploads failed 3/3 with `UNKNOWN: unknown error, open` at
 * `generateFileData.js:319` followed by `EBUSY … unlink`, surfacing as
 * "There was a problem while uploading the file.", while PNG/JPEG/AVIF passed
 * 3/3. Buffer hand-off has no such race on any platform.
 *
 * 🔴 THE MEMORY CONTROL IS NOT WEAKENED. `useTempFiles: true` exists "so large
 * files are not buffered in RAM" (MASTER-IMPLEMENTATION-PLAN.md §5621). This
 * path runs ONLY for images, which are capped at MAX_IMAGE_BYTES (10 MB) and
 * whose re-encoded bytes are ALREADY in memory as `out` — there is nothing left
 * to save. The 25 MB `documents`/PDF path returns earlier and never calls this,
 * so it keeps streaming from disk untouched, which is precisely the case the
 * control was written for.
 */
const adoptSanitisedBytes = async (
  file: { data?: unknown; size?: unknown; tempFilePath?: unknown },
  out: Buffer,
): Promise<void> => {
  const temp = typeof file.tempFilePath === 'string' ? file.tempFilePath : ''
  file.data = out
  file.size = out.byteLength
  file.tempFilePath = undefined
  if (temp) {
    // Best-effort: Payload will no longer clean this up now that the path is
    // cleared, and a stale temp file is a disk leak, not a correctness problem.
    await rm(temp, { force: true }).catch(() => undefined)
  }
}

const makeGuard = (kind: GuardKind): CollectionBeforeOperationHook => {
  return async ({ req, operation, context }) => {
    if (operation !== 'create' && operation !== 'update') return
    const file = req.file
    if (!file) return

    const buf = await readUploadBytes(file)
    if (!Buffer.isBuffer(buf) || buf.byteLength === 0) {
      throw new APIError('That file is empty.', 400)
    }

    // ---------------------------------------------------------------------
    // 1. MAGIC-BYTE SNIFF — a .jpg extension proves nothing.
    // ---------------------------------------------------------------------
    const sniffed = await sniff(buf)

    // ---------------------------------------------------------------------
    // 2. HARD SVG REJECTION — belt and braces, BEFORE the allow-list check, so
    //    an SVG that the sniffer fails to identify is still stopped. SVG is the
    //    one type where a false negative is a stored-XSS vector.
    // ---------------------------------------------------------------------
    if (sniffed?.mime === 'image/svg+xml' || looksLikeSvg(buf)) {
      throw new APIError(
        'SVG files cannot be uploaded. An SVG can carry scripts, so it is a security risk on a public website. Export the artwork as PNG, JPEG or WebP instead.',
        415,
      )
    }

    if (looksLikeMarkup(buf)) {
      throw new APIError('That file contains web markup, not an image.', 415)
    }

    if (!sniffed) {
      throw new APIError('Unrecognised file type.', 415)
    }

    // ---------------------------------------------------------------------
    // 3. ALLOW-LIST + DECLARED-vs-ACTUAL MISMATCH -> 415
    // ---------------------------------------------------------------------
    const allowed: Record<string, string> =
      kind === 'image'
        ? { ...ALLOWED_IMAGE_MIME }
        : kind === 'video'
          ? { ...ALLOWED_VIDEO_MIME }
          : { ...ALLOWED_DOCUMENT_MIME }

    if (!(sniffed.mime in allowed)) {
      const human =
        kind === 'image' ? 'JPEG, PNG, WebP or AVIF' : kind === 'video' ? 'an MP4 video' : 'PDF'
      throw new APIError(`That file type is not allowed. Upload ${human}.`, 415)
    }

    if (file.mimetype && file.mimetype.split(';')[0]!.trim() !== sniffed.mime) {
      throw new APIError(
        'The file contents do not match its declared type. Re-export the file and try again.',
        415,
      )
    }

    if (kind === 'document' && !looksLikePdf(buf)) {
      throw new APIError('That file is not a valid PDF.', 415)
    }

    const ext = allowed[sniffed.mime]!

    // ---------------------------------------------------------------------
    // 4. SIZE CEILING.
    //    ⚠️ `upload.limits.fileSize` is ONE application-wide value, so the
    //    10MB-image / 25MB-PDF split is NOT expressible in config. The root
    //    limit is set to the higher (PDF) ceiling with abortOnLimit:true, which
    //    is documented to return 413; the tighter image ceiling is enforced
    //    here — and a hook-thrown rejection surfaces as a 4xx, NOT the 413 the
    //    contract specifies for the config-level limit. That difference is
    //    recorded in API-CONTRACT.md rather than papered over.
    // ---------------------------------------------------------------------
    const maxBytes =
      kind === 'image' ? MAX_IMAGE_BYTES : kind === 'video' ? MAX_VIDEO_BYTES : MAX_DOCUMENT_BYTES
    if (buf.byteLength > maxBytes) {
      const mb = Math.floor(maxBytes / (1024 * 1024))
      throw new APIError(
        `That file is ${(buf.byteLength / (1024 * 1024)).toFixed(1)} MB. The limit is ${mb} MB.`,
        400,
      )
    }

    if (kind === 'document' || kind === 'video') {
      // PDFs and video: no sharp, no dimensions, no re-encode. Rename and finish.
      //
      // 🔴 `tempFilePath` IS DELIBERATELY LEFT INTACT. `adoptSanitisedBytes` is
      // the only thing that clears it, and it is reached only on the image path.
      // Leaving it set is what routes these uploads through the adapter's
      // STREAMING branch instead of buffering the whole file in memory — the
      // control `useTempFiles: true` exists for.
      //
      // The UUID rename still happens, so the stored key is never the
      // uploader's filename, and `originalFilename` is still captured for
      // display. Both are what make `immutable` CDN caching safe.
      ;(context as UploadGuardContext).originalFilename = file.name
      req.file!.mimetype = sniffed.mime
      req.file!.name = `${randomUUID()}.${ext}`
      return
    }

    // ---------------------------------------------------------------------
    // 5. DIMENSIONS — the decompression-bomb guard AND the width/height WE OWN.
    //    B07 escalated width/height as undocumented; CONF-33 verified they ARE
    //    documented auto-added fields. They are nevertheless produced by
    //    PAYLOAD'S pipeline, not by our contract — and ImageRef requires all
    //    four keys, the CLS budget (<0.05) depends on them, and lib/seo.ts's
    //    OpenGraph tags read them. The read is already happening for the bomb
    //    guard; writing two integers costs nothing and makes the contract
    //    surface OURS.
    // ---------------------------------------------------------------------
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
    try {
      meta = await sharp(buf).metadata()
    } catch {
      throw new APIError('That image could not be read. It may be corrupt.', 415)
    }

    if (!meta.width || !meta.height) {
      throw new APIError('Could not read the image dimensions.', 415)
    }

    if (meta.width > MAX_IMAGE_SIDE_PX || meta.height > MAX_IMAGE_SIDE_PX) {
      throw new APIError(
        `Images may be at most ${MAX_IMAGE_SIDE_PX} pixels on a side. This one is ${meta.width}x${meta.height}.`,
        400,
      )
    }

    // ---------------------------------------------------------------------
    // 6. RE-ENCODE WITH EXIF STRIPPED.
    //    Drops GPS coordinates, camera metadata and any payload embedded in a
    //    metadata block. `.rotate()` with no argument applies the EXIF
    //    orientation BEFORE that data is discarded, so the image does not end up
    //    sideways. `withMetadata()` is deliberately NOT called — that would put
    //    the metadata back.
    // ---------------------------------------------------------------------
    const pipeline = sharp(buf).rotate()
    const out =
      ext === 'jpg'
        ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
        : ext === 'png'
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
          : ext === 'webp'
            ? await pipeline.webp({ quality: 90 }).toBuffer()
            : await pipeline.avif({ quality: 80 }).toBuffer()

    // `.rotate()` may transpose width and height; re-read so the stored values
    // describe the bytes we are actually saving.
    const finalMeta = await sharp(out).metadata()

    // ---------------------------------------------------------------------
    // 7. CAPTURE the display name, THEN rename to a UUID.
    //    Never use the uploaded filename as the storage key. The repo already
    //    contains the cautionary case: "WhatsApp Image 2026-09-15 at 11.27.17
    //    AM.jpeg" — spaces, colons, mixed case. A flat {uuid}.{ext} prevents
    //    path traversal, collisions, cross-platform case bugs and URL-encoding
    //    problems, and is what makes `immutable` caching safe.
    // ---------------------------------------------------------------------
    const ctx = context as UploadGuardContext
    ctx.originalFilename = file.name
    ctx.width = finalMeta.width ?? meta.width
    ctx.height = finalMeta.height ?? meta.height

    // Writes `out` to `data` AND back to `tempFilePath`, so the EXIF strip and
    // the re-encode survive whichever representation Payload reads next.
    await adoptSanitisedBytes(req.file!, out)
    req.file!.mimetype = sniffed.mime
    req.file!.name = `${randomUUID()}.${ext}`
  }
}

export const imageUploadGuard = makeGuard('image')
export const documentUploadGuard = makeGuard('document')
export const videoUploadGuard = makeGuard('video')

/**
 * Writes the values the guard captured onto the document.
 *
 * This is the stage that genuinely owns `data`, which is why it exists as a
 * separate hook rather than being folded into `beforeOperation`. It runs on
 * create AND update, so a REPLACE re-captures the new file's dimensions rather
 * than leaving the old ones in place — a subtly wrong `width`/`height` is a CLS
 * regression that nothing would report.
 */
export const applyUploadGuardValues: CollectionBeforeChangeHook = ({ data, context }) => {
  const ctx = context as UploadGuardContext
  if (!ctx?.originalFilename && ctx?.width === undefined) return data

  return {
    ...data,
    ...(ctx.originalFilename ? { originalFilename: ctx.originalFilename } : {}),
    ...(ctx.width !== undefined ? { width: ctx.width } : {}),
    ...(ctx.height !== undefined ? { height: ctx.height } : {}),
  }
}
