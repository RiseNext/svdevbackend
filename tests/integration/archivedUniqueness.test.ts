import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { archiveDocument } from '@/hooks/hardDeleteGuard'

/**
 * D-8 — ARCHIVED RECORDS MUST NOT HOLD A BUSINESS KEY HOSTAGE.
 *
 * 🔴 THE DEFECT. `faqs.question`, `projects.slug`, `blog-posts.slug` and
 * `statistics.label` are declared `unique: true`, which Payload realises as a
 * PLAIN `CREATE UNIQUE INDEX` over the whole table. `trash: true` is a SOFT
 * delete — the row stays, with `deleted_at` set — so an archived FAQ keeps
 * owning its question text forever. An administrator who archives
 * "What are the payment terms?" and then writes it again is refused, and the
 * record blocking them is invisible in the default list view.
 *
 * `Faqs.ts` even documents the symptom ("an archived FAQ keeps owning its text
 * and the only way to free it is to find and restore (or purge) that row") —
 * but `faqs` ALSO refuses nothing on hard delete, so purging is possible there.
 * For `projects` it is a genuine dead end: `blockProjectHardDelete` refuses the
 * permanent delete, so the slug can never be freed through the panel at all.
 *
 * THE FIX is a partial unique index — `WHERE deleted_at IS NULL` — which
 * constrains exactly the active rows and ignores archived ones. See
 * `src/migrations/20261013_000000_partial_unique_active_only.ts`.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT CHANGE. `media.filename`,
 * `documents.filename` and `videos.filename` are ALSO unique indexes on
 * trash-enabled collections, and they are deliberately LEFT PLAIN. Those names
 * are not business keys — they are storage addresses. An archived media row's
 * file is still in Cloudinary (that is the entire point of the soft delete, and
 * `sweepDeletedMedia` is what eventually removes it), so freeing the filename
 * would let a new upload collide with a byte stream that still exists. The
 * uniqueness there protects the asset, not the row. See the migration's note.
 */

let payload: Payload

const CTX = { skipAudit: true, skipRevalidate: true }

let pad = 0
const uploadCover = async (alt: string): Promise<string> => {
  const sharp = (await import('sharp')).default
  const data = await sharp({
    create: {
      width: 70 + (pad++ % 5),
      height: 52,
      channels: 3,
      background: { r: 9, g: 60, b: 33 },
    },
  })
    .jpeg()
    .toBuffer()
  const doc = await payload.create({
    collection: 'media',
    overrideAccess: true,
    file: { data, name: `uniq-fixture-${pad}.jpg`, mimetype: 'image/jpeg', size: data.byteLength },
    data: { alt },
    context: CTX,
  })
  return String(doc.id)
}

const makeProject = (slug: string, cover: string) => ({
  name: `Uniqueness ${slug}`,
  slug,
  category: 'Residential Plots',
  locality: 'Testville',
  summary: 'Pins active-only uniqueness.',
  description: ['Only paragraph.'],
  highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
  image: cover,
})

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)
})

// ---------------------------------------------------------------------------

describe('the index itself is partial, and only on the business keys', () => {
  /**
   * Read from `pg_indexes` rather than inferred from behaviour, because the
   * behavioural tests below would also pass if someone simply removed
   * `unique: true` — which would be a silent loss of the active-row
   * constraint. This assertion distinguishes "partial" from "absent".
   */
  const defOf = async (index: string): Promise<string> => {
    const { sql } = await import('@payloadcms/db-postgres/drizzle')
    const result = await payload.db.drizzle.execute(
      sql.raw(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='${index}'`),
    )
    const rows = (result as unknown as { rows?: { indexdef: string }[] }).rows ?? []
    return rows[0]?.indexdef ?? ''
  }

  it.each([
    ['projects_slug_idx', 'slug'],
    ['blog_posts_slug_idx', 'slug'],
    ['faqs_question_idx', 'question'],
    ['statistics_label_idx', 'label'],
  ])('%s is UNIQUE and partial on deleted_at IS NULL', async (index, column) => {
    const def = await defOf(index)
    expect(def, `${index} must still exist`).toBeTruthy()
    expect(def, `${index} must still be UNIQUE`).toMatch(/CREATE UNIQUE INDEX/)
    expect(def, `${index} must cover ${column}`).toContain(column)
    expect(def, `${index} must be partial on the active rows`).toMatch(
      /WHERE \(?deleted_at IS NULL\)?/i,
    )
  })

  /**
   * The deliberate exclusions. A future change that "finishes the job" by
   * making these partial too would re-open the storage-collision hole, so the
   * decision is pinned as a test rather than left as a comment.
   */
  it.each(['media_filename_idx', 'documents_filename_idx', 'videos_filename_idx'])(
    '%s stays a PLAIN unique index — a filename is a storage address, not a business key',
    async (index) => {
      const def = await defOf(index)
      expect(def, `${index} must still exist`).toBeTruthy()
      expect(def).toMatch(/CREATE UNIQUE INDEX/)
      expect(def, `${index} must NOT be partial`).not.toMatch(/WHERE/i)
    },
  )
})

// ---------------------------------------------------------------------------

describe('an archived business key can be reused', () => {
  it('faqs: archive a question, then write the same question again', async () => {
    const question = 'D-8: what are the payment terms?'

    const first = await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question, answer: 'The original answer.' },
      context: CTX,
    })

    // Still refused while it is ACTIVE — the constraint that must survive.
    await expect(
      payload.create({
        collection: 'faqs',
        overrideAccess: true,
        draft: true,
        data: { question, answer: 'A duplicate of an ACTIVE row.' },
        context: CTX,
      }),
    ).rejects.toThrow()

    await archiveDocument({ payload, collection: 'faqs', id: String(first.id) })

    // 🔴 THE ASSERTION THE DEFECT MADE IMPOSSIBLE.
    const replacement = await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question, answer: 'The replacement answer.' },
      context: CTX,
    })
    expect(replacement.id).not.toBe(first.id)

    // Both rows coexist: one archived, one active, same question.
    const all = await payload.find({
      collection: 'faqs',
      where: { question: { equals: question } },
      overrideAccess: true,
      trash: true,
      depth: 0,
    })
    expect(all.totalDocs).toBe(2)
  })

  it('faqs: two ACTIVE rows with the same question remain prohibited', async () => {
    const question = 'D-8: is the active constraint still enforced?'
    await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question, answer: 'First.' },
      context: CTX,
    })
    await expect(
      payload.create({
        collection: 'faqs',
        overrideAccess: true,
        draft: true,
        data: { question, answer: 'Second.' },
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('projects: an archived slug can be reused — the case with no escape hatch', async () => {
    /**
     * This is the one that mattered most. `blockProjectHardDelete` refuses a
     * permanent delete, so before the partial index an archived project's slug
     * was unreachable forever: you could not reuse it and you could not purge
     * the row holding it.
     */
    const slug = 'd8-archived-slug-reuse'
    const first = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: makeProject(slug, await uploadCover('D-8 first cover')) as never,
      context: CTX,
    })

    await archiveDocument({ payload, collection: 'projects', id: String(first.id) })

    const replacement = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: makeProject(slug, await uploadCover('D-8 replacement cover')) as never,
      context: CTX,
    })
    expect(replacement.id).not.toBe(first.id)
  })

  it('projects: two ACTIVE rows with the same slug remain prohibited', async () => {
    const slug = 'd8-active-slug-collision'
    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: makeProject(slug, await uploadCover('D-8 active A')) as never,
      context: CTX,
    })
    await expect(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        draft: true,
        data: makeProject(slug, await uploadCover('D-8 active B')) as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('blog-posts: an archived slug can be reused, an active one cannot', async () => {
    const slug = 'd8-archived-post-slug'
    const base = {
      title: 'D-8 Post',
      excerpt: 'Pins active-only slug uniqueness.',
      publishedAt: '2026-10-13T00:00:00.000Z',
      body: ['Only paragraph.'],
    }

    const first = await payload.create({
      collection: 'blog-posts',
      overrideAccess: true,
      draft: true,
      data: { ...base, slug } as never,
      context: CTX,
    })

    await expect(
      payload.create({
        collection: 'blog-posts',
        overrideAccess: true,
        draft: true,
        data: { ...base, slug } as never,
        context: CTX,
      }),
    ).rejects.toThrow()

    await archiveDocument({ payload, collection: 'blog-posts', id: String(first.id) })

    const replacement = await payload.create({
      collection: 'blog-posts',
      overrideAccess: true,
      draft: true,
      data: { ...base, slug } as never,
      context: CTX,
    })
    expect(replacement.id).not.toBe(first.id)
  })

  it('statistics: an archived label can be reused, an active one cannot', async () => {
    /**
     * `statistics` is included because the collection REMAINS SUPPORTED in the
     * CMS regardless of whether the frontend band renders it (D-6). An
     * administrator can archive and re-add a statistic today, so the same
     * active-only rule has to hold here.
     */
    const label = 'D-8 archived stat label'

    const first = await payload.create({
      collection: 'statistics',
      overrideAccess: true,
      draft: true,
      data: { label, value: '1' },
      context: CTX,
    })

    await expect(
      payload.create({
        collection: 'statistics',
        overrideAccess: true,
        draft: true,
        data: { label, value: '2' },
        context: CTX,
      }),
    ).rejects.toThrow()

    await archiveDocument({ payload, collection: 'statistics', id: String(first.id) })

    const replacement = await payload.create({
      collection: 'statistics',
      overrideAccess: true,
      draft: true,
      data: { label, value: '3' },
      context: CTX,
    })
    expect(replacement.id).not.toBe(first.id)
  })
})

// ---------------------------------------------------------------------------

describe('restore must not resurrect a conflict', () => {
  /**
   * 🔴 THE EDGE THE PARTIAL INDEX CREATES. Once an archived key can be reused,
   * restoring the archived row would put TWO active rows on the same key — and
   * the partial index is exactly what stops that. The restore must FAIL rather
   * than silently produce a duplicate, and the administrator has to rename or
   * archive the replacement first.
   *
   * This is a real behaviour change, not a theoretical one, and it is the
   * reason the migration is safe: the constraint moves, it does not weaken.
   */
  it('restoring an archived FAQ whose question was reused is refused', async () => {
    const question = 'D-8: can a restore create a duplicate?'

    const original = await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question, answer: 'Original.' },
      context: CTX,
    })
    await archiveDocument({ payload, collection: 'faqs', id: String(original.id) })

    await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question, answer: 'Took over the question.' },
      context: CTX,
    })

    // The database refuses it. The row stays archived and recoverable; nothing
    // is lost, and no duplicate reaches the rendered accordion.
    await expect(
      payload.update({
        collection: 'faqs',
        id: String(original.id),
        overrideAccess: true,
        trash: true,
        data: { deletedAt: null } as never,
        context: CTX,
      }),
    ).rejects.toThrow()

    const stillArchived = await payload.findByID({
      collection: 'faqs',
      id: String(original.id),
      overrideAccess: true,
      trash: true,
      depth: 0,
    })
    expect((stillArchived as { deletedAt?: unknown }).deletedAt).toBeTruthy()
  })
})
