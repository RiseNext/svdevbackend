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

  /**
   * 🔴 DEPTH 2, RAISED FROM 1 — AND THE SECOND HOP IS WHAT `videos` NEEDS.
   *
   * `projects.videos[].video` -> `videos.poster` -> `media` is TWO relation
   * hops, exactly like `site-settings.heroVideos` -> `videos.poster` ->
   * `media`, which is why that route has been on depth 2 since the hero
   * shipped. At depth 1 the poster arrives as a bare id, the serialiser cannot
   * build its URL, and an uploaded project video renders with no still frame —
   * a quiet degradation with a 200 response and nothing in any log.
   *
   * ⚠️ RAISING IT DOES NOT WIDEN THE RESPONSE, and that is not an assumption —
   * it is the same reasoning already recorded on the site-settings route and it
   * is pinned by a test here. `defaultPopulate` on every upload collection caps
   * the populated shape (`media` to the four ImageRef keys, `documents` to
   * `{filename,url,title}`, `videos` to `{filename,url,title,poster}`), and
   * `toPublicProject` emits a hand-built allow-list regardless. So `image`,
   * `gallery`, `layoutImage`, `locationMap`, `logo` and `brochure` resolve
   * exactly as before, no join fans out, and no internal field such as
   * `uploadedBy` can reach a populated relation. `maxDepth: 3` in the config
   * leaves headroom.
   *
   * A contract test asserts the full detail payload for a project WITHOUT
   * videos is byte-identical to the depth-1 response.
   */
  const doc = await publicFindOne({
    collection: 'projects',
    where: { slug: { equals: slug } },
    select: PUBLIC_PROJECT_SELECT,
    depth: 2,
  })

  if (!doc) throw notFound('That project could not be found.')

  return toPublicProject(doc as unknown as Project)
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
