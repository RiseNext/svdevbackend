import configPromise from '@payload-config'
import { getPayload } from 'payload'

/**
 * ADMIN CMS COVERAGE CHECK.
 *
 * Answers one question with evidence rather than assertion: **can an
 * administrator actually manage each business entity from the Admin Panel?**
 *
 * "It is in the config" is not the same as "it is reachable and editable". Three
 * things independently hide or freeze a collection, and each has been a real bug
 * in this codebase or is one keystroke away from being one:
 *
 *   1. `admin.hidden` — removed from the sidebar entirely.
 *   2. `access.read` returning false for an admin — present in the nav, empty
 *      when opened.
 *   3. `access.update` / `create` returning false — visible, read-only, with no
 *      error explaining why.
 *
 * The access functions are EXECUTED here against a synthetic active admin, not
 * merely inspected, because `isAdmin` also checks `isActive` — a field of ours,
 * not Payload's, and therefore not something the config shape can reveal.
 *
 * Run: npm run check:cms
 */

const EXPECTED = [
  'users',
  'media',
  'documents',
  'projects',
  'leads',
  'testimonials',
  'faqs',
  'statistics',
  'audit-log',
] as const

/** Entities the business is expected to manage, and what "managed" means for each. */
const INTENT: Record<string, { create: boolean; update: boolean; delete: boolean; why?: string }> = {
  // `delete: false` is DELIBERATE and is the one entity where even soft delete is
  // rejected (D-006's own exception): audit attribution must survive, so an
  // administrator is DEACTIVATED, never deleted. If this check ever fails
  // because someone set `delete: isAdmin`, that is the bug — not this line.
  users: { create: true, update: true, delete: false, why: 'deactivate, never delete' },
  media: { create: true, update: true, delete: true },
  documents: { create: true, update: true, delete: true },
  projects: { create: true, update: true, delete: true },
  // Leads are captured by the public endpoint, never typed in by an admin.
  leads: { create: false, update: true, delete: true, why: 'created by the public API only' },
  testimonials: { create: true, update: true, delete: true },
  faqs: { create: true, update: true, delete: true },
  statistics: { create: true, update: true, delete: true },
  // The audit log is written by hooks. An admin who can edit it cannot be audited.
  'audit-log': { create: false, update: false, delete: false, why: 'append-only by design' },
}

const admin = {
  id: '00000000-0000-4000-8000-000000000000',
  email: 'coverage-check@local',
  role: 'admin',
  isActive: true,
  collection: 'users',
} as never

let failures = 0
const fail = (m: string) => {
  console.error(`  FAIL  ${m}`)
  failures += 1
}
const ok = (m: string) => console.log(`  ok    ${m}`)

const run = async () => {
  const payload = await getPayload({ config: configPromise })

  console.log('\nAdmin CMS coverage\n')

  const slugs = payload.config.collections.map((c) => c.slug)

  // ---- 1. every expected collection exists ---------------------------------
  for (const slug of EXPECTED) {
    if (!slugs.includes(slug)) fail(`collection "${slug}" is missing from the config`)
  }

  // ---- 2. each is reachable and editable as intended ------------------------
  for (const collection of payload.config.collections) {
    const slug = collection.slug
    const intent = INTENT[slug]
    if (!intent) continue // payload-jobs and other framework collections

    if (collection.admin?.hidden === true) {
      fail(`${slug}: hidden from the Admin Panel`)
      continue
    }

    const evaluate = async (op: 'create' | 'read' | 'update' | 'delete') => {
      const fn = collection.access?.[op]
      if (!fn) return 'UNDECLARED'
      const result = await fn({ req: { user: admin, payload } } as never)
      return result === false ? false : true
    }

    const [create, read, update, remove] = await Promise.all([
      evaluate('create'),
      evaluate('read'),
      evaluate('update'),
      evaluate('delete'),
    ])

    for (const [op, actual] of [
      ['create', create],
      ['update', update],
      ['delete', remove],
    ] as const) {
      if (actual === 'UNDECLARED') {
        // Payload's default is Boolean(user) — ANY authenticated user, full CRUD.
        fail(`${slug}.access.${op} is UNDECLARED — Payload would default it open`)
      } else if (actual !== intent[op]) {
        fail(`${slug}.access.${op} = ${actual}, expected ${intent[op]}${intent.why ? ` (${intent.why})` : ''}`)
      }
    }

    if (read !== true) fail(`${slug}: an active admin cannot READ it`)

    const fieldCount = collection.fields.length
    const label = intent.why ? ` — ${intent.why}` : ''
    ok(
      `${slug.padEnd(13)} visible · read ✓ · create ${create ? '✓' : '✗'} · update ${update ? '✓' : '✗'} · delete ${remove ? '✓' : '✗'} · ${fieldCount} top-level fields${label}`,
    )
  }

  // ---- 3. the global -------------------------------------------------------
  for (const global of payload.config.globals) {
    const update = await global.access?.update?.({ req: { user: admin, payload } } as never)
    if (global.access?.update === undefined) {
      fail(`global ${global.slug}: access.update is UNDECLARED`)
    } else if (update === false) {
      fail(`global ${global.slug}: an active admin cannot UPDATE it`)
    } else {
      ok(`${global.slug.padEnd(13)} global · update ✓ · ${global.fields.length} top-level field group(s)`)
    }
  }

  // ---- 4. media roles on projects are all editable -------------------------
  const projects = payload.config.collections.find((c) => c.slug === 'projects')
  const flatten = (fields: unknown[]): string[] =>
    fields.flatMap((f) => {
      const field = f as { name?: string; fields?: unknown[]; tabs?: { fields: unknown[] }[] }
      if (field.tabs) return field.tabs.flatMap((t) => flatten(t.fields))
      if (field.name) return [field.name]
      if (field.fields) return flatten(field.fields)
      return []
    })
  const projectFields = projects ? flatten(projects.fields) : []

  // The four media roles that have a render site on the public website.
  const IMPLEMENTED_ROLES = ['image', 'gallery', 'layoutImage', 'locationMap']
  const missing = IMPLEMENTED_ROLES.filter((r) => !projectFields.includes(r))
  if (missing.length) {
    fail(`projects media roles not editable: ${missing.join(', ')}`)
  } else {
    ok(`project media roles: ${IMPLEMENTED_ROLES.join(', ')}`)
  }

  /**
   * `brochureImages` is DEFERRED, not missing (principle P4). The contract
   * declares it, but there are ZERO render sites in svfrontend and 0 of 5
   * projects populate it — so creating the field would let an administrator
   * upload five brochure scans and see nothing change on the website, which is
   * the worst thing a CMS field can do.
   *
   * Asserted ABSENT rather than ignored, so that adding the field forces this
   * line — and therefore the render-site question — to be revisited.
   */
  if (projectFields.includes('brochureImages')) {
    fail('projects.brochureImages now exists — is there a render site for it in svfrontend yet?')
  } else {
    ok('brochureImages: deliberately deferred (no render site) — P4')
  }

  if (failures > 0) {
    console.error(`\n${failures} coverage check(s) FAILED.\n`)
    process.exit(1)
  }
  console.log('\nAll Admin CMS coverage checks passed.\n')
  process.exit(0)
}

// Top-level await, NOT `void run()`: `payload run` exits as soon as the module
// finishes evaluating, so a floating promise produces SILENT SUCCESS — the
// script prints nothing and returns 0, which is worse than failing.
await run()
