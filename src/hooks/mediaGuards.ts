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
 * THE IN-USE DELETE GUARD — FR-MEDIA-08.
 *
 * WHY THIS IS NOT OPTIONAL: `image` is REQUIRED on `Project`, and
 * `ProjectDetail.tsx:84`, `ProjectCard.tsx:19-22` and `lib/seo.ts:61-66` all
 * dereference `project.image.*` WITHOUT GUARDS. Because `generateStaticParams`
 * prerenders every project, deleting a cover does not degrade a page — it
 * BREAKS THE BUILD.
 */
export const mediaDeleteGuard: CollectionBeforeDeleteHook = async ({ req, id }) => {
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
  } catch {
    // The global may not exist yet on a fresh database. Not a reason to block.
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

  if (usages.length === 0) return

  // 🔴 A published project may NEVER end up without a cover — see above. This is
  // a hard refusal, not a warning, and `?force=true` does not override it. The
  // documented alternative (unpublish the affected projects and say so) is
  // acceptable but noisier; one behaviour is chosen and never left silent.
  const publishedCover = coverRes.docs.some((d) => (d as { _status?: string })._status === 'published')

  const detail = usages
    .map((u) => `${u.label}: ${u.names.slice(0, 5).join(', ')}${u.names.length > 5 ? ', …' : ''}`)
    .join(' · ')

  if (publishedCover) {
    throw new APIError(
      `This image is the cover of a PUBLISHED project and cannot be deleted — the project page would fail to build. Replace the cover on that project first. In use as — ${detail}`,
      409,
    )
  }

  throw new APIError(
    `This image is still in use and was not deleted. Remove it from these first, then try again. In use as — ${detail}`,
    409,
  )
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
export const videoDeleteGuard: CollectionBeforeDeleteHook = async ({ req, id }) => {
  try {
    const settings = await req.payload.findGlobal({
      slug: 'site-settings',
      depth: 0,
      overrideAccess: true,
      req,
    })
    const videoRef = (settings as { video?: string | { id?: string } } | null)?.video
    const videoId = typeof videoRef === 'object' && videoRef ? videoRef.id : videoRef
    if (videoId && String(videoId) === String(id)) {
      throw new APIError(
        'This is the site’s active video and cannot be deleted — the website would silently lose it. Clear the Video field in Site Settings first (that takes it off the site without destroying the file), then delete it here.',
        409,
      )
    }
  } catch (err) {
    // A genuine 409 must propagate; only a missing/unreadable global is ignored,
    // which is the fresh-database case the logo guard already tolerates.
    if (err instanceof APIError) throw err
  }
}
