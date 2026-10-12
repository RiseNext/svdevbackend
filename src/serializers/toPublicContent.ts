import type { Faq, SiteSetting, Statistic, Testimonial } from '@/payload-types'
import type { ImageRef, Testimonial as PublicTestimonial, VideoRef } from '@/types/frontend-contract'
import type { HeroMediaItem } from '@/types/frontend-contract-hero'
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
  /**
   * The site's ACTIVE videos, IN ADMIN ORDER.
   *
   * 🔴 `VideoRef` declares `poster` and `title` OPTIONAL, but this serialiser
   * ALWAYS emits both — an entry missing either is dropped rather than
   * emitted partially. The optionality belongs to the frontend's type (it also
   * accepts videos from a local preview folder in development, where a poster
   * may genuinely be absent); from the CMS both are guaranteed, because
   * `videos.title` and `videos.poster` are `required: true`. Emitting a
   * narrower, fully-populated shape than the contract permits is always safe;
   * the reverse is not.
   */
  heroVideos?: VideoRef[]
  /**
   * The unified hero list — images, uploaded MP4s and YouTube, in admin order.
   *
   * 🔴 EMITTED ALONGSIDE `heroVideos`, NEVER INSTEAD OF IT. One hero video is
   * live in production through the legacy field; the frontend prefers this list
   * when it is non-empty and falls back to mapping `heroVideos` otherwise. That
   * is what makes the field additive and the rollout migration-free.
   */
  heroMedia?: HeroMediaItem[]
}

/** One populated `videos` document -> `{ src, poster, title }`, or `undefined`
 *  when it cannot be fully resolved. See `heroVideosOrUndefined` below. */
const toVideoRef = (video: unknown): VideoRef | undefined => {
  // A bare id string means the relation was not populated deeply enough.
  // Never guess a URL from an id.
  if (!video || typeof video !== 'object') return undefined
  const doc = video as {
    filename?: unknown
    url?: unknown
    title?: unknown
    poster?: unknown
  }

  const filename = typeof doc.filename === 'string' ? doc.filename.trim() : ''
  const src =
    (filename ? cloudinaryFileUrl('videos', filename) : undefined) ??
    (typeof doc.url === 'string' ? doc.url : '')
  if (!src) return undefined

  // `videos.title` is `required: true`, so an absent one means a malformed or
  // partially-selected read rather than an editorial choice. The frontend
  // types it optional because its DEVELOPMENT preview source may lack one;
  // from the CMS it is guaranteed, so a missing title drops the entry rather
  // than emitting a slide the carousel can only announce as "Video 2 of 3".
  const title = typeof doc.title === 'string' ? doc.title.trim() : ''
  if (!title) return undefined

  // 🔴 POSTER IS A PLAIN URL STRING HERE, NOT AN ImageRef — the frontend types
  // it `poster?: string` and passes it straight to `<video poster={...}>`.
  // `toImageRef` is still what BUILDS it, so the poster URL is composed by the
  // same proven path as every other image on the site; only `.src` is taken.
  // `poster` is `required: true` on the collection, so a bare id here means the
  // read was too shallow — drop the entry rather than emit a video with no
  // still frame, which is all a metered or autoplay-refusing device would see.
  if (!doc.poster || typeof doc.poster !== 'object') return undefined
  let poster: ImageRef
  try {
    poster = toImageRef(doc.poster, 'heroVideos[].poster')
  } catch {
    return undefined
  }
  if (!poster.src) return undefined

  // Exactly three keys. `mimeType` is DELIBERATELY NOT emitted: the frontend's
  // `VideoRef` does not declare it and nothing consumes it.
  return { src, poster: poster.src, title }
}

/**
 * The ordered hero videos -> `[{ src, poster, title }]`, or OMITTED.
 *
 * 🔴 ORDER IS THE CONTRACT AND IS PRESERVED VERBATIM. `HeroVideoStage`
 * advances with `(index + 1) % videos.length` and keys each slide by position,
 * so the array index IS the carousel order. Payload stores a `hasMany` relation
 * with an explicit `order` column and returns rows in that order, which means
 * the admin's drag-to-reorder is the single source of truth. NOTHING here may
 * sort — not by title, not by date, not by id.
 *
 * 🔴 PER-ENTRY BOTH-OR-NOTHING, NOT ALL-OR-NOTHING. One unresolvable video
 * must not blank a working carousel, so a bad entry is dropped and the rest are
 * emitted. If that leaves nothing, the KEY ITSELF IS OMITTED — never `[]`,
 * never `null`, never a placeholder row. The frontend treats absent and empty
 * identically, but omission is what its own spec note asks for.
 *
 * 🔴 DEDUPED BY `src`, KEEPING THE FIRST OCCURRENCE. Payload permits selecting
 * the same upload twice in a `hasMany` field, and `HeroVideoStage` uses
 * `key={video.src}` — duplicates would collide as React keys and the carousel
 * would misbehave in a way that looks like a rendering bug rather than a data
 * one. First-wins keeps the admin's intended position for the first mention.
 *
 * 🔴 IT OMITS RATHER THAN THROWS, unlike `toImageRef`. That function throws
 * because a project cover is required and a broken one must fail loudly. Hero
 * videos are optional, and `site-settings` feeds EVERY page — a throw here
 * would turn "a relation was not populated" into a site-wide 500. Omission
 * degrades to the type-only hero, which is a designed state.
 */
const heroVideosOrUndefined = (videos: SiteSetting['heroVideos']): VideoRef[] | undefined => {
  if (!Array.isArray(videos) || videos.length === 0) return undefined

  const out: VideoRef[] = []
  const seen = new Set<string>()
  for (const video of videos) {
    const ref = toVideoRef(video)
    if (!ref) continue
    if (seen.has(ref.src)) continue
    seen.add(ref.src)
    out.push(ref)
  }

  return out.length > 0 ? out : undefined
}

/**
 * THE UNIFIED HERO MEDIA LIST -> a DISCRIMINATED UNION, or OMITTED.
 *
 * 🔴 EVERY RULE `heroVideosOrUndefined` ESTABLISHED APPLIES HERE UNCHANGED, and
 * deliberately so — this is the same contract widened to three kinds, not a new
 * one:
 *
 *   · ORDER IS PRESERVED VERBATIM. Array index IS slideshow order, across all
 *     three kinds. NOTHING here may sort — not by kind, not by title.
 *   · PER-ENTRY BOTH-OR-NOTHING. One unresolvable row must not blank a working
 *     hero, so a bad row is dropped and the rest are emitted.
 *   · IF THAT LEAVES NOTHING, THE KEY ITSELF IS OMITTED — never `[]`, never
 *     `null`. The frontend then falls back to `heroVideos`, which is what makes
 *     this field additive rather than a flag day.
 *   · IT OMITS RATHER THAN THROWS. `site-settings` feeds EVERY page; a throw
 *     here would turn one unpopulated relation into a site-wide 500.
 *
 * 🔴 DEDUPED PER KIND BY ITS OWN IDENTITY. `HeroVideoStage` keys slides by a
 * stable string, and two identical entries would collide as React keys and
 * misbehave in a way that looks like a rendering bug rather than a data one.
 * An image and a video may legitimately share nothing, so the key is
 * `kind:identity` rather than a bare src.
 */
const heroMediaOrUndefined = (rows: SiteSetting['heroMedia']): HeroMediaItem[] | undefined => {
  if (!Array.isArray(rows) || rows.length === 0) return undefined

  const out: HeroMediaItem[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const title = typeof row.title === 'string' ? row.title.trim() : ''

    // ---- A PHOTOGRAPH ----
    if (row.kind === 'image') {
      // A bare id string means the relation was not populated deeply enough.
      // Never guess a URL from an id — drop the row instead.
      if (!row.image || typeof row.image !== 'object') continue
      let image: ImageRef
      try {
        image = toImageRef(row.image, 'heroMedia[].image')
      } catch {
        continue
      }
      if (!image.src) continue
      if (seen.has(`image:${image.src}`)) continue
      seen.add(`image:${image.src}`)
      out.push({
        kind: 'image',
        src: image.src,
        // `alt` rides along from the Media library entry, which is why an image
        // hero needs no second field to be accessible.
        alt: image.alt,
        width: image.width,
        height: image.height,
        ...(title ? { title } : {}),
      })
      continue
    }

    // ---- AN UPLOADED MP4 ----
    if (row.kind === 'video') {
      // 🔴 THE SAME `toVideoRef` THE LEGACY FIELD USES. Reusing it is what
      // guarantees an uploaded hero video resolves to byte-identically the same
      // `{src, poster}` here as it does through `heroVideos` — one definition,
      // so the two cannot drift. It also inherits the rule that a video missing
      // its required poster or title is dropped rather than half-emitted.
      const ref = toVideoRef(row.video)
      if (!ref) continue
      if (seen.has(`video:${ref.src}`)) continue
      seen.add(`video:${ref.src}`)
      out.push({
        kind: 'video',
        src: ref.src,
        poster: ref.poster,
        // The row's own title wins over the asset's internal label: the asset
        // name is for the library, this one is for the visitor.
        ...(title ? { title } : ref.title ? { title: ref.title } : {}),
      })
      continue
    }

    // ---- A YOUTUBE LINK ----
    if (row.kind === 'youtube') {
      const youtubeUrl = typeof row.youtubeUrl === 'string' ? row.youtubeUrl.trim() : ''
      if (!youtubeUrl) continue

      /* 🔴 THE POSTER IS MANDATORY AND THE ROW IS DROPPED WITHOUT IT. The field
         validator already refuses to SAVE such a row, so reaching here means
         the data predates the validator or arrived another way. Emitting a
         YouTube slide with no poster would render an empty hero panel, because
         YouTube's own thumbnail host is deliberately absent from svfrontend's
         image allow-list. An absent slide is better than a blank one. */
      if (!row.poster || typeof row.poster !== 'object') continue
      let poster: ImageRef
      try {
        poster = toImageRef(row.poster, 'heroMedia[].poster')
      } catch {
        continue
      }
      if (!poster.src) continue
      if (seen.has(`youtube:${youtubeUrl}`)) continue
      seen.add(`youtube:${youtubeUrl}`)
      out.push({
        kind: 'youtube',
        // 🔴 VERBATIM, never reduced to an id — `youtubeId()` on the frontend
        // is the single arbiter, and it accepts every share-button form.
        youtubeUrl,
        poster: poster.src,
        ...(title ? { title } : {}),
      })
      continue
    }

    // An unknown `kind` is dropped rather than guessed at. `select` enums are
    // DB-level, so this is only reachable if the enum gained a value the
    // serialiser has not been taught — which must not render as something else.
  }

  return out.length > 0 ? out : undefined
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

  // The ordered hero videos. `put` omits the key entirely when undefined,
  // which is what makes the no-video response byte-identical to the response
  // this endpoint returned before the feature existed.
  put(out, 'heroVideos', heroVideosOrUndefined(doc.heroVideos))

  // The unified list. `put` omits the key when nothing resolves, which is what
  // makes the response byte-identical to before this field existed for an
  // admin who has not populated it — and what lets the frontend fall back to
  // `heroVideos` by simply asking whether the key is there.
  put(out, 'heroMedia', heroMediaOrUndefined(doc.heroMedia))

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
  // poster }` for every row. Omitting it here would hand the serialiser bare
  // ids and `heroVideos` would SILENTLY never appear — the exact failure mode
  // that kept `projects.brochure` invisible until it was added to its select.
  heroVideos: true,
  /**
   * 🔴 SELECTED SO THE THREE UPLOAD RELATIONS INSIDE EACH ROW RESOLVE.
   * `select` is include-mode: without this the serialiser receives nothing for
   * `heroMedia` and the key is silently omitted — which looks exactly like "the
   * admin has not configured a hero yet" and is the failure that kept
   * `projects.brochure` invisible in production.
   *
   * ⚠️ `true` RATHER THAN A NESTED OBJECT, DELIBERATELY. Selecting the whole
   * array lets `depth: 1` populate `image`, `video` and `poster` through each
   * collection's own `defaultPopulate`, which is where `videos` resolves
   * `{filename, url, title, poster}`. A hand-written nested select would have
   * to restate those and would drift from them.
   */
  heroMedia: true,
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
