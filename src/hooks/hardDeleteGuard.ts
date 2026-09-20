import { APIError, type CollectionBeforeDeleteHook } from 'payload'

/**
 * 🔴 BLOCKS HARD DELETE — AND THIS EXISTS BECAUSE THE OFFICIAL DOCUMENTATION IS
 * MISLEADING ABOUT `trash`.
 *
 * MEASURED on payload@3.90.1, with `trash: true` set on the collection:
 *
 *   payload.delete({ collection, id })         -> SQL rows = 0   HARD DELETE
 *   payload.delete({ collection, id, trash })  -> SQL rows = 0   HARD DELETE
 *   payload.update({ id, data:{ deletedAt } }) -> row survives   SOFT DELETE
 *                                                 find({trash:true}) sees it,
 *                                                 default find hides it
 *
 * The Trash documentation says "When deleting a document from the main
 * collection LIST VIEW, Payload will soft-delete the document by default". Read
 * closely, that sentence is scoped to the ADMIN LIST VIEW. It is NOT true of the
 * Local API, and nothing on the page says so.
 *
 * WHY THAT MATTERS HERE, CONCRETELY:
 *   · FR-LEAD-14 — "a lead is a COMMERCIAL RECORD". A lead reaching
 *     `payload.delete()` by any path is gone, unrecoverably, with the audit log
 *     recording only that it happened.
 *   · D-006 / FR-PROJ-06 — "hard-deleting a project orphans a live URL and its
 *     sitemap entry", and the frontend prerenders every project.
 *
 * `trash: true` on the collection is therefore NOT sufficient on its own. This
 * hook is what actually enforces the policy.
 *
 * THE ARCHIVE PATH is `payload.update({ data: { deletedAt: <iso> } })`, and
 * RESTORE is the same update with `deletedAt: null` — which is exactly what the
 * docs prescribe for restore, and is the measured-working mechanism for both.
 */

type GuardOptions = {
  /** Human name used in the error message. */
  label: string
  /**
   * When false, NOTHING can hard-delete — not even our own code with a context
   * flag. Used for `leads`, where the requirement is absolute.
   */
  allowForced: boolean
}

const makeGuard = ({ label, allowForced }: GuardOptions): CollectionBeforeDeleteHook => {
  return async ({ req, id, context }) => {
    if (allowForced && context?.allowHardDelete === true) return

    // A soft delete is an UPDATE, so it never reaches this hook — reaching here
    // always means a genuine hard delete was attempted.
    req.payload.logger.warn(
      { id, collection: label },
      'hard delete BLOCKED — use the archive path (update deletedAt) instead',
    )

    throw new APIError(
      allowForced
        ? `A ${label} cannot be permanently deleted from here. Archive it instead — archiving removes it from the public website while keeping the record, and it can be restored later.`
        : `A ${label} is a commercial record and can never be permanently deleted. Archive it instead: archiving hides it from the admin list while keeping the record.`,
      403,
    )
  }
}

/** ABSOLUTE. FR-LEAD-14 admits no exception, so there is no force flag. */
export const blockLeadHardDelete = makeGuard({ label: 'lead', allowForced: false })

/** Blocked by default; our own code may force it with `context.allowHardDelete`. */
export const blockProjectHardDelete = makeGuard({ label: 'project', allowForced: true })

/**
 * The archive / restore helpers, so the mechanism lives in exactly one place
 * rather than being re-derived at each call site.
 */
export const archiveDocument = async (args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
  collection: string
  id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req?: any
}) =>
  args.payload.update({
    collection: args.collection,
    id: args.id,
    overrideAccess: true,
    ...(args.req ? { req: args.req } : {}),
    data: { deletedAt: new Date().toISOString() },
  })

export const restoreDocument = async (args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
  collection: string
  id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req?: any
}) =>
  args.payload.update({
    collection: args.collection,
    id: args.id,
    overrideAccess: true,
    trash: true,
    ...(args.req ? { req: args.req } : {}),
    data: { deletedAt: null },
  })
