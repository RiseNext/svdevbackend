import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_blog_posts_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__blog_posts_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "blog_posts" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"slug" varchar,
  	"title" varchar,
  	"excerpt" varchar,
  	"published_at" timestamp(3) with time zone,
  	"topic" varchar,
  	"author" varchar,
  	"cover_id" uuid,
  	"video_youtube_url" varchar,
  	"video_duration" varchar,
  	"external_url" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone,
  	"_status" "enum_blog_posts_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "blog_posts_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_blog_posts_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_slug" varchar,
  	"version_title" varchar,
  	"version_excerpt" varchar,
  	"version_published_at" timestamp(3) with time zone,
  	"version_topic" varchar,
  	"version_author" varchar,
  	"version_cover_id" uuid,
  	"version_video_youtube_url" varchar,
  	"version_video_duration" varchar,
  	"version_external_url" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version_deleted_at" timestamp(3) with time zone,
  	"version__status" "enum__blog_posts_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_blog_posts_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  ALTER TABLE "projects" ADD COLUMN "promo_video_youtube_url" varchar;
  ALTER TABLE "projects" ADD COLUMN "promo_video_duration" varchar;
  ALTER TABLE "_projects_v" ADD COLUMN "version_promo_video_youtube_url" varchar;
  ALTER TABLE "_projects_v" ADD COLUMN "version_promo_video_duration" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "blog_posts_id" uuid;
  ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_cover_id_media_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "blog_posts_texts" ADD CONSTRAINT "blog_posts_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_blog_posts_v" ADD CONSTRAINT "_blog_posts_v_parent_id_blog_posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."blog_posts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_blog_posts_v" ADD CONSTRAINT "_blog_posts_v_version_cover_id_media_id_fk" FOREIGN KEY ("version_cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_blog_posts_v_texts" ADD CONSTRAINT "_blog_posts_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_blog_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "blog_posts_slug_idx" ON "blog_posts" USING btree ("slug");
  CREATE INDEX "blog_posts_published_at_idx" ON "blog_posts" USING btree ("published_at");
  CREATE INDEX "blog_posts_cover_idx" ON "blog_posts" USING btree ("cover_id");
  CREATE INDEX "blog_posts_updated_at_idx" ON "blog_posts" USING btree ("updated_at");
  CREATE INDEX "blog_posts_created_at_idx" ON "blog_posts" USING btree ("created_at");
  CREATE INDEX "blog_posts_deleted_at_idx" ON "blog_posts" USING btree ("deleted_at");
  CREATE INDEX "blog_posts__status_idx" ON "blog_posts" USING btree ("_status");
  CREATE INDEX "blog_posts_texts_order_parent" ON "blog_posts_texts" USING btree ("order","parent_id");
  CREATE INDEX "_blog_posts_v_parent_idx" ON "_blog_posts_v" USING btree ("parent_id");
  CREATE INDEX "_blog_posts_v_version_version_slug_idx" ON "_blog_posts_v" USING btree ("version_slug");
  CREATE INDEX "_blog_posts_v_version_version_published_at_idx" ON "_blog_posts_v" USING btree ("version_published_at");
  CREATE INDEX "_blog_posts_v_version_version_cover_idx" ON "_blog_posts_v" USING btree ("version_cover_id");
  CREATE INDEX "_blog_posts_v_version_version_updated_at_idx" ON "_blog_posts_v" USING btree ("version_updated_at");
  CREATE INDEX "_blog_posts_v_version_version_created_at_idx" ON "_blog_posts_v" USING btree ("version_created_at");
  CREATE INDEX "_blog_posts_v_version_version_deleted_at_idx" ON "_blog_posts_v" USING btree ("version_deleted_at");
  CREATE INDEX "_blog_posts_v_version_version__status_idx" ON "_blog_posts_v" USING btree ("version__status");
  CREATE INDEX "_blog_posts_v_created_at_idx" ON "_blog_posts_v" USING btree ("created_at");
  CREATE INDEX "_blog_posts_v_updated_at_idx" ON "_blog_posts_v" USING btree ("updated_at");
  CREATE INDEX "_blog_posts_v_latest_idx" ON "_blog_posts_v" USING btree ("latest");
  CREATE INDEX "_blog_posts_v_texts_order_parent" ON "_blog_posts_v_texts" USING btree ("order","parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_blog_posts_fk" FOREIGN KEY ("blog_posts_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_blog_posts_id_idx" ON "payload_locked_documents_rels" USING btree ("blog_posts_id");`)
}

/**
 * 🔴 THE STATEMENT ORDER HERE WAS CORRECTED BY HAND, AND THE GENERATED ORDER
 * WAS BROKEN. MEASURED, not theorised: running `payload migrate:down` against
 * the local test database failed with
 *
 *     constraint "payload_locked_documents_rels_blog_posts_fk"
 *     of relation "payload_locked_documents_rels" does not exist
 *
 * `migrate:create` emitted `DROP TABLE "blog_posts" CASCADE` BEFORE
 * `ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT …_blog_posts_fk`.
 * But `CASCADE` already removes every constraint that depends on the dropped
 * table — including that foreign key and its index — so by the time the
 * explicit DROP ran there was nothing left to drop, and Postgres raised rather
 * than no-op'd. Payload then rolled the whole transaction back, leaving this
 * migration recorded as applied while the two after it had been reverted.
 *
 * ⚠️ THE FIX IS ORDERING ONLY — the `payload_locked_documents_rels` cleanup now
 * runs BEFORE the table drops, so the constraint and index exist when they are
 * named. No statement was added or removed and the end state is identical; what
 * changed is that it now actually reaches that end state. `IF EXISTS` was
 * deliberately NOT used instead: it would have hidden the ordering bug rather
 * than fixed it, and a `down` that silently skips steps is worse than one that
 * fails loudly.
 *
 * ⚠️ THIS IS A ROLLBACK PATH, NOT A DEPLOY PATH. `up` was always correct and is
 * untouched — the forward migration applied cleanly from an empty database
 * before this was found. Only `migrate:down` was affected.
 *
 * 🔴 IT IS STILL DESTRUCTIVE BY DESIGN. Reverting this drops `blog_posts` and
 * its version tables, so EVERY published and draft post is lost, and drops the
 * two `promoVideo` columns, so every pasted project link is lost. Take a
 * database snapshot before ever running it against real content.
 */
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "blog_posts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "blog_posts_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_blog_posts_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_blog_posts_v_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_blog_posts_fk";
  DROP INDEX "payload_locked_documents_rels_blog_posts_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "blog_posts_id";
  DROP TABLE "blog_posts" CASCADE;
  DROP TABLE "blog_posts_texts" CASCADE;
  DROP TABLE "_blog_posts_v" CASCADE;
  DROP TABLE "_blog_posts_v_texts" CASCADE;
  ALTER TABLE "projects" DROP COLUMN "promo_video_youtube_url";
  ALTER TABLE "projects" DROP COLUMN "promo_video_duration";
  ALTER TABLE "_projects_v" DROP COLUMN "version_promo_video_youtube_url";
  ALTER TABLE "_projects_v" DROP COLUMN "version_promo_video_duration";
  DROP TYPE "public"."enum_blog_posts_status";
  DROP TYPE "public"."enum__blog_posts_v_version_status";`)
}
