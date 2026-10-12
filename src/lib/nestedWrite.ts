import type { PayloadRequest } from 'payload'

/**
 * Runs a nested Local API write that MUST share the caller's transaction,
 * without letting it corrupt the caller's `req`.
 *
 * ─── THE PROBLEM THIS SOLVES, MEASURED ─────────────────────────────────────
 *
 * 🔴 `payload.update({ …, req, context })` MUTATES THE `req` YOU PASS IN.
 * `createLocalReq` does not clone — it writes onto the object and returns it
 * (`payload/dist/utilities/createLocalReq.js:86,107`), and
 * `collections/operations/local/update.js:13` then does:
 *
 *     req.file = file ?? await getFileByPath(filePath)
 *
 * which is `undefined` when neither is supplied. So a nested write performed
 * from inside an `afterChange` hook leaves TWO lasting changes on the request
 * that the rest of the hook chain still has to run on:
 *
 *   1. `req.context` is REPLACED with `{ ...req.context, ...context }`, and
 *      nothing ever removes the keys that were added. Because
 *      `collections/operations/utilities/update.js:390` re-reads
 *      `context: req.context` for EVERY remaining hook, a `skipAudit: true`
 *      passed to one nested write silently suppresses every later hook that
 *      honours it.
 *   2. `req.file` is nulled, and `uploads/unlinkTempFiles.js:7` keys its
 *      cleanup off `req.file` — so the temp file of the upload that is still
 *      in flight is never removed.
 *
 * ⚠️ WHAT THAT ACTUALLY COST, before this helper existed:
 * `captureReplacedFile` runs BEFORE `auditAfterChange` on `media`, `documents`
 * and `videos` (`Media.ts` → `afterChange: [captureReplacedFile,
 * auditAfterChange]`). It performed a nested write with `skipAudit: true` to
 * record the superseded filename — which poisoned `req.context`, so
 * `auditAfterChange` hit its own `if (context?.skipAudit) return doc` guard and
 * returned. **Every file replacement went unaudited**, on the three collections
 * whose whole point is holding the published assets. The same shape in
 * `writeAuditRow` meant any request writing two audited documents lost the
 * second row.
 *
 * ─── WHY NOT JUST DROP `req` ────────────────────────────────────────────────
 *
 * Omitting `req` gives the nested call a fresh request and no poisoning — but
 * also a SEPARATE TRANSACTION. Both call sites deliberately share the caller's:
 * the audit row and the change it records must commit or roll back together,
 * and a second transaction writing the same row while the outer one still holds
 * it is a deadlock waiting for load. Sharing is correct; the mutation is the
 * accident. So: share, then put the request back as it was.
 *
 * `finally` rather than a plain sequence, so a throwing nested write cannot
 * leave the request poisoned for the hooks that still run after it.
 */
export const preservingReq = async <T>(
  req: PayloadRequest,
  run: () => Promise<T>,
): Promise<T> => {
  const context = req.context
  const file = req.file

  try {
    return await run()
  } finally {
    req.context = context
    req.file = file
  }
}
