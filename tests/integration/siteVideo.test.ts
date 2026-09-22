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
 * `site-settings.heroVideos`, END TO END.
 *
 * 🔴 THE CASE THIS FILE EXISTS FOR IS THE POPULATION-DEPTH ONE. The public
 * site-settings read runs with `overrideAccess: false` and `user: undefined`,
 * and under those conditions Payload does NOT throw when a relation cannot be
 * read or is not populated deeply enough — it silently hands back BARE ID
 * STRINGS. The serialiser then drops those entries and the key disappears, so
 * the website shows no video with no error in any log.
 *
 * That failure is invisible to typechecking, invisible to the build, and
 * invisible in the admin panel (where reads are authenticated and deep). The
 * only thing that catches it is a test reading exactly the way the route reads,
 * which is why these cases call `publicFindGlobal` with the route's own
 * `PUBLIC_SITE_SETTINGS_SELECT` and depth.
 *
 * 🔴 ORDER IS THE CONTRACT. `HeroVideoStage` advances with
 * `(index + 1) % videos.length`, so the array index IS the carousel order.
 * Several cases below pin that the ADMIN's order — not alphabetical, not by
 * upload date, not by id — is what the API emits.
 *
 * ⚠️ CLOUDINARY IS DELIBERATELY UNCONFIGURED IN TESTS (`.env.test` pins
 * `CLOUDINARY_CLOUD_NAME=`), so `cloudinaryFileUrl` returns undefined here and
 * the serialiser exercises its LOCAL-DISK fallback. The Cloudinary URL
 * composition itself is pinned exactly in `tests/unit/cloudinaryUrl.test.ts`.
 */

let payload: Payload

/**
 * A structurally valid ISO-BMFF container: `ftyp` + `mdat`.
 *
 * 🔴 THE `mdat` SIZE MUST INCLUDE THE PADDING, and that is not pedantry —
 * PAYLOAD VALIDATES THE CONTAINER ITSELF, independently of our upload guard.
 * Appending bytes after a box that declares size 8 leaves orphan bytes outside
 * any box, and `checkFileRestrictions` rejects it with "Invalid or corrupted
 * ISO base media file." before our guard's own checks are even reached.
 *
 * That is a real defence-in-depth layer worth knowing about: a file can pass
 * magic-byte sniffing and still be refused for being a malformed container.
 */
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

const setHeroVideos = async (ids: string[]) => {
  await payload.updateGlobal({
    slug: 'site-settings',
    overrideAccess: true,
    context: CTX,
    data: { heroVideos: ids },
  })
}

let posterId: string
let sparePosterId: string
/** Created in a deliberately NON-alphabetical, NON-chronological sequence so
 *  an accidental sort in the serialiser cannot coincidentally pass. */
let videoZulu: string // created 1st, title "Zulu approach"
let videoAlpha: string // created 2nd, title "Alpha roads"
let videoMike: string // created 3rd, title "Mike cottages"

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

  const spare = await payload.create({
    collection: 'media',
    overrideAccess: true,
    file: { data: await jpegBytes(), name: 'spare.jpg', mimetype: 'image/jpeg', size: 0 },
    data: { alt: 'Unused image' },
    context: CTX,
  })
  sparePosterId = spare.id as string

  const mk = async (title: string, name: string) => {
    const bytes = mp4Bytes(Math.floor(Math.random() * 8))
    const doc = await payload.create({
      collection: 'videos',
      overrideAccess: true,
      file: { data: bytes, name, mimetype: 'video/mp4', size: bytes.byteLength },
      data: { title, poster: posterId },
      context: CTX,
    })
    return doc.id as string
  }
  videoZulu = await mk('Zulu approach', 'zulu.mp4')
  videoAlpha = await mk('Alpha roads', 'alpha.mp4')
  videoMike = await mk('Mike cottages', 'mike.mp4')

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
    const upload = videos.upload as Record<string, unknown>
    expect(upload.mimeTypes).toEqual(['video/mp4'])
    expect(upload.crop).toBe(false)
    expect(upload.focalPoint).toBe(false)
    expect(upload.imageSizes).toBeUndefined()
    expect(upload.pasteURL).toBe(false)
    expect(upload.bulkUpload).toBe(false)
  })

  it('grants anonymous READ — without it the relation silently degrades to ids', () => {
    const videos = payload.config.collections.find((c) => c.slug === 'videos')!
    expect(videos.access!.read!({ req: { user: undefined } } as never)).toBe(true)
  })

  it('does NOT expose uploadedBy or originalFilename anonymously', async () => {
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

  it('keeps title and poster REQUIRED — no migration was needed to satisfy the contract', () => {
    const videos = payload.config.collections.find((c) => c.slug === 'videos')!
    const byName = (n: string) => videos.fields.find((f) => (f as { name?: string }).name === n)
    expect((byName('title') as { required?: boolean }).required).toBe(true)
    expect((byName('poster') as { required?: boolean }).required).toBe(true)
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

describe('site-settings.heroVideos is an ORDERED hasMany upload', () => {
  const field = () => {
    const g = payload.config.globals.find((x) => x.slug === 'site-settings')!
    const flat = (fields: unknown[]): Record<string, unknown>[] =>
      fields.flatMap((f) => {
        const x = f as { tabs?: { fields: unknown[] }[]; fields?: unknown[]; name?: string }
        if (x.tabs) return x.tabs.flatMap((t) => flat(t.fields))
        if (x.name) return [x as Record<string, unknown>]
        if (x.fields) return flat(x.fields)
        return []
      })
    return flat(g.fields).find((f) => f.name === 'heroVideos')!
  }

  it('exists, targets `videos`, and is hasMany so order is a stored fact', () => {
    const f = field()
    expect(f).toBeDefined()
    expect(f.type).toBe('upload')
    expect(f.relationTo).toBe('videos')
    expect(f.hasMany).toBe(true)
  })

  it('the singular `video` field is GONE — one mechanism, not two', () => {
    const g = payload.config.globals.find((x) => x.slug === 'site-settings')!
    expect(JSON.stringify(g.fields)).not.toContain('"name":"video"')
  })

  it('carries no placement/carousel configuration', () => {
    const g = payload.config.globals.find((x) => x.slug === 'site-settings')!
    const s = JSON.stringify(g.fields)
    for (const banned of ['carouselConfig', 'autoplayInterval', 'placement', 'heroSection']) {
      expect(s).not.toContain(banned)
    }
  })
})

describe('the public heroVideos contract', () => {
  it('OMITS the key when none are configured, preserving the pre-feature response', async () => {
    await setHeroVideos([])
    const out = (await readPublic()) as unknown as Record<string, unknown>
    expect('heroVideos' in out).toBe(false)
    // Never [], never null, never a placeholder row.
    expect(JSON.stringify(out)).not.toContain('"heroVideos"')
  })

  it('emits exactly one object for one configured video', async () => {
    await setHeroVideos([videoAlpha])
    const out = await readPublic()
    expect(Array.isArray(out.heroVideos)).toBe(true)
    expect(out.heroVideos).toHaveLength(1)
    expect(out.heroVideos![0]!.title).toBe('Alpha roads')
  })

  it('emits EXACTLY { src, poster, title } — and never mimeType or an id', async () => {
    await setHeroVideos([videoAlpha])
    const out = await readPublic()
    const entry = out.heroVideos![0]!
    expect(Object.keys(entry).sort()).toEqual(['poster', 'src', 'title'])
    const json = JSON.stringify(entry)
    for (const leak of ['mimeType', '"id"', 'uploadedBy', 'originalFilename', 'filesize', 'filename']) {
      expect(json, `must not leak ${leak}`).not.toContain(leak)
    }
  })

  it('returns poster as a plain STRING URL, not an ImageRef object', async () => {
    await setHeroVideos([videoAlpha])
    const entry = (await readPublic()).heroVideos![0]!
    expect(typeof entry.poster).toBe('string')
    expect((entry.poster as string).length).toBeGreaterThan(0)
    // The old contract emitted { src, alt, width, height } here.
    expect(entry.poster).not.toHaveProperty('src')
  })

  it('returns title as a string', async () => {
    await setHeroVideos([videoAlpha])
    const entry = (await readPublic()).heroVideos![0]!
    expect(typeof entry.title).toBe('string')
    expect(entry.title).toBe('Alpha roads')
  })

  it('returns src as a non-empty string', async () => {
    await setHeroVideos([videoAlpha])
    const entry = (await readPublic()).heroVideos![0]!
    expect(typeof entry.src).toBe('string')
    expect(entry.src.length).toBeGreaterThan(0)
  })

  it('PRESERVES ADMIN ORDER EXACTLY — not alphabetical, not by date, not by id', async () => {
    // Admin order deliberately fights both sorts: titles Z, A, M and creation
    // order Zulu, Alpha, Mike. Only verbatim ordering produces this result.
    await setHeroVideos([videoMike, videoZulu, videoAlpha])
    const titles = (await readPublic()).heroVideos!.map((v) => v.title)
    expect(titles).toEqual(['Mike cottages', 'Zulu approach', 'Alpha roads'])
    expect(titles).not.toEqual([...titles].sort())
  })

  it('reordering in the admin changes the API order, deterministically', async () => {
    await setHeroVideos([videoAlpha, videoMike, videoZulu])
    expect((await readPublic()).heroVideos!.map((v) => v.title)).toEqual([
      'Alpha roads',
      'Mike cottages',
      'Zulu approach',
    ])
    // Read twice: same input must give the same output, every time.
    expect((await readPublic()).heroVideos!.map((v) => v.title)).toEqual([
      'Alpha roads',
      'Mike cottages',
      'Zulu approach',
    ])

    await setHeroVideos([videoZulu, videoAlpha, videoMike])
    expect((await readPublic()).heroVideos!.map((v) => v.title)).toEqual([
      'Zulu approach',
      'Alpha roads',
      'Mike cottages',
    ])
  })

  it('DEDUPES a video selected twice, keeping its first position', async () => {
    // HeroVideoStage uses `key={video.src}`; duplicates would collide as React
    // keys and misbehave in a way that looks like a rendering bug.
    await setHeroVideos([videoAlpha, videoMike, videoAlpha])
    const titles = (await readPublic()).heroVideos!.map((v) => v.title)
    expect(titles).toEqual(['Alpha roads', 'Mike cottages'])
    const srcs = (await readPublic()).heroVideos!.map((v) => v.src)
    expect(new Set(srcs).size).toBe(srcs.length)
  })

  it('does not disturb any existing key', async () => {
    await setHeroVideos([videoAlpha])
    const out = (await readPublic()) as unknown as Record<string, unknown>
    for (const key of [
      'name',
      'legalName',
      'url',
      'email',
      'phone',
      'whatsapp',
      'address',
      'copyrightText',
    ]) {
      expect(out[key], `existing key ${key} must survive`).toBeDefined()
    }
    expect(out.name).toBe('SV Developers')
  })

  it('the no-video response differs from the with-video one by that key ALONE', async () => {
    await setHeroVideos([videoAlpha])
    const withVideos = (await readPublic()) as unknown as Record<string, unknown>
    await setHeroVideos([])
    const without = (await readPublic()) as unknown as Record<string, unknown>
    const { heroVideos: _dropped, ...rest } = withVideos
    expect(rest).toEqual(without)
  })

  it('clearing the list OMITS the key again and KEEPS the assets — the disable path', async () => {
    await setHeroVideos([videoAlpha, videoMike])
    expect((await readPublic()).heroVideos).toHaveLength(2)

    await setHeroVideos([])
    const out = (await readPublic()) as unknown as Record<string, unknown>
    expect('heroVideos' in out).toBe(false)

    for (const id of [videoAlpha, videoMike]) {
      const still = await payload.findByID({ collection: 'videos', id, overrideAccess: true })
      expect(still.id).toBe(id)
    }
  })

  /**
   * 🔴 THE DEPTH REGRESSION GUARD. Do not delete this case, and do not lower
   * the route's depth to make it pass. `heroVideos -> videos.poster -> media`
   * is two relation hops; at depth 1 the poster is a bare id, every entry is
   * dropped and the key vanishes with no error anywhere.
   */
  it('DEPTH 1 IS NOT ENOUGH — proves why the route reads at depth 2', async () => {
    await setHeroVideos([videoAlpha])

    const shallow = (await publicFindGlobal(
      'site-settings',
      PUBLIC_SITE_SETTINGS_SELECT,
      1,
    )) as unknown as { heroVideos?: { poster?: unknown }[] }
    expect(typeof shallow.heroVideos![0]!.poster, 'depth 1 degrades the poster to an id').toBe(
      'string',
    )

    const deep = (await publicFindGlobal(
      'site-settings',
      PUBLIC_SITE_SETTINGS_SELECT,
      2,
    )) as unknown as { heroVideos?: { poster?: unknown }[] }
    expect(typeof deep.heroVideos![0]!.poster, 'depth 2 populates it').toBe('object')

    // And the serialiser reacts correctly to the shallow read: it drops the
    // entry rather than emitting a video with an unusable poster.
    const { toPublicSiteSettings: ser } = await import('@/serializers/toPublicContent')
    const shallowOut = ser(shallow as unknown as SiteSetting) as unknown as Record<string, unknown>
    expect('heroVideos' in shallowOut).toBe(false)
  })
})

describe('replacement keeps the reference and the position intact', () => {
  it('writes a NEW uuid, keeps the document id, and records the superseded key', async () => {
    await setHeroVideos([videoZulu, videoAlpha, videoMike])
    const before = await payload.findByID({
      collection: 'videos',
      id: videoAlpha,
      overrideAccess: true,
    })
    const oldFilename = before.filename as string

    const bytes = mp4Bytes(64)
    const after = await payload.update({
      collection: 'videos',
      id: videoAlpha,
      overrideAccess: true,
      file: { data: bytes, name: 'replacement.mp4', mimetype: 'video/mp4', size: bytes.byteLength },
      data: {},
      // ⚠️ NO `skipAudit`, DELIBERATELY. `captureReplacedFile` early-returns on
      // it — it sets that flag on its OWN internal update to avoid re-entering
      // itself. The admin panel does not set it, so this is a real replace.
      context: { skipRevalidate: true },
    })

    expect(after.id).toBe(videoAlpha)
    expect(after.filename).not.toBe(oldFilename)

    const reread = await payload.findByID({
      collection: 'videos',
      id: videoAlpha,
      overrideAccess: true,
    })
    expect((reread as { supersededFilenames?: string[] }).supersededFilenames).toContain(
      oldFilename,
    )

    // The carousel position is unchanged by a file replace.
    const titles = (await readPublic()).heroVideos!.map((v) => v.title)
    expect(titles).toEqual(['Zulu approach', 'Alpha roads', 'Mike cottages'])
  })
})

describe('delete protection', () => {
  it('REFUSES to delete a video that is in the hero list', async () => {
    await setHeroVideos([videoZulu, videoAlpha])
    await expect(
      payload.delete({ collection: 'videos', id: videoAlpha, overrideAccess: true, context: CTX }),
    ).rejects.toThrow(/active hero video/i)
  })

  it('REFUSES to delete a media image in use as a poster', async () => {
    await expect(
      payload.delete({ collection: 'media', id: posterId, overrideAccess: true, context: CTX }),
    ).rejects.toThrow(/still in use|video poster/i)
  })

  it('allows deleting a media image that is NOT a poster — not a blanket block', async () => {
    const res = await payload.delete({
      collection: 'media',
      id: sparePosterId,
      overrideAccess: true,
      context: CTX,
    })
    expect(res).toBeTruthy()
  })

  it('allows deleting a video once it is removed from the hero list', async () => {
    await setHeroVideos([videoZulu])
    const res = await payload.delete({
      collection: 'videos',
      id: videoMike,
      overrideAccess: true,
      context: CTX,
    })
    expect(res).toBeTruthy()
    await setHeroVideos([])
  })
})

describe('the deleted-asset sweeper covers videos', () => {
  it('includes `videos` alongside media and documents', async () => {
    const { sweepDeletedMedia } = await import('@/jobs')
    expect(sweepDeletedMedia.handler.toString()).toContain('videos')
  })
})
