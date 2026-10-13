import { getPayload, type Payload } from 'payload'

/**
 * THE TEST HARNESS.
 *
 * 🔴 HONEST STARTING POINT: there is NO Testing page in the official Payload v3
 * documentation. `/docs/testing/overview`, `/docs/local-api/testing` and
 * `/docs/production/testing` all 404, and Vitest and Playwright are named
 * nowhere. The only testing guidance anywhere is inside the plugin-authoring
 * page, which says "Payload typically uses Jest" and then declares
 * `let payload: Payload` WITHOUT EVER SHOWING HOW IT IS INITIALISED.
 *
 * So the entire harness is our own engineering decision, recorded as an ADR and
 * not as Payload guidance. Vitest over Jest because the docs state the
 * constraint that decides it: "Payload and all of its official packages are
 * fully ESM." Vitest is ESM-native; Jest needs extra configuration against an
 * all-ESM package graph.
 *
 * What IS documented, and is all we actually need: `getPayload({ config })`
 * boots the Local API in-process, so tests never need HTTP and never need the
 * Next.js server running.
 */

let instance: Payload | null = null

/**
 * 🔴 THE TEST DATABASE IS BUILT BY DRIZZLE `push`, NOT BY MIGRATIONS.
 *
 * `payload_migrations` in `sv_test` contains exactly one row, named `dev` —
 * the marker Payload writes when the schema was pushed rather than migrated.
 * Production (Neon) is migrations-only. So any schema change expressed ONLY as
 * a hand-written migration exists in production and NOWHERE in the suite, and
 * a test asserting it would pass locally for the wrong reason or fail for a
 * reason that is not a product defect.
 *
 * That gap is real and it bit D-8: `unique: true` makes Drizzle push a PLAIN
 * unique index, and the partial-index fix lives in raw SQL that push never
 * sees.
 *
 * So the suite applies those migrations itself, by CALLING THE MIGRATION'S OWN
 * `up()` — not a hand-copied SQL twin, which would be free to drift from the
 * thing that actually runs in production. `up()` is written idempotently
 * (`DROP INDEX IF EXISTS` then `CREATE`), so repeating it is harmless.
 *
 * Only migrations whose effect push cannot reproduce belong here. Everything
 * else is already in the pushed schema by definition.
 */
const applyPushInvisibleMigrations = async (payload: Payload): Promise<void> => {
  const url = process.env.DATABASE_URL ?? ''
  // Same belt-and-braces guard as `resetDb.ts`. This writes DDL, so it must
  // never be able to fire against the dev sandbox or production.
  if (!(/sv_test/.test(url) && /:5433\//.test(url))) {
    throw new Error(
      'REFUSING TO PATCH SCHEMA: DATABASE_URL does not look like the test database ' +
        '(expected sv_test on :5433).',
    )
  }

  const { up } = await import('@/migrations/20261013_090000_partial_unique_active_only')
  await up({ db: payload.db.drizzle, payload, req: undefined } as never)
}

export const getTestPayload = async (): Promise<Payload> => {
  if (!instance) {
    // Imported lazily so that a test which only exercises pure functions does
    // not pay for a database connection.
    const { default: config } = await import('@payload-config')
    instance = await getPayload({ config })
    await applyPushInvisibleMigrations(instance)
  }
  return instance
}

/** Base URL for the small suite that exercises real HTTP (CORS, cache, status
 *  codes). Skipped automatically when the dev server is not running. */
export const HTTP_BASE = process.env.TEST_HTTP_BASE ?? 'http://localhost:3001'

export const isHttpUp = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${HTTP_BASE}/livez`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}
