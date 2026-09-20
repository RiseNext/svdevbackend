import { cloudStoragePlugin } from '@payloadcms/plugin-cloud-storage'

import { cloudinaryAdapter } from './cloudinary'
import { cloudinaryEnabled } from './mediaUrl'

/**
 * MEDIA STORAGE — one config, two behaviours.
 *
 * Production stores media in **Cloudinary** (owner decision, 20 Sep 2026;
 * supersedes the S3-compatible assumption that every document in `docs/` was
 * written against). Local development stores on disk, unchanged.
 *
 * 🔴 THE PLUGIN IS ALWAYS REGISTERED, never conditionally included in `plugins`.
 * A config whose SHAPE varies by environment generates DIVERGENT MIGRATIONS
 * between machines — `migrate:create` would produce a different diff on a
 * colleague's laptop, and one of the two would be wrong. `enabled` is the
 * documented conditional switch, and with `CLOUDINARY_CLOUD_NAME` unset the
 * plugin is inert and Payload falls back to local disk.
 *
 * 🔴 `alwaysInsertFields: true` — A REAL FIX, NOT A TIDY-UP.
 * The plugin injects three fields into every targeted upload collection: `url`,
 * `prefix` and `_objectKey`. Without this flag it injects them ONLY when the
 * plugin is enabled — so the previous configuration produced a schema with
 * `prefix`/`_objectkey` in production and WITHOUT them on any developer machine
 * that had storage switched off, while migration 001 (generated with storage on)
 * contains both columns. The `enabled` switch above was doing half the job it was
 * documented to do. The plugin's own note is that this "ensures a consistent
 * schema across all environments" and that it "will be enabled by default in
 * Payload v4"; turning it on now makes dev, test and production agree with the
 * migration that is already committed, so it adds no migration of its own.
 *
 * ⚠️ `adapter: null` when disabled mirrors what `@payloadcms/storage-s3` does
 * internally: the fields are still inserted, but the adapter is never
 * constructed, so a machine with no Cloudinary credentials cannot fail at import
 * time.
 *
 * 🔴 `disablePayloadAccessControl: true` — WHY IT MATTERS.
 * The most important paragraph in the storage-adapter docs, verbatim:
 * "by default, this plugin KEEPS ALL FILE URLS EXACTLY THE SAME. Your file URLs
 * won't be updated to point directly to your cloud storage source … Instead, all
 * uploads will still be reached from the default /collectionSlug/staticURL/
 * filename path. This plugin will 'pass through' all files."
 *
 * Left at that default, EVERY IMAGE URL ROUTES THROUGH THE NEXT.JS SERVER, which
 * then proxies Cloudinary: latency, double egress, and it defeats the
 * separate-origin requirement — files would be served from the APP origin, which
 * is precisely the XSS adjacency the media design exists to avoid.
 *
 * The trade is explicit: turning it on removes file-level access control
 * entirely. Correct for public marketing imagery; WRONG the moment brochures
 * become lead-gated — which is exactly why `documents` is a separate collection
 * and why OQ-18 must close before that changes.
 *
 * 🔴 RESPONSE HEADERS COME FROM CLOUDINARY, NOT FROM PAYLOAD, and this remains
 * true after the move. `upload.modifyResponseHeaders` covers only the
 * Payload-served path, which `disablePayloadAccessControl` removes us from.
 * Cloudinary serves delivery URLs with a long-lived immutable cache policy of its
 * own, which is safe here only because the key is a UUID that is never reused.
 *
 * ⚠️ ONE DEVIATION FROM MEDIA-MANAGEMENT.md §10, RECORDED RATHER THAN GLOSSED:
 * `Content-Disposition: attachment` for PDFs was an S3 bucket-policy line. PDFs
 * are stored as Cloudinary `raw` assets, whose delivery headers are Cloudinary's
 * and are not configurable per-object here. The control that mattered — serving
 * uploaded content from an origin that is not the app origin — is fully intact,
 * and `X-Content-Type-Options: nosniff` is applied on the proxied path in
 * `staticHandler`. The disposition header is not claimed as satisfied.
 */
export const storagePlugin = cloudStoragePlugin({
  enabled: cloudinaryEnabled,
  alwaysInsertFields: true,

  collections: {
    media: {
      prefix: 'media',
      adapter: cloudinaryEnabled ? cloudinaryAdapter : null,
      disablePayloadAccessControl: true,
    },
    documents: {
      prefix: 'documents',
      // 🔶 OQ-18 FORK. Public brochures -> `true` (CDN-served, no access
      // control). Lead-gated brochures -> remove this line so Payload's `read`
      // access still applies, and the adapter's `staticHandler` takes over.
      // THESE ARE MUTUALLY EXCLUSIVE SETTINGS ON THE SAME COLLECTION.
      // Interim: public, which PRESERVES THE OBSERVED BEHAVIOUR of the live
      // Lightbox download button. That is not a decision about the business
      // question; it is a decision not to change behaviour while it is open.
      adapter: cloudinaryEnabled ? cloudinaryAdapter : null,
      disablePayloadAccessControl: true,
    },
  },
})

// `disableLocalStorage` is deliberately NOT hard-coded on either collection: the
// plugin sets it to `true` for targeted collections when it is enabled, and
// leaves local disk alone when it is not, so the same config works both ways.
