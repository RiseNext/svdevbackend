import { expect, test, type Page } from '@playwright/test'

/**
 * ADMIN PANEL — REAL BROWSER VERIFICATION.
 *
 * The question this file exists to answer is D-1: when a custom `validate`
 * fails, does the administrator SEE the authored message, or only Payload's
 * generic "The following field is invalid: <Label>" summary? The authored
 * strings in this repo are long, specific and load-bearing — "Alt text is
 * required, or tick \"decorative\"…", "Row 3: a YouTube entry needs a poster
 * image…" — and if the panel shows only the summary, none of them reach anyone.
 *
 * Everything else here is the first actual browser coverage of the panel:
 * login, the sidebar inventory, list views, the Trash tab, and the document
 * controls.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.beforeAll(() => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are not set. Produce them with ' +
        '`npm run admin:reset-password -- <email>` against the sv_test database ' +
        'and pass them in the environment. Never use production credentials.',
    )
  }
})

const login = async (page: Page) => {
  await page.goto('/admin/login')
  await page.getByLabel(/email/i).fill(EMAIL!)
  await page.getByLabel(/password/i).first().fill(PASSWORD!)
  await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
  // The dashboard renders the collection groups in the sidebar.
  await expect(page.locator('.nav, aside, nav').first()).toBeVisible({ timeout: 45_000 })
}

/** Collects every candidate error string the panel is showing. */
const visibleErrorText = async (page: Page): Promise<string> => {
  const selectors = [
    '.field-error',
    '.field-type__error',
    '[class*="error"]',
    '[role="alert"]',
    '.Toastify__toast',
    '[data-sonner-toast]',
    '.payload-toast-item',
    '.tooltip',
  ]
  const chunks: string[] = []
  for (const sel of selectors) {
    const els = page.locator(sel)
    const n = await els.count().catch(() => 0)
    for (let i = 0; i < Math.min(n, 25); i++) {
      const t = await els.nth(i).innerText().catch(() => '')
      if (t && t.trim()) chunks.push(t.trim())
    }
  }
  return chunks.join('\n---\n')
}

test.describe('authentication', () => {
  test('the login screen renders, and a wrong password is refused', async ({ page }) => {
    await page.goto('/admin/login')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i).first()).toBeVisible()
    // The forgot-password link is present even though it cannot deliver mail.
    const forgot = page.getByRole('link', { name: /forgot/i })
    console.log(`[e2e] forgot-password link present: ${(await forgot.count()) > 0}`)

    await page.getByLabel(/email/i).fill(EMAIL!)
    await page.getByLabel(/password/i).first().fill('definitely-the-wrong-passphrase')
    await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
    await page.waitForTimeout(2500)
    // Still on the login screen, and an error is shown.
    expect(page.url()).toContain('/admin')
    const err = await visibleErrorText(page)
    console.log(`[e2e] wrong-password feedback: ${err.slice(0, 180) || '(none captured)'}`)
    expect(err.length, 'a failed login must show the user something').toBeGreaterThan(0)
  })

  test('a valid admin can sign in and reach the dashboard', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/\/admin/)
    const title = await page.title()
    console.log(`[e2e] document title: ${title}`)
    expect(title).toContain('SV Developers')
  })
})

test.describe('sidebar inventory', () => {
  test('every expected collection and the global are reachable', async ({ page }) => {
    await login(page)
    const body = await page.locator('body').innerText()
    const expected = [
      'Users',
      'Media',
      'Documents',
      'Videos',
      'Projects',
      'Blog Posts',
      'Leads',
      'Testimonials',
      'Faqs',
      'Statistics',
      'Site Settings',
    ]
    const missing = expected.filter((label) => !body.includes(label))
    console.log(`[e2e] sidebar labels missing: ${missing.length ? missing.join(', ') : 'none'}`)
    expect(missing, 'sidebar should list every admin-visible entity').toEqual([])
    // Group headings, which the audit derived from code rather than observing.
    for (const group of ['Content', 'Media', 'Enquiries', 'Administration', 'System', 'Configuration']) {
      console.log(`[e2e] group "${group}" present: ${body.includes(group)}`)
    }
  })

  test('each list view loads without an error boundary', async ({ page }) => {
    await login(page)
    for (const slug of [
      'projects',
      'blog-posts',
      'testimonials',
      'faqs',
      'statistics',
      'media',
      'documents',
      'videos',
      'leads',
      'users',
      'audit-log',
      'payload-jobs',
    ]) {
      await page.goto(`/admin/collections/${slug}`)
      await page.waitForLoadState('domcontentloaded')
      const text = await page.locator('body').innerText()
      /**
       * ⚠️ THE PATTERN MUST BE SPECIFIC TO AN ERROR BOUNDARY, NOT MERELY
       * ERROR-SHAPED. This originally included a bare `500` and `Unhandled`,
       * and reported `leads` as broken — because a seeded enquiry's phone
       * number is `9876500011`, which contains "500". The list was rendering
       * perfectly: columns, rows, `1-2 of 2`, `Per Page: 50`, Trash tab.
       *
       * A loose pattern in an audit is worse than no check at all: it
       * manufactures a defect report against working code.
       */
      const broken =
        /Application error|a client-side exception|something went wrong|Internal Server Error|This page could not be loaded/i.test(
          text,
        )
      console.log(`[e2e] list ${slug}: ${broken ? 'ERROR' : 'ok'}`)
      expect(broken, `${slug} list view rendered an error`).toBe(false)
    }
  })

  test('the Trash tab exists on every trash-enabled collection, at its real route', async ({
    page,
  }) => {
    /**
     * 🔴 CORRECTED. This test used to navigate to `?trash=true`, which is NOT
     * the Trash view — it renders the ORDINARY list with an ignored query
     * parameter. The assertion was only "no error boundary appeared", so it
     * passed while never displaying the bin, and reported coverage of the one
     * feature `admin.baseFilter` had broken.
     *
     * The real route is `/admin/collections/<slug>/trash`
     * (`@payloadcms/ui/.../DefaultListViewTabs/index.js:55-57`), and the pill
     * that links to it carries `id="trash-view-pill"`. Both are asserted now,
     * across every trash-enabled collection rather than just `projects`.
     *
     * The full archive -> restore -> purge round trip lives in
     * `trashLifecycle.spec.ts`.
     */
    await login(page)

    const TRASH_ENABLED = [
      'projects',
      'blog-posts',
      'leads',
      'testimonials',
      'faqs',
      'statistics',
      'media',
      'documents',
      'videos',
    ]

    for (const slug of TRASH_ENABLED) {
      await page.goto(`/admin/collections/${slug}`)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)

      const pill = page.locator('#trash-view-pill')
      const hasPill = (await pill.count()) > 0
      console.log(`[e2e] ${slug}: Trash pill present: ${hasPill}`)
      expect(hasPill, `${slug} must offer a Trash tab — trash: true is set on it`).toBe(true)

      await page.goto(`/admin/collections/${slug}/trash`)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)

      const body = await page.locator('body').innerText()
      const broken =
        /Application error|a client-side exception|something went wrong|Internal Server Error|This page could not be loaded/i.test(
          body,
        )
      expect(broken, `${slug} trash view rendered an error`).toBe(false)
      // The URL must have stayed on the trash route — a redirect away would
      // mean the view does not exist for this collection.
      expect(page.url(), `${slug} must stay on its trash route`).toContain(`${slug}/trash`)
    }
  })

  test('a collection without trash offers no Trash tab', async ({ page }) => {
    // The negative half: `audit-log` and `users` both set `trash: false`, so a
    // bin there would be a configuration error rather than a feature.
    await login(page)
    for (const slug of ['audit-log', 'users']) {
      await page.goto(`/admin/collections/${slug}`)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)
      const n = await page.locator('#trash-view-pill').count()
      console.log(`[e2e] ${slug}: Trash pill present: ${n > 0} (expected false)`)
      expect(n, `${slug} has trash: false and must not offer a Trash tab`).toBe(0)
    }
  })
})

test.describe('🔴 D-1: are custom validation messages visible to the administrator?', () => {
  test('Media: saving with blank alt shows the AUTHORED message, not just the summary', async ({
    page,
  }) => {
    await login(page)
    await page.goto('/admin/collections/media/create')
    await page.waitForLoadState('domcontentloaded')

    /**
     * 🔴 A FILE MUST BE ATTACHED FIRST, AND THAT IS NOT A DETAIL.
     *
     * The first attempt at this test clicked Save on an empty form and asserted
     * on whatever appeared. What appeared was the toast "No files were
     * uploaded." — `filesRequiredOnCreate` fires BEFORE any field validator —
     * so the alt validator never ran and the test proved nothing about D-1.
     *
     * Attaching a real file and leaving Alt blank is the only way to make the
     * alt validator the thing under test.
     */
    const sharp = (await import('sharp')).default
    const bytes = await sharp({
      create: { width: 48, height: 36, channels: 3, background: { r: 10, g: 60, b: 33 } },
    })
      .jpeg()
      .toBuffer()

    await page.setInputFiles('input[type="file"]', {
      name: 'e2e-alt-probe.jpg',
      mimeType: 'image/jpeg',
      buffer: bytes,
    })
    // Let the client-side preview settle before saving.
    await page.waitForTimeout(1500)

    // Alt is deliberately left empty.
    const alt = page.getByLabel(/^alt/i).first()
    if ((await alt.count()) > 0) await alt.fill('')

    const save = page.getByRole('button', { name: /^save$|save changes/i }).first()
    await save.click({ timeout: 20_000 }).catch(() => undefined)
    await page.waitForTimeout(3500)

    const shown = await visibleErrorText(page)
    console.log('[e2e] ===== MEDIA ALT VALIDATION, AS RENDERED =====')
    console.log(shown.slice(0, 1200) || '(nothing captured)')
    console.log('[e2e] =============================================')

    const hasAuthored = /alt text is required|tick "?decorative"?/i.test(shown)
    const hasGenericOnly = /following field is invalid/i.test(shown) && !hasAuthored
    console.log(`[e2e] authored message visible : ${hasAuthored}`)
    console.log(`[e2e] ONLY generic summary      : ${hasGenericOnly}`)

    // This is the audit's decisive assertion. If it fails, D-1 is confirmed as
    // a real usability defect and every authored validate message is invisible.
    expect(
      hasAuthored,
      'D-1: the authored alt-text message must be visible to the administrator, not only "The following field is invalid: Alt"',
    ).toBe(true)
  })

  test('Projects: publishing an empty project shows which fields are required', async ({ page }) => {
    await login(page)
    await page.goto('/admin/collections/projects/create')
    await page.waitForLoadState('domcontentloaded')

    const publish = page
      .getByRole('button', { name: /publish/i })
      .first()
    if ((await publish.count()) > 0) {
      await publish.click({ timeout: 20_000 }).catch(() => undefined)
      await page.waitForTimeout(3000)
    }
    const shown = await visibleErrorText(page)
    console.log('[e2e] ===== PROJECT PUBLISH VALIDATION =====')
    console.log(shown.slice(0, 1200) || '(nothing captured)')
    console.log('[e2e] ======================================')
    expect(shown.length, 'publishing an empty project must surface errors').toBeGreaterThan(0)
  })
})

test.describe('document controls', () => {
  test('a drafts-enabled collection shows Save Draft and a publish control', async ({ page }) => {
    await login(page)
    await page.goto('/admin/collections/projects/create')
    await page.waitForLoadState('domcontentloaded')
    const body = await page.locator('body').innerText()
    for (const label of ['Save Draft', 'Publish', 'Preview', 'API']) {
      console.log(`[e2e] projects create — "${label}" present: ${body.includes(label)}`)
    }
    expect(/save draft/i.test(body), 'Save Draft should be offered on a drafts collection').toBe(true)
  })

  test('Site Settings offers only Save — no publish split, no delete', async ({ page }) => {
    await login(page)
    await page.goto('/admin/globals/site-settings')
    await page.waitForLoadState('domcontentloaded')
    const body = await page.locator('body').innerText()
    console.log(`[e2e] site-settings — "Save Draft" present: ${/save draft/i.test(body)}`)
    console.log(`[e2e] site-settings — tabs present: ${['Brand', 'Contact', 'Social', 'Legal', 'Content'].filter((t) => body.includes(t)).join(', ')}`)
    expect(/save draft/i.test(body), 'a global with drafts:false must NOT offer Save Draft').toBe(false)
  })

  test('the audit log is read-only — no Create button', async ({ page }) => {
    await login(page)
    await page.goto('/admin/collections/audit-log')
    await page.waitForLoadState('domcontentloaded')
    const createLink = page.getByRole('link', { name: /create new/i })
    const n = await createLink.count()
    console.log(`[e2e] audit-log "Create New" controls found: ${n}`)
    expect(n, 'audit-log must not offer a create control').toBe(0)
  })
})
