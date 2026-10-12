import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { publicFindGlobal } from '@/lib/publicFind'
import {
  PUBLIC_SITE_SETTINGS_SELECT,
  toPublicSiteSettings,
} from '@/serializers/toPublicContent'

/**
 * `site-settings.heroMedia` — THE CONTRACT TESTS.
 *
 * 🔴 THE INVARIANT THAT PROTECTS THE LIVE HOMEPAGE. One hero video is serving
 * production RIGHT NOW through the legacy `heroVideos` field. `heroMedia` is
 * additive: while it has no rows, `/site-settings` must be byte-identical to
 * what it returns today, and the frontend must keep rendering the legacy list.
 * Most of this file pins that, not the new feature.
 *
 * 🔴 WHY AN `array` AND NOT A POLYMORPHIC UPLOAD RELATION — pinned as a test
 * because it is the design decision most likely to be "simplified" later by
 * someone who has not noticed that a YouTube entry has no document to point at.
 */

let payload: Payload

const CTX = { skipAudit: true, skipRevalidate: true }

let imageId: string
let posterId: string
let videoId: string

const jpegBytes = async (w: number, h: number): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 60, b: 30 } } })
    .jpeg()
    .toBuffer()
}

/**
 * A tiny but STRUCTURALLY VALID mp4 — the same fixture `siteVideo.test.ts` uses.
 *
 * ⚠️ AN `ftyp` BOX ALONE IS NOT ENOUGH. The upload guard sniffs magic bytes AND
 * checks the container is well-formed, so it refuses a file that begins
 * correctly and then stops — a real defence-in-depth layer. The `mdat` box
 * below is what makes this a container rather than a header.
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

/**
 * The REQUIRED `site-settings` scalars.
 *
 * ⚠️ `resetTestDatabase` truncates the global, and seven of its fields are
 * `required: true` — so every `updateGlobal` in this file would fail validation
 * on "Brand > Name" and six others before ever reaching `heroMedia`. They are
 * re-sent with each write because a global update validates the WHOLE document,
 * not the changed subset.
 */
const REQUIRED_SITE_FIELDS = {
  name: 'SV Developers',
  legalName: 'SV Developers',
  url: 'https://example.com',
  email: 'test@example.com',
  phone: '7799774169',
  whatsapp: '7799774169',
  address: ['A line'],
}

const setHero = async (heroMedia: unknown[]) =>
  payload.updateGlobal({
    slug: 'site-settings',
    overrideAccess: true,
    data: { ...REQUIRED_SITE_FIELDS, heroMedia } as never,
    context: CTX,
  })

/**
 * Reads EXACTLY as `src/app/(public)/api/v1/site-settings/route.ts` does —
 * same helper, same select, SAME DEPTH.
 *
 * 🔴 DEPTH 2 IS LOAD-BEARING AND IT IS NOT A CHOICE THIS TEST MAKES. A
 * `kind: 'video'` row is `heroMedia[] -> videos -> poster -> media`: two
 * relation hops, and depth is what pays for the second. At depth 1 the poster
 * arrives as a bare id, the serialiser's both-or-nothing rule correctly drops
 * the row, and the symptom is "the admin configured a video and the hero never
 * shows it" with a 200 and nothing in any log. The route was already set to 2
 * for `heroVideos` — which has the identical chain — and the reasoning is
 * recorded there. Reading at a different depth here would test a configuration
 * that does not exist in production.
 */
const publicHero = async () => {
  const doc = await publicFindGlobal('site-settings', PUBLIC_SITE_SETTINGS_SELECT, 2)
  return toPublicSiteSettings(doc as never)
}

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)

  const uploadImage = async (name: string, alt: string, w: number, h: number) =>
    (
      await payload.create({
        collection: 'media',
        overrideAccess: true,
        file: { data: await jpegBytes(w, h), name, mimetype: 'image/jpeg', size: 1 },
        data: { alt },
        context: CTX,
      })
    ).id as string

  imageId = await uploadImage('hero.jpg', 'An aerial photograph', 2400, 1350)
  posterId = await uploadImage('poster.jpg', 'A still frame', 1920, 1080)

  videoId = (
    await payload.create({
      collection: 'videos',
      overrideAccess: true,
      file: { data: mp4Bytes(), name: 'clip.mp4', mimetype: 'video/mp4', size: 1 },
      data: { title: 'Drone pass', poster: posterId },
      context: CTX,
    })
  ).id as string
})

// ---------------------------------------------------------------------------
describe('BACKWARD COMPATIBILITY — the field is additive', () => {
  it('OMITS `heroMedia` entirely when no rows are configured', async () => {
    await setHero([])
    const hero = await publicHero()
    /* 🔴 NOT `[]`, NOT `null`. The frontend's `heroItems()` asks for ROWS, and
       omission is what lets it fall through to the legacy list. An empty array
       here would also be a shape the contract does not declare. */
    expect('heroMedia' in hero).toBe(false)
  })

  it('leaves `heroVideos` serialising exactly as before', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: { ...REQUIRED_SITE_FIELDS, heroVideos: [videoId], heroMedia: [] } as never,
      context: CTX,
    })

    const hero = await publicHero()
    expect(hero.heroVideos).toHaveLength(1)
    // Exactly three keys, the shape production depends on today.
    expect(Object.keys(hero.heroVideos![0]!).sort()).toEqual(['poster', 'src', 'title'])
    expect(hero.heroVideos![0]!.title).toBe('Drone pass')
    expect('heroMedia' in hero).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('the three kinds', () => {
  it('emits an IMAGE with its intrinsic dimensions and alt text', async () => {
    await setHero([{ kind: 'image', image: imageId, title: 'Aerial approach' }])
    const hero = await publicHero()

    expect(hero.heroMedia).toHaveLength(1)
    expect(hero.heroMedia![0]).toEqual({
      kind: 'image',
      src: expect.any(String),
      // `alt` rides along from the Media library entry, which is what makes an
      // image hero accessible without a second field on the row.
      alt: 'An aerial photograph',
      width: 2400,
      height: 1350,
      title: 'Aerial approach',
    })
  })

  it('emits an UPLOADED VIDEO as {src, poster} through the SAME helper as heroVideos', async () => {
    await setHero([{ kind: 'video', video: videoId, title: 'The drone pass' }])
    const hero = await publicHero()

    const item = hero.heroMedia![0] as { kind: string; src: string; poster?: string; title?: string }
    expect(item.kind).toBe('video')
    expect(item.src).toBeTruthy()
    expect(item.poster).toBeTruthy()
    // The ROW's title wins over the asset's internal label: the asset name is
    // for the media library, this one is for the visitor.
    expect(item.title).toBe('The drone pass')
  })

  it('emits a YOUTUBE entry with the URL VERBATIM and a CMS poster', async () => {
    const pasted = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&si=XyZ'
    await setHero([{ kind: 'youtube', youtubeUrl: pasted, poster: posterId, title: 'Walkthrough' }])
    const hero = await publicHero()

    const item = hero.heroMedia![0] as {
      kind: string
      youtubeUrl: string
      poster: string
      title?: string
    }
    expect(item.kind).toBe('youtube')
    // Never reduced to an id — `youtubeId()` on the frontend is the arbiter.
    expect(item.youtubeUrl).toBe(pasted)
    /* 🔴 THE POSTER COMES FROM `media`, NOT FROM i.ytimg.com — that host is
       deliberately absent from svfrontend's image allowlist, so a YouTube
       slide has nothing to show before the click without this. */
    expect(item.poster).toBeTruthy()
    expect(item.title).toBe('Walkthrough')
  })
})

// ---------------------------------------------------------------------------
describe('ORDER IS THE CONTRACT', () => {
  it('preserves admin order VERBATIM across mixed kinds — never sorted', async () => {
    await setHero([
      { kind: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', poster: posterId, title: 'C' },
      { kind: 'image', image: imageId, title: 'A' },
      { kind: 'video', video: videoId, title: 'B' },
    ])
    const hero = await publicHero()

    /* 🔴 THE ORDER BELOW IS THE ORDER WRITTEN ABOVE, not alphabetical by title
       and not grouped by kind. Array index IS slideshow order; a serialiser
       that sorted would silently reorder the homepage's first screen. */
    expect(hero.heroMedia!.map((m) => (m as { kind: string }).kind)).toEqual([
      'youtube',
      'image',
      'video',
    ])
    expect(hero.heroMedia!.map((m) => (m as { title?: string }).title)).toEqual(['C', 'A', 'B'])
  })
})

// ---------------------------------------------------------------------------
describe('per-entry both-or-nothing', () => {
  /**
   * 🔴 THESE GO STRAIGHT AT THE SERIALISER, NOT THROUGH `updateGlobal`, AND
   * THAT IS THE ONLY WAY TO TEST THEM. The field `validate` refuses to SAVE a
   * malformed row, so these states are unreachable through Payload — which is
   * the point. What they exercise is the serialiser's SECOND guard: the path
   * that matters if a row ever arrives from outside the admin, predates the
   * validator, or survives a future field rename. A row the serialiser cannot
   * fully resolve must be DROPPED, never half-emitted.
   */
  const serialise = (heroMedia: unknown[]) =>
    toPublicSiteSettings({
      ...REQUIRED_SITE_FIELDS,
      copyrightText: '© 2026',
      heroMedia,
    } as never)

  it('DROPS a YouTube row with no poster but KEEPS the rest of the list', () => {
    const hero = serialise([
      { kind: 'image', image: { filename: 'a.jpg', alt: 'A', width: 10, height: 10 }, title: 'Good' },
      { kind: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', title: 'No poster' },
    ])
    // One bad row must not blank a working hero.
    expect((hero.heroMedia ?? []).map((m) => (m as { kind: string }).kind)).toEqual(['image'])
  })

  it('DROPS an image row whose relation was not populated (a bare id)', () => {
    const hero = serialise([
      // A bare id string means `depth` was too shallow. Never guess a URL from
      // an id — that is how a broken image ships silently.
      { kind: 'image', image: 'some-uuid-string', title: 'Unpopulated' },
      { kind: 'image', image: { filename: 'b.jpg', alt: 'B', width: 20, height: 10 }, title: 'Fine' },
    ])
    expect((hero.heroMedia ?? []).map((m) => (m as { title?: string }).title)).toEqual(['Fine'])
  })

  it('OMITS the key entirely when every row is unresolvable', () => {
    const hero = serialise([{ kind: 'youtube', youtubeUrl: '', title: 'Nothing' }])
    /* 🔴 OMITTED, not `[]`. This is what makes the frontend fall back to the
       legacy `heroVideos` instead of rendering an empty slideshow. */
    expect('heroMedia' in hero).toBe(false)
  })

  it('DROPS a row with an unknown `kind` rather than guessing', () => {
    const hero = serialise([
      { kind: 'carousel', image: { filename: 'c.jpg', alt: 'C', width: 10, height: 10 } },
      { kind: 'image', image: { filename: 'd.jpg', alt: 'D', width: 10, height: 10 }, title: 'Kept' },
    ])
    expect((hero.heroMedia ?? []).map((m) => (m as { title?: string }).title)).toEqual(['Kept'])
  })
})

// ---------------------------------------------------------------------------
describe('the field definition', () => {
  const heroMediaField = () => {
    const global = payload.config.globals.find((g) => g.slug === 'site-settings')!
    const flatten = (fields: unknown[]): Record<string, unknown>[] =>
      fields.flatMap((f) => {
        const field = f as { tabs?: { fields: unknown[] }[]; fields?: unknown[]; name?: string }
        if (field.tabs) return field.tabs.flatMap((t) => flatten(t.fields))
        if (field.name) return [field as Record<string, unknown>]
        if (field.fields) return flatten(field.fields)
        return []
      })
    return flatten(global.fields).find((f) => f.name === 'heroMedia')!
  }

  it('is an ARRAY, not a polymorphic upload relation', () => {
    const field = heroMediaField()
    expect(field).toBeDefined()
    /* 🔴 THE DESIGN DECISION, PINNED. `relationTo: ['media','videos']` cannot
       express a YouTube entry at all — a pasted URL has no document to point
       at — so a relation could carry two of the three kinds and would need a
       second field beside it for the third, giving two sources of order for one
       list. If someone "simplifies" this to a relation, this fails. */
    expect(field.type).toBe('array')
    expect(field.relationTo).toBeUndefined()
  })

  it('is NOT artificially limited to one row', () => {
    const field = heroMediaField()
    // maxRows is the paste-accident guard (MAX_ARRAY_ROWS), not a feature cap.
    expect(Number(field.maxRows)).toBeGreaterThan(1)
  })

  it('carries an EXPLICIT `kind` discriminator with exactly three options', () => {
    const rows = (heroMediaField().fields as { name?: string; options?: unknown[] }[]) ?? []
    const kind = rows.find((f) => f.name === 'kind')!
    expect(kind).toBeDefined()
    const values = (kind.options as { value: string }[]).map((o) => o.value).sort()
    expect(values).toEqual(['image', 'video', 'youtube'])
  })

  it('keeps the legacy `heroVideos` field in place', () => {
    const global = payload.config.globals.find((g) => g.slug === 'site-settings')!
    const flatten = (fields: unknown[]): Record<string, unknown>[] =>
      fields.flatMap((f) => {
        const field = f as { tabs?: { fields: unknown[] }[]; fields?: unknown[]; name?: string }
        if (field.tabs) return field.tabs.flatMap((t) => flatten(t.fields))
        if (field.name) return [field as Record<string, unknown>]
        if (field.fields) return flatten(field.fields)
        return []
      })
    const legacy = flatten(global.fields).find((f) => f.name === 'heroVideos')
    // 🔴 Removing this would break the hero that is live in production.
    expect(legacy).toBeDefined()
    expect(legacy!.type).toBe('upload')
    expect(legacy!.hasMany).toBe(true)
  })
})
