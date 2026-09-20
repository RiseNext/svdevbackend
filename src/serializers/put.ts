/**
 * THE OMIT-DON'T-EMPTY PRIMITIVE — one emptiness rule, written down once.
 *
 *   undefined -> omit
 *   null      -> omit
 *   '' (after trim) -> omit
 *   []        -> omit
 *
 *   0     is KEPT.
 *   false is KEPT.
 *   A bracketed placeholder string is KEPT VERBATIM.
 *
 * WHY THIS EXISTS: Payload provides ZERO tooling for omit-don't-empty, and this
 * is the finding that most strongly validates choosing hand-written endpoints.
 *
 *   - `select` (include mode) restricts what is QUERIED FROM THE DB, not what is
 *     emitted: "A selected-but-empty field still returns as `null`."
 *   - `defaultPopulate` / `populate` restrict populated relationships only.
 *   - field `hidden` is an Admin Panel input type — explicitly NOT an API concern.
 *   - field `access.read` is user-driven, not emptiness-driven.
 *   - an `afterRead` hook runs for ALL consumers including the Admin Panel and may
 *     receive a partial doc under `select` — the wrong layer entirely.
 *   - `id` is always present and CANNOT be excluded.
 *
 * WHY IT MATTERS: `svfrontend/tsconfig.json` runs `strict: true`. `null` is NOT
 * assignable to `ProjectStatus | undefined` under `strictNullChecks`. The moment
 * the frontend types an API response as `Project` — which NFR-12 requires —
 * every `null` scalar becomes a COMPILE ERROR IN THE OTHER REPOSITORY, and
 * fixing it would mean editing `types/content.ts`, which is the contract.
 *
 * D-008, extended to scalars by principle P3.
 */
export const put = <T>(
  target: Record<string, unknown>,
  key: string,
  value: T | null | undefined,
): void => {
  if (value === null || value === undefined) return
  if (typeof value === 'string' && value.trim() === '') return
  if (Array.isArray(value) && value.length === 0) return
  target[key] = value
}

/**
 * The same rule as a predicate, for callers that need to branch rather than
 * assign. Keeping ONE rule means there is only ever one place to change it.
 */
export const isEmptyForPublicOutput = (value: unknown): boolean => {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}
