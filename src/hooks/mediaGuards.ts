import {
  APIError,
  type CollectionAfterChangeHook,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
} from 'payload'

/**
 * MEDIA GUARDS.
 *
 * 🔴 Payload documents NO referential integrity, NO cascade behaviour, NO soft
 * delete for files, NO orphan reporting and NO grace-period sweeper for
 * relations. All of it is ours.
 *
 * The `ON DELETE RESTRICT` foreign key that `DATABASE-SCHEMA.md` §3.21 mandates
 * is not something Payload's Postgres adapter is documented to create — and it
 * would never fire anyway, because media delete here is a SOFT delete.
 */

/** Server-assigned attribution. Field access closes the API side. */
export const stampUploadedBy: CollectionBeforeChangeHook = ({ data, req, operation }) => {
  if (operation === 'create' && req.user?.id) {
    return { ...data, uploadedBy: req.user.id }
  }
  return data
}

/**
 * On replace, the document id stays the same (so every reference survives) but a
 * NEW storage key is written, because the upload guard renames to a fresh UUID
 * on `update` as well as `create`. The OLD key is recorded here so the sweeper
 * can delete it after the grace period.
 *
 * Without this, one of two things is silently true and we cannot tell which:
 * either the old object leaks forever, or Payload eagerly deleted it and the
 * "recoverable for 30 days" promise is false.
 */
export const captureReplacedFile: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  operation,
  context,
  collection,
}) => {
  if (operation !== 'update') return doc
  if (context?.skipAudit) return doc

  const before = previousDoc?.filename as string | undefined
  const after = doc?.filename as string | undefined
  if (!before || !after || before === after) return doc

  const existing = Array.isArray(doc.supersededFilenames)
    ? (doc.supersededFilenames as string[])
    : []
  if (existing.includes(before)) return doc

  try {
    await req.payload.update({
      collection: collection.slug as 'media' | 'documents',
      id: doc.id,
      overrideAccess: true,
      req,
      data: { supersededFilenames: [...existing, before] },
      context: { skipAudit: true },
    })
  } catch (err) {
    req.payload.logger.error(
      { err, id: doc.id, before },
      'failed to record superseded filename — the old storage object may leak',
    )
  }
  return doc
}

type Usage = { label: string; names: string[] }

/**
 * 🔴 TRASHING IS A SOFT DELETE, AND A SOFT DELETE IS AN **UPDATE**. MEASURED.
 *
 * This predicate exists because `beforeDelete` is NOT the path the Admin Panel
 * takes. `@payloadcms/ui/dist/elements/DeleteDocument/index.js:86-99`:
 *
 *     const res = permanentlyDelete
 *       ? await requests.delete(url, …)
 *       : await requests.patch(url, { body: JSON.stringify({ deletedAt: … }) })
 *
 * So the ordinary Delete button on a collection with `trash: true` issues a
 * PATCH that sets `deletedAt`. That is an update, `beforeDelete` never runs,
 * and the in-use guards below were therefore bypassed by the single most
 * common way an editor removes an asset.
 *
 * ⚠️ PROVEN, NOT INFERRED. Against the local test database, with an image in
 * use as `heroMedia[0].image`:
 *     DELETE /payload-api/media/<id>                     -> 409  (guard fired)
 *     PATCH  /payload-api/media/<id> {deletedAt: "…"}    -> 200  (guard skipped)
 * and `/api/v1/site-settings` then returned TWO hero rows instead of three —
 * the slide vanished from the homepage with no error anywhere. That is exactly
 * the silent loss these guards exist to prevent.
 *
 * ⚠️ IT MUST ONLY FIRE ON THE null -> SET TRANSITION. A restore sets
 * `deletedAt` back to null, and an ordinary edit (replacing the file, fixing
 * the alt text) carries no `deletedAt` at all. Treating either as a trash
 * attempt would make a trashed asset impossible to restore and a normal save
 * impossible to perform.
 */
const isBeingTrashed = (
  data: Record<string, unknown> | undefined,
  originalDoc: Record<string, unknown> | undefined,
): boolean => {
  if (!data || !('deletedAt' in data)) return false
  const next = data.deletedAt
  if (next === null || next === undefined || next === '') return false
  // Already trashed: a second PATCH is not a new trash event.
  return !originalDoc?.deletedAt
}

/**
 * THE IN-USE CHECK FOR AN IMAGE — shared by the hard-delete and trash paths.
 *
 * 🔴 ONE IMPLEMENTATION, TWO CALLERS, DELIBERATELY. The whole defect above was
 * caused by two delete routes and one guard. Returning the usages instead of
 * throwing lets both hooks apply the identical rule, so a future reference site
 * added here is covered on both paths at once and cannot be half-covered again.
 */
const collectMediaUsages = async (
  req: Parameters<CollectionBeforeDeleteHook>[0]['req'],
  id: unknown,
): Promise<{ usages: Usage[]; publishedCover: boolean }> => {
  const usages: Usage[] = []

  const countIn = async (field: string, label: string) => {
    const res = await req.payload.find({
      collection: 'projects',
      where: { [field]: { equals: id } },
      limit: 25,
      depth: 0,
      overrideAccess: true,
      // Trashed projects still hold a reference; include them or a restore
      // would resurrect a project whose cover we deleted in the meantime.
      trash: true,
      req,
      select: { name: true, slug: true, _status: true },
    })
    if (res.totalDocs > 0) {
      usages.push({
        label,
        names: res.docs.map((d) => String((d as { name?: string }).name ?? d.id)),
      })
    }
    return res
  }

  const coverRes = await countIn('image', 'cover image')
  await countIn('gallery', 'gallery')
  await countIn('layoutImage', 'layout plan')
  await countIn('locationMap', 'location map')
  await countIn('logo', 'project logo')
  /**
   * 🔴 THE POSTER ON A PROJECT'S VIDEO LIST — ADDED WITH `projects.videos`, AND
   * ITS ABSENCE WAS A REAL SILENT-LOSS BUG.
   *
   * `toPublicProject`'s `projectVideosOrUndefined()` treats the poster as
   * MANDATORY for a `kind: 'youtube'` row and DROPS the whole row without one
   * (YouTube's own thumbnail host is deliberately not in the frontend's image
   * allow-list, so a posterless YouTube pane would render empty). The FK is
   * `ON DELETE set null`, so deleting this image did not error anywhere — the
   * row survived with a null poster, the serialiser dropped it, and the video
   * vanished from the project page with nothing in any log. That is exactly the
   * failure mode this guard exists to prevent.
   *
   * Payload queries an array sub-field by dotted path, so one `where` covers
   * every row of every project.
   */
  await countIn('videos.poster', 'project video poster')

  // ⚠️ The Join Field documents `collection` — a collection slug — so a GLOBAL
  // reference cannot be a join field and must be counted explicitly.
  try {
    const settings = await req.payload.findGlobal({
      slug: 'site-settings',
      depth: 0,
      overrideAccess: true,
      req,
    })
    const logoId = (settings as { logo?: string | { id?: string } } | null)?.logo
    const logoIdValue = typeof logoId === 'object' && logoId ? logoId.id : logoId
    if (logoIdValue && String(logoIdValue) === String(id)) {
      usages.push({ label: 'site logo', names: ['Site settings'] })
    }

    /**
     * 🔴 THE HERO MEDIA LIST — ADDED WITH `site-settings.heroMedia`, AND ITS
     * ABSENCE WAS THE SAME SILENT-LOSS BUG AS THE PROJECT POSTER ABOVE.
     *
     * A `kind: 'image'` row IS its image, and a `kind: 'youtube'` row cannot
     * render without its poster — `heroMediaOrUndefined()` drops either row
     * when the relation does not resolve. The FK is `ON DELETE set null`, so
     * deleting one of these images produced no error: the hero simply lost a
     * slide, or fell back to the legacy `heroVideos`, with nothing anywhere to
     * say why.
     *
     * ⚠️ COUNTED HERE RATHER THAN AS A JOIN FIELD for the same structural
     * reason as the site logo above: `site-settings` is a GLOBAL, and the Join
     * Field documents a COLLECTION slug.
     *
     * Both the image slot and the poster slot are checked, and the row's
     * position is reported so an admin can find it in a long list.
     */
    const heroMedia = (settings as { heroMedia?: unknown } | null)?.heroMedia
    if (Array.isArray(heroMedia)) {
      const refId = (value: unknown): string =>
        value && typeof value === 'object'
          ? String((value as { id?: unknown }).id ?? '')
          : String(value ?? '')

      const hits: string[] = []
      heroMedia.forEach((row, i) => {
        if (!row || typeof row !== 'object') return
        const r = row as { image?: unknown; poster?: unknown; title?: unknown; kind?: unknown }
        const where = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : `row ${i + 1}`
        if (refId(r.image) === String(id)) hits.push(`${where} (image)`)
        if (refId(r.poster) === String(id)) hits.push(`${where} (poster)`)
      })
      if (hits.length) usages.push({ label: 'homepage hero media', names: hits })
    }
  } catch {
    // The global may not exist yet on a fresh database. Not a reason to block.
  }

  /**
   * 🔴 A BLOG POST'S COVER. Unlike the two above, this one degrades GRACEFULLY —
   * `cover` is optional on `BlogPost` and the card falls back to a type-only
   * treatment — so losing it is not silent content loss in the same way.
   *
   * It is still counted, because the admin deleting the image is almost
   * certainly not intending to strip the illustration off a published article,
   * and an informative refusal is cheaper than noticing it later on the live
   * site. `trash: true` so an archived post still holds its claim.
   */
  try {
    const coverInPosts = await req.payload.find({
      collection: 'blog-posts',
      where: { cover: { equals: id } },
      limit: 25,
      depth: 0,
      overrideAccess: true,
      trash: true,
      req,
      select: { title: true },
    })
    if (coverInPosts.totalDocs > 0) {
      usages.push({
        label: 'blog post cover',
        names: coverInPosts.docs.map((d) => String((d as { title?: string }).title ?? d.id)),
      })
    }
  } catch {
    // The collection may not exist yet on a database migrated only partway.
  }

  /**
   * POSTER USE — counted explicitly, deliberately NOT as a join field.
   *
   * `videos.poster` is `required: true`, so a video whose poster is deleted is
   * not merely degraded: the document can no longer be saved, and the public
   * serialiser's both-or-neither rule would drop the whole `video` key. If that
   * video happens to be the active one, the website silently loses its video
   * with no error anywhere.
   *
   * A join field on `media` WOULD work here (unlike the site-logo case above,
   * `videos` is a collection) — but it is not used, on purpose: adding a field
   * to `media` changes the one collection every project image depends on, and
   * the "Used in" tab already omits the site-logo reference for the same
   * structural reason. Counting it here keeps `media` byte-identical.
   */
  const posterRes = await req.payload.find({
    collection: 'videos',
    where: { poster: { equals: id } },
    limit: 25,
    depth: 0,
    overrideAccess: true,
    trash: true,
    req,
    select: { title: true },
  })
  if (posterRes.totalDocs > 0) {
    usages.push({
      label: 'video poster',
      names: posterRes.docs.map((d) => String((d as { title?: string }).title ?? d.id)),
    })
  }

  // 🔴 A published project may NEVER end up without a cover — see above. This is
  // a hard refusal, not a warning, and `?force=true` does not override it. The
  // documented alternative (unpublish the affected projects and say so) is
  // acceptable but noisier; one behaviour is chosen and never left silent.
  const publishedCover = coverRes.docs.some(
    (d) => (d as { _status?: string })._status === 'published',
  )

  return { usages, publishedCover }
}

/** The refusal, shared by both delete paths so the wording cannot diverge. */
const throwMediaInUse = (usages: Usage[], publishedCover: boolean, verb: string): never => {
  const detail = usages
    .map((u) => `${u.label}: ${u.names.slice(0, 5).join(', ')}${u.names.length > 5 ? ', …' : ''}`)
    .join(' · ')

  if (publishedCover) {
    throw new APIError(
      `This image is the cover of a PUBLISHED project and cannot be ${verb} — the project page would fail to build. Replace the cover on that project first. In use as — ${detail}`,
      409,
    )
  }

  throw new APIError(
    `This image is still in use and was not ${verb}. Remove it from these first, then try again. In use as — ${detail}`,
    409,
  )
}

/**
 * THE IN-USE DELETE GUARD — FR-MEDIA-08. The HARD-delete path.
 *
 * WHY THIS IS NOT OPTIONAL: `image` is REQUIRED on `Project`, and
 * `ProjectDetail.tsx`, `ProjectCard.tsx` and `lib/seo.ts` all dereference
 * `project.image.*` WITHOUT GUARDS. Because `generateStaticParams` prerenders
 * every project, deleting a cover does not degrade a page — it BREAKS THE BUILD.
 *
 * ⚠️ THIS HOOK ALONE IS NOT SUFFICIENT — see `mediaTrashGuard` below. The Admin
 * Panel's ordinary Delete button never reaches it.
 */
export const mediaDeleteGuard: CollectionBeforeDeleteHook = async ({ req, id }) => {
  const { usages, publishedCover } = await collectMediaUsages(req, id)
  if (usages.length === 0) return
  throwMediaInUse(usages, publishedCover, 'deleted')
}

/**
 * THE SAME CHECK ON THE TRASH PATH — and the Admin Panel only uses this one.
 *
 * 🔴 WITHOUT THIS HOOK THE DELETE GUARD IS LARGELY DECORATIVE. The Delete
 * button issues `PATCH { deletedAt }` rather than `DELETE` (see the note on
 * `isBeingTrashed`), so every refusal `mediaDeleteGuard` makes was reachable
 * only by an admin who ticked "permanently delete" or called the REST API by
 * hand. Measured against the local database, the PATCH path returned 200 and a
 * homepage hero slide disappeared.
 *
 * ⚠️ IT REFUSES RATHER THAN SILENTLY UNTRASHING. Returning `data` with
 * `deletedAt` stripped would make the admin's click appear to succeed while
 * nothing happened — the same no-feedback failure the guard exists to remove.
 */
export const mediaTrashGuard: CollectionBeforeChangeHook = async ({
  req,
  data,
  originalDoc,
  operation,
}) => {
  if (operation !== 'update') return data
  if (!isBeingTrashed(data as Record<string, unknown>, originalDoc)) return data

  const id = (originalDoc as { id?: unknown } | undefined)?.id
  if (!id) return data

  const { usages, publishedCover } = await collectMediaUsages(req, id)
  if (usages.length === 0) return data
  throwMediaInUse(usages, publishedCover, 'moved to trash')
}

/**
 * THE ACTIVE-VIDEO DELETE GUARD.
 *
 * Same shape as the site-logo branch above and for the same structural reason:
 * `site-settings` is a GLOBAL, the Join Field documents a COLLECTION slug, so
 * this reference cannot be a join field and must be counted by an explicit
 * query.
 *
 * 🔴 WHY IT IS A HARD REFUSAL RATHER THAN A WARNING. Deleting the video that
 * `site-settings.video` points at does not produce an error anywhere: the
 * relation nulls, the serialiser's both-or-neither rule omits the `video` key,
 * and the website simply stops showing it. That is indistinguishable from "the
 * feature is broken", and the admin who did it gets no feedback at all.
 *
 * The recoverable path is offered in the message: clear the field in Site
 * Settings first, which is the intended way to take a video off the site
 * WITHOUT destroying the asset.
 */
const collectVideoUsages = async (
  req: Parameters<CollectionBeforeDeleteHook>[0]['req'],
  id: unknown,
): Promise<Usage[]> => {
  const usages: Usage[] = []

  /** A relation at depth 0 is an id string; a populated read gives an object.
   *  Normalised so the guard never depends on the caller's depth. */
  const refId = (value: unknown): string =>
    value && typeof value === 'object'
      ? String((value as { id?: unknown }).id ?? '')
      : String(value ?? '')

  try {
    const settings = await req.payload.findGlobal({
      slug: 'site-settings',
      depth: 0,
      overrideAccess: true,
      req,
    })

    // ---- 1. The legacy ordered hero list. Unchanged behaviour. ----
    const refs = (settings as { heroVideos?: unknown } | null)?.heroVideos
    const legacyIds = (Array.isArray(refs) ? refs : []).map(refId)
    if (legacyIds.some((v) => v && v === String(id))) {
      usages.push({ label: 'Hero Videos (Site Settings)', names: ['active hero video'] })
    }

    /**
     * ---- 2. THE UNIFIED HERO MEDIA LIST — THIS CHECK WAS MISSING. ----
     *
     * 🔴 A REAL SILENT-LOSS BUG, not a hypothetical. `site-settings.heroMedia`
     * introduced a SECOND place a video can be referenced from, and this guard
     * still only knew about the first. The FK is `ON DELETE set null`, so
     * deleting a video used by a `kind: 'video'` row raised nothing: the row
     * survived with a null relation, `heroMediaOrUndefined()` dropped it as
     * unresolvable, and the homepage hero quietly lost a slide — or fell back
     * to the legacy list — with no error, no warning and nothing in any log.
     *
     * That is precisely the failure this guard was written to make impossible,
     * reintroduced by a new field. The row's title is reported so an admin can
     * find it in a long list.
     */
    const heroMedia = (settings as { heroMedia?: unknown } | null)?.heroMedia
    if (Array.isArray(heroMedia)) {
      const hits: string[] = []
      heroMedia.forEach((row, i) => {
        if (!row || typeof row !== 'object') return
        const r = row as { video?: unknown; title?: unknown }
        if (refId(r.video) === String(id)) {
          hits.push(typeof r.title === 'string' && r.title.trim() ? r.title.trim() : `row ${i + 1}`)
        }
      })
      if (hits.length) usages.push({ label: 'Hero Media (Site Settings)', names: hits })
    }
  } catch (err) {
    // A genuine 409 must propagate; only a missing/unreadable global is ignored,
    // which is the fresh-database case the logo guard already tolerates.
    if (err instanceof APIError) throw err
  }

  /**
   * ---- 3. A PROJECT'S VIDEO LIST — THIS CHECK WAS MISSING TOO. ----
   *
   * Same bug, third reference site. `projects.videos[].video` is an array
   * sub-field, so Payload's dotted-path `where` covers every row of every
   * project in one query. `trash: true` because a trashed project still holds
   * its reference and restoring it must not resurrect a project whose video
   * was destroyed in the meantime — the same reasoning the cover guard
   * already applies.
   */
  try {
    const inProjects = await req.payload.find({
      collection: 'projects',
      where: { 'videos.video': { equals: id } },
      limit: 25,
      depth: 0,
      overrideAccess: true,
      trash: true,
      req,
      select: { name: true, slug: true },
    })
    if (inProjects.totalDocs > 0) {
      usages.push({
        label: 'project videos',
        names: inProjects.docs.map((d) => String((d as { name?: string }).name ?? d.id)),
      })
    }
  } catch {
    // The column may not exist on a database migrated only partway.
  }

  return usages
}

/**
 * 🔴 STILL A HARD REFUSAL RATHER THAN A WARNING, and still for the original
 * reason: nulling the relation produces no error anywhere, so the admin who did
 * it gets no feedback and the symptom is indistinguishable from "the feature is
 * broken". The recoverable path is named in the message — remove the reference
 * first, which takes the video off the site WITHOUT destroying the asset.
 */
const throwVideoInUse = (usages: Usage[], verb: string): never => {
  const detail = usages
    .map((u) => `${u.label}: ${u.names.slice(0, 5).join(', ')}${u.names.length > 5 ? ', …' : ''}`)
    .join(' · ')

  throw new APIError(
    `This video is still in use and was not ${verb} — the website would silently lose it. Remove it from these first (that takes it off the site without destroying the file), then try again. In use as — ${detail}`,
    409,
  )
}

/** The HARD-delete path. See `videoTrashGuard` for the one the admin UI uses. */
export const videoDeleteGuard: CollectionBeforeDeleteHook = async ({ req, id }) => {
  const usages = await collectVideoUsages(req, id)
  if (usages.length === 0) return
  throwVideoInUse(usages, 'deleted')
}

/**
 * THE TRASH PATH — the one the Admin Panel's Delete button actually takes.
 * See the note on `isBeingTrashed` and on `mediaTrashGuard`; without this, a
 * video in use by `heroVideos`, `heroMedia[]` or `projects.videos[]` could be
 * trashed with a 200 and the website would silently lose it.
 */
export const videoTrashGuard: CollectionBeforeChangeHook = async ({
  req,
  data,
  originalDoc,
  operation,
}) => {
  if (operation !== 'update') return data
  if (!isBeingTrashed(data as Record<string, unknown>, originalDoc)) return data

  const id = (originalDoc as { id?: unknown } | undefined)?.id
  if (!id) return data

  const usages = await collectVideoUsages(req, id)
  if (usages.length === 0) return data
  throwVideoInUse(usages, 'moved to trash')
}
