import type { CollectionAfterLoginHook, CollectionAfterLogoutHook, PayloadRequest } from 'payload'

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
