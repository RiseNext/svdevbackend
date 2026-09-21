import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * MIGRATION 003 — the schema Payload adds the moment a task gains a `schedule`.
 *
 * 🔴 THIS IS NOT A HAND-CHOSEN SCHEMA CHANGE. It is the unavoidable consequence
 * of adding `schedule` to `purgeLeadPii`, `sweepDeletedMedia` and
 * `watchdogFailedJobs`. `config/sanitize.ts` does:
 *
 *     const hasScheduleProperty = tasks.some(t => t.schedule) || workflows.some(...)
 *     if (hasScheduleProperty) {
 *       config.jobs.scheduling = true
 *       config.globals.push(getJobStatsGlobal(config))   // <- payload-jobs-stats
 *       config.jobs.stats = true
 *     }
 *
 * So the FIRST schedule anywhere in the config registers a new global, which is
 * a new physical table. Shipping the schedules without this migration would
 * have produced a runtime failure on the first `--handle-schedules` tick, when
 * `handleSchedules()` reads the `payload-jobs-stats` global to find each task's
 * `lastScheduledRun` — and that failure would have surfaced only in production,
 * only on the maintenance worker, and only as "maintenance silently stopped".
 *
 * TWO CHANGES, BOTH ADDITIVE:
 *   · `payload_jobs_stats` — one row, a `stats` JSON blob holding
 *     `scheduledRuns.queues.<queue>.tasks.<slug>.lastScheduledRun`. This is what
 *     stops a restarted worker from re-running every schedule it missed.
 *   · `payload_jobs.meta` — Payload stamps `meta: { scheduled: true }` on jobs
 *     it queues from a schedule, distinguishing them from hook-queued jobs.
 *
 * Additive means a code rollback is safe: the previous release ignores both.
 * `down` is symmetric and was proven up -> down -> up before commit.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "payload_jobs_stats" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"stats" jsonb,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_jobs" ADD COLUMN "meta" jsonb;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "payload_jobs_stats" CASCADE;
  ALTER TABLE "payload_jobs" DROP COLUMN "meta";`)
}
