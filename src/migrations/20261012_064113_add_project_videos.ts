import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_projects_videos_kind" AS ENUM('youtube', 'video');
  CREATE TYPE "public"."enum__projects_v_version_videos_kind" AS ENUM('youtube', 'video');
  CREATE TABLE "projects_videos" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"kind" "enum_projects_videos_kind" DEFAULT 'youtube',
  	"video_id" uuid,
  	"youtube_url" varchar,
  	"poster_id" uuid,
  	"duration" varchar,
  	"title" varchar
  );
  
  CREATE TABLE "_projects_v_version_videos" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"kind" "enum__projects_v_version_videos_kind" DEFAULT 'youtube',
  	"video_id" uuid,
  	"youtube_url" varchar,
  	"poster_id" uuid,
  	"duration" varchar,
  	"title" varchar,
  	"_uuid" varchar
  );
  
  ALTER TABLE "projects_videos" ADD CONSTRAINT "projects_videos_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "projects_videos" ADD CONSTRAINT "projects_videos_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "projects_videos" ADD CONSTRAINT "projects_videos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_projects_v_version_videos" ADD CONSTRAINT "_projects_v_version_videos_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_projects_v_version_videos" ADD CONSTRAINT "_projects_v_version_videos_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_projects_v_version_videos" ADD CONSTRAINT "_projects_v_version_videos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_projects_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "projects_videos_order_idx" ON "projects_videos" USING btree ("_order");
  CREATE INDEX "projects_videos_parent_id_idx" ON "projects_videos" USING btree ("_parent_id");
  CREATE INDEX "projects_videos_video_idx" ON "projects_videos" USING btree ("video_id");
  CREATE INDEX "projects_videos_poster_idx" ON "projects_videos" USING btree ("poster_id");
  CREATE INDEX "_projects_v_version_videos_order_idx" ON "_projects_v_version_videos" USING btree ("_order");
  CREATE INDEX "_projects_v_version_videos_parent_id_idx" ON "_projects_v_version_videos" USING btree ("_parent_id");
  CREATE INDEX "_projects_v_version_videos_video_idx" ON "_projects_v_version_videos" USING btree ("video_id");
  CREATE INDEX "_projects_v_version_videos_poster_idx" ON "_projects_v_version_videos" USING btree ("poster_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "projects_videos" CASCADE;
  DROP TABLE "_projects_v_version_videos" CASCADE;
  DROP TYPE "public"."enum_projects_videos_kind";
  DROP TYPE "public"."enum__projects_v_version_videos_kind";`)
}
