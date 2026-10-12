import type { BlogPost } from '@/payload-types'
import { definePreflight, definePublicEndpoint } from '@/lib/definePublicEndpoint'
import { publicFind } from '@/lib/publicFind'
import {
  PUBLIC_BLOG_POST_CARD_SELECT,
  toPublicBlogPostCard,
} from '@/serializers/toPublicBlogPost'

/**
 * `GET /api/v1/blog-posts` — every published post, NEWEST FIRST, in card shape.
 *
 * Feeds `/blog` and `generateStaticParams` for `/blog/[slug]`.
 *
 * 🔴 `sort: '-publishedAt'`, AND THE FRONTEND DEPENDS ON IT. The index does NOT
 * sort: it "takes the first row as the feature card and renders the rest in the
 * order given". So this `sort` IS the editorial order of the page, including
 * which post gets the large feature treatment. `publishedAt` is author-set and
 * indexed on the collection for exactly this query.
 *
 * 🔴 NO `body` IN THIS RESPONSE, enforced by the QUERY and not merely by the
 * serialiser — `PUBLIC_BLOG_POST_CARD_SELECT` omits it, so the paragraphs are
 * never read out of Postgres at all. The frontend's `BlogPostCard` excludes it
 * on purpose: shipping every paragraph of every post to render a grid of
 * summaries is the over-fetch `ProjectCard` already argues against.
 *
 * 🔴 AN EMPTY COLLECTION IS `200 { "data": [] }`, NEVER 404. The frontend sets
 * `fallback: []` on this call, so a 404 would be indistinguishable from "no
 * posts yet" — but it would also be indistinguishable from a genuine outage,
 * and the fallback exists to stop a 404 failing the whole production build. A
 * published-but-empty blog is a normal state and says so with a 200.
 *
 * NO PAGINATION, NO SEARCH, NO SORT PARAMETER — the same call as `/projects`:
 * the index filters client-side by kind, and adding pagination to an endpoint
 * with no paginating consumer is scope with no requirement.
 */
const handler = async () => {
  const result = await publicFind({
    collection: 'blog-posts',
    select: PUBLIC_BLOG_POST_CARD_SELECT,
    sort: '-publishedAt',
    // Pinned explicitly: at depth 0 `cover` is a bare id string and the
    // serialiser would omit the image rather than emit it.
    depth: 1,
    limit: 200,
  })

  return result.docs.map((doc) => toPublicBlogPostCard(doc as BlogPost))
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
