import configPromise from '@payload-config'
import { getPayload } from 'payload'

/**
 * The highest-severity assertions, run against the live database.
 *
 * (1) UNPUBLISHED CONTENT MUST NOT LEAK. For SV Developers the content being
 *     protected is DTCP/RERA approval numbers and land-title claims not cleared
 *     for publication — the severity is legal, not merely technical.
 * (2) LEADS MUST NOT LEAK, in any shape, from any public route.
 */

const BASE = 'http://localhost:3001'
const line = (s: string) => console.log(s)

/**
 * 🔴 EVERY ASSERTION IS COUNTED, BECAUSE THIS SCRIPT USED TO LIE.
 *
 * It ended in `process.exit(0)` unconditionally, so a probe that printed
 * `*** FAIL ***` for a leaked RERA number still exited 0 — success, as far as
 * any caller or CI step could tell. The one script whose entire purpose is to
 * catch a legal-severity leak could not report having caught one.
 */
let failures = 0

/**
 * What this run created, recorded as it goes so the top-level `finally` can
 * remove it WITHOUT depending on where in the body execution stopped.
 */
const created: { projectId?: string | number; leadId?: string | number } = {}

/** Unique to this script, and therefore the only safe thing to sweep on. */
const CANARY_LEAD_NAME = 'CANARY-LEAD-NAME-ZZQ'
const pass = (ok: boolean) => {
  if (!ok) failures += 1
  return ok ? 'PASS' : '*** FAIL ***'
}

/**
 * 🔴 THIS SCRIPT WRITES TO WHATEVER DATABASE IT IS POINTED AT, AND
 * `svbackend/.env` POINTS AT PRODUCTION.
 *
 * It creates a draft project carrying `RERA-PENDING-DO-NOT-PUBLISH` and a
 * canary lead with a real-looking name and phone number. Run against
 * production by accident — no npm alias, so it is invoked by hand, which is
 * exactly when a stale shell is pointed at the wrong place — it injects a fake
 * commercial record into the live enquiry table and a fake project into the
 * live catalogue.
 *
 * So it refuses. Mirrors the guard in `tests/resetDb.ts` deliberately: the name
 * must say test AND the port must be the test port, because either alone is a
 * coincidence away from being wrong.
 */
const assertDisposableDatabase = (): void => {
  const url = process.env.DATABASE_URL ?? ''
  const looksDisposable = /sv_test|sv_dev/.test(url) && /:(5432|5433)\//.test(url)
  const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(url)
  if (!looksDisposable || !isLocal) {
    throw new Error(
      'REFUSING TO RUN: securityProbe creates and deletes real documents, and ' +
        'DATABASE_URL does not look like a local disposable database ' +
        '(expected sv_test or sv_dev on localhost:5432/5433). ' +
        `Got host/db from: ${url.replace(/\/\/[^@]*@/, '//***@')}`,
    )
  }
}

const run = async () => {
  assertDisposableDatabase()
  const payload = await getPayload({ config: configPromise })

  // -------------------------------------------------------------------------
  line('\n=== DRAFT LEAK ===')

  const existing = await payload.find({
    collection: 'projects',
    where: { slug: { equals: 'unapproved-rera-probe' } },
    limit: 1,
    overrideAccess: true,
    trash: true,
  })
  if (existing.docs[0]) {
    await payload.delete({
      collection: 'projects',
      id: existing.docs[0].id,
      overrideAccess: true,
      trash: false,
      context: { skipAudit: true, skipRevalidate: true },
    })
  }

  const draft = await payload.create({
    collection: 'projects',
    overrideAccess: true,
    // ⚠️ MEASURED: `draft: true` must be passed as an OPERATION ARGUMENT.
    // Putting `_status: 'draft'` in `data` alone runs FULL VALIDATION and the
    // required `image` upload rejects the create. `versions.drafts.validate:
    // false` governs the draft OPERATION, not the value of the status field.
    draft: true,
    context: { skipAudit: true, skipRevalidate: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: {
      slug: 'unapproved-rera-probe',
      name: 'UNAPPROVED RERA PROBE',
      category: 'Residential Plots',
      locality: 'Nowhere',
      summary: 'This document must never be publicly readable.',
      description: ['Secret uncleared approval claim.'],
      highlights: [{ icon: 'shield', title: 'RERA-PENDING-DO-NOT-PUBLISH' }],
      _status: 'draft',
    } as any,
  })
  created.projectId = draft.id
  line(`  created draft ${draft.id}`)

  const probes: [string, string][] = [
    ['direct slug', `${BASE}/api/v1/projects/unapproved-rera-probe`],
    ['?draft=true', `${BASE}/api/v1/projects/unapproved-rera-probe?draft=true`],
    ['?where[_status][equals]=draft', `${BASE}/api/v1/projects?where[_status][equals]=draft`],
    ['list', `${BASE}/api/v1/projects`],
  ]

  for (const [label, url] of probes) {
    const res = await fetch(url)
    const text = await res.text()
    const leaked = text.includes('RERA-PENDING-DO-NOT-PUBLISH') || text.includes('unapproved-rera-probe')
    const expected404 = label !== 'list' && label !== '?where[_status][equals]=draft'
    const statusOk = expected404 ? res.status === 404 : res.status === 200
    line(
      `  ${label.padEnd(32)} status=${res.status} ${expected404 ? '(want 404)' : '(want 200)'} leaked=${leaked}  ${pass(!leaked && statusOk)}`,
    )
    // 🔴 404, NEVER 403 — a 403 confirms the document exists.
    if (expected404 && res.status === 403) line('    *** 403 CONFIRMS EXISTENCE — MUST BE 404 ***')
  }

  // -------------------------------------------------------------------------
  line('\n=== LEAD LEAK (T-135) ===')

  const canaryName = CANARY_LEAD_NAME
  /**
   * 🔴 THE PHONE MUST BE UNIQUE TO THIS PROBE. It was `9876500011`, which
   * `tests/integration/jobs.test.ts:298` also uses — so on any database where
   * that suite had run inside the last ten minutes, `leadDedupe` refused the
   * canary create and the whole probe aborted before reaching a single lead
   * assertion. Observed exactly that: "PROBE ABORTED: DUPLICATE_LEAD".
   */
  const canaryPhone = '9000000911'

  const lead = await payload.create({
    collection: 'leads',
    overrideAccess: true,
    context: { skipAudit: true, skipNotification: true },
    data: {
      name: canaryName,
      phone: canaryPhone,
      source: 'contact_form',
      consentGiven: true,
    },
  })
  created.leadId = lead.id
  line(`  created canary lead ${lead.id}`)

  const publicRoutes = [
    '/api/v1/projects',
    '/api/v1/projects/sri-city-aler-town',
    '/api/v1/site-settings',
    '/api/v1/testimonials',
    '/api/v1/faqs',
    '/api/v1/statistics',
    '/healthz',
    '/livez',
    // Payload's OWN generated surface
    '/payload-api/leads',
    '/payload-api/leads?limit=100',
    '/payload-api/users',
    '/payload-api/audit-log',
    '/payload-api/projects/versions',
  ]

  let anyLeak = false
  for (const path of publicRoutes) {
    const res = await fetch(`${BASE}${path}`)
    const text = await res.text()
    const leaked = text.includes(canaryName) || text.includes(canaryPhone)
    if (leaked) anyLeak = true
    line(`  ${path.padEnd(42)} status=${res.status} leaked=${leaked} ${pass(!leaked)}`)
  }

  line(`\n  NO PUBLIC ROUTE RETURNS LEAD DATA: ${pass(!anyLeak)}`)

  // And through the Local API as an anonymous caller.
  try {
    const anon = await payload.find({
      collection: 'leads',
      overrideAccess: false,
      user: undefined,
      limit: 100,
    })
    line(`  anon Local API leads.find -> ${anon.totalDocs} docs ${pass(anon.totalDocs === 0)}`)
  } catch (err) {
    line(`  anon Local API leads.find -> THREW (${(err as Error).message.slice(0, 40)}) PASS`)
  }

  // 🔴 NO `process.exit` AND NO CLEANUP HERE. `process.exit` terminates the
  // process immediately and would skip the `finally` that removes the canaries
  // — which is the entire reason cleanup moved out of this function. The caller
  // owns both the cleanup and the exit code.
}

/**
 * REMOVES BOTH CANARIES, AND IS SAFE TO CALL TWICE.
 *
 * ─── 🔴 WHY THIS IS NOT TWO `payload.delete` CALLS ─────────────────────────
 *
 * It was, and NEITHER OF THEM WORKED:
 *
 *  · the project hit `blockProjectHardDelete`, which throws 403 unless
 *    `context.allowHardDelete === true` — an escape the script never passed;
 *  · the lead hit `blockLeadHardDelete`, which is `allowForced: false` and has
 *    NO escape at all, by design, because a lead is a commercial record.
 *
 * So the first call threw, the second never ran, and BOTH canaries were left
 * behind — a draft project carrying `RERA-PENDING-DO-NOT-PUBLISH` and a fake
 * enquiry sitting in the enquiry table. The script that exists to prove nothing
 * leaks was itself leaving the bait in the database.
 *
 * ⚠️ THE LEAD IS REMOVED THROUGH THE DATABASE ADAPTER, DELIBERATELY.
 * `blockLeadHardDelete` protects commercial records from an administrator;
 * there is no legitimate way to relax it, and it should not be relaxed. A probe
 * removing the canary IT created is a different act, so it goes around the
 * collection layer explicitly via `payload.db.deleteOne` rather than by adding
 * a bypass flag to the guard that something else could later use.
 *
 * Each removal is independent and best-effort: one failure must not strand the
 * other canary, which is what sequential awaits did.
 */
const cleanup = async (payload: Awaited<ReturnType<typeof getPayload>>): Promise<void> => {
  // The project guard DOES have a sanctioned escape; use it.
  if (created.projectId !== undefined) {
    try {
      await payload.delete({
        collection: 'projects',
        id: created.projectId,
        overrideAccess: true,
        trash: false,
        context: { skipAudit: true, skipRevalidate: true, allowHardDelete: true },
      })
      line('  probe project removed')
    } catch (err) {
      failures += 1
      line(`  *** FAILED to remove probe project: ${(err as Error).message.slice(0, 120)}`)
    }
  }

  if (created.leadId !== undefined) {
    try {
      await payload.db.deleteOne({
        collection: 'leads',
        where: { id: { equals: created.leadId } },
      })
      line('  canary lead removed')
    } catch (err) {
      failures += 1
      line(`  *** FAILED to remove canary lead: ${(err as Error).message.slice(0, 120)}`)
    }
  }

  /**
   * Belt and braces: an earlier aborted run may have left a canary behind.
   *
   * ⚠️ SWEPT BY NAME, NOT BY PHONE. The first version of this swept
   * `phone: 9876500011` — and that number is also used by
   * `tests/integration/jobs.test.ts`, so the sweep DELETED ANOTHER SUITE'S
   * FIXTURE. `CANARY_LEAD_NAME` is unique to this script, which makes it the
   * only safe thing to match on: a sweep must never be able to remove a row it
   * did not create.
   */
  try {
    const strays = await payload.find({
      collection: 'leads',
      where: { name: { equals: CANARY_LEAD_NAME } },
      overrideAccess: true,
      trash: true,
      limit: 50,
      depth: 0,
    })
    for (const stray of strays.docs) {
      await payload.db.deleteOne({ collection: 'leads', where: { id: { equals: stray.id } } })
    }
    if (strays.docs.length > 0) line(`  swept ${strays.docs.length} stray canary lead(s)`)
  } catch {
    // Sweeping is opportunistic; a failure here is not a probe failure.
  }
  line('')
}

/**
 * 🔴 `finally`, SO THE CANARIES COME OUT EVEN WHEN A PROBE THROWS.
 *
 * Cleanup used to be the last statements of `run()`. Any throw above it — a
 * failed `fetch` because the dev server was not up, an unexpected 500 — skipped
 * cleanup entirely and left both canaries in the database with no message
 * saying so.
 */
let aborted: Error | null = null
try {
  await run()
} catch (err) {
  aborted = err as Error
  failures += 1
} finally {
  line('\n=== CLEANUP ===')
  try {
    // `getPayload` is memoised, so this is the same instance `run()` used even
    // when `run()` threw before returning it.
    const payload = await getPayload({ config: configPromise })
    await cleanup(payload)
  } catch (err) {
    failures += 1
    line(`  *** CLEANUP ITSELF FAILED: ${(err as Error).message.slice(0, 160)}`)
    line(`  *** A CANARY MAY REMAIN. Check leads for name ${CANARY_LEAD_NAME} and`)
    line('  *** projects for slug unapproved-rera-probe, and remove them by hand.')
  }
}

if (aborted) console.error(`\n*** PROBE ABORTED: ${aborted.message}\n`)
if (failures > 0) {
  console.error(`*** ${failures} FAILURE(S) ***\n`)
  process.exit(1)
}
line('All probes passed, all canaries removed.\n')
process.exit(0)
