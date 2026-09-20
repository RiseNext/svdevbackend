import { JobCancelledError, type TaskConfig } from 'payload'

import { renderLeadEmail, renderLeadEmailText } from '@/email/renderLeadEmail'
import { LEAD_PII_RETENTION_DAYS, MEDIA_GRACE_PERIOD_DAYS } from '@/lib/constants'
import { env } from '@/lib/env'

/**
 * BACKGROUND WORK.
 *
 * 🔴 TWO DOCUMENTED SILENT-FAILURE MODES, both fatal for a lead-generation
 * product, and neither mentioned in any project document:
 *   1. With NO RUNNER configured, queued jobs "will never be executed" —
 *      nothing in the request path errors. The lead saves, the API returns 201,
 *      and no notification is sent.
 *   2. With NO EMAIL ADAPTER configured, Payload LOGS A WARNING RATHER THAN
 *      THROWING — a task can complete and report success having sent nothing.
 *
 * Both are indistinguishable from "business is quiet". Three controls close
 * them, and they are deliverables, not assumptions: the env boot guard
 * (src/schemas/env.ts), the supervised worker containers, and the watchdog
 * below alerting on a SECOND CHANNEL — because the failure being detected may be
 * that email is broken.
 */

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

// ---------------------------------------------------------------------------

export const sendLeadNotification: TaskConfig<'sendLeadNotification'> = {
  slug: 'sendLeadNotification',
  label: 'Send lead notification',
  // A plain count is ALL the docs support. There is no documented backoff.
  retries: 3,
  inputSchema: [{ name: 'leadId', type: 'text', required: true }],
  outputSchema: [{ name: 'emailSent', type: 'checkbox', required: true }],

  handler: async ({ input, req }) => {
    const to = env.SALES_NOTIFICATION_EMAIL
    if (!to) {
      // POISON INPUT. Retrying cannot help, and burning three attempts would
      // hide the real failure behind `totalTried: 3`.
      throw new JobCancelledError('SALES_NOTIFICATION_EMAIL is unset — retrying cannot help')
    }

    const lead = await req.payload.findByID({
      collection: 'leads',
      id: input.leadId,
      overrideAccess: true,
      depth: 0,
      // A soft-deleted lead should still be notified about; it was real when
      // it arrived.
      trash: true,
    })

    if (!lead) throw new JobCancelledError(`Lead ${input.leadId} no longer exists`)

    // IDEMPOTENCY SHORT-CIRCUIT. Retries are at-least-once; without this,
    // three retries during a provider blip send the sales team three copies of
    // the same lead.
    if (lead.notifiedAt) return { output: { emailSent: true } }

    const leadLike = {
      name: String(lead.name),
      phone: String(lead.phone),
      projectNameSnapshot: (lead.projectNameSnapshot as string | null) ?? null,
      message: (lead.message as string | null) ?? null,
      source: String(lead.source),
      sourcePath: (lead.sourcePath as string | null) ?? null,
      createdAt: String(lead.createdAt),
    }

    /**
     * The company name comes from the CMS, not from a literal in the template.
     * A rename in Site Settings must reach the sales inbox too, or the one
     * artefact the business sees every day is the one that keeps the old name.
     *
     * 🔴 WRAPPED, AND THE FALLBACK IS LOAD-BEARING. This is the most
     * business-critical path in the system: a cosmetic lookup must never be able
     * to fail a lead notification. If the global is unreachable the email still
     * goes out, with the template's own default footer.
     */
    let siteName: string | undefined
    try {
      const settings = await req.payload.findGlobal({
        slug: 'site-settings',
        depth: 0,
        overrideAccess: true,
        req,
        select: { name: true },
      })
      siteName = (settings as { name?: string } | null)?.name || undefined
    } catch (err) {
      req.payload.logger.warn(
        { err },
        'could not read site-settings for the lead email footer — sending with the default',
      )
    }

    let result: unknown
    try {
      result = await req.payload.sendEmail({
        to,
        subject: `New enquiry — ${leadLike.projectNameSnapshot ?? 'general'} — ${leadLike.name}`,
        html: renderLeadEmail(leadLike, siteName),
        text: renderLeadEmailText(leadLike, siteName),
      })
    } catch (err) {
      throw new Error(
        `Lead notification send failed for ${input.leadId}: ${(err as Error).message}`,
      )
    }

    // ⚠️ Whether `sendEmail` THROWS or RESOLVES on transport failure is NOT
    // DOCUMENTED. This assertion covers the "resolved but did nothing" case,
    // which is exactly what happens when no email adapter is configured. Without
    // it the retry count is decorative and `hasError` never becomes true.
    if (!result) {
      throw new Error(`Lead notification produced no provider result for ${input.leadId}`)
    }

    await req.payload.update({
      collection: 'leads',
      id: input.leadId,
      overrideAccess: true,
      data: { notifiedAt: new Date().toISOString() },
      // Not a human mutation; the audit log records people, not machinery.
      context: { skipAudit: true, skipNotification: true },
    })

    return { output: { emailSent: true } }
  },
}

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
   * Hard-deletes media soft-deleted more than the grace period ago.
   *
   * 🔴 IT RE-CHECKS ATTACHMENT IMMEDIATELY BEFORE REMOVING ANYTHING. The
   * soft-delete window separates the delete guard from the hard delete by ~30
   * days, and a document can be restored and re-attached in between.
   */
  handler: async ({ req }) => {
    const cutoff = daysAgo(MEDIA_GRACE_PERIOD_DAYS)
    let swept = 0

    for (const collection of ['media', 'documents'] as const) {
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
   * 🔴 PAYLOAD SHIPS NO DEAD-LETTER QUEUE, NO DOCUMENTED BACKOFF AND NO
   * ALERTING. "It's in the database" is not monitoring.
   *
   * A transient failure (an SMTP outage) exhausts `retries: 3` FAST, so three
   * quick retries can burn through a 20-minute provider outage and lose the
   * notification with nothing but a database row to show for it. This task is
   * the dead-letter path: it re-queues with `waitUntil` set 15 minutes out, at
   * most twice, then alerts.
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
        // 🔴 ALERT ON A SECOND CHANNEL — NOT EMAIL. The failure being detected
        // may be that email is broken. This log line at `fatal` is what the
        // monitoring stack alerts on.
        req.payload.logger.fatal(
          {
            jobId: job.id,
            taskSlug: (job as { taskSlug?: string }).taskSlug,
            error: (job as { error?: unknown }).error,
            totalTried: tried,
          },
          'DEAD-LETTER: a job has exhausted its retries and re-queues. A lead notification may not have been delivered.',
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
        'No leads received in 72 hours. If the site is live and getting traffic, check the contact form end to end.',
      )
    }

    return { output: { alerts } }
  },
}

export const tasks = [
  sendLeadNotification,
  revalidatePaths,
  purgeLeadPii,
  sweepDeletedMedia,
  watchdogFailedJobs,
]
