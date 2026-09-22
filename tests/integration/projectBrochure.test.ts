import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { toPublicProject } from '@/serializers/toPublicProject'
import { PUBLIC_PROJECT_SELECT } from '@/serializers/toPublicProject'

/**
 * `projects.brochure` — ONE PDF, taken from the EXISTING `documents` collection.
 *
 * 🔴 WHAT THIS FIELD IS NOT. The public contract's
 * `brochureImages?: readonly ImageRef[]` (types/content.ts:98) is scanned
 * brochure PAGES AS IMAGES and stays deferred. This is a single PDF DOCUMENT
 * reference — a different artefact with a different render story.
 *
 * 🔴 THE INVARIANT THAT PROTECTS THE LIVE WEBSITE. The field is admin-only for
 * now: `toPublicProject()` builds its output from an explicit allow-list and
 * `PUBLIC_PROJECT_SELECT` does not name `brochure`, so the public API response
 * is BYTE-IDENTICAL to before the field existed and `types/content.ts` needs no
 * change. The last two cases below pin that, because the moment `brochure`
 * leaks into the serialiser the two repos' contracts silently diverge and the
 * drift check is the only thing standing between that and a broken build.
 */

let payload: Payload

const PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
    'endobj',
    'xref',
    '0 4',
    '0000000000 65535 f ',
    'trailer',
    '<< /Size 4 /Root 1 0 R >>',
    'startxref',
    '0',
    '%%EOF',
    '',
  ].join('\n'),
)

/** A tiny valid JPEG, because `projects.image` is required. */
const jpegBytes = async (): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 20, g: 80, b: 50 } },
  })
    .jpeg()
    .toBuffer()
}

let coverId: string
let brochureId: string
let secondBrochureId: string

const CTX = { skipAudit: true, skipRevalidate: true }

const baseProject = (slug: string) => ({
  slug,
  name: `Brochure ${slug}`,
  category: 'Residential Plots' as const,
  locality: 'Testville',
  summary: 'A brochure wiring test project.',
  description: ['Only paragraph.'],
  highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
  image: coverId,
})

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)

  const cover = await payload.create({
    collection: 'media',
    overrideAccess: true,
    file: { data: await jpegBytes(), name: 'cover.jpg', mimetype: 'image/jpeg', size: 0 },
    data: { alt: 'Cover' },
    context: CTX,
  })
  coverId = cover.id as string

  const doc = await payload.create({
    collection: 'documents',
    overrideAccess: true,
    file: { data: PDF, name: 'brochure.pdf', mimetype: 'application/pdf', size: PDF.byteLength },
    data: { title: 'Project brochure (PDF)' },
    context: CTX,
  })
  brochureId = doc.id as string

  const doc2 = await payload.create({
    collection: 'documents',
    overrideAccess: true,
    file: { data: PDF, name: 'brochure-2.pdf', mimetype: 'application/pdf', size: PDF.byteLength },
    data: { title: 'Replacement brochure (PDF)' },
    context: CTX,
  })
  secondBrochureId = doc2.id as string
})

describe('projects.brochure references the existing documents collection', () => {
  it('the field is an upload pointing ONLY at `documents`, and is single-valued', async () => {
    const projects = payload.config.collections.find((c) => c.slug === 'projects')!
    const flatten = (fields: unknown[]): Record<string, unknown>[] =>
      fields.flatMap((f) => {
        const field = f as { tabs?: { fields: unknown[] }[]; fields?: unknown[]; name?: string }
        if (field.tabs) return field.tabs.flatMap((t) => flatten(t.fields))
        if (field.name) return [field as Record<string, unknown>]
        if (field.fields) return flatten(field.fields)
        return []
      })

    const brochure = flatten(projects.fields).find((f) => f.name === 'brochure')
    expect(brochure, 'projects.brochure must exist').toBeDefined()
    expect(brochure!.type).toBe('upload')
    // ONLY documents — never `media`, and never polymorphic.
    expect(brochure!.relationTo).toBe('documents')
    // One brochure per project, enforced by the schema rather than a validator.
    expect(brochure!.hasMany).toBeFalsy()
  })

  it('a project can be created with one brochure and reads back populated', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: { ...baseProject('brochure-create'), brochure: brochureId },
      context: CTX,
    })
    expect(created.id).toBeTruthy()

    const read = await payload.findByID({
      collection: 'projects',
      id: created.id,
      depth: 1,
      overrideAccess: true,
    })
    const doc = read.brochure as { id?: string; filename?: string; title?: string; url?: string } | string
    expect(typeof doc === 'object' && doc !== null, 'brochure should populate at depth 1').toBe(true)
    expect((doc as { id?: string }).id).toBe(brochureId)

    // ⚠️ The populated shape is PINNED by `documents.defaultPopulate`
    // (`{ filename, url, title }`) — so `mimeType` is deliberately absent here
    // and asserting it would be asserting a bug. `title` is the proof of which
    // collection answered: `documents` has `title`, `media` has `alt`.
    expect((doc as { title?: string }).title).toBe('Project brochure (PDF)')
    expect((doc as { filename?: string }).filename).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    expect((doc as { url?: string }).url).toBeTruthy()
  })

  it('the SAME document can be shared by two projects — no duplicated PDF', async () => {
    // The whole point of referencing `documents` by id rather than re-uploading.
    const a = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: { ...baseProject('brochure-share-a'), brochure: brochureId },
      context: CTX,
    })
    const b = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: { ...baseProject('brochure-share-b'), brochure: brochureId },
      context: CTX,
    })
    expect(a.brochure).toBeTruthy()
    expect(b.brochure).toBeTruthy()

    const docs = await payload.find({ collection: 'documents', overrideAccess: true, limit: 100 })
    // Two fixtures created in beforeAll, and not one more.
    expect(docs.totalDocs).toBe(2)
  })

  it('the brochure can be replaced and cleared', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: { ...baseProject('brochure-swap'), brochure: brochureId },
      context: CTX,
    })

    const swapped = await payload.update({
      collection: 'projects',
      id: created.id,
      overrideAccess: true,
      data: { brochure: secondBrochureId },
      context: CTX,
    })
    expect(swapped.brochure).toBeTruthy()

    const cleared = await payload.update({
      collection: 'projects',
      id: created.id,
      overrideAccess: true,
      data: { brochure: null },
      context: CTX,
    })
    expect(cleared.brochure ?? null).toBeNull()
  })

  it('is OPTIONAL — a project still saves and publishes without one', async () => {
    // Protects every existing project: 5 live rows have no brochure and must
    // keep publishing exactly as before.
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...baseProject('brochure-absent'), _status: 'published' },
      context: CTX,
    })
    expect(created._status).toBe('published')
    expect(created.brochure ?? null).toBeNull()
  })

  it('rejects a `media` id — the relation is closed to documents', async () => {
    await expect(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        draft: true,
        data: { ...baseProject('brochure-wrong-coll'), brochure: coverId },
        context: CTX,
      }),
    ).rejects.toThrow()
  })
})

describe('projects.brochure is NOT in the public contract yet', () => {
  it('PUBLIC_PROJECT_SELECT does not request it', () => {
    expect(Object.keys(PUBLIC_PROJECT_SELECT)).not.toContain('brochure')
  })

  it('toPublicProject() emits no brochure key, even when one is set', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...baseProject('brochure-not-public'), brochure: brochureId, _status: 'published' },
      context: CTX,
    })
    const full = await payload.findByID({
      collection: 'projects',
      id: created.id,
      depth: 2,
      overrideAccess: true,
    })

    const publicShape = toPublicProject(full as never)
    expect('brochure' in (publicShape as Record<string, unknown>)).toBe(false)
    // And nothing PDF-shaped leaked in under another name.
    expect(JSON.stringify(publicShape)).not.toMatch(/\.pdf/i)
    // The fields the website does rely on are still all present.
    expect(publicShape.slug).toBe('brochure-not-public')
    expect(publicShape.image).toBeTruthy()
  })
})
