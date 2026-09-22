import type { CollectionConfig } from 'payload'

import { anyone, isAdmin, isAdminField, serverOnlyField } from '@/access'
import { auditAfterChange, auditAfterDelete } from '@/hooks/audit'
import { captureReplacedFile, stampUploadedBy, videoDeleteGuard } from '@/hooks/mediaGuards'
import { applyUploadGuardValues, videoUploadGuard } from '@/hooks/uploadGuard'

/**
 * `videos` — MP4 ONLY. A THIRD upload collection, and it exists for exactly the
 * reason `documents` exists.
 *
 * WHY NOT A ROLE ON `media`: one upload collection cannot express two
 * `mimeTypes` allow-lists, and the validation genuinely differs. `media` runs
 * the whole sharp pipeline — `imageSizes`, `crop`, `focalPoint`, an EXIF-
 * stripping re-encode and a decompression-bomb guard. sharp cannot read an MP4,
 * so every one of those would have to grow a branch inside the code path that
 * every project cover image flows through. `documents` already established the
 * alternative: a new media class gets its own collection, and the shared parts
 * (guard factory, adapter, sweeper, audit) are reused rather than forked.
 *
 * 🔴 THIS COLLECTION IS PLACEMENT-NEUTRAL, AND THAT IS ARCHITECTURE, NOT STYLE.
 * There is no `placement`, no `section`, no `hero` and no ordering field here or
 * on `site-settings`. The backend owns ONE fact — which video is currently
 * active — and the frontend owns where, whether and how it is rendered. A second
 * consumer (an about-page band, a project section) needs NO backend change.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT ENFORCED: duration and pixel dimensions. sharp
 * cannot read an MP4 and this project ships no ffmpeg/ffprobe — adding one would
 * put a native binary in the upload path for a decorative asset. The byte
 * ceiling (MAX_VIDEO_BYTES) is the only technical control, which is why the
 * admin description below carries explicit authoring guidance instead.
 *
 * ⚠️ AND WHAT IS NOT STRIPPED: an MP4 can carry metadata, including GPS from a
 * phone or drone. Images get that removed by the re-encode; video cannot be
 * re-encoded here, so it does not. Recorded rather than glossed — the mitigation
 * is procedural (export from an editor, not straight off the capture device).
 */
export const Videos: CollectionConfig = {
  slug: 'videos',

  upload: {
    staticDir: 'videos',

    // MP4 only. WebM is deliberately deferred — see ALLOWED_VIDEO_MIME.
    // As with the other two collections, defining `mimeTypes` makes Payload SKIP
    // its restricted-file verification, which is acceptable only because this
    // list is strictly narrower than their deny-list.
    mimeTypes: ['video/mp4'],
    allowRestrictedFileTypes: false,

    // Same SSRF posture as `media` and `documents`: never let an authenticated
    // editor make the SERVER fetch an arbitrary remote URL.
    pasteURL: false,
    skipSafeFetch: false,

    // One active video at a time; there is no bulk workflow to support.
    bulkUpload: false,

    // 🔴 ALL THREE OFF. sharp cannot process an MP4 — leave any of these on and
    // Payload attempts an image pipeline on a video. This is the same
    // configuration `documents` uses, for the same reason.
    crop: false,
    focalPoint: false,
    filesRequiredOnCreate: true,
    cacheTags: false,

    // A static icon, because there is no frame to generate without a decoder.
    // The uploaded `poster` below is the human-readable preview.
    adminThumbnail: () => '/file-icon.svg',
  },

  admin: {
    group: 'Media',
    useAsTitle: 'title',
    defaultColumns: ['title', 'filename', 'filesize', 'updatedAt'],
    description:
      'Background and feature videos. MP4 only, up to 6 MB. Recommended: H.264/AAC, 1080p, 6–10 seconds, compressed to roughly 3–5 MB, and composed so it loops cleanly — these are used as silent looping backgrounds. Where a video appears on the website is decided by the website, not here.',
  },

  /**
   * 🔴 `read: anyone` — AND THIS IS NOT A RELAXATION, IT IS REQUIRED FOR THE
   * FEATURE TO FUNCTION AT ALL. The reasoning is recorded in full on `media`,
   * and it was MEASURED there rather than assumed:
   *
   *   With `read: isAdmin`, a public read (`overrideAccess: false`,
   *   `user: undefined` — which is what every public query uses, by
   *   construction) silently degrades a populated upload relation to a BARE ID
   *   STRING. Payload does not throw and does not return null.
   *
   * So `site-settings.video` would arrive as an id, the serialiser's
   * both-or-neither rule would omit the key, and the video would simply never
   * appear on the website — with no error anywhere. A dedicated access test
   * pins this exact case.
   *
   * Granting anonymous read costs nothing that was actually protected: the file
   * is served from a public CDN under a UUID key and the URL is public by
   * construction. What IS internal is locked at the FIELD level below.
   */
  access: {
    create: isAdmin,
    read: anyone,
    update: isAdmin,
    delete: isAdmin,
  },

  // Versioning binary metadata buys nothing and duplicates every row per edit.
  // Matches `media` and `documents`.
  versions: false,
  // Trash gives the same 30-day grace the media delete policy needs; the
  // existing sweeper is what eventually removes the Cloudinary object.
  trash: true,
  defaultSort: '-createdAt',

  /**
   * Pinned so a populated `site-settings.video` carries exactly what the
   * serialiser needs — no more, no less.
   *
   * ⚠️ `filename` is included DELIBERATELY, for the same documented reason as
   * the other two collections: when a query selects `url` on an upload
   * collection, "it is important to specify filename: true as well", otherwise
   * Payload returns `url: null`. The serialiser composes the URL from
   * `filename` anyway and never trusts `url`, which is what keeps it immune to
   * the missing-`prefix` bug that put a 404 in production on brochure hrefs.
   */
  defaultPopulate: {
    filename: true,
    url: true,
    title: true,
    poster: true,
  },

  hooks: {
    beforeOperation: [videoUploadGuard],
    beforeChange: [applyUploadGuardValues, stampUploadedBy],
    afterChange: [captureReplacedFile, auditAfterChange],
    // Blocks deleting the video that `site-settings.video` currently points at.
    beforeDelete: [videoDeleteGuard],
    afterDelete: [auditAfterDelete],
  },

  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      maxLength: 200,
      admin: {
        description:
          'An internal label so this video can be recognised in the list, e.g. "Aler layout — drone approach". Not shown on the website.',
      },
    },
    {
      /**
       * 🔴 REQUIRED, AND THE FRONTEND CONTRACT IS WHY.
       *
       * The existing Hero component's media prop is typed `{ src: string;
       * poster: string }` — poster NON-OPTIONAL — so the website already
       * demanded one before this collection existed. It is also what shows when
       * autoplay is refused (iOS Low Power Mode, Data Saver, reduced-motion),
       * and it is what LCP measures against.
       *
       * ⚠️ IT RELATES TO THE EXISTING `media` COLLECTION ON PURPOSE. A poster is
       * an ordinary image and must go through the existing image pipeline —
       * sniffing, SVG rejection, EXIF strip, dimensions. Adding a second image
       * storage path here would duplicate all of it and is exactly what the
       * "maximum reuse" constraint forbids. It also means the serialiser emits
       * the poster through the existing `toImageRef`, so the public shape is the
       * `ImageRef` the frontend already consumes everywhere else.
       */
      name: 'poster',
      type: 'upload',
      relationTo: 'media',
      required: true,
      admin: {
        description:
          'A still frame shown before the video plays, and whenever a device refuses to autoplay it. Use a frame from the video itself at the same aspect ratio.',
      },
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
      // Captured on replace so the existing sweeper can remove the superseded
      // Cloudinary object after the grace period. Identical mechanism to
      // `media` and `documents`; `captureReplacedFile` is collection-agnostic.
      name: 'supersededFilenames',
      type: 'text',
      hasMany: true,
      admin: { position: 'sidebar', readOnly: true, hidden: true },
      access: { ...serverOnlyField, read: isAdminField },
    },
  ],
}
