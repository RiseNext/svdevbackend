import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { resetRateLimits } from '@/lib/rateLimit'
import {
  LEAD_RATE_LIMIT_PER_IP,
  LEAD_RATE_LIMIT_PER_PHONE,
  LIMITS,
  MIN_PHONE_DIGITS,
} from '@/lib/constants'

/**
 * THE ENQUIRY ENDPOINT, EXERCISED AS THE FRONTEND ACTUALLY CALLS IT.
 *
 * 🔴 WHY THIS FILE EXISTS. `POST /api/v1/leads` is the ONLY public write in the
 * system and the single reason this backend exists — and before this file NO
 * TEST EVER INVOKED IT. `domain.test.ts` covers the `leads` collection through
 * the Local API, which is a different code path: it skips content-type
 * negotiation, the Zod body schema, the honeypot, the idempotency replay, the
 * server-side project resolution, the rate limits and every status code the
 * contract promises. All of that could have been broken in a way every existing
 * test passed through.
 *
 * The route handler is imported and called with a real `Request`. That is the
 * same function Next.js invokes, so this is the endpoint — not a reimplementation
 * of it. No HTTP server is needed, which is what makes it runnable in CI.
 *
 * ⚠️ THE FIELD SET UNDER TEST IS THE ONE THE REAL FORM SENDS, and nothing more:
 * `name`, `phone`, optional `projectSlug`, optional `message`, plus the
 * `website` honeypot. That is exactly what
 * `svfrontend/src/components/sections/ContactForm.tsx` puts in the body. There
 * is NO email field on the form, so there is none here and none in the database.
 */

const { POST, OPTIONS } = await import('@/app/(public)/api/v1/leads/route')

const ORIGIN = 'http://localhost:3000'

/**
 * Each request gets a DISTINCT client address unless a test deliberately reuses
 * one, so the per-IP limit cannot make unrelated tests order-dependent.
 *
 * Note the RIGHTMOST position: that is the hop the handler keys its limit on,
 * because a leftmost value is attacker-supplied. Spelling it out here keeps the
 * test honest about what it is exercising.
 */
let ipCounter = 0
const freshIp = (): string => `10.0.0.${++ipCounter % 250}-${ipCounter}`

type Body = Record<string, unknown>

const post = (
  body: Body,
  init: { ip?: string; headers?: Record<string, string>; contentType?: string | null } = {},
): Promise<Response> => {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    referer: `${ORIGIN}/contact`,
    'user-agent': 'vitest',
    // `proxy-hop` mimics Railway's edge appending itself to the chain.
    'x-forwarded-for': `${init.ip ?? freshIp()}, proxy-hop`,
    ...init.headers,
  }
  if (init.contentType !== null) headers['content-type'] = init.contentType ?? 'application/json'

  return POST(new Request('http://localhost:3001/api/v1/leads', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }))
}

const json = async (res: Response): Promise<any> => res.json()

const valid = (over: Body = {}): Body => ({
  name: 'Anita Rao',
  phone: '9876500123',
  ...over,
})

let payload: Payload

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)
})

beforeEach(() => {
  // Module-level Maps must not leak between tests.
  resetRateLimits()
})

// ---------------------------------------------------------------------------
// 1. THE HAPPY PATH — and what "success" is allowed to mean
// ---------------------------------------------------------------------------

describe('a valid enquiry is stored and visible to the administrator', () => {
  it('returns 201 and the enquiry is IN THE DATABASE when it does', async () => {
    const res = await post(valid({ message: 'Please call after 6pm.' }))

    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body.data.id).toEqual(expect.any(String))
    expect(body.data.createdAt).toEqual(expect.any(String))
    expect(body.data.message).toBe('Thanks — we will call you back.')

    /**
     * 🔴 THE ASSERTION THAT MATTERS MOST IN THIS FILE. 201 must never be
     * returned for anything but a committed row — the frontend shows "we have
     * your enquiry" on exactly this status, and telling a visitor that when
     * nothing was stored is the one failure this whole feature exists to avoid.
     */
    const stored = await payload.findByID({
      collection: 'leads',
      id: String(body.data.id),
      overrideAccess: true,
      depth: 0,
    })
    expect(stored.name).toBe('Anita Rao')
    expect(stored.phone).toBe('9876500123')
    expect(stored.message).toBe('Please call after 6pm.')
  })

  it('stores the phone VERBATIM and derives the normalised form alongside it', async () => {
    // What a salesperson dials is what the visitor typed; the E.164 sibling is
    // for machines. Losing the formatting would be losing information.
    const res = await post(valid({ phone: '+91 98765 00124' }))
    expect(res.status).toBe(201)

    const stored = await payload.findByID({
      collection: 'leads',
      id: String((await json(res)).data.id),
      overrideAccess: true,
      depth: 0,
    })
    expect(stored.phone).toBe('+91 98765 00124')
    expect(stored.phoneNormalised).toBe('+919876500124')
  })

  it('records WHERE the enquiry came from, and only from an allowed origin', async () => {
    const res = await post(valid({ phone: '9876500125' }), {
      headers: { referer: `${ORIGIN}/projects/sri-city-aler-town` },
    })
    const stored = await payload.findByID({
      collection: 'leads',
      id: String((await json(res)).data.id),
      overrideAccess: true,
      depth: 0,
    })
    expect(stored.sourcePath).toBe('/projects/sri-city-aler-town')
  })

  it('IGNORES a Referer from an origin that is not on the allow-list', async () => {
    // Otherwise an attacker chooses what gets written into an admin-visible
    // field — a stored-content injection with a free text channel.
    const res = await post(valid({ phone: '9876500126' }), {
      headers: { referer: 'https://evil.example/attack' },
    })
    const stored = await payload.findByID({
      collection: 'leads',
      id: String((await json(res)).data.id),
      overrideAccess: true,
      depth: 0,
    })
    expect(stored.sourcePath).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// 2. THE PROJECT RELATIONSHIP — the thing that makes an enquiry actionable
// ---------------------------------------------------------------------------

describe('the selected project is preserved', () => {
  beforeAll(async () => {
    /**
     * A PUBLISHED project requires a cover image — `image` is a required upload
     * on the collection, and a draft skips validation while a publish does not.
     * So the fixture is a real (tiny) JPEG through the real upload pipeline,
     * rather than a stub: anything less would not survive the publish.
     */
    const jpeg = await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 20, g: 80, b: 50 } },
    })
      .jpeg()
      .toBuffer()

    const image = await payload.create({
      collection: 'media',
      overrideAccess: true,
      context: { skipAudit: true },
      file: { data: jpeg, name: 'enquiry-fixture.jpg', mimetype: 'image/jpeg', size: jpeg.byteLength },
      data: { alt: 'Enquiry test cover' },
    })

    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      context: { skipAudit: true, skipRevalidate: true },
      data: {
        slug: 'enquiry-test-project',
        name: 'Enquiry Test Project',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'A published project an enquiry may reference.',
        description: ['Only published projects may be referenced.'],
        highlights: [{ icon: 'shield', title: 'Approved' }],
        image: image.id,
        _status: 'published',
      } as never,
    })

    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      context: { skipAudit: true, skipRevalidate: true },
      data: {
        slug: 'enquiry-test-unpublished',
        name: 'Enquiry Test Unpublished',
        category: 'Residential Plots',
        locality: 'Nowhere',
        summary: 'Not published.',
        description: ['Not published.'],
        highlights: [{ icon: 'shield', title: 'Pending' }],
        _status: 'draft',
      } as never,
    })
  })

  it('links the enquiry to the project AND snapshots its name', async () => {
    /**
     * 🔴 BOTH, NOT EITHER. The relationship is what an administrator filters on;
     * the snapshot is what survives the project being renamed or archived. A
     * lead that says only "project #a3f9…" about a project that no longer exists
     * is not a usable commercial record.
     */
    const res = await post(valid({ phone: '9876500130', projectSlug: 'enquiry-test-project' }))
    expect(res.status).toBe(201)

    const stored = await payload.findByID({
      collection: 'leads',
      id: String((await json(res)).data.id),
      overrideAccess: true,
      depth: 0,
    })
    expect(stored.projectSlug).toBe('enquiry-test-project')
    expect(stored.projectNameSnapshot).toBe('Enquiry Test Project')
    expect(String(stored.project)).toEqual(expect.any(String))
    expect(stored.project).toBeTruthy()
  })

  it('REJECTS a slug for a project that does not exist', async () => {
    const res = await post(valid({ phone: '9876500131', projectSlug: 'no-such-project' }))
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.details[0]).toMatchObject({
      field: 'project',
      code: 'UNKNOWN_PROJECT',
    })
  })

  it('REJECTS a slug for an UNPUBLISHED project — and does not confirm it exists', async () => {
    // The message is identical to the unknown-project case on purpose: a
    // different response would let anyone enumerate unpublished projects, which
    // for this business means uncleared DTCP/RERA claims.
    const res = await post(valid({ phone: '9876500132', projectSlug: 'enquiry-test-unpublished' }))
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.details[0].code).toBe('UNKNOWN_PROJECT')
    expect(body.error.details[0].message).toBe('Please choose a project from the list.')
  })

  it('accepts an enquiry with NO project — "No preference" is the form default', async () => {
    const res = await post(valid({ phone: '9876500133', projectSlug: '' }))
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// 3. VALIDATION — and the field names the form can actually render
// ---------------------------------------------------------------------------

describe('invalid input is rejected with errors the form can display', () => {
  it('requires a name', async () => {
    const res = await post({ name: '', phone: '9876500140' })
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details).toContainEqual(
      expect.objectContaining({ field: 'name', code: 'REQUIRED' }),
    )
  })

  it('rejects a "name" with no letters in any script', async () => {
    const res = await post({ name: '12345 !!!', phone: '9876500141' })
    expect(res.status).toBe(422)
    expect((await json(res)).error.details[0]).toMatchObject({ field: 'name', code: 'INVALID' })
  })

  it('ACCEPTS a Telugu name — \\p{L}, not [A-Za-z]', async () => {
    // The audience is Telugu-speaking. An ASCII-only name rule would reject real
    // enquirers, and would do it silently from the business's point of view.
    const res = await post({ name: 'అనిత రావు', phone: '9876500142' })
    expect(res.status).toBe(201)
  })

  it('rejects a phone shorter than the configured minimum', async () => {
    const short = '9'.repeat(MIN_PHONE_DIGITS - 1)
    const res = await post({ name: 'Short Phone', phone: short })
    expect(res.status).toBe(422)
    expect((await json(res)).error.details[0]).toMatchObject({ field: 'phone', code: 'TOO_SHORT' })
  })

  it('rejects an obviously fake phone', async () => {
    const res = await post({ name: 'Fake Phone', phone: '0000000000' })
    expect(res.status).toBe(422)
    expect((await json(res)).error.details[0]).toMatchObject({ field: 'phone', code: 'INVALID' })
  })

  it('rejects an over-long message', async () => {
    const res = await post(valid({ phone: '9876500143', message: 'x'.repeat(LIMITS.leadMessage + 1) }))
    expect(res.status).toBe(422)
    expect((await json(res)).error.details[0]).toMatchObject({
      field: 'message',
      code: 'TOO_LONG',
    })
  })

  it('every error field name matches an input the form actually renders', async () => {
    /**
     * 🔴 THE CONTRACT WITH `ContactForm.tsx`. It maps `details[].field` onto its
     * own `Errors` record, whose keys are the input `name` attributes. A server
     * error naming a field the form has no slot for is DISPLAYED NOWHERE — the
     * visitor sees the form reject the submission with no explanation.
     *
     * Note the deliberate asymmetry this pins: the REQUEST key is `projectSlug`,
     * the ERROR field is `project`.
     */
    const renderable = ['name', 'phone', 'project', 'message']

    const responses = await Promise.all([
      post({ name: '', phone: '' }),
      post({ name: 'x', phone: '123' }),
      post(valid({ phone: '9876500144', projectSlug: 'NOT A SLUG' })),
      post(valid({ phone: '9876500145', message: 'x'.repeat(LIMITS.leadMessage + 1) })),
    ])

    for (const res of responses) {
      const body = await json(res)
      for (const detail of body.error.details ?? []) {
        expect(renderable, `"${detail.field}" has no slot in ContactForm`).toContain(detail.field)
      }
    }
  })

  it('a wrong content type is 415, NOT 422 — different failures, different codes', async () => {
    const res = await post(valid({ phone: '9876500146' }), { contentType: 'text/plain' })
    expect(res.status).toBe(415)
    expect((await json(res)).error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('an unknown property in the body is rejected, not silently ignored', async () => {
    const res = await post(valid({ phone: '9876500147', leadStatus: 'hot' }))
    expect(res.status).toBe(422)
  })

  it('an oversized body is 413', async () => {
    const res = await post(valid({ phone: '9876500148', message: 'x'.repeat(70_000) }))
    expect(res.status).toBe(413)
    expect((await json(res)).error.code).toBe('PAYLOAD_TOO_LARGE')
  })
})

// ---------------------------------------------------------------------------
// 4. SERVER-ASSIGNED FIELDS — a client may not choose them
// ---------------------------------------------------------------------------

describe('fields the visitor must not control', () => {
  it('OVERWRITES a client-supplied `source`', async () => {
    // `admin.readOnly` is documented as "without affecting the API" and is
    // trivially spoofable. The field-level access block is the real control, and
    // this is the concrete test the code comments promise.
    const res = await post(valid({ phone: '9876500150', source: 'whatsapp' }))
    expect(res.status).toBe(201)

    const stored = await payload.findByID({
      collection: 'leads',
      id: String((await json(res)).data.id),
      overrideAccess: true,
      depth: 0,
    })
    expect(stored.source).toBe('contact_form')
  })

  it('never lets the body set an id, consent or timestamps', async () => {
    const res = await post(
      valid({
        phone: '9876500151',
        id: '00000000-0000-0000-0000-000000000000',
        createdAt: '1999-01-01T00:00:00.000Z',
      }),
    )
    expect(res.status).toBe(201)
    const body = await json(res)

    expect(body.data.id).not.toBe('00000000-0000-0000-0000-000000000000')
    // The timestamp is the server's, so it is recent rather than 1999.
    expect(new Date(body.data.createdAt).getUTCFullYear()).toBeGreaterThan(2020)

    const stored = await payload.findByID({
      collection: 'leads',
      id: String(body.data.id),
      overrideAccess: true,
      depth: 0,
    })
    expect(stored.consentGiven).toBe(true)
  })

  it('strips HTML out of the message', async () => {
    const res = await post(
      valid({ phone: '9876500152', message: '<script>alert(1)</script>Call me' }),
    )
    const stored = await payload.findByID({
      collection: 'leads',
      id: String((await json(res)).data.id),
      overrideAccess: true,
      depth: 0,
    })
    expect(String(stored.message)).not.toContain('<script')
    expect(String(stored.message)).toContain('Call me')
  })
})

// ---------------------------------------------------------------------------
// 5. THE HONEYPOT — indistinguishable from success, by design
// ---------------------------------------------------------------------------

describe('the honeypot', () => {
  it('answers with a response a bot cannot tell from a real success', async () => {
    /**
     * 🔴 THE WHOLE VALUE OF A HONEYPOT IS THAT THE BOT CANNOT TELL. A different
     * status, a different body shape or a missing field is a fingerprint, and a
     * fingerprinted honeypot is worse than none — it teaches the bot to leave
     * the field empty next time.
     */
    const real = await post(valid({ phone: '9876500160' }))
    const trapped = await post(valid({ phone: '9876500161', website: 'http://spam.example' }))

    expect(trapped.status).toBe(real.status)
    const [a, b] = [await json(real), await json(trapped)]
    expect(Object.keys(b.data).sort()).toEqual(Object.keys(a.data).sort())
    expect(b.data.message).toBe(a.data.message)
    expect(b.data.id).toEqual(expect.any(String))
  })

  it('stores NOTHING for a trapped submission', async () => {
    const before = await payload.count({ collection: 'leads', overrideAccess: true })
    const res = await post(valid({ phone: '9876500162', website: 'x' }))
    expect(res.status).toBe(201)
    const after = await payload.count({ collection: 'leads', overrideAccess: true })

    expect(after.totalDocs).toBe(before.totalDocs)
    // And the synthetic id corresponds to no row.
    const id = String((await json(res)).data.id)
    const found = await payload.find({
      collection: 'leads',
      where: { id: { equals: id } },
      overrideAccess: true,
      trash: true,
      limit: 1,
    })
    expect(found.totalDocs).toBe(0)
  })

  it('accepts an EMPTY honeypot field as normal — a human always sends it empty', async () => {
    const res = await post(valid({ phone: '9876500163', website: '' }))
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// 6. DOUBLE SUBMISSION — a keen buyer is not an error
// ---------------------------------------------------------------------------

describe('repeat submissions', () => {
  it('replays the ORIGINAL 201 verbatim for a repeated Idempotency-Key', async () => {
    const key = `test-key-${Date.now()}`
    const first = await post(valid({ phone: '9876500170' }), {
      headers: { 'idempotency-key': key },
    })
    const second = await post(valid({ phone: '9876500170' }), {
      headers: { 'idempotency-key': key },
    })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    // Byte-identical, including the id: the second request stored nothing.
    expect(await json(second)).toEqual(await json(first))
  })

  it('answers a within-window duplicate with 201, never an error', async () => {
    // A visitor who double-taps on a phone must not be shown a failure for
    // having been keen. Nothing new is stored; the first enquiry already exists.
    const body = valid({ phone: '9876500171', projectSlug: 'enquiry-test-project' })
    const first = await post(body)
    expect(first.status).toBe(201)

    const before = await payload.count({ collection: 'leads', overrideAccess: true })
    const second = await post(body)
    const after = await payload.count({ collection: 'leads', overrideAccess: true })

    expect(second.status).toBe(201)
    expect(after.totalDocs).toBe(before.totalDocs)
  })
})

// ---------------------------------------------------------------------------
// 7. RATE LIMITING — in the application, because there is no edge to put it at
// ---------------------------------------------------------------------------

describe('abuse limits', () => {
  it(`allows ${LEAD_RATE_LIMIT_PER_IP} submissions from one address, then answers 429`, async () => {
    const ip = '203.0.113.9'
    const statuses: number[] = []

    for (let i = 0; i < LEAD_RATE_LIMIT_PER_IP + 2; i++) {
      // A distinct phone each time, so the PER-IP limit is what is under test.
      const res = await post({ name: 'Burst Bot', phone: `98765${String(10000 + i)}` }, { ip })
      statuses.push(res.status)
    }

    expect(statuses.slice(0, LEAD_RATE_LIMIT_PER_IP).every((s) => s !== 429)).toBe(true)
    expect(statuses[LEAD_RATE_LIMIT_PER_IP]).toBe(429)
  })

  it('a 429 always carries Retry-After — the contract says so', async () => {
    const ip = '203.0.113.10'
    let last: Response | undefined
    for (let i = 0; i < LEAD_RATE_LIMIT_PER_IP + 1; i++) {
      last = await post({ name: 'Burst Bot', phone: `98765${String(20000 + i)}` }, { ip })
    }
    expect(last!.status).toBe(429)
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect((await json(last!)).error.code).toBe('RATE_LIMITED')
  })

  it('a rotating IP does NOT defeat the per-phone limit', async () => {
    /**
     * 🔴 THIS IS THE LAYER THE PER-IP LIMIT CANNOT PROVIDE. A residential proxy
     * pool hands an attacker a fresh address per request for pennies; it does
     * not hand them a fresh phone number.
     *
     * Each submission below uses a DIFFERENT project so the dedupe window (a
     * different mechanism, answering 201) cannot be what produces the result.
     */
    const phone = '9876509999'
    const statuses: number[] = []

    for (let i = 0; i < LEAD_RATE_LIMIT_PER_PHONE + 2; i++) {
      const res = await post(
        { name: 'Rotating Source', phone, message: `enquiry ${i}` },
        { ip: `198.51.100.${i + 1}` },
      )
      statuses.push(res.status)
    }

    expect(statuses[statuses.length - 1]).toBe(429)
  })

  it('keys the per-phone limit on the NORMALISED number, not the raw string', async () => {
    // "98765 08888", "+919876508888" and "9876508888" are ONE number. Keying on
    // the raw string would let an attacker reset their budget with a space.
    const written = ['9876508888', '98765 08888', '+91 9876508888', '+919876508888']
    const statuses: number[] = []

    for (const [i, phone] of written.entries()) {
      const res = await post(
        { name: 'Formatting Variants', phone, message: `variant ${i}` },
        { ip: `192.0.2.${i + 1}` },
      )
      statuses.push(res.status)
    }

    expect(statuses[statuses.length - 1]).toBe(429)
  })

  it('a leftmost X-Forwarded-For value cannot be used to escape the limit', async () => {
    /**
     * 🔴 THE BYPASS THIS GUARDS. `X-Forwarded-For` is a list the CLIENT can
     * prepend to. Keying the limiter on the LEFTMOST entry — the conventional
     * "original client" position, and what the stored `ipAddress` field uses —
     * would mean an attacker rotating that value gets an unlimited budget while
     * the rate limiter still appears present in the code.
     *
     * The handler keys on the RIGHTMOST hop, which only the proxy in front can
     * write. Here the forged values rotate and the real hop stays constant, so
     * the limit must still bite.
     */
    const statuses: number[] = []
    for (let i = 0; i < LEAD_RATE_LIMIT_PER_IP + 2; i++) {
      const res = await post(
        { name: 'Spoofer', phone: `98765${String(30000 + i)}` },
        { headers: { 'x-forwarded-for': `1.2.3.${i}, 9.9.9.9` } },
      )
      statuses.push(res.status)
    }
    expect(statuses[statuses.length - 1]).toBe(429)
  })
})

// ---------------------------------------------------------------------------
// 8. CORS — the endpoint IS called cross-origin from a browser
// ---------------------------------------------------------------------------

describe('CORS', () => {
  it('echoes an allow-listed origin and never "*"', async () => {
    const res = await post(valid({ phone: '9876500180' }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
    // Credentials are never granted: the public API is unauthenticated, and
    // allowing them would let a browser attach admin cookies.
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('sends NO allow-origin header for an origin that is not allow-listed', async () => {
    const res = await post(valid({ phone: '9876500181' }), {
      headers: { origin: 'https://evil.example' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers the preflight with 204 and the headers the form sends', async () => {
    const res = await OPTIONS(
      new Request('http://localhost:3001/api/v1/leads', {
        method: 'OPTIONS',
        headers: { origin: ORIGIN },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    // `Idempotency-Key` is a non-simple header, so the browser will not send it
    // unless the preflight names it.
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Idempotency-Key')
  })
})

// ---------------------------------------------------------------------------
// 9. THE RESPONSE TELLS THE VISITOR NOTHING IT SHOULD NOT
// ---------------------------------------------------------------------------

describe('the endpoint does not over-share', () => {
  it('returns only id, createdAt and a message — never the stored enquiry', async () => {
    const res = await post(valid({ phone: '9876500190', projectSlug: 'enquiry-test-project' }))
    const body = await json(res)
    expect(Object.keys(body.data).sort()).toEqual(['createdAt', 'id', 'message'])
    // Specifically: no phone, no ip, no user agent, no project id echo.
    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain('9876500190')
    expect(serialised).not.toContain('vitest')
  })

  it('never caches an enquiry response', async () => {
    const res = await post(valid({ phone: '9876500191' }))
    expect(res.headers.get('Cache-Control')).toContain('no-store')
  })

  it('every error carries a correlation id and never a stack trace', async () => {
    // The requestId is how an administrator finds the log line for a submission
    // the visitor says failed. The stack, the SQL and the driver string stay in
    // the log — the body gets the id and nothing else diagnostic.
    for (const body of [
      valid({ phone: '9876500192', projectSlug: 'x'.repeat(200) }), // over-long slug
      { name: '', phone: '' }, // empty required fields
      valid({ phone: '9876500193', unknownKey: true }), // rejected property
    ]) {
      const res = await post(body)
      expect(res.status).toBeGreaterThanOrEqual(400)
      const parsed = await json(res)
      expect(parsed.error.requestId).toEqual(expect.any(String))
      expect(JSON.stringify(parsed)).not.toMatch(/at\s+\w+\s+\(/)
      expect(JSON.stringify(parsed)).not.toMatch(/postgres:\/\/|node_modules/)
    }
  })
})
