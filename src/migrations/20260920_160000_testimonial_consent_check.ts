import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * THE TESTIMONIAL CONSENT CHECK — one of exactly TWO database-level constraints
 * retained under this architecture.
 *
 * (The other is the icon enum, which `select` + `enumName` materialises as a real
 * Postgres enum type — a stronger guarantee than a CHECK, and therefore not
 * written by hand.)
 *
 * 🔴 WHY A DATABASE CONSTRAINT AND NOT JUST THE HOOK:
 *
 * `ADMIN-CMS-SPEC.md` §8 originally described this as a UI control — "Publish is
 * disabled until Consented is ticked". Its own architecture header overrides
 * that: the gate "must be a beforeValidate hook, not merely a disabled button"
 * (D-011). A disabled button is defeated by the REST API, by a script, by a bulk
 * edit, and by any future custom view.
 *
 * This CHECK is the third and last layer, below the hook and the access
 * function. It exists because of what it protects: the three testimonials in the
 * repository today are INVENTED PLACEHOLDERS WITH BRACKETED NAMES, and
 * `pages.ts:10-12` calls publishing them "a fabricated record". Once an admin UI
 * exists, publishing them as-is is the single easiest catastrophic mistake
 * available.
 *
 * MAKE IT IMPOSSIBLE, NOT DISCOURAGED.
 *
 * The constraint is written as "NOT (published AND NOT consented)" so that a
 * NULL `consented` — which SQL three-valued logic would otherwise let through —
 * is also rejected when published.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "testimonials"
      ADD CONSTRAINT "testimonials_published_requires_consent"
      CHECK (NOT ("_status" = 'published' AND COALESCE("consented", false) = false));
  `)

  // The version table stores every historical state of the same document, so a
  // published-unconsented row must be impossible there too — otherwise
  // restoring a version becomes a way around the rule.
  await db.execute(sql`
    ALTER TABLE "_testimonials_v"
      ADD CONSTRAINT "testimonials_v_published_requires_consent"
      CHECK (NOT ("version__status" = 'published' AND COALESCE("version_consented", false) = false));
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "_testimonials_v" DROP CONSTRAINT IF EXISTS "testimonials_v_published_requires_consent";
  `)
  await db.execute(sql`
    ALTER TABLE "testimonials" DROP CONSTRAINT IF EXISTS "testimonials_published_requires_consent";
  `)
}
