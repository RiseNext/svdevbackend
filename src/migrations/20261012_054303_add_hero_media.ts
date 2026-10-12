import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_site_settings_hero_media_kind" AS ENUM('image', 'video', 'youtube');
  CREATE TYPE "public"."enum__site_settings_v_version_hero_media_kind" AS ENUM('image', 'video', 'youtube');
  CREATE TABLE "site_settings_hero_media" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"kind" "enum_site_settings_hero_media_kind" DEFAULT 'image' NOT NULL,
  	"image_id" uuid,
  	"video_id" uuid,
  	"youtube_url" varchar,
  	"poster_id" uuid,
  	"title" varchar
  );
  
  CREATE TABLE "_site_settings_v_version_hero_media" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"kind" "enum__site_settings_v_version_hero_media_kind" DEFAULT 'image' NOT NULL,
  	"image_id" uuid,
  	"video_id" uuid,
  	"youtube_url" varchar,
  	"poster_id" uuid,
  	"title" varchar,
  	"_uuid" varchar
  );
  
  ALTER TABLE "site_settings_hero_media" ADD CONSTRAINT "site_settings_hero_media_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_settings_hero_media" ADD CONSTRAINT "site_settings_hero_media_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_settings_hero_media" ADD CONSTRAINT "site_settings_hero_media_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_settings_hero_media" ADD CONSTRAINT "site_settings_hero_media_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_site_settings_v_version_hero_media" ADD CONSTRAINT "_site_settings_v_version_hero_media_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_site_settings_v_version_hero_media" ADD CONSTRAINT "_site_settings_v_version_hero_media_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_site_settings_v_version_hero_media" ADD CONSTRAINT "_site_settings_v_version_hero_media_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_site_settings_v_version_hero_media" ADD CONSTRAINT "_site_settings_v_version_hero_media_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_site_settings_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "site_settings_hero_media_order_idx" ON "site_settings_hero_media" USING btree ("_order");
  CREATE INDEX "site_settings_hero_media_parent_id_idx" ON "site_settings_hero_media" USING btree ("_parent_id");
  CREATE INDEX "site_settings_hero_media_image_idx" ON "site_settings_hero_media" USING btree ("image_id");
  CREATE INDEX "site_settings_hero_media_video_idx" ON "site_settings_hero_media" USING btree ("video_id");
  CREATE INDEX "site_settings_hero_media_poster_idx" ON "site_settings_hero_media" USING btree ("poster_id");
  CREATE INDEX "_site_settings_v_version_hero_media_order_idx" ON "_site_settings_v_version_hero_media" USING btree ("_order");
  CREATE INDEX "_site_settings_v_version_hero_media_parent_id_idx" ON "_site_settings_v_version_hero_media" USING btree ("_parent_id");
  CREATE INDEX "_site_settings_v_version_hero_media_image_idx" ON "_site_settings_v_version_hero_media" USING btree ("image_id");
  CREATE INDEX "_site_settings_v_version_hero_media_video_idx" ON "_site_settings_v_version_hero_media" USING btree ("video_id");
  CREATE INDEX "_site_settings_v_version_hero_media_poster_idx" ON "_site_settings_v_version_hero_media" USING btree ("poster_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "site_settings_hero_media" CASCADE;
  DROP TABLE "_site_settings_v_version_hero_media" CASCADE;
  DROP TYPE "public"."enum_site_settings_hero_media_kind";
  DROP TYPE "public"."enum__site_settings_v_version_hero_media_kind";`)
}
