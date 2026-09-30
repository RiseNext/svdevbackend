import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import {
  PUBLIC_PROJECT_CARD_SELECT,
  PUBLIC_PROJECT_SELECT,
  toPublicProject,
  toPublicProjectCard,
} from '@/serializers/toPublicProject'

/**
 * `projects.logo` — the project's own logo, from the EXISTING `media` collection.
 *
 * 🔴 WHAT THIS FIELD IS FOR. The deployed frontend draws a plate across the
 * top-right corner of every project card on the homepage deck and fills it from
 * `logo` on the DETAIL endpoint (`app/page.tsx` enriches each card with
 * `getProject(slug)`). Until this field existed the plate rendered empty.
 *
 * 🔴 THE INVARIANT THAT PROTECTS THE LIVE WEBSITE, AND WHY MOST OF THIS FILE IS
 * REGRESSION RATHER THAN COVERAGE. Six projects are live in production with
 * `logo_id IS NULL`, and their API responses must be BYTE-IDENTICAL to before
 * this field existed. `put()` omits absent optionals, so an unset logo produces
 * NO `logo` key — not `null`, not `{}`. The cases below pin that in both
 * directions, and pin every existing media field alongside it.
 *
 * 🔶 `logo` IS DELIBERATELY ABSENT FROM `types/frontend-contract.ts`. That file
 * is vendored into both repositories and `check:drift` asserts the two copies
 * are byte-identical; the frontend reads `logo` through a local widened type and
 * says in two places that the shared contract is left alone on purpose. Adding
 * it here would fail the drift gate for a field the frontend already consumes
 * without it. A test below pins that absence so nobody "fixes" it.
 */

let payload: Payload

const CTX = { skipAudit: true, skipRevalidate: true }

/** Distinct sizes per role, so a swapped field is visible as wrong dimensions. */
const pngBytes = async (w: number, h: number): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer()
}

const webpBytes = async (w: number, h: number): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .webp()
    .toBuffer()
}

const jpegBytes = async (w: number, h: number): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 20, g: 80, b: 50 } },
  })
    .jpeg()
    .toBuffer()
}

let coverId: string
let galleryAId: string
let layoutId: string
let logoPngId: string
let logoWebpId: string

const baseProject = (slug: string) => ({
  slug,
  name: `Logo ${slug}`,
  category: 'Residential Plots' as const,
  locality: 'Testville',
  summary: 'A logo wiring test project.',
  description: ['Only paragraph.'],
  highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
  image: coverId,
})

const readFull = async (id: string) =>
  payload.findByID({ collection: 'projects', id, depth: 2, overrideAccess: true })

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)

  const upload = async (data: Buffer, name: string, mimetype: string, alt: string) =>
    (
      await payload.create({
        collection: 'media',
        overrideAccess: true,
        file: { data, name, mimetype, size: data.byteLength },
        data: { alt },
        context: CTX,
      })
    ).id as string

  coverId = await upload(await jpegBytes(1200, 800), 'cover.jpg', 'image/jpeg', 'Cover')
  galleryAId = await upload(await jpegBytes(640, 480), 'gal-a.jpg', 'image/jpeg', 'Gallery A')
  layoutId = await upload(await pngBytes(900, 1200), 'layout.png', 'image/png', 'Layout plan')
  // 512x218 — the wordmark proportion the card's plate is drawn for.
  logoPngId = await upload(await pngBytes(512, 218), 'logo.png', 'image/png', 'Sri Vanam')
  logoWebpId = await upload(await webpBytes(480, 480), 'logo.webp', 'image/webp', 'Square mark')
})

// ---------------------------------------------------------------------------
describe('projects.logo — the field', () => {
  it('is an OPTIONAL upload pointing only at `media`, and is single-valued', () => {
    const projects = payload.config.collections.find((c) => c.slug === 'projects')!
    const flatten = (fields: unknown[]): Record<string, unknown>[] =>
      fields.flatMap((f) => {
        const field = f as { tabs?: { fields: unknown[] }[]; fields?: unknown[]; name?: string }
        if (field.tabs) return field.tabs.flatMap((t) => flatten(t.fields))
        if (field.name) return [field as Record<string, unknown>]
        if (field.fields) return flatten(field.fields)
        return []
      })

    const logo = flatten(projects.fields).find((f) => f.name === 'logo')
    expect(logo, 'projects.logo must exist').toBeDefined()
    expect(logo!.type).toBe('upload')
    // The SAME collection as `image`, so it inherits that upload pipeline and
    // its SVG rejection rather than declaring a second one.
    expect(logo!.relationTo).toBe('media')
    expect(logo!.hasMany).toBeFalsy()
    // 🔴 NEVER required — six live projects have none.
    expect(logo!.required).toBeFalsy()
    expect(logo!.label).toBe('Logo')
  })

  it('sits next to `image` in the Media tab, before `gallery`', () => {
    const projects = payload.config.collections.find((c) => c.slug === 'projects')!
    const tabs = (projects.fields as { tabs?: { label?: string; fields: { name?: string }[] }[] }[])
      .flatMap((f) => f.tabs ?? [])
    const media = tabs.find((t) => t.label === 'Media')!
    const names = media.fields.map((f) => f.name)
    expect(names).toContain('logo')
    expect(names.indexOf('logo')).toBe(names.indexOf('image') + 1)
    expect(names.indexOf('logo')).toBeLessThan(names.indexOf('gallery'))
  })

  it('a project saves and PUBLISHES without a logo — the live-data case', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...baseProject('logo-absent'), _status: 'published' },
      context: CTX,
    })
    expect(created._status).toBe('published')
    expect(created.logo ?? null).toBeNull()
  })

  it('accepts a PNG logo and populates it at depth 1', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: { ...baseProject('logo-png'), logo: logoPngId },
      context: CTX,
    })
    const read = await payload.findByID({
      collection: 'projects',
      id: created.id,
      depth: 1,
      overrideAccess: true,
    })
    const doc = read.logo as { id?: string; width?: number; height?: number; alt?: string }
    expect(typeof doc === 'object' && doc !== null, 'logo should populate at depth 1').toBe(true)
    expect(doc.id).toBe(logoPngId)
    // `alt` proves `media` answered, not `documents` (which has `title`).
    expect(doc.alt).toBe('Sri Vanam')
    expect(doc.width).toBe(512)
    expect(doc.height).toBe(218)
  })

  it('accepts a WebP logo', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: { ...baseProject('logo-webp'), logo: logoWebpId },
      context: CTX,
    })
    expect(created.logo).toBeTruthy()
  })

  it('can be replaced and cleared', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: { ...baseProject('logo-swap'), logo: logoPngId },
      context: CTX,
    })
    const swapped = await payload.update({
      collection: 'projects',
      id: created.id,
      overrideAccess: true,
      data: { logo: logoWebpId },
      context: CTX,
    })
    expect(swapped.logo).toBeTruthy()

    const cleared = await payload.update({
      collection: 'projects',
      id: created.id,
      overrideAccess: true,
      data: { logo: null },
      context: CTX,
    })
    expect(cleared.logo ?? null).toBeNull()
  })

  it('the SAME media row can be the logo of two projects — nothing is duplicated', async () => {
    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: { ...baseProject('logo-share-a'), logo: logoPngId },
      context: CTX,
    })
    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: { ...baseProject('logo-share-b'), logo: logoPngId },
      context: CTX,
    })
    const media = await payload.find({ collection: 'media', overrideAccess: true, limit: 100 })
    // Exactly the five fixtures from beforeAll, and not one more.
    expect(media.totalDocs).toBe(5)
  })
})

// ---------------------------------------------------------------------------
describe('projects.logo — SVG stays rejected by the EXISTING media guard', () => {
  /**
   * 🔴 NO LOGO-SPECIFIC GUARD EXISTS, AND THAT IS THE DESIGN. `logo` uploads to
   * `media`, whose collection-level `mimeTypes` allow-list and magic-byte
   * `imageUploadGuard` already refuse SVG. This case proves the inherited
   * protection actually fires on the path a logo would take, so the reuse claim
   * is measured rather than asserted.
   */
  it('refuses an SVG upload with the SVG message', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="218"><script>alert(1)</script></svg>',
    )
    await expect(
      payload.create({
        collection: 'media',
        overrideAccess: true,
        file: { data: svg, name: 'logo.svg', mimetype: 'image/svg+xml', size: svg.byteLength },
        data: { alt: 'Hostile logo' },
        context: CTX,
      }),
    ).rejects.toThrow(/SVG/i)
  })

  it('refuses a file whose bytes are not the image type it claims', async () => {
    const liar = Buffer.from('this is plainly not a png')
    await expect(
      payload.create({
        collection: 'media',
        overrideAccess: true,
        file: { data: liar, name: 'logo.png', mimetype: 'image/png', size: liar.byteLength },
        data: { alt: 'Liar' },
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('the media allow-list still excludes SVG and still admits png + webp', () => {
    const media = payload.config.collections.find((c) => c.slug === 'media')!
    const mimeTypes = (media.upload as { mimeTypes?: string[] }).mimeTypes ?? []
    expect(mimeTypes).toContain('image/png')
    expect(mimeTypes).toContain('image/webp')
    expect(mimeTypes).not.toContain('image/svg+xml')
    expect(mimeTypes.some((m) => m.includes('*'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('projects.logo — the public detail contract', () => {
  it('PUBLIC_PROJECT_SELECT requests it, so the relation populates', () => {
    // Without this the serialiser receives a bare id and `toImageRef` throws
    // UnpopulatedUploadError rather than emitting a broken image.
    expect(Object.keys(PUBLIC_PROJECT_SELECT)).toContain('logo')
  })

  it('emits EXACTLY { src, alt, width, height } when a logo is set', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...baseProject('logo-public'), logo: logoPngId, _status: 'published' },
      context: CTX,
    })
    const shape = toPublicProject((await readFull(created.id as string)) as never) as Record<
      string,
      unknown
    >
    const logo = shape.logo as { src: string; alt: string; width: number; height: number }

    expect(logo, 'logo must be emitted when set').toBeDefined()
    // ALL FOUR KEYS, AND ONLY THOSE FOUR.
    expect(Object.keys(logo).sort()).toEqual(['alt', 'height', 'src', 'width'])
    expect(typeof logo.src).toBe('string')
    expect(logo.src.length).toBeGreaterThan(0)
    expect(logo.alt).toBe('Sri Vanam')
    // Real intrinsic dimensions, as integers — the card reserves space from them.
    expect(Number.isInteger(logo.width)).toBe(true)
    expect(Number.isInteger(logo.height)).toBe(true)
    expect(logo.width).toBe(512)
    expect(logo.height).toBe(218)
  })

  it('OMITS the key entirely when no logo is set — never null, never {}', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...baseProject('logo-public-absent'), _status: 'published' },
      context: CTX,
    })
    const shape = toPublicProject((await readFull(created.id as string)) as never) as Record<
      string,
      unknown
    >

    expect('logo' in shape).toBe(false)
    expect(JSON.stringify(shape)).not.toMatch(/"logo"/)
    // And the fields the website already relies on are untouched.
    expect(shape.slug).toBe('logo-public-absent')
    expect(shape.image).toBeTruthy()
  })

  /**
   * 🔴 AN UNPOPULATED LOGO THROWS — IT DOES NOT SILENTLY OMIT, AND THAT IS THE
   * EXISTING BEHAVIOUR BEING REUSED RATHER THAN A CHOICE MADE HERE.
   *
   * `toImageRefOrUndefined` returns `undefined` ONLY for `null`/`undefined`,
   * i.e. "the editor set no logo". A BARE ID STRING means something different:
   * the field IS set but the query forgot to select or populate it. Guessing at
   * that point would put a broken image in the card plate with no error
   * anywhere, so `toImageRef` throws `UnpopulatedUploadError` loudly instead.
   *
   * It cannot happen through the real route — `PUBLIC_PROJECT_SELECT` names
   * `logo` and the handler reads at `depth: 1` — so this is a guard against a
   * future mis-selection, not a live path.
   *
   * The assertion is PARITY WITH `layoutImage`, because "reuses the existing
   * mechanism" is the actual requirement and identical failure behaviour is how
   * that is proven.
   */
  const depthZeroDoc = (field: 'logo' | 'layoutImage') =>
    ({
      slug: 'depth-zero',
      name: 'depth-zero',
      category: 'Residential Plots',
      locality: 'Testville',
      summary: 'x',
      description: ['x'],
      highlights: [],
      image: { filename: 'a.jpg', alt: 'a', width: 1, height: 1 },
      [field]: logoPngId,
    }) as never

  it('THROWS on an unpopulated logo, exactly as an unpopulated layoutImage does', () => {
    expect(() => toPublicProject(depthZeroDoc('logo'))).toThrow(/was not populated/i)
    // The existing field, for comparison — same helper, same failure.
    expect(() => toPublicProject(depthZeroDoc('layoutImage'))).toThrow(/was not populated/i)
  })

  it('names the offending field in the error, so the cause is obvious', () => {
    expect(() => toPublicProject(depthZeroDoc('logo'))).toThrow(/"logo"/)
  })

  it('an explicit null logo is OMITTED, not thrown — that is the editor case', () => {
    const shape = toPublicProject({
      slug: 'null-logo',
      name: 'null-logo',
      category: 'Residential Plots',
      locality: 'Testville',
      summary: 'x',
      description: ['x'],
      highlights: [],
      image: { filename: 'a.jpg', alt: 'a', width: 1, height: 1 },
      logo: null,
    } as never) as Record<string, unknown>
    expect('logo' in shape).toBe(false)
  })

  it('is NOT on the list endpoint — that optimisation is a separate task', () => {
    // Pinned so adding it later is a deliberate decision with a failing test,
    // not an accident. The homepage enriches cards via the DETAIL endpoint.
    expect(Object.keys(PUBLIC_PROJECT_CARD_SELECT)).not.toContain('logo')
  })

  it('the list serialiser emits no logo even when the doc carries one', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...baseProject('logo-list'), logo: logoPngId, _status: 'published' },
      context: CTX,
    })
    const card = toPublicProjectCard(
      (await readFull(created.id as string)) as never,
    ) as Record<string, unknown>
    expect('logo' in card).toBe(false)
  })

  it('`logo` is NOT in the vendored frontend contract, and must not be added', async () => {
    // The contract file is byte-identical across both repos and check:drift
    // enforces it. The frontend reads `logo` through its own local type on
    // purpose. Adding it here breaks the gate for zero gain.
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const contract = readFileSync(
      path.resolve(process.cwd(), 'src/types/frontend-contract.ts'),
      'utf8',
    )
    const projectBlock = contract.slice(
      contract.indexOf('export type Project'),
      contract.indexOf('export type ProjectCard'),
    )
    expect(projectBlock.length).toBeGreaterThan(0)
    expect(projectBlock).not.toMatch(/^\s*logo\??:/m)
  })
})

// ---------------------------------------------------------------------------
describe('REGRESSION — every existing project field is unchanged by `logo`', () => {
  /**
   * 🔴 THE POINT OF THIS BLOCK. One project is built with EVERY media role plus
   * a logo, and one identical project without the logo. Each existing field is
   * asserted on the logo-bearing record, and then the two serialised responses
   * are diffed: the ONLY permitted difference is the presence of the `logo` key.
   * That is a stronger statement than checking the fields one at a time, because
   * it also catches a field that silently disappeared.
   */
  let withLogo: Record<string, unknown>
  let withoutLogo: Record<string, unknown>

  beforeAll(async () => {
    const full = {
      category: 'Residential Plots' as const,
      locality: 'Testville',
      summary: 'Regression project.',
      description: ['Para one.', 'Para two.'],
      highlights: [
        { icon: 'tree' as const, title: 'Highlight one' },
        { icon: 'road' as const, title: 'Highlight two' },
      ],
      amenities: [{ icon: 'droplet' as const, title: 'Amenity' }],
      approvals: [{ icon: 'shield' as const, title: 'DTCP' }],
      locationHighlights: [{ icon: 'compass' as const, title: 'Near somewhere' }],
      stats: [{ label: 'Extent', value: '6 Acres' }],
      proximity: [{ icon: 'bus' as const, measure: '12 km', place: 'Aler' }],
      area: '6 Acres 22.50 Guntas',
      roadDetails: "60' & 30' wide BT roads",
      tagline: 'A tagline',
      developer: 'SV Developers',
      image: coverId,
      gallery: [galleryAId],
      layoutImage: layoutId,
    }

    const a = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...full, slug: 'regress-with-logo', name: 'Regress With Logo', logo: logoPngId, _status: 'published' },
      context: CTX,
    })
    const b = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...full, slug: 'regress-no-logo', name: 'Regress No Logo', _status: 'published' },
      context: CTX,
    })

    withLogo = toPublicProject((await readFull(a.id as string)) as never) as Record<string, unknown>
    withoutLogo = toPublicProject((await readFull(b.id as string)) as never) as Record<string, unknown>
  })

  it('image is unchanged — four keys, real dimensions', () => {
    const image = withLogo.image as Record<string, number | string>
    expect(Object.keys(image).sort()).toEqual(['alt', 'height', 'src', 'width'])
    expect(image.width).toBe(1200)
    expect(image.height).toBe(800)
  })

  it('gallery is unchanged — an array of ImageRef', () => {
    const gallery = withLogo.gallery as Record<string, unknown>[]
    expect(Array.isArray(gallery)).toBe(true)
    expect(gallery).toHaveLength(1)
    expect(Object.keys(gallery[0]!).sort()).toEqual(['alt', 'height', 'src', 'width'])
  })

  it('layoutImage is unchanged', () => {
    const layout = withLogo.layoutImage as Record<string, number>
    expect(Object.keys(layout).sort()).toEqual(['alt', 'height', 'src', 'width'])
    expect(layout.width).toBe(900)
    expect(layout.height).toBe(1200)
  })

  it('description and highlights are unchanged', () => {
    expect(withLogo.description).toEqual(['Para one.', 'Para two.'])
    const highlights = withLogo.highlights as { icon: string; title: string }[]
    expect(highlights).toHaveLength(2)
    expect(highlights[0]).toEqual({ icon: 'tree', title: 'Highlight one' })
  })

  it('brochure stays ABSENT when none is attached — logo did not disturb it', () => {
    expect('brochure' in withLogo).toBe(false)
  })

  it('locationMap stays ABSENT when none is attached', () => {
    expect('locationMap' in withLogo).toBe(false)
  })

  it('the ONLY difference between the two responses is the `logo` key', () => {
    const a = new Set(Object.keys(withLogo))
    const b = new Set(Object.keys(withoutLogo))
    const onlyInA = [...a].filter((k) => !b.has(k))
    const onlyInB = [...b].filter((k) => !a.has(k))

    expect(onlyInA).toEqual(['logo'])
    expect(onlyInB).toEqual([])

    // And every shared key serialises identically apart from the two that
    // legitimately differ per record.
    for (const key of [...a].filter((k) => b.has(k) && k !== 'slug' && k !== 'name')) {
      expect(JSON.stringify(withLogo[key]), `${key} must be unchanged`).toBe(
        JSON.stringify(withoutLogo[key]),
      )
    }
  })

  it('an unknown slug still resolves to nothing — the 404 precondition', async () => {
    const found = await payload.find({
      collection: 'projects',
      overrideAccess: false,
      user: undefined,
      where: { and: [{ _status: { equals: 'published' } }, { slug: { equals: 'no-such-project-xyz' } }] },
      limit: 1,
    })
    // The route turns "no doc" into 404, never 403.
    expect(found.docs).toHaveLength(0)
  })
})
