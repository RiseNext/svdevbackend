import type { Project } from '@/payload-types'
import { definePreflight, definePublicEndpoint } from '@/lib/definePublicEndpoint'
import { publicFindOne } from '@/lib/publicFind'
import { notFound } from '@/lib/errors'
import { SLUG_PATTERN } from '@/fields/slugField'
import { PUBLIC_PROJECT_SELECT, toPublicProject } from '@/serializers/toPublicProject'

/**
 * `GET /api/v1/projects/{slug}` — the full record.
 *
 * 🔴 UNPUBLISHED AND ARCHIVED CONTENT RETURNS 404, NEVER 403.
 * A 403 confirms the document exists. For SV Developers the content being
 * protected is DTCP/RERA approval numbers and land-title claims not yet cleared
 * for publication — the severity of a leak is legal, not merely technical.
 *
 * `publicFindOne` applies all three defence layers and cannot be called without
 * them. `draft` is never forwarded from user input, so `?draft=true` and
 * `?where[_status][equals]=draft` are inert.
 */

const handler = async (req: Request, _ctx: { requestId: string }) => {
  const url = new URL(req.url)
  const slug = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')

  // A malformed slug is a 404, not a 422: the resource identified by a
  // nonsense path simply does not exist, and returning a validation error would
  // distinguish "badly formed" from "not present" for an attacker probing.
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw notFound('That project could not be found.')
  }

  const doc = await publicFindOne({
    collection: 'projects',
    where: { slug: { equals: slug } },
    select: PUBLIC_PROJECT_SELECT,
    depth: 1,
  })

  if (!doc) throw notFound('That project could not be found.')

  return toPublicProject(doc as unknown as Project)
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
