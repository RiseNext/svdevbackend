import type { Field, TextField } from 'payload'

import { isPlaceholder } from '@/lib/constants'

/**
 * A text field that TOLERATES an unresolved `[BRACKETED]` placeholder.
 *
 * 🔴 THE RULE: a value matching `^\[.*\]$` bypasses FORMAT validation (url,
 * email, phone) but still obeys LENGTH limits, and is emitted by the serialiser
 * VERBATIM — never trimmed, never defaulted, never omitted.
 *
 * 🔴 WHY: `svfrontend/src/lib/href.ts` renders a bracketed destination INERT, so
 * a placeholder can never ship looking like a working link. Strip the brackets
 * from `[EMAIL@DOMAIN]` to "clean it up" and that guard stops firing — so a
 * live-looking dead link ships, which is the exact failure the frontend was
 * carefully built to prevent.
 *
 * The site is `noindex` + `Disallow: /` today BECAUSE of these values. Keeping
 * them visible is the point; hiding them is the bug.
 */

type PlaceholderTextArgs = {
  name: string
  label?: string
  required?: boolean
  maxLength: number
  /** Applied only when the value is NOT a bracketed placeholder. */
  format?: { test: (value: string) => boolean; message: string }
  description?: string
  /** Blocks publication on a still-bracketed value. Used where a placeholder
   *  reaching production is actively harmful rather than merely visible. */
  warnWhenPlaceholder?: boolean
  admin?: TextField['admin']
}

export const placeholderText = (args: PlaceholderTextArgs): Field => ({
  name: args.name,
  type: 'text',
  ...(args.label ? { label: args.label } : {}),
  ...(args.required ? { required: true } : {}),
  maxLength: args.maxLength,
  validate: (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') {
      return args.required ? 'This field is required.' : true
    }
    if (typeof value !== 'string') return 'Enter text.'
    if (value.length > args.maxLength) {
      return `This may be at most ${args.maxLength} characters.`
    }
    // The carve-out: a bracketed placeholder skips FORMAT checks only.
    if (isPlaceholder(value)) return true
    if (args.format && !args.format.test(value)) return args.format.message
    return true
  },
  admin: {
    ...(args.description || args.warnWhenPlaceholder
      ? {
          description: [
            args.description,
            args.warnWhenPlaceholder
              ? '⚠️ This value is still an unresolved [PLACEHOLDER]. The website renders it inert so it cannot ship looking real, but the page is incomplete until it is replaced.'
              : undefined,
          ]
            .filter(Boolean)
            .join(' '),
        }
      : {}),
    ...args.admin,
  },
})

/** Format predicates, shared so both the field and the tests use one definition. */
export const FORMATS = {
  email: {
    test: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    message: 'Enter a valid email address, or a [PLACEHOLDER] in square brackets.',
  },
  httpsUrl: {
    test: (v: string) => {
      try {
        const u = new URL(v)
        return u.protocol === 'https:' || u.protocol === 'http:'
      } catch {
        return false
      }
    },
    message: 'Enter a full URL starting with https://, or a [PLACEHOLDER] in square brackets.',
  },
  /** Digits only, country code first. NO `+`, no spaces, no dashes —
   *  `EnquiryPill.tsx:39` builds `wa.me/<value>` directly from it. */
  whatsappDigits: {
    test: (v: string) => /^\d{10,15}$/.test(v),
    message:
      'Digits only, country code first — for example 919876543210. No +, no spaces, no dashes.',
  },
} as const
