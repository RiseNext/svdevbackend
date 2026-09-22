import type { Faq, SiteSetting, Statistic, Testimonial } from '@/payload-types'
import type { ImageRef, Testimonial as PublicTestimonial, VideoRef } from '@/types/frontend-contract'
import { coerceIcon } from '@/lib/icons'
import { cloudinaryFileUrl } from '@/media/mediaUrl'

import { put } from './put'
import { toImageRef, toImageRefOrUndefined } from './toImageRef'

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
  /** The site's ACTIVE video, if one is configured. Placement-neutral: this
   *  says which video is live, never where it is rendered. */
  video?: VideoRef
}

/**
 * The active video -> `{ src, mimeType, poster }`, or OMITTED.
 *
 * 🔴 BOTH-OR-NEITHER, AND EVERY BRANCH HERE IS A REAL CASE.
 * A partial object would put an autoplaying `<video>` on the website pointing
 * at nothing, or one with no poster on a device that refuses to autoplay —
 * i.e. a blank hero. The only honest outputs are a complete object or absence.
 *
 * 🔴 IT OMITS RATHER THAN THROWS, WHICH IS A DELIBERATE DEPARTURE FROM
 * `toImageRef`. That function throws on an unpopulated relation because a
 * project's cover image is REQUIRED — a broken one must fail loudly. The video
 * is OPTIONAL, and `site-settings` feeds every page on the site: a throw here
 * would turn "the video relation was not populated" into a 500 on the endpoint
 * that renders the header, the footer and the contact details of every page.
 * Omission degrades to "no video", which is a designed state the frontend
 * already handles.
 *
 * 🔴 `src` IS COMPOSED DETERMINISTICALLY, NEVER READ FROM `url`. This is the
 * same rule `toImageRef` and `buildDocumentHref` already follow, and ignoring
 * it is what put a 404 in production on brochure links: `url` on an upload
 * collection is a VIRTUAL field recomputed from `{ filename, prefix }` at
 * population time, and `prefix` is not in `defaultPopulate`, so it composes
 * WITHOUT the folder. `cloudinaryFileUrl` is the same function the storage
 * adapter's `generateURL` calls, so what Payload persists and what this emits
 * cannot drift. The `url` fallback is retained only for LOCAL DEVELOPMENT,
 * where Cloudinary is deliberately unconfigured and files are served from disk.
 */
const videoOrUndefined = (video: SiteSetting['video']): VideoRef | undefined => {
  // A bare id string means the relation was not populated deeply enough.
  // Never guess a URL from an id.
  if (!video || typeof video !== 'object') return undefined

  const filename = typeof video.filename === 'string' ? video.filename.trim() : ''
  const src = (filename ? cloudinaryFileUrl('videos', filename) : undefined) ?? video.url ?? ''
  if (!src) return undefined

  // The poster is REQUIRED on the collection, but "required" is a WRITE
  // constraint — it says nothing about whether the relation arrived populated
  // on this particular read. A bare id here means the query depth was too
  // shallow, so the whole object is omitted rather than emitting a video the
  // frontend cannot show a still for.
  if (!video.poster || typeof video.poster !== 'object') return undefined
  let poster: ImageRef
  try {
    poster = toImageRef(video.poster, 'video.poster')
  } catch {
    return undefined
  }
  if (!poster.src) return undefined

  return {
    src,
    // The collection accepts exactly one MIME type, so the fallback is a
    // statement of fact rather than an invention. The key exists at all so that
    // adding a second format later is additive on both sides instead of
    // breaking the contract.
    mimeType: video.mimeType ?? 'video/mp4',
    poster,
  }
}

export const toPublicSiteSettings = (doc: SiteSetting): PublicSiteSettings => {
  const out: Record<string, unknown> = {}

  /**
   * 🔴 THE SIX REQUIRED SCALARS ARE COERCED, AND THIS IS A CONTRACT OBLIGATION
   * RATHER THAN DEFENSIVE PADDING.
   *
   * `PublicSiteSettings` declares all six as `string` — NOT `string | undefined`
   * — so the frontend's types promise they are always there, and its code is
   * entitled to call `.startsWith()` on them without a guard.
   *
   * A bare `out.name = doc.name` breaks that promise the moment the global has
   * never been saved: the value is `undefined`, `JSON.stringify` DROPS THE KEY
   * ENTIRELY, and the frontend receives an object missing fields its own types
   * swear are present. TypeScript cannot catch it — the lie is on the wire, not
   * in the source.
   *
   * ⚠️ THIS WAS NOT THEORETICAL. It crashed `next build` outright:
   *   TypeError: Cannot read properties of undefined (reading 'startsWith')
   *   Export encountered an error on /projects/page
   * A freshly migrated production database is exactly this state, so deploying
   * the frontend before the owner first saved Admin → Site Settings failed the
   * Vercel build rather than degrading.
   *
   * `''` is the honest empty value: it satisfies the declared type, it is
   * falsy so every `value ? … : …` branch treats it as absent, and it invents
   * no phone number, address or company name. `put()` is deliberately NOT used
   * here — it OMITS empty values, which is correct for the optional fields
   * below and is precisely the wrong behaviour for a required one.
   */
  out.name = doc.name ?? ''
  out.legalName = doc.legalName ?? ''
  out.url = doc.url ?? ''
  out.email = doc.email ?? ''
  out.phone = doc.phone ?? ''
  out.whatsapp = doc.whatsapp ?? ''
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
   *
   * 🔴 THE OWNER NAME IS RESOLVED, NOT INTERPOLATED BLIND, AND THAT GUARD IS
   * LOAD-BEARING RATHER THAN DEFENSIVE.
   *
   * `legalName` is `required: true` on the global — but "required" is a WRITE
   * constraint, and it says nothing about a global that has NEVER BEEN SAVED.
   * A global with no row reads back as an empty document, so `doc.legalName` is
   * `undefined`, and a bare `${doc.legalName}` renders the literal seven
   * characters "undefined" INTO A STRING. `undefined` in a field is dropped by
   * `JSON.stringify` and the frontend's optional handling covers it; `undefined`
   * baked into the middle of a string survives serialisation intact and reaches
   * the visitor.
   *
   * ⚠️ THIS IS NOT A HYPOTHETICAL — IT IS THE STATE OF A FRESHLY MIGRATED
   * PRODUCTION DATABASE. Between `payload migrate` and the moment the owner
   * first saves Admin → Site Settings, every page footer rendered
   * "© 2026 undefined. All rights reserved."
   *
   * `name` (the trading name) is the fallback because it is the same entity by a
   * different label, and it is the field the owner fills in first. If BOTH are
   * absent the name segment is DROPPED ENTIRELY rather than substituted: a
   * copyright line with no proprietor is incomplete, but a copyright line
   * asserting a company name this code invented would be a fabricated legal
   * claim. Omission is the honest failure mode.
   */
  const copyrightOwner = (doc.legalName ?? doc.name ?? '').trim()
  out.copyrightText = copyrightOwner
    ? `© ${new Date().getFullYear()} ${copyrightOwner}. All rights reserved.`
    : `© ${new Date().getFullYear()}. All rights reserved.`

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

  // The active video. `put` omits the key entirely when undefined, which is
  // what makes the no-video response byte-identical to the pre-feature one.
  put(out, 'video', videoOrUndefined(doc.video))

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
  // Selected so `videos.defaultPopulate` resolves `{ filename, url, title,
  // poster }`. Omitting it here would hand the serialiser a bare id and the
  // `video` key would SILENTLY never appear — the exact failure mode that kept
  // `projects.brochure` invisible until it was added to its own select.
  video: true,
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
