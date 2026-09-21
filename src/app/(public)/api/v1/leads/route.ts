import { randomUUID } from 'node:crypto'

import configPromise from '@payload-config'
import { getPayload } from 'payload'

import {
  assertJsonContentType,
  definePreflight,
  definePublicEndpoint,
  readJsonBody,
} from '@/lib/definePublicEndpoint'
import { rateLimited, validationError } from '@/lib/errors'
import { env } from '@/lib/env'
import {
  HONEYPOT_FIELD,
  IDEMPOTENCY_TTL_MS,
  LEAD_RATE_LIMIT_IP_WINDOW_MS,
  LEAD_RATE_LIMIT_PER_IP,
  LEAD_RATE_LIMIT_PER_PHONE,
  LEAD_RATE_LIMIT_PHONE_WINDOW_MS,
} from '@/lib/constants'
import { toE164 } from '@/hooks/leadHooks'
import { consumeRateLimit } from '@/lib/rateLimit'
import { honeypotTriggered, leadBodySchema, validateLeadBody } from '@/schemas/lead'

/**
 * `POST /api/v1/leads` — THE ONLY PUBLIC WRITE IN THE SYSTEM, and the only
 * runtime call a visitor's browser makes to the backend.
 *
 * PRD §1 problem 2: "Every enquiry typed into that form today is lost."
 * `ContactForm.tsx` does not fake a success — it tells the visitor nothing was
 * sent. This endpoint exists to keep that honesty while making the outcome true,
 * which is why SUCCESS IS ONLY EVER RETURNED FOR A REAL WRITE.
 *
 * 🔴 201 MEANS THE ROW IS COMMITTED. Nothing is queued, nothing is emailed and
 * nothing is deferred to a worker: `payload.create()` returns after the insert,
 * and the administrator reads that exact row in Admin → Enquiries. There is no
 * gap between "the visitor was told we will call back" and "the business can
 * see the enquiry".
 */

/**
 * `Idempotency-Key` replay cache. 24h TTL — long enough to cover a mobile
 * double-submit, bounded so it cannot grow without limit.
 *
 * ⚠️ IN-PROCESS AND THEREFORE PER-INSTANCE. With one CMS replica (which is the
 * documented and correct deployment for this workload) that is exact. If a
 * second replica is ever added, this must move to Postgres or Redis — recorded
 * in the runbook rather than left as a silent assumption.
 */
const idempotencyCache = new Map<string, { at: number; body: unknown }>()

const pruneIdempotency = () => {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS
  for (const [key, entry] of idempotencyCache) {
    if (entry.at < cutoff) idempotencyCache.delete(key)
  }
}

/** `Referer` -> a same-origin, path-only, truncated value. Never trusted as free text. */
const deriveSourcePath = (req: Request): string | null => {
  const referer = req.headers.get('referer')
  if (!referer) return null
  try {
    const url = new URL(referer)
    const allowed = env.CORS_ORIGINS.some((o) => {
      try {
        return new URL(o).origin === url.origin
      } catch {
        return false
      }
    })
    if (!allowed) return null
    return `${url.pathname}${url.search}`.slice(0, 500)
  } catch {
    return null
  }
}

/**
 * The CLAIMED client address, for the stored record. Leftmost `X-Forwarded-For`
 * entry — the conventional "original client" position.
 *
 * ⚠️ CLIENT-INFLUENCED AND STORED AS SUCH. A visitor may send their own
 * `X-Forwarded-For`, and a well-behaved proxy appends rather than replaces, so
 * the leftmost value is a CLAIM. That is acceptable for a field whose only use
 * is a human glancing at where an enquiry came from, and it is purged after 90
 * days regardless. It is NOT acceptable as a rate-limit key — see below.
 */
const clientIp = (req: Request): string | null => {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim().slice(0, 100)
  return req.headers.get('x-real-ip')?.slice(0, 100) ?? null
}

/**
 * 🔴 THE RATE-LIMIT KEY, AND IT IS DELIBERATELY NOT `clientIp()`.
 *
 * Rate limiting on the LEFTMOST `X-Forwarded-For` entry is not rate limiting at
 * all: the attacker supplies that value, so rotating it gives an unlimited
 * budget and the whole control evaporates silently while still looking present
 * in the code.
 *
 * The RIGHTMOST entry is the one appended by the proxy directly in front of this
 * container — on Railway, its edge. A client cannot forge a value into that
 * position, because anything it sends is pushed left by the appended hop.
 *
 * ⚠️ THE ASSUMPTION THIS RESTS ON, STATED RATHER THAN BURIED: exactly ONE
 * trusted hop in front of the app. That is true of Railway and of the
 * docker-compose shape in this repository. If a CDN is ever put in front, the
 * rightmost entry becomes the CDN's egress IP — every visitor would then share
 * one bucket and legitimate traffic would be throttled. Revisit here, not at the
 * call site.
 */
const rateLimitKey = (req: Request): string => {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const hops = fwd.split(',').map((h) => h.trim()).filter(Boolean)
    const nearest = hops[hops.length - 1]
    if (nearest) return `ip:${nearest.slice(0, 100)}`
  }
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return `ip:${real.slice(0, 100)}`
  // No proxy headers at all — direct connection, or a test. One shared bucket is
  // the correct fallback: it is restrictive, not permissive.
  return 'ip:unknown'
}

const successBody = (id: string, createdAt: string) => ({
  id,
  createdAt,
  message: 'Thanks — we will call you back.',
})

const handler = async (req: Request) => {
  /**
   * 🔴 THE PER-IP LIMIT, FIRST, BEFORE ANY PARSING OR ANY DATABASE WORK.
   *
   * ⚠️ WHAT THIS REPLACED, AND WHY THAT IS AN IMPROVEMENT RATHER THAN A
   * RELAXATION. This position previously held a compliance gate that made the
   * endpoint answer 503 in production unless a `PRIVACY_POLICY_URL` environment
   * variable was set. That variable was never rendered, never served to the
   * frontend and never linked from anything a visitor could see — setting it
   * proved nothing about whether a policy existed, and leaving it unset switched
   * off the only feature this website is for. The privacy link a visitor
   * actually follows is CMS content (`site-settings.legalLinks`, rendered by the
   * frontend Footer); it is a launch checklist item for the owner, not a boot
   * guard, and it now lives in DEPLOYMENT-CHECKLIST.md.
   *
   * What sits here instead is a control that does real work on every request.
   */
  const ipLimit = consumeRateLimit(
    rateLimitKey(req),
    LEAD_RATE_LIMIT_PER_IP,
    LEAD_RATE_LIMIT_IP_WINDOW_MS,
  )
  if (!ipLimit.allowed) throw rateLimited(ipLimit.retryAfterSeconds)

  // 415 for the wrong content type; 400/413 for a body that cannot be read.
  // These are DIFFERENT failures with different codes, deliberately.
  assertJsonContentType(req)
  const raw = await readJsonBody(req)

  const parsed = leadBodySchema.safeParse(raw)
  if (!parsed.success) {
    // An unknown property, or a wrong primitive type.
    throw validationError(
      parsed.error.issues.slice(0, 10).map((issue) => ({
        field: String(issue.path[0] ?? 'body'),
        code: 'INVALID' as const,
        message: 'That value is not accepted.',
      })),
    )
  }
  const body = parsed.data

  /**
   * 🔴 THE HONEYPOT RESPONSE IS INDISTINGUISHABLE FROM SUCCESS.
   *
   * `VALIDATION-RULES.md` §2 says "accept with 200 and silently discard";
   * `API-CONTRACT.md` §2.5.7 documents exactly one success shape, 201.
   * A 200 with a different or absent body is AN OBSERVABLE DIFFERENCE A SPAM BOT
   * CAN USE TO FINGERPRINT THE HONEYPOT — which defeats the entire mechanism,
   * because the value of a honeypot is that the bot cannot tell.
   *
   * So: 201, a well-formed body, a synthetic id corresponding to no stored row,
   * a real timestamp, the same message string. Nothing is persisted, nothing is
   * queued.
   *
   * ✅ THE FRONTEND NOW RENDERS THE FIELD. `ContactForm.tsx` submits a
   * `website` input — off-screen rather than `display:none`, `tabIndex={-1}`,
   * `autoComplete="off"` — and the name matches `HONEYPOT_FIELD` exactly, which
   * is why that constant is shared rather than spelled twice.
   *
   * ⚠️ REMAINING SCOPE NOTE: a honeypot stops naive form-fillers, not a bot that
   * reads the DOM. THE RATE LIMITS ABOVE AND BELOW ARE WHAT BOUND THAT BOT —
   * they are now in this application rather than deferred to an edge proxy the
   * real deployment does not have. A honeypot hit still consumes the per-IP
   * budget, because the IP limit is charged before this point.
   */
  if (honeypotTriggered(body)) {
    return successBody(randomUUID(), new Date().toISOString())
  }

  const fieldErrors = validateLeadBody(body)
  if (fieldErrors.length > 0) {
    /**
     * OPERATIONAL SAFETY NET (D-114): log the rejection WITHOUT storing it as a
     * lead, so that if MIN_PHONE_DIGITS is ever wrong, the affected enquirers can
     * be identified rather than lost silently. This is the only signal that would
     * ever reveal a mis-set threshold.
     */
    const payload = await getPayload({ config: configPromise })
    payload.logger.warn(
      { fields: fieldErrors.map((e) => `${e.field}:${e.code}`), sourcePath: deriveSourcePath(req) },
      'lead submission rejected by validation — no lead stored',
    )
    throw validationError(fieldErrors)
  }

  // ---- Idempotency replay -------------------------------------------------
  const idempotencyKey = req.headers.get('idempotency-key')?.slice(0, 200) ?? null
  if (idempotencyKey) {
    pruneIdempotency()
    const replay = idempotencyCache.get(idempotencyKey)
    // Replay the ORIGINAL 201 verbatim.
    if (replay) return replay.body
  }

  /**
   * ---- THE PER-PHONE LIMIT ------------------------------------------------
   *
   * 🔴 DELIBERATELY AFTER THE IDEMPOTENCY REPLAY. A replayed request is the SAME
   * submission arriving twice on a flaky mobile connection; charging it a second
   * time against the phone's budget would punish bad signal.
   *
   * It is keyed on the E.164 NORMALISED number, not the raw string, so
   * "98765 00011", "+919876500011" and "9876500011" are one bucket rather than
   * three. That normalisation is the same function the collection hook uses, so
   * the limiter and the dedupe agree on what "the same number" means.
   *
   * 🔴 THIS IS THE LAYER THE PER-IP LIMIT CANNOT PROVIDE. A residential proxy
   * pool gives an attacker a fresh IP per request for pennies; it does not give
   * them a fresh phone number. It is also the limit the RUNBOOK always said had
   * to live here — "the edge cannot see the request body".
   *
   * ⚠️ IT IS NOT THE DEDUPE, and the two are not redundant. The dedupe collapses
   * a repeat of the SAME (phone, project) pair inside 10 minutes and answers 201
   * because that is a keen buyer. This bounds a number being used to generate
   * MANY DIFFERENT enquiries across many projects, and answers 429.
   */
  const phoneKey = toE164(body.phone)
  if (phoneKey) {
    const phoneLimit = consumeRateLimit(
      `phone:${phoneKey}`,
      LEAD_RATE_LIMIT_PER_PHONE,
      LEAD_RATE_LIMIT_PHONE_WINDOW_MS,
    )
    if (!phoneLimit.allowed) throw rateLimited(phoneLimit.retryAfterSeconds)
  }

  const payload = await getPayload({ config: configPromise })

  // ---- Resolve the project server-side, never trusting the slug -----------
  let projectId: string | null = null
  let projectNameSnapshot: string | null = null
  const slug = typeof body.projectSlug === 'string' && body.projectSlug ? body.projectSlug : null

  if (slug) {
    const found = await payload.find({
      collection: 'projects',
      // Only a PUBLISHED project may be referenced: an unpublished slug is not
      // something a visitor could legitimately have seen, and accepting it would
      // confirm the existence of an unpublished project.
      where: { and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      select: { name: true },
    })
    const doc = found.docs[0]
    if (!doc) {
      throw validationError([
        {
          field: 'project',
          code: 'UNKNOWN_PROJECT',
          message: 'Please choose a project from the list.',
        },
      ])
    }
    projectId = String(doc.id)
    projectNameSnapshot = String((doc as { name?: string }).name ?? '')
  }

  // ---- Persist ------------------------------------------------------------
  try {
    const lead = await payload.create({
      collection: 'leads',
      /**
       * 🔴 THE ONE SANCTIONED `overrideAccess: true` ON A REQUEST PATH IN THE
       * ENTIRE CODEBASE. `leads.access.create` is `() => false` precisely so
       * that Payload's own generated REST route cannot create a lead — this
       * hand-written endpoint is the only writer, and every field below that a
       * client must not control is additionally closed by field-level access.
       */
      overrideAccess: true,
      data: {
        name: body.name,
        // Stored VERBATIM. `phoneNormalised` is derived by a hook.
        phone: body.phone,
        ...(typeof body.message === 'string' && body.message ? { message: body.message } : {}),
        ...(slug ? { projectSlug: slug } : {}),
        ...(projectId ? { project: projectId } : {}),
        ...(projectNameSnapshot ? { projectNameSnapshot } : {}),
        // SERVER-ASSIGNED. A client value in the body was accepted by the schema
        // and is discarded here.
        source: 'contact_form',
        sourcePath: deriveSourcePath(req),
        ipAddress: clientIp(req),
        userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
        consentGiven: true,
      },
    })

    const result = successBody(String(lead.id), String(lead.createdAt))
    if (idempotencyKey) idempotencyCache.set(idempotencyKey, { at: Date.now(), body: result })
    return result
  } catch (err) {
    /**
     * The windowed dedupe hook throws a 409 with the marker `DUPLICATE_LEAD`.
     * Translate it into THE SAME 201 the first submission received: a visitor who
     * double-taps the button must never see an error for having been keen.
     * Nothing new is stored — the first lead already exists.
     */
    const message = (err as { message?: string })?.message ?? ''
    if (message.includes('DUPLICATE_LEAD')) {
      return successBody(randomUUID(), new Date().toISOString())
    }
    throw err
  }
}

export const POST = definePublicEndpoint(handler, { cache: 'no-store', successStatus: 201 })
export const OPTIONS = definePreflight()
