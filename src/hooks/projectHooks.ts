import { APIError, type CollectionBeforeChangeHook, type CollectionBeforeValidateHook } from 'payload'

/**
 * Hooks that belong to the `projects` collection specifically.
 */

/**
 * SLUG LOCK — FR-PROJ-18 / OQ-9.
 *
 * 🔴 `admin.readOnly` is documented as "without affecting the API", so a UI lock
 * is NOT A LOCK. This hook is the API-layer half; the field also carries
 * `access.update` so there are two independent barriers.
 *
 * The strictest option is chosen deliberately while OQ-9 is open, because it is
 * the only one that cannot cause irreversible loss: a changed published slug is
 * an indexed 404 plus orphaned lead attribution, and no redirect infrastructure
 * exists. Loosening later is cheap; recovering an indexed 404 is not.
 */
export const slugLock: CollectionBeforeValidateHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update') return data
  if (!originalDoc) return data

  const wasPublished = originalDoc._status === 'published' || Boolean(originalDoc.publishedAt)
  if (!wasPublished) return data

  const nextSlug = data?.slug
  if (typeof nextSlug !== 'string') return data
  if (nextSlug === originalDoc.slug) return data

  throw new APIError(
    `The web address of a published project cannot be changed. "${originalDoc.slug}" is already public: changing it would break every existing link, search-engine listing and enquiry that points at this page. Archive this project and create a new one if the address genuinely must change.`,
    422,
    // details[].code = SLUG_LOCKED, mapped by the shared error translator.
    { errors: [{ field: 'slug', message: 'SLUG_LOCKED' }] },
  )
}

/**
 * `publishedAt` — because PAYLOAD GIVES US `_status`, NOT A PUBLISH DATE.
 *
 * `IMPLEMENTATION-DECISION.md` §7 maps `published_at` to "✅ Native draft/publish".
 * That mapping is WRONG IN MECHANISM (CONF-11): drafts give a two-value string,
 * not a timestamp. We need a real one for `sitemap.xml`'s `lastModified`, and
 * there is no timestamp in the content model today to derive one from.
 *
 * Stamped on the draft -> published transition; CLEARED on unpublish, so the
 * field always means "the moment this went live", never "the moment it once did".
 */
export const stampPublishedAt: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  const becomingPublished = data?._status === 'published'
  const wasPublished = operation === 'update' && originalDoc?._status === 'published'

  if (becomingPublished && !wasPublished) {
    return { ...data, publishedAt: new Date().toISOString() }
  }
  if (!becomingPublished && wasPublished) {
    return { ...data, publishedAt: null }
  }
  return data
}
