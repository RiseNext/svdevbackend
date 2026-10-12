import type { BlogPost as PayloadBlogPost } from '@/payload-types'

import { put } from './put'
import { toImageRefOrUndefined } from './toImageRef'

/**
 * THE BLOG'S PUBLIC SHAPE — built key by key, like every serialiser here.
 *
 * 🔴 `...doc` SPREAD IS BANNED in this directory. The output is assembled one
 * key at a time so that an internal field added later causes a TEST FAILURE
 * rather than a silent leak. The strip-list for this collection:
 *   id · _status · deletedAt · createdAt · updatedAt · every array-row id
 *
 * 🔴 THE OMIT RULE: absent optional fields are OMITTED, never `null`, never
 * `''`, never `[]`. `put()` is what enforces it.
 *
 * ⚠️ THESE TYPES ARE LOCAL, NOT FROM `types/frontend-contract.ts`, AND THAT IS
 * CORRECT. That file is a BYTE-IDENTICAL copy of the frontend's
 * `src/types/content.ts`, which does not model the blog at all — the frontend
 * keeps its blog contract in a SEPARATE file (`src/types/blog.ts`) precisely so
 * "adding the blog cannot destabilise the project and site-settings reads".
 * Mirroring that separation here is what keeps the existing drift gate
 * byte-identical while still giving the blog a checked contract of its own
 * (`types/frontend-contract-blog.ts`).
 */
import type {
  BlogPost as PublicBlogPost,
  BlogPostCard as PublicBlogPostCard,
} from '@/types/frontend-contract-blog'

/**
 * `video` -> `{ youtubeUrl, duration? }`, or OMITTED.
 *
 * 🔴 KEYED OFF A NON-EMPTY URL, NOT OFF THE OBJECT. A Payload `group`
 * materialises as nullable columns, so an untouched group arrives as
 * `{ youtubeUrl: null, duration: null }` — an object, not `undefined`. Emitting
 * that would put `video: { youtubeUrl: null }` on every ARTICLE, and the
 * frontend derives a post's KIND from the presence of `video`
 * (`postKind()`) — so every article would render as a video post with a dead
 * player. This single check is what keeps articles articles.
 */
const videoOrUndefined = (
  video: PayloadBlogPost['video'],
): { youtubeUrl: string; duration?: string } | undefined => {
  if (!video || typeof video !== 'object') return undefined

  const youtubeUrl = typeof video.youtubeUrl === 'string' ? video.youtubeUrl.trim() : ''
  if (!youtubeUrl) return undefined

  const duration = typeof video.duration === 'string' ? video.duration.trim() : ''
  return duration ? { youtubeUrl, duration } : { youtubeUrl }
}

/**
 * `publishedAt` -> an ISO 8601 string the frontend can parse.
 *
 * Payload returns a `date` field as an ISO string already, but it is typed
 * `string | null` and the frontend declares `publishedAt: string` REQUIRED —
 * `formatPostDate()` returns null for anything unparseable and every caller
 * then drops the date badge. Coercing here keeps the required field required.
 *
 * ⚠️ THE FULL TIMESTAMP IS PASSED THROUGH, not truncated to a date. The
 * frontend reads it with `Date.UTC` semantics and slices the date half itself
 * for `<time dateTime>`; truncating here would throw away information it may
 * later want and buy nothing.
 */
const publishedAtOrEmpty = (value: PayloadBlogPost['publishedAt']): string =>
  typeof value === 'string' && value.trim() !== '' ? value : ''

/**
 * `body` -> `string[]`, or OMITTED.
 *
 * IDENTITY PASS-THROUGH, exactly as `projects.description` is: `text` +
 * `hasMany` round-trips as `string[]`. Empty entries are filtered because the
 * frontend maps straight to `<p>` and a blank paragraph is visible whitespace;
 * an all-empty array is omitted rather than emitted as `[]`.
 */
const bodyOrUndefined = (body: PayloadBlogPost['body']): string[] | undefined => {
  if (!Array.isArray(body)) return undefined
  const paragraphs = body.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
  return paragraphs.length > 0 ? paragraphs : undefined
}

/**
 * THE CARD SHAPE — `GET /api/v1/blog-posts`.
 *
 * 🔴 `body` IS ABSENT BY CONSTRUCTION, NOT BY FILTERING. The frontend's
 * `BlogPostCard` omits it on purpose — "the list endpoint should not ship every
 * paragraph of every post to render a grid of summaries" — and where a card
 * goes is decided by `externalUrl` alone, so the index never needs it. This
 * function simply never reads it, which is stronger than deleting it later.
 */
export const toPublicBlogPostCard = (doc: PayloadBlogPost): PublicBlogPostCard => {
  const out: Record<string, unknown> = {}

  // ---- Required on every post, whatever its kind ----
  out.slug = doc.slug
  out.title = doc.title
  out.excerpt = doc.excerpt
  out.publishedAt = publishedAtOrEmpty(doc.publishedAt)

  // ---- Optional ----
  put(out, 'topic', doc.topic)
  put(out, 'author', doc.author)
  put(out, 'cover', toImageRefOrUndefined(doc.cover, 'cover'))
  put(out, 'video', videoOrUndefined(doc.video))
  put(out, 'externalUrl', doc.externalUrl)

  return out as unknown as PublicBlogPostCard
}

/** THE FULL RECORD — `GET /api/v1/blog-posts/{slug}`. Card plus `body`. */
export const toPublicBlogPost = (doc: PayloadBlogPost): PublicBlogPost => {
  const out = toPublicBlogPostCard(doc) as Record<string, unknown>

  // The ONLY difference between the two shapes. Built on top of the card rather
  // than beside it, so the two payloads cannot disagree about a shared field.
  put(out, 'body', bodyOrUndefined(doc.body))

  return out as unknown as PublicBlogPost
}

/**
 * INCLUDE-MODE `select` objects.
 *
 * 🔴 INCLUDE MODE ONLY, NEVER EXCLUDE MODE. Exclude mode is a deny-list and
 * silently leaks every future field someone adds.
 *
 * ⚠️ A FIELD MISSING HERE IS NEVER QUERIED, so the serialiser reads `undefined`
 * and the key is omitted with nothing in any log — the exact failure that kept
 * `projects.brochure` invisible in production.
 */
export const PUBLIC_BLOG_POST_CARD_SELECT = {
  slug: true,
  title: true,
  excerpt: true,
  publishedAt: true,
  topic: true,
  author: true,
  // Selected so `depth: 1` populates it to a real media document; at depth 0 it
  // would be a bare id string and `toImageRefOrUndefined` would treat it as
  // unpopulated rather than emitting a broken image.
  cover: true,
  video: true,
  externalUrl: true,
} as const

/**
 * 🔴 THE DETAIL SELECT IS THE CARD SELECT PLUS `body`, AND THE LIST ROUTE MUST
 * NOT USE THIS ONE. Keeping them as two objects is what makes "the list does not
 * ship article bodies" a property of the QUERY, not just of the serialiser — the
 * paragraphs are never read out of Postgres for the index at all.
 */
export const PUBLIC_BLOG_POST_SELECT = {
  ...PUBLIC_BLOG_POST_CARD_SELECT,
  body: true,
} as const
