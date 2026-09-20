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
