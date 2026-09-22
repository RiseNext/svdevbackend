import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `videos` — a THIRD upload collection, plus the `site-settings.video`
 * reference that designates which one is active.
 *
 * ADDITIVE ONLY. Two new tables, one new nullable column on Payload's lock
 * table, and two nullable FK columns on the site-settings pair. No existing
 * column is altered, no data is rewritten, nothing is dropped, no enum is
 * touched. Every existing row simply gets NULL in the two new columns.
 *
 * 🔴 THE GENERATED `down` WAS BROKEN AND WAS FIXED BY HAND. `up` IS EXACTLY AS
 * GENERATED AND WAS NOT TOUCHED.
 *
 * `migrate:create` emitted a `down` that ran `DROP TABLE "videos" CASCADE`
 * FIRST and then tried to drop the three foreign keys pointing at it. CASCADE
 * has already removed those constraints by that point, so the next statement
 * failed:
 *
 *   error: constraint "payload_locked_documents_rels_videos_fk"
 *          of relation "payload_locked_documents_rels" does not exist
 *
 * That is not a theoretical objection — it was MEASURED on a clean database:
 * `npm run migrate` applied all six migrations, and `npm run migrate:down`
 * then failed and rolled back. A down-migration that cannot run is a
 * rollback plan that does not exist, which is precisely the thing you discover
 * at the worst possible moment.
 *
 * THE FIX IS ORDERING, not new behaviour: unwind the SURVIVING tables first
 * (constraint -> index -> column), then drop the new tables last. `IF EXISTS`
 * is belt-and-braces so a partially-applied previous attempt cannot wedge it.
 *
 * ⚠️ ONE GENERATED ARTEFACT LEFT AS-IS, DELIBERATELY: `videos.poster_id` is
 * `NOT NULL` (because `poster` is `required: true`) while its foreign key is
 * `ON DELETE set null`. Those two disagree — Postgres would raise a NOT NULL
 * violation rather than nulling the column if a referenced `media` row were
 * ever hard-deleted. It is left exactly as Payload generates it because the
 * behaviour is FAIL-SAFE (the delete is refused, never silently cascaded) and
 * because the application already refuses it first, with a readable 409, in
 * `mediaDeleteGuard`. Hand-editing it would make this file diverge from what
 * `migrate:create` regenerates, which is its own drift problem.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "videos" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar NOT NULL,
  	"poster_id" uuid NOT NULL,
  	"original_filename" varchar,
  	"uploaded_by_id" uuid,
  	"prefix" varchar DEFAULT 'videos',
  	"_objectkey" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric
  );

  CREATE TABLE "videos_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "videos_id" uuid;
  ALTER TABLE "site_settings" ADD COLUMN "video_id" uuid;
  ALTER TABLE "_site_settings_v" ADD COLUMN "version_video_id" uuid;
  ALTER TABLE "videos" ADD CONSTRAINT "videos_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "videos" ADD CONSTRAINT "videos_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "videos_texts" ADD CONSTRAINT "videos_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "videos_poster_idx" ON "videos" USING btree ("poster_id");
  CREATE INDEX "videos_uploaded_by_idx" ON "videos" USING btree ("uploaded_by_id");
  CREATE INDEX "videos_updated_at_idx" ON "videos" USING btree ("updated_at");
  CREATE INDEX "videos_created_at_idx" ON "videos" USING btree ("created_at");
  CREATE INDEX "videos_deleted_at_idx" ON "videos" USING btree ("deleted_at");
  CREATE UNIQUE INDEX "videos_filename_idx" ON "videos" USING btree ("filename");
  CREATE INDEX "videos_texts_order_parent" ON "videos_texts" USING btree ("order","parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_videos_fk" FOREIGN KEY ("videos_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_site_settings_v" ADD CONSTRAINT "_site_settings_v_version_video_id_videos_id_fk" FOREIGN KEY ("version_video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_videos_id_idx" ON "payload_locked_documents_rels" USING btree ("videos_id");
  CREATE INDEX "site_settings_video_idx" ON "site_settings" USING btree ("video_id");
  CREATE INDEX "_site_settings_v_version_version_video_idx" ON "_site_settings_v" USING btree ("version_video_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_videos_fk";
  ALTER TABLE "site_settings" DROP CONSTRAINT IF EXISTS "site_settings_video_id_videos_id_fk";
  ALTER TABLE "_site_settings_v" DROP CONSTRAINT IF EXISTS "_site_settings_v_version_video_id_videos_id_fk";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_videos_id_idx";
  DROP INDEX IF EXISTS "site_settings_video_idx";
  DROP INDEX IF EXISTS "_site_settings_v_version_version_video_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "videos_id";
  ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "video_id";
  ALTER TABLE "_site_settings_v" DROP COLUMN IF EXISTS "version_video_id";
  DROP TABLE IF EXISTS "videos_texts" CASCADE;
  DROP TABLE IF EXISTS "videos" CASCADE;`)
}
