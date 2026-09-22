import { createReadStream } from 'node:fs'

import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from 'cloudinary'
import type { Adapter, GeneratedAdapter } from '@payloadcms/plugin-cloud-storage/types'

import { env } from '@/lib/env'

import { cloudinaryEnabled, cloudinaryFileUrl, publicIdFor, resourceTypeFor } from './mediaUrl'

/**
 * CLOUDINARY STORAGE ADAPTER.
 *
 * 🔴 WHY THIS FILE EXISTS AT ALL: **Payload publishes no Cloudinary adapter.**
 * The official list is Vercel Blob, S3, Azure, GCS, Uploadthing and R2 — and
 * Cloudinary exposes no S3-compatible endpoint, so `@payloadcms/storage-s3`
 * cannot be pointed at it. The documented route for anything else is
 * `@payloadcms/plugin-cloud-storage` plus an adapter implementing
 * `handleUpload`, `handleDelete`, `generateURL` and `staticHandler`.
 *
 * The alternative was an unvetted third-party `payload-cloudinary` package. It
 * was rejected: this is ~100 lines we own and review, sitting directly in the
 * media-security path, versus a supply-chain dependency with an unknown
 * maintenance story handling every asset the business publishes.
 *
 * 🔴 WHAT THIS ADAPTER DOES **NOT** TOUCH — and that is the point.
 * Every media-security control runs in Payload hooks BEFORE the storage layer is
 * reached: magic-byte sniffing, the hard SVG rejection, the declared-vs-actual
 * MIME check, the size ceiling, the decompression-bomb guard, EXIF stripping via
 * a sharp re-encode, and the UUID rename (`src/hooks/uploadGuard.ts`). Storage is
 * the LAST step, so swapping S3 for Cloudinary changes where bytes land and
 * nothing about what is allowed to become bytes. No control was weakened to make
 * this work.
 */

// ---------------------------------------------------------------------------
// Configuration is module-level and runs once. `cloudinary.config()` mutates an
// SDK singleton, so calling it per-request would be a race; calling it at import
// time is what the SDK expects.
//
// ⚠️ NO NETWORK CALL AT BOOT, DELIBERATELY. The plugin awaits `onInit` and a
// failure there fails Payload startup — so an `api.ping()` would turn a
// Cloudinary outage into "the CMS will not start", locking admins out of a
// system whose public site is static and completely unaffected. Credential
// PRESENCE is enforced by the env schema's production `superRefine`; credential
// VALIDITY is proven by the go-live upload step in RUNBOOK.md §1, which exists
// precisely because that class of failure is invisible until the first upload.
// ---------------------------------------------------------------------------
if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  })
}

const uploadBuffer = (buffer: Buffer, options: UploadApiOptions): Promise<UploadApiResponse> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('Cloudinary returned no result for the upload.'))
      resolve(result)
    })
    stream.end(buffer)
  })

/**
 * The SAME upload, sourced from a temp file on disk instead of a buffer.
 *
 * 🔴 WHY THIS EXISTS — THE `documents` (PDF) UPLOAD FAILURE.
 * With `useTempFiles: true` the bytes arrive at `file.tempFilePath` and
 * `file.data` is an EMPTY Buffer. `media` never hits that case, because the
 * upload guard re-encodes every image and hands the sanitised bytes back as
 * `file.data` (`adoptSanitisedBytes`). A PDF is deliberately NOT re-encoded —
 * the guard's document branch renames it and returns — so for `documents`
 * `file.data` stays empty all the way through:
 *
 *   · `generateFileData.js:292` sets
 *     `skipTempFileBuffer = disableLocalStorage && tempFilePath && !fileBuffer?.data`,
 *     which is TRUE once Cloudinary is enabled, so Payload deliberately does not
 *     buffer the file and never reassigns `req.file`.
 *   · `plugin-cloud-storage/utilities/getIncomingFiles.js` then builds
 *     `{ buffer: file.data, tempFilePath: file.tempFilePath }` — i.e. an EMPTY
 *     buffer alongside the real bytes on disk.
 *   · uploading that empty buffer made Cloudinary answer `Empty file` (400),
 *     which the plugin's afterChange hook rethrows as a 500:
 *     "There was an error while uploading files corresponding to the collection
 *      documents with filename <uuid>.pdf".
 *
 * `tempFilePath` is a FIRST-CLASS, TYPED field on the plugin's file type
 * (`plugin-cloud-storage/types.d.ts`) precisely so an adapter can do this.
 *
 * Streaming rather than reading into memory is deliberate: PDFs are the 25 MB
 * ceiling and `useTempFiles` exists "so large files are not buffered in RAM"
 * (MASTER-IMPLEMENTATION-PLAN.md §5621). This keeps that control intact.
 */
const uploadFromPath = (
  tempFilePath: string,
  options: UploadApiOptions,
): Promise<UploadApiResponse> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('Cloudinary returned no result for the upload.'))
      resolve(result)
    })
    const source = createReadStream(tempFilePath)
    source.on('error', reject)
    source.pipe(stream)
  })

export const cloudinaryAdapter: Adapter = (): GeneratedAdapter => ({
  name: 'cloudinary',

  /**
   * `storageFilePath` is pre-resolved by the plugin as `<prefix>/<filename>` —
   * e.g. `media/3f2b….jpg`. It is used verbatim, so the object key, the public_id
   * and the delivery URL are all derived from ONE value.
   */
  handleUpload: async ({ file, storageFilePath }) => {
    const options: UploadApiOptions = {
      public_id: publicIdFor(storageFilePath),
      resource_type: resourceTypeFor(storageFilePath),

      // Public marketing imagery, served straight from the CDN. This is the
      // Cloudinary equivalent of the `acl: 'public-read'` the S3 config used, and
      // it carries the same caveat: correct for public assets, WRONG the moment
      // brochures become lead-gated (OQ-18).
      type: 'upload',
      access_mode: 'public',

      // 🔴 THE INVARIANT THAT MAKES VERSION-LESS URLS SAFE. Our keys are UUIDs,
      // so a collision is not a real scenario — but asserting it here means a
      // stale-CDN-copy bug cannot be introduced by a later change.
      overwrite: false,

      // The public_id is supplied explicitly, so neither of these may interfere.
      use_filename: false,
      unique_filename: false,
      // Belt and braces with the UUID rename: the uploader's original filename
      // must never reach Cloudinary's metadata, let alone a URL.
      discard_original_filename: true,
    }

    // ---------------------------------------------------------------------
    // TWO SOURCES, ONE UPLOAD. The buffer branch is the EXISTING, PRODUCTION-
    // PROVEN `media` path and is checked FIRST, so nothing about image upload
    // changes: the guard always hands images back with a populated `file.data`
    // and `tempFilePath` cleared, so `media` can never reach the second branch.
    // The temp-file branch is reached only by `documents`, where the bytes are
    // deliberately left on disk. See `uploadFromPath` above.
    // ---------------------------------------------------------------------
    if (Buffer.isBuffer(file.buffer) && file.buffer.byteLength > 0) {
      await uploadBuffer(file.buffer, options)
    } else if (typeof file.tempFilePath === 'string' && file.tempFilePath !== '') {
      await uploadFromPath(file.tempFilePath, options)
    } else {
      // Never silently upload nothing — that is precisely the failure this
      // branch exists to end, and Cloudinary's own "Empty file" said nothing
      // about which collection or which representation was missing.
      throw new Error(
        `Cloudinary upload for "${storageFilePath}" has no bytes: file.buffer is empty and no tempFilePath was provided.`,
      )
    }

    // Returning nothing is deliberate. An adapter MAY return metadata, which the
    // plugin then writes back with a second `payload.update` — but every field it
    // returned would have to exist on the collection, i.e. a schema change and a
    // migration, to store what is already derivable from `prefix` + `filename`.
  },

  handleDelete: async ({ storageFilePath }) => {
    await cloudinary.uploader.destroy(publicIdFor(storageFilePath), {
      resource_type: resourceTypeFor(storageFilePath),
      type: 'upload',
      // Purge cached CDN copies too. Without this the bytes survive at the edge
      // for the full cache lifetime after the record is gone.
      invalidate: true,
    })
  },

  /**
   * Only ever mounted when `disablePayloadAccessControl` is OFF — which is the
   * OQ-18 fork for lead-gated brochures. Implemented rather than stubbed so that
   * flipping that one flag is a complete change rather than the start of an
   * outage.
   */
  staticHandler: async (_req, { params }) => {
    const url = cloudinaryFileUrl(params.prefix ?? '', params.filename)
    if (!url) return new Response('Not found', { status: 404 })

    const upstream = await fetch(url)
    if (!upstream.ok || !upstream.body) return new Response('Not found', { status: 404 })

    const headers = new Headers({
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      // Safe only because the key is a UUID and is never overwritten.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    const length = upstream.headers.get('content-length')
    if (length) headers.set('Content-Length', length)

    return new Response(upstream.body, { status: 200, headers })
  },

  generateURL: ({ filename, prefix }) => cloudinaryFileUrl(prefix ?? '', filename) ?? '',
})
