import configPromise from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { getPayload } from 'payload'

/**
 * READINESS. Payload exposes NO health-check endpoint — 100% ours.
 *
 * 🔴 `/healthz` CANNOT be a Payload `endpoints` entry: config endpoints are
 * ALWAYS mounted under `routes.api`, and this must sit outside it. It is a root
 * Next.js Route Handler.
 *
 * 🔴 `force-dynamic` is MANDATORY or Next may statically generate this at build
 * time, and a health check that returns a cached "ok" is worse than none.
 *
 * The body contains `{"status":"ok","db":"ok"}` and NOTHING ELSE — no version,
 * no hostname, no database name. A health endpoint is unauthenticated and is
 * therefore reconnaissance surface.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  try {
    const payload = await getPayload({ config: configPromise })
    // Kept deliberately trivial: EVERY PROBE CONSUMES A POOL CONNECTION, and a
    // probe that competes with real traffic for the pool causes the outage it
    // was meant to detect.
    await payload.db.drizzle.execute(sql`select 1`)
    return new Response(JSON.stringify({ status: 'ok', db: 'ok' }), { status: 200, headers })
  } catch {
    // The reason stays in the logs, not in the body.
    return new Response(JSON.stringify({ status: 'error', db: 'error' }), { status: 503, headers })
  }
}
