import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'

/**
 * THE IN-USE DELETE GUARDS, AGAINST EVERY REFERENCE SITE.
 *
 * 🔴 WHY THIS FILE EXISTS. The pre-release audit found that `videoDeleteGuard`
 * and `mediaDeleteGuard` each knew about only SOME of the places an asset can be
 * referenced from. Three new reference sites had been added without extending
 * them:
 *
 *   · `site-settings.heroMedia[].video`   (new unified hero list)
 *   · `site-settings.heroMedia[].image` / `[].poster`
 *   · `projects.videos[].video` / `[].poster`  (new project video list)
 *
 * Every foreign key here is `ON DELETE set null`, so deleting a referenced
 * asset raised NO error: the row survived with a null relation, the public
 * serialiser dropped it as unresolvable, and the website silently lost a hero
 * slide or a project video — with a 200 response and nothing in any log. That
 * is the exact failure these guards were written to make impossible.
 *
 * ⚠️ EVERY CASE BELOW ASSERTS A REFUSAL, NOT A WARNING. A guard that merely
 * logged would leave the admin with no feedback, which is indistinguishable
 * from the bug it replaces.
 *
 * The pre-existing reference sites are re-asserted alongside the new ones, so a
 * future field cannot quietly narrow the guard again.
 */

let payload: Payload

const CTX = { skipAudit: true, skipRevalidate: true }

const REQUIRED_SITE_FIELDS = {
  name: 'SV Developers',
  legalName: 'SV Developers',
  url: 'https://example.com',
  email: 'test@example.com',
  phone: '7799774169',
  whatsapp: '7799774169',
  address: ['A line'],
}

const jpegBytes = async (w = 64, h = 48): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 9, g: 60, b: 33 } } })
    .jpeg()
    .toBuffer()
}

const mp4Bytes = (padding = 0): Buffer => {
  const mdatSize = 8 + padding
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from('ftyp'),
    Buffer.from('isom'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isom'),
    Buffer.from('iso2'),
    Buffer.from('avc1'),
    Buffer.from('mp41'),
    Buffer.from([
      (mdatSize >>> 24) & 0xff,
      (mdatSize >>> 16) & 0xff,
      (mdatSize >>> 8) & 0xff,
      mdatSize & 0xff,
    ]),
    Buffer.from('mdat'),
    Buffer.alloc(padding),
  ])
}

let pad = 0
const uploadImage = async (name: string, alt: string) =>
  (
    await payload.create({
      collection: 'media',
      overrideAccess: true,
      file: { data: await jpegBytes(64 + (pad++ % 7), 48), name, mimetype: 'image/jpeg', size: 1 },
      data: { alt },
      context: CTX,
    })
  ).id as string

let vpad = 0
const uploadVideo = async (name: string, title: string, posterId: string) =>
  (
    await payload.create({
      collection: 'videos',
      overrideAccess: true,
      file: { data: mp4Bytes(vpad++ % 5), name, mimetype: 'video/mp4', size: 1 },
      data: { title, poster: posterId },
      context: CTX,
    })
  ).id as string

/** Clears every reference so the teardown of one case cannot affect the next. */
const clearSiteSettings = async () =>
  payload.updateGlobal({
    slug: 'site-settings',
    overrideAccess: true,
    data: { ...REQUIRED_SITE_FIELDS, heroVideos: [], heroMedia: [], logo: null } as never,
    context: CTX,
  })

/** The HARD-delete path — `beforeDelete`. */
const del = (collection: 'media' | 'videos', id: string) =>
  payload.delete({ collection, id, overrideAccess: true, context: CTX })

/**
 * THE TRASH PATH — and the one the Admin Panel's Delete button actually takes.
 *
 * 🔴 `@payloadcms/ui/.../DeleteDocument/index.js:86-99` issues
 * `requests.patch(url, { body: JSON.stringify({ deletedAt: … }) })` unless the
 * editor explicitly chose "permanently delete". That is an UPDATE, so
 * `beforeDelete` never fires. Measured before the fix: `DELETE` returned 409
 * while this PATCH returned 200 and a homepage hero slide silently vanished.
 */
const trash = (collection: 'media' | 'videos', id: string) =>
  payload.update({
    collection,
    id,
    overrideAccess: true,
    context: CTX,
    data: { deletedAt: new Date('2026-10-12T00:00:00.000Z').toISOString() } as never,
  })

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)
  await clearSiteSettings()
})

// ---------------------------------------------------------------------------
describe('videoDeleteGuard — site-settings.heroVideos (pre-existing)', () => {
  it('REFUSES to delete a video in the legacy hero list', async () => {
    const poster = await uploadImage('p-legacy.jpg', 'Poster')
    const video = await uploadVideo('legacy.mp4', 'Legacy hero', poster)

    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: { ...REQUIRED_SITE_FIELDS, heroVideos: [video] } as never,
      context: CTX,
    })

    await expect(del('videos', video)).rejects.toThrow(/still in use|cannot be deleted/i)
    await clearSiteSettings()
  })
})

// ---------------------------------------------------------------------------
describe('videoDeleteGuard — site-settings.heroMedia[].video (THE BUG)', () => {
  it('REFUSES to delete a video used by a heroMedia row', async () => {
    const poster = await uploadImage('p-hm.jpg', 'Poster')
    const video = await uploadVideo('hero-media.mp4', 'Hero media video', poster)

    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: {
        ...REQUIRED_SITE_FIELDS,
        // Deliberately NOT in heroVideos — only in the new list. Before the fix
        // this deleted cleanly and the hero silently lost the slide.
        heroVideos: [],
        heroMedia: [{ kind: 'video', video, title: 'Drone pass' }],
      } as never,
      context: CTX,
    })

    await expect(del('videos', video)).rejects.toThrow(/still in use/i)
    await clearSiteSettings()
  })

  it('names the offending row in the error, so a long list is navigable', async () => {
    const poster = await uploadImage('p-hm2.jpg', 'Poster')
    const video = await uploadVideo('hero-media2.mp4', 'V', poster)

    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: {
        ...REQUIRED_SITE_FIELDS,
        heroMedia: [
          { kind: 'image', image: poster, title: 'Just a photo' },
          { kind: 'video', video, title: 'The second slide' },
        ],
      } as never,
      context: CTX,
    })

    await expect(del('videos', video)).rejects.toThrow(/The second slide/)
    await clearSiteSettings()
  })
})

// ---------------------------------------------------------------------------
describe('videoDeleteGuard — projects.videos[].video (THE BUG)', () => {
  it('REFUSES to delete a video used by a project video list', async () => {
    const cover = await uploadImage('cov-pv.jpg', 'Cover')
    const poster = await uploadImage('p-pv.jpg', 'Poster')
    const video = await uploadVideo('project.mp4', 'Project video', poster)

    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      context: CTX,
      data: {
        slug: 'guard-project',
        name: 'Guard Project',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Guard test.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
        videos: [{ kind: 'video', video, title: 'Walkthrough' }],
        _status: 'published',
      } as never,
    })

    await expect(del('videos', video)).rejects.toThrow(/still in use/i)
    // And it names the project, not just "a project".
    await expect(del('videos', video)).rejects.toThrow(/Guard Project/)
  })
})

// ---------------------------------------------------------------------------
describe('videoDeleteGuard — an UNREFERENCED video still deletes', () => {
  it('does NOT block a video nothing points at', async () => {
    /* 🔴 THE GUARD MUST NOT BECOME A BLANKET REFUSAL. If this ever fails, the
       guard has stopped discriminating and the media library becomes
       append-only — which is its own bug, not extra safety. */
    const poster = await uploadImage('p-free.jpg', 'Poster')
    const video = await uploadVideo('unused.mp4', 'Unused', poster)
    await expect(del('videos', video)).resolves.toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('mediaDeleteGuard — the new image reference sites', () => {
  it('REFUSES to delete an image used as a heroMedia IMAGE', async () => {
    const image = await uploadImage('hm-image.jpg', 'Hero photo')
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: {
        ...REQUIRED_SITE_FIELDS,
        heroMedia: [{ kind: 'image', image, title: 'Aerial approach' }],
      } as never,
      context: CTX,
    })

    await expect(del('media', image)).rejects.toThrow(/still in use/i)
    await expect(del('media', image)).rejects.toThrow(/Aerial approach/)
    await clearSiteSettings()
  })

  it('REFUSES to delete an image used as a heroMedia YOUTUBE POSTER', async () => {
    const poster = await uploadImage('hm-poster.jpg', 'YT poster')
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: {
        ...REQUIRED_SITE_FIELDS,
        heroMedia: [
          {
            kind: 'youtube',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
            poster,
            title: 'Walkthrough',
          },
        ],
      } as never,
      context: CTX,
    })

    await expect(del('media', poster)).rejects.toThrow(/still in use/i)
    await clearSiteSettings()
  })

  it('REFUSES to delete an image used as a PROJECT VIDEO poster', async () => {
    const cover = await uploadImage('cov-pvp.jpg', 'Cover')
    const poster = await uploadImage('pv-poster.jpg', 'Project YT poster')

    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      context: CTX,
      data: {
        slug: 'guard-project-poster',
        name: 'Guard Poster Project',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Guard test.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
        videos: [
          {
            kind: 'youtube',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
            poster,
            title: 'Site tour',
          },
        ],
        _status: 'published',
      } as never,
    })

    /* 🔴 THE WORST CASE OF THE THREE. The serialiser treats a poster as
       MANDATORY on a youtube row and drops the whole row without one, so
       deleting this image removed the video from the project page entirely. */
    await expect(del('media', poster)).rejects.toThrow(/still in use/i)
    await expect(del('media', poster)).rejects.toThrow(/Guard Poster Project/)
  })

  it('REFUSES to delete an image used as a BLOG POST cover', async () => {
    const cover = await uploadImage('blog-cover.jpg', 'Blog cover')
    await payload.create({
      collection: 'blog-posts',
      overrideAccess: true,
      context: CTX,
      data: {
        slug: 'guard-post',
        title: 'A guarded post',
        excerpt: 'Cover guard test.',
        publishedAt: '2026-05-05',
        body: ['A paragraph.'],
        cover,
        _status: 'published',
      } as never,
    })

    await expect(del('media', cover)).rejects.toThrow(/still in use/i)
    await expect(del('media', cover)).rejects.toThrow(/A guarded post/)
  })

  it('REFUSES to delete an image used as a PROJECT LOGO (pre-existing gap)', async () => {
    const cover = await uploadImage('cov-logo.jpg', 'Cover')
    const logo = await uploadImage('the-logo.png', 'Logo')

    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      context: CTX,
      data: {
        slug: 'guard-logo-project',
        name: 'Guard Logo Project',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Guard test.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
        logo,
        _status: 'published',
      } as never,
    })

    /* ⚠️ `projects.logo` predates the project-video work and was ALREADY
       uncovered — the guard has never checked it. Covered here because it is
       the identical defect class in the identical function; flagged as
       pre-existing rather than claimed as a regression. */
    await expect(del('media', logo)).rejects.toThrow(/still in use/i)
  })

  it('does NOT block an image nothing points at', async () => {
    const free = await uploadImage('free.jpg', 'Unused')
    await expect(del('media', free)).resolves.toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('🔴 THE TRASH PATH — what the Admin Panel Delete button actually does', () => {
  /**
   * These are the cases that were WIDE OPEN. The guards were `beforeDelete`
   * only, and the admin UI soft-deletes by PATCHing `deletedAt`, so every
   * refusal above was reachable only by an admin who ticked "permanently
   * delete" or called the REST API by hand.
   */
  it('REFUSES to TRASH an image used as a heroMedia image', async () => {
    const image = await uploadImage('trash-hm.jpg', 'Hero photo')
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: {
        ...REQUIRED_SITE_FIELDS,
        heroMedia: [{ kind: 'image', image, title: 'Trash target' }],
      } as never,
      context: CTX,
    })

    await expect(trash('media', image)).rejects.toThrow(/still in use|moved to trash/i)

    // And the asset is genuinely untouched — not half-trashed.
    const after = await payload.findByID({
      collection: 'media',
      id: image,
      overrideAccess: true,
    })
    expect((after as { deletedAt?: unknown }).deletedAt).toBeFalsy()
    await clearSiteSettings()
  })

  it('REFUSES to TRASH a video used by a heroMedia row', async () => {
    const poster = await uploadImage('trash-vp.jpg', 'Poster')
    const video = await uploadVideo('trash-hero.mp4', 'Trash hero video', poster)
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: {
        ...REQUIRED_SITE_FIELDS,
        heroMedia: [{ kind: 'video', video, title: 'Trash video row' }],
      } as never,
      context: CTX,
    })

    await expect(trash('videos', video)).rejects.toThrow(/still in use/i)
    await clearSiteSettings()
  })

  it('REFUSES to TRASH a video used by a project video list', async () => {
    const cover = await uploadImage('trash-cov.jpg', 'Cover')
    const poster = await uploadImage('trash-pp.jpg', 'Poster')
    const video = await uploadVideo('trash-proj.mp4', 'Trash project video', poster)

    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      context: CTX,
      data: {
        slug: 'trash-guard-project',
        name: 'Trash Guard Project',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Trash guard test.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
        videos: [{ kind: 'video', video, title: 'In use' }],
        _status: 'published',
      } as never,
    })

    await expect(trash('videos', video)).rejects.toThrow(/Trash Guard Project/)
  })

  it('REFUSES to TRASH a PUBLISHED project cover (the build-breaking case)', async () => {
    const cover = await uploadImage('trash-published-cover.jpg', 'Cover')
    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      context: CTX,
      data: {
        slug: 'trash-cover-project',
        name: 'Trash Cover Project',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Cover guard test.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
        _status: 'published',
      } as never,
    })

    /* 🔴 THE WORST CASE IN THE WHOLE FILE. `image` is REQUIRED on Project and
       the frontend dereferences `project.image.*` with no guards, while
       `generateStaticParams` prerenders every project — so losing a published
       cover does not degrade a page, it FAILS THE BUILD. And this was the path
       the Delete button took. */
    await expect(trash('media', cover)).rejects.toThrow(/PUBLISHED project/i)
  })

  it('still ALLOWS trashing an asset nothing references', async () => {
    /* The guard must not become a blanket refusal — trash is the intended way
       to retire an unused asset, and the 30-day sweeper depends on it. */
    const free = await uploadImage('trash-free.jpg', 'Unused')
    const res = await trash('media', free)
    expect((res as { deletedAt?: unknown }).deletedAt).toBeTruthy()
  })

  it('still ALLOWS RESTORING a trashed asset (deletedAt -> null)', async () => {
    const free = await uploadImage('trash-restore.jpg', 'Unused')
    await trash('media', free)

    /* ⚠️ THE REGRESSION THIS PINS. The guard keys off the null -> set
       TRANSITION, not off `deletedAt` being present in the payload. Keying off
       presence would make a trashed asset impossible to restore, because a
       restore also names the field. */
    const restored = await payload.update({
      collection: 'media',
      id: free,
      overrideAccess: true,
      context: CTX,
      data: { deletedAt: null } as never,
      trash: true,
    })
    expect((restored as { deletedAt?: unknown }).deletedAt).toBeFalsy()
  })

  it('still ALLOWS an ordinary edit of an IN-USE asset', async () => {
    /* An edit carries no `deletedAt` at all, so the guard must ignore it —
       otherwise fixing the alt text on a live project cover becomes impossible. */
    const cover = await uploadImage('trash-edit.jpg', 'Original alt')
    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      context: CTX,
      data: {
        slug: 'trash-edit-project',
        name: 'Trash Edit Project',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Edit test.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
        _status: 'published',
      } as never,
    })

    const edited = await payload.update({
      collection: 'media',
      id: cover,
      overrideAccess: true,
      context: CTX,
      data: { alt: 'Corrected alt text' } as never,
    })
    expect((edited as { alt?: string }).alt).toBe('Corrected alt text')
  })
})
