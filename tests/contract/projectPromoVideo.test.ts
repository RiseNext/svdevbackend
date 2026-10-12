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
 * `projects.promoVideo` — THE CONTRACT TESTS.
 *
 * 🔴 THE INVARIANT THAT PROTECTS THE LIVE WEBSITE. Four projects are published
 * in production with no promo video, and their API responses must stay
 * BYTE-IDENTICAL to before this field existed. Most of this file is therefore
 * regression rather than coverage — the same posture `projectLogo.test.ts`
 * takes, and for the same reason.
 *
 * 🔴 THE ONE WAY THIS FIELD DIFFERS FROM `logo`: it is emitted on BOTH the list
 * and the detail payload. The frontend's `projectVideo()` reads the detail
 * record then the list record, explicitly because "a backend adding the field
 * will not necessarily add it to both payloads — and which one it lands in is
 * not something this frontend should have to be redeployed to discover".
 */

let payload: Payload

const CTX = { skipAudit: true, skipRevalidate: true }

let coverId: string

const jpegBytes = async (w: number, h: number): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 20, g: 80, b: 50 } },
  })
    .jpeg()
    .toBuffer()
}

const baseProject = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  name: `Promo ${slug}`,
  category: 'Residential Plots' as const,
  locality: 'Testville',
  summary: 'A promo-video wiring test project.',
  description: ['Only paragraph.'],
  highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
  image: coverId,
  _status: 'published' as const,
  ...extra,
})

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)

  coverId = (
    await payload.create({
      collection: 'media',
      overrideAccess: true,
      file: { data: await jpegBytes(1200, 800), name: 'cover.jpg', mimetype: 'image/jpeg', size: 1 },
      data: { alt: 'Cover' },
      context: CTX,
    })
  ).id as string

  await payload.create({
    collection: 'projects',
    overrideAccess: true,
    data: baseProject('no-video-project') as never,
    context: CTX,
  })

  await payload.create({
    collection: 'projects',
    overrideAccess: true,
    data: baseProject('with-video-project', {
      promoVideo: {
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s',
        duration: '2:14',
      },
    }) as never,
    context: CTX,
  })

  await payload.create({
    collection: 'projects',
    overrideAccess: true,
    data: baseProject('url-only-project', {
      promoVideo: { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' },
    }) as never,
    context: CTX,
  })
})

const card = async (slug: string) => {
  const result = await publicFind({
    collection: 'projects',
    where: { slug: { equals: slug } },
    select: PUBLIC_PROJECT_CARD_SELECT,
    depth: 1,
  })
  return toPublicProjectCard(result.docs[0] as never)
}

const detail = async (slug: string) => {
  const doc = await publicFindOne({
    collection: 'projects',
    where: { slug: { equals: slug } },
    select: PUBLIC_PROJECT_SELECT,
    depth: 1,
  })
  return toPublicProject(doc as never)
}

// ---------------------------------------------------------------------------
describe('a project with NO promo video is unchanged', () => {
  it('OMITS the key from the DETAIL payload — not null, not {}', async () => {
    const project = await detail('no-video-project')
    /* 🔴 THE REGRESSION THIS PINS. A Payload group materialises as nullable
       columns, so an untouched group reads back as
       `{youtubeUrl: null, duration: null}` — an OBJECT, not undefined.
       Emitting it would put `promoVideo: {youtubeUrl: null}` on all four live
       projects and hand a null to `youtubeId()` on every homepage card. */
    expect('promoVideo' in project).toBe(false)
  })

  it('OMITS the key from the CARD payload too', async () => {
    expect('promoVideo' in (await card('no-video-project'))).toBe(false)
  })

  it('still carries every pre-existing media field', async () => {
    const project = await detail('no-video-project')
    expect(project.image).toBeDefined()
    expect(Object.keys(project.image).sort()).toEqual(['alt', 'height', 'src', 'width'])
    expect(project.slug).toBe('no-video-project')
    expect(project.description).toEqual(['Only paragraph.'])
  })
})

// ---------------------------------------------------------------------------
describe('a project WITH a promo video', () => {
  it('emits it on the DETAIL endpoint', async () => {
    const project = await detail('with-video-project') as unknown as {
      promoVideo?: { youtubeUrl: string; duration?: string }
    }
    expect(project.promoVideo).toEqual({
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s',
      duration: '2:14',
    })
  })

  it('emits it on the LIST endpoint — the half `logo` deliberately does not', async () => {
    const row = (await card('with-video-project')) as unknown as {
      promoVideo?: { youtubeUrl: string; duration?: string }
    }
    expect(row.promoVideo).toEqual({
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s',
      duration: '2:14',
    })
  })

  it('stores the pasted URL VERBATIM — no id extraction, no normalisation', async () => {
    const project = (await detail('with-video-project')) as unknown as {
      promoVideo?: { youtubeUrl: string }
    }
    // The `&t=12s` tail survives. `youtubeId()` on the frontend is the single
    // arbiter of whether a link is playable.
    expect(project.promoVideo!.youtubeUrl).toContain('&t=12s')
  })

  it('omits `duration` when blank but keeps the URL', async () => {
    const project = (await detail('url-only-project')) as unknown as {
      promoVideo?: { youtubeUrl: string; duration?: string }
    }
    expect(project.promoVideo!.youtubeUrl).toBe('https://youtu.be/dQw4w9WgXcQ')
    expect('duration' in project.promoVideo!).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('the SELECT objects', () => {
  it('names `promoVideo` on the CARD select — forgetting this is the known bug', () => {
    /* `select` is include-mode: a field absent here is never QUERIED, the
       serialiser reads undefined, and the key is omitted with nothing in any
       log. That is exactly what kept `projects.brochure` invisible in
       production until it was added to its own select. */
    expect('promoVideo' in PUBLIC_PROJECT_CARD_SELECT).toBe(true)
  })

  it('inherits it on the DETAIL select via the spread', () => {
    expect('promoVideo' in PUBLIC_PROJECT_SELECT).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('the contract file is deliberately NOT widened', () => {
  it('keeps `promoVideo` out of the vendored byte-identical contract', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const dirname = path.dirname(fileURLToPath(import.meta.url))
    const contract = readFileSync(
      path.resolve(dirname, '../../src/types/frontend-contract.ts'),
      'utf8',
    )
    /* 🔶 Same rule as `logo`. `types/frontend-contract.ts` is byte-compared
       against `svfrontend/src/types/content.ts` by `check:drift`; the frontend
       declares this shape locally in `src/lib/projectVideo.ts` instead. Adding
       it here would fail the gate for a field the frontend already consumes
       without it. */
    expect(contract).not.toContain('promoVideo')
  })
})
