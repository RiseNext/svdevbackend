import { JobCancelledError, type TaskConfig } from 'payload'

import {
  LEAD_PII_RETENTION_DAYS,
  MAINTENANCE_QUEUE,
  MEDIA_GRACE_PERIOD_DAYS,
} from '@/lib/constants'
import { env } from '@/lib/env'

/**
 * BACKGROUND WORK — FOUR TASKS, AND NONE OF THEM TOUCHES AN ENQUIRY.
 *
 * 🔴 THERE IS NO `sendLeadNotification` TASK, AND ITS ABSENCE IS THE DESIGN.
 * An enquiry is delivered by being WRITTEN TO THE DATABASE; the administrator
 * reads it in Admin → Enquiries. There is no notification to send, so there is
 * no queue hop between the visitor pressing Submit and the enquiry being
 * durably stored and visible. That removes the single largest silent-failure
 * surface the previous design had: a lead could save, return 201, and be
 * announced to nobody because a worker was dead or a mail provider was down.
 *
 * ⚠️ The remaining runner-death failure mode is real but NO LONGER TOUCHES
 * ENQUIRY DATA. With no runner, `revalidatePaths` retries never run (the site
 * updates on its next ISR window instead) and the two maintenance tasks below
 * stop. Nothing is lost; something is merely late.
 */

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

/**
 * Is this error one of the in-use guards refusing, rather than a real failure?
 *
 * `mediaDeleteGuard` / `videoDeleteGuard` / `documentDeleteGuard` all throw
 * `APIError(…, 409)`. An asset that was restored and re-attached during the
 * 30-day grace window SHOULD be refused, so that outcome is a skip-and-warn,
 * not an error — and keeping the distinction means a genuine fault (a dead
 * Cloudinary, a constraint violation) still surfaces as `error`.
 *
 * Matched on `status` rather than on the message, so rewording a guard cannot
 * silently reclassify a refusal as a failure.
 */
const isInUseRefusal = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 409

// ---------------------------------------------------------------------------

export const revalidatePaths: TaskConfig<'revalidatePaths'> = {
  slug: 'revalidatePaths',
  label: 'Revalidate website paths',
  retries: 5,
  inputSchema: [
    { name: 'paths', type: 'text', hasMany: true, required: true },
    { name: 'tags', type: 'text', hasMany: true },
  ],
  outputSchema: [{ name: 'revalidated', type: 'checkbox', required: true }],

  handler: async ({ input, req }) => {
    const url = env.REVALIDATE_WEBHOOK_URL
    const secret = env.REVALIDATE_SECRET
    if (!url || !secret) {
      throw new JobCancelledError('Revalidation webhook is not configured — retrying cannot help')
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, paths: input.paths, tags: input.tags ?? [] }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      // A 401 means the shared secret does not match — retrying will not fix it,
      // and the mismatch is otherwise INVISIBLE: content appears to publish and
      // the site silently never updates.
      if (res.status === 401 || res.status === 403) {
        throw new JobCancelledError(
          `Revalidation rejected with ${res.status} — REVALIDATE_SECRET does not match the frontend`,
        )
      }
      throw new Error(`Revalidation webhook returned ${res.status}`)
    }

    req.payload.logger.info({ paths: input.paths }, 'revalidated via retry job')
    return { output: { revalidated: true } }
  },
}

// ---------------------------------------------------------------------------

export const purgeLeadPii: TaskConfig<'purgeLeadPii'> = {
  slug: 'purgeLeadPii',
  label: 'Purge lead PII',
  retries: 2,
  inputSchema: [],
  outputSchema: [{ name: 'purged', type: 'number', required: true }],

  /**
   * DAILY, 21:45 UTC = 03:15 IST.
   *
   * The retention window is LEAD_PII_RETENTION_DAYS = 90 days, so the deadline
   * this enforces moves once per day. Anything finer buys nothing and re-reads
   * the same rows; anything coarser lets a record sit past its window for up to
   * that interval. Daily is the coarsest cadence that still lands the purge
   * within 24h of the boundary.
   *
   * Off-peak for an Indian audience, and on a :15/:45 boundary so it is picked
   * up on the maintenance worker's very next tick rather than waiting up to a
   * further 15 minutes.
   */
  schedule: [{ cron: '45 21 * * *', queue: MAINTENANCE_QUEUE }],

  /**
   * FR-LEAD-16 / DPDP. Nulls `ipAddress` and `userAgent` on leads older than the
   * retention window. The LEAD RECORD ITSELF IS NOT DELETED — a lead is a
   * commercial record.
   *
   * 🔶 The lead record's own lifetime is UNDEFINED IN EVERY SOURCE DOCUMENT and
   * is an owner decision before go-live. Under DPDP, "define a lifetime" is not
   * a retention policy.
   */
  handler: async ({ req }) => {
    const cutoff = daysAgo(LEAD_PII_RETENTION_DAYS)
    const stale = await req.payload.find({
      collection: 'leads',
      overrideAccess: true,
      depth: 0,
      limit: 500,
      trash: true,
      where: {
        and: [
          { createdAt: { less_than: cutoff } },
          { or: [{ ipAddress: { exists: true } }, { userAgent: { exists: true } }] },
        ],
      },
      // `id` is ALWAYS included in a result regardless of `select` — naming it
      // here is a type error, not a no-op.
      select: {},
    })

    let purged = 0
    for (const doc of stale.docs) {
      try {
        await req.payload.update({
          collection: 'leads',
          id: doc.id,
          overrideAccess: true,
          data: { ipAddress: null, userAgent: null },
          context: { skipAudit: true, skipNotification: true },
        })
        purged += 1
      } catch (err) {
        req.payload.logger.error({ err, id: doc.id }, 'failed to purge PII for lead')
      }
    }

    if (purged) req.payload.logger.info({ purged }, 'purged lead PII')
    return { output: { purged } }
  },
}

// ---------------------------------------------------------------------------

export const sweepDeletedMedia: TaskConfig<'sweepDeletedMedia'> = {
  slug: 'sweepDeletedMedia',
  label: 'Sweep deleted media',
  retries: 2,
  inputSchema: [],
  outputSchema: [{ name: 'swept', type: 'number', required: true }],

  /**
   * DAILY, 22:15 UTC = 03:45 IST.
   *
   * MEDIA_GRACE_PERIOD_DAYS = 30, so like the PII purge this deadline advances
   * once a day and daily is the matching cadence.
   *
   * 🔴 DELIBERATELY 30 MINUTES AFTER `purgeLeadPii`, NOT ALONGSIDE IT. Both run
   * on the single maintenance worker, and this task issues real deletes against
   * Cloudinary. Overlapping them on one worker would serialise anyway, but
   * staggering keeps a slow Cloudinary response from delaying a compliance task,
   * and keeps the two apart in the logs when something goes wrong.
   */
  schedule: [{ cron: '15 22 * * *', queue: MAINTENANCE_QUEUE }],

  /**
   * Hard-deletes media soft-deleted more than the grace period ago.
   *
   * ─── 🔴 THIS TASK HAD NEVER DELETED ANYTHING. MEASURED. ────────────────────
   *
   * It passed `trash: false` to `payload.delete` against rows it had just
   * selected with `trash: true` — i.e. rows whose `deletedAt` IS set.
   * `deleteByID` runs `appendNonTrashedFilter({ enableTrash, trash, where })`
   * (payload/dist/collections/operations/deleteByID.js:50-54), which with
   * `enableTrash: true` and a falsy `trash` ANDs `deletedAt exists: false` into
   * the lookup. `db.findOne` therefore matched NOTHING, and because
   * `overrideAccess: true` makes `hasWhereAccessResult(true)` false, line 62
   * threw `NotFound` — straight into this task's own catch, which logged
   * "failed to sweep media", left `swept` at 0, and returned SUCCESS. So the
   * watchdog never flagged it either. Soft-deleted objects accumulated in
   * Cloudinary indefinitely, silently, for every row this job ever examined.
   *
   * `trash: true` is the fix. One word, and it converts a dormant no-op into a
   * live destroyer — which is why the rest of this rewrite exists.
   *
   * ─── WHY THE IN-USE RE-CHECK IS NOW DELEGATED ──────────────────────────────
   *
   * The previous re-check inspected FOUR fields on `projects` and only for
   * `media`: `image`, `gallery`, `layoutImage`, `locationMap`. It silently
   * omitted `projects.logo`, `projects.videos[].poster`, `blog-posts.cover`,
   * `site-settings.logo` and `site-settings.heroMedia[]` — all of which
   * `mediaDeleteGuard` DOES check — and did no check at all for `videos` or
   * `documents`. Two definitions of "in use", one of them wrong, is how an
   * asset that something still points at gets destroyed.
   *
   * So there is now exactly ONE definition, and it is the guards'.
   * `payload.delete` runs `beforeDelete` hooks UNCONDITIONALLY, regardless of
   * `overrideAccess` (deleteByID.js:69-79), so `mediaDeleteGuard` /
   * `videoDeleteGuard` / `documentDeleteGuard` all fire here exactly as they do
   * for an administrator. A 409 from one of them means "still referenced" and
   * is treated as a SKIP, not an error — the sweeper cannot drift from the
   * guards because it no longer has an opinion of its own.
   *
   * ─── DISARMED BY DEFAULT ───────────────────────────────────────────────────
   *
   * `MEDIA_SWEEP_ENABLED` defaults to false. In that state this does the full
   * scan, runs the real guards, and logs precisely what it WOULD destroy
   * without destroying it. See the note on the env var.
   *
   * ─── 🔶 SCOPE LIMIT: SUPERSEDED (REPLACED) OBJECTS ARE NOT SWEPT YET ───────
   *
   * This task sweeps soft-deleted ROWS. It does NOT sweep the objects left
   * behind by a FILE REPLACEMENT, which `handleDelete` now deliberately
   * preserves (src/media/cloudinary.ts) and `captureReplacedFile` records in
   * `supersededFilenames`.
   *
   * RECORDED RATHER THAN QUIETLY SKIPPED, because the trade is deliberate:
   *   · BEFORE, a replaced object was DESTROYED in the same request — an
   *     accidental wrong-file replace was unrecoverable. That is data loss.
   *   · NOW it survives and is never collected. That is bounded storage growth
   *     — a few MB a year at this site's replacement rate.
   * A leak you can clean up later beats bytes you cannot get back, so shipping
   * the preservation half first is correct even though the collection half is
   * not here yet.
   *
   * WHY IT IS NOT DONE HERE: expiring a superseded key needs to know WHEN it
   * was superseded, and `supersededFilenames` is a bare `string[]` with no
   * timestamps. Doing it properly means changing that field to
   * `{ filename, replacedAt }[]` — a child table, a migration and a backfill.
   * The alternatives are worse: using the row's `updatedAt` as a proxy is only
   * a conservative lower bound (any later edit defers cleanup indefinitely),
   * and reconstructing storage keys inside this job would duplicate the
   * plugin's own path logic — which is precisely the two-definitions-of-one-
   * thing drift that produced the in-use bug this rewrite just removed.
   *
   * Until then, superseded objects are cleaned up by hand; every one of them is
   * listed in its own row's `supersededFilenames`.
   */
  handler: async ({ req }) => {
    const cutoff = daysAgo(MEDIA_GRACE_PERIOD_DAYS)
    const armed = env.MEDIA_SWEEP_ENABLED
    let swept = 0
    let wouldSweep = 0
    let skippedInUse = 0

    // `videos` joins the existing list — the sweeper is collection-agnostic and
    // the adapter's `handleDelete` derives the Cloudinary resource type from the
    // filename, so a swept video is destroyed as `video` rather than orphaned.
    for (const collection of ['media', 'documents', 'videos'] as const) {
      const expired = await req.payload.find({
        collection,
        overrideAccess: true,
        depth: 0,
        limit: 100,
        trash: true,
        where: { deletedAt: { less_than: cutoff } },
        select: { id: true, filename: true },
      })

      for (const doc of expired.docs) {
        /**
         * DRY RUN. The in-use guards only run as part of a real delete, so a
         * disarmed pass cannot prove a given row is safe — it reports the
         * CANDIDATE set, which is the thing an operator needs to eyeball before
         * arming. Stated plainly in the log so nobody reads it as "verified".
         */
        if (!armed) {
          wouldSweep += 1
          req.payload.logger.info(
            {
              collection,
              id: doc.id,
              filename: (doc as { filename?: unknown }).filename ?? null,
              armed: false,
            },
            'media sweep DRY RUN — would hard-delete this expired row (in-use guards not yet run; set MEDIA_SWEEP_ENABLED=true to arm)',
          )
          continue
        }

        try {
          await req.payload.delete({
            collection,
            id: doc.id,
            overrideAccess: true,
            // 🔴 `trash: true` — WITHOUT IT THE LOOKUP CANNOT FIND THE ROW IT
            // WAS JUST HANDED, and every iteration throws NotFound. See the
            // long note above.
            trash: true,
            context: { skipAudit: true },
          })
          swept += 1
        } catch (err) {
          // A 409 is one of the in-use guards refusing: the asset was restored
          // and re-attached during the grace window, which is a legitimate
          // outcome and not a failure.
          if (isInUseRefusal(err)) {
            skippedInUse += 1
            req.payload.logger.warn(
              { collection, id: doc.id, reason: (err as Error).message },
              'expired media is still referenced — skipping hard delete',
            )
            continue
          }
          req.payload.logger.error({ err, collection, id: doc.id }, 'failed to sweep media')
        }
      }
    }

    if (!armed && wouldSweep) {
      req.payload.logger.warn(
        { wouldSweep },
        'media sweep is DISARMED — nothing was deleted. Review the dry-run lines above, then set MEDIA_SWEEP_ENABLED=true.',
      )
    }
    if (swept || skippedInUse) {
      req.payload.logger.info({ swept, skippedInUse }, 'swept expired media')
    }
    return { output: { swept } }
  },
}

// ---------------------------------------------------------------------------

export const watchdogFailedJobs: TaskConfig<'watchdogFailedJobs'> = {
  slug: 'watchdogFailedJobs',
  label: 'Watchdog: failed and stuck jobs',
  retries: 1,
  inputSchema: [],
  outputSchema: [{ name: 'alerts', type: 'number', required: true }],

  /**
   * EVERY 15 MINUTES — the one task here that is not daily, and the interval is
   * not arbitrary.
   *
   * The handler re-queues a failed job with `waitUntil` set 15 minutes out. A
   * cadence LONGER than that leaves a re-queued job sitting past its own wait;
   * a cadence SHORTER re-examines jobs that are still deliberately waiting and
   * inflates `totalTried` without doing any work. Matching the two makes each
   * tick pick up exactly the jobs whose delay has just expired.
   *
   * It also matches the maintenance worker's own poll interval
   * (`--cron "*\/15 * * * *"` in docker-compose.prod.yml), so a due watchdog run
   * is never left waiting for the next tick.
   */
  schedule: [{ cron: '*/15 * * * *', queue: MAINTENANCE_QUEUE }],

  /**
   * 🔴 PAYLOAD SHIPS NO DEAD-LETTER QUEUE, NO DOCUMENTED BACKOFF AND NO
   * ALERTING. "It's in the database" is not monitoring.
   *
   * ⚠️ SCOPE, NARROWED SINCE THE EMAIL SUBSYSTEM WAS REMOVED. No enquiry data
   * can reach this path any more — an enquiry is stored synchronously and never
   * queued. What this now catches is a stuck or repeatedly-failing
   * `revalidatePaths`, whose visible symptom is "publishing does nothing to the
   * website", and any maintenance task that has started failing.
   *
   * It re-queues with `waitUntil` set 15 minutes out, at most six times, then
   * escalates to a `fatal` log line — which is what a log-based alert watches.
   *
   * ⚠️ `onFail` / `onSuccess` are DELIBERATELY NOT USED — they are listed in the
   * options table with no signature, no arguments and no example anywhere.
   */
  handler: async ({ req }) => {
    const failed = await req.payload.find({
      collection: 'payload-jobs',
      overrideAccess: true,
      depth: 0,
      limit: 100,
      where: { hasError: { equals: true } },
    })

    let alerts = 0
    for (const job of failed.docs) {
      const tried = Number((job as { totalTried?: number }).totalTried ?? 0)
      const requeues = Number((job as { waitUntil?: unknown; totalTried?: number }).totalTried ?? 0)

      if (requeues < 6) {
        try {
          await req.payload.update({
            collection: 'payload-jobs',
            id: job.id,
            overrideAccess: true,
            data: {
              hasError: false,
              processing: false,
              waitUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            },
          })
          req.payload.logger.warn(
            { jobId: job.id, taskSlug: (job as { taskSlug?: string }).taskSlug, tried },
            'watchdog re-queued a failed job with a 15 minute delay',
          )
        } catch (err) {
          req.payload.logger.error({ err, jobId: job.id }, 'watchdog could not re-queue job')
        }
      } else {
        // The escalation. A `fatal` log line is the alert channel — the product
        // has no email, and adding one purely to alert about itself would be the
        // notification system this project deliberately does not have.
        req.payload.logger.fatal(
          {
            jobId: job.id,
            taskSlug: (job as { taskSlug?: string }).taskSlug,
            error: (job as { error?: unknown }).error,
            totalTried: tried,
          },
          'DEAD-LETTER: a job has exhausted its retries and re-queues. Enquiry data is unaffected — enquiries are stored synchronously — but background work is failing.',
        )
      }
      alerts += 1
    }

    // The only control that catches a COMPLETELY silent failure: zero leads in
    // 72 hours. Operational observability, not analytics — no third-party
    // script, no cookie, no DPDP consequence.
    const recent = await req.payload.find({
      collection: 'leads',
      overrideAccess: true,
      depth: 0,
      limit: 1,
      trash: true,
      where: { createdAt: { greater_than: daysAgo(3) } },
      // `id` is ALWAYS included in a result regardless of `select` — naming it
      // here is a type error, not a no-op.
      select: {},
    })
    if (recent.totalDocs === 0) {
      req.payload.logger.warn(
        {},
        'No enquiries received in 72 hours. If the site is live and getting traffic, submit the contact form yourself and check it appears in Admin → Enquiries.',
      )
    }

    return { output: { alerts } }
  },
}

export const tasks = [revalidatePaths, purgeLeadPii, sweepDeletedMedia, watchdogFailedJobs]
