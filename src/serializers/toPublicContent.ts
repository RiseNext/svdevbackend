import type { Faq, SiteSetting, Statistic, Testimonial } from '@/payload-types'
import type { ImageRef, Testimonial as PublicTestimonial } from '@/types/frontend-contract'
import { coerceIcon } from '@/lib/icons'

import { put } from './put'
import { toImageRefOrUndefined } from './toImageRef'

/**
 * Serialisers for `site-settings` and the Tier-2 collections.
 *
 * Same rules as `toPublicProject`: built KEY BY KEY, `...doc` spread banned,
 * absent optionals omitted, every internal field stripped.
 */

export type PublicSiteSettings = {
  name: string
  legalName: string
  tagline?: string
  description?: string
  url: string
  email: string
  phone: string
  whatsapp: string
  address: string[]
  mapUrl?: string
  officeHours?: string
  social?: { label: string; href: string; icon: string }[]
  legalLinks?: { label: string; href: string }[]
  /** COMPUTED, never stored — see below. */
  copyrightText: string
  formNote?: string
  cta?: { title: string; body: string }
  heroTicker?: { icon: string; text: string }[]
  logo?: ImageRef
  masterPlan?: { title: string; href: string }
}

export const toPublicSiteSettings = (doc: SiteSetting): PublicSiteSettings => {
  const out: Record<string, unknown> = {}

  out.name = doc.name
  out.legalName = doc.legalName
  out.url = doc.url
  out.email = doc.email
  out.phone = doc.phone
  out.whatsapp = doc.whatsapp
  out.address = doc.address ?? []

  /**
   * 🔴 `copyrightText` IS COMPUTED, NOT STORED, AND THIS DELETES A WHOLE CLASS
   * OF BUG.
   *
   * `site.ts:90` stores "© [YEAR] ${legalName}. All rights reserved." — with
   * `[YEAR]` embedded MID-STRING. `isPlaceholder()` requires the WHOLE string to
   * start `[` and end `]`, so it returns false, the inert-link guard never
   * fires, and the literal text "© [YEAR] SV Developers." renders live in the
   * footer of every page TODAY, unstyled and unguarded.
   *
   * Computing it means the placeholder cannot exist. `copyright_text` is
   * deliberately NOT a field on the global, so nobody can re-add it.
   */
  out.copyrightText = `© ${new Date().getFullYear()} ${doc.legalName}. All rights reserved.`

  put(out, 'tagline', doc.tagline)
  put(out, 'description', doc.description)
  put(out, 'mapUrl', doc.mapUrl)
  put(out, 'officeHours', doc.officeHours)
  put(out, 'formNote', doc.formNote)

  put(
    out,
    'social',
    doc.social?.map((s) => ({ label: s.label, href: s.href, icon: coerceIcon(s.icon) })),
  )
  put(
    out,
    'legalLinks',
    doc.legalLinks?.map((l) => ({ label: l.label, href: l.href })),
  )
  put(
    out,
    'heroTicker',
    doc.heroTicker?.map((t) => ({ icon: coerceIcon(t.icon), text: t.text })),
  )

  // Both-or-neither, mirroring the project override's shape rule.
  // ⚠️ NOTE the site CTA is {title, BODY}; the per-project override is
  // {title, DESCRIPTION}. Different fields, deliberately not unified —
  // ProjectDetail falls back to a hardcoded literal, not to this value.
  const ctaTitle = doc.cta?.title?.trim()
  const ctaBody = doc.cta?.body?.trim()
  put(out, 'cta', ctaTitle && ctaBody ? { title: ctaTitle, body: ctaBody } : undefined)

  put(out, 'logo', toImageRefOrUndefined(doc.logo, 'logo'))

  // The master-plan PDF: flattened to a download link, never the raw document.
  const mp = doc.masterPlan
  if (mp && typeof mp === 'object' && 'url' in mp) {
    const d = mp as { title?: string | null; url?: string | null; filename?: string | null }
    if (d.url || d.filename) {
      out.masterPlan = { title: d.title ?? 'Master plan', href: d.url ?? '' }
    }
  }

  return out as unknown as PublicSiteSettings
}

export const PUBLIC_SITE_SETTINGS_SELECT = {
  name: true,
  legalName: true,
  tagline: true,
  description: true,
  url: true,
  email: true,
  phone: true,
  whatsapp: true,
  address: true,
  mapUrl: true,
  officeHours: true,
  social: true,
  legalLinks: true,
  formNote: true,
  cta: true,
  heroTicker: true,
  logo: true,
  masterPlan: true,
} as const

// ---------------------------------------------------------------------------

/** `rating` is kept in the shape for type compatibility even though nothing on
 *  the website renders it. `id` IS public here — the contract declares it. */
export const toPublicTestimonial = (doc: Testimonial): PublicTestimonial => {
  const out: Record<string, unknown> = {
    id: String(doc.id),
    name: doc.name,
    body: doc.body,
  }
  put(out, 'role', doc.role)
  put(out, 'rating', doc.rating)
  return out as unknown as PublicTestimonial
}

export const PUBLIC_TESTIMONIAL_SELECT = {
  name: true,
  role: true,
  rating: true,
  body: true,
} as const

// ---------------------------------------------------------------------------

export const toPublicFaq = (doc: Faq): { id: string; question: string; answer: string } => ({
  id: String(doc.id),
  question: doc.question,
  answer: doc.answer,
})

export const PUBLIC_FAQ_SELECT = { question: true, answer: true } as const

// ---------------------------------------------------------------------------

/** `value` is TEXT and is AUTHORED. Nothing derives it from a row count —
 *  "Plots handed over" is not something this database knows. */
export const toPublicStatistic = (
  doc: Statistic,
): { id: string; label: string; value: string } => ({
  id: String(doc.id),
  label: doc.label,
  value: doc.value,
})

export const PUBLIC_STATISTIC_SELECT = { label: true, value: true } as const
