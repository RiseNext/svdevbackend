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
const handler = async () => {
  const doc = await publicFindGlobal('site-settings', PUBLIC_SITE_SETTINGS_SELECT, 1)
  return toPublicSiteSettings(doc as SiteSetting)
}

export const GET = definePublicEndpoint(handler, { cache: 'public' })
export const OPTIONS = definePreflight()
