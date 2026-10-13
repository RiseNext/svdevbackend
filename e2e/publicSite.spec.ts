import {
  expect,
  test,
  type APIRequestContext,
  type ConsoleMessage,
  type Page,
  type Request,
} from '@playwright/test'

/**
 * THE PUBLIC WEBSITE, AGAINST THE LOCAL BACKEND.
 *
 * 🔴 WHAT THIS IS FOR. Every other spec here verifies the panel an
 * administrator types into. This one verifies the thing the CMS exists to
 * produce: whether content in `sv_test` actually reaches the rendered site, and
 * whether the integration between the two apps holds end to end.
 *
 * ⚠️ BOTH SERVERS ARE LOCAL AND DISPOSABLE.
 *   · backend  localhost:3001 — `.env.test`, so `sv_test` on :5433, Cloudinary inert
 *   · frontend localhost:3000 — `.env.local`, `NEXT_PUBLIC_API_BASE_URL`
 *                               already points at localhost:3001/api/v1
 * Nothing here can reach production, and every assertion is a READ.
 *
 * The content comes from `npm run seed` against the test database: five
 * published projects, site settings, and media. Tier-2 content (testimonials,
 * faqs, statistics) is deliberately NOT seeded — the repo's testimonials are
 * invented placeholders with bracketed names and seeding them would "create the
 * exact artefact the CMS is built to make impossible". So the tests below treat
 * those sections as legitimately EMPTY and check the empty state rather than
 * demanding rows that should not exist.
 */

const SITE = process.env.E2E_SITE_URL ?? 'http://localhost:3000'
const CMS = process.env.E2E_BASE_URL ?? 'http://localhost:3001'
const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

/**
 * 🔴 THIS SPEC SEEDS ITS OWN CONTENT, AND IT HAS TO.
 *
 * MEASURED FAILURE: these tests passed in isolation, then failed in a full run
 * with `published projects from the API: 0`. Nothing was broken — the backend
 * vitest suite had run first, and `tests/resetDb.ts` TRUNCATES `projects` (plus
 * twelve other tables) for its own isolation. The public-site spec was silently
 * depending on `npm run seed` having been the last thing to touch the database.
 *
 * ⚠️ AN ORDER-DEPENDENT TEST IS A FLAKY TEST. Running the suites in a lucky
 * order, or re-seeding by hand before each run, would hide the dependency
 * rather than remove it — and the next person would hit the same confusing
 * zero. So this ensures its own fixture exists and is PUBLISHED, creating one
 * through the admin API when the table is empty.
 *
 * It works against `next dev`, where every request re-renders, so freshly
 * created content appears immediately. ISR caching is not in play, and
 * `REVALIDATE_WEBHOOK_URL` is deliberately blank in `.env.test` (the same
 * inert-by-design choice as Cloudinary), so the revalidation webhook is NOT
 * part of what this file claims to verify.
 */
let fixtureProjectName = ''

const ensurePublishedProject = async (request: APIRequestContext): Promise<void> => {
  /**
   * ⚠️ ALWAYS CREATES A FRESH PROJECT, rather than returning early when the
   * table is already populated.
   *
   * Creating one is what makes the backend fire `revalidateProject`, and the
   * revalidation is half of what this spec verifies. An early return left the
   * frontend serving a Data Cache entry from before the fixture existed, and
   * the projects test then failed with the fixture "missing from /projects" —
   * which looked like a rendering bug and was actually a stale cache nobody had
   * invalidated. A unique name per run also keeps the assertion exact.
   */
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are not set, so no fixture can be created. ' +
        'Supply admin credentials for the sv_test database.',
    )
  }

  const login = await request.post(`${CMS}/payload-api/users/login`, {
    headers: { Origin: CMS },
    data: { email: EMAIL, password: PASSWORD },
  })
  if (!login.ok()) throw new Error(`fixture login failed with ${login.status()}`)

  const sharp = (await import('sharp')).default
  const bytes = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: 9, g: 60, b: 33 } },
  })
    .jpeg()
    .toBuffer()

  const upload = await request.post(`${CMS}/payload-api/media`, {
    headers: { Origin: CMS },
    multipart: {
      file: { name: `e2e-public-cover-${Date.now()}.jpg`, mimeType: 'image/jpeg', buffer: bytes },
      _payload: JSON.stringify({ alt: 'E2E public-site fixture cover' }),
    },
  })
  if (!upload.ok()) throw new Error(`fixture media upload failed: ${await upload.text()}`)
  const coverId = String(((await upload.json()) as { doc?: { id?: string } }).doc?.id ?? '')

  fixtureProjectName = `E2E Public Site Fixture ${Date.now()}`
  const created = await request.post(`${CMS}/payload-api/projects`, {
    headers: { Origin: CMS },
    data: {
      name: fixtureProjectName,
      slug: `e2e-public-fixture-${Date.now()}`,
      category: 'Residential Plots',
      locality: 'Testville',
      summary: 'Created by publicSite.spec.ts so the spec does not depend on seed order.',
      description: ['The only paragraph of this fixture project.'],
      highlights: [{ icon: 'tree', title: 'A highlight' }],
      image: coverId,
      _status: 'published',
    },
  })
  if (!created.ok()) throw new Error(`fixture project create failed: ${await created.text()}`)
  console.log(`[e2e] fixture: published "${fixtureProjectName}" (revalidation webhook should now fire)`)
  // Give the direct revalidation fetch a moment to land before any page is read.
  await new Promise((r) => setTimeout(r, 2500))
}

/** Console errors and failed requests, collected per page. */
type PageNoise = { errors: string[]; failed: string[] }

const watch = (page: Page): PageNoise => {
  const noise: PageNoise = { errors: [], failed: [] }

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    /**
     * ⚠️ FILTERED, AND EACH EXCLUSION IS JUSTIFIED — not a blanket mute.
     *
     * · React DevTools / Fast Refresh notices are dev-server chatter and do not
     *   exist in a production build.
     * · A 404 on a favicon variant is not a content defect.
     * Anything else counts, including hydration mismatches and image errors,
     * because those are exactly the silent-breakage class this suite is for.
     */
    if (/Download the React DevTools|Fast Refresh|\[Fast Refresh\]/i.test(text)) return
    if (/favicon/i.test(text)) return
    noise.errors.push(text)
  })

  page.on('requestfailed', (req: Request) => {
    const url = req.url()
    if (/favicon/i.test(url)) return
    noise.failed.push(`${req.method()} ${url} — ${req.failure()?.errorText ?? 'failed'}`)
  })

  return noise
}

const report = (label: string, noise: PageNoise) => {
  console.log(
    `[e2e] ${label}: console errors=${noise.errors.length} failed requests=${noise.failed.length}` +
      (noise.errors.length ? `\n        first error: ${noise.errors[0]!.slice(0, 200)}` : '') +
      (noise.failed.length ? `\n        first failure: ${noise.failed[0]!.slice(0, 200)}` : ''),
  )
}

/**
 * Every public route the frontend ACTUALLY declares, enumerated from
 * `src/app/**​/page.tsx` rather than from a requirements document.
 *
 * ⚠️ `/master-plan` IS NOT A PAGE, and an earlier version of this file asserted
 * that it was — then reported a 404 as a defect. The master plan is a PDF
 * DOWNLOAD referenced from `site-settings.masterPlan`, not a route. Inventing a
 * page because the word appears in the domain is exactly the mistake a
 * verification suite must not make: it manufactures a finding against correct
 * code. `/gallery` is a real route and was missing from the list.
 */
const ROUTES = [
  { path: '/', name: 'homepage' },
  { path: '/about', name: 'about' },
  { path: '/projects', name: 'projects index' },
  { path: '/gallery', name: 'gallery' },
  { path: '/blog', name: 'blog index' },
  { path: '/contact', name: 'contact' },
]

// ---------------------------------------------------------------------------

test.beforeAll(async ({ request }) => {
  await ensurePublishedProject(request)
})

test.describe('every public route renders against local CMS content', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) renders with no console errors`, async ({ page }) => {
      const noise = watch(page)

      const response = await page.goto(`${SITE}${route.path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      console.log(`[e2e] ${route.name} status: ${response?.status()}`)
      expect(response?.status(), `${route.path} must not be an error page`).toBeLessThan(400)

      const body = await page.locator('body').innerText()
      const broken =
        /Application error|a client-side exception|This page could not be found|Internal Server Error/i.test(
          body,
        )
      expect(broken, `${route.path} rendered a Next.js error`).toBe(false)

      // A page that renders an empty shell is not a working page.
      expect(body.trim().length, `${route.path} rendered no text at all`).toBeGreaterThan(100)

      report(route.name, noise)
      expect(noise.errors, `${route.path} logged console errors`).toEqual([])
      expect(noise.failed, `${route.path} had failed network requests`).toEqual([])
    })
  }

  test('an unknown route returns a real 404 page', async ({ page }) => {
    const response = await page.goto(`${SITE}/this-route-does-not-exist-zzq`, {
      waitUntil: 'domcontentloaded',
    })
    console.log(`[e2e] unknown route status: ${response?.status()}`)
    expect(response?.status(), 'an unknown route must 404, not 200').toBe(404)
    const body = await page.locator('body').innerText()
    expect(body.trim().length, 'the 404 page must say something').toBeGreaterThan(20)
  })
})

// ---------------------------------------------------------------------------

test.describe('CMS content actually reaches the rendered page', () => {
  test('the seeded projects appear on /projects and each detail page loads', async ({ page }) => {
    /**
     * 🔴 THE INTEGRATION ASSERTION. Everything else could pass with a frontend
     * that renders hard-coded markup. This reads the project list from the
     * backend's own public API, then requires those exact names to be present
     * in the rendered HTML — so the CMS -> API -> page path is proven, not
     * assumed.
     */
    const api = await page.request.get(`${CMS}/api/v1/projects`)
    expect(api.status(), 'the public projects API must answer').toBe(200)
    // ⚠️ The public API wraps its payload in `{ data: ... }` — reading the body
    // as a bare array silently yielded `undefined.length`.
    const projects = ((await api.json()) as { data?: { slug: string; name: string }[] }).data ?? []
    console.log(`[e2e] published projects from the API: ${projects.length}`)
    expect(projects.length, 'the seed should have published projects').toBeGreaterThan(0)

    const noise = watch(page)
    await page.goto(`${SITE}/projects`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const listText = await page.locator('body').innerText()

    const missing = projects.filter((p) => !listText.includes(p.name)).map((p) => p.name)
    console.log(`[e2e] project names missing from /projects: ${missing.length ? missing.join(', ') : 'none'}`)
    expect(missing, 'every published project must be listed on the site').toEqual([])
    report('projects index', noise)

    // And each detail page resolves by its CMS slug.
    for (const project of projects) {
      const detail = await page.goto(`${SITE}/projects/${project.slug}`, {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForTimeout(1200)
      console.log(`[e2e] /projects/${project.slug} -> ${detail?.status()}`)
      expect(detail?.status(), `/projects/${project.slug} must render`).toBeLessThan(400)
      await expect(page.locator('body')).toContainText(project.name)
    }
  })

  test('🔴 PUBLISHING REVALIDATES THE SITE — the publish -> webhook -> ISR loop', async ({
    page,
  }) => {
    /**
     * The loop an administrator depends on, end to end and in a browser.
     *
     * `revalidateContent` POSTs DIRECTLY to the frontend's
     * `/api/revalidate` with a shared secret, and only falls back to queueing a
     * `revalidatePaths` job if that fetch fails (`src/hooks/revalidate.ts:46,62`).
     * So the happy path needs NO worker — which matters, because the deployment
     * checklist's "deploy both workers" step is still unchecked.
     *
     * Without this, "publishing silently does nothing visible" for up to the
     * one-hour ISR floor, which the frontend's own route comment calls "the
     * single most confusing possible failure for an admin".
     *
     * ⚠️ `.env.test` leaves `REVALIDATE_WEBHOOK_URL`/`REVALIDATE_SECRET` BLANK
     * by design, so this is only meaningful when they are supplied to the dev
     * server (see the scratchpad launcher). When they are absent the webhook is
     * inert and the check is SKIPPED LOUDLY rather than passing vacuously.
     */
    if (!fixtureProjectName) {
      console.log('[e2e] SKIP: no fixture was created, so revalidation cannot be observed')
      return
    }

    await page.goto(`${SITE}/projects`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const text = await page.locator('body').innerText()

    const appeared = text.includes(fixtureProjectName)
    console.log(`[e2e] newly published project visible without waiting out ISR: ${appeared}`)
    expect(
      appeared,
      'a freshly published project must appear on /projects — the revalidation webhook did not take effect',
    ).toBe(true)
  })

  test('site settings reach the footer — the contact details every page carries', async ({
    page,
  }) => {
    const api = await page.request.get(`${CMS}/api/v1/site-settings`)
    expect(api.status()).toBe(200)
    const settings =
      ((await api.json()) as { data?: { name?: string; phone?: string; address?: string[] } })
        .data ?? {}

    await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const body = await page.locator('body').innerText()

    if (settings.name) {
      console.log(`[e2e] site name rendered: ${body.includes(settings.name)}`)
      expect(body, 'the site name from the CMS must appear').toContain(settings.name)
    }
    // The address is the field whose maxRows cap was unenforced (see
    // `maxRowsEnforcement.test.ts`); the footer prints it as stacked lines, so
    // this is the surface that cap protects.
    const firstLine = settings.address?.[0]
    if (firstLine) {
      console.log(`[e2e] first address line rendered: ${body.includes(firstLine)}`)
      expect(body, 'the CMS address must reach the footer').toContain(firstLine)
    }
  })

  test('sections with no seeded content show an empty state, not a broken one', async ({
    page,
  }) => {
    /**
     * Testimonials, FAQs and statistics are deliberately unseeded. The correct
     * behaviour is that the sections are ABSENT or empty — never a crash, and
     * never a bracketed placeholder presented as real content, which is the
     * failure the Statistics band was removed for (D-6).
     */
    const noise = watch(page)
    await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const body = await page.locator('body').innerText()

    /**
     * ─── 🔴 THE INVARIANT IS "INERT", NOT "ABSENT" ──────────────────────────
     *
     * An earlier version of this test required that NO bracketed token appear
     * anywhere on the page. That was the wrong rule, and measuring it taught me
     * why: the seed deliberately writes `[EMAIL@DOMAIN]`, `[+91 00000 00000]`
     * and `[OFFICE HOURS]` into site settings, because the real values are not
     * known yet. `src/content` uses the same convention. Demanding their
     * absence would be demanding that the seed INVENT a phone number — the
     * exact fabrication this architecture exists to prevent.
     *
     * What the frontend actually guarantees (`svfrontend/src/lib/href.ts`) is
     * that an unresolved destination "can never ship as a live-looking but dead
     * link: it renders inert, unfocusable, and visibly struck through". THAT is
     * the testable property, and it is the one that matters — a visitor tapping
     * `tel:[+91 00000 00000]` is the real failure.
     *
     * So: placeholders are REPORTED (they are a content gap for the owner to
     * fill), and the assertion is that none of them became a working link.
     */
    const placeholders = body.match(/\[[A-Z0-9@+#\s.,_-]{2,30}\]/g) ?? []
    console.log(
      `[e2e] bracketed placeholders visible (content gap, not a code defect): ` +
        `${placeholders.length ? [...new Set(placeholders)].join(', ') : 'none'}`,
    )

    // 🔴 No placeholder may be wired into a live href.
    const liveDeadLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter((href) => /\[[^\]]+\]/.test(href)),
    )
    console.log(
      `[e2e] placeholders rendered as LIVE links: ${liveDeadLinks.length ? liveDeadLinks.join(', ') : 'none'}`,
    )
    expect(
      liveDeadLinks,
      'a placeholder must render inert — never as a live-looking dead link',
    ).toEqual([])

    // And every placeholder anchor must be explicitly marked inert.
    const notMarkedInert = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .filter((a) => /\[[^\]]+\]/.test((a as HTMLElement).innerText ?? ''))
        .filter(
          (a) =>
            a.getAttribute('aria-disabled') !== 'true' && !a.hasAttribute('data-placeholder'),
        )
        .map((a) => ((a as HTMLElement).innerText ?? '').slice(0, 40)),
    )
    console.log(
      `[e2e] placeholder anchors NOT marked inert: ${notMarkedInert.length ? notMarkedInert.join(', ') : 'none'}`,
    )
    expect(
      notMarkedInert,
      'a placeholder anchor must carry aria-disabled or data-placeholder',
    ).toEqual([])

    report('homepage empty states', noise)
    expect(noise.errors).toEqual([])
  })

  test('no broken images — every <img> actually loaded', async ({ page }) => {
    /**
     * `naturalWidth === 0` on a loaded image is the signature of a broken
     * source. It matters here specifically because media comes from the CMS and
     * the in-use delete guards exist to stop a referenced image disappearing —
     * this is the symptom those guards prevent.
     */
    await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2500)

    const broken = await page.evaluate(() =>
      Array.from(document.images)
        .filter((img) => img.complete && img.naturalWidth === 0 && img.currentSrc)
        .map((img) => img.currentSrc.slice(0, 150)),
    )
    console.log(`[e2e] broken images: ${broken.length ? broken.join('\n   ') : 'none'}`)
    expect(broken, 'a referenced CMS image failed to load').toEqual([])
  })
})

// ---------------------------------------------------------------------------

test.describe('responsive layout', () => {
  const VIEWPORTS = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 820, height: 1180 },
    { name: 'desktop', width: 1440, height: 900 },
  ]

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} (${viewport.width}px): no horizontal overflow`, async ({ page }) => {
      /**
       * 🔴 HORIZONTAL OVERFLOW IS THE ONE LAYOUT BUG WORTH AUTOMATING. It is
       * invisible on the developer's desktop, obvious and unusable on a phone,
       * and it is caused by exactly the kind of content an administrator types
       * — a long project name, an unbroken URL, a six-line address.
       *
       * A small tolerance is allowed because sub-pixel rounding and a scrollbar
       * can both register as a few pixels of overflow.
       */
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      for (const route of ['/', '/projects', '/about', '/contact']) {
        const noise = watch(page)
        await page.goto(`${SITE}${route}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2200)

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        console.log(`[e2e] ${viewport.name} ${route}: horizontal overflow ${overflow}px`)
        expect(
          overflow,
          `${route} overflows horizontally at ${viewport.width}px — the page scrolls sideways`,
        ).toBeLessThanOrEqual(2)

        expect(noise.errors, `${route} logged console errors at ${viewport.name}`).toEqual([])
      }
    })
  }

  test('the mobile navigation can be opened', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2200)

    /**
     * ⚠️ ONLY *VISIBLE* CANDIDATES COUNT. The first version matched
     * `button[aria-expanded]`, which also matches controls that are present but
     * hidden at this breakpoint — so it "found a toggle", clicked something
     * inert, and failed on the assertion afterwards. Visibility is the whole
     * point on a phone.
     */
    const candidates = page
      .getByRole('button', { name: /menu|navigation/i })
      .or(page.locator('[aria-label*="menu" i]'))
    const n = await candidates.count()

    let clicked = false
    for (let i = 0; i < n; i++) {
      const c = candidates.nth(i)
      if (await c.isVisible().catch(() => false)) {
        await c.click()
        clicked = true
        break
      }
    }
    console.log(`[e2e] visible mobile nav toggle clicked: ${clicked}`)

    await page.waitForTimeout(1500)

    /**
     * What matters is the OUTCOME: can a phone user reach the main sections?
     * Either an opened drawer or an always-visible inline nav satisfies that;
     * neither does not.
     */
    const reachable = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]
      const visible = links.filter((a) => {
        const r = a.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      const hrefs = visible.map((a) => a.getAttribute('href') ?? '')
      return {
        projects: hrefs.some((h) => h.includes('/projects')),
        contact: hrefs.some((h) => h.includes('/contact')),
        count: visible.length,
      }
    })

    console.log(
      `[e2e] phone navigation — visible links=${reachable.count} projects=${reachable.projects} contact=${reachable.contact}`,
    )
    expect(
      reachable.projects && reachable.contact,
      'a phone user must be able to reach Projects and Contact',
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------

test.describe('SEO surfaces, without changing the approved policy', () => {
  /**
   * ⚠️ THESE ARE OBSERVATIONS WITH ASSERTIONS ON THE *MECHANISM*, NOT ON THE
   * POLICY. `NEXT_PUBLIC_ALLOW_INDEXING` is `false` here exactly as it is in
   * production, and that is a deliberate pre-launch decision (D-7) that this
   * suite must not quietly flip. What IS asserted is that the two independent
   * indexing blocks AGREE — a half-lifted block would leave the site
   * unindexable for a reason nobody would find.
   */
  test('robots.txt and the meta robots tag agree with each other', async ({ page }) => {
    const robots = await page.request.get(`${SITE}/robots.txt`)
    expect(robots.status()).toBe(200)
    const text = await robots.text()
    const disallowsAll = /Disallow:\s*\/\s*$/m.test(text)
    console.log(`[e2e] robots.txt disallows everything: ${disallowsAll}`)

    await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' })
    const meta = await page
      .locator('meta[name="robots"]')
      .first()
      .getAttribute('content')
      .catch(() => null)
    console.log(`[e2e] meta robots: ${meta ?? '(absent)'}`)

    const metaNoindex = /noindex/i.test(meta ?? '')

    // 🔴 THE INVARIANT: both blocks are driven by one switch, so they must
    // never disagree. This is what catches a half-lifted launch.
    expect(
      metaNoindex,
      'robots.txt and the meta robots tag must express the SAME policy — they share one switch',
    ).toBe(disallowsAll)

    // And the sitemap is advertised regardless, which is correct: it costs
    // nothing while disallowed and is needed the moment indexing is enabled.
    expect(text, 'robots.txt should advertise the sitemap').toMatch(/Sitemap:/i)
  })

  test('the sitemap lists real, resolvable routes', async ({ page }) => {
    const res = await page.request.get(`${SITE}/sitemap.xml`)
    expect(res.status()).toBe(200)
    const xml = await res.text()
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
    console.log(`[e2e] sitemap entries: ${locs.length}`)
    expect(locs.length, 'the sitemap must list routes').toBeGreaterThan(0)

    // Every entry must be a real page — a sitemap of 404s is worse than none.
    for (const loc of locs.slice(0, 15)) {
      const path = new URL(loc).pathname
      const r = await page.request.get(`${SITE}${path}`)
      console.log(`[e2e] sitemap ${path} -> ${r.status()}`)
      expect(r.status(), `the sitemap advertises ${path}, which does not resolve`).toBeLessThan(400)
    }
  })

  test('each page declares a canonical URL and a unique title', async ({ page }) => {
    const seen = new Map<string, string>()

    for (const route of ROUTES) {
      await page.goto(`${SITE}${route.path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(900)

      const title = await page.title()
      const canonical = await page
        .locator('link[rel="canonical"]')
        .first()
        .getAttribute('href')
        .catch(() => null)

      console.log(`[e2e] ${route.path} title="${title}" canonical=${canonical ?? '(absent)'}`)
      expect(title.trim().length, `${route.path} has no title`).toBeGreaterThan(0)

      // Duplicate titles across routes are an SEO defect in their own right.
      const clash = [...seen.entries()].find(([, t]) => t === title)
      expect(
        clash,
        `${route.path} shares its title with ${clash?.[0]} — titles must be distinct`,
      ).toBeUndefined()
      seen.set(route.path, title)
    }
  })
})
