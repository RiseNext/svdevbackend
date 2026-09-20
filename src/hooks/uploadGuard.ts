import { randomUUID } from 'node:crypto'

import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeOperationHook,
} from 'payload'
import sharp from 'sharp'

import {
  ALLOWED_DOCUMENT_MIME,
  ALLOWED_IMAGE_MIME,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE_PX,
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

type GuardKind = 'image' | 'document'

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

const makeGuard = (kind: GuardKind): CollectionBeforeOperationHook => {
  return async ({ req, operation, context }) => {
    if (operation !== 'create' && operation !== 'update') return
    const file = req.file
    if (!file) return

    const buf = file.data as Buffer
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
      kind === 'image' ? { ...ALLOWED_IMAGE_MIME } : { ...ALLOWED_DOCUMENT_MIME }

    if (!(sniffed.mime in allowed)) {
      const human = kind === 'image' ? 'JPEG, PNG, WebP or AVIF' : 'PDF'
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
    const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES
    if (buf.byteLength > maxBytes) {
      const mb = Math.floor(maxBytes / (1024 * 1024))
      throw new APIError(
        `That file is ${(buf.byteLength / (1024 * 1024)).toFixed(1)} MB. The limit is ${mb} MB.`,
        400,
      )
    }

    if (kind === 'document') {
      // PDFs: no sharp, no dimensions, no re-encode. Rename and finish.
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

    req.file!.data = out
    req.file!.size = out.byteLength
    req.file!.mimetype = sniffed.mime
    req.file!.name = `${randomUUID()}.${ext}`
  }
}

export const imageUploadGuard = makeGuard('image')
export const documentUploadGuard = makeGuard('document')

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
