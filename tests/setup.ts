import { getPayload, type Payload } from 'payload'

/**
 * THE TEST HARNESS.
 *
 * 🔴 HONEST STARTING POINT: there is NO Testing page in the official Payload v3
 * documentation. `/docs/testing/overview`, `/docs/local-api/testing` and
 * `/docs/production/testing` all 404, and Vitest and Playwright are named
 * nowhere. The only testing guidance anywhere is inside the plugin-authoring
 * page, which says "Payload typically uses Jest" and then declares
 * `let payload: Payload` WITHOUT EVER SHOWING HOW IT IS INITIALISED.
 *
 * So the entire harness is our own engineering decision, recorded as an ADR and
 * not as Payload guidance. Vitest over Jest because the docs state the
 * constraint that decides it: "Payload and all of its official packages are
 * fully ESM." Vitest is ESM-native; Jest needs extra configuration against an
 * all-ESM package graph.
 *
 * What IS documented, and is all we actually need: `getPayload({ config })`
 * boots the Local API in-process, so tests never need HTTP and never need the
 * Next.js server running.
 */

let instance: Payload | null = null

export const getTestPayload = async (): Promise<Payload> => {
  if (!instance) {
    // Imported lazily so that a test which only exercises pure functions does
    // not pay for a database connection.
    const { default: config } = await import('@payload-config')
    instance = await getPayload({ config })
  }
  return instance
}

/** Base URL for the small suite that exercises real HTTP (CORS, cache, status
 *  codes). Skipped automatically when the dev server is not running. */
export const HTTP_BASE = process.env.TEST_HTTP_BASE ?? 'http://localhost:3001'

export const isHttpUp = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${HTTP_BASE}/livez`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}
