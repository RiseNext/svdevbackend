import type { Project as PayloadProject } from '@/payload-types'
import type {
  FeatureItem,
  Project as PublicProject,
  ProximityItem,
} from '@/types/frontend-contract'
import type { ProjectVideo } from '@/types/frontend-contract-project-media'
import { coerceIcon } from '@/lib/icons'
import { cloudinaryFileUrl } from '@/media/mediaUrl'

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
 * Compose the brochure `href` DETERMINISTICALLY rather than trusting `url`.
 *
 * 🔴 THIS IS THE SAME RULE `toImageRef.ts` ALREADY FOLLOWS, AND IGNORING IT
 * PUT A 404 IN PRODUCTION. `url` on an upload collection is a VIRTUAL field:
 * the cloud-storage plugin recomputes it from `{ filename, prefix }` every time
 * the relation is populated. `documents.defaultPopulate` is
 * `{ filename, url, title }` and does NOT include `prefix`, so during population
 * `prefix` arrives `undefined`, `generateURL` composes without the folder, and
 * the emitted href becomes
 *
 *   https://res.cloudinary.com/<cloud>/raw/upload/<uuid>.pdf     -> 404
 *
 * while the asset really lives at
 *
 *   https://res.cloudinary.com/<cloud>/raw/upload/documents/<uuid>.pdf  -> 200
 *
 * The stored `documents.url` COLUMN is correct — it was written at upload time,
 * when `prefix` was in scope — which is exactly why the column and the API
 * response disagreed and the bug was invisible until a human clicked the link.
 *
 * `media` was never affected because `toImageRef` passes its prefix as a
 * LITERAL (`'media'`) and never reads the column. Passing `'documents'` the same
 * way removes the dependency entirely: `cloudinaryFileUrl` is the SAME function
 * the storage adapter's `generateURL` calls, so what Payload persists and what
 * this emits are produced by one definition and cannot drift apart.
 *
 * `filename` IS in `documents.defaultPopulate`, so this needs no query change,
 * no `defaultPopulate` change and no migration.
 *
 * The `url` fallback is retained for LOCAL DEVELOPMENT, where Cloudinary is
 * deliberately unconfigured, `cloudinaryFileUrl` returns undefined and files are
 * served from disk — mirroring `buildSrc` in toImageRef.ts.
 */
const buildDocumentHref = (doc: { filename?: unknown; url?: unknown }): string => {
  if (typeof doc.filename === 'string' && doc.filename) {
    const cdn = cloudinaryFileUrl('documents', doc.filename)
    if (cdn) return cdn
  }
  return typeof doc.url === 'string' ? doc.url.trim() : ''
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

  const href = buildDocumentHref(brochure)
  if (!href) return undefined

  const title =
    (typeof brochure.title === 'string' ? brochure.title.trim() : '') ||
    (typeof brochure.filename === 'string' ? brochure.filename.trim() : '')
  if (!title) return undefined

  return { title, href }
}

/**
 * THE PROMOTION VIDEO -> `{ youtubeUrl, duration? }`, or OMITTED.
 *
 * 🔴 `youtubeUrl` IS THE WHOLE SWITCH. A group field materialises in Postgres
 * as two nullable columns, so an untouched group arrives as
 * `{ youtubeUrl: null, duration: null }` — NOT as `undefined`. Emitting that
 * verbatim would put `promoVideo: { youtubeUrl: null }` on every one of the
 * four published projects, and the frontend's resolver would then hand a `null`
 * to `youtubeId()` on every card. Keying the whole object off a non-empty URL
 * is what keeps the no-video response byte-identical to the response this
 * endpoint returned before the field existed.
 *
 * ⚠️ `duration` IS DROPPED WHEN BLANK rather than emitted as `null`: the
 * frontend types it `duration?: string` and renders a badge for any truthy
 * value, so `null` would be a shape it never agreed to carry.
 *
 * ⚠️ NO URL VALIDATION HERE EITHER. The field stores what was pasted and
 * `youtubeId()` at the render site is the single arbiter — see the long note on
 * the field in `collections/Projects.ts`. A link this serialiser cannot read is
 * still a link the frontend might play, and silently dropping it would be a
 * video that vanishes with nothing anywhere to explain why.
 */
const promoVideoOrUndefined = (
  promoVideo: PayloadProject['promoVideo'],
): { youtubeUrl: string; duration?: string } | undefined => {
  if (!promoVideo || typeof promoVideo !== 'object') return undefined

  const youtubeUrl = typeof promoVideo.youtubeUrl === 'string' ? promoVideo.youtubeUrl.trim() : ''
  if (!youtubeUrl) return undefined

  const duration = typeof promoVideo.duration === 'string' ? promoVideo.duration.trim() : ''
  return duration ? { youtubeUrl, duration } : { youtubeUrl }
}

/**
 * THE PROJECT'S VIDEO LIST -> a DISCRIMINATED UNION, or OMITTED.
 *
 * 🔴 EVERY RULE `heroMediaOrUndefined` ESTABLISHED APPLIES HERE UNCHANGED, and
 * deliberately so — this is the same contract minus the image kind, not a new
 * one:
 *
 *   · ORDER IS PRESERVED VERBATIM. Array index IS display order. NOTHING here
 *     may sort.
 *   · PER-ENTRY BOTH-OR-NOTHING. One unresolvable row must not blank a working
 *     video section, so a bad row is dropped and the rest are emitted.
 *   · IF THAT LEAVES NOTHING, THE KEY ITSELF IS OMITTED — never `[]`, never
 *     `null`. That is what keeps a project with no videos byte-identical to the
 *     response it returned before this field existed.
 *   · IT OMITS RATHER THAN THROWS. `toImageRef` throws for a required project
 *     cover because a broken one must fail loudly; an optional video list must
 *     degrade to an absent section instead of a 500 on the project page.
 *
 * 🔴 DEDUPED PER KIND BY ITS OWN IDENTITY. The frontend keys panes by a stable
 * string, and two identical entries would collide as React keys and misbehave
 * in a way that looks like a rendering bug rather than a data one.
 */
const projectVideosOrUndefined = (
  rows: PayloadProject['videos'],
): ProjectVideo[] | undefined => {
  if (!Array.isArray(rows) || rows.length === 0) return undefined

  const out: ProjectVideo[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const title = typeof row.title === 'string' ? row.title.trim() : ''

    // ---- AN UPLOADED MP4 ----
    if (row.kind === 'video') {
      /* A bare id string means `depth` was too shallow. Never guess a URL from
         an id — that is how a silently broken video ships. */
      const doc = row.video
      if (!doc || typeof doc !== 'object') continue

      const filename = typeof doc.filename === 'string' ? doc.filename.trim() : ''
      const src =
        (filename ? cloudinaryFileUrl('videos', filename) : undefined) ??
        (typeof doc.url === 'string' ? doc.url : '')
      if (!src) continue
      if (seen.has(`video:${src}`)) continue
      seen.add(`video:${src}`)

      /* The poster is `required: true` on the `videos` collection, so a bare id
         here means the read was too shallow rather than an editorial choice.
         Unlike the hero, a missing poster does NOT drop the row: these panes
         carry native controls and a first frame, so a posterless video is still
         usable — just less pretty. The frontend types it optional for exactly
         this case. */
      let poster: string | undefined
      if (doc.poster && typeof doc.poster === 'object') {
        try {
          poster = toImageRef(doc.poster, 'videos[].poster').src || undefined
        } catch {
          poster = undefined
        }
      }

      out.push({
        kind: 'video',
        src,
        ...(poster ? { poster } : {}),
        // The row's own caption wins over the asset's internal library label.
        ...(title ? { title } : typeof doc.title === 'string' && doc.title.trim()
          ? { title: doc.title.trim() }
          : {}),
      })
      continue
    }

    // ---- A YOUTUBE LINK ----
    if (row.kind === 'youtube') {
      const youtubeUrl = typeof row.youtubeUrl === 'string' ? row.youtubeUrl.trim() : ''
      if (!youtubeUrl) continue

      /* 🔴 THE POSTER IS MANDATORY AND THE ROW IS DROPPED WITHOUT IT. The field
         validator refuses to SAVE such a row, so reaching here means the data
         predates the validator or arrived another way. A YouTube pane with no
         poster renders empty, because YouTube's own thumbnail host is
         deliberately absent from svfrontend's image allow-list. */
      if (!row.poster || typeof row.poster !== 'object') continue
      let poster: string
      try {
        poster = toImageRef(row.poster, 'videos[].poster').src
      } catch {
        continue
      }
      if (!poster) continue
      if (seen.has(`youtube:${youtubeUrl}`)) continue
      seen.add(`youtube:${youtubeUrl}`)

      const duration = typeof row.duration === 'string' ? row.duration.trim() : ''
      out.push({
        kind: 'youtube',
        // 🔴 VERBATIM, never reduced to an id — `youtubeId()` on the frontend
        // is the single arbiter and accepts every share-button form.
        youtubeUrl,
        poster,
        ...(title ? { title } : {}),
        ...(duration ? { duration } : {}),
      })
      continue
    }

    /* An unknown `kind` is dropped rather than guessed at. `select` enums are
       DB-level, so this is only reachable if the enum gained a value the
       serialiser has not been taught — which must not render as something else. */
  }

  return out.length > 0 ? out : undefined
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

  /**
   * The project's own logo — the corner plate on its homepage card.
   *
   * 🔴 IDENTICAL MECHANISM TO THE TWO LINES ABOVE, DELIBERATELY. `logo` is
   * optional, so `toImageRefOrUndefined` returns `undefined` when it is absent
   * and `put()` then OMITS THE KEY ENTIRELY. That is a contract requirement
   * rather than a stylistic one: the card does `item.logo?.src ? … : null`, and
   * `logo: null` or `logo: {}` would both be a shape the frontend never agreed
   * to. `src` comes from `cloudinaryFileUrl` inside `toImageRef` — the same
   * single definition the storage adapter's `generateURL` uses — so no URL is
   * hand-built here and the logo cannot acquire a second path convention.
   *
   * 🔶 `logo` IS NOT ON `types/frontend-contract.ts`, AND THAT IS CORRECT — DO
   * NOT "FIX" IT BY ADDING IT.
   *
   * The deployed frontend reads this field through a local widened type
   * (`Project & { logo?: ImageRef }` in `app/page.tsx`, and `logo?: ImageRef | null`
   * on `MediaSequence`'s own `Item`) and states in both places that the shared
   * contract is left alone on purpose. That file is vendored into BOTH
   * repositories and `npm run check:drift` asserts the two copies are
   * BYTE-IDENTICAL, so adding `logo` here would fail the drift gate and force a
   * matching frontend commit — for a field the frontend already consumes
   * without one. Emitting a key the contract does not declare is safe in this
   * direction: an extra property never breaks a structural type.
   *
   * ⚠️ NOT ADDED TO THE LIST ENDPOINT. `toPublicProjectCard` and
   * `PUBLIC_PROJECT_CARD_SELECT` are untouched — the homepage deck enriches each
   * card by calling `getProject()` per slug, so the DETAIL endpoint is the only
   * one that has to carry it.
   */
  put(out, 'logo', toImageRefOrUndefined(doc.logo, 'logo'))

  /**
   * The promotion video.
   *
   * 🔶 LIKE `logo`, THIS IS NOT ON `types/frontend-contract.ts`, AND THAT IS
   * CORRECT — DO NOT ADD IT. That file is a BYTE-IDENTICAL copy of the
   * frontend's `src/types/content.ts`, which deliberately carries only what the
   * backend has always emitted. The frontend declares this shape beside the
   * code that resolves it (`ProjectPromoVideo` in `src/lib/projectVideo.ts`),
   * exactly as it declares `logo?: ImageRef | null` on the card's own `Item`
   * type. Adding either here would fail the drift gate in `check:drift` and
   * force a two-repo change for a field the contract file does not model.
   *
   * ⚠️ EMITTED ON THE CARD TOO — see `toPublicProjectCard` below. This is the
   * ONE place where this field differs from `logo`, which is detail-only
   * because the homepage deck already fetches each project's detail record for
   * `gallery`. The frontend's `projectVideo()` reads BOTH records on purpose,
   * so emitting it on both removes a whole class of "we shipped it, why is
   * nothing showing".
   */
  put(out, 'promoVideo', promoVideoOrUndefined(doc.promoVideo))

  /**
   * The project's full video list — DETAIL ONLY, like `logo`.
   *
   * 🔴 DELIBERATELY NOT ON THE CARD PAYLOAD. The card renders `promoVideo` and
   * nothing else, so shipping every video row to `/projects` would send N rows
   * per project to the catalogue, the homepage deck, the nav, the footer and
   * the sitemap for no consumer — the same over-fetching argument that keeps
   * `gallery` and `logo` off the card shape. `promoVideo` is on BOTH because
   * the frontend's resolver genuinely reads both records; this is not.
   *
   * 🔶 NOT ON `types/frontend-contract.ts` EITHER — the frontend declares it in
   * `src/types/projectMedia.ts`, which svbackend vendors and byte-diffs
   * separately as `frontend-contract-project-media.ts`. Adding it to the shared
   * contract would fail the existing drift gate.
   */
  put(out, 'videos', projectVideosOrUndefined(doc.videos))

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

  /**
   * 🔴 THE ONE FIELD THE CARD CARRIES THAT `logo` DOES NOT, and the reason is
   * the frontend's, not ours: `projectVideo(slug, detail, listRecord)` asks the
   * detail record first and the list record second, because "a backend adding
   * the field need not add it to both payloads, and which one it lands in
   * should not be something this frontend has to be redeployed to find out".
   * Honouring both halves of that costs one line and one SELECT entry.
   *
   * It is the SAME helper as the detail serialiser, so the two payloads cannot
   * disagree about the shape — which is the failure `brochure` had when its
   * href was composed in two places.
   */
  put(out, 'promoVideo', promoVideoOrUndefined(doc.promoVideo))

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
  /**
   * 🔴 SELECTED ON THE CARD PAYLOAD, AND FORGETTING THIS IS THE KNOWN BUG.
   * `select` is include-mode, so a field absent from this object is never
   * QUERIED — the serialiser then reads `undefined`, omits the key, and the
   * video "silently never appears" with nothing in any log. That is precisely
   * what kept `projects.brochure` invisible in production until it was added to
   * its own select. A group needs no `depth` to resolve: it is columns on the
   * projects row, not a relation.
   */
  promoVideo: true,
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
  // Selected so `depth: 1` populates it to a real media document. Omitting it
  // here would hand the serialiser a bare id string, and `toImageRef` throws
  // `UnpopulatedUploadError` on that rather than emitting a broken image.
  logo: true,
  cta: true,
  seo: true,
  // The brochure PDF. Selected so `defaultPopulate` on `documents` resolves
  // `{ filename, url, title }`; omitting it here would hand the serialiser a
  // bare id and the download link would silently never appear.
  brochure: true,
  /**
   * The ordered video list. DETAIL ONLY — deliberately absent from
   * `PUBLIC_PROJECT_CARD_SELECT`, so the catalogue never pays for it.
   *
   * 🔴 `true` RATHER THAN A NESTED OBJECT. Selecting the whole array lets the
   * route's `depth` populate `video` and `poster` through each collection's own
   * `defaultPopulate` — which is where `videos` resolves
   * `{filename, url, title, poster}`. A hand-written nested select would have
   * to restate those and would drift from them.
   */
  videos: true,
} as const
