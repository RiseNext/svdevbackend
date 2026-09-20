import type { Payload } from 'payload'

/**
 * Per-run isolation for the database-backed suites.
 *
 * ⚠️ There is NO documented transaction-rollback-per-test helper in Payload, so
 * isolation is necessarily delete-based. Without it, a second run of the suite
 * collides with its own first run — duplicate slugs, an already-triggered dedupe
 * window — and produces failures that look like product defects but are test
 * residue.
 *
 * 🔴 SAFETY: this refuses to run against anything but the test database. A
 * truncate pointed at the dev sandbox would destroy the data a developer is
 * looking at in the admin; pointed at production it would be unrecoverable.
 */
export const resetTestDatabase = async (payload: Payload): Promise<void> => {
  const url = process.env.DATABASE_URL ?? ''

  // Belt and braces: the name must say test AND the port must be the test port.
  const looksLikeTestDb = /sv_test/.test(url) && /:5433\//.test(url)
  if (!looksLikeTestDb) {
    throw new Error(
      `REFUSING TO TRUNCATE: DATABASE_URL does not look like the test database (expected sv_test on :5433). Got host/db from: ${url.replace(/\/\/[^@]*@/, '//***@')}`,
    )
  }

  // Order matters only in that children go before parents; RESTART IDENTITY and
  // CASCADE handle the rest.
  const tables = [
    'audit_log',
    'payload_jobs_log',
    'payload_jobs',
    'leads',
    'projects',
    'testimonials',
    'faqs',
    'statistics',
    'media',
    'documents',
  ]

  const { sql } = await import('@payloadcms/db-postgres/drizzle')
  for (const table of tables) {
    await payload.db.drizzle.execute(
      sql.raw(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`),
    )
  }
}
