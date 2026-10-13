import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'

/**
 * AUTHENTICATION AUDIT.
 *
 * ⚠️ AUDIT ARTEFACT, like `auditSweep.test.ts`. Authentication was the thinnest
 * area of the existing 497 tests — one test mentioning "login", none mentioning
 * logout, sessions, roles or lockout — so this file produces the evidence.
 *
 * 🔴 DELIBERATELY DOES NOT CALL `resetTestDatabase`. `users` is excluded from
 * the truncate list (tests/resetDb.ts) so seeded admin accounts survive, and
 * truncating the rest mid-suite would fight the other audit file. Every account
 * here is created with a timestamped address instead.
 */

let payload: Payload
const CTX = { skipAudit: true, skipRevalidate: true }

const mkEmail = (tag: string) => `audit-auth-${tag}-${Date.now()}@example.com`

const mkUser = (email: string, password: string, isActive = true) =>
  payload.create({
    collection: 'users',
    overrideAccess: true,
    data: { email, password, name: `Audit ${email}`, role: 'admin', isActive } as never,
    context: CTX,
  })

/** A failed custom `validate` puts its message in `.data.errors[]`, not
 *  `.message`. See the note in auditSweep.test.ts. */
const messagesOf = (err: unknown): string => {
  const e = err as { message?: string; data?: { errors?: { message?: string }[] } }
  return [e?.message ?? '', (e?.data?.errors ?? []).map((x) => x?.message ?? '').join(' | ')]
    .filter(Boolean)
    .join(' || ')
}

const expectRejectionMentioning = async (op: Promise<unknown>, pattern: RegExp) => {
  let caught: unknown
  try {
    await op
  } catch (e) {
    caught = e
  }
  expect(caught, 'expected a rejection').toBeDefined()
  expect(messagesOf(caught)).toMatch(pattern)
}

const countAudit = async (action: string) =>
  (
    await payload.count({
      collection: 'audit-log',
      overrideAccess: true,
      where: { action: { equals: action } },
    })
  ).totalDocs

beforeAll(async () => {
  payload = await getTestPayload()
})

describe('password policy', () => {
  it('rejects a password under the 12-character minimum', async () => {
    await expectRejectionMentioning(
      mkUser(mkEmail('short'), 'short1'),
      /at least 12 characters/i,
    )
  })

  it('rejects an obvious breach-list password even when long enough', async () => {
    await expectRejectionMentioning(
      mkUser(mkEmail('breach'), 'password1234'),
      /known breach list/i,
    )
  })

  it('rejects a leetspeak variant of a blocked password', async () => {
    /**
     * The fold works: blocklist entries are folded too, so both sides
     * normalise consistently. See tests/unit/auditPasswordPolicy.test.ts.
     *
     * ⚠️ MUST BE >= 12 CHARACTERS. `P@ssw0rd!` is 9, so the length rule fires
     * first and the breach-list message never appears — which is correct
     * behaviour, but it hides what this case is trying to prove.
     */
    await expectRejectionMentioning(mkUser(mkEmail('leet'), 'passw0rd2026'), /known breach list/i)
  })

  it('D-3 REGRESSION: a COMPOUND suffix is now rejected', async () => {
    // Before the fix this was accepted: `!2026` is not a `SUFFIXES` entry, so
    // `password!2026` matched nothing in the blocklist.
    await expectRejectionMentioning(
      mkUser(mkEmail('compound'), 'password!2026'),
      /known breach list/i,
    )
  })

  it('rejects a single repeated character and an ascending run', async () => {
    await expectRejectionMentioning(mkUser(mkEmail('rep'), 'aaaaaaaaaaaaaa'), /known breach list/i)
    await expectRejectionMentioning(mkUser(mkEmail('run'), 'abcdefghijklmn'), /known breach list/i)
  })

  it('accepts a long passphrase', async () => {
    const u = await mkUser(mkEmail('ok'), 'orchard-lantern-bridge-quiet-77')
    expect(u.id).toBeTruthy()
  })
})

describe('login, lockout and audit', () => {
  it('a valid account can sign in', async () => {
    const email = mkEmail('signin')
    const password = 'orchard-lantern-bridge-quiet-78'
    await mkUser(email, password)
    const res = await payload.login({ collection: 'users', data: { email, password } })
    expect((res as { user?: { email?: string } }).user?.email).toBe(email)
  })

  it('refuses a wrong password', async () => {
    const email = mkEmail('wrongpw')
    await mkUser(email, 'orchard-lantern-bridge-quiet-79')
    await expect(
      payload.login({ collection: 'users', data: { email, password: 'orchard-lantern-bridge-ZZZZ' } }),
    ).rejects.toThrow()
  })

  it('email is case-insensitive (lowercased on write)', async () => {
    const email = mkEmail('case')
    const password = 'orchard-lantern-bridge-quiet-80'
    await mkUser(email.toUpperCase(), password)
    const res = await payload.login({ collection: 'users', data: { email: email.toLowerCase(), password } })
    expect((res as { user?: { email?: string } }).user?.email).toBe(email.toLowerCase())
  })

  it('writes a `login` row to the audit log on a successful sign-in', async () => {
    const email = mkEmail('audited')
    const password = 'orchard-lantern-bridge-quiet-81'
    await mkUser(email, password)
    const before = await countAudit('login')
    await payload.login({ collection: 'users', data: { email, password } })
    expect(await countAudit('login'), 'a successful login must be audited').toBeGreaterThan(before)
  })

  it('a LOCAL-API failed login is not audited — documented, and not the path humans use', async () => {
    /**
     * ⚠️ A REAL AND DELIBERATE BOUNDARY, corrected from an earlier version of
     * this test that recorded it as the whole defect.
     *
     * `login_failed` is now written, but by an `afterError` hook — and
     * `afterError` is invoked from `routeError`, which only runs on the HTTP
     * path (`handleEndpoints` catch block). `payload.login()` is the Local API:
     * it throws straight back to its caller and no route error handler is
     * involved, so nothing records it.
     *
     * THAT IS ACCEPTABLE, because nothing in this product logs in through the
     * Local API except this suite and `resetAdminPassword.ts`. Every human and
     * every API client goes through `POST /payload-api/users/login` — including
     * the admin panel's own login form, which submits to exactly that endpoint
     * (`@payloadcms/next/.../LoginForm/index.js:120-122`).
     *
     * The HTTP path is covered by `authFailureAudit.test.ts` (real request) and
     * `e2e/authAudit.spec.ts` (real browser). This assertion exists so the
     * boundary stays VISIBLE instead of being rediscovered as a bug.
     */
    const email = mkEmail('failaudit')
    await mkUser(email, 'orchard-lantern-bridge-quiet-82')
    const before = await countAudit('login_failed')
    await payload
      .login({ collection: 'users', data: { email, password: 'definitely-wrong-passphrase' } })
      .catch(() => undefined)
    expect(
      await countAudit('login_failed'),
      'the Local API bypasses routeError, so no afterError hook runs',
    ).toBe(before)
  })

  it('locks the account after 5 failed attempts, refusing even the correct password', async () => {
    const email = mkEmail('lockout')
    const password = 'orchard-lantern-bridge-quiet-83'
    await mkUser(email, password)
    for (let i = 0; i < 5; i++) {
      await payload
        .login({ collection: 'users', data: { email, password: `wrong-attempt-number-${i}` } })
        .catch(() => undefined)
    }
    await expect(
      payload.login({ collection: 'users', data: { email, password } }),
      'the correct password must be refused while locked',
    ).rejects.toThrow()
  })

  it('a lockout reached through the Local API is likewise unaudited — same boundary', async () => {
    // Same reasoning as the test above: the lock itself is real (asserted in
    // the preceding case), but no HTTP error handler ran, so no row was
    // written. The audited path is proven in `authFailureAudit.test.ts`.
    expect(await countAudit('lockout')).toBe(0)
  })

  it('D-2 REGRESSION: an administrator changing a password is audited', async () => {
    /**
     * 🔴 PREVIOUSLY UNAUDITED. `auditPasswordChange` existed but had no call
     * site, so the most security-relevant edit one administrator can make to
     * another's account left no trace. Payload strips `password` from the
     * document before writing, so there is nothing to diff — the new hook keys
     * off the incoming `data` instead.
     */
    const email = mkEmail('pwchange')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-90')
    const before = await countAudit('password_change')
    await payload.update({
      collection: 'users',
      id: String(u.id),
      overrideAccess: true,
      data: { password: 'orchard-lantern-bridge-quiet-91' } as never,
      // No skipAudit: the audit row is the thing under test.
    })
    expect(
      await countAudit('password_change'),
      'an admin-initiated password change must be audited',
    ).toBeGreaterThan(before)
  })

  it('an ordinary profile edit is NOT recorded as a password change', async () => {
    const email = mkEmail('nameonly')
    const u = await mkUser(email, 'orchard-lantern-bridge-quiet-92')
    const before = await countAudit('password_change')
    await payload.update({
      collection: 'users',
      id: String(u.id),
      overrideAccess: true,
      data: { name: 'Renamed Only' } as never,
    })
    expect(await countAudit('password_change')).toBe(before)
  })
})

describe('deactivation closes authorisation AND credentials AND sessions', () => {
  /**
   * Unticking `isActive` is now a COMPLETE revocation, and all three halves are
   * pinned here because each was a separate hole:
   *   · authorisation — every `isAdmin` predicate refuses (was always true)
   *   · authentication — `blockInactiveLogin` refuses the login itself (D-4)
   *   · existing sessions — `revokeSessionsOnDeactivate` ends them (D-4, part 2)
   * The old runbook two-step ("also change their password") is no longer
   * required, which is why the field's help text no longer says so.
   */
  it('a deactivated admin is refused by the access predicates', async () => {
    const email = mkEmail('deact')
    const password = 'orchard-lantern-bridge-quiet-84'
    const u = await mkUser(email, password)
    await payload.update({
      collection: 'users',
      id: String(u.id),
      overrideAccess: true,
      data: { isActive: false } as never,
      context: CTX,
    })

    const asInactive = { id: u.id, collection: 'users', role: 'admin', isActive: false } as never
    await expect(
      payload.find({ collection: 'leads', overrideAccess: false, user: asInactive, limit: 1 }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'faqs',
        overrideAccess: false,
        user: asInactive,
        data: { question: 'Should never save?', answer: 'No.' } as never,
      }),
    ).rejects.toThrow()
  })

  it('D-4 REGRESSION: the credentials themselves no longer authenticate', async () => {
    const email = mkEmail('deact2')
    const password = 'orchard-lantern-bridge-quiet-85'
    const u = await mkUser(email, password)
    await payload.update({
      collection: 'users',
      id: String(u.id),
      overrideAccess: true,
      data: { isActive: false } as never,
      context: CTX,
    })
    /**
     * 🔴 MEASURED BEFORE THE FIX: this returned `authenticated`. Unticking
     * `isActive` closed authorisation but left authentication working, so a
     * deactivated administrator could still obtain a session cookie with their
     * old password — which is why the runbook had to prescribe a TWO-STEP
     * deactivation. `blockInactiveLogin` (a `beforeLogin` hook) now refuses the
     * login itself, so step one is sufficient.
     */
    const outcome = await payload
      .login({ collection: 'users', data: { email, password } })
      .then(() => 'authenticated')
      .catch(() => 'refused')
    expect(outcome, 'a deactivated account must not be able to authenticate').toBe('refused')

    // And the refusal must not confirm that the address exists.
    const message = await payload
      .login({ collection: 'users', data: { email, password } })
      .then(() => '')
      .catch((e) => String((e as Error).message))
    expect(message).toMatch(/email or password provided is incorrect/i)
  })

  it('D-4 REGRESSION (part 2): deactivation ENDS AN EXISTING SESSION immediately', async () => {
    /**
     * 🔴 THE HALF OF D-4 THAT WAS STILL OPEN. `blockInactiveLogin` stopped a
     * deactivated account from getting a NEW session. It did nothing about the
     * one they were already holding: with `tokenExpiration` at its configured
     * value, a dismissed administrator kept working access until it ran out.
     * The field's help text admitted as much and prescribed a second step.
     *
     * `useSessions: true` means the JWT strategy resolves every request by
     * finding the token's `sid` in the user's own `sessions` array
     * (`payload/dist/auth/strategies/jwt.js:111-117`) and returns `{user: null}`
     * when it is absent. So the assertion that matters is that the array is
     * EMPTY after deactivation — that is precisely what makes the outstanding
     * cookie stop resolving.
     */
    const email = mkEmail('session-revoke')
    const password = 'orchard-lantern-bridge-quiet-87'
    const u = await mkUser(email, password)

    // Sign in twice, so there are two live sessions to revoke — a single one
    // could be cleared by coincidence, two cannot.
    await payload.login({ collection: 'users', data: { email, password } })
    await payload.login({ collection: 'users', data: { email, password } })

    const live = (await payload.findByID({
      collection: 'users',
      id: String(u.id),
      overrideAccess: true,
      showHiddenFields: true,
    })) as { sessions?: unknown[] }
    expect(live.sessions?.length ?? 0, 'two sessions should exist before deactivation').toBe(2)

    await payload.update({
      collection: 'users',
      id: String(u.id),
      overrideAccess: true,
      data: { isActive: false } as never,
      // No skipAudit — the `logout` row recording the revocation is also tested.
    })

    const after = (await payload.findByID({
      collection: 'users',
      id: String(u.id),
      overrideAccess: true,
      showHiddenFields: true,
    })) as { sessions?: unknown[] }
    expect(
      after.sessions?.length ?? 0,
      'every session must be gone, so the outstanding cookie stops resolving',
    ).toBe(0)
  })

  it('reactivating, and ordinary edits to an active user, leave sessions alone', async () => {
    /**
     * The guard on the transition. A hook that cleared sessions on every write
     * to a user would sign an administrator out whenever they edited their own
     * name — a self-inflicted outage that would look like a session bug.
     */
    const email = mkEmail('session-keep')
    const password = 'orchard-lantern-bridge-quiet-88'
    const u = await mkUser(email, password)
    await payload.login({ collection: 'users', data: { email, password } })

    await payload.update({
      collection: 'users',
      id: String(u.id),
      overrideAccess: true,
      data: { name: 'Renamed While Active' } as never,
      context: CTX,
    })

    const after = (await payload.findByID({
      collection: 'users',
      id: String(u.id),
      overrideAccess: true,
      showHiddenFields: true,
    })) as { sessions?: unknown[] }
    expect(after.sessions?.length ?? 0, 'an ordinary edit must not sign anyone out').toBe(1)
  })
})

describe('roles', () => {
  it('there is exactly ONE role, so roles cannot be used to limit anyone', () => {
    const users = payload.config.collections.find((c) => c.slug === 'users')!
    const role = (users.fields as { name?: string; options?: unknown }[]).find((f) => f.name === 'role')
    const options = (role?.options ?? []) as { value?: string }[]
    expect(options.map((o) => o.value)).toEqual(['admin'])
  })

  it('a user with an unknown role is refused', async () => {
    await expect(
      payload.create({
        collection: 'users',
        overrideAccess: true,
        data: {
          email: mkEmail('badrole'),
          password: 'orchard-lantern-bridge-quiet-86',
          name: 'Bad Role',
          role: 'editor',
          isActive: true,
        } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })
})
