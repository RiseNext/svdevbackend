import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'

/**
 * STORAGE SAFETY — the documents in-use guard, and `sweepDeletedMedia`.
 *
 * Companion to `mediaInUseGuards.test.ts`, which covers `media` and `videos`.
 * Two things are pinned here:
 *
 * 1. 🔴 `documents` WAS THE LAST UNGUARDED UPLOAD COLLECTION. `media` had a
 *    delete guard AND a trash guard; `videos` had both; `documents` had
 *    NEITHER. Both of its reference sites (`projects.brochure`,
 *    `site-settings.masterPlan`) are `ON DELETE set null`, and a SOFT delete
 *    alone is enough to break them — Payload nulls any populated relation whose
 *    target carries `deletedAt`. So archiving the brochure PDF a live project
 *    linked to returned 200 and the "Download brochure" button silently
 *    disappeared from the public page.
 *
 * 2. 🔴 `sweepDeletedMedia` HAD NEVER DELETED ANYTHING. It passed `trash: false`
 *    to `payload.delete` against rows it had just selected with `trash: true`.
 *    `appendNonTrashedFilter` ANDs `deletedAt exists: false` into the lookup
 *    (deleteByID.js:50-54), `db.findOne` misses, and `NotFound` throws at :62 —
 *    BEFORE `beforeDelete` at :69. The guards never ran, nothing was removed,
 *    and the task still returned SUCCESS so the watchdog never flagged it.
 *
 * The storage plugin is inert in tests (`CLOUDINARY_CLOUD_NAME` is blank, so
 * `enabled: false` and no plugin hooks are registered). Everything asserted
 * here is our own code, so it reproduces faithfully.
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

let ipad = 0
const uploadImage = async (alt: string): Promise<string> => {
  const sharp = (await import('sharp')).default
  const data = await sharp({
    create: {
      width: 64 + (ipad % 7),
      height: 48,
      channels: 3,
      background: { r: 9, g: 60, b: 33 },
    },
  })
    .jpeg()
    .toBuffer()
  const doc = await payload.create({
    collection: 'media',
    overrideAccess: true,
    file: { data, name: `ss-img-${ipad++}.jpg`, mimetype: 'image/jpeg', size: data.length },
    data: { alt },
    context: CTX,
  })
  return String(doc.id)
}

/**
 * A structurally valid PDF. A truncated `%PDF-1.4 … %%EOF` stub is NOT enough:
 * `documentUploadGuard` sniffs magic bytes and Payload's own
 * `checkFileRestrictions` rejects it as "The following field is invalid: file".
 * Same fixture shape as `projectBrochure.test.ts`.
 */
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

let dpad = 0
const uploadPdf = async (title: string): Promise<string> => {
  const data = PDF
  const doc = await payload.create({
    collection: 'documents',
    overrideAccess: true,
    file: { data, name: `ss-doc-${dpad++}.pdf`, mimetype: 'application/pdf', size: data.length },
    data: { title },
    context: CTX,
  })
  return String(doc.id)
}

const clearSiteSettings = async () =>
  payload.updateGlobal({
    slug: 'site-settings',
    overrideAccess: true,
    data: {
      ...REQUIRED_SITE_FIELDS,
      heroVideos: [],
      heroMedia: [],
      logo: null,
      masterPlan: null,
    } as never,
    context: CTX,
  })

/** The HARD-delete path — `beforeDelete`. */
const delDoc = (id: string) =>
  payload.delete({ collection: 'documents', id, overrideAccess: true, context: CTX })

/** THE TRASH PATH — the one the Admin Panel's Delete button actually takes. */
const trashDoc = (id: string) =>
  payload.update({
    collection: 'documents',
    id,
    overrideAccess: true,
    context: CTX,
    data: { deletedAt: new Date('2026-10-12T00:00:00.000Z').toISOString() } as never,
  })

const makeProject = (slug: string, name: string, extra: Record<string, unknown>) =>
  payload.create({
    collection: 'projects',
    overrideAccess: true,
    context: CTX,
    data: {
      slug,
      name,
      category: 'Residential Plots',
      locality: 'Testville',
      summary: 'Storage safety test.',
      description: ['One.'],
      highlights: [{ icon: 'tree', title: 'H' }],
      _status: 'published',
      ...extra,
    } as never,
  })

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)
  await clearSiteSettings()
})

// ---------------------------------------------------------------------------

describe('documentDeleteGuard / documentTrashGuard — projects.brochure', () => {
  it('refuses BOTH paths while a project links the PDF, and names the project', async () => {
    const cover = await uploadImage('Brochure guard cover')
    const brochure = await uploadPdf('Guard brochure (PDF)')
    await makeProject('brochure-guard-project', 'Brochure Guard Project', { image: cover, brochure })

    await expect(delDoc(brochure)).rejects.toThrow(/still in use/i)
    await expect(delDoc(brochure)).rejects.toThrow(/Brochure Guard Project/)

    // 🔴 THE PATH THE ADMIN UI ACTUALLY TAKES, and the one that had no guard.
    await expect(trashDoc(brochure)).rejects.toThrow(/was not moved to trash/i)
  })
})

describe('documentDeleteGuard — site-settings.masterPlan', () => {
  it('refuses while Site Settings points at it, and releases once detached', async () => {
    await clearSiteSettings()
    const masterPlan = await uploadPdf('Master plan (PDF)')
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: { ...REQUIRED_SITE_FIELDS, masterPlan } as never,
      context: CTX,
    })

    await expect(delDoc(masterPlan)).rejects.toThrow(/still in use/i)
    await expect(delDoc(masterPlan)).rejects.toThrow(/master plan/i)
    await expect(trashDoc(masterPlan)).rejects.toThrow(/was not moved to trash/i)

    // The guard names a recoverable route — detaching — so prove it works.
    await clearSiteSettings()
    await expect(delDoc(masterPlan)).resolves.toBeTruthy()
  })
})

describe('documentDeleteGuard — an unreferenced PDF still deletes', () => {
  it('does not block an orphan', async () => {
    await clearSiteSettings()
    const orphan = await uploadPdf('Orphan (PDF)')
    await expect(delDoc(orphan)).resolves.toBeTruthy()
  })
})

// ---------------------------------------------------------------------------

describe('sweepDeletedMedia', () => {
  /** Older than MEDIA_GRACE_PERIOD_DAYS (30). */
  const expire = (collection: 'media' | 'documents' | 'videos', id: string) =>
    payload.update({
      collection,
      id,
      overrideAccess: true,
      context: CTX,
      data: { deletedAt: new Date(Date.now() - 60 * 864e5).toISOString() } as never,
    })

  const findById = (collection: 'media' | 'documents' | 'videos', id: string) =>
    payload.find({
      collection,
      where: { id: { equals: id } },
      overrideAccess: true,
      trash: true,
      limit: 1,
      depth: 0,
    })

  it('🔴 trash:false cannot find an archived row — this was the no-op', async () => {
    await clearSiteSettings()
    const orphan = await uploadImage('Sweep no-op')
    await expire('media', orphan)

    await expect(
      payload.delete({
        collection: 'media',
        id: orphan,
        overrideAccess: true,
        trash: false,
        context: CTX,
      }),
    ).rejects.toThrow(/Not Found/i)

    // Still there — exactly as it was for every row this job ever examined.
    expect((await findById('media', orphan)).totalDocs).toBe(1)
  })

  it('trash:true finds and removes it — the one-word fix', async () => {
    await clearSiteSettings()
    const orphan = await uploadImage('Sweep works')
    await expire('media', orphan)

    await expect(
      payload.delete({
        collection: 'media',
        id: orphan,
        overrideAccess: true,
        trash: true,
        context: CTX,
      }),
    ).resolves.toBeTruthy()

    expect((await findById('media', orphan)).totalDocs).toBe(0)
  })

  it('the in-use guard still fires on the sweeper path, so a re-attached asset survives', async () => {
    /**
     * This is why the sweeper no longer keeps its own list of reference sites.
     * `payload.delete` runs `beforeDelete` regardless of `overrideAccess`
     * (deleteByID.js:69-79), so `mediaDeleteGuard` is the single definition of
     * "in use" and the sweeper cannot drift from it. The old hand-rolled
     * re-check omitted five reference sites and covered only `media`.
     */
    await clearSiteSettings()
    const cover = await uploadImage('Sweep in use')
    await makeProject('sweep-inuse-project', 'Sweep In-Use Project', { image: cover })

    // `mediaDeleteGuard` has two refusal strings; a published project's cover
    // gets the stronger one ("is the cover of a PUBLISHED project"), so match
    // either rather than pinning the weaker wording.
    await expect(
      payload.delete({
        collection: 'media',
        id: cover,
        overrideAccess: true,
        trash: true,
        context: CTX,
      }),
    ).rejects.toThrow(/still in use|cannot be deleted/i)

    expect((await findById('media', cover)).totalDocs).toBe(1)
  })

  it('runs DISARMED by default: reports candidates, deletes nothing', async () => {
    await clearSiteSettings()
    const orphan = await uploadImage('Sweep disarmed')
    await expire('media', orphan)

    const { sweepDeletedMedia } = await import('@/jobs')
    const { env } = await import('@/lib/env')

    // The shipped default. Asserted rather than assumed — if `.env.test` ever
    // arms the sweep this test would silently stop testing anything.
    expect(env.MEDIA_SWEEP_ENABLED).toBe(false)

    const result = await (
      sweepDeletedMedia.handler as unknown as (a: {
        req: unknown
      }) => Promise<{ output: { swept: number } }>
    )({ req: { payload } })

    expect(result.output.swept).toBe(0)
    expect(
      (await findById('media', orphan)).totalDocs,
      'a disarmed sweep must not delete anything',
    ).toBe(1)
  })
})
