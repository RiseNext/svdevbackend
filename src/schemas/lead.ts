import { z } from 'zod'

import { HONEYPOT_FIELD, LIMITS, MAX_PHONE_DIGITS, MIN_PHONE_DIGITS } from '@/lib/constants'
import type { FieldError } from '@/lib/errors'

/**
 * THE PUBLIC LEAD BODY.
 *
 * `strictObject` rejects unknown properties, with a CLOSED CARVE-OUT LIST:
 *   · the five system fields (id, createdAt, updatedAt, createdBy, updatedBy)
 *     are silently dropped
 *   · the NAMED honeypot field is accepted and discarded
 *   · `source` is accepted and OVERWRITTEN server-side
 * Any other unknown key is a 422.
 *
 * The honeypot field is NAMED HERE so the "reject unknown properties" rule and
 * the honeypot rule cannot contradict each other — without this, one rule
 * requires the same field to be both accepted and rejected (CONF-48).
 */

const digits = (s: string) => s.replace(/\D/g, '')
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/

export const leadBodySchema = z
  .object({
    name: z
      .string({ message: 'A name is required.' })
      .transform((s) => s.normalize('NFC').trim()),

    phone: z.string({ message: 'A phone number is required.' }).transform((s) => s.trim()),

    // absent / '' / null all mean "no preference". EXISTENCE is checked against
    // the database in the handler, which is what produces UNKNOWN_PROJECT.
    projectSlug: z
      .union([z.literal(''), z.null(), z.string().max(120)])
      .optional(),

    message: z
      .union([z.literal(''), z.null(), z.string()])
      .optional()
      .transform((s) => (typeof s === 'string' ? s.normalize('NFC').trim() : s)),

    // THE HONEYPOT. Accepted, required to be empty, and never stored.
    [HONEYPOT_FIELD]: z.string().optional(),

    // Accepted and overwritten. A client value is advisory only — the test is
    // concrete: POST "source":"whatsapp" and assert the stored value is
    // `contact_form`.
    source: z.string().optional(),

    // Silently dropped system fields.
    id: z.unknown().optional(),
    createdAt: z.unknown().optional(),
    updatedAt: z.unknown().optional(),
    createdBy: z.unknown().optional(),
    updatedBy: z.unknown().optional(),
  })
  .strict()

export type LeadBody = z.infer<typeof leadBodySchema>

/**
 * Field-level validation, returning OUR error vocabulary rather than Zod's.
 *
 * 🔴 `details[].field` MUST exactly match the frontend input `name` attributes —
 * `name`, `phone`, `project`, `message` — so `ContactForm`'s existing `Errors`
 * map renders server errors in the same inline slots WITH NO REDESIGN.
 *
 * Note the deliberate asymmetry: the request body key is `projectSlug`, the
 * error field is `project`.
 */
export const validateLeadBody = (body: LeadBody): FieldError[] => {
  const errors: FieldError[] = []

  // ---- name --------------------------------------------------------------
  if (!body.name || body.name.length < 1) {
    errors.push({ field: 'name', code: 'REQUIRED', message: 'Please tell us your name.' })
  } else if (body.name.length > LIMITS.leadName) {
    errors.push({
      field: 'name',
      code: 'TOO_LONG',
      message: `A name may be at most ${LIMITS.leadName} characters.`,
    })
  } else if (CONTROL_CHARS.test(body.name)) {
    errors.push({ field: 'name', code: 'INVALID', message: 'That does not look like a name.' })
  } else if (!/\p{L}/u.test(body.name)) {
    // Not punctuation- or digits-only. \p{L} covers Telugu and Devanagari too.
    errors.push({ field: 'name', code: 'INVALID', message: 'That does not look like a name.' })
  }

  // ---- phone -------------------------------------------------------------
  const phoneDigits = digits(body.phone ?? '')
  if (!body.phone || body.phone.length < 1) {
    errors.push({
      field: 'phone',
      code: 'REQUIRED',
      message: 'Please leave a number we can call you on.',
    })
  } else if (phoneDigits.length < MIN_PHONE_DIGITS) {
    // ⚠️ The message deliberately does NOT say "10-digit" while
    // MIN_PHONE_DIGITS is 8 — that would tell the visitor a rule the server is
    // not enforcing. It matches `ContactForm.tsx:34`'s existing copy exactly.
    // The wording changes in the same release that raises the constant.
    errors.push({
      field: 'phone',
      code: 'TOO_SHORT',
      message: 'That number looks incomplete.',
    })
  } else if (phoneDigits.length > MAX_PHONE_DIGITS) {
    errors.push({ field: 'phone', code: 'TOO_LONG', message: 'That number is too long.' })
  } else if (/^(\d)\1+$/.test(phoneDigits)) {
    errors.push({
      field: 'phone',
      code: 'INVALID',
      message: 'That number does not look real.',
    })
  }

  // ---- projectSlug -------------------------------------------------------
  if (typeof body.projectSlug === 'string' && body.projectSlug !== '') {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.projectSlug)) {
      errors.push({
        field: 'project',
        code: 'UNKNOWN_PROJECT',
        message: 'Please choose a project from the list.',
      })
    }
  }

  // ---- message -----------------------------------------------------------
  if (typeof body.message === 'string' && body.message.length > LIMITS.leadMessage) {
    errors.push({
      field: 'message',
      code: 'TOO_LONG',
      message: `Please keep your message under ${LIMITS.leadMessage} characters.`,
    })
  }

  return errors
}

/** A filled honeypot. Kept separate from validation because the RESPONSE must
 *  be indistinguishable from success — see the route handler. */
export const honeypotTriggered = (body: LeadBody): boolean => {
  const value = body[HONEYPOT_FIELD]
  return typeof value === 'string' && value.trim() !== ''
}
