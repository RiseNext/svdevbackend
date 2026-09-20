/**
 * LIVENESS — deliberately DB-FREE.
 *
 * A degraded database must NOT cause the orchestrator to kill an otherwise
 * healthy process: restarting the application does not fix Postgres, and a
 * restart loop during a database incident turns a recoverable outage into a
 * longer one. Readiness (/healthz) is what should fail in that case.
 */
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
