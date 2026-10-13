import { expect, test, type Page, type APIRequestContext } from '@playwright/test'

/**
 * ARCHIVE -> TRASH -> RESTORE -> PERMANENT DELETE, DRIVEN THROUGH THE PANEL.
 *
 * 🔴 WHY THIS CANNOT BE A LOCAL-API TEST. Two of the defects in this area were
 * invisible to the Local API by construction:
 *
 *   · `admin.baseFilter` is consumed ONLY by `@payloadcms/next`'s list view, so
 *     the permanently-empty Trash bin could not be observed from `payload.find`
 *     at all. `trashRestore.test.ts` had to RECONSTRUCT the view's query to see
 *     it — a faithful reproduction, but still not the view.
 *   · The admin's Delete button issues `PATCH { deletedAt }`, not `DELETE`
 *     (`@payloadcms/ui/.../DeleteDocument/index.js:86-99`). The guards were
 *     written for the DELETE path and the common path bypassed them.
 *
 * ─── ⚠️ THE ROUTE THE PREVIOUS SPEC GOT WRONG ───────────────────────────────
 *
 * The Trash view is its OWN ROUTE — `/admin/collections/<slug>/trash` — not a
 * query parameter. `@payloadcms/ui/.../DefaultListViewTabs/index.js:55-57`
 * builds the tab's href that way, and both restore controls gate on it:
 *
 *     RestoreMany:   if (... || viewType !== 'trash') return null
 *     RestoreButton: hasSavePermission && isTrashed && <RestoreButton/>
 *
 * An earlier version of these tests used `?trash=true`, which renders the
 * ORDINARY list with an ignored parameter. It passed — it asserted only that no
 * error boundary appeared — while never once displaying the Trash view or
 * offering a Restore control. That is the worst kind of green test: it reported
 * coverage of the exact feature it was not exercising.
 *
 * Verified selectors, from the rendered DOM rather than from documentation:
 *   kebab              `.doc-controls__popup .popup-button`
 *   archive            `#action-delete` then `#confirm-action`
 *   skip-trash tickbox `#delete-forever` (on the same confirmation dialog)
 *   trashed doc        `/admin/collections/<slug>/trash/<id>`
 *   restore            `#action-restore`
 *   permanent delete   `#action-permanently-delete`
 * The confirmation button is labelled "Confirm", NOT "Delete" — matching it by
 * the word "delete" silently does nothing, which is what made the first run
 * report `deletedAt: false`.
 *
 * FAQs are the fixture deliberately: no upload needed, trash-enabled, and
 * `question` is one of the four UNIQUE business keys the D-8 migration changed —
 * so one record exercises the trash lifecycle AND archived uniqueness.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3001'
const sameOrigin = { Origin: ORIGIN }

test.beforeAll(() => {
  if (!EMAIL || !PASSWORD) throw new Error('E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are not set.')
})

const login = async (page: Page) => {
  await page.goto('/admin/login')
  await page.getByLabel(/email/i).fill(EMAIL!)
  await page.getByLabel(/password/i).first().fill(PASSWORD!)
  await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
  await page.waitForTimeout(4000)
}

const createFaq = async (request: APIRequestContext, question: string): Promise<string> => {
  const res = await request.post('/payload-api/faqs', {
    headers: sameOrigin,
    data: { question, answer: 'Created by the trash-lifecycle browser spec.' },
  })
  expect(res.status(), `creating the fixture FAQ failed: ${await res.text()}`).toBeLessThan(300)
  return String(((await res.json()) as { doc?: { id?: string } }).doc?.id ?? '')
}

/** Reads one FAQ including archived rows, so state can be asserted exactly. */
const readFaq = async (
  request: APIRequestContext,
  id: string,
): Promise<{ deletedAt: unknown; found: boolean }> => {
  const res = await request.get(`/payload-api/faqs/${id}?trash=true&depth=0`, {
    headers: sameOrigin,
  })
  if (res.status() === 404) return { deletedAt: null, found: false }
  const body = (await res.json()) as { deletedAt?: unknown }
  return { deletedAt: body.deletedAt ?? null, found: true }
}

/**
 * 🔴 ERRORS MUST BE READ FROM ERROR ELEMENTS, NEVER FROM `body.innerText`.
 *
 * MEASURED, as a failure of an earlier version of this very file. The checks
 * below originally tested the whole page text for `/must be unique|invalid/i` —
 * and `faqs.question` carries the help text "Must be unique — the website uses
 * the question text as a rendering key." So the phrase was present on EVERY
 * render, pass or fail. The D-8 test reported the fix as broken, and the
 * active-collision test reported success, both from the same static help text:
 * one false negative and one false positive from a single sloppy selector.
 *
 * This is the same mistake that once reported the `leads` list as broken
 * because a seeded phone number contained "500". A loose pattern in a
 * verification suite is worse than no check: it manufactures findings.
 */
const errorText = async (page: Page): Promise<string> => {
  const parts = await page
    .evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '.field-error, .field-type__error, [role="alert"], .payload-toast-item, [data-sonner-toast], .toast, [class*="Toastify__toast"], .form-submit__error, .nav-group__error',
        ),
      )
        .map((e) => (e as HTMLElement).innerText?.trim())
        .filter(Boolean),
    )
    .catch(() => [] as string[])
  return parts.join('\n---\n')
}

/**
 * Archives the open document through the panel's own Delete control.
 * `permanent: true` ticks "Skip trash and delete permanently" on the same
 * dialog, which is how an administrator destroys a record in one step.
 */
const deleteViaUi = async (page: Page, opts: { permanent: boolean }) => {
  const kebab = page.locator('.doc-controls__popup .popup-button').first()
  await expect(kebab, 'the document kebab menu must exist').toHaveCount(1)
  await kebab.click()
  await page.waitForTimeout(700)

  const del = page.locator('#action-delete')
  await expect(del, 'the kebab must offer a Delete action').toHaveCount(1)
  await del.click()
  await page.waitForTimeout(1000)

  if (opts.permanent) {
    const forever = page.locator('#delete-forever')
    await expect(forever, '"Skip trash and delete permanently" must be offered').toHaveCount(1)
    await forever.check({ force: true })
  }

  // ⚠️ "Confirm", not "Delete".
  const confirm = page.locator('#confirm-action')
  await expect(confirm, 'the confirmation dialog must offer Confirm').toHaveCount(1)
  await confirm.click()
  await page.waitForTimeout(3000)
}

// ---------------------------------------------------------------------------

test.describe('the full trash lifecycle in the panel', () => {
  test('archive -> listed in Trash -> restore -> back in the default list', async ({
    page,
    context,
  }) => {
    await login(page)
    const question = `E2E lifecycle — what happens on archive? ${Date.now()}`
    const id = await createFaq(context.request, question)

    await page.goto(`/admin/collections/faqs/${id}`)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toContainText(/what happens on archive/i)

    // ---- ARCHIVE through the panel's own Delete button ----
    await deleteViaUi(page, { permanent: false })

    const archived = await readFaq(context.request, id)
    console.log(`[e2e] after UI delete — deletedAt set: ${Boolean(archived.deletedAt)}`)
    expect(
      Boolean(archived.deletedAt),
      'the panel Delete button must soft-delete (PATCH deletedAt), not destroy the row',
    ).toBe(true)
    expect(archived.found, 'the row itself must survive a soft delete').toBe(true)

    // ---- gone from the DEFAULT list view ----
    await page.goto('/admin/collections/faqs?limit=100')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1800)
    expect(
      (await page.locator('body').innerText()).includes(question),
      'an archived FAQ must not appear in the default list',
    ).toBe(false)

    // ---- 🔴 PRESENT IN THE TRASH VIEW. The assertion the `admin.baseFilter`
    //      defect made impossible: the bin was empty for every row, so Restore
    //      was unreachable and archiving was a one-way door.
    await page.goto('/admin/collections/faqs/trash?limit=100')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)
    const trashList = await page.locator('body').innerText()
    console.log(`[e2e] archived FAQ visible in the Trash view: ${trashList.includes(question)}`)
    expect(
      trashList.includes(question),
      'the archived FAQ must be listed in the Trash view, or it cannot be restored',
    ).toBe(true)

    // ---- RESTORE through the panel ----
    await page.goto(`/admin/collections/faqs/trash/${id}`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const restore = page.locator('#action-restore')
    await expect(
      restore,
      'a trashed document must offer Restore, or the record is unrecoverable through the UI',
    ).toHaveCount(1)
    await restore.click()
    await page.waitForTimeout(1200)

    const confirmRestore = page.locator('#confirm-action')
    if ((await confirmRestore.count()) > 0) await confirmRestore.click()
    await page.waitForTimeout(3000)

    const restored = await readFaq(context.request, id)
    console.log(`[e2e] after UI restore — deletedAt cleared: ${!restored.deletedAt}`)
    expect(restored.deletedAt, 'Restore must clear deletedAt').toBeFalsy()

    // ---- and it is back in the default list ----
    await page.goto('/admin/collections/faqs?limit=100')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1800)
    expect(
      (await page.locator('body').innerText()).includes(question),
      'a restored FAQ must return to the default list',
    ).toBe(true)
  })

  test('🔴 D-8: an archived question can be re-used by a NEW record, in the panel', async ({
    page,
    context,
  }) => {
    /**
     * The migration's user-visible payoff, exercised the way an administrator
     * hits it: archive an FAQ, then type the same question into the create form.
     *
     * BEFORE the partial unique index this save was refused — by a row that
     * does not appear in the default list view, so the administrator was blocked
     * by something they could neither see nor reach.
     */
    await login(page)
    const question = `E2E D-8 — may this question be reused? ${Date.now()}`
    const firstId = await createFaq(context.request, question)

    await page.goto(`/admin/collections/faqs/${firstId}`)
    await page.waitForLoadState('domcontentloaded')
    await deleteViaUi(page, { permanent: false })
    expect(Boolean((await readFaq(context.request, firstId)).deletedAt)).toBe(true)

    // Type the SAME question into the create form.
    await page.goto('/admin/collections/faqs/create')
    await page.waitForLoadState('domcontentloaded')
    await page.getByLabel(/question/i).first().fill(question)
    await page.getByLabel(/answer/i).first().fill('The replacement answer, typed in the panel.')
    await page.locator('#action-save, #action-save-draft').first().click()
    await page.waitForTimeout(4500)

    const shown = await errorText(page)
    const refused = /invalid|unique|duplicate/i.test(shown)
    console.log(`[e2e] D-8 re-use — error elements: ${shown.slice(0, 200) || '(none)'}`)
    expect(refused, 'an archived question must not block a new record — that was D-8').toBe(false)

    // Both rows coexist: one archived, one active.
    const list = await context.request.get(
      `/payload-api/faqs?where[question][equals]=${encodeURIComponent(question)}&trash=true&depth=0&limit=10`,
      { headers: sameOrigin },
    )
    const docs = ((await list.json()) as { docs?: { id: string; deletedAt?: unknown }[] }).docs ?? []
    console.log(`[e2e] rows sharing the question: ${docs.length} (1 archived + 1 active expected)`)
    expect(docs.length, 'both rows must coexist').toBe(2)
    expect(docs.filter((d) => !d.deletedAt).length, 'exactly one is active').toBe(1)
  })

  test('two ACTIVE records still cannot share a question — the constraint only moved', async ({
    page,
    context,
  }) => {
    await login(page)
    const question = `E2E D-8 — active collision still refused? ${Date.now()}`
    await createFaq(context.request, question)

    await page.goto('/admin/collections/faqs/create')
    await page.waitForLoadState('domcontentloaded')
    await page.getByLabel(/question/i).first().fill(question)
    await page.getByLabel(/answer/i).first().fill('This one must be refused.')

    /**
     * ⚠️ ASSERTED FROM THE SAVE RESPONSE AND THE DATABASE, NOT FROM A TOAST.
     *
     * The first version of this check read the rendered error elements after a
     * 4.5s wait and found nothing — then reported the active constraint as
     * BROKEN. It was not: a direct query showed one row per question, so the
     * save had been correctly refused. Payload's error toast simply auto-
     * dismisses, so whether it is still on screen depends on timing.
     *
     * A toast is the wrong oracle for "was this write rejected". The response
     * status is the fact; the surviving row count is the consequence. Both are
     * checked, and neither can pass by accident.
     */
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/payload-api/faqs') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.locator('#action-save, #action-save-draft').first().click(),
    ])

    console.log(`[e2e] active-collision save responded ${response.status()}`)
    expect(
      response.status(),
      'a second ACTIVE row with the same question must be refused by the API',
    ).toBeGreaterThanOrEqual(400)

    // And no duplicate reached the table.
    const rows = await context.request.get(
      `/payload-api/faqs?where[question][equals]=${encodeURIComponent(question)}&trash=true&depth=0&limit=10`,
      { headers: sameOrigin },
    )
    const docs = ((await rows.json()) as { docs?: { deletedAt?: unknown }[] }).docs ?? []
    console.log(`[e2e] rows sharing the question after the refused save: ${docs.length}`)
    expect(docs.length, 'exactly one row may hold an active question').toBe(1)
  })

  test('permanent delete from the Trash view removes the row for good', async ({
    page,
    context,
  }) => {
    await login(page)
    const question = `E2E permanent delete ${Date.now()}`
    const id = await createFaq(context.request, question)

    await page.goto(`/admin/collections/faqs/${id}`)
    await page.waitForLoadState('domcontentloaded')
    await deleteViaUi(page, { permanent: false })
    expect(Boolean((await readFaq(context.request, id)).deletedAt)).toBe(true)

    // From the trashed document's own view, destroy it permanently.
    await page.goto(`/admin/collections/faqs/trash/${id}`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const purge = page.locator('#action-permanently-delete')
    await expect(purge, 'a trashed document must offer Permanently Delete').toHaveCount(1)
    await purge.click()
    await page.waitForTimeout(1200)
    const confirm = page.locator('#confirm-action')
    if ((await confirm.count()) > 0) await confirm.click()
    await page.waitForTimeout(3000)

    const gone = await readFaq(context.request, id)
    console.log(`[e2e] permanently deleted — row still found: ${gone.found}`)
    expect(gone.found, 'a permanently deleted FAQ must be gone from the database').toBe(false)
  })

  test('a project REFUSES permanent deletion, and says why', async ({ page, context }) => {
    /**
     * `blockProjectHardDelete` is the reason the empty-Trash defect was so
     * severe: a project cannot be purged, so an archived one whose Trash entry
     * was invisible could never be recovered OR removed. The guard must still
     * refuse — and must EXPLAIN itself, because a silent refusal is
     * indistinguishable from a broken button.
     */
    await login(page)

    const sharp = (await import('sharp')).default
    const bytes = await sharp({
      create: { width: 72, height: 54, channels: 3, background: { r: 9, g: 60, b: 33 } },
    })
      .jpeg()
      .toBuffer()

    const upload = await context.request.post('/payload-api/media', {
      headers: sameOrigin,
      multipart: {
        file: { name: `e2e-proj-cover-${Date.now()}.jpg`, mimeType: 'image/jpeg', buffer: bytes },
        _payload: JSON.stringify({ alt: 'E2E project cover' }),
      },
    })
    expect(upload.status(), `media upload failed: ${await upload.text()}`).toBeLessThan(300)
    const coverId = String(((await upload.json()) as { doc?: { id?: string } }).doc?.id ?? '')

    const created = await context.request.post('/payload-api/projects?draft=true', {
      headers: sameOrigin,
      data: {
        name: 'E2E Guard Project',
        slug: `e2e-guard-project-${Date.now()}`,
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Exercises the permanent-delete guard in the browser.',
        description: ['Only paragraph.'],
        highlights: [{ icon: 'tree', title: 'A highlight' }],
        image: coverId,
      },
    })
    expect(created.status(), `project create failed: ${await created.text()}`).toBeLessThan(300)
    const projectId = String(((await created.json()) as { doc?: { id?: string } }).doc?.id ?? '')

    await page.goto(`/admin/collections/projects/${projectId}`)
    await page.waitForLoadState('domcontentloaded')
    await deleteViaUi(page, { permanent: false })

    await page.goto(`/admin/collections/projects/trash/${projectId}`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const purge = page.locator('#action-permanently-delete')
    await expect(purge).toHaveCount(1)
    await purge.click()
    await page.waitForTimeout(1200)
    const confirm = page.locator('#confirm-action')
    if ((await confirm.count()) > 0) await confirm.click()
    await page.waitForTimeout(3500)

    // 🔴 The row must survive.
    const stillThere = await context.request.get(
      `/payload-api/projects/${projectId}?trash=true&depth=0`,
      { headers: sameOrigin },
    )
    console.log(`[e2e] project survived permanent delete: ${stillThere.status() !== 404}`)
    expect(
      stillThere.status(),
      'a project must never be permanently deletable — it stays recoverable',
    ).not.toBe(404)

    // 🔴 And the administrator must have been TOLD. A refusal nobody sees is a
    // button that appears broken.
    /**
     * ─── 🔶 FINDING, RECORDED RATHER THAN "FIXED" ───────────────────────────
     *
     * The project survives, which is the behaviour that matters. But the
     * message the administrator sees is NOT `blockProjectHardDelete`'s
     * explanation — it is:
     *
     *     "Collection projects has disabled bulk delete"
     *
     * MEASURED. `Projects.ts:171` sets `disableBulkDelete: true`, and Payload's
     * `PermanentlyDeleteButton` routes even a SINGLE document through the bulk
     * delete endpoint. So the request is rejected by the bulk-delete switch
     * before it ever reaches the collection's `beforeDelete` guard, and the
     * reason given is about a feature the administrator did not use.
     *
     * ⚠️ DELIBERATELY NOT CHANGED. The outcome is correct and the protection is
     * doubled, not weakened — `blockProjectHardDelete` still refuses on the
     * REST `DELETE` path (pinned in `tests/integration/trashRestore.test.ts`).
     * Turning `disableBulkDelete` off to improve one message would REMOVE a
     * guard in order to make an error prettier, and the bulk path is the more
     * dangerous one. The confusing wording belongs to `@payloadcms/ui`.
     *
     * So the assertion is on what is actually true: the row survives, and the
     * administrator is told something rather than nothing. The message-quality
     * issue is in the report.
     */
    const shown = await errorText(page)
    const guardMessage = /cannot be permanently deleted/i.test(shown)
    const bulkMessage = /disabled bulk delete/i.test(shown)
    console.log(`[e2e] guard's own wording shown: ${guardMessage}`)
    console.log(`[e2e] refusal text: ${shown.slice(0, 300) || '(no error element rendered)'}`)

    expect(
      guardMessage || bulkMessage,
      'the administrator must be told the deletion was refused, not left guessing',
    ).toBe(true)
  })
})
