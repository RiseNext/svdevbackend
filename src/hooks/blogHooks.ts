import { APIError, type CollectionBeforeValidateHook } from 'payload'

/**
 * Hooks that belong to the `blog-posts` collection specifically.
 *
 * 🔴 WHY THESE ARE NOT `projectHooks`' HOOKS WITH A DIFFERENT NOUN. Both of the
 * functions below LOOK like the project versions and neither one can be the
 * project version, for reasons that are about data rather than wording — see
 * the note on each. `projectHooks.ts` is deliberately left untouched: it guards
 * four live, indexed project URLs, and a refactor to save fifteen lines is not
 * worth putting a regression anywhere near them.
 */

/**
 * SLUG LOCK — the blog half.
 *
 * 🔴 IT TESTS `_status` ALONE, AND THE PROJECT VERSION CANNOT BE REUSED
 * BECAUSE OF IT. `slugLock` in `projectHooks.ts` treats a row as published when
 * `_status === 'published'` **OR** `publishedAt` is set, and that second clause
 * is correct there: `stampPublishedAt` writes `projects.publishedAt` only on the
 * draft -> published transition, so its presence genuinely means "this went
 * live".
 *
 * On a blog post `publishedAt` is the opposite kind of field — an EDITORIAL date
 * the author types, which exists on a post that has never been published and may
 * be set months ahead. Reusing the project hook would therefore lock the slug of
 * an unpublished draft the moment someone filled in the date box, which is
 * exactly when a slug most needs to stay editable.
 *
 * `admin.readOnly` is documented as "without affecting the API", so a UI lock is
 * not a lock; this is the API-layer half.
 */
export const blogSlugLock: CollectionBeforeValidateHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update') return data
  if (!originalDoc) return data

  // See the note above: `_status` ONLY. `publishedAt` is author-set here.
  if (originalDoc._status !== 'published') return data

  const nextSlug = data?.slug
  if (typeof nextSlug !== 'string') return data
  if (nextSlug === originalDoc.slug) return data

  throw new APIError(
    `The web address of a published post cannot be changed. "${originalDoc.slug}" is already public: changing it would break every link already shared and every search-engine listing that points at it. Unpublish and archive this post and create a new one if the address genuinely must change.`,
    422,
    // details[].code = SLUG_LOCKED, mapped by the shared error translator.
    { errors: [{ field: 'slug', message: 'SLUG_LOCKED' }] },
  )
}

/**
 * THE PUBLISH GATE — a published post must have something to show.
 *
 * 🔴 THE RULE COMES FROM THE FRONTEND CONTRACT, VERBATIM:
 * "A published post MUST carry at least one of `body`, `video` or
 * `externalUrl`. All three absent is a post with nothing to show: the card
 * would promise a destination that renders a title and no content. Enforce it
 * at the publish hook rather than hoping — the frontend cannot invent a body."
 * (`svfrontend/src/types/blog.ts`)
 *
 * 🔴 A COLLECTION HOOK, NOT A FIELD `validate`. The rule spans three fields, and
 * a field validator that reaches across siblings puts the same error on whichever
 * field happens to be validated first — so an editor sees "add a body" on a post
 * they intended to be a video. One hook, one message naming all three options.
 *
 * ⚠️ IT ONLY FIRES ON PUBLISH, AND THAT IS THE WHOLE DESIGN. `drafts.validate`
 * is `false` on this collection for the same reason it is on `projects`:
 * DRAFTS ARE SCRATCH, PUBLISH IS VALIDATED. An author must be able to save a
 * title and nothing else and come back tomorrow.
 *
 * ⚠️ `video` COUNTS ONLY WHEN IT CARRIES A URL. A Payload `group` materialises
 * as nullable columns, so an untouched video group is `{youtubeUrl: null}` —
 * present as an object, empty as content. Testing the object alone would let
 * every post publish empty.
 */
export const blogPublishGate: CollectionBeforeValidateHook = ({ data, originalDoc }) => {
  // `data` carries only the CHANGED fields on an update, so each check falls
  // back to the stored document. Reading `data` alone would reject a publish
  // that touched nothing but `_status` — which is exactly what the admin's
  // Publish button sends.
  const merged = { ...(originalDoc ?? {}), ...(data ?? {}) } as Record<string, unknown>

  if (merged._status !== 'published') return data

  const body = merged.body
  const hasBody =
    Array.isArray(body) && body.some((p) => typeof p === 'string' && p.trim() !== '')

  const video = merged.video as { youtubeUrl?: unknown } | null | undefined
  const hasVideo =
    Boolean(video) && typeof video?.youtubeUrl === 'string' && video.youtubeUrl.trim() !== ''

  const externalUrl = merged.externalUrl
  const hasExternal = typeof externalUrl === 'string' && externalUrl.trim() !== ''

  if (hasBody || hasVideo || hasExternal) return data

  throw new APIError(
    'A published post needs something to show. Add at least one of: article paragraphs, a YouTube link, or an external article URL. Without one of those, the card on /blog would promise a page that renders a title and nothing else.',
    422,
    { errors: [{ field: 'body', message: 'POST_HAS_NO_CONTENT' }] },
  )
}
