import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import {
  down,
  up,
} from '@/migrations/20261013_090000_partial_unique_active_only'

/**
 * THE D-8 MIGRATION, EXERCISED AS A MIGRATION.
 *
 * `archivedUniqueness.test.ts` proves the BEHAVIOUR the partial indexes buy.
 * This file proves the MIGRATION itself: that `up` is idempotent, that `down`
 * really restores the previous schema, that the round trip is clean, and — the
 * part that actually matters on a deploy — that both directions REFUSE rather
 * than half-apply when the data cannot support the index they are about to
 * build.
 *
 * 🔴 WHY THIS IS NOT OPTIONAL COVERAGE. This migration is the only schema
 * change in the release, it runs against Neon on deploy, and its `down` is the
 * rollback path. A rollback that fails halfway would leave four tables with NO
 * uniqueness constraint at all — strictly worse than either end state. The
 * refusal tests below are the evidence that cannot happen.
 *
 * Everything here runs against the disposable `sv_test` database on :5433. The
 * migration's `up`/`down` are imported and called directly; `payload.db.drizzle`
 * is the same adapter handle `payload migrate` hands them in production.
 */

let payload: Payload

/** `MigrateUpArgs`/`MigrateDownArgs` as the postgres adapter constructs them. */
const args = () => ({ db: payload.db.drizzle, payload, req: undefined }) as never

const indexDef = async (index: string): Promise<string> => {
  const { sql } = await import('@payloadcms/db-postgres/drizzle')
  const result = await payload.db.drizzle.execute(
    sql.raw(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='${index}'`),
  )
  const rows = (result as unknown as { rows?: { indexdef: string }[] }).rows ?? []
  return rows[0]?.indexdef ?? ''
}

const INDEXES = [
  'projects_slug_idx',
  'blog_posts_slug_idx',
  'faqs_question_idx',
  'statistics_label_idx',
] as const

const isPartial = (def: string) => /WHERE \(?deleted_at IS NULL\)?/i.test(def)

const CTX = { skipAudit: true, skipRevalidate: true }

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)
  // `getTestPayload` has already run `up` once. Start every case from a known
  // migrated state regardless of which file ran first.
  await up(args())
})

// ---------------------------------------------------------------------------

describe('up', () => {
  it('leaves all four indexes UNIQUE and partial', async () => {
    for (const index of INDEXES) {
      const def = await indexDef(index)
      expect(def, `${index} must exist`).toMatch(/CREATE UNIQUE INDEX/)
      expect(isPartial(def), `${index} must be partial`).toBe(true)
    }
  })

  it('is idempotent — running it again changes nothing', async () => {
    const before = await Promise.all(INDEXES.map(indexDef))
    await up(args())
    const after = await Promise.all(INDEXES.map(indexDef))
    expect(after).toEqual(before)
  })

  it('refuses, without dropping anything, when two ACTIVE rows share a key', async () => {
    /**
     * The preflight exists for the case where the plain index was removed by
     * hand and duplicates accumulated. Reproduced here by dropping the index,
     * inserting a genuine duplicate, and asserting `up` aborts with something
     * an operator can act on — naming the table, column and offending value.
     */
    const { sql } = await import('@payloadcms/db-postgres/drizzle')
    await payload.db.drizzle.execute(sql.raw(`DROP INDEX IF EXISTS "faqs_question_idx";`))

    const question = 'Migration preflight duplicate?'
    await payload.db.drizzle.execute(
      sql.raw(`
        INSERT INTO "faqs" ("question", "answer", "updated_at", "created_at")
        VALUES ('${question}', 'A', NOW(), NOW()), ('${question}', 'B', NOW(), NOW());
      `),
    )

    await expect(up(args())).rejects.toThrow(/REFUSING TO MIGRATE/)
    await expect(up(args())).rejects.toThrow(/faqs\.question/)
    await expect(up(args())).rejects.toThrow(/Migration preflight duplicate/)

    // Clean up and confirm `up` succeeds again once the data is sound.
    await payload.db.drizzle.execute(
      sql.raw(`DELETE FROM "faqs" WHERE "question" = '${question}';`),
    )
    await up(args())
    expect(isPartial(await indexDef('faqs_question_idx'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('down', () => {
  it('restores plain unique indexes, and up/down/up round-trips cleanly', async () => {
    await down(args())
    for (const index of INDEXES) {
      const def = await indexDef(index)
      expect(def, `${index} must still exist after down`).toMatch(/CREATE UNIQUE INDEX/)
      expect(isPartial(def), `${index} must no longer be partial`).toBe(false)
    }

    // Forward again — the state the rest of the suite expects.
    await up(args())
    for (const index of INDEXES) {
      expect(isPartial(await indexDef(index)), `${index} partial after re-up`).toBe(true)
    }
  })

  it('🔴 REFUSES rather than half-applying when an archived key was reused', async () => {
    /**
     * THE ROLLBACK HAZARD, PINNED.
     *
     * Once the partial index is live, an administrator can archive an FAQ and
     * re-add its question — that is the entire point of the migration. A plain
     * unique index can no longer be built over that data. Postgres would fail
     * on `CREATE UNIQUE INDEX`, and because the DROP comes first, a careless
     * `down` would leave the table with NO constraint.
     *
     * So `down` checks first and aborts before touching any index. This test
     * creates exactly that data shape and asserts both halves: the refusal, and
     * that all four indexes survive it untouched.
     */
    const question = 'Rollback blocker — archived then reused?'

    const original = await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question, answer: 'Original.' },
      context: CTX,
    })
    await payload.update({
      collection: 'faqs',
      id: String(original.id),
      overrideAccess: true,
      data: { deletedAt: new Date().toISOString() } as never,
      context: CTX,
    })
    await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question, answer: 'Reused the question.' },
      context: CTX,
    })

    await expect(down(args())).rejects.toThrow(/REFUSING TO ROLL BACK/)
    await expect(down(args())).rejects.toThrow(/faqs\.question/)

    // 🔴 Nothing was dropped. This is the assertion that proves the refusal is
    // safe rather than merely loud.
    for (const index of INDEXES) {
      const def = await indexDef(index)
      expect(def, `${index} must survive a refused rollback`).toMatch(/CREATE UNIQUE INDEX/)
      expect(isPartial(def), `${index} must still be partial`).toBe(true)
    }

    // And the documented recovery path works: remove the archived duplicate,
    // and the rollback becomes possible again.
    const { sql } = await import('@payloadcms/db-postgres/drizzle')
    await payload.db.drizzle.execute(
      sql.raw(`DELETE FROM "faqs" WHERE "question" = '${question}' AND "deleted_at" IS NOT NULL;`),
    )
    await down(args())
    expect(isPartial(await indexDef('faqs_question_idx'))).toBe(false)
    await up(args())
    expect(isPartial(await indexDef('faqs_question_idx'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('the migration is registered', () => {
  it('appears in the migrations index, so `payload migrate` will run it', async () => {
    const { migrations } = await import('@/migrations')
    const names = migrations.map((m) => m.name)
    expect(names).toContain('20261013_090000_partial_unique_active_only')
    // Ordering is by position in this array; it must be LAST so it applies
    // after every migration that created the indexes it rewrites.
    expect(names[names.length - 1]).toBe('20261013_090000_partial_unique_active_only')
  })
})
