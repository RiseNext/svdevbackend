import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload, SanitizedConfig } from 'payload'

import config from '@payload-config'
import { getTestPayload } from '../setup'

/**
 * WHO CAN READ WHAT, WITHOUT LOGGING IN.
 *
 * 🔴 THE QUESTION THIS FILE ANSWERS: `/payload-api/*` is Payload's OWN generated
 * REST surface. The previous production report flagged it as a risk and proposed
 * a "REST kill switch" to close it. That proposal was investigated and REJECTED
 * on evidence, and this file is the evidence.
 *
 * Three findings decided it:
 *
 *   1. A KILL SWITCH WOULD BREAK THE ADMIN PANEL. The Payload admin UI is a
 *      client-side application that talks to `routes.api` — the very prefix a
 *      switch would disable. "Turn off /payload-api" and "turn off the CMS" are
 *      the same sentence. Any switch would need an authenticated carve-out,
 *      which is precisely what the access functions already are.
 *
 *   2. THE PRIVATE COLLECTIONS ARE ALREADY CLOSED, in the application, by
 *      `access.read`. Not by an edge rule, not by obscurity. Asserted below.
 *
 *   3. THE READABLE ONES ARE READABLE ON PURPOSE. `projects`, `testimonials`,
 *      `faqs` and `statistics` return only PUBLISHED rows to an anonymous
 *      caller, because `publishedOrAuthenticated` returns a `Where` constraint
 *      that Payload ANDs into the query. `media` and `site-settings` are public
 *      because the public website renders them on every page. The exposure is a
 *      SECOND SHAPE of already-public content — not a data leak — and paying for
 *      a kill switch to hide it would buy nothing.
 *
 * ⚠️ WHAT THIS REPLACED. The `leads` collection comment used to list a fourth
 * guarantee: "the edge blocks /payload-api/leads from the public internet." The
 * real deployment is Railway, which terminates TLS and routes straight to the
 * container — there is no proxy in which to write that rule, so the guarantee
 * was never true of production. It was removed rather than left as a comforting
 * comment, and the remaining three are tested here so they cannot quietly rot.
 */

const resolved = (await config) as SanitizedConfig

let payload: Payload

beforeAll(async () => {
  payload = await getTestPayload()
})

// ---------------------------------------------------------------------------
// 1. PRIVATE DATA IS CLOSED TO AN ANONYMOUS CALLER
// ---------------------------------------------------------------------------

/**
 * `overrideAccess: false` with no `user` is exactly the state Payload's REST
 * handler is in when an unauthenticated request arrives — the REST route is a
 * thin wrapper over these same operations. Testing here rather than over HTTP
 * means no server has to be running in CI, and it exercises the control itself
 * rather than a transport in front of it.
 */
const anonymousRead = (collection: 'leads' | 'users' | 'audit-log' | 'payload-jobs') =>
  payload.find({ collection, overrideAccess: false, user: undefined, limit: 100, depth: 0 })

describe('anonymous callers cannot read private collections', () => {
  beforeAll(async () => {
    // A canary in every private collection, so "returns nothing" cannot be
    // trivially true because the table is empty.
    //
    // ⚠️ THE SUITE MUST SURVIVE BEING RUN TWICE IN TEN MINUTES, and before this
    // guard it did not. The canary phone is a FIXED number with no
    // `projectSlug`, which is exactly the shape `leadDedupe` collapses: a second
    // `npm test` inside LEAD_DEDUPE_WINDOW_MS made this hook throw
    // `DUPLICATE_LEAD` and took the WHOLE FILE down as a failed suite — fifteen
    // tests reported broken by a fixture, on unchanged code. A re-run is the
    // first thing anyone does after a red CI job, so the failure landed exactly
    // when the suite most needed to be trustworthy.
    //
    // A canary left behind by the previous run satisfies the precondition
    // identically — the requirement is that a row EXISTS, not that this
    // particular call created it. So a duplicate is success, not an error.
    // Anything else still throws.
    try {
      await payload.create({
        collection: 'leads',
        overrideAccess: true,
        context: { skipAudit: true },
        data: {
          name: 'ACCESS CANARY',
          phone: '9876512345',
          message: 'CANARY-MESSAGE-DO-NOT-LEAK',
          source: 'contact_form',
          consentGiven: true,
        },
      })
    } catch (error) {
      if (!String((error as { message?: string })?.message ?? '').includes('DUPLICATE_LEAD')) {
        throw error
      }
    }

    // Whichever path got us here, the canary must actually be present — a
    // swallowed error that left the table empty would make every assertion
    // below pass for the wrong reason.
    const canaries = await payload.find({
      collection: 'leads',
      overrideAccess: true,
      depth: 0,
      limit: 1,
      where: { name: { equals: 'ACCESS CANARY' } },
    })
    expect(canaries.totalDocs).toBeGreaterThan(0)
  })

  it('leads — the enquiry table — returns NOTHING', async () => {
    // 🔴 The single most important assertion in this file. These rows are the
    // name and phone number of every person who has contacted the business.
    const found = await anonymousRead('leads').catch(() => ({ totalDocs: 0, docs: [] }))
    expect(found.totalDocs).toBe(0)
    expect(JSON.stringify(found.docs)).not.toContain('CANARY')
  })

  it('users — administrator accounts — returns NOTHING', async () => {
    const found = await anonymousRead('users').catch(() => ({ totalDocs: 0 }))
    expect(found.totalDocs).toBe(0)
  })

  it('audit-log returns NOTHING', async () => {
    const found = await anonymousRead('audit-log').catch(() => ({ totalDocs: 0 }))
    expect(found.totalDocs).toBe(0)
  })

  it('payload-jobs returns NOTHING', async () => {
    // Job rows carry task inputs. Nothing enquiry-shaped goes through the queue
    // any more, but the collection is still admin-only and must stay that way.
    const found = await anonymousRead('payload-jobs').catch(() => ({ totalDocs: 0 }))
    expect(found.totalDocs).toBe(0)
  })

  it('leads cannot be CREATED through the generated REST surface', async () => {
    /**
     * `leads.access.create` is `() => false` precisely so that Payload's own
     * route cannot write one. The hand-written endpoint is the only writer, and
     * it is the only place `overrideAccess: true` is used on a request path —
     * which is what makes the honeypot, the validation and the rate limits
     * unavoidable rather than optional.
     */
    await expect(
      payload.create({
        collection: 'leads',
        overrideAccess: false,
        user: undefined,
        data: { name: 'Bypass', phone: '9876512346', source: 'contact_form', consentGiven: true },
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 2. PUBLIC COLLECTIONS EXPOSE ONLY WHAT IS PUBLISHED
// ---------------------------------------------------------------------------

describe('anonymous callers see published content only', () => {
  it('every content collection constrains an anonymous read to _status: published', () => {
    /**
     * Asserted on the ACCESS FUNCTION rather than on query results, because this
     * is the property that must hold for EVERY query shape — including ones no
     * test thought to write, such as `?where[_status][equals]=draft`. A returned
     * `Where` is ANDed in by Payload, so a caller cannot widen it.
     */
    for (const slug of ['projects', 'testimonials', 'faqs', 'statistics']) {
      const collection = resolved.collections.find((c) => c.slug === slug)!
      const result = collection.access!.read!({ req: { user: null } } as never)
      expect(typeof result, `${slug}.access.read must return a constraint, not a boolean`).toBe(
        'object',
      )
      expect(JSON.stringify(result)).toContain('published')
    }
  })

  it('an authenticated administrator is NOT constrained — they must see drafts', () => {
    const projects = resolved.collections.find((c) => c.slug === 'projects')!
    const asAdmin = projects.access!.read!({
      req: { user: { collection: 'users', role: 'admin', isActive: true } },
    } as never)
    expect(asAdmin).toBe(true)
  })

  it('site-settings is the ONLY global an anonymous caller may read', () => {
    // The public site needs contact details on every page. This failure is
    // INVISIBLE to a logged-in developer — forget it and the site 403s while the
    // admin panel looks perfect.
    const settings = resolved.globals.find((g) => g.slug === 'site-settings')!
    expect(settings.access!.read!({ req: { user: null } } as never)).toBe(true)
    expect(settings.access!.update!({ req: { user: null } } as never)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. THE REST SURFACE ITSELF
// ---------------------------------------------------------------------------

describe('the generated REST surface is shaped so a kill switch is unnecessary', () => {
  it('is mounted OFF /api, so it cannot collide with the public contract', () => {
    // Six of the public contract's paths are also collection slugs. At the
    // default `/api`, Payload's raw document shape would sit at the same URL as
    // the hand-written contract — and the raw shape is the one with the
    // internal fields in it.
    expect(resolved.routes?.api).toBe('/payload-api')
  })

  it('GraphQL is disabled, so there is no SECOND surface to secure', () => {
    // A kill switch on REST that left GraphQL up would be theatre.
    expect(resolved.graphQL?.disable).toBe(true)
  })

  it('EVERY collection declares read access explicitly', () => {
    /**
     * 🔴 THE REASON A KILL SWITCH LOOKS TEMPTING AND IS NOT NEEDED. Payload's
     * DEFAULT access is `Boolean(user)` — any authenticated user, full CRUD.
     * Relying on the default is what would make the REST surface dangerous. This
     * enumerates the collections and fails on any missing key, which makes the
     * guarantee mechanical instead of remembered.
     */
    for (const collection of resolved.collections) {
      if (collection.slug.startsWith('payload-')) continue
      expect(typeof collection.access?.read, `${collection.slug}.access.read`).toBe('function')
    }
  })

  it('no collection is readable by an anonymous caller except by explicit decision', () => {
    /**
     * The closed list. If a new collection appears and is anonymously readable,
     * this fails and somebody has to justify it in a diff — which is the point.
     *
     * `media` and `documents` are on it deliberately: an upload relationship
     * must be populatable anonymously or every project card renders without its
     * image. Their sensitive columns (`uploadedBy`, `originalFilename`) are
     * closed at FIELD level instead, which `domain.test.ts` asserts.
     *
     * `videos` joins them for EXACTLY the same reason, and the justification is
     * measured rather than assumed: with `read: isAdmin`, a public read
     * (`overrideAccess: false`, `user: undefined`) silently degrades
     * `site-settings.video` to a bare id string — Payload neither throws nor
     * warns — the serialiser's both-or-neither rule omits the key, and the
     * website simply never shows the video. It carries the same field-level
     * closure as the other two (`uploadedBy`, `originalFilename`,
     * `supersededFilenames` are admin-read-only), and the file itself is public
     * by construction: it is served from a CDN under a UUID key.
     */
    const intentionallyPublic = [
      'projects',
      'testimonials',
      'faqs',
      'statistics',
      'media',
      'documents',
      'videos',
    ]

    for (const collection of resolved.collections) {
      if (collection.slug.startsWith('payload-')) continue
      const result = collection.access!.read!({ req: { user: null } } as never)
      if (result === true) {
        expect(
          intentionallyPublic,
          `${collection.slug} is fully readable by anyone — was that intended?`,
        ).toContain(collection.slug)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 4. NO EMAIL ADAPTER, AND NOTHING DEPENDS ON ONE
// ---------------------------------------------------------------------------

describe('the configuration carries no email dependency', () => {
  it('declares no SMTP-backed email adapter', () => {
    /**
     * 🔴 WHY THIS IS AN ASSERTION AND NOT A COMMENT. The previous configuration
     * called `nodemailerAdapter()` with no arguments whenever SMTP was unset,
     * and that adapter PROVISIONS AN ETHEREAL.EMAIL TEST ACCOUNT OVER THE
     * NETWORK AT BOOT — on every `payload migrate`, every worker start and every
     * test run. Boot depended on a third-party service unrelated to this
     * product. Payload's own `consoleEmailAdapter` fallback does not.
     *
     * If someone reintroduces an adapter, this fails and they have to decide
     * deliberately rather than by copying a template.
     */
    const adapter = resolved.email as { name?: string } | undefined
    expect(adapter?.name === 'nodemailer').toBe(false)
  })

  it('the environment schema declares no SMTP or email variables', async () => {
    // A leftover variable is how a removed dependency creeps back: someone sets
    // it in the platform console, nothing reads it, and the next person assumes
    // mail works.
    const { ENV_KEYS } = await import('@/schemas/env')
    const emailish = ENV_KEYS.filter((k) => /SMTP|EMAIL|MAIL/i.test(k))
    expect(emailish).toEqual([])
  })

  it('production requires no secret that only a notification system would need', async () => {
    /**
     * Pins the production-required set so it cannot grow by habit. Every key here
     * breaks a USER-VISIBLE feature when absent:
     *   · CLOUDINARY_*     — uploads land on container disk and die on redeploy
     *   · REVALIDATE_*     — publishing appears to work; the site never updates
     *
     * `PRIVACY_POLICY_URL` is deliberately NOT here. It gated the enquiry
     * endpoint with a 503 while being rendered nowhere and served to nobody; the
     * privacy link a visitor follows is CMS content (`site-settings.legalLinks`).
     * `CRON_SECRET` is deliberately not here either: `jobs.access.run` fails
     * CLOSED without it, so absence is the SAFER state.
     */
    const { envSchema } = await import('@/schemas/env')

    const base = {
      NODE_ENV: 'production',
      PAYLOAD_SECRET: 'x'.repeat(40),
      NEXT_PUBLIC_SERVER_URL: 'https://cms.example.invalid',
      CORS_ORIGINS: 'https://www.example.invalid',
      CSRF_ORIGINS: 'https://cms.example.invalid',
      DATABASE_URL: 'postgres://u:p@h:5432/d',
      DATABASE_SSL: 'true',
      CLOUDINARY_CLOUD_NAME: 'c',
      CLOUDINARY_API_KEY: 'k',
      CLOUDINARY_API_SECRET: 's',
      REVALIDATE_WEBHOOK_URL: 'https://www.example.invalid/api/revalidate',
      REVALIDATE_SECRET: 'r'.repeat(20),
    }

    // Exactly this set boots in production — no mail credentials, no privacy URL.
    expect(envSchema.safeParse(base).success).toBe(true)

    // And each of the five genuinely-required keys still fails the boot when
    // removed, so this is a pinned contract rather than a weakened one.
    for (const key of [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
      'REVALIDATE_WEBHOOK_URL',
      'REVALIDATE_SECRET',
    ]) {
      const without: Record<string, unknown> = { ...base }
      delete without[key]
      expect(envSchema.safeParse(without).success, `${key} must be required in production`).toBe(
        false,
      )
    }
  })
})
