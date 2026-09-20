import type { Statistic } from '@/payload-types'
import { definePreflight, definePublicEndpoint } from '@/lib/definePublicEndpoint'
import { publicFind } from '@/lib/publicFind'
import { PUBLIC_STATISTIC_SELECT, toPublicStatistic } from '@/serializers/toPublicContent'

/**
 * `GET /api/v1/statistics` — ordered, published, `value` is TEXT.
 * Rendered on `/` and `/about`, both four-column grids.
 */
const handler = async () => {
  const result = await publicFind({
    collection: 'statistics',
    select: PUBLIC_STATISTIC_SELECT,
    sort: '_order',
    depth: 0,
  })
  return result.docs.map((doc) => toPublicStatistic(doc as Statistic))
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
