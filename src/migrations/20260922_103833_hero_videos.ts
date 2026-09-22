import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `site-settings.video` (one) -> `site-settings.heroVideos` (ordered many).
 *
 * WHY THE SHAPE CHANGES AT ALL: the frontend shipped its hero implementation
 * (`HeroVideoStage`) and it consumes an ARRAY whose index is the carousel
 * order. The singular field from `20260922_073843_add_videos` was written
 * against a contract that did not exist yet; this replaces it with the one the
 * consumer actually reads.
 *
 * 🔴 THE TWO `DROP COLUMN`s ARE THE ONLY DESTRUCTIVE STATEMENTS HERE, AND THEY
 * WERE CLEARED AGAINST PRODUCTION BEFORE THIS FILE WAS GENERATED. Measured
 * read-only on the live database immediately beforehand:
 *
 *     videos rows                                 : 0
 *     videos_texts rows                           : 0
 *     site_settings.video_id populated            : 0
 *     _site_settings_v.version_video_id populated : 0
 *     payload_locked_documents_rels.videos_id     : 0
 *
 * So no video asset, no reference and no version row is lost — the columns are
 * empty everywhere they exist. Had ANY of those been non-zero this migration
 * would not have been written; the data would have had to be carried across
 * into the new rels table first.
 *
 * 🔴 `site_settings_rels` IS WHAT MAKES ORDER A STORED FACT. A `hasMany`
 * relation lives in a side table with an explicit `order` column, which is why
 * drag-to-reorder in the admin is the single source of carousel order and why
 * the serialiser is forbidden from sorting. The singular `video_id` column
 * could not express order at all — that is the real reason it had to go rather
 * than simply gaining a sibling.
 *
 * ⚠️ `videos` AND `videos_texts` ARE DELIBERATELY UNTOUCHED. The asset library
 * is unchanged; only the Site Settings REFERENCE changes shape. Nothing about
 * upload, Cloudinary, the poster relation or the sweeper is affected.
 *
 * NOTHING ELSE IS TOUCHED: no projects, media, documents, leads, users, job
 * enums or other Site Settings field appears in any statement below.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "site_settings_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"videos_id" uuid
  );
  
  CREATE TABLE "_site_settings_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"videos_id" uuid
  );
  
  ALTER TABLE "site_settings" DROP CONSTRAINT "site_settings_video_id_videos_id_fk";
  
  ALTER TABLE "_site_settings_v" DROP CONSTRAINT "_site_settings_v_version_video_id_videos_id_fk";
  
  DROP INDEX "site_settings_video_idx";
  DROP INDEX "_site_settings_v_version_version_video_idx";
  ALTER TABLE "site_settings_rels" ADD CONSTRAINT "site_settings_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings_rels" ADD CONSTRAINT "site_settings_rels_videos_fk" FOREIGN KEY ("videos_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_site_settings_v_rels" ADD CONSTRAINT "_site_settings_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_site_settings_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_site_settings_v_rels" ADD CONSTRAINT "_site_settings_v_rels_videos_fk" FOREIGN KEY ("videos_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "site_settings_rels_order_idx" ON "site_settings_rels" USING btree ("order");
  CREATE INDEX "site_settings_rels_parent_idx" ON "site_settings_rels" USING btree ("parent_id");
  CREATE INDEX "site_settings_rels_path_idx" ON "site_settings_rels" USING btree ("path");
  CREATE INDEX "site_settings_rels_videos_id_idx" ON "site_settings_rels" USING btree ("videos_id");
  CREATE INDEX "_site_settings_v_rels_order_idx" ON "_site_settings_v_rels" USING btree ("order");
  CREATE INDEX "_site_settings_v_rels_parent_idx" ON "_site_settings_v_rels" USING btree ("parent_id");
  CREATE INDEX "_site_settings_v_rels_path_idx" ON "_site_settings_v_rels" USING btree ("path");
  CREATE INDEX "_site_settings_v_rels_videos_id_idx" ON "_site_settings_v_rels" USING btree ("videos_id");
  ALTER TABLE "site_settings" DROP COLUMN "video_id";
  ALTER TABLE "_site_settings_v" DROP COLUMN "version_video_id";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_site_settings_v_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "site_settings_rels" CASCADE;
  DROP TABLE "_site_settings_v_rels" CASCADE;
  ALTER TABLE "site_settings" ADD COLUMN "video_id" uuid;
  ALTER TABLE "_site_settings_v" ADD COLUMN "version_video_id" uuid;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_site_settings_v" ADD CONSTRAINT "_site_settings_v_version_video_id_videos_id_fk" FOREIGN KEY ("version_video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "site_settings_video_idx" ON "site_settings" USING btree ("video_id");
  CREATE INDEX "_site_settings_v_version_version_video_idx" ON "_site_settings_v" USING btree ("version_video_id");`)
}
