import type { CollectionConfig } from 'payload'

import { anyone, isAdmin, isAdminField, serverOnlyField } from '@/access'
import { LIMITS } from '@/lib/constants'
import { auditAfterChange, auditAfterDelete } from '@/hooks/audit'
import { captureReplacedFile, mediaDeleteGuard, stampUploadedBy } from '@/hooks/mediaGuards'
import { applyUploadGuardValues, imageUploadGuard } from '@/hooks/uploadGuard'

/**
 * `media` — IMAGES ONLY.
 *
 * Two upload collections exist because ONE CANNOT EXPRESS TWO `mimeTypes`
 * ALLOW-LISTS, and the validation genuinely differs: images get sharp,
 * `imageSizes`, crop and focal point; PDFs get none of those (sharp cannot
 * thumbnail a PDF) and a different size ceiling.
 *
 * 🔴 SEQUENCING NOTE: this collection is a PREREQUISITE for `projects`, not a
 * later phase. A media role is an `upload` field with `relationTo: 'media'`, and
 * the target collection must exist in the config for the relation to resolve.
 * The roadmap's "Projects in Phase 1, Media in Phase 5" is not a late ordering,
 * it is IMPOSSIBLE.
 */
export const Media: CollectionConfig = {
  slug: 'media',

  upload: {
    staticDir: 'media',

    // 🔴 NEVER the docs' own example `['image/*']` — that INCLUDES
    // image/svg+xml, and SVG is not on Payload's restricted-type list.
    // Note this allow-list also causes Payload to SKIP its restricted-file
    // verification entirely, which is acceptable only because our list is
    // strictly narrower than their deny-list. Re-review if it is ever widened.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    allowRestrictedFileTypes: false,

    // ⚠️ ENABLED BY DEFAULT. Left on, an authenticated editor can make the
    // SERVER fetch an arbitrary remote URL — a server-side request forgery
    // primitive handed out for free. FR-MEDIA-12.
    pasteURL: false,
    skipSafeFetch: false,

    bulkUpload: true,
    crop: true,
    focalPoint: true,

    // Never re-append metadata: the upload guard strips EXIF deliberately.
    withMetadata: false,
    // Some CDNs reject the ?cacheTag= query string Payload would otherwise add.
    cacheTags: false,
    filesRequiredOnCreate: true,

    // Deliberately ONE size. `next/image` already produces responsive AVIF/WebP
    // variants at the edge; generating card/tablet/hero sizes duplicates that
    // work and multiplies S3 objects and orphan-cleanup surface by 4x (OQ-16).
    // This one exists purely to feed `adminThumbnail`.
    imageSizes: [
      {
        name: 'thumbnail',
        width: 400,
        height: 300,
        position: 'centre',
        // ⚠️ MANDATORY. The default `undefined` means "uploading images with
        // smaller width AND height than the image size will return null" — and
        // the SV logo and every placeholder are exactly the assets that would
        // hit it, producing broken admin thumbnails with no error anywhere.
        withoutEnlargement: true,
      },
    ],
    adminThumbnail: 'thumbnail',

    // `safeFileNames` / `preserveExtension` deliberately NOT set: they are
    // sanitisers, not anonymisers, and still leak the original filename into the
    // public URL. The UUID rename in the upload guard supersedes them.
  },

  admin: {
    group: 'Media',
    useAsTitle: 'alt',
    defaultColumns: ['filename', 'alt', 'width', 'height', 'updatedAt'],
    description:
      'Photographs and artwork for the website. SVG files cannot be uploaded — export as PNG, JPEG or WebP.',
  },

  /**
   * 🔴 `read: anyone` — AND THIS IS A CORRECTION TO THE PLAN, MEASURED NOT ASSUMED.
   *
   * The plan specifies `read: isAdmin` here, on the reasoning that "the FILES are
   * public via the CDN; the DOCUMENTS are not". That is incompatible with the
   * three-layer public-read discipline, and the failure mode is SILENT:
   *
   *   Measured with `overrideAccess: false, user: undefined` (which every public
   *   read uses, by construction):
   *     media.access.read = isAdmin  ->  project.image comes back as a
   *     BARE ID STRING. Payload does NOT throw and does NOT return null —
   *     it silently degrades the populated relation to an id.
   *
   * Had the serialiser not thrown `UnpopulatedUploadError`, every project would
   * have shipped `{ src: '', alt: '', width: 0, height: 0 }` — every image broken
   * site-wide and the CLS budget (<0.05) blown, with NO ERROR ANYWHERE.
   *
   * The public contract genuinely requires these fields: `ImageRef` declares
   * `src`, `alt`, `width` and `height` all NON-OPTIONAL, and the dimensions are
   * what prevent layout shift. So the public must be able to read them.
   *
   * Granting anonymous read here costs nothing that was actually protected — the
   * file itself is served from a public CDN with a guessable-only-by-UUID key,
   * and the URL is public by construction. What IS genuinely internal is locked
   * at the FIELD level below: `uploadedBy`, `originalFilename` and
   * `supersededFilenames` are admin-read-only.
   *
   * The three independent layers are therefore all still intact:
   *   1. access returns a constraint (here: read-only for anonymous)
   *   2. publicFind pins `overrideAccess: false` + `user: undefined`
   *   3. the serialiser emits an allow-list of exactly four keys
   */
  access: {
    create: isAdmin,
    read: anyone,
    update: isAdmin,
    delete: isAdmin,
  },

  // Versioning binary metadata buys nothing and duplicates every row per edit.
  versions: false,
  // Trash gives the 30-day grace the delete policy needs (OQ-17).
  trash: true,
  defaultSort: '-createdAt',

  // Pinned so a public query that populates an upload field gets exactly the
  // keys `toImageRef()` needs — no more, no less.
  // ⚠️ `filename` is included DELIBERATELY: when a query selects `url` on an
  // upload collection, "it is important to specify filename: true as well",
  // otherwise Payload returns url: null.
  defaultPopulate: {
    filename: true,
    url: true,
    alt: true,
    isDecorative: true,
    width: true,
    height: true,
  },

  hooks: {
    beforeOperation: [imageUploadGuard],
    beforeChange: [applyUploadGuardValues, stampUploadedBy],
    afterChange: [captureReplacedFile, auditAfterChange],
    beforeDelete: [mediaDeleteGuard],
    afterDelete: [auditAfterDelete],
  },

  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      maxLength: LIMITS.alt,
      admin: {
        description:
          'Describe the image for someone who cannot see it. If it carries no information of its own, tick "decorative" below and leave this blank.',
      },
      validate: (value: unknown, { siblingData }: { siblingData?: unknown }): true | string => {
        const decorative = (siblingData as { isDecorative?: boolean } | undefined)?.isDecorative
        if (decorative) return true
        if (typeof value !== 'string' || value.trim() === '') {
          return 'Alt text is required, or tick "decorative" if the image carries no information.'
        }
        if (value.length > LIMITS.alt) return `Alt text may be at most ${LIMITS.alt} characters.`
        return true
      },
    },
    {
      name: 'isDecorative',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Tick for purely decorative images. Screen readers will skip it. The logo and background plates are decorative.',
      },
      // THE alt:'' PROBLEM. `pages.ts:20` deliberately sets alt:''; `Logo.tsx`
      // and `PinnedProof.tsx:119-126` pass alt="". `required: true` on `alt`
      // rejects '' — so this is the escape hatch, and the serialiser emits
      // `alt: isDecorative ? '' : alt`.
    },
    {
      name: 'width',
      type: 'number',
      admin: { position: 'sidebar', readOnly: true },
      // 🔴 `admin.readOnly` is "without affecting the API" — trivially spoofable
      // over REST. Field access is the actual control. Pair them, every time.
      access: serverOnlyField,
    },
    {
      name: 'height',
      type: 'number',
      admin: { position: 'sidebar', readOnly: true },
      access: serverOnlyField,
    },
    {
      name: 'originalFilename',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Display only — never used as the storage key.',
      },
      // Now that the collection grants anonymous READ, the genuinely internal
      // fields are locked at the FIELD level instead. `read` is what matters
      // here; `create`/`update` were already closed.
      access: { ...serverOnlyField, read: isAdminField },
    },
    {
      name: 'uploadedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar', readOnly: true },
      // Which administrator uploaded an asset is internal. It is also a
      // relationship to `users`, and nothing about an admin account may ever
      // reach a public response.
      access: { ...serverOnlyField, read: isAdminField },
    },
    {
      // Captured on replace so the sweeper can remove the superseded object.
      // ⚠️ What happens to the OLD stored object after a replace is NOT
      // DOCUMENTED. Capturing it ourselves makes the "an accidental replace is
      // recoverable for 30 days" promise true regardless of what Payload does.
      name: 'supersededFilenames',
      type: 'text',
      hasMany: true,
      admin: { position: 'sidebar', readOnly: true, hidden: true },
      access: { ...serverOnlyField, read: isAdminField },
    },

    // ---------------------------------------------------------------------
    // JOIN FIELDS — virtual, no storage. These are how the in-use delete guard
    // and orphan detection count inbound references. Payload documents NO
    // referential integrity and NO cascade behaviour for upload relations, so
    // reference counting is 100% application-level.
    //
    // ⚠️ The Join Field documents `collection` — a COLLECTION slug. The
    // `site-settings.logo` reference is on a GLOBAL and therefore CANNOT be a
    // join field; it is counted by an explicit query in the delete guard.
    // ---------------------------------------------------------------------
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Used in',
          description:
            'Every place this image currently appears on the website. It cannot be deleted while this list is non-empty.',
          fields: [
            { name: 'usedAsCover', type: 'join', collection: 'projects', on: 'image' },
            { name: 'usedInGallery', type: 'join', collection: 'projects', on: 'gallery' },
            { name: 'usedAsLayout', type: 'join', collection: 'projects', on: 'layoutImage' },
            {
              name: 'usedAsLocationMap',
              type: 'join',
              collection: 'projects',
              on: 'locationMap',
            },
          ],
        },
      ],
    },
  ],
}
