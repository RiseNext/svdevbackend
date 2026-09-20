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
const pass = (ok: boolean) => (ok ? 'PASS' : '*** FAIL ***')

const run = async () => {
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

  const canaryName = 'CANARY-LEAD-NAME-ZZQ'
  const canaryPhone = '9876500011'

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

  // -------------------------------------------------------------------------
  line('\n=== CLEANUP ===')
  await payload.delete({
    collection: 'projects',
    id: draft.id,
    overrideAccess: true,
    trash: false,
    context: { skipAudit: true, skipRevalidate: true },
  })
  await payload.delete({
    collection: 'leads',
    id: lead.id,
    overrideAccess: true,
    trash: false,
    context: { skipAudit: true },
  })
  line('  probe documents removed\n')

  process.exit(0)
}

await run()
