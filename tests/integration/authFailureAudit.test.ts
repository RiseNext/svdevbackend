import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload, HTTP_BASE, isHttpUp } from '../setup'
import { auditAuthFailure } from '@/hooks/authEvents'
import { LOCK_TIME_MS, MAX_LOGIN_ATTEMPTS } from '@/lib/constants'

/**
 * D-2 — FAILED LOGINS AND LOCKOUTS ARE NOW RECORDED.
 *
 * 🔴 WHY THIS FILE IS SEPARATE FROM `auditAuth.test.ts`. The fix lives in an
 * `afterError` hook, and `afterError` ONLY runs on the HTTP path
 * (`handleEndpoints` catch -> `routeError` -> hooks). `payload.login()` is the
 * Local API and never reaches it. So the existing file — which logs in through
 * the Local API throughout — structurally cannot exercise this, and a test
 * added there would have passed for the wrong reason or failed for a reason
 * that is not a defect.
 *
 * Coverage is therefore in two layers, deliberately:
 *
 *   1. THE HOOK, called directly with the same arguments `routeError` passes.
 *      This is where the logic lives — reason classification, the
 *      once-per-lock-window dedupe, the refusal to record a password — and it
 *      runs with no server.
 *   2. A REAL HTTP REQUEST to `POST /payload-api/users/login`, which proves the
 *      hook is actually REACHED through the live route stack rather than merely
 *      being correct in isolation. Skipped when the dev server is not running,
 *      and `e2e/authAudit.spec.ts` proves the same thing from a real browser.
 *
 * Layer 1 without layer 2 would be a mock proving itself. Layer 2 without
 * layer 1 could not reach the dedupe branch without actually waiting out a
 * lock window.
 */

let payload: Payload
const CTX = { skipAudit: true, skipRevalidate: true }

const mkEmail = (tag: string) => `authfail-${tag}-${Date.now()}@example.com`

const mkUser = (email: string, password: string, isActive = true) =>
  payload.create({
    collection: 'users',
    overrideAccess: true,
    data: { email, password, name: `AuthFail ${email}`, role: 'admin', isActive } as never,
    context: CTX,
  })

type AuditRow = {
  action: string
  entityType: string
  entityId: string
  changes?: Record<string, unknown> | null
  ipAddress?: string | null
}

const auditRows = async (action: string, entityId?: string): Promise<AuditRow[]> => {
  const res = await payload.find({
    collection: 'audit-log',
    overrideAccess: true,
    where: entityId
      ? { and: [{ action: { equals: action } }, { entityId: { equals: entityId } }] }
      : { action: { equals: action } },
    sort: '-createdAt',
    limit: 50,
    depth: 0,
  })
  return res.docs as unknown as AuditRow[]
}

/**
 * The arguments `routeError` hands an `afterError` hook, reproduced exactly:
 * `{ collection, context, error, req, result }`. Only `collection`, `error` and
 * `req` are read by the hook.
 */
const fireHook = async (opts: {
  error: Error
  email?: string
  context?: Record<string, unknown>
  headers?: Record<string, string>
}) => {
  const context: Record<string, unknown> = { ...(opts.context ?? {}) }
  const req = {
    payload,
    context,
    data: opts.email === undefined ? undefined : { email: opts.email, password: 'NEVER-RECORDED' },
    headers: new Headers(opts.headers ?? {}),
    user: undefined,
  }
  const collection = payload.collections['users']!.config
  await (auditAuthFailure as unknown as (a: unknown) => Promise<void>)({
    collection,
    context,
    error: opts.error,
    req,
    result: { errors: [{ message: 'x' }] },
  })
}

/** Payload's real error classes, so `name` is whatever the framework sets. */
const authError = async (): Promise<Error> => {
  const { AuthenticationError } = await import('payload')
  return new (AuthenticationError as new (t?: unknown) => Error)(undefined)
}
const lockedError = async (): Promise<Error> => {
  const { LockedAuth } = await import('payload')
  return new (LockedAuth as new (t?: unknown) => Error)(undefined)
}

beforeAll(async () => {
  payload = await getTestPayload()
})

// ---------------------------------------------------------------------------

describe('the hook classifies each kind of auth failure', () => {
  it('a wrong password against a REAL account records the account id', async () => {
    const email = mkEmail('wrongpw')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-20')

    await fireHook({ error: await authError(), email })

    const rows = await auditRows('login_failed', String(u.id))
    expect(rows.length, 'a failed login against a real account must be recorded').toBe(1)
    expect(rows[0]!.changes).toMatchObject({ reason: 'wrong_password' })
    expect(rows[0]!.entityType).toBe('users')
  })

  it('an UNKNOWN address is recorded without storing the address', async () => {
    /**
     * The anti-dumping-ground decision, pinned. An attacker supplies the
     * address; storing it would let them write arbitrary strings into a table
     * administrators read, and "someone guessed bob@nowhere.test" is not
     * information anyone acts on.
     */
    const guessed = 'definitely-not-a-real-account-zzq@example.com'
    await fireHook({ error: await authError(), email: guessed })

    const rows = await auditRows('login_failed', 'unknown-account')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.changes).toMatchObject({ reason: 'unknown_account' })

    // 🔴 The attempted address must appear NOWHERE in the row.
    expect(JSON.stringify(rows[0]!)).not.toContain('definitely-not-a-real-account-zzq')
  })

  it('🔴 THE PASSWORD IS NEVER RECORDED, in any field, for any reason', async () => {
    const email = mkEmail('nopw')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-21')
    await fireHook({ error: await authError(), email })

    const rows = await auditRows('login_failed', String(u.id))
    // `fireHook` puts the sentinel on `req.data.password`, exactly where the
    // real request carries the attempted password.
    expect(JSON.stringify(rows)).not.toContain('NEVER-RECORDED')
  })

  it('a DEACTIVATED account is distinguished from a wrong password', async () => {
    /**
     * Both produce the same message to the client — deliberately, so the
     * response cannot be used to enumerate accounts. The audit log is where the
     * distinction belongs, and `blockInactiveLogin` passes it on `req.context`
     * rather than on the error, so it cannot leak into the response.
     */
    const email = mkEmail('inactive')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-22', false)

    await fireHook({
      error: new Error('The email or password provided is incorrect.'),
      email,
      context: { authFailureReason: 'inactive_account', authFailureUserId: String(u.id) },
    })

    const rows = await auditRows('login_failed', String(u.id))
    expect(rows.length).toBe(1)
    expect(rows[0]!.changes).toMatchObject({ reason: 'inactive_account' })
  })

  it('ignores errors that are not auth failures, and other collections', async () => {
    const email = mkEmail('ignored')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-23')

    // A validation error on the users collection is not an auth failure.
    await fireHook({ error: Object.assign(new Error('nope'), { name: 'ValidationError' }), email })
    expect(await auditRows('login_failed', String(u.id))).toHaveLength(0)

    // And an auth-shaped error arriving for a different collection is not ours.
    const projects = payload.collections['projects']!.config
    await (auditAuthFailure as unknown as (a: unknown) => Promise<void>)({
      collection: projects,
      context: {},
      error: await authError(),
      req: { payload, context: {}, data: { email }, headers: new Headers() },
    })
    expect(await auditRows('login_failed', String(u.id))).toHaveLength(0)
  })

  it('records the client IP when the request carries a forwarding header', async () => {
    const email = mkEmail('ip')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-24')
    await fireHook({
      error: await authError(),
      email,
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    })
    const rows = await auditRows('login_failed', String(u.id))
    expect(rows[0]!.ipAddress, 'the first hop is the client').toBe('203.0.113.9')
  })

  it('never throws, even when the request is unusable', async () => {
    /**
     * 🔴 THE PROPERTY THAT MATTERS MOST. This hook runs while an error response
     * is being assembled. If it threw, a clean 401 would become a 500 — so a
     * database hiccup in the AUDIT path would become an authentication outage.
     */
    const collection = payload.collections['users']!.config
    const call = (req: unknown) =>
      (auditAuthFailure as unknown as (a: unknown) => Promise<void>)({
        collection,
        context: {},
        error: new Error('boom'),
        req,
      })

    await expect(call(undefined)).resolves.toBeUndefined()
    await expect(call({})).resolves.toBeUndefined()
    await expect(call({ payload: null })).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------

describe('lockout is recorded once per lock window, not once per attempt', () => {
  it('writes a lockout row, then suppresses repeats within the same window', async () => {
    /**
     * `LockedAuth` is thrown on EVERY attempt while the account is locked —
     * `checkLoginPermission` runs before the password is even verified
     * (`login.js:156`). Without the dedupe, one security event would produce as
     * many rows as the attacker felt like generating, and the audit log's
     * signal-to-noise would be set by the attacker.
     */
    const email = mkEmail('lockwindow')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-25')

    // Put the account into a genuinely locked state, the way Payload does.
    const lockUntil = new Date(Date.now() + LOCK_TIME_MS).toISOString()
    await payload.db.updateOne({
      collection: 'users',
      id: String(u.id),
      data: { lockUntil, loginAttempts: MAX_LOGIN_ATTEMPTS },
    })

    await fireHook({ error: await lockedError(), email })
    const first = await auditRows('lockout', String(u.id))
    expect(first.length, 'the lockout must be recorded').toBe(1)
    expect(first[0]!.changes).toMatchObject({ lockedUntil: expect.any(String) })
    expect(first[0]!.changes).toMatchObject({ attempts: MAX_LOGIN_ATTEMPTS })

    // Three more refused attempts in the same window.
    await fireHook({ error: await lockedError(), email })
    await fireHook({ error: await lockedError(), email })
    await fireHook({ error: await lockedError(), email })

    expect(
      (await auditRows('lockout', String(u.id))).length,
      'still exactly one lockout row for this window',
    ).toBe(1)

    // ...but every refused attempt is still a recorded login_failed, so the
    // volume of the attack remains visible.
    const failures = await auditRows('login_failed', String(u.id))
    expect(failures.length, 'each refused attempt is its own login_failed row').toBe(4)
    for (const row of failures) {
      expect(row.changes).toMatchObject({ reason: 'account_locked' })
    }
  })

  it('a NEW lock window produces a new lockout row', async () => {
    const email = mkEmail('relock')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-26')

    // Window 1, already expired: the lock ended `LOCK_TIME_MS` ago, so its
    // window opened two lock-times ago.
    await payload.db.updateOne({
      collection: 'users',
      id: String(u.id),
      data: {
        lockUntil: new Date(Date.now() - LOCK_TIME_MS).toISOString(),
        loginAttempts: MAX_LOGIN_ATTEMPTS,
      },
    })
    await fireHook({ error: await lockedError(), email })
    expect((await auditRows('lockout', String(u.id))).length).toBe(1)

    // Window 2 — locked again, now.
    await payload.db.updateOne({
      collection: 'users',
      id: String(u.id),
      data: {
        lockUntil: new Date(Date.now() + LOCK_TIME_MS).toISOString(),
        loginAttempts: MAX_LOGIN_ATTEMPTS,
      },
    })
    await fireHook({ error: await lockedError(), email })
    expect(
      (await auditRows('lockout', String(u.id))).length,
      'a second, distinct lockout must be recorded',
    ).toBe(2)
  })
})

// ---------------------------------------------------------------------------

describe('the hook is reached through the REAL route stack', () => {
  /**
   * 🔴 THIS IS THE ASSERTION THAT MAKES THE REST MEANINGFUL. Everything above
   * calls the hook directly; this proves `routeError` actually invokes it on a
   * live request to the endpoint the admin panel itself posts to.
   *
   * Skipped — not silently passed — when the dev server is not running, and the
   * skip is logged so a green run cannot be mistaken for coverage.
   */
  it('POST /payload-api/users/login with a wrong password writes login_failed', async () => {
    if (!(await isHttpUp())) {
      console.log(
        `[skip] dev server not reachable at ${HTTP_BASE} — HTTP auth-audit case not run. ` +
          'Start it with `npm run dev` to exercise it.',
      )
      return
    }

    const email = mkEmail('http')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-27')

    const before = (await auditRows('login_failed', String(u.id))).length

    const res = await fetch(`${HTTP_BASE}/payload-api/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'this-password-is-wrong-on-purpose' }),
    })
    expect(res.status, 'a wrong password must still be a clean 401').toBe(401)

    // The response must not have been rewritten by the audit hook.
    const body = (await res.json()) as { errors?: { message?: string }[] }
    expect(body.errors?.[0]?.message ?? '').toMatch(/incorrect/i)

    // The hook writes outside the request's transaction, so give it a moment.
    await new Promise((r) => setTimeout(r, 1200))

    const rows = await auditRows('login_failed', String(u.id))
    expect(
      rows.length,
      'afterError must have fired on the real HTTP login route',
    ).toBeGreaterThan(before)
    expect(rows[0]!.changes).toMatchObject({ reason: 'wrong_password' })
  }, 30_000)
})
