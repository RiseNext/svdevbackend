import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `projects.logo` — the project's own logo, from the existing `media` collection.
 *
 * ADDITIVE ONLY. Two nullable FK columns (the live table and its version table),
 * their foreign keys and their indexes. No existing column is altered, no data is
 * rewritten, nothing is dropped. All six existing project rows simply get NULL,
 * which serialises as the `logo` key being OMITTED — so every current public API
 * response is byte-identical to before this migration.
 *
 * Structurally identical to `20260922_020330_add_project_brochure`, differing only
 * in the referenced collection: `media` here, `documents` there. `ON DELETE set
 * null` matches the convention every other project upload column already uses, so
 * deleting a media row clears the reference rather than blocking or orphaning it.
 *
 * ✅ THE GENERATED SQL NEEDED NO HAND-EDITING, AND THAT IS WORTH RECORDING
 * BECAUSE LAST TIME IT DID. `migrate:create` diffs the config against the LAST
 * MIGRATION SNAPSHOT, not against the live database. The brochure migration had
 * to have spurious statements stripped by hand — an enum rebuild and a
 * `leads.notified_at` column drop — because the preceding migration was
 * hand-written with no `.json` snapshot to diff from. That gap has since been
 * closed: `20260922_103833_hero_videos.json` exists, so the generator diffed from
 * an accurate baseline and emitted exactly the six statements below and nothing
 * else. Only this header was added.
 *
 * TABLE COUNT IS UNCHANGED AT 55 — this adds columns, not tables.
 */

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" ADD COLUMN "logo_id" uuid;
  ALTER TABLE "_projects_v" ADD COLUMN "version_logo_id" uuid;
  ALTER TABLE "projects" ADD CONSTRAINT "projects_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_projects_v" ADD CONSTRAINT "_projects_v_version_logo_id_media_id_fk" FOREIGN KEY ("version_logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "projects_logo_idx" ON "projects" USING btree ("logo_id");
  CREATE INDEX "_projects_v_version_version_logo_idx" ON "_projects_v" USING btree ("version_logo_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" DROP CONSTRAINT "projects_logo_id_media_id_fk";
  
  ALTER TABLE "_projects_v" DROP CONSTRAINT "_projects_v_version_logo_id_media_id_fk";
  
  DROP INDEX "projects_logo_idx";
  DROP INDEX "_projects_v_version_version_logo_idx";
  ALTER TABLE "projects" DROP COLUMN "logo_id";
  ALTER TABLE "_projects_v" DROP COLUMN "version_logo_id";`)
}
