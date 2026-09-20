import type { Project } from '@/payload-types'
import { definePreflight, definePublicEndpoint } from '@/lib/definePublicEndpoint'
import { publicFind } from '@/lib/publicFind'
import type { Where } from 'payload'
import { PROJECT_CATEGORIES } from '@/lib/constants'
import { validationError } from '@/lib/errors'
import { PUBLIC_PROJECT_CARD_SELECT, toPublicProjectCard } from '@/serializers/toPublicProject'

/**
 * `GET /api/v1/projects` — the catalogue, in ADMIN ORDER.
 *
 * Feeds the catalogue page, the homepage strip, the nav and footer project links
 * (which are DERIVED from this — `site.ts` hardcodes five slugs today and
 * `README.md:42`'s claim that they update automatically is verified FALSE), the
 * sitemap, and `ContactForm`'s `<select>`.
 *
 * NO PAGINATION, NO SEARCH, NO SORT PARAMETER. FR-PUB-12: there are five
 * records and the catalogue filters them CLIENT-SIDE. Adding pagination to an
 * endpoint with no paginating consumer is scope with no requirement.
 *
 * `sort: '_order'` is the measured fractional-index column that `orderable: true`
 * creates. Admin drag order IS public order.
 */

const handler = async (req: Request) => {
  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const featured = url.searchParams.get('featured')

  // An unknown category is a client error, not an empty list: silently returning
  // nothing would look like "we have no villa plots".
  if (category !== null && !(PROJECT_CATEGORIES as readonly string[]).includes(category)) {
    throw validationError([
      {
        field: 'category',
        code: 'INVALID_ENUM',
        message: `Unknown category. Expected one of: ${PROJECT_CATEGORIES.join(', ')}.`,
      },
    ])
  }

  const filters: Where[] = []
  if (category) filters.push({ category: { equals: category } })
  if (featured === 'true') filters.push({ featured: { equals: true } })
  if (featured === 'false') filters.push({ featured: { equals: false } })

  const result = await publicFind({
    collection: 'projects',
    ...(filters.length ? { where: { and: filters } } : {}),
    select: PUBLIC_PROJECT_CARD_SELECT,
    // The measured `orderable` column. Fractional-index keys sort correctly as
    // plain lexicographic strings — that is the whole point of the scheme.
    sort: '_order',
    // Pinned explicitly: at depth 0 `image` is a bare id string and the
    // serialiser would throw rather than silently emit a broken image.
    depth: 1,
    limit: 200,
  })

  return result.docs.map((doc) => toPublicProjectCard(doc as Project))
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
