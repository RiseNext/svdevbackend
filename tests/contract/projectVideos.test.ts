import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { publicFind, publicFindOne } from '@/lib/publicFind'
import {
  PUBLIC_PROJECT_CARD_SELECT,
  PUBLIC_PROJECT_SELECT,
  toPublicProject,
  toPublicProjectCard,
} from '@/serializers/toPublicProject'

/**
 * `projects.videos` — THE CONTRACT TESTS.
 *
 * 🔴 THE INVARIANT THAT PROTECTS THE LIVE PROJECT PAGES. Four projects are
 * published in production with no video list, and their `/projects/{slug}`
 * response must stay byte-identical to what it returns today. Most of this file
 * is that regression, not the new feature — including a dedicated case proving
 * the route's depth increase from 1 to 2 changed nothing about the existing
 * payload.
 *
 * 🔴 IT IS A SEPARATE FIELD FROM `promoVideo`, AND BOTH MUST KEEP WORKING.
 * `promoVideo` fills the single pane on the homepage card; this list fills a
 * section on the project's own page. Cases below pin that they are independent.
 */

let payload: Payload

const CTX = { skipAudit: true, skipRevalidate: true }

let coverId: string
let galleryId: string
let posterId: string
let videoAId: string
let videoBId: string

const jpegBytes = async (w: number, h: number): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 80, b: 50 } } })
    .jpeg()
    .toBuffer()
}

/** Structurally valid mp4 — an `ftyp` box alone is refused by the upload guard,
 *  which checks the container is well-formed. Same fixture as siteVideo. */
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

const baseProject = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  name: `Videos ${slug}`,
  category: 'Residential Plots' as const,
  locality: 'Testville',
  summary: 'A project-video wiring test project.',
  description: ['Only paragraph.'],
  highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
  image: coverId,
  _status: 'published' as const,
  ...extra,
})

const mk = async (slug: string, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'projects',
    overrideAccess: true,
    data: baseProject(slug, extra) as never,
    context: CTX,
  })

/** Reads EXACTLY as `api/v1/projects/[slug]/route.ts` does — SAME DEPTH (2). */
const detail = async (slug: string) => {
  const doc = await publicFindOne({
    collection: 'projects',
    where: { slug: { equals: slug } },
    select: PUBLIC_PROJECT_SELECT,
    depth: 2,
  })
  return toPublicProject(doc as never) as unknown as Record<string, unknown>
}

/** The same read at the OLD depth, for the no-regression comparison. */
const detailAtDepth1 = async (slug: string) => {
  const doc = await publicFindOne({
    collection: 'projects',
    where: { slug: { equals: slug } },
    select: PUBLIC_PROJECT_SELECT,
    depth: 1,
  })
  return toPublicProject(doc as never) as unknown as Record<string, unknown>
}

const card = async (slug: string) => {
  const result = await publicFind({
    collection: 'projects',
    where: { slug: { equals: slug } },
    select: PUBLIC_PROJECT_CARD_SELECT,
    depth: 1,
  })
  return toPublicProjectCard(result.docs[0] as never) as unknown as Record<string, unknown>
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

  coverId = await uploadImage('cover.jpg', 'Cover', 1200, 800)
  galleryId = await uploadImage('gal.jpg', 'Gallery A', 640, 480)
  posterId = await uploadImage('poster.jpg', 'A still frame', 1920, 1080)

  const mkVideo = async (title: string, name: string) =>
    (
      await payload.create({
        collection: 'videos',
        overrideAccess: true,
        file: { data: mp4Bytes(2), name, mimetype: 'video/mp4', size: 1 },
        data: { title, poster: posterId },
        context: CTX,
      })
    ).id as string

  videoAId = await mkVideo('Drone approach', 'a.mp4')
  videoBId = await mkVideo('Roads laid', 'b.mp4')

  // --- no videos at all: the production shape
  await mk('plain-project', { gallery: [galleryId] })

  // --- a mixed, ordered list
  await mk('mixed-project', {
    videos: [
      { kind: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', poster: posterId, title: 'First — YT', duration: '2:14' },
      { kind: 'video', video: videoAId, title: 'Second — MP4' },
      { kind: 'youtube', youtubeUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=9s', poster: posterId, title: 'Third — YT' },
      { kind: 'video', video: videoBId },
    ],
  })

  // --- both promoVideo AND the list, to prove independence
  await mk('both-project', {
    promoVideo: { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', duration: '1:00' },
    videos: [{ kind: 'video', video: videoAId, title: 'List entry' }],
  })
})

// ---------------------------------------------------------------------------
describe('REGRESSION — a project with no video list is unchanged', () => {
  it('OMITS the `videos` key entirely — not null, not []', async () => {
    expect('videos' in (await detail('plain-project'))).toBe(false)
  })

  it('NEVER appears on the card payload, even for a project that has videos', async () => {
    /* 🔴 DETAIL-ONLY, like `logo`. The card renders `promoVideo` and nothing
       else, so shipping N video rows per project to the catalogue, the homepage
       deck, the nav, the footer and the sitemap would be pure over-fetch. */
    expect('videos' in (await card('mixed-project'))).toBe(false)
    expect('videos' in PUBLIC_PROJECT_CARD_SELECT).toBe(false)
  })

  it('🔴 DEPTH 2 PRODUCES THE IDENTICAL PAYLOAD AT DEPTH 1 for a project without videos', async () => {
    /* The route was raised from depth 1 to depth 2 so that
       `videos[].video -> poster -> media` resolves. This is the proof that the
       increase did not widen or alter anything else: every existing field —
       image, gallery, layoutImage, logo, brochure — is byte-identical. If this
       ever fails, the depth change has had a side effect and the route, not
       this test, is what needs looking at. */
    const deep = await detail('plain-project')
    const shallow = await detailAtDepth1('plain-project')
    expect(JSON.stringify(deep)).toBe(JSON.stringify(shallow))
  })

  it('still carries every pre-existing field', async () => {
    const p = await detail('plain-project')
    expect(Object.keys(p.image as object).sort()).toEqual(['alt', 'height', 'src', 'width'])
    expect(p.description).toEqual(['Only paragraph.'])
    expect((p.gallery as unknown[]).length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('ORDER IS THE CONTRACT', () => {
  it('preserves admin order VERBATIM across mixed kinds — never sorted', async () => {
    const p = await detail('mixed-project')
    const list = p.videos as { kind: string; title?: string }[]

    expect(list).toHaveLength(4)
    /* Written youtube, video, youtube, video — and that is what comes back.
       Not grouped by kind, not alphabetical by title. */
    expect(list.map((v) => v.kind)).toEqual(['youtube', 'video', 'youtube', 'video'])
    expect(list.map((v) => v.title)).toEqual([
      'First — YT',
      'Second — MP4',
      'Third — YT',
      // The fourth row has no caption of its own, so the asset's library label
      // is used rather than emitting nothing.
      'Roads laid',
    ])
  })
})

// ---------------------------------------------------------------------------
describe('the two kinds', () => {
  it('emits a YOUTUBE entry with the URL verbatim, a CMS poster and duration', async () => {
    const list = (await detail('mixed-project')).videos as Record<string, unknown>[]
    const yt = list[0]!
    expect(yt.kind).toBe('youtube')
    expect(yt.youtubeUrl).toBe('https://youtu.be/dQw4w9WgXcQ')
    expect(yt.poster).toBeTruthy()
    expect(yt.duration).toBe('2:14')
    // No `src` on a YouTube entry — it is not a file.
    expect('src' in yt).toBe(false)
  })

  it('keeps a tracking tail on a watch URL rather than normalising it', async () => {
    const list = (await detail('mixed-project')).videos as Record<string, unknown>[]
    expect(list[2]!.youtubeUrl).toBe('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=9s')
  })

  it('emits an UPLOADED MP4 with src and a resolved poster (needs depth 2)', async () => {
    const list = (await detail('mixed-project')).videos as Record<string, unknown>[]
    const mp4 = list[1]!
    expect(mp4.kind).toBe('video')
    expect(mp4.src).toBeTruthy()
    /* 🔴 THE DEPTH-2 PAYOFF. `videos.poster` is a second relation hop; at depth
       1 this is a bare id and the poster would be absent. */
    expect(mp4.poster).toBeTruthy()
    expect('youtubeUrl' in mp4).toBe(false)
  })

  it('omits `duration` on a YouTube entry that has none', async () => {
    const list = (await detail('mixed-project')).videos as Record<string, unknown>[]
    expect('duration' in list[2]!).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('`promoVideo` and `videos` are INDEPENDENT', () => {
  it('emits both when both are set, and neither shadows the other', async () => {
    const p = await detail('both-project')
    expect(p.promoVideo).toEqual({
      youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
      duration: '1:00',
    })
    expect((p.videos as unknown[])).toHaveLength(1)
  })

  it('keeps `promoVideo` on the CARD payload while `videos` stays off it', async () => {
    const c = await card('both-project')
    expect(c.promoVideo).toBeDefined()
    expect('videos' in c).toBe(false)
  })

  it('emits `videos` without a `promoVideo` when only the list is set', async () => {
    const p = await detail('mixed-project')
    expect('promoVideo' in p).toBe(false)
    expect((p.videos as unknown[]).length).toBe(4)
  })
})

// ---------------------------------------------------------------------------
describe('per-entry both-or-nothing', () => {
  /**
   * Straight at the serialiser: the field `validate` refuses to SAVE these
   * rows, so they are unreachable through Payload — which is the point. This
   * exercises the serialiser's SECOND guard, the one that matters if a row
   * arrives from outside the admin or predates the validator.
   */
  const serialise = (videos: unknown[]) =>
    toPublicProject({
      slug: 's',
      name: 'n',
      category: 'Residential Plots',
      locality: 'l',
      summary: 's',
      description: ['d'],
      highlights: [],
      image: { filename: 'c.jpg', alt: 'C', width: 10, height: 10 },
      videos,
    } as never) as unknown as Record<string, unknown>

  it('DROPS a YouTube row with no poster but KEEPS the rest', () => {
    const out = serialise([
      { kind: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', title: 'No poster' },
      {
        kind: 'youtube',
        youtubeUrl: 'https://youtu.be/aqz-KE-bpKQ',
        poster: { filename: 'p.jpg', alt: 'P', width: 10, height: 10 },
        title: 'Fine',
      },
    ])
    expect((out.videos as { title?: string }[]).map((v) => v.title)).toEqual(['Fine'])
  })

  it('DROPS a video row whose relation was not populated (a bare id)', () => {
    const out = serialise([
      { kind: 'video', video: 'some-uuid', title: 'Unpopulated' },
      { kind: 'video', video: { filename: 'v.mp4', url: '/v.mp4' }, title: 'Fine' },
    ])
    expect((out.videos as { title?: string }[]).map((v) => v.title)).toEqual(['Fine'])
  })

  it('KEEPS an MP4 whose poster is unresolved — unlike the hero, it is optional here', () => {
    /* These panes carry native controls and the browser's own first frame, so a
       posterless video is still usable. The hero drops one because an autoplay
       pane with no still frame is all a metered device would ever see. */
    const out = serialise([
      { kind: 'video', video: { filename: 'v.mp4', url: '/v.mp4', title: 'T' } },
    ])
    const list = out.videos as Record<string, unknown>[]
    expect(list).toHaveLength(1)
    expect('poster' in list[0]!).toBe(false)
  })

  it('OMITS the key entirely when every row is unresolvable', () => {
    const out = serialise([{ kind: 'youtube', youtubeUrl: '', title: 'Nothing' }])
    expect('videos' in out).toBe(false)
  })

  it('DROPS a row with an unknown `kind` rather than guessing', () => {
    const out = serialise([
      { kind: 'image', video: { filename: 'v.mp4', url: '/v.mp4' } },
      { kind: 'video', video: { filename: 'w.mp4', url: '/w.mp4' }, title: 'Kept' },
    ])
    expect((out.videos as { title?: string }[]).map((v) => v.title)).toEqual(['Kept'])
  })

  it('DEDUPES identical entries, keeping the first', () => {
    const out = serialise([
      { kind: 'video', video: { filename: 'v.mp4', url: '/v.mp4' }, title: 'First' },
      { kind: 'video', video: { filename: 'v.mp4', url: '/v.mp4' }, title: 'Duplicate' },
    ])
    expect((out.videos as { title?: string }[]).map((v) => v.title)).toEqual(['First'])
  })
})

// ---------------------------------------------------------------------------
describe('ADMIN VALIDATION refuses an incoherent row', () => {
  it('refuses a `video` row with no uploaded video', async () => {
    await expect(
      mk('bad-video-row', { videos: [{ kind: 'video', title: 'No source' }] }),
    ).rejects.toThrow()
  })

  it('refuses a `youtube` row with no URL', async () => {
    await expect(
      mk('bad-yt-row', { videos: [{ kind: 'youtube', poster: posterId, title: 'No url' }] }),
    ).rejects.toThrow()
  })

  it('refuses a `youtube` row with no poster', async () => {
    await expect(
      mk('bad-yt-poster', {
        videos: [{ kind: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }],
      }),
    ).rejects.toThrow()
  })

  it('ACCEPTS an arbitrary number of rows — no artificial cap at one', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      kind: 'youtube' as const,
      youtubeUrl: `https://youtu.be/dQw4w9WgXc${String.fromCharCode(65 + i)}`,
      poster: posterId,
      title: `Row ${i + 1}`,
    }))
    const created = await mk('many-videos-project', { videos: many })
    expect((created.videos as unknown[]).length).toBe(8)

    const p = await detail('many-videos-project')
    expect((p.videos as unknown[]).length).toBe(8)
  })
})

// ---------------------------------------------------------------------------
describe('the field definition', () => {
  const videosField = () => {
    const projects = payload.config.collections.find((c) => c.slug === 'projects')!
    const flatten = (fields: unknown[]): Record<string, unknown>[] =>
      fields.flatMap((f) => {
        const field = f as { tabs?: { fields: unknown[] }[]; fields?: unknown[]; name?: string }
        if (field.tabs) return field.tabs.flatMap((t) => flatten(t.fields))
        if (field.name) return [field as Record<string, unknown>]
        if (field.fields) return flatten(field.fields)
        return []
      })
    return flatten(projects.fields).find((f) => f.name === 'videos')!
  }

  it('is an ARRAY, not a relation — a YouTube row has no document to point at', () => {
    const f = videosField()
    expect(f).toBeDefined()
    expect(f.type).toBe('array')
    expect(f.relationTo).toBeUndefined()
  })

  it('is not artificially limited to one row', () => {
    expect(Number(videosField().maxRows)).toBeGreaterThan(1)
  })

  it('carries an EXPLICIT `kind` discriminator with exactly two options', () => {
    const rows = (videosField().fields as { name?: string; options?: unknown[] }[]) ?? []
    const kind = rows.find((f) => f.name === 'kind')!
    expect(kind).toBeDefined()
    const values = (kind.options as { value: string }[]).map((o) => o.value).sort()
    // No 'image' — `gallery` already holds the photographs.
    expect(values).toEqual(['video', 'youtube'])
  })

  it('reuses the EXISTING `videos` and `media` collections, not a new upload path', () => {
    const rows = (videosField().fields as { name?: string; relationTo?: string }[]) ?? []
    expect(rows.find((f) => f.name === 'video')!.relationTo).toBe('videos')
    expect(rows.find((f) => f.name === 'poster')!.relationTo).toBe('media')
  })

  it('leaves `promoVideo` and `gallery` in place', () => {
    const projects = payload.config.collections.find((c) => c.slug === 'projects')!
    const names = JSON.stringify(projects.fields)
    expect(names).toContain('"name":"promoVideo"')
    expect(names).toContain('"name":"gallery"')
  })
})
