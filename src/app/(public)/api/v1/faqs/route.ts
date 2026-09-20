import type { Faq } from '@/payload-types'
import { definePreflight, definePublicEndpoint } from '@/lib/definePublicEndpoint'
import { publicFind } from '@/lib/publicFind'
import { PUBLIC_FAQ_SELECT, toPublicFaq } from '@/serializers/toPublicContent'

/** `GET /api/v1/faqs` — ordered, published. Rendered on `/` and `/contact`. */
const handler = async () => {
  const result = await publicFind({
    collection: 'faqs',
    select: PUBLIC_FAQ_SELECT,
    sort: '_order',
    depth: 0,
  })
  return result.docs.map((doc) => toPublicFaq(doc as Faq))
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
