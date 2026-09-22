import type { SiteSetting } from '@/payload-types'
import { definePreflight, definePublicEndpoint } from '@/lib/definePublicEndpoint'
import { publicFindGlobal } from '@/lib/publicFind'
import {
  PUBLIC_SITE_SETTINGS_SELECT,
  toPublicSiteSettings,
} from '@/serializers/toPublicContent'

/**
 * `GET /api/v1/site-settings`
 *
 * The one endpoint reading a global, and the one collection/global in the whole
 * system granting anonymous read.
 *
 * `[BRACKETED]` values round-trip VERBATIM. That is a contract rule, not an
 * oversight: strip the brackets and `svfrontend/src/lib/href.ts` stops rendering
 * the link inert, so a live-looking dead link ships.
 */
/**
 * 🔴 DEPTH 2, NOT 1 — AND THE DIFFERENCE IS A SILENT OUTAGE. MEASURED.
 *
 * `site-settings.video` -> `videos.poster` -> `media` is TWO relation hops, and
 * depth is what pays for the second one. Probed against a real database with
 * this exact `select`:
 *
 *   depth=1   video=OBJECT   poster=BARE_ID    <- broken
 *   depth=2   video=OBJECT   poster=OBJECT     <- correct
 *
 * At depth 1 the poster arrives as a bare id string. Payload does not throw and
 * does not warn; the serialiser's both-or-neither rule then correctly omits the
 * whole `video` key, and the visible symptom is "the admin configured a video
 * and the website never shows it" — with a 200 response and nothing in any log.
 *
 * ⚠️ RAISING IT IS SAFE, AND THAT IS NOT AN ASSUMPTION EITHER. Depth does not
 * widen what is returned: `defaultPopulate` on every upload collection pins the
 * populated shape (`media` to the four ImageRef keys, `documents` to
 * `{filename,url,title}`, `videos` to `{filename,url,title,poster}`), and the
 * serialiser emits a hand-built allow-list regardless. So `logo` and
 * `masterPlan` resolve exactly as before, no join fans out, and no internal
 * field such as `uploadedBy` can reach a populated relation. `maxDepth: 3` in
 * the config leaves headroom. A contract test asserts the no-video response is
 * unchanged.
 */
const handler = async () => {
  const doc = await publicFindGlobal('site-settings', PUBLIC_SITE_SETTINGS_SELECT, 2)
  return toPublicSiteSettings(doc as SiteSetting)
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
