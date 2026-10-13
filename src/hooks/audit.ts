import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  GlobalAfterChangeHook,
  PayloadRequest,
} from 'payload'

import type { AuditActionValue } from '@/lib/constants'
import { preservingReq } from '@/lib/nestedWrite'

/**
 * THE AUDIT LOG — and why Payload's version history does NOT satisfy it.
 *
 * Two project documents rate `audit_log` as "🟡 Payload's version history covers
 * part of it". THAT WORDING IS THE ACTUAL HAZARD: a future session reads it and
 * trusts it. The documented version-document shape is exactly `_id`, `parent`,
 * `autosave`, `version`, `createdAt`, `updatedAt`. Measured against the
 * requirement, versions fail on five counts:
 *
 *   · no actor      — there is no `createdBy`, no `user`
 *   · no IP address
 *   · no action type — must be inferred from `_status` deltas
 *   · NO AUTH EVENTS AT ALL — login/logout/lockout/password change produce no version
 *   · NOT APPEND-ONLY — `maxPerDoc` discards old versions and `restoreVersion` mutates
 *
 * Versions contribute before/after RECONSTRUCTION only. Everything else is here.
 *
 * 🔴 TWO DESIGN RULES THAT FOLLOW:
 * 1. These hooks live on COLLECTIONS, never on custom endpoints. Payload's admin
 *    publishes through its own PublishButton -> an ordinary Local API update. It
 *    will NEVER call `POST /admin/projects/{id}/publish`. Realistically 100% of
 *    real publishes bypass any custom endpoint, so endpoint-based audit would
 *    produce a log with a hole exactly where the legally sensitive edits are.
 * 2. `overrideAccess` defaults to TRUE in the Local API, so `create: () => false`
 *    on `audit-log` does not stop OUR OWN code writing carelessly. It blocks
 *    REST, GraphQL and the Admin UI — the threat model that matters.
 */

/**
 * Sensitive fields only — an ALLOW-LIST, not a whole-document diff.
 * Per `SECURITY.md` §13: approvals, area, proximity, "anything title-related".
 * It must NEVER capture lead PII, which is why `leads` is absent from the list.
 */
const SENSITIVE_FIELDS = [
  'approvals',
  'area',
  'proximity',
  'name',
  'slug',
  'category',
  'projectStatus',
  'locality',
  'developer',
  'locationHighlights',
  'amenities',
  'highlights',
  'consented',
  'email',
  'phone',
  'whatsapp',
  'url',
  'legalName',
  /**
   * 🔴 `filename` — ADDED, AND IT SOLVES A PROBLEM THAT LOOKED LIKE IT NEEDED A
   * MIGRATION.
   *
   * On `media`/`documents`/`videos` the filename IS the storage key, and it
   * changes on every file replacement (the upload guard renames to a fresh
   * UUID). Without it in this list, replacing a file produced an audit row with
   * `changes: null` — recording that something was edited but not WHICH object
   * was superseded. That was the audit gap.
   *
   * It is also, as a side effect, the fix for the `supersededFilenames`
   * timestamp problem. `sweepDeletedMedia`'s scope limit says safe collection of
   * replaced objects is impossible because `supersededFilenames` is a bare
   * `string[]` with no record of WHEN each key was superseded, and that the
   * remedy was to restructure the field into `{ filename, replacedAt }[]` — a
   * child table, a migration and a backfill.
   *
   * ⚠️ THAT MIGRATION IS NOT NEEDED. `audit_log` already is an append-only,
   * timestamped store, and this one entry puts the superseded key in it. "Which
   * storage objects were superseded more than N days ago" becomes a query —
   * `action=update`, `entityType=media`, `changes->filename->>'from'`, filtered
   * on `createdAt` — against a table that cannot be edited through any
   * interface. That is a STRONGER guarantee than a mutable array field on the
   * document would have given, at zero migration risk.
   *
   * It does NOT arm any cleanup. `MEDIA_SWEEP_ENABLED` stays off and the sweeper
   * still does not touch superseded keys; this only makes a future, separately
   * reviewed implementation possible on real data instead of a guess.
   *
   * Scoped naturally: only upload collections have a `filename`, so nothing
   * else's audit rows change. It is not lead PII — `leads` has no filename.
   */
  'filename',
] as const

const clientIp = (req: PayloadRequest): string | null => {
  const h = req.headers
  const forwarded = h?.get?.('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 100)
  return h?.get?.('x-real-ip')?.slice(0, 100) ?? null
}

/** A stable, size-bounded JSON snapshot of one field's value. */
const snapshot = (value: unknown): unknown => {
  if (value === undefined) return null
  try {
    const json = JSON.stringify(value)
    // A 96-item feature array is legitimate; a megabyte of it in every audit row
    // is not. Truncate rather than drop, so the fact of the change survives.
    if (json && json.length > 4000) return `[truncated ${json.length} chars]`
    return value
  } catch {
    return '[unserialisable]'
  }
}

export const diffSensitiveFields = (
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> | null => {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of SENSITIVE_FIELDS) {
    const before = previous?.[field]
    const after = next[field]
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue
    changes[field] = { from: snapshot(before), to: snapshot(after) }
  }
  return Object.keys(changes).length ? changes : null
}

/**
 * `create | update | publish | unpublish`.
 *
 * Publish/unpublish are DERIVED from the `_status` delta, because Payload's own
 * PublishButton is an ordinary update — there is no distinct operation to hook.
 */
export const deriveAction = (
  operation: string,
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): AuditActionValue => {
  /**
   * 🔴 `restore` IS DERIVED HERE, AND IT HAD TO BE DERIVED SOMEWHERE.
   *
   * `restore` has been in `AUDIT_ACTIONS` — and in the Postgres enum — since
   * the first migration, and NOTHING EVER WROTE IT. Verified empirically: the
   * count of `restore` rows was zero after a full archive/restore round trip
   * across all six content collections.
   *
   * The reason it was missed is the same reason archiving is logged as
   * `update`: a soft delete and an un-delete are both ordinary updates that set
   * or clear `deletedAt`, so there is no distinct operation and no hook of
   * their own. Deriving from the delta is exactly how `publish`/`unpublish`
   * already work, so this is the established pattern rather than a new one.
   *
   * ⚠️ CHECKED BEFORE `_status`. Restoring a trashed document that was
   * published also restores `_status: 'published'`, so the publish branch below
   * would otherwise claim the event and the restore would be invisible again —
   * recorded as a `publish` that nobody performed. The `deletedAt` transition is
   * the more specific fact, so it wins.
   *
   * ⚠️ ARCHIVING IS DELIBERATELY STILL `update`. The enum has no `archive`
   * value, and reusing `delete` would make a reversible archive
   * indistinguishable from a permanent destruction in the one record an auditor
   * relies on. Left alone pending a decision on adding the value.
   */
  const wasTrashed = Boolean(previous?.deletedAt)
  const isTrashed = Boolean(next.deletedAt)
  if (operation === 'update' && wasTrashed && !isTrashed) return 'restore'

  const before = previous?._status
  const after = next._status
  if (after === 'published' && before !== 'published') return 'publish'
  if (before === 'published' && after === 'draft') return 'unpublish'
  if (operation === 'create') return 'create'
  return 'update'
}

type WriteArgs = {
  req: PayloadRequest
  action: AuditActionValue
  entityType: string
  entityId: string
  changes?: Record<string, unknown> | null
}

/**
 * The single writer. Shared by the collection hooks, the global hook and the
 * auth-event hooks so the row shape can never diverge between them.
 *
 * Wrapped in try/catch DELIBERATELY: an audit failure must not roll back the
 * mutation it was recording. A missing audit row is a gap we can see in the log;
 * a failed publish because the audit table was briefly unavailable is worse.
 */
export const writeAuditRow = async (args: WriteArgs): Promise<void> => {
  const { req, action, entityType, entityId, changes } = args
  try {
    // 🔴 `preservingReq` — without it the `skipAudit: true` below sticks to
    // `req.context` for the rest of the request, so a mutation that writes TWO
    // audited documents loses the second row. See src/lib/nestedWrite.ts.
    await preservingReq(req, () =>
      req.payload.create({
        collection: 'audit-log',
        // `create: () => false` blocks REST/GraphQL/admin. Hooks are the only
        // sanctioned writer, and this flag is what lets them through.
        overrideAccess: true,
        // Share the mutation's transaction so the audit row and the change
        // commit or roll back together.
        req,
        data: {
          adminUser: (req.user?.id as string | undefined) ?? null,
          action,
          entityType,
          entityId,
          changes: changes ?? null,
          ipAddress: clientIp(req),
        },
        // Prevent recursion if anything is ever hooked onto audit-log itself.
        context: { skipAudit: true },
      }),
    )
  } catch (err) {
    req.payload.logger.error(
      { err, action, entityType, entityId },
      'failed to write audit row — the mutation itself was NOT rolled back',
    )
  }
}

export const auditAfterChange: CollectionAfterChangeHook = async ({
  req,
  doc,
  previousDoc,
  operation,
  collection,
  context,
}) => {
  if (context?.skipAudit) return doc
  // ⚠️ The hook-argument property identifying an AUTOSAVE write is not documented.
  // This is safe today ONLY because autosave is OFF everywhere (D-028). Before
  // autosave is ever enabled, the signal must be established empirically, or this
  // hook floods the audit log at the documented 800ms interval.
  await writeAuditRow({
    req,
    action: deriveAction(operation, previousDoc as Record<string, unknown> | null, doc),
    entityType: collection.slug,
    entityId: String(doc.id),
    changes: diffSensitiveFields(previousDoc as Record<string, unknown> | null, doc),
  })
  return doc
}

/** Trash (soft delete) fires this too, which is the behaviour we want recorded. */
export const auditAfterDelete: CollectionAfterDeleteHook = async ({
  req,
  doc,
  collection,
  context,
}) => {
  if (context?.skipAudit) return doc
  await writeAuditRow({
    req,
    action: 'delete',
    entityType: collection.slug,
    entityId: String(doc?.id ?? 'unknown'),
    changes: null,
  })
  return doc
}

/** Globals have a SHORTER hook set than collections — no delete hooks at all,
 *  because a global cannot be deleted. */
export const auditGlobalAfterChange: GlobalAfterChangeHook = async ({
  req,
  doc,
  previousDoc,
  global,
  context,
}) => {
  if (context?.skipAudit) return doc
  await writeAuditRow({
    req,
    action: 'update',
    entityType: global.slug,
    entityId: global.slug,
    changes: diffSensitiveFields(previousDoc as Record<string, unknown> | null, doc),
  })
  return doc
}
