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
   * 🔴 IT RE-CHECKS ATTACHMENT IMMEDIATELY BEFORE REMOVING ANYTHING. The
   * soft-delete window separates the delete guard from the hard delete by ~30
   * days, and a document can be restored and re-attached in between.
   */
  handler: async ({ req }) => {
    const cutoff = daysAgo(MEDIA_GRACE_PERIOD_DAYS)
    let swept = 0

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
        // RE-CHECK. Cheap, and the alternative is deleting a live cover image.
        if (collection === 'media') {
          const stillUsed = await req.payload.find({
            collection: 'projects',
            overrideAccess: true,
            depth: 0,
            limit: 1,
            trash: true,
            where: {
              or: [
                { image: { equals: doc.id } },
                { gallery: { equals: doc.id } },
                { layoutImage: { equals: doc.id } },
                { locationMap: { equals: doc.id } },
              ],
            },
            // `id` is ALWAYS included in a result regardless of `select` — naming it
      // here is a type error, not a no-op.
      select: {},
          })
          if (stillUsed.totalDocs > 0) {
            req.payload.logger.warn(
              { id: doc.id },
              'soft-deleted media is still referenced — skipping hard delete',
            )
            continue
          }
        }

        try {
          await req.payload.delete({
            collection,
            id: doc.id,
            overrideAccess: true,
            // The real delete. Payload removes the storage object alongside it.
            trash: false,
            context: { skipAudit: true },
          })
          swept += 1
        } catch (err) {
          req.payload.logger.error({ err, id: doc.id }, 'failed to sweep media')
        }
      }
    }

    if (swept) req.payload.logger.info({ swept }, 'swept expired media')
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
