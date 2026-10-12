import type { BlogPost } from '@/payload-types'
import { definePreflight, definePublicEndpoint } from '@/lib/definePublicEndpoint'
import { publicFindOne } from '@/lib/publicFind'
import { notFound } from '@/lib/errors'
import { SLUG_PATTERN } from '@/fields/slugField'
import { PUBLIC_BLOG_POST_SELECT, toPublicBlogPost } from '@/serializers/toPublicBlogPost'

/**
 * `GET /api/v1/blog-posts/{slug}` — the full post, including `body`.
 *
 * 🔴 DRAFT, ARCHIVED AND UNKNOWN SLUGS ALL RETURN 404, NEVER 403.
 * A 403 confirms the document exists, which would turn this endpoint into a
 * probe for unpublished editorial. `publicFindOne` applies all three defence
 * layers and cannot be called without them: the collection's `access.read`
 * constraint, `overrideAccess: false` with `user: undefined`, and a hard-coded
 * published-only `where` the caller cannot replace. `draft` is never forwarded
 * from user input, so `?draft=true` and `?where[_status][equals]=draft` are
 * inert.
 *
 * ⚠️ AN ARCHIVED POST 404s FOR A SECOND, INDEPENDENT REASON: `trash: true` on
 * the collection means Payload excludes soft-deleted rows from an ordinary
 * `find`, so the row is unreachable here even though it still exists. That is
 * the same behaviour `/projects/{slug}` has, and it is why archiving is the
 * correct way to retire a post — the URL stops resolving without the row being
 * destroyed.
 *
 * 🔴 A MALFORMED SLUG IS A 404, NOT A 422. The resource identified by a
 * nonsense path simply does not exist; returning a validation error would
 * distinguish "badly formed" from "not present" for anyone probing. Identical
 * to the project detail route.
 *
 * ⚠️ A POST WITH AN `externalUrl` IS STILL SERVED HERE, not 404'd. Its card
 * links straight out so this route is normally unreachable for such a post, but
 * the frontend renders a real page for it anyway — "an admin who adds an
 * external URL to a post that was already shared would otherwise break every
 * link already sent". Deciding that here would override a decision the frontend
 * has already made deliberately.
 */
const handler = async (req: Request, _ctx: { requestId: string }) => {
  const url = new URL(req.url)
  const slug = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')

  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw notFound('That post could not be found.')
  }

  const doc = await publicFindOne({
    collection: 'blog-posts',
    where: { slug: { equals: slug } },
    select: PUBLIC_BLOG_POST_SELECT,
    depth: 1,
  })

  if (!doc) throw notFound('That post could not be found.')

  return toPublicBlogPost(doc as unknown as BlogPost)
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
