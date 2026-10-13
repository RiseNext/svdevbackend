import {
  APIError,
  type AfterErrorHook,
  type CollectionAfterChangeHook,
  type CollectionAfterLoginHook,
  type CollectionBeforeChangeHook,
  type CollectionAfterLogoutHook,
  type CollectionBeforeLoginHook,
  type PayloadRequest,
} from 'payload'

import { LOCK_TIME_MS } from '@/lib/constants'
import { writeAuditRow } from './audit'

/**
 * AUTH EVENTS -> `audit-log`.
 *
 * 🔴 Payload's version history captures NONE of these. Login, logout, a failed
 * login, a lockout and a password change produce NO VERSION AT ALL. Without
 * these hooks, a legally-sensitive CMS has no record of who got in and when.
 *
 * ⚠️ `lockout` MUST BE DERIVED. `maxLoginAttempts` / `lockTime` emit no event —
 * there is no `afterLockout` hook — so the transition has to be detected by
 * reading the login-attempt state. Likewise there is no documented
 * `afterLoginFailed` hook, so a failed login is recorded from the one place we
 * control: the collection's own login flow is Payload's, so we record what we
 * CAN observe and say plainly in the runbook what we cannot.
 */

/**
 * 🔴 A DEACTIVATED ACCOUNT MUST NOT BE ABLE TO AUTHENTICATE AT ALL.
 *
 * MEASURED BEFORE THIS HOOK EXISTED: unticking `isActive` closed the
 * AUTHORISATION door — every `isAdmin` predicate refused the account on its
 * next request — but left AUTHENTICATION wide open. `payload.login()` with the
 * old password still succeeded and still issued a session cookie. A browser
 * e2e run recorded the outcome literally as `authenticated`.
 *
 * That is why the runbook had to describe a TWO-STEP deactivation (untick, then
 * also change the password). A procedure is not a control: it is a thing a
 * person does under pressure and forgets. This hook makes step one sufficient.
 *
 * ⚠️ `beforeLogin` IS THE RIGHT SEAM, AND IT IS THE ONLY ONE. In Payload 3.90.1
 * `beforeLogin` runs AFTER the password has been verified and BEFORE a session
 * is created (`payload/dist/auth/operations/login.js:284`, past the
 * `AuthenticationError` throw at :185). So throwing here rejects a correct
 * password without ever minting a cookie — exactly the required behaviour, and
 * it cannot be reached by someone who got the password wrong anyway.
 *
 * The message deliberately does NOT say "this account is deactivated", because
 * that confirms the address exists. It says the same thing a wrong password
 * says.
 */
export const blockInactiveLogin: CollectionBeforeLoginHook = ({ user, req }) => {
  if ((user as { isActive?: unknown } | undefined)?.isActive !== true) {
    /**
     * The REASON is stashed on `req.context` before throwing, because the error
     * itself cannot carry it. The message is deliberately identical to a wrong
     * password (see above), and `APIError`'s `data` argument is serialised into
     * the HTTP response — so putting "account deactivated" there would undo the
     * anti-enumeration decision in the very act of recording it.
     *
     * `req.context` survives into `afterError` (`routeError` is handed the same
     * `req`), which is where `auditAuthFailure` reads it. Nothing reaches the
     * client.
     */
    ;(req.context as Record<string, unknown>).authFailureReason = 'inactive_account'
    ;(req.context as Record<string, unknown>).authFailureUserId = String(
      (user as { id?: unknown } | undefined)?.id ?? '',
    )
    throw new APIError('The email or password provided is incorrect.', 401)
  }
  return user
}

/**
 * 🔴 DEACTIVATION MUST END EXISTING SESSIONS, NOT JUST FUTURE LOGINS.
 *
 * `blockInactiveLogin` closed the front door. This closes the one that was
 * still open behind it: an administrator who was ALREADY signed in kept a
 * working session after `isActive` was unticked. Authorisation refused them
 * (`isAdmin` reads `isActive`), but the session itself stayed valid until
 * `tokenExpiration`, and the field's own help text had to admit it — telling
 * the operator to ALSO change the user's password as a second step.
 *
 * ⚠️ A TWO-STEP PROCEDURE IS NOT A CONTROL. It is a thing a person does under
 * pressure, out of order, or not at all. Removing an administrator's access is
 * exactly the moment that happens.
 *
 * WHY CLEARING `sessions` IS SUFFICIENT, measured rather than assumed:
 * `auth.useSessions` is `true`, and the JWT strategy resolves every request by
 * looking the token's `sid` up in the user's own `sessions` array —
 * `payload/dist/auth/strategies/jwt.js:111-117`:
 *
 *     const existingSession = (user.sessions || []).find(({id}) => id === ref.sid)
 *     if (!existingSession || !ref.sid) return { user: null }
 *
 * So an emptied array means every outstanding cookie for that account resolves
 * to `null` on its NEXT request. No waiting for expiry, no password change, no
 * runbook step. This is the same mechanism Payload itself uses to revoke
 * sessions on a password change, which is why the old two-step advice worked at
 * all — we are now triggering it directly on the event that should trigger it.
 *
 * Runs on the `isActive` true -> false transition only, so an ordinary edit to
 * an active user never disturbs their session.
 */
export const revokeSessionsOnDeactivate: CollectionAfterChangeHook = async ({
  req,
  doc,
  previousDoc,
  operation,
  context,
}) => {
  if (operation !== 'update') return doc

  const wasActive = (previousDoc as { isActive?: unknown } | undefined)?.isActive === true
  const isActive = (doc as { isActive?: unknown } | undefined)?.isActive === true
  if (!wasActive || isActive) return doc

  const userId = String((doc as { id?: unknown })?.id ?? '')
  if (!userId) return doc

  try {
    // 🔴 `payload.db.updateOne` rather than `payload.update`, deliberately.
    // Going through the document layer would re-enter this collection's own
    // `beforeChange`/`afterChange` hooks — including this one — from inside an
    // afterChange. The raw adapter write touches one column and cannot recurse.
    await req.payload.db.updateOne({
      collection: 'users',
      id: userId,
      req,
      data: { sessions: [] },
    })
  } catch (err) {
    // A session-revocation failure must not roll back the deactivation itself —
    // a deactivated-but-still-sessioned account is strictly better than an
    // account that stayed ACTIVE because cleanup failed. Logged loudly so it
    // cannot pass unnoticed.
    req.payload.logger.error(
      { err, userId },
      'FAILED to revoke sessions for a deactivated user — their existing session may still work until tokenExpiration. Change this user’s password to force revocation.',
    )
    return doc
  }

  if (!context?.skipAudit) {
    await writeAuditRow({
      req,
      action: 'logout',
      entityType: 'users',
      entityId: userId,
      changes: { reason: 'sessions_revoked_on_deactivation' },
    })
  }

  return doc
}

/**
 * A PASSWORD CHANGE MADE THROUGH THE PANEL OR THE API — two hooks, because the
 * fact and the moment to record it are in different places.
 *
 * 🔴 PREVIOUSLY UNAUDITED. `auditPasswordChange` existed but had no call site,
 * so the single most security-relevant edit an administrator can make to
 * another administrator's account left no trace. Only an unauthenticated
 * forgot-password REQUEST was recorded.
 *
 * ⚠️ IT MUST BE DETECTED IN `beforeChange`, AND THAT IS NOT A STYLE CHOICE.
 * MEASURED in `payload/dist/collections/operations/utilities/update.js`:
 *   :125  const password = data?.password        <- still present
 *   :157  collection beforeChange hooks run      <- still present HERE
 *   :299  delete data.password                   <- stripped
 *   :384  collection afterChange hooks run       <- GONE by now
 * The first attempt read `data.password` in `afterChange` and wrote nothing at
 * all, silently — the test caught it. Payload also never puts the password on
 * `doc` or `previousDoc`, so there is nothing to diff either.
 *
 * So: `flagPasswordChange` records the fact on `req.context` while it is still
 * observable, and `auditPasswordChangeHook` writes the row afterwards — once
 * the change has actually committed, which is the only point at which claiming
 * it happened is true.
 */
export const flagPasswordChange: CollectionBeforeChangeHook = ({ data, operation, context }) => {
  if (operation !== 'update') return data
  const supplied = (data as { password?: unknown } | undefined)?.password
  if (typeof supplied === 'string' && supplied.length > 0) {
    ;(context as Record<string, unknown>).passwordChanged = true
  }
  return data
}

export const auditPasswordChangeHook: CollectionAfterChangeHook = async ({
  req,
  doc,
  operation,
  context,
}) => {
  if (operation !== 'update') return doc
  if (context?.skipAudit) return doc
  if (!(context as Record<string, unknown> | undefined)?.passwordChanged) return doc

  await writeAuditRow({
    req,
    action: 'password_change',
    entityType: 'users',
    entityId: String((doc as { id?: unknown })?.id ?? ''),
    changes: null,
  })
  return doc
}

export const auditLogin: CollectionAfterLoginHook = async ({ req, user }) => {
  await writeAuditRow({
    req: req as PayloadRequest,
    action: 'login',
    entityType: 'users',
    entityId: String(user?.id ?? 'unknown'),
    changes: null,
  })
  return user
}

export const auditLogout: CollectionAfterLogoutHook = async ({ req }) => {
  await writeAuditRow({
    req: req as PayloadRequest,
    action: 'logout',
    entityType: 'users',
    entityId: String(req.user?.id ?? 'unknown'),
    changes: null,
  })
}

export const auditForgotPassword = async (args: { req?: PayloadRequest; args?: unknown }) => {
  const req = args.req
  if (!req) return
  await writeAuditRow({
    req,
    action: 'password_change',
    entityType: 'users',
    // The email is deliberately not recorded here: a forgot-password request is
    // unauthenticated, so echoing the address into an audit row would turn the
    // audit log into an account-enumeration oracle for anyone who can read it.
    entityId: 'forgot-password-requested',
    changes: null,
  })
}

/**
 * Called from the `users` collection's own `afterChange` when a password field
 * was present on an update — the only reliable signal Payload gives us that a
 * password actually changed, since the hash is stripped from every read.
 */
export const auditPasswordChange = async (req: PayloadRequest, userId: string) => {
  await writeAuditRow({
    req,
    action: 'password_change',
    entityType: 'users',
    entityId: userId,
    changes: null,
  })
}

/**
 * Derived lockout. Payload increments `loginAttempts` and sets `lockUntil` on the
 * user document; there is no event. This is called from the login-failure path
 * we DO control and records the transition once, not on every subsequent attempt.
 */
export const auditLockout = async (req: PayloadRequest, userId: string) => {
  await writeAuditRow({
    req,
    action: 'lockout',
    entityType: 'users',
    entityId: userId,
    changes: null,
  })
}

export const auditLoginFailed = async (req: PayloadRequest, identifier: string) => {
  await writeAuditRow({
    req,
    action: 'login_failed',
    entityType: 'users',
    // Same enumeration reasoning as forgot-password: record that a failure
    // happened and from where (the IP is captured by writeAuditRow), not who was
    // guessed at.
    entityId: identifier ? 'redacted' : 'unknown',
    changes: null,
  })
}

// ---------------------------------------------------------------------------
// D-2 — FAILED LOGINS AND LOCKOUTS
// ---------------------------------------------------------------------------

/**
 * 🔴 THE GAP, AND WHY EVERY OBVIOUS SEAM FAILS.
 *
 * `login_failed` and `lockout` have been in `AUDIT_ACTIONS` — and in the
 * Postgres enum — since the first migration, and NOTHING EVER WROTE EITHER.
 * A CMS holding customer enquiries had no record of password guessing at all.
 *
 * MEASURED in `payload/dist/auth/operations/login.js`:
 *   :156  checkLoginPermission(...)        -> throws LockedAuth when locked
 *   :174  incrementLoginAttempts(...)      -> via `payload.db.updateOne`
 *   :185  throw new AuthenticationError   <- the request ends HERE
 *   :284  beforeLogin hooks run            <- never reached on a failure
 *
 * So: `afterLogin` is unreachable (login failed), `beforeLogin` is unreachable
 * (it runs after the throw), and `afterChange` is unreachable because
 * `incrementLoginAttempts` writes through `payload.db.updateOne` — the RAW
 * adapter — which bypasses the document layer and every collection hook. There
 * is no `afterLoginFailed` and no `afterLockout` hook in Payload 3.90.1.
 *
 * ⚠️ THE ONE REMAINING SEAM, and it required reading the request plumbing
 * rather than the hooks documentation:
 *
 *   payload/dist/utilities/handleEndpoints.js:206-213   catch -> routeError(...)
 *   payload/dist/utilities/routeError.js:56-78          runs collection THEN
 *                                                       root `afterError` hooks
 *
 * `afterError` therefore sees the thrown `AuthenticationError` / `LockedAuth`
 * with the original `req` intact. And it genuinely covers the admin panel, not
 * just REST clients: the panel's own login form submits to the REST endpoint —
 * `@payloadcms/next/dist/views/Login/LoginForm/index.js:120-122` sets
 * `action: formatAdminURL({ apiRoute, path: '/users/login' })` — so a human
 * typing a wrong password in the browser lands in exactly this hook. That is
 * asserted in the browser, not assumed (`e2e/authAudit.spec.ts`).
 *
 * 🔴 IT IS REGISTERED ON THE COLLECTION, NOT ON THE PROTECTED ROUTE FILE.
 * `src/app/(payload)/payload-api/[...slug]/route.ts` is a protected file and is
 * untouched: it re-exports Payload's REST handlers, and the hook is reached
 * through the config those handlers already load.
 *
 * ─── WHAT IS DELIBERATELY NOT RECORDED ──────────────────────────────────────
 *
 * · THE PASSWORD. Never read, never logged, never stored. The hook touches
 *   `req.data.email` and nothing else on that object.
 * · THE ATTEMPTED ADDRESS, when it matches no account. Storing attacker-supplied
 *   strings would turn an admin-readable table into a dumping ground, and
 *   recording "someone guessed x@y.com" teaches a future reader nothing. Those
 *   land as `unknown-account`.
 * · A REAL ACCOUNT'S ID *is* recorded when the address matches one, because the
 *   audit log is `read: isAdmin` and "which of our two accounts is being
 *   attacked" is the entire operational value of the record. There is no
 *   enumeration risk in a table only administrators can read.
 */

/** `ExtendableError` sets `name = this.constructor.name`, so these are stable. */
const AUTH_FAILURE_ERRORS = new Set(['AuthenticationError', 'LockedAuth'])

type FailureReason =
  | 'wrong_password'
  | 'account_locked'
  | 'inactive_account'
  | 'unknown_account'

export const auditAuthFailure: AfterErrorHook = async ({ error, req, collection }) => {
  try {
    // Only the users collection's own endpoints, and only a real auth failure.
    if (collection?.slug !== 'users') return
    if (!req?.payload) return

    const ctx = (req.context ?? {}) as Record<string, unknown>
    const inactive = ctx.authFailureReason === 'inactive_account'
    const errorName = (error as { name?: unknown } | undefined)?.name
    if (!inactive && !AUTH_FAILURE_ERRORS.has(String(errorName))) return

    /**
     * Resolve the account WITHOUT echoing the attempted address anywhere.
     * `req.data.email` is still present: the body is parsed before the
     * operation runs and the failure does not clear it. Lower-cased to match
     * the `lowercaseEmail` field hook, or an admin who typed `Admin@x.com`
     * would be recorded as a different, unknown account.
     */
    let userId = typeof ctx.authFailureUserId === 'string' ? ctx.authFailureUserId : ''
    let lockUntil: string | null = null
    let attempts: number | null = null

    if (!userId) {
      const email = (req as { data?: { email?: unknown } }).data?.email
      if (typeof email === 'string' && email.trim() !== '') {
        const found = (await req.payload.db.findOne({
          collection: 'users',
          req,
          where: { email: { equals: email.trim().toLowerCase() } },
        })) as { id?: unknown; lockUntil?: unknown; loginAttempts?: unknown } | null

        if (found?.id) {
          userId = String(found.id)
          lockUntil = found.lockUntil ? String(found.lockUntil) : null
          attempts = typeof found.loginAttempts === 'number' ? found.loginAttempts : null
        }
      }
    }

    const reason: FailureReason = inactive
      ? 'inactive_account'
      : errorName === 'LockedAuth'
        ? 'account_locked'
        : userId
          ? 'wrong_password'
          : 'unknown_account'

    await writeAuditRow({
      req,
      action: 'login_failed',
      entityType: 'users',
      entityId: userId || 'unknown-account',
      // `attempts` is the real post-increment counter read back from the row,
      // so the log reflects actual behaviour rather than a recomputed guess.
      changes: attempts === null ? { reason } : { reason, attempts },
    })

    // ---------------------------------------------------------------- lockout
    /**
     * `LockedAuth` is thrown on EVERY attempt while the account is locked, not
     * only on the one that locked it — `checkLoginPermission` runs before the
     * password is even checked (`login.js:156`). Writing a `lockout` row each
     * time would turn one security event into a flood whose size depends on how
     * long the attacker kept trying.
     *
     * So it is written ONCE PER LOCK WINDOW. The window opened at
     * `lockUntil - lockTime`; if a `lockout` row already exists for this account
     * after that moment, this attempt belongs to a lockout already recorded.
     */
    if (errorName !== 'LockedAuth' || !userId || !lockUntil) return

    const windowStart = new Date(new Date(lockUntil).getTime() - LOCK_TIME_MS).toISOString()
    const existing = await req.payload.count({
      collection: 'audit-log',
      overrideAccess: true,
      req,
      where: {
        and: [
          { action: { equals: 'lockout' } },
          { entityId: { equals: userId } },
          { createdAt: { greater_than: windowStart } },
        ],
      },
    })
    if (existing.totalDocs > 0) return

    await writeAuditRow({
      req,
      action: 'lockout',
      entityType: 'users',
      entityId: userId,
      changes: { lockedUntil: lockUntil, attempts },
    })
  } catch (err) {
    /**
     * 🔴 THIS HOOK MUST NEVER CHANGE THE OUTCOME OF A FAILED LOGIN. It runs
     * while an error response is already being assembled; throwing here would
     * replace a clean 401 with a 500 and — far worse — a database hiccup in the
     * audit path would become an authentication outage. Swallow and log.
     */
    req?.payload?.logger?.error({ err }, 'auditAuthFailure could not record an auth failure')
  }
  // No return value: the response is deliberately left exactly as Payload
  // formatted it. Returning a `response`/`status` here would let an audit hook
  // rewrite an authentication error, which it has no business doing.
}
