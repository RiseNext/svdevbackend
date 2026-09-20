import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  GlobalAfterChangeHook,
  PayloadRequest,
} from 'payload'

import { env } from '@/lib/env'

/**
 * ON-DEMAND ISR REVALIDATION (D-119 / D-012).
 *
 * 🔴 WHY THIS IS A COLLECTION HOOK AND NOT ENDPOINT LOGIC:
 * Payload's admin publishes through its OWN PublishButton, which issues an
 * ordinary Local API update. It will NEVER call a custom
 * `POST /admin/projects/{id}/publish`. Realistically 100% of real publishes
 * bypass any custom endpoint, so revalidation placed in an endpoint would never
 * run — and "publishing silently does nothing visible on the website" is the
 * single most confusing possible failure for an admin.
 *
 * 🔴 FIRE-AND-FORGET WITH RETRY. A revalidation failure must NEVER fail the
 * admin's save. The direct fetch gives immediacy; the job gives the retry.
 * The admin sees "Saved. The website may take a few minutes to update." — a
 * warning, never an error.
 *
 * ⚠️ The direct fetch deliberately does NOT receive `req`. The documented
 * async-hook footgun is that "an async call made with the same req, but NOT
 * awaited, may fail resulting in an OK response being returned with response
 * data that is not committed." This call is not awaited, so it must not carry
 * the transaction.
 */

const revalidate = async (req: PayloadRequest, paths: string[], tags: string[]): Promise<void> => {
  const url = env.REVALIDATE_WEBHOOK_URL
  const secret = env.REVALIDATE_SECRET

  if (!url || !secret) {
    // Expected in local development; a hard error in production is prevented by
    // the env schema's production requirements.
    req.payload.logger.debug({ paths }, 'revalidation skipped — webhook not configured')
    return
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, paths, tags }),
      // A slow frontend must not hold a database transaction open.
      signal: AbortSignal.timeout(5_000),
    })

    if (!res.ok) {
      throw new Error(`revalidate webhook returned ${res.status}`)
    }

    req.payload.logger.info({ paths, tags }, 'revalidated')
  } catch (err) {
    req.payload.logger.warn({ err, paths }, 'direct revalidation failed — queueing retry')
    try {
      await req.payload.jobs.queue({
        task: 'revalidatePaths',
        input: { paths, tags },
        queue: 'default',
      })
    } catch (queueErr) {
      // Both paths failed. The time-based `revalidate: 3600` floor on the
      // frontend is the final backstop, so the change still appears within an
      // hour — it is just not immediate.
      req.payload.logger.error(
        { err: queueErr, paths },
        'could not queue a revalidation retry — the change will appear on the next ISR window',
      )
    }
  }
}

export const revalidateProject: CollectionAfterChangeHook & CollectionAfterDeleteHook = (async (
  args: { req: PayloadRequest; doc?: Record<string, unknown>; context?: Record<string, unknown> },
) => {
  const { req, doc, context } = args
  if (context?.skipRevalidate) return doc

  const slug = typeof doc?.slug === 'string' ? doc.slug : null
  const paths = ['/', '/projects', '/sitemap.xml']
  if (slug) paths.push(`/projects/${slug}`)

  const tags = ['projects']
  if (slug) tags.push(`project:${slug}`)

  // Deliberately NOT awaited, and deliberately NOT carrying `req`.
  void revalidate(req, paths, tags)
  return doc
}) as CollectionAfterChangeHook & CollectionAfterDeleteHook

/**
 * `site-settings` needs a REVALIDATE-EVERYTHING path, distinct from the
 * per-project set: it feeds `layout.tsx`, `PillNav`, `Footer` and `robots.txt`,
 * so a changed phone number affects every page on the site.
 */
export const revalidateEverything: GlobalAfterChangeHook = async ({ req, doc, context }) => {
  if (context?.skipRevalidate) return doc
  void revalidate(
    req,
    ['/', '/projects', '/about', '/contact', '/location', '/master-plan', '/amenities', '/sitemap.xml'],
    ['site-settings', 'projects'],
  )
  return doc
}

/** Tier-2 content: one tag per resource, plus the two pages that render them. */
export const revalidateContent =
  (tag: 'testimonials' | 'faqs' | 'statistics', paths: string[]): CollectionAfterChangeHook =>
  async ({ req, doc, context }) => {
    if (context?.skipRevalidate) return doc
    void revalidate(req, paths, [tag])
    return doc
  }
