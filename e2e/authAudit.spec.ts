import { expect, test, type Page, type APIRequestContext } from '@playwright/test'

/**
 * D-2 IN THE BROWSER — a failed login typed by a human is recorded.
 *
 * 🔴 WHY A BROWSER TEST IS NECESSARY AND NOT BELT-AND-BRACES. The fix is an
 * `afterError` hook, and `afterError` is reached only from `routeError`, which
 * only runs on the HTTP path. Whether the ADMIN PANEL takes that path is a
 * property of `@payloadcms/next`, not of our code: the login form could have
 * been a server action, in which case the hook would never fire for a human and
 * the entire fix would cover API clients only.
 *
 * Reading `LoginForm/index.js` says it posts to `/users/login`. This spec is
 * what makes that a measurement rather than a reading.
 *
 * ⚠️ VERIFIED THROUGH THE AUTHENTICATED ADMIN API, using the SAME browser
 * context that performed the login. So the assertion exercises the audit-log
 * read access as well — if `audit-log` were not `read: isAdmin`, or the session
 * were not real, these queries would fail rather than quietly pass.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.beforeAll(() => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are not set. Produce them with ' +
        '`npm run admin:reset-password -- <email>` against the sv_test database.',
    )
  }
})

const login = async (page: Page, email = EMAIL!, password = PASSWORD!) => {
  await page.goto('/admin/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).first().fill(password)
  await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
  await page.waitForTimeout(4000)
}

type AuditRow = {
  action: string
  entityType: string
  entityId: string
  changes?: Record<string, unknown> | null
  createdAt: string
}

/**
 * 🔴 THE `Origin` HEADER IS REQUIRED, AND THAT IS A SECURITY CONTROL WORKING —
 * NOT A WORKAROUND.
 *
 * MEASURED while writing this spec: a request carrying a perfectly valid
 * `sv-token` cookie but NO `Origin` header is treated as unauthenticated.
 * `GET /payload-api/users/me` returned `{"user":null}` and every admin-only
 * read returned 403; adding `Origin: http://localhost:3001` — which is the
 * single entry in this deployment's `CSRF_ORIGINS` — returned the user and 200.
 *
 * That is Payload's CSRF defence: a cookie alone is not sufficient authority,
 * because a cookie is exactly what a malicious third-party page can cause the
 * browser to send. A real browser always attaches `Origin`; Playwright's
 * `APIRequestContext` does not, so these helpers must.
 *
 * Worth stating plainly because the failure mode is misleading — it looks like
 * broken authentication rather than enforced CSRF, and "fixing" it by widening
 * `csrf` would be removing a control to make a test pass.
 */
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3001'
const sameOrigin = { Origin: ORIGIN }

/** Reads the audit log through the admin API, with the browser's own cookies. */
const auditRows = async (
  request: APIRequestContext,
  action: string,
  entityId?: string,
): Promise<AuditRow[]> => {
  const params = new URLSearchParams({
    'where[action][equals]': action,
    sort: '-createdAt',
    limit: '25',
    depth: '0',
  })
  if (entityId) params.set('where[entityId][equals]', entityId)
  const res = await request.get(`/payload-api/audit-log?${params.toString()}`, {
    headers: sameOrigin,
  })
  if (!res.ok()) {
    throw new Error(
      `reading the audit log failed with ${res.status()} — the admin session or the ` +
        'Origin header is missing, so an empty result would be indistinguishable from "no rows"',
    )
  }
  const body = (await res.json()) as { docs?: AuditRow[] }
  return body.docs ?? []
}

/** Creates a disposable admin in the test database, via the admin API. */
const makeThrowawayUser = async (
  request: APIRequestContext,
  opts: { isActive?: boolean } = {},
): Promise<{ id: string; email: string; password: string }> => {
  const email = `e2e-authaudit-${Date.now()}-${Math.floor(performance.now())}@example.com`
  const password = 'orchard-lantern-bridge-quiet-e2e'
  const res = await request.post('/payload-api/users', {
    headers: sameOrigin,
    data: {
      email,
      password,
      name: 'E2E Auth Audit',
      role: 'admin',
      isActive: opts.isActive ?? true,
    },
  })
  expect(res.status(), 'creating a throwaway admin must succeed').toBeLessThan(300)
  const body = (await res.json()) as { doc?: { id?: string } }
  return { id: String(body.doc?.id ?? ''), email, password }
}

// ---------------------------------------------------------------------------

test.describe('D-2: a failed login in the panel reaches the audit log', () => {
  test('a wrong password typed into the admin form writes a login_failed row', async ({
    page,
    context,
  }) => {
    // Sign in first so the audit log is readable, and create the victim account.
    await login(page)
    const victim = await makeThrowawayUser(context.request)

    const before = await auditRows(context.request, 'login_failed', victim.id)
    expect(before.length, 'a brand-new account has no failures yet').toBe(0)

    // Sign out, then fail a login AS A HUMAN WOULD — typing into the form.
    await page.goto('/admin/logout')
    await page.waitForTimeout(2500)

    await page.goto('/admin/login')
    await page.getByLabel(/email/i).fill(victim.email)
    await page.getByLabel(/password/i).first().fill('this-is-the-wrong-passphrase')
    await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
    await page.waitForTimeout(4000)

    // Still refused, and still on the login screen.
    expect(page.url(), 'a wrong password must not reach the dashboard').toMatch(/login/)

    // Sign back in to read the log.
    await login(page)
    const after = await auditRows(context.request, 'login_failed', victim.id)

    console.log(
      `[e2e] login_failed rows for the victim: ${after.length} ` +
        `reason=${JSON.stringify(after[0]?.changes ?? null)}`,
    )

    // 🔴 THE ASSERTION. Before this fix the count stayed at zero no matter how
    // many passwords were guessed, through the panel or the API.
    expect(
      after.length,
      'a failed login typed into the admin panel must be audited',
    ).toBeGreaterThan(0)
    expect(after[0]!.changes).toMatchObject({ reason: 'wrong_password' })
    expect(after[0]!.entityType).toBe('users')

    // And the attempted password must appear nowhere in the record.
    expect(JSON.stringify(after)).not.toContain('this-is-the-wrong-passphrase')
  })

  test('repeated failures lock the account and write exactly one lockout row', async ({
    page,
    context,
  }) => {
    /**
     * Uses a throwaway account precisely so the shared e2e administrator is
     * never locked — a lockout there would cascade into every later spec as a
     * mysterious authentication failure.
     */
    await login(page)
    const victim = await makeThrowawayUser(context.request)

    await page.goto('/admin/logout')
    await page.waitForTimeout(2000)

    // Six attempts: five to exhaust `maxLoginAttempts`, one more while locked.
    for (let i = 0; i < 6; i++) {
      await page.goto('/admin/login')
      await page.getByLabel(/email/i).fill(victim.email)
      await page.getByLabel(/password/i).first().fill(`wrong-attempt-number-${i}`)
      await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
      await page.waitForTimeout(1800)
    }

    // Even the CORRECT password is now refused.
    await page.goto('/admin/login')
    await page.getByLabel(/email/i).fill(victim.email)
    await page.getByLabel(/password/i).first().fill(victim.password)
    await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
    await page.waitForTimeout(3000)
    expect(page.url(), 'a locked account must be refused its own password').toMatch(/login/)

    await login(page)
    const failures = await auditRows(context.request, 'login_failed', victim.id)
    const lockouts = await auditRows(context.request, 'lockout', victim.id)

    console.log(`[e2e] failures=${failures.length} lockouts=${lockouts.length}`)

    expect(failures.length, 'every refused attempt is recorded').toBeGreaterThanOrEqual(5)
    // 🔴 The dedupe: one security event, one row, however many attempts follow.
    expect(lockouts.length, 'a lock window produces exactly one lockout row').toBe(1)
    expect(lockouts[0]!.changes).toHaveProperty('lockedUntil')
  })

  test('a DEACTIVATED account is refused, and recorded as such', async ({ page, context }) => {
    await login(page)
    const victim = await makeThrowawayUser(context.request, { isActive: false })

    await page.goto('/admin/logout')
    await page.waitForTimeout(2000)

    await page.goto('/admin/login')
    await page.getByLabel(/email/i).fill(victim.email)
    await page.getByLabel(/password/i).first().fill(victim.password)
    await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
    await page.waitForTimeout(4000)

    // Refused despite the password being CORRECT — this is D-4 in the browser.
    expect(page.url(), 'a deactivated account must not reach the dashboard').toMatch(/login/)

    // And the message must not reveal that the account exists but is disabled.
    const shown = await page.locator('body').innerText()
    expect(shown).not.toMatch(/deactivated|disabled|inactive/i)
    console.log('[e2e] inactive-login message does not disclose account state: true')

    await login(page)
    const rows = await auditRows(context.request, 'login_failed', victim.id)
    console.log(`[e2e] inactive login recorded as: ${JSON.stringify(rows[0]?.changes ?? null)}`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.changes).toMatchObject({ reason: 'inactive_account' })
  })
})

// ---------------------------------------------------------------------------

test.describe('D-4: deactivation ends a session that is already open', () => {
  test('an open session stops working the moment the account is deactivated', async ({
    browser,
    page,
    context,
  }) => {
    /**
     * 🔴 THE HALF OF D-4 THAT A LOCAL-API TEST CANNOT PROVE. The integration
     * test asserts the `sessions` array is emptied; what matters to a dismissed
     * administrator is whether THE COOKIE IN THEIR BROWSER still opens the
     * panel. Two independent browser contexts are the only way to observe that.
     *
     *   · `victimContext` — the user being removed, signed in and working.
     *   · `context`       — the administrator doing the removing.
     */
    await login(page)
    const victim = await makeThrowawayUser(context.request)

    const victimContext = await browser.newContext()
    const victimPage = await victimContext.newPage()
    try {
      await login(victimPage, victim.email, victim.password)

      // The victim is genuinely in: an authenticated API call succeeds.
      const meBefore = await victimContext.request.get('/payload-api/users/me', {
        headers: sameOrigin,
      })
      const meBeforeBody = (await meBefore.json()) as { user?: { email?: string } | null }
      expect(meBeforeBody.user?.email, 'the victim must start out signed in').toBe(victim.email)
      console.log('[e2e] victim session before deactivation: active')

      // The administrator unticks Is Active.
      const patch = await context.request.patch(`/payload-api/users/${victim.id}`, {
        headers: sameOrigin,
        data: { isActive: false },
      })
      expect(patch.status(), 'deactivation must succeed').toBeLessThan(300)

      // 🔴 THE ASSERTION. Previously this still returned the user, because
      // unticking `isActive` left the session intact until `tokenExpiration`
      // and the field's help text told the operator to change the password as a
      // second step. `revokeSessionsOnDeactivate` empties `sessions`, so the
      // outstanding cookie no longer resolves.
      const meAfter = await victimContext.request.get('/payload-api/users/me', {
        headers: sameOrigin,
      })
      const meAfterBody = (await meAfter.json()) as { user?: { email?: string } | null }
      console.log(`[e2e] victim session after deactivation: ${meAfterBody.user ? 'STILL ACTIVE' : 'revoked'}`)
      expect(
        meAfterBody.user ?? null,
        'the existing session must be revoked immediately, with no second step',
      ).toBeNull()

      // And the panel itself bounces them back to the login screen.
      await victimPage.goto('/admin/collections/projects')
      await victimPage.waitForTimeout(3000)
      expect(victimPage.url(), 'the panel must send a revoked session to login').toMatch(
        /login|unauthor/i,
      )
    } finally {
      // 🔴 CLEANUP IN `finally`, so a failed assertion cannot leak a browser
      // context and wedge the rest of the run.
      await victimPage.close().catch(() => undefined)
      await victimContext.close().catch(() => undefined)
    }
  })
})
