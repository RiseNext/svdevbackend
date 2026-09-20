import configPromise from '@payload-config'
import { getPayload, type CollectionSlug, type SelectType, type Where } from 'payload'

/**
 * THE ONLY PERMITTED WAY A PUBLIC HANDLER READS CONTENT.
 *
 * Three independent layers protect every public read, and ALL THREE are required:
 *
 *   1. Collection `access.read` returns a published-only constraint for anonymous
 *      callers (see src/access). This protects Payload's OWN generated REST surface.
 *   2. `overrideAccess: false` AND `user: undefined` on every Local API call.
 *   3. An explicit, hard-coded published-only `where` the caller CANNOT override.
 *
 * WHY ALL THREE:
 *   - The Local API sets `overrideAccess: true` BY DEFAULT.
 *   - "Custom endpoints are not authenticated by default. You are responsible
 *      for securing your own endpoints."
 *   - A plain `find()` does NOT filter out drafts: "the `draft` argument on its
 *     own will not restrict documents with `_status: 'draft'` from being returned
 *     from the API." A brand-new document is always written to the MAIN table
 *     with `_status: 'draft'`, and an unpublished document is reverted there.
 *
 * One omission in one handler returns drafts, unpublished projects and full lead
 * PII — silently and unlogged. For SV Developers the leaked content is DTCP/RERA
 * approval numbers and land-title claims not cleared for publication: the
 * severity is legal, not merely technical.
 *
 * ENFORCEMENT: a CI guard fails the build if `payload.find` or `payload.findByID`
 * appears anywhere under `src/app/(public)/**` without going through this module.
 */

/** The hard-coded published-only constraint. Not exported for mutation. */
export const publishedWhere = (): Where => ({ _status: { equals: 'published' } })

/** Collections a public handler is ALLOWED to read. `leads`, `users` and
 *  `audit-log` are absent by construction — there is no way to name them. */
export type PublicReadableCollection =
  | 'projects'
  | 'testimonials'
  | 'faqs'
  | 'statistics'
  | 'media'
  | 'documents'

type PublicFindArgs<T extends PublicReadableCollection> = {
  collection: T
  /** ANDed with the published-only constraint. Cannot replace it. */
  where?: Where
  /** INCLUDE MODE ONLY, and required — never optional. Exclude mode is a
   *  deny-list and silently leaks every future field someone adds. */
  select: SelectType
  sort?: string
  limit?: number
  /** Pinned explicitly by default. Too shallow and an upload field returns a
   *  bare id string and the serialiser silently emits a broken image; too deep
   *  and the join fan-out returns the whole object graph. */
  depth?: number
}

export async function publicFind<T extends PublicReadableCollection>(args: PublicFindArgs<T>) {
  const payload = await getPayload({ config: configPromise })

  return payload.find({
    collection: args.collection as CollectionSlug,
    // LAYER 2 — the Local API defaults overrideAccess to TRUE.
    overrideAccess: false,
    user: undefined,
    // LAYER 3 — hard-coded; the caller's `where` is ANDed, never substituted,
    // and `draft` is NEVER forwarded from user input.
    where: args.where ? { and: [publishedWhere(), args.where] } : publishedWhere(),
    depth: args.depth ?? 1,
    select: args.select,
    sort: args.sort,
    limit: args.limit ?? 100,
    pagination: false,
  })
}

/**
 * Single-document read by an arbitrary unique field (in practice, `slug`).
 *
 * Deliberately implemented over `find`, not `findByID`: the public contract
 * addresses projects by SLUG, and `types/content.ts` has no `id` on `Project`
 * at all. Returns `null` rather than throwing, so the handler decides the
 * status code — which is always 404, never 403. A 403 confirms existence.
 */
export async function publicFindOne<T extends PublicReadableCollection>(
  args: PublicFindArgs<T>,
): Promise<Record<string, unknown> | null> {
  const result = await publicFind({ ...args, limit: 1 })
  return (result.docs[0] as unknown as Record<string, unknown> | undefined) ?? null
}

/** Globals have no drafts here, so the published constraint does not apply —
 *  but `overrideAccess: false` and `user: undefined` still do. */
export async function publicFindGlobal(slug: 'site-settings', select: SelectType, depth = 1) {
  const payload = await getPayload({ config: configPromise })
  return payload.findGlobal({
    slug,
    overrideAccess: false,
    user: undefined,
    depth,
    select,
  })
}
