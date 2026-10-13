import { defineConfig, devices } from '@playwright/test'

/**
 * BROWSER VERIFICATION OF THE ADMIN PANEL.
 *
 * 🔴 WHY THIS EXISTS. Every prior audit of this CMS verified the Local API, the
 * public contract and the database — and none of it touched the Admin Panel the
 * administrator actually uses. That gap hid a specific, high-impact unknown:
 * Payload wraps a failed custom `validate` in a ValidationError whose
 * `.message` is a generic summary ("The following field is invalid: Alt") and
 * puts the authored text in `.data.errors[].message`. Whether an administrator
 * ever SEES the authored message is not answerable from code.
 *
 * ⚠️ SPECS LIVE IN `e2e/`, NOT `tests/`. Vitest owns `tests/**\/*.test.ts`
 * (vitest.config.mts); Playwright owns `e2e/**\/*.spec.ts`. Keeping them in
 * separate trees is what stops each runner trying to execute the other's files.
 *
 * 🔴 POINTED AT THE DISPOSABLE INSTANCE ONLY. `baseURL` is localhost:3001,
 * which is `npm run dev` loading `.env.test` — the `sv_test` database on
 * :5433 with Cloudinary inert. Credentials come from a scratchpad env file that
 * is NOT in the repository, produced by `npm run admin:reset-password` against
 * that same disposable database. Nothing here can reach production.
 */
export default defineConfig({
  testDir: './e2e',
  // One worker: these specs share a single database and a single admin session.
  workers: 1,
  fullyParallel: false,
  // Payload's admin is a heavy React app; first paint after a cold dev server is
  // slow enough that the default 30s produces false failures.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    ...devices['Desktop Chrome'],
    // Evidence for the report: a trace and a screenshot for anything that fails.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
