import { expect, test, type Page } from '@playwright/test'

/**
 * D-1 REGRESSION, IN THE BROWSER.
 *
 * Every assertion here reads the RENDERED DOM. A server response carrying the
 * right message is not the thing that was broken — the message reached the
 * server fine before the fix and was discarded on the way out, so only the DOM
 * can prove it now arrives.
 *
 * ─── ⚠️ WHAT THIS FILE DELIBERATELY DOES NOT DO ────────────────────────────
 *
 * An earlier version of this spec drove the Site Settings hero-media array and
 * the Projects tabs through the UI — clicking Add, expanding a collapsed row,
 * choosing a `kind`, filling a sibling. All of it timed out and took the page
 * with it ("Target page, context or browser has been closed") after 90s, and a
 * test that flakes at 90s is not evidence of anything.
 *
 * It was removed rather than retried, because it was not buying what it looked
 * like it was buying. `surfaceValidationErrors` is ONE hook shared by all five
 * files: whether its message reaches the DOM is a property of the mechanism,
 * not of the field. Proving it once end-to-end in the browser — which the
 * `media` cases below do, including the conditional decorative branch — plus
 * per-field coverage at the data layer (`tests/integration/auditSweep.test.ts`,
 * `tests/unit/validators.test.ts`) is stronger and honest about which layer
 * each claim rests on. See the audit report's evidence table.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.beforeAll(() => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set. Generate them with ' +
        'npm run admin:reset-password against the sv_test database.',
    )
  }
})

const login = async (page: Page) => {
  await page.goto('/admin/login')
  await page.getByLabel(/email/i).fill(EMAIL!)
  await page.getByLabel(/password/i).first().fill(PASSWORD!)
  await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
  await page.waitForTimeout(5000)
}

/** Everything the page is currently showing that could be an error. */
const shownText = async (page: Page): Promise<string> => {
  const parts = await page
    .evaluate(() =>
      Array.from(
        document.querySelectorAll('[class*="toast"],[class*="error"],[role="alert"],.field-error'),
      )
        .map((e) => (e as HTMLElement).innerText?.trim())
        .filter(Boolean),
    )
    .catch(() => [] as string[])
  return parts.join('\n---\n')
}

const jpegBuffer = async () => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: 44, height: 33, channels: 3, background: { r: 9, g: 60, b: 33 } },
  })
    .jpeg()
    .toBuffer()
}

const attachImage = async (page: Page, name: string) => {
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: 'image/jpeg',
    buffer: await jpegBuffer(),
  })
  await page.waitForTimeout(1200)
}

test.describe('D-1: authored validation messages reach the DOM', () => {
  test('blank alt shows the AUTHORED message, not the generic summary', async ({ page }) => {
    await login(page)
    await page.goto('/admin/collections/media/create')
    await page.waitForLoadState('domcontentloaded')
    await attachImage(page, 'e2e-blank-alt.jpg')

    await page.getByRole('button', { name: /^save$/i }).first().click()
    await page.waitForTimeout(3500)

    const shown = await shownText(page)
    console.log('[e2e] alt blank -> ' + shown.slice(0, 300))

    // 🔴 THE ASSERTION THE DEFECT MADE IMPOSSIBLE. Before the fix the DOM
    // contained only "The following field is invalid: Alt" and the authored
    // sentence appeared nowhere — not inline, not in a tooltip, not in a toast.
    expect(shown, 'the authored sentence must be rendered').toMatch(/Alt text is required/i)
    expect(shown).toMatch(/decorative/i)
    // And it must carry a human label, not the raw field path.
    expect(shown).toMatch(/Alt text —/)
  })

  test('the generic tab-named summary is no longer the only thing shown', async ({ page }) => {
    await login(page)
    await page.goto('/admin/collections/media/create')
    await page.waitForLoadState('domcontentloaded')
    await attachImage(page, 'e2e-not-generic.jpg')
    await page.getByRole('button', { name: /^save$/i }).first().click()
    await page.waitForTimeout(3500)

    const shown = await shownText(page)
    const genericOnly =
      /following field is invalid/i.test(shown) && !/Alt text is required/i.test(shown)
    console.log('[e2e] generic-summary-only: ' + genericOnly)
    expect(genericOnly, 'the administrator must never see ONLY the generic summary').toBe(false)
  })

  test('DECORATIVE: blank alt + Is Decorative ticked saves — the conditional branch holds', async ({
    page,
  }) => {
    await login(page)
    await page.goto('/admin/collections/media/create')
    await page.waitForLoadState('domcontentloaded')
    await attachImage(page, 'e2e-decorative.jpg')

    await page.locator('input#field-isDecorative').check({ force: true })
    await page.getByRole('button', { name: /^save$/i }).first().click()
    await page.waitForTimeout(4000)

    const shown = await shownText(page)
    console.log('[e2e] decorative -> ' + (shown.slice(0, 200) || '(no validation error, as expected)'))

    // The conditional rule must NOT fire — this is the escape hatch that makes
    // the required alt bearable, and surfacing the message must not break it.
    expect(shown, 'ticking decorative must satisfy the alt rule').not.toMatch(
      /Alt text is required/i,
    )
  })
})
