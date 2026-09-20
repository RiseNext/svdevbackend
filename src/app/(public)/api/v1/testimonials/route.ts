import type { Testimonial } from '@/payload-types'
import { definePreflight, definePublicEndpoint } from '@/lib/definePublicEndpoint'
import { publicFind } from '@/lib/publicFind'
import { PUBLIC_TESTIMONIAL_SELECT, toPublicTestimonial } from '@/serializers/toPublicContent'

/**
 * `GET /api/v1/testimonials` — PUBLISHED **AND** CONSENTED ONLY (FR-PUB-05).
 *
 * The consent constraint is applied in THREE independent places: the collection's
 * `beforeValidate` hook (which refuses the publish), the DB CHECK constraint
 * (which refuses the row), and the `publishedAndConsented` access function
 * (which refuses the read). Even if a row somehow reached `_status: 'published'`
 * without consent, it would not reach the website.
 */
const handler = async () => {
  const result = await publicFind({
    collection: 'testimonials',
    where: { consented: { equals: true } },
    select: PUBLIC_TESTIMONIAL_SELECT,
    sort: '_order',
    depth: 0,
  })
  return result.docs.map((doc) => toPublicTestimonial(doc as Testimonial))
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
