import { APIError, type CollectionAfterChangeHook, type CollectionBeforeValidateHook, type FieldHook } from 'payload'

import {
  DEFAULT_COUNTRY_CALLING_CODE,
  DEFAULT_QUEUE,
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
 * Strip HTML from the lead message.
 *
 * STORED-XSS DEFENCE. The message is later rendered in the admin AND in a
 * notification email. React escapes by default; the EMAIL RENDERER DOES NOT,
 * which is why `escapeHtml` exists — but removing the markup at the boundary
 * means neither layer is the only thing standing between an attacker and the
 * sales team's inbox.
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
 * ENQUEUE THE NOTIFICATION — never send inline.
 *
 * The official jobs documentation answers this by name: "If the email service is
 * temporarily down, the hook would fail and potentially block the user creation.
 * Jobs can retry automatically." FR-LEAD-06 requires the same from the other
 * direction: a failed notification must not fail the request.
 *
 * 🔴 The try/catch is what keeps FR-LEAD-06 true. A queue failure must not fail
 * the visitor's request either.
 *
 * Note the ordering guarantee this leans on: `afterChange` runs AFTER the lead
 * row is written, so "persist first, enqueue second" is STRUCTURALLY guaranteed
 * rather than remembered.
 *
 * The enqueue IS awaited and DOES carry `req`, so it shares the transaction —
 * that is deliberate and is the opposite of the revalidation hook's choice.
 */
export const enqueueLeadNotification: CollectionAfterChangeHook = async ({
  req,
  doc,
  operation,
  context,
}) => {
  if (operation !== 'create') return doc
  if (context?.skipNotification) return doc

  try {
    await req.payload.jobs.queue({
      task: 'sendLeadNotification',
      // An ID, never the object — the docs' own rule. The handler re-reads the
      // lead, so a retry always works from current data.
      input: { leadId: String(doc.id) },
      queue: DEFAULT_QUEUE,
      req,
    })
  } catch (err) {
    req.payload.logger.error(
      { err, leadId: doc.id },
      'FAILED TO ENQUEUE LEAD NOTIFICATION — the lead IS saved and visible in the admin, but nobody has been told about it',
    )
  }
  return doc
}
