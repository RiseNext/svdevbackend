import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { publicFindGlobal } from '@/lib/publicFind'
import {
  PUBLIC_SITE_SETTINGS_SELECT,
  toPublicSiteSettings,
} from '@/serializers/toPublicContent'
import type { SiteSetting } from '@/payload-types'

/**
 * THE REUSABLE VIDEO ASSET, END TO END.
 *
 * 🔴 THE CASE THIS FILE EXISTS FOR IS THE POPULATION-DEPTH ONE. The public
 * site-settings read runs with `overrideAccess: false` and `user: undefined`,
 * and under those conditions Payload does NOT throw when a relation cannot be
 * read or is not populated deeply enough — it silently hands back a BARE ID
 * STRING. The serialiser's both-or-neither rule then omits `video` entirely and
 * the website shows no video, with no error in any log.
 *
 * That failure is invisible to typechecking, invisible to the build, and
 * invisible in the admin panel (where reads are authenticated and deep). The
 * only thing that can catch it is a test that reads exactly the way the route
 * reads. So these cases call `publicFindGlobal` with the route's own
 * `PUBLIC_SITE_SETTINGS_SELECT` and depth rather than a convenient deep read.
 *
 * ⚠️ CLOUDINARY IS DELIBERATELY UNCONFIGURED IN THE TEST ENVIRONMENT
 * (`.env.test` pins `CLOUDINARY_CLOUD_NAME=`), so `cloudinaryFileUrl` returns
 * undefined here and the serialiser exercises its LOCAL-DISK fallback. The
 * Cloudinary URL composition itself is pinned separately and exactly in
 * `tests/unit/cloudinaryUrl.test.ts`; the real delivery behaviour (200,
 * content-type, range requests, seeking) was verified against the live account.
 */

let payload: Payload

/** Structurally valid ISO-BMFF so the guard's sniffer identifies it as mp4. */
const mp4Bytes = (padding = 0): Buffer =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from('ftyp'),
    Buffer.from('isom'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isom'),
    Buffer.from('iso2'),
    Buffer.from('avc1'),
    Buffer.from('mp41'),
    Buffer.from([0, 0, 0, 8]),
    Buffer.from('mdat'),
    Buffer.alloc(padding),
  ])

const jpegBytes = async (): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 20, g: 80, b: 50 } },
  })
    .jpeg()
    .toBuffer()
}

const CTX = { skipAudit: true, skipRevalidate: true }

/** Reads EXACTLY as `src/app/(public)/api/v1/site-settings/route.ts` does. */
const readPublic = async () => {
  const doc = await publicFindGlobal('site-settings', PUBLIC_SITE_SETTINGS_SELECT, 2)
  return toPublicSiteSettings(doc as SiteSetting)
}

let posterId: string
let secondPosterId: string
let videoId: string

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)

  const poster = await payload.create({
    collection: 'media',
    overrideAccess: true,
    file: { data: await jpegBytes(), name: 'poster.jpg', mimetype: 'image/jpeg', size: 0 },
    data: { alt: 'A still from the layout flyover' },
    context: CTX,
  })
  posterId = poster.id as string

  const poster2 = await payload.create({
    collection: 'media',
    overrideAccess: true,
    file: { data: await jpegBytes(), name: 'poster-2.jpg', mimetype: 'image/jpeg', size: 0 },
    data: { alt: 'Second poster' },
    context: CTX,
  })
  secondPosterId = poster2.id as string

  // Site settings must exist and be valid before any public read.
  await payload.updateGlobal({
    slug: 'site-settings',
    overrideAccess: true,
    context: CTX,
    data: {
      name: 'SV Developers',
      legalName: 'SV Developers',
      url: 'https://example.test',
      email: 'hello@example.test',
      phone: '+91 90000 00000',
      whatsapp: '919000000000',
      address: ['Line one'],
    },
  })
})

describe('the videos collection is configured like documents, not like media', () => {
  it('accepts video/mp4 only and runs no sharp pipeline', () => {
    const videos = payload.config.collections.find((c) => c.slug === 'videos')!
    expect(videos.upload).toBeTruthy()
    const upload = videos.upload as Record<string, unknown>

    expect(upload.mimeTypes).toEqual(['video/mp4'])
    // All three must be off or Payload attempts an image pipeline on a video.
    expect(upload.crop).toBe(false)
    expect(upload.focalPoint).toBe(false)
    expect(upload.imageSizes).toBeUndefined()
    // SSRF posture matches the other two collections.
    expect(upload.pasteURL).toBe(false)
    expect(upload.bulkUpload).toBe(false)
  })

  it('grants anonymous READ — without it the relation silently degrades to an id', async () => {
    const videos = payload.config.collections.find((c) => c.slug === 'videos')!
    expect(videos.access?.read).toBeDefined()
    // Proven behaviourally below; this pins the intent at the config layer.
    expect(videos.access!.read!({ req: { user: undefined } } as never)).toBe(true)
  })

  it('does NOT expose uploadedBy or originalFilename anonymously', async () => {
    // The counterpart to granting anonymous READ: the collection is public, the
    // internal columns are not. Mirrors the same assertion on `media`.
    const anon = await payload.find({
      collection: 'videos',
      overrideAccess: false,
      user: undefined,
      limit: 1,
      depth: 0,
    })
    const doc = anon.docs[0] as unknown as Record<string, unknown> | undefined
    if (doc) {
      expect(doc.uploadedBy).toBeFalsy()
      expect(doc.originalFilename).toBeFalsy()
      expect(doc.supersededFilenames).toBeFalsy()
    }
  })

  it('has no placement field of any kind — the backend must not own layout', () => {
    const videos = payload.config.collections.find((c) => c.slug === 'videos')!
    const names = videos.fields
      .map((f) => (f as { name?: string }).name)
      .filter(Boolean) as string[]
    for (const banned of ['placement', 'section', 'hero', 'position', 'layout', 'page', 'slot']) {
      expect(names, `videos must not carry a "${banned}" field`).not.toContain(banned)
    }
  })
})

describe('uploading a video', () => {
  it('stores it under a UUID filename and keeps the original name as metadata', async () => {
    const bytes = mp4Bytes()
    const created = await payload.create({
      collection: 'videos',
      overrideAccess: true,
      file: { data: bytes, name: 'Drone Approach FINAL v3.mp4', mimetype: 'video/mp4', size: bytes.byteLength },
      data: { title: 'Aler layout — drone approach', poster: posterId },
      context: CTX,
    })
    videoId = created.id as string

    expect(created.filename).toMatch(/^[0-9a-f-]{36}\.mp4$/)
    expect(created.filename).not.toContain('Drone')
    expect(created.mimeType).toBe('video/mp4')
    expect((created as { originalFilename?: string }).originalFilename).toBe(
      'Drone Approach FINAL v3.mp4',
    )
  })

  it('refuses a video over the 6 MB ceiling', async () => {
    const tooBig = mp4Bytes(6 * 1024 * 1024 + 1)
    await expect(
      payload.create({
        collection: 'videos',
        overrideAccess: true,
        file: { data: tooBig, name: 'huge.mp4', mimetype: 'video/mp4', size: tooBig.byteLength },
        data: { title: 'Too big', poster: posterId },
        context: CTX,
      }),
    ).rejects.toThrow(/limit is 6 MB/i)
  })

  it('refuses a JPEG renamed to .mp4', async () => {
    const jpeg = await jpegBytes()
    await expect(
      payload.create({
        collection: 'videos',
        overrideAccess: true,
        file: { data: jpeg, name: 'fake.mp4', mimetype: 'video/mp4', size: jpeg.byteLength },
        data: { title: 'Fake', poster: posterId },
        context: CTX,
      }),
    ).rejects.toThrow(/not allowed|do not match/i)
  })
})

describe('the public site-settings contract', () => {
  it('OMITS `video` when none is configured, and emits the pre-feature key set', async () => {
    const out = (await readPublic()) as unknown as Record<string, unknown>
    expect('video' in out).toBe(false)

    // 🔴 THE BYTE-IDENTICAL GUARANTEE. With no video configured the response
    // must be indistinguishable from the one this endpoint returned before the
    // feature existed — no null, no empty object, no extra key.
    expect(JSON.stringify(out)).not.toContain('"video"')
  })

  it('emits { src, mimeType, poster } once a video is made active', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      context: CTX,
      data: { video: videoId },
    })

    const out = await readPublic()
    expect(out.video).toBeDefined()
    expect(Object.keys(out.video!).sort()).toEqual(['mimeType', 'poster', 'src'])
    expect(typeof out.video!.src).toBe('string')
    expect(out.video!.src.length).toBeGreaterThan(0)
    expect(out.video!.mimeType).toBe('video/mp4')
  })

  it('populates the POSTER as a full ImageRef, never a bare id', async () => {
    const out = await readPublic()
    const poster = out.video!.poster
    // The whole point of this file: a bare id here means the read depth is too
    // shallow, and the symptom in production is a video that never appears.
    expect(typeof poster).toBe('object')
    expect(Object.keys(poster).sort()).toEqual(['alt', 'height', 'src', 'width'])
    expect(poster.alt).toBe('A still from the layout flyover')
    expect(poster.width).toBe(32)
    expect(poster.height).toBe(24)
    expect(poster.src.length).toBeGreaterThan(0)
  })

  /**
   * 🔴 THE DEPTH REGRESSION GUARD. Do not delete this case, and do not lower
   * the route's depth to make it pass.
   *
   * `site-settings.video -> videos.poster -> media` is two relation hops.
   * Measured against a real database with the route's own `select`:
   *   depth=1 -> poster is a BARE ID  (video key silently omitted -> no video)
   *   depth=2 -> poster is an OBJECT  (correct)
   * Payload neither throws nor warns at depth 1, so this test is the only thing
   * standing between a lowered depth and a feature that quietly stops working.
   */
  it('DEPTH 1 IS NOT ENOUGH — proves why the route reads at depth 2', async () => {
    const shallow = (await publicFindGlobal(
      'site-settings',
      PUBLIC_SITE_SETTINGS_SELECT,
      1,
    )) as unknown as { video?: { poster?: unknown } }
    expect(typeof shallow.video).toBe('object')
    expect(typeof shallow.video!.poster, 'depth 1 degrades the poster to an id').toBe('string')

    const deep = (await publicFindGlobal(
      'site-settings',
      PUBLIC_SITE_SETTINGS_SELECT,
      2,
    )) as unknown as { video?: { poster?: unknown } }
    expect(typeof deep.video!.poster, 'depth 2 populates it').toBe('object')

    // And the serialiser reacts correctly to the shallow read: it omits rather
    // than emitting a video with an unusable poster.
    const { toPublicSiteSettings: ser } = await import('@/serializers/toPublicContent')
    const shallowOut = ser(shallow as unknown as SiteSetting) as unknown as Record<string, unknown>
    expect('video' in shallowOut).toBe(false)
  })

  it('does not disturb any existing key', async () => {
    const out = (await readPublic()) as unknown as Record<string, unknown>
    for (const key of ['name', 'legalName', 'url', 'email', 'phone', 'whatsapp', 'address', 'copyrightText']) {
      expect(out[key], `existing key ${key} must survive`).toBeDefined()
    }
    expect(out.name).toBe('SV Developers')
  })

  it('OMITS `video` again the moment the reference is cleared — the disable path', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      context: CTX,
      data: { video: null },
    })

    const out = (await readPublic()) as unknown as Record<string, unknown>
    expect('video' in out).toBe(false)

    // The asset itself must survive being taken off the site.
    const still = await payload.findByID({ collection: 'videos', id: videoId, overrideAccess: true })
    expect(still.id).toBe(videoId)

    // Restore for the delete-guard cases below.
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      context: CTX,
      data: { video: videoId },
    })
  })
})

describe('replacement keeps the reference intact', () => {
  it('writes a NEW uuid, keeps the document id, and records the superseded key', async () => {
    const before = await payload.findByID({ collection: 'videos', id: videoId, overrideAccess: true })
    const oldFilename = before.filename as string

    const bytes = mp4Bytes(64)
    const after = await payload.update({
      collection: 'videos',
      id: videoId,
      overrideAccess: true,
      file: { data: bytes, name: 'replacement.mp4', mimetype: 'video/mp4', size: bytes.byteLength },
      data: {},
      // ⚠️ NO `skipAudit` HERE, DELIBERATELY, AND IT IS NOT AN OVERSIGHT.
      // `captureReplacedFile` early-returns on `context.skipAudit` — it sets
      // that flag on its OWN internal `payload.update` to avoid re-entering
      // itself. Passing it from outside therefore suppresses the exact
      // behaviour this case asserts. The admin panel and the REST API do not
      // set it, so this is what a real replace looks like.
      context: { skipRevalidate: true },
    })

    // Same document id -> the Site Settings reference survives untouched.
    expect(after.id).toBe(videoId)
    expect(after.filename).not.toBe(oldFilename)
    expect(after.filename).toMatch(/^[0-9a-f-]{36}\.mp4$/)

    const reread = await payload.findByID({ collection: 'videos', id: videoId, overrideAccess: true })
    expect((reread as { supersededFilenames?: string[] }).supersededFilenames).toContain(oldFilename)

    // And the public contract still resolves after the swap.
    const out = await readPublic()
    expect(out.video?.src.length).toBeGreaterThan(0)
  })
})

describe('delete protection', () => {
  it('REFUSES to delete the active video, with a 409 and an actionable message', async () => {
    await expect(
      payload.delete({ collection: 'videos', id: videoId, overrideAccess: true, context: CTX }),
    ).rejects.toThrow(/active video/i)
  })

  it('REFUSES to delete a media image in use as a poster', async () => {
    await expect(
      payload.delete({ collection: 'media', id: posterId, overrideAccess: true, context: CTX }),
    ).rejects.toThrow(/still in use|video poster/i)
  })

  it('allows deleting a media image that is NOT a poster — the guard is not a blanket block', async () => {
    const res = await payload.delete({
      collection: 'media',
      id: secondPosterId,
      overrideAccess: true,
      context: CTX,
    })
    expect(res).toBeTruthy()
  })

  it('allows deleting the video once it is no longer active', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      context: CTX,
      data: { video: null },
    })

    const res = await payload.delete({
      collection: 'videos',
      id: videoId,
      overrideAccess: true,
      context: CTX,
    })
    expect(res).toBeTruthy()
  })
})

describe('the deleted-asset sweeper covers videos', () => {
  it('includes `videos` alongside media and documents', async () => {
    const { sweepDeletedMedia } = await import('@/jobs')
    // The task body is the single source of truth for which collections are
    // swept; a video left out would orphan its Cloudinary object forever.
    expect(sweepDeletedMedia.handler.toString()).toContain('videos')
  })
})
