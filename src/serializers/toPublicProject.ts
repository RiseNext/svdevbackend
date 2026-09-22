import type { Project as PayloadProject } from '@/payload-types'
import type {
  FeatureItem,
  Project as PublicProject,
  ProximityItem,
} from '@/types/frontend-contract'
import { coerceIcon } from '@/lib/icons'

import { put } from './put'
import { toImageRef, toImageRefOrUndefined } from './toImageRef'

/**
 * THE SINGLE CONTROL POINT FOR THE PUBLIC CONTRACT.
 *
 * 🔴 `...doc` SPREAD IS BANNED anywhere in this directory. The output is built
 * KEY BY KEY. This is enforced by review plus the key-set snapshot suite, and it
 * is the reason a new internal field added six months from now causes a TEST
 * FAILURE rather than a silent leak.
 *
 * THE EXHAUSTIVE STRIP-LIST — every one of these is present on the Payload
 * document and NONE of them reaches the public JSON:
 *   id · _order (the fractional index) · _status · publishedAt · deletedAt
 *   createdAt · updatedAt · every ARRAY-ROW id · Payload's {docs,totalDocs,…}
 *   envelope (handled by the route handlers)
 *
 * THE OMIT RULE (D-008 extended to scalars by P3): absent optional fields are
 * OMITTED, never `null`, never `''`, never `[]`. `featured` is the ONE optional
 * field always emitted, because `false` IS assignable to `boolean | undefined`
 * while `null` is not assignable to anything the contract declares.
 */

/** A feature row -> `{ icon, title, body? }`. The array-row `id` is never copied. */
const toFeatureItem = (row: {
  icon: string
  title: string
  body?: string | null
  id?: string | null
}): FeatureItem => {
  const out: Record<string, unknown> = {
    // The defensive fallback. Unreachable given the Postgres enum — which is the
    // point: it guards the worst failure mode in the codebase, an unknown icon
    // rendering as a silent, invisible 24px blank box with no error anywhere.
    icon: coerceIcon(row.icon),
    title: row.title,
  }
  put(out, 'body', row.body)
  return out as FeatureItem
}

const toProximityItem = (row: {
  icon: string
  measure: string
  place: string
  id?: string | null
}): ProximityItem => ({
  icon: coerceIcon(row.icon),
  measure: row.measure,
  place: row.place,
})

/**
 * `seo` is ASYMMETRIC with `cta` and that asymmetry is deliberate: the contract
 * declares `seo?: { title?: string; description?: string }` — both members
 * optional — while `cta?: { title: string; description: string }` requires both.
 * Mirror it exactly, or `seo: {}` becomes impossible and `cta: { title }`
 * becomes possible.
 */
const seoOrUndefined = (
  seo: PayloadProject['seo'],
): { title?: string; description?: string } | undefined => {
  if (!seo) return undefined
  const out: Record<string, unknown> = {}
  put(out, 'title', seo.title)
  put(out, 'description', seo.description)
  return Object.keys(out).length ? (out as { title?: string; description?: string }) : undefined
}

/**
 * The brochure PDF -> `{ title, href }`, or OMITTED.
 *
 * 🔴 BOTH-OR-NEITHER, AND FOR A CONCRETE REASON. `href` comes from the stored
 * Cloudinary delivery URL. If the relation arrives UNPOPULATED (a bare id
 * string, which is what a depth-0 read returns) or the document has no `url`
 * yet, emitting a partial object would put a download button on the website
 * pointing at nothing. The contract declares both members required inside the
 * optional object, so the only honest options are a complete pair or absence.
 *
 * ⚠️ The populated shape is pinned by `documents.defaultPopulate`
 * (`{ filename, url, title }`), which is exactly the two values needed — so this
 * needs no extra query and no depth change.
 *
 * `title` falls back to the filename only if a document somehow has none;
 * `documents.title` is `required: true`, so that is defence, not expectation.
 */
const brochureOrUndefined = (
  brochure: PayloadProject['brochure'],
): { title: string; href: string } | undefined => {
  // A bare id means the relation was not populated — never guess a URL from it.
  if (!brochure || typeof brochure !== 'object') return undefined

  const href = typeof brochure.url === 'string' ? brochure.url.trim() : ''
  if (!href) return undefined

  const title =
    (typeof brochure.title === 'string' ? brochure.title.trim() : '') ||
    (typeof brochure.filename === 'string' ? brochure.filename.trim() : '')
  if (!title) return undefined

  return { title, href }
}

/** Both-or-neither, enforced at the field level too. */
const ctaOrUndefined = (
  cta: PayloadProject['cta'],
): { title: string; description: string } | undefined => {
  const title = cta?.title?.trim()
  const description = cta?.description?.trim()
  if (!title || !description) return undefined
  return { title, description }
}

/** The FULL record — `GET /api/v1/projects/{slug}`. */
export const toPublicProject = (doc: PayloadProject): PublicProject => {
  const out: Record<string, unknown> = {}

  // ---- ALWAYS PRESENT (the 8 required fields + the always-emitted optional) --
  out.slug = doc.slug
  out.name = doc.name
  out.category = doc.category
  out.locality = doc.locality
  out.summary = doc.summary
  // IDENTITY PASS-THROUGH. `text` + `hasMany: true` round-trips as string[],
  // measured at both the type layer and the runtime layer — see the gate report.
  out.description = doc.description
  out.highlights = (doc.highlights ?? []).map(toFeatureItem)
  out.image = toImageRef(doc.image, 'image')
  // The ONE optional field always emitted (P3).
  out.featured = Boolean(doc.featured)

  // ---- OMITTED WHEN ABSENT — scalars included -----------------------------
  // `projectStatus` -> the public key `status`. This is where the reserved-name
  // rename is undone, so types/content.ts never had to change.
  put(out, 'status', doc.projectStatus)
  put(out, 'developer', doc.developer)
  put(out, 'tagline', doc.tagline)
  put(out, 'area', doc.area)
  put(out, 'roadDetails', doc.roadDetails)

  put(
    out,
    'stats',
    doc.stats?.map((s) => ({ label: s.label, value: s.value })),
  )
  put(out, 'amenities', doc.amenities?.map(toFeatureItem))
  put(out, 'approvals', doc.approvals?.map(toFeatureItem))
  put(out, 'locationHighlights', doc.locationHighlights?.map(toFeatureItem))
  put(out, 'proximity', doc.proximity?.map(toProximityItem))

  put(
    out,
    'gallery',
    doc.gallery?.map((g, i) => toImageRef(g, `gallery[${i}]`)),
  )
  put(out, 'layoutImage', toImageRefOrUndefined(doc.layoutImage, 'layoutImage'))
  put(out, 'locationMap', toImageRefOrUndefined(doc.locationMap, 'locationMap'))

  put(out, 'cta', ctaOrUndefined(doc.cta))
  put(out, 'seo', seoOrUndefined(doc.seo))
  put(out, 'brochure', brochureOrUndefined(doc.brochure))

  // `brochureImages` is deliberately absent from the model entirely — zero
  // render sites, 0/5 populated. It is page SCANS AS IMAGES and is NOT the
  // `brochure` PDF emitted above; the two are different artefacts.

  return out as unknown as PublicProject
}

/**
 * The CARD shape — `GET /api/v1/projects`.
 *
 * `locality` is in this shape on purpose and is not an accident to be optimised
 * away: `ContactForm`'s `<select>` renders `${project.name} — ${project.locality}`.
 * This payload also feeds the catalogue, the homepage strip, the nav/footer
 * project links and the sitemap.
 */
export const toPublicProjectCard = (doc: PayloadProject): Partial<PublicProject> => {
  const out: Record<string, unknown> = {}

  out.slug = doc.slug
  out.name = doc.name
  out.category = doc.category
  out.locality = doc.locality
  out.summary = doc.summary
  out.image = toImageRef(doc.image, 'image')
  out.featured = Boolean(doc.featured)

  put(out, 'status', doc.projectStatus)
  put(out, 'tagline', doc.tagline)
  put(out, 'developer', doc.developer)

  return out as Partial<PublicProject>
}

/**
 * INCLUDE-MODE `select` objects.
 *
 * 🔴 INCLUDE MODE ONLY, NEVER EXCLUDE MODE. Exclude mode is a deny-list and
 * silently leaks every future field someone adds.
 *
 * Note this restricts what is QUERIED, not what is EMITTED — "a selected-but-
 * empty field still returns as null". The serialiser is what controls the
 * output; `select` just avoids paying for columns nobody reads.
 */
export const PUBLIC_PROJECT_CARD_SELECT = {
  slug: true,
  name: true,
  category: true,
  projectStatus: true,
  locality: true,
  developer: true,
  tagline: true,
  summary: true,
  featured: true,
  image: true,
} as const

export const PUBLIC_PROJECT_SELECT = {
  ...PUBLIC_PROJECT_CARD_SELECT,
  description: true,
  area: true,
  roadDetails: true,
  stats: true,
  highlights: true,
  amenities: true,
  approvals: true,
  locationHighlights: true,
  proximity: true,
  gallery: true,
  layoutImage: true,
  locationMap: true,
  cta: true,
  seo: true,
  // The brochure PDF. Selected so `defaultPopulate` on `documents` resolves
  // `{ filename, url, title }`; omitting it here would hand the serialiser a
  // bare id and the download link would silently never appear.
  brochure: true,
} as const
