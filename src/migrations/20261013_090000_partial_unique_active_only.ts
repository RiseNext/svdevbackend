import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * D-8 — ACTIVE-ONLY UNIQUENESS FOR THE FOUR BUSINESS KEYS.
 *
 * 🔴 THE DEFECT. `trash: true` is a SOFT delete: the row stays, with
 * `deleted_at` set. But `unique: true` on a field realises a PLAIN
 * `CREATE UNIQUE INDEX` over the WHOLE table, archived rows included. So an
 * archived FAQ keeps owning its question text forever, and the row blocking the
 * administrator is invisible in the default list view — they are refused by a
 * record they cannot see.
 *
 * For `projects` it is worse than an annoyance. `blockProjectHardDelete`
 * refuses a permanent delete, so an archived project's slug could never be
 * freed through the panel AT ALL. Archiving a project burned its slug
 * permanently and the only recovery was direct database access.
 *
 * THE FIX. Replace each index with a PARTIAL unique index predicated on
 * `deleted_at IS NULL`. The constraint MOVES, it does not weaken: two active
 * rows still cannot share a key (pinned by
 * `tests/integration/archivedUniqueness.test.ts`), and archived rows simply
 * stop participating.
 *
 * ─── WHY THE INDEX NAMES ARE UNCHANGED ──────────────────────────────────────
 *
 * Deliberate, and load-bearing. Payload/Drizzle generate migrations by diffing
 * the SNAPSHOT (`*.json`, derived from the field config) against the NEW
 * snapshot — never against the live database. The snapshot records an index's
 * name, columns and `isUnique`, and has no concept of a `WHERE` clause. Keeping
 * `faqs_question_idx` as the name means the next `migrate:create` sees no change
 * on these fields and will not try to undo this. Renaming them would make the
 * next generated migration "restore" the plain index and silently reintroduce
 * the defect.
 *
 * It also means `unique: true` STAYS in the field config, which is what we
 * want for a second reason: it keeps Payload's own application-level uniqueness
 * check and the admin UI's inline field error. Removing it would have handed
 * the administrator a raw Postgres constraint-violation instead.
 *
 * ─── WHAT IS DELIBERATELY NOT INCLUDED ──────────────────────────────────────
 *
 * ⚠️ `media.filename`, `documents.filename` and `videos.filename` are also
 * unique indexes on trash-enabled collections. They are LEFT PLAIN on purpose.
 *
 * A filename here is not a business key — it is a STORAGE ADDRESS. Archiving a
 * media row does not remove the object from Cloudinary; that is the whole point
 * of the soft delete, and `sweepDeletedMedia` is what eventually reclaims it.
 * Making the filename reusable while the archived row's bytes are still live
 * would let a new upload collide with an existing object — corrupting or
 * overwriting an asset that an administrator can still restore. The uniqueness
 * there protects the file, not the record, so it must span archived rows too.
 *
 * (The previous audit listed only the four indexes below. The three filename
 * indexes were found by querying `pg_indexes` for every unique index on a table
 * carrying `deleted_at`, rather than trusting that list — and then excluded for
 * the reason above. Both halves of that decision are pinned as tests.)
 *
 * ─── SAFETY ─────────────────────────────────────────────────────────────────
 *
 * Both directions run inside Payload's per-migration transaction (`db` is the
 * transaction-bound adapter), so a failure at any statement rolls the whole
 * thing back and no table is ever left without its constraint.
 *
 * `CONCURRENTLY` is deliberately NOT used: it cannot run inside a transaction,
 * and losing the all-or-nothing property is a far worse trade than the brief
 * ACCESS EXCLUSIVE lock these four small tables take.
 *
 * `up` is pre-flight checked. Rebuilding a unique index fails if the data
 * already violates it, and a bare Postgres error mid-deploy is a poor place to
 * learn that. The check below runs FIRST and reports every offending key, so
 * the deploy aborts with something actionable before anything is dropped.
 */

/** The four business keys. Order is irrelevant — each is independent. */
const TARGETS = [
  { table: 'projects', column: 'slug', index: 'projects_slug_idx' },
  { table: 'blog_posts', column: 'slug', index: 'blog_posts_slug_idx' },
  { table: 'faqs', column: 'question', index: 'faqs_question_idx' },
  { table: 'statistics', column: 'label', index: 'statistics_label_idx' },
] as const

type Row = { key: string; n: string | number }

const rowsOf = (result: unknown): Row[] =>
  ((result as { rows?: Row[] } | undefined)?.rows ?? []) as Row[]

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // ---------------------------------------------------------------- preflight
  //
  // The partial index constrains ACTIVE rows only, so the only data that can
  // defeat it is two rows with the same key that are BOTH active. The plain
  // index already forbade that, so on a consistent database this finds nothing.
  // It is checked anyway: the plain index could have been dropped by hand, and
  // discovering that from a failed `CREATE INDEX` halfway through a production
  // deploy is exactly the situation this avoids.
  const conflicts: string[] = []

  for (const { table, column, index } of TARGETS) {
    const found = await db.execute(
      sql.raw(`
        SELECT "${column}"::text AS key, COUNT(*) AS n
        FROM "${table}"
        WHERE "deleted_at" IS NULL AND "${column}" IS NOT NULL
        GROUP BY "${column}"
        HAVING COUNT(*) > 1
        ORDER BY n DESC, key
        LIMIT 10;
      `),
    )
    for (const row of rowsOf(found)) {
      conflicts.push(`${table}.${column} = ${JSON.stringify(row.key)} (${row.n} active rows) [${index}]`)
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      'REFUSING TO MIGRATE: active rows already share a key that must be unique. ' +
        'Resolve these by renaming or archiving the duplicates, then re-run:\n  - ' +
        conflicts.join('\n  - '),
    )
  }

  // ------------------------------------------------------------------ rebuild
  for (const { table, column, index } of TARGETS) {
    await db.execute(sql.raw(`DROP INDEX IF EXISTS "${index}";`))
    await db.execute(
      sql.raw(`
        CREATE UNIQUE INDEX "${index}"
          ON "${table}" USING btree ("${column}")
          WHERE "deleted_at" IS NULL;
      `),
    )
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  /**
   * 🔴 THE ROLLBACK IS NOT SYMMETRIC, AND CANNOT BE.
   *
   * Going back to a PLAIN unique index re-imposes the constraint on archived
   * rows. If an administrator used the new freedom — archived an FAQ and re-added
   * its question, which is precisely what this migration exists to allow — then
   * the plain index can no longer be built. Postgres would refuse with a bare
   * "could not create unique index", mid-rollback.
   *
   * So `down` detects it first and refuses with the actual list, naming the rows
   * involved. The operator then has a real choice (purge or rename the archived
   * duplicates) instead of a half-applied rollback. Nothing is dropped before
   * the check passes, and the whole function is inside the migration
   * transaction, so a refusal leaves the partial indexes exactly as they were.
   *
   * RECOVERY PATH if `down` refuses: the partial indexes are strictly more
   * permissive than the plain ones, so staying on this migration is always safe.
   * There is no state in which rolling back is required for correctness — it is
   * only needed to return to the previous schema definition.
   */
  const blockers: string[] = []

  for (const { table, column, index } of TARGETS) {
    const found = await db.execute(
      sql.raw(`
        SELECT "${column}"::text AS key, COUNT(*) AS n
        FROM "${table}"
        WHERE "${column}" IS NOT NULL
        GROUP BY "${column}"
        HAVING COUNT(*) > 1
        ORDER BY n DESC, key
        LIMIT 10;
      `),
    )
    for (const row of rowsOf(found)) {
      blockers.push(
        `${table}.${column} = ${JSON.stringify(row.key)} (${row.n} rows incl. archived) [${index}]`,
      )
    }
  }

  if (blockers.length > 0) {
    throw new Error(
      'REFUSING TO ROLL BACK: a plain unique index cannot be rebuilt because ' +
        'archived and active rows now share a key — which this migration deliberately ' +
        'allows. Purge or rename the archived duplicates first, or stay on the partial ' +
        'indexes (they are strictly more permissive and always safe):\n  - ' +
        blockers.join('\n  - '),
    )
  }

  for (const { table, column, index } of TARGETS) {
    await db.execute(sql.raw(`DROP INDEX IF EXISTS "${index}";`))
    await db.execute(
      sql.raw(`
        CREATE UNIQUE INDEX "${index}"
          ON "${table}" USING btree ("${column}");
      `),
    )
  }
}
