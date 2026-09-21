import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * MIGRATION 004 — drops `leads.notified_at` with the email subsystem.
 *
 * 🔴 WHY A MIGRATION AT ALL, GIVEN "DO NOT CREATE UNNECESSARY MIGRATIONS".
 * This one is not optional: `notifiedAt` was removed from the `leads` collection
 * config, and a column that exists in Postgres but not in the Payload config is
 * SCHEMA DRIFT. Drift is not cosmetic here — the next person to run
 * `migrate:create` for a genuine change would find this drop silently bundled
 * into THEIR migration, at a moment when nobody is thinking about it. Making it
 * explicit now is what keeps that from happening.
 *
 * WHAT THE COLUMN WAS FOR: it stamped the moment a `sendLeadNotification` job
 * emailed the sales inbox, and its presence short-circuited retries so an
 * at-least-once queue could not send the same enquiry three times. Nothing is
 * sent any more — an enquiry is delivered by being written to this very table
 * and read in Admin → Enquiries — so the task, the queue hop and this marker all
 * went together. A marker for an event that cannot occur is not a record; it is
 * a column that is NULL forever and misleads whoever reads the schema next.
 *
 * 🔴 THIS IS A DESTRUCTIVE MIGRATION, AND THE DISTINCTION MATTERS MORE THAN THE
 * RISK DOES HERE. RUNBOOK.md §3: after a destructive migration a code rollback
 * is NOT safe, because `down` restores STRUCTURE, NOT DATA. The `down` below is
 * honest about that — it re-adds a nullable column, and every value that was in
 * it is gone.
 *
 * The actual exposure is nil and is stated rather than assumed: the column only
 * ever held a timestamp written by a machine, no enquiry data, and this runs
 * BEFORE first production deploy, against a database with no real enquiries in
 * it. If that ever stops being true, take the backup in RUNBOOK.md §2 first —
 * which is the standing instruction for every deploy regardless.
 *
 * `leads` is deliberately UNVERSIONED (versioning an operational PII table
 * multiplies PII copies), so there is no `_leads_v` sibling table to change.
 * That is why this migration touches exactly one table, unlike 002.
 *
 * TABLE COUNT IS UNCHANGED AT 51 — this drops a column, not a table.
 *
 * ---------------------------------------------------------------------------
 * 🔶 ONE THING THIS MIGRATION DELIBERATELY DOES **NOT** DO, RECORDED SO THE
 * NEXT PERSON DOES NOT "FIX" IT.
 *
 * Migration 001 created `enum_payload_jobs_task_slug` with SIX labels, one of
 * which is `'sendLeadNotification'`. That task no longer exists, so the label is
 * now unreferenced — and it is LEFT IN PLACE.
 *
 * Postgres has no `ALTER TYPE ... DROP VALUE`. Removing one label means renaming
 * the type, recreating it, rewriting `payload_jobs.task_slug` with a USING cast
 * and dropping the old type — four statements that rewrite a table, that fail
 * outright if any row still holds the old value, and whose `down` is worse. All
 * of that to delete a string nothing reads and nothing writes.
 *
 * The cost of leaving it is one unused label visible to anyone running `\dT+`.
 * The cost of removing it is a table-rewriting migration with a failure mode. It
 * stays.
 *
 * ⚠️ CONSEQUENCE, so the difference is never mistaken for a bug: the TEST
 * database is reconciled by Drizzle `push`, which DOES rebuild the enum to the
 * four live labels. A production database migrated from 001 keeps six. The two
 * legitimately differ on exactly this one type, and nothing reads the
 * difference.
 * ---------------------------------------------------------------------------
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // IF EXISTS so a database that somehow never had the column is not a failed
  // deploy. The migration is about reaching a known end state, not about
  // asserting the start state.
  await db.execute(sql`
    ALTER TABLE "leads" DROP COLUMN IF EXISTS "notified_at";
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Structure only. The timestamps are not recoverable, and nothing reads this
  // column on the rolled-back code path either — `sendLeadNotification` treats a
  // NULL marker as "not yet sent".
  await db.execute(sql`
    ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "notified_at" timestamp(3) with time zone;
  `)
}
