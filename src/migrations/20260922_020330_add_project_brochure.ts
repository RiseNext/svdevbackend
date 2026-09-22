import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `projects.brochure` — a single PDF from the existing `documents` collection.
 *
 * ADDITIVE ONLY. Two nullable FK columns (the live table and its version table),
 * their foreign keys and their indexes. No existing column is altered, no data
 * is rewritten, nothing is dropped. Every existing row simply gets NULL.
 *
 * 🔴 THE GENERATED MIGRATION WAS EDITED BY HAND, AND THAT WAS NECESSARY.
 * `migrate:create` diffs the config against the LAST MIGRATION SNAPSHOT, not
 * against the live database, and `20260921_120000_drop_lead_notified_at` was
 * hand-written WITHOUT a `.json` snapshot. Drizzle therefore diffed against
 * `20260921_071137_jobs_stats_global.json`, which still describes a world where
 * `leads.notified_at` exists and the two `payload_jobs` task-slug enums still
 * carry `sendLeadNotification`. The generator consequently emitted, on top of
 * the brochure columns:
 *
 *   · DROP/CREATE of enum_payload_jobs_task_slug and …_log_task_slug
 *   · ALTER TABLE "leads" DROP COLUMN "notified_at"
 *
 * All of that is ALREADY APPLIED in production by migration 4. Shipping it again
 * would re-run a destructive column drop and rebuild two enums that are already
 * correct — against tables this change has nothing to do with. Those statements
 * were removed; what remains is only the brochure schema.
 *
 * The accompanying `.json` snapshot IS kept, and deliberately: it restores a
 * baseline for `migrate:create`, so the next schema change diffs from the
 * current config instead of re-emitting these same unrelated statements.
 *
 * ⚠️ ONE PRE-EXISTING DEVIATION THE SNAPSHOT DOES NOT — AND MUST NOT — "FIX".
 * Migration 4's own notes record that migration 001 created
 * `enum_payload_jobs_task_slug` with SIX labels including `sendLeadNotification`,
 * that Postgres has no `ALTER TYPE … DROP VALUE`, and that the orphan label is
 * therefore LEFT IN PLACE rather than rebuilt. So a freshly migrated database
 * legitimately carries six labels while the config and this snapshot describe
 * five. That gap predates this migration, is deliberate and documented upstream,
 * and is harmless: the label is unreachable because no task is named it. It is
 * called out here only so the next person does not "correct" it by generating an
 * enum rebuild — which is precisely the destructive statement removed above.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "projects" ADD COLUMN "brochure_id" uuid;
  ALTER TABLE "_projects_v" ADD COLUMN "version_brochure_id" uuid;
  ALTER TABLE "projects" ADD CONSTRAINT "projects_brochure_id_documents_id_fk" FOREIGN KEY ("brochure_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_projects_v" ADD CONSTRAINT "_projects_v_version_brochure_id_documents_id_fk" FOREIGN KEY ("version_brochure_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "projects_brochure_idx" ON "projects" USING btree ("brochure_id");
  CREATE INDEX "_projects_v_version_version_brochure_idx" ON "_projects_v" USING btree ("version_brochure_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "projects" DROP CONSTRAINT "projects_brochure_id_documents_id_fk";
  ALTER TABLE "_projects_v" DROP CONSTRAINT "_projects_v_version_brochure_id_documents_id_fk";
  DROP INDEX "projects_brochure_idx";
  DROP INDEX "_projects_v_version_version_brochure_idx";
  ALTER TABLE "projects" DROP COLUMN "brochure_id";
  ALTER TABLE "_projects_v" DROP COLUMN "version_brochure_id";`)
}
