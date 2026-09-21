import { APIError, type CollectionBeforeValidateHook, type FieldHook } from 'payload'

import {
  DEFAULT_COUNTRY_CALLING_CODE,
  LEAD_DEDUPE_WINDOW_MS,
  MAX_PHONE_DIGITS,
  MIN_PHONE_DIGITS,
} from '@/lib/constants'

/**
 * LEAD NORMALISATION AND ANTI-ABUSE.
 *
 * Normalisation lives in `beforeValidate` FIELD hooks so that the validator sees
 * the clean value, and so the ADMIN path and the PUBLIC path normalise
 * identically. A normaliser that lives in the endpoint only is a normaliser that
 * does not run when an admin edits a lead by hand.
 */

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g

/** NFC + trim + strip control characters. Applied to every free-text field. */
export const normaliseText: FieldHook = ({ value }) => {
  if (typeof value !== 'string') return value
  return value.normalize('NFC').replace(CONTROL_CHARS, '').trim()
}

/**
 * Strip HTML from the enquiry message.
 *
 * STORED-XSS DEFENCE AT THE BOUNDARY. The Admin Panel is React and escapes by
 * default, so this is defence in depth rather than the only layer — but the
 * message is attacker-controlled free text written by an anonymous visitor, and
 * sanitising on the way IN means a future consumer of this column (a CSV export,
 * a report) inherits the guarantee instead of having to re-derive it.
 */
export const stripHtml: FieldHook = ({ value }) => {
  if (typeof value !== 'string') return value
  return value
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    // Remove whole script/style blocks including their contents, then any tag.
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
}

export const digitsOnly = (input: string): string => input.replace(/\D/g, '')

/**
 * E.164 normalisation, THRESHOLD-INDEPENDENT by design.
 *
 * It strips non-digits and assumes +91 for a bare 10-digit Indian mobile number.
 * Because it does not itself enforce a minimum length, tightening
 * MIN_PHONE_DIGITS from 8 to 10 (D-114) is a ONE-LINE CONSTANT CHANGE rather
 * than a rewrite of this function.
 */
export const toE164 = (raw: string): string => {
  const digits = digitsOnly(raw)
  if (!digits) return ''
  // Already carries a country code as 00-prefix.
  if (digits.startsWith('00')) return `+${digits.slice(2).slice(0, MAX_PHONE_DIGITS)}`
  // A bare Indian mobile number.
  if (digits.length === 10) return `+${DEFAULT_COUNTRY_CALLING_CODE}${digits}`
  // 91XXXXXXXXXX already includes the country code.
  if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY_CALLING_CODE)) return `+${digits}`
  return `+${digits.slice(0, MAX_PHONE_DIGITS)}`
}

export const isJunkPhone = (raw: string): boolean => {
  const digits = digitsOnly(raw)
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return true
  // 0000000000, 1111111111 — the classic throwaway.
  if (/^(\d)\1+$/.test(digits)) return true
  return false
}

/** Derives `phoneNormalised` from `phone`. The raw `phone` is stored VERBATIM,
 *  exactly as submitted — that is what a salesperson dials. */
export const derivePhoneNormalised: CollectionBeforeValidateHook = ({ data }) => {
  if (!data) return data
  if (typeof data.phone === 'string' && data.phone.trim() !== '') {
    return { ...data, phoneNormalised: toE164(data.phone) }
  }
  return data
}

/**
 * WINDOWED DEDUPE on (phoneNormalised, projectSlug).
 *
 * 🔴 A time-windowed partial unique index is NOT EXPRESSIBLE IN POSTGRES — the
 * predicate would be non-immutable — so this is necessarily application logic.
 * The supporting compound index is deliberately NON-UNIQUE: one buyer may
 * legitimately enquire about several projects, and a hard unique constraint
 * would reject real leads.
 *
 * The window is a CONSTANT, not an env var: widening it rejects real enquiries
 * and narrowing it admits spam, a behaviour change that belongs in a reviewed
 * commit rather than a platform console with no diff and no audit trail.
 */
export const leadDedupe: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (operation !== 'create' || !data) return data

  const phone = typeof data.phoneNormalised === 'string' ? data.phoneNormalised : null
  if (!phone) return data

  const since = new Date(Date.now() - LEAD_DEDUPE_WINDOW_MS).toISOString()
  const slug = typeof data.projectSlug === 'string' && data.projectSlug ? data.projectSlug : null

  const existing = await req.payload.find({
    collection: 'leads',
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
    where: {
      and: [
        { phoneNormalised: { equals: phone } },
        { createdAt: { greater_than: since } },
        slug ? { projectSlug: { equals: slug } } : { projectSlug: { exists: false } },
      ],
    },
  })

  if (existing.totalDocs > 0) {
    // 409, not 422: the submission is well-formed, it is simply a repeat. The
    // public handler translates this into the SAME 201 the first submission
    // received, so a double-tap on a phone never shows the visitor an error.
    throw new APIError('DUPLICATE_LEAD', 409)
  }

  return data
}

/**
 * 🔴 THERE IS NO `enqueueLeadNotification` HOOK, AND THAT IS THE POINT.
 *
 * It used to queue a `sendLeadNotification` job in `afterChange`. Both the hook
 * and the task are gone: this product sends no email, so an enquiry has nothing
 * to be forwarded to. The row in `leads` IS the delivery, and it is committed
 * before the endpoint returns 201.
 *
 * What that removal actually bought, beyond deleting code: the previous design
 * had a failure mode where the enquiry saved, the visitor saw "we will call you
 * back", and the business was told nothing — because a worker was dead or a mail
 * provider was down, neither of which surfaces in the request path. That whole
 * class of failure no longer has anywhere to occur.
 *
 * ⚠️ `context.skipNotification` is still accepted by scripts and seeds that set
 * it; it is now simply inert. Leaving it tolerated costs nothing and keeps those
 * call sites from breaking.
 */
