import type { Access, FieldAccess, Where } from 'payload'

/**
 * THE ENTIRE AUTHORISATION MODEL — four functions, no RBAC scaffolding.
 *
 * 🔴 Payload's DEFAULT access is `({ req: { user } }) => Boolean(user)` —
 * ANY AUTHENTICATED USER, FULL CRUD. That is the OPPOSITE of the roadmap's
 * "deny-by-default access control on every collection". It is benign today with
 * one role and becomes a hole the moment a second auth-enabled collection
 * exists. Therefore EVERY collection and EVERY global declares an explicit
 * `access` block, including `readVersions`, and a config test enumerates them
 * and fails on any missing key.
 *
 * Payload ships no RBAC model at all: roles, permissions, matrices, inheritance
 * and any UI for them would be 100% our code. There is exactly one role.
 * A permission matrix for one role is pure liability — code never exercised,
 * never correctly tested, and confidently wrong the first time a second role
 * appears.
 */

/**
 * The single authorisation predicate the whole system routes through.
 *
 * `isActive` is checked HERE. That is what makes account deactivation take
 * effect on the next request without a token-version scheme (D-117). Note the
 * residual gap it does NOT close: deactivating a user does not revoke their
 * existing SESSION, because `isActive` is our field, not Payload's. Deactivation
 * is therefore a documented TWO-STEP runbook entry — set `isActive: false` AND
 * change that user's password as an admin, which IS documented to end all of
 * their sessions.
 */
export const isAdmin: Access = ({ req: { user } }) =>
  Boolean(user) && user?.collection === 'users' && user?.isActive === true && user?.role === 'admin'

/** Field-level counterpart, for fields only an admin may read. */
export const isAdminField: FieldAccess = ({ req: { user } }) =>
  Boolean(user) && user?.collection === 'users' && user?.isActive === true && user?.role === 'admin'

/** Unauthenticated read is permitted. Used ONLY for `site-settings.read`. */
export const anyone: Access = () => true

/** Nothing may do this, ever. Used for append-only and system-written data. */
export const nobody: Access = () => false

/**
 * The public-read constraint.
 *
 * Returns `true` for an authenticated admin (they may see drafts in the admin
 * panel) and a QUERY CONSTRAINT for everyone else. Payload ANDs the returned
 * `Where` into the query, so this protects Payload's OWN generated REST surface
 * — the only documented lever over it.
 *
 * 🔴 Do NOT copy the docs' legacy `_status: { exists: false }` OR-branch. That
 * exists for collections which pre-date drafts. Drafts are enabled from
 * migration 001, so no `_status`-less row can ever exist, and the OR-branch
 * would only widen what anonymous callers can reach.
 *
 * 🔴 This is ONE OF THREE layers. It is not sufficient on its own, because the
 * Local API defaults `overrideAccess: true` — see `src/lib/publicFind.ts`.
 */
export const publishedOrAuthenticated: Access = ({ req: { user } }) => {
  if (user) return true
  return { _status: { equals: 'published' } }
}

/**
 * Testimonials are doubly gated: published AND consented. Publishing a review
 * that was not given by a real, consenting client is a fabricated record, and
 * the three testimonials in the repo today are invented placeholders with
 * bracketed names. Even if a row somehow reached `_status: 'published'` without
 * consent, it still would not reach the site.
 */
export const publishedAndConsented: Access = ({ req: { user } }) => {
  if (user) return true
  const where: Where = {
    and: [{ _status: { equals: 'published' } }, { consented: { equals: true } }],
  }
  return where
}

/**
 * The boolean-only variant.
 *
 * ⚠️ MEASURED FROM THE TYPES, NOT ASSUMED: `access.unlock` and `access.admin`
 * are typed as returning `boolean | Promise<boolean>` — NOT the wider
 * `AccessResult` that `read`/`create`/`update`/`delete` accept. They cannot
 * return a `Where` constraint, because there is no query to constrain. Passing
 * the general `isAdmin` there is a type error, and the fix is a separate
 * function rather than a cast, so the distinction stays visible.
 */
export const isAdminBoolean = ({
  req,
}: {
  req: { user?: { collection?: string; isActive?: unknown; role?: unknown } | null }
}): boolean =>
  Boolean(req.user) &&
  req.user?.collection === 'users' &&
  req.user?.isActive === true &&
  req.user?.role === 'admin'

/**
 * Server-assigned fields. `admin.readOnly` is documented as "without affecting
 * the API" — it is trivially spoofable over REST. Every server-assigned field
 * pairs `admin.readOnly: true` with THIS, every time.
 *
 * The concrete test: POST a lead with `"source":"whatsapp"` in the body and
 * assert the stored value is `contact_form`.
 */
export const serverOnlyField = {
  create: (() => false) as FieldAccess,
  update: (() => false) as FieldAccess,
}
