import { env } from '@/lib/env'

/**
 * THE SINGLE DEFINITION OF A PUBLIC MEDIA URL.
 *
 * This module deliberately imports NOTHING but the environment. The Cloudinary
 * adapter (`./cloudinary.ts`) and the public serialiser (`toImageRef`) both call
 * `cloudinaryFileUrl`, so the URL Payload stores in `media.url` and the URL the
 * public API emits as `ImageRef.src` cannot drift apart — while the SDK itself
 * stays out of the request path of every public route.
 */

/** Cloudinary is enabled by the presence of a cloud name, and by nothing else. */
export const cloudinaryEnabled = Boolean(env.CLOUDINARY_CLOUD_NAME)

/**
 * The delivery origin.
 *
 * Defaults to the shared `res.cloudinary.com` host. `CLOUDINARY_DELIVERY_BASE_URL`
 * overrides it for the two documented alternatives — a private CDN distribution
 * (`https://<cloud_name>-res.cloudinary.com/...`) or a custom delivery hostname
 * (`https://<your custom delivery hostname>/...`), both of which are "available
 * only for Cloudinary's Advanced plan and higher, and require a small setup on
 * Cloudinary's side".
 *
 * 🔴 Whatever this resolves to MUST also appear in svfrontend's
 * `NEXT_PUBLIC_MEDIA_BASE_URL`, or every `next/image` call site throws
 * "Invalid src prop … hostname is not configured".
 */
const deliveryBase = (
  env.CLOUDINARY_DELIVERY_BASE_URL ?? `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME ?? ''}`
).replace(/\/+$/, '')

/**
 * IMAGES vs RAW — a correctness rule, not a preference.
 *
 * Cloudinary's upload reference is explicit: *"The public ID value for images and
 * videos shouldn't include a file extension. Include the file extension for `raw`
 * files only."* Get this backwards and the public_id and the delivery URL stop
 * agreeing, which shows up as a 404 on every asset.
 *
 * PDFs go to `raw` rather than `image` for a second, independent reason:
 * Cloudinary rasterises PDFs when they are stored as images, and PDF delivery
 * under the `image` type is subject to an account-level restriction that is
 * disabled by default. `raw` stores and returns the exact bytes.
 *
 * Derived from the FILE EXTENSION rather than the MIME type or the collection
 * slug, because the extension is the one value that both `handleUpload` (via
 * `storageFilePath`) and `generateURL` (via `filename`) are guaranteed to hold.
 * The upload guard has already proven the extension matches the sniffed bytes.
 */
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif'])

/**
 * 🔴 VIDEO IS A THIRD RESOURCE TYPE, NOT A VARIANT OF `raw` — MEASURED, NOT
 * ASSUMED.
 *
 * `.mp4` used to fall through this function to `raw`, because `raw` was the
 * catch-all. That is not a harmless default, and it was verified against the
 * real Cloudinary account before this line was written:
 *
 *     .../video/upload/videos/<uuid>.mp4   -> 200
 *     .../raw/upload/videos/<uuid>.mp4     -> 404
 *     .../image/upload/videos/<uuid>.mp4   -> 404
 *
 * So without this branch every video URL the serialiser emits would 404. Worse
 * and quieter: `handleDelete` derives its `resource_type` from this SAME
 * function, so a delete issued as `raw` against a `video` asset answers
 * "not found" and the object leaks in Cloudinary with NO error anywhere.
 * Upload and delete must agree, and they agree because they share this function.
 *
 * ⚠️ THE TWO EXISTING MAPPINGS ARE UNCHANGED, AND THAT IS THE POINT. The
 * `IMAGE_EXTENSIONS` set is untouched and `raw` remains the fallback, so jpg /
 * jpeg / png / webp / avif still resolve to `image` and pdf still resolves to
 * `raw`. `mp4` was not accepted by ANY collection before this change, so no
 * existing stored asset can change resource type. A dedicated no-regression
 * test pins all seven extensions.
 */
const VIDEO_EXTENSIONS = new Set(['mp4'])

export const resourceTypeFor = (filename: string): 'image' | 'video' | 'raw' => {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return 'raw'
}

/**
 * `media/3f2b….jpg` -> `media/3f2b…` for images AND video, unchanged for raw.
 *
 * Cloudinary's upload reference is explicit and covers both in one sentence:
 * *"The public ID value for images and videos shouldn't include a file
 * extension. Include the file extension for `raw` files only."* Video therefore
 * follows the IMAGE rule here, not the raw one.
 */
export const publicIdFor = (storageFilePath: string): string => {
  if (resourceTypeFor(storageFilePath) === 'raw') return storageFilePath
  return storageFilePath.replace(/\.[^./]+$/, '')
}

/**
 * 🔴 NO VERSION COMPONENT — verified, not assumed.
 *
 * Cloudinary's delivery URL is
 * `https://res.cloudinary.com/<cloud_name>/<asset_type>/<delivery_type>/<transformations>/<version>/<public_id>.<ext>`
 * and the version is optional: it is required only "when you overwrite an
 * existing asset", to defeat a stale CDN copy. This system never overwrites —
 * every storage key is a fresh UUID and a REPLACE writes a NEW key rather than
 * reusing the old one — and the adapter passes `overwrite: false`, which turns
 * that invariant into something Cloudinary enforces rather than something we
 * merely intend.
 *
 * Returns `undefined` when Cloudinary is not configured. That is the local
 * development path: the storage plugin is inert, Payload serves uploads from
 * local disk, and callers fall back to that URL.
 */
export const cloudinaryFileUrl = (prefix: string, filename: string): string | undefined => {
  if (!cloudinaryEnabled || !filename) return undefined
  const folder = prefix.replace(/^\/+|\/+$/g, '')
  return `${deliveryBase}/${resourceTypeFor(filename)}/upload/${folder ? `${folder}/` : ''}${filename}`
}
