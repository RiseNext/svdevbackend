import type { CollectionConfig } from 'payload'

import { anyone, isAdmin, isAdminField, serverOnlyField } from '@/access'
import { auditAfterChange, auditAfterDelete } from '@/hooks/audit'
import { captureReplacedFile, stampUploadedBy } from '@/hooks/mediaGuards'
import { applyUploadGuardValues, documentUploadGuard } from '@/hooks/uploadGuard'

/**
 * `documents` — PDFs ONLY. A SECOND upload collection, not a second role on
 * `media`.
 *
 * WHY A SEPARATE COLLECTION: one upload collection cannot express two
 * `mimeTypes` allow-lists, and the validation genuinely differs — images are
 * <=10MB jpeg/png/webp/avif with crop, focal point and `imageSizes`; PDFs are
 * <=25MB `application/pdf` with `crop: false`, `focalPoint: false`, NO
 * `imageSizes` (sharp cannot thumbnail a PDF) and a static `adminThumbnail`.
 *
 * This also resolves the A2 contradiction C-7: the site-scoped `document` role
 * had NO table, NO column and NO endpoint anywhere in the documented schema.
 * `pages.ts:254`'s `masterPlan.downloadHref = '[MASTER_PLAN_PDF_URL]'` now has a
 * home.
 *
 * 🔶 OQ-18 (public vs lead-gated brochures) is a MUTUALLY EXCLUSIVE CONFIG FORK
 * on this collection — public means `disablePayloadAccessControl: true` and
 * CDN-served; gated means leaving access control on. Having `documents` as its
 * own collection is precisely what makes answering it a one-collection change.
 * The interim is PUBLIC, matching the current live Lightbox download button.
 * That preserves observed behaviour; it does NOT decide the business question.
 */
export const Documents: CollectionConfig = {
  slug: 'documents',

  upload: {
    staticDir: 'documents',
    mimeTypes: ['application/pdf'],
    allowRestrictedFileTypes: false,
    pasteURL: false,
    skipSafeFetch: false,
    bulkUpload: false,
    // sharp cannot process a PDF. All three of these must be off or Payload
    // attempts an image pipeline on a document.
    crop: false,
    focalPoint: false,
    filesRequiredOnCreate: true,
    cacheTags: false,
    // A static icon, because there is no thumbnail to generate.
    adminThumbnail: () => '/file-icon.svg',
  },

  admin: {
    group: 'Media',
    useAsTitle: 'title',
    defaultColumns: ['title', 'filename', 'filesize', 'updatedAt'],
    description: 'Downloadable PDFs — the master plan and brochures. PDF only, up to 25 MB.',
  },

  // Same reasoning as `media` (see the long note there): the master-plan PDF is
  // an unauthenticated download on the live site today, and the public
  // serialiser needs `title` and `url` to render the download link. Internal
  // fields are locked at the field level.
  //
  // 🔶 THIS IS THE OQ-18 FORK. If brochures ever become lead-gated, THIS LINE is
  // what changes — along with `disablePayloadAccessControl` in the storage
  // config. Having `documents` as a separate collection is precisely what makes
  // that a one-collection change.
  access: {
    create: isAdmin,
    read: anyone,
    update: isAdmin,
    delete: isAdmin,
  },

  versions: false,
  trash: true,
  defaultSort: '-createdAt',
  defaultPopulate: { filename: true, url: true, title: true },

  hooks: {
    beforeOperation: [documentUploadGuard],
    beforeChange: [applyUploadGuardValues, stampUploadedBy],
    afterChange: [captureReplacedFile, auditAfterChange],
    afterDelete: [auditAfterDelete],
  },

  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      maxLength: 200,
      admin: { description: 'Shown as the download link text, e.g. "Master plan (PDF)".' },
    },
    {
      name: 'originalFilename',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Display only — never used as the storage key.',
      },
      access: { ...serverOnlyField, read: isAdminField },
    },
    {
      name: 'uploadedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar', readOnly: true },
      access: { ...serverOnlyField, read: isAdminField },
    },
    {
      name: 'supersededFilenames',
      type: 'text',
      hasMany: true,
      admin: { position: 'sidebar', readOnly: true, hidden: true },
      access: { ...serverOnlyField, read: isAdminField },
    },
  ],
}
