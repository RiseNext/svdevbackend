import { beforeAll, describe, expect, it } from 'vitest'
import type { CollectionSlug, Payload, Where } from 'payload'
import { combineWhereConstraints } from 'payload/shared'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { archiveDocument, restoreDocument } from '@/hooks/hardDeleteGuard'

/**
 * ARCHIVE AND RESTORE — the regression suite for the empty-Trash defect.
 *
 * 🔴 WHY THIS FILE EXISTS, AND WHY `domain.test.ts` DID NOT CATCH THE BUG.
 *
 * `domain.test.ts` already has a passing `create -> publish -> unpublish ->
 * archive -> restore` test. It passed throughout, because it calls
 * `payload.find({ trash: true })` directly — and the Local API NEVER applies
 * `admin.baseFilter`. That option is consumed only by `@payloadcms/next`'s list
 * view, so no Local-API test could observe the defect. The suite gave false
 * confidence about the one thing an administrator actually relies on.
 *
 * So these tests reconstruct the admin list view's OWN query, from the same
 * primitives it uses, and assert against that. `adminListWhere` below mirrors
 * `@payloadcms/next/dist/views/List/index.js:115-134` exactly:
 *
 *     const baseFilterConstraint = await admin.baseFilter?.({limit,page,req,sort})
 *     where = combineWhereConstraints([query?.where, baseFilterConstraint])
 *     if (trash === true) where = { and: [where, { deletedAt: { exists: true } }] }
 *
 * With a `baseFilter` of `{ deletedAt: { exists: false } }` that composes to
 * `deleted_at IS NULL AND deleted_at IS NOT NULL` — `exists: false` compiles to
 * `IS NULL` and `exists: true` to `IS NOT NULL`
 * (`@payloadcms/drizzle/dist/queries/sanitizeQueryValue.js:216-223`) — which is
 * unsatisfiable for every row. The bin was permanently empty, and because
 * `blockProjectHardDelete` / `blockLeadHardDelete` refuse a permanent delete,
 * archiving a project or an enquiry was a ONE-WAY DOOR.
 */

let payload: Payload

/** Every collection with `trash: true`. The six that previously declared a
 *  `baseFilter` are marked; `media`/`documents`/`videos` never did and are
 *  included so the config assertion covers the whole trash-enabled surface. */
const TRASH_ENABLED: readonly CollectionSlug[] = [
  'projects',
  'blog-posts',
  'leads',
  'testimonials',
  'faqs',
  'statistics',
  'media',
  'documents',
  'videos',
]

/**
 * Reconstructs the admin list view's `where`, including the trash branch.
 * Deliberately built from `combineWhereConstraints` — the same helper the view
 * imports from `payload/shared` — rather than hand-rolled, so this test tracks
 * the framework instead of a snapshot of it.
 */
const adminListWhere = async (
  slug: CollectionSlug,
  opts: { trash: boolean; where?: Where },
): Promise<Where> => {
  const collectionConfig = payload.collections[slug]!.config
  const baseFilter = collectionConfig.admin?.baseFilter ?? collectionConfig.admin?.baseListFilter

  const baseFilterConstraint = baseFilter
    ? await baseFilter({
        limit: 10,
        page: 1,
        req: { payload } as never,
        sort: 'id',
      })
    : undefined

  let where = combineWhereConstraints([opts.where, baseFilterConstraint ?? undefined])
  if (opts.trash) {
    where = { and: [where, { deletedAt: { exists: true } }] }
  }
  return where
}

/** Runs the admin list query for real, against Postgres. */
const adminList = async (slug: CollectionSlug, opts: { trash: boolean; where?: Where }) =>
  payload.find({
    collection: slug,
    where: await adminListWhere(slug, opts),
    overrideAccess: true,
    trash: opts.trash,
    limit: 10,
    depth: 0,
  })

/** `deletedAt` is injected by `trash: true` and so is absent from the union of
 *  generated collection types (`audit-log` has no such field). Narrow rather
 *  than widen the helper's return type, which would weaken every other
 *  assertion in this file. */
const deletedAtOf = (doc: unknown): unknown =>
  (doc as { deletedAt?: unknown } | undefined)?.deletedAt

const CTX = { skipAudit: true, skipRevalidate: true }

/** Generated, not committed — same approach as `mediaInUseGuards.test.ts`, so
 *  no binary blob ever lands in a diff. */
let pad = 0
const uploadCover = async (alt: string): Promise<string> => {
  const sharp = (await import('sharp')).default
  const data = await sharp({
    create: { width: 64 + (pad++ % 5), height: 48, channels: 3, background: { r: 9, g: 60, b: 33 } },
  })
    .jpeg()
    .toBuffer()
  const doc = await payload.create({
    collection: 'media',
    overrideAccess: true,
    file: { data, name: `trash-fixture-${pad}.jpg`, mimetype: 'image/jpeg', size: data.byteLength },
    data: { alt },
    context: CTX,
  })
  return String(doc.id)
}

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)
})

// ---------------------------------------------------------------------------

describe('admin.baseFilter must not be declared on a trash-enabled collection', () => {
  /**
   * The cheap guard that prevents reintroduction. It is a pure config read —
   * no database — and it is the test that would have failed on the original
   * code, which is the whole point of writing it this way round.
   */
  it.each(TRASH_ENABLED)('%s declares neither baseFilter nor baseListFilter', (slug) => {
    const admin = payload.collections[slug]!.config.admin
    expect(admin?.baseFilter, `${slug}.admin.baseFilter must stay absent`).toBeUndefined()
    expect(admin?.baseListFilter, `${slug}.admin.baseListFilter must stay absent`).toBeUndefined()
  })

  it('every collection in TRASH_ENABLED really has trash turned on', () => {
    for (const slug of TRASH_ENABLED) {
      expect(payload.collections[slug]!.config.trash, `${slug}.trash`).toBe(true)
    }
  })

  it('the admin trash query is satisfiable — no field is both IS NULL and IS NOT NULL', async () => {
    for (const slug of TRASH_ENABLED) {
      const where = await adminListWhere(slug, { trash: true })
      // With no baseFilter the composed `and` carries exactly one constraint:
      // the trash branch. A reintroduced baseFilter would add a second,
      // contradictory `deletedAt` clause here.
      const flat = JSON.stringify(where)
      const existsFalse = flat.includes('"exists":false')
      expect(existsFalse, `${slug} trash query contains a contradictory deletedAt IS NULL`).toBe(
        false,
      )
    }
  })
})

// ---------------------------------------------------------------------------

describe('an archived record is listed in the admin Trash view and can be restored', () => {
  /**
   * One round trip per collection, through the admin's own query shape:
   *   create -> archive -> absent from default list -> PRESENT in trash list
   *   -> restore -> present in default list again.
   *
   * The `trash list` assertion is the one that was impossible before this fix.
   */

  const fixtures: Record<string, () => Promise<{ id: string; where: Where }>> = {
    projects: async () => {
      const cover = await uploadCover('Trash fixture cover')
      const doc = await payload.create({
        collection: 'projects',
        overrideAccess: true,
        draft: true,
        data: {
          name: 'Trash Fixture Project',
          slug: 'trash-fixture-project',
          category: 'Residential Plots',
          locality: 'Testville',
          summary: 'Archived then restored.',
          description: ['Only paragraph.'],
          highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
          image: cover,
        } as never,
        context: { skipAudit: true, skipRevalidate: true },
      })
      return { id: String(doc.id), where: { slug: { equals: 'trash-fixture-project' } } }
    },

    'blog-posts': async () => {
      const doc = await payload.create({
        collection: 'blog-posts',
        overrideAccess: true,
        draft: true,
        data: {
          title: 'Trash Fixture Post',
          slug: 'trash-fixture-post',
          excerpt: 'Archived then restored.',
          publishedAt: '2026-10-12T00:00:00.000Z',
          body: ['Only paragraph.'],
        } as never,
        context: { skipAudit: true, skipRevalidate: true },
      })
      return { id: String(doc.id), where: { slug: { equals: 'trash-fixture-post' } } }
    },

    leads: async () => {
      const doc = await payload.create({
        collection: 'leads',
        overrideAccess: true,
        data: {
          name: 'Trash Fixture Lead',
          phone: '9876500931',
          source: 'contact_form',
          consentGiven: true,
        } as never,
        context: { skipAudit: true },
      })
      return { id: String(doc.id), where: { phone: { equals: '9876500931' } } }
    },

    testimonials: async () => {
      const doc = await payload.create({
        collection: 'testimonials',
        overrideAccess: true,
        draft: true,
        data: { name: 'Trash Fixture Client', body: 'Archived then restored.', consented: true },
        context: { skipAudit: true, skipRevalidate: true },
      })
      return { id: String(doc.id), where: { name: { equals: 'Trash Fixture Client' } } }
    },

    faqs: async () => {
      const doc = await payload.create({
        collection: 'faqs',
        overrideAccess: true,
        draft: true,
        data: { question: 'Trash fixture question?', answer: 'Archived then restored.' },
        context: { skipAudit: true, skipRevalidate: true },
      })
      return { id: String(doc.id), where: { question: { equals: 'Trash fixture question?' } } }
    },

    statistics: async () => {
      const doc = await payload.create({
        collection: 'statistics',
        overrideAccess: true,
        draft: true,
        data: { label: 'Trash fixture stat', value: '42' },
        context: { skipAudit: true, skipRevalidate: true },
      })
      return { id: String(doc.id), where: { label: { equals: 'Trash fixture stat' } } }
    },
  }

  it.each(Object.keys(fixtures))(
    '%s: archive -> visible in Trash -> restore',
    async (slug) => {
      const collection = slug as CollectionSlug
      const { id, where } = await fixtures[slug]!()

      // Present in the default admin list before archiving.
      const before = await adminList(collection, { trash: false, where })
      expect(before.totalDocs, `${slug} should be listed before archiving`).toBe(1)

      await archiveDocument({ payload, collection, id })

      // Gone from the default admin list. This is what `appendNonTrashedFilter`
      // does for us, and it is why the removed `baseFilter` was redundant.
      const afterDefault = await adminList(collection, { trash: false, where })
      expect(afterDefault.totalDocs, `${slug} should leave the default list`).toBe(0)

      // 🔴 THE ASSERTION THE DEFECT MADE IMPOSSIBLE.
      const afterTrash = await adminList(collection, { trash: true, where })
      expect(afterTrash.totalDocs, `${slug} should appear in the Trash view`).toBe(1)
      expect(deletedAtOf(afterTrash.docs[0])).toBeTruthy()

      // Restore puts it back in the default list.
      await restoreDocument({ payload, collection, id })
      const restored = await adminList(collection, { trash: false, where })
      expect(restored.totalDocs, `${slug} should return to the default list`).toBe(1)
      expect(deletedAtOf(restored.docs[0])).toBeFalsy()
    },
    30_000,
  )
})

// ---------------------------------------------------------------------------

describe('the two collections whose archive was a one-way door', () => {
  /**
   * `projects` and `leads` both refuse a permanent delete. With the Trash view
   * empty, that combination meant an archived record could not be recovered
   * through the panel at all — recovery needed direct database access. These
   * two assertions pin the pairing: the hard delete still refuses, AND the row
   * is still reachable for restore.
   */

  it('a project cannot be hard-deleted, and stays recoverable from the Trash view', async () => {
    const cover = await uploadCover('One-way door cover')
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: {
        name: 'One Way Door',
        slug: 'one-way-door',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Guarded against permanent deletion.',
        description: ['Only paragraph.'],
        highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
        image: cover,
      } as never,
      context: { skipAudit: true, skipRevalidate: true },
    })

    await archiveDocument({ payload, collection: 'projects', id: String(created.id) })

    const where: Where = { slug: { equals: 'one-way-door' } }
    const inTrash = await adminList('projects', { trash: true, where })
    expect(inTrash.totalDocs).toBe(1)

    // 🔴 `trash: true` IS WHAT THE ADMIN ACTUALLY SENDS. The Trash view's
    // "Permanently Delete" control builds its URL with `trash: true`
    // (@payloadcms/ui/dist/elements/PermanentlyDeleteButton/index.js:64-67) and
    // the REST endpoint reads it off the query
    // (payload/dist/collections/endpoints/deleteByID.js:8,17). Passing it is
    // what lets `deleteByID` FIND the archived row, which is what lets
    // `beforeDelete` — and therefore the guard — run at all.
    await expect(
      payload.delete({
        collection: 'projects',
        id: String(created.id),
        overrideAccess: true,
        trash: true,
      }),
    ).rejects.toThrow(/A project cannot be permanently deleted from here/i)

    // Still there, still restorable.
    const stillInTrash = await adminList('projects', { trash: true, where })
    expect(stillInTrash.totalDocs).toBe(1)
  })

  /**
   * ⚠️ THE TRAP THAT MAKES `sweepDeletedMedia` A NO-OP, pinned here because it
   * is the same mechanism and it is counter-intuitive.
   *
   * `payload.delete({ trash: false })` on an ALREADY-ARCHIVED row cannot find
   * it: `appendNonTrashedFilter` ANDs `deletedAt exists: false` into the lookup
   * (payload/dist/collections/operations/deleteByID.js:50-54), `db.findOne`
   * misses, and `NotFound` throws at `:62` — BEFORE `beforeDelete` at `:69`. So
   * the hard-delete guard never even runs, and the caller gets a bare
   * "Not Found" rather than the guard's explanation.
   *
   * Any code that purges archived rows MUST pass `trash: true`.
   */
  it('deleting an archived row with trash:false throws NotFound before any guard runs', async () => {
    const cover = await uploadCover('Trash-false trap cover')
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: {
        name: 'Trash False Trap',
        slug: 'trash-false-trap',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Pins the trash:false lookup trap.',
        description: ['Only paragraph.'],
        highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
        image: cover,
      } as never,
      context: CTX,
    })
    await archiveDocument({ payload, collection: 'projects', id: String(created.id) })

    await expect(
      payload.delete({
        collection: 'projects',
        id: String(created.id),
        overrideAccess: true,
        trash: false,
      }),
    ).rejects.toThrow(/Not Found/i)
  })

  it('an enquiry cannot be hard-deleted, and stays recoverable from the Trash view', async () => {
    const created = await payload.create({
      collection: 'leads',
      overrideAccess: true,
      data: {
        name: 'One Way Lead',
        phone: '9876500932',
        source: 'contact_form',
        consentGiven: true,
      } as never,
      context: { skipAudit: true },
    })

    await archiveDocument({ payload, collection: 'leads', id: String(created.id) })

    const where: Where = { phone: { equals: '9876500932' } }
    expect((await adminList('leads', { trash: true, where })).totalDocs).toBe(1)

    // `trash: true` — see the note on the project case above.
    await expect(
      payload.delete({
        collection: 'leads',
        id: String(created.id),
        overrideAccess: true,
        trash: true,
      }),
    ).rejects.toThrow(/A lead is a commercial record and can never be permanently deleted/i)

    expect((await adminList('leads', { trash: true, where })).totalDocs).toBe(1)
  })
})
