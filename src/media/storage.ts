import { s3Storage } from '@payloadcms/storage-s3'

import { env } from '@/lib/env'

/**
 * S3-COMPATIBLE STORAGE — one config, two behaviours.
 *
 * 🔴 THE PLUGIN IS ALWAYS REGISTERED, never conditionally included in
 * `plugins`. A config whose SHAPE varies by environment generates DIVERGENT
 * MIGRATIONS between machines — `migrate:create` would produce a different diff
 * on a colleague's laptop, and one of the two would be wrong. `enabled` is the
 * documented conditional switch, and with `S3_BUCKET` unset the plugin is inert
 * and Payload falls back to local disk.
 *
 * 🔴 `disablePayloadAccessControl: true` — WHY IT MATTERS.
 * The most important paragraph in the storage-adapter docs, verbatim:
 * "by default, this plugin KEEPS ALL FILE URLS EXACTLY THE SAME. Your file URLs
 * won't be updated to point directly to your cloud storage source … Instead, all
 * uploads will still be reached from the default /collectionSlug/staticURL/
 * filename path. This plugin will 'pass through' all files."
 *
 * Left at that default, EVERY IMAGE URL ROUTES THROUGH THE NEXT.JS SERVER, which
 * then proxies S3: latency, egress cost, and it defeats the separate-origin
 * requirement — files would be served from the APP origin, which is precisely
 * the XSS adjacency the media design exists to avoid.
 *
 * The trade is explicit: turning it on removes file-level access control
 * entirely. Correct for public marketing imagery; WRONG the moment brochures
 * become lead-gated — which is exactly why `documents` is a separate collection
 * and why OQ-18 must close before that changes.
 *
 * 🔴 HEADERS COME FROM THE BUCKET/CDN, NOT FROM PAYLOAD. `s3Storage()` exposes
 * NO option to set Cache-Control, and `upload.modifyResponseHeaders` only covers
 * the Payload-served path — which this flag removes us from. The bucket policy
 * must set: `Cache-Control: public, max-age=31536000, immutable` (safe ONLY
 * because the key is a UUID), `X-Content-Type-Options: nosniff`, and
 * `Content-Disposition: attachment` for PDFs. That split is recorded in
 * SECURITY.md and in the runbook, or it will be forgotten.
 */

/** Deterministic public URL. Composed from CDN_BASE_URL + prefix + filename
 *  rather than trusting the `url` field, whose composition is not documented
 *  beyond the `/collectionSlug/staticURL/filename` pattern. */
const buildFileUrl = (prefix: string, filename: string): string => {
  const base = (env.CDN_BASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/${prefix}/${filename}`
}

export const storagePlugin = s3Storage({
  enabled: Boolean(env.S3_BUCKET),

  collections: {
    media: {
      prefix: 'media',
      disablePayloadAccessControl: true,
      // ⚠️ The exact `generateFileURL` signature is NOT published in the docs —
      // only the type name and a one-line description. The destructured names
      // were verified against the generated .d.ts before being relied on.
      generateFileURL: ({ filename }: { filename: string }) => buildFileUrl('media', filename),
    },
    documents: {
      prefix: 'documents',
      // 🔶 OQ-18 FORK. Public brochures -> `true` (CDN-served, no access
      // control). Lead-gated brochures -> leave this OFF so Payload's `read`
      // access still applies, optionally with `signedDownloads`.
      // THESE ARE MUTUALLY EXCLUSIVE SETTINGS ON THE SAME COLLECTION.
      // Interim: public, which PRESERVES THE OBSERVED BEHAVIOUR of the live
      // Lightbox download button. That is not a decision about the business
      // question; it is a decision not to change behaviour while it is open.
      disablePayloadAccessControl: true,
      generateFileURL: ({ filename }: { filename: string }) => buildFileUrl('documents', filename),
    },
  },

  bucket: env.S3_BUCKET ?? '',
  // The only value shown in the official example, and correct for public
  // marketing imagery served from a CDN.
  acl: 'public-read',

  config: {
    region: env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
    // ⚠️ `endpoint` and `forcePathStyle` are AWS-SDK PASS-THROUGHS that
    // Payload's own docs NEVER name. They are valid by virtue of `config` being
    // "an S3ClientConfig object passed to the AWS SDK client", and they are
    // required by MinIO and by most non-AWS providers.
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    ...(env.S3_FORCE_PATH_STYLE ? { forcePathStyle: true } : {}),
  },
})

// `disableLocalStorage` is deliberately NOT hard-coded on either collection:
// "When enabled, this package will automatically set disableLocalStorage to true
// for each collection", so the same config works both ways.
