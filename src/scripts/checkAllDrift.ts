import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ICON_NAMES, iconsNotRenderableByFrontend } from '@/lib/icons'
import { ENV_KEYS } from '@/schemas/env'

/**
 * THREE CI GUARDS AGAINST SILENT DRIFT.
 *
 * Each protects a fact that lives in ANOTHER FILE — in two cases, in another
 * REPOSITORY — where nothing else would catch a change.
 *
 *   1. THE ICON ENUM. Every icon `src/lib/icons.ts` can store MUST exist in the
 *      frontend's `IconName` union — BACKEND ⊆ FRONTEND. Drift means the CMS
 *      offers an icon the site cannot render, and the failure mode is the worst
 *      in the codebase: "a silent, invisible 24px blank box. No error, no
 *      warning, no visual indication in logs."
 *      ⚠️ The converse is NOT drift: the frontend may carry UI-internal icons
 *      (the hero carousel's `play`/`pause` transport controls) that the CMS
 *      never offers and cannot store. See `iconsNotRenderableByFrontend`.
 *
 *   2. THE PUBLIC CONTRACT. `src/types/frontend-contract.ts` is a BYTE-IDENTICAL
 *      copy of `svfrontend/src/types/content.ts`. Payload has no built-in
 *      cross-app type sharing, so without this a contract change fails the build
 *      in the OTHER repository — or worse, does not fail at all and ships a
 *      response the frontend cannot type.
 *
 *   3. `.env.example` vs THE SCHEMA. Without this the example rots within two
 *      sprints and the next developer's first day is spent guessing.
 *
 * Run: npm run check:drift
 */

const dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(dirname, '../..')
const FRONTEND = path.resolve(ROOT, '../svfrontend')

let failures = 0
const fail = (message: string) => {
  console.error(`  FAIL  ${message}`)
  failures += 1
}
const pass = (message: string) => console.log(`  ok    ${message}`)

// ---------------------------------------------------------------- 1. icons
const checkIcons = () => {
  const iconFile = path.join(FRONTEND, 'src/components/ui/Icon.tsx')
  if (!existsSync(iconFile)) {
    console.log('  skip  icon drift — svfrontend not present beside svbackend')
    return
  }

  const source = readFileSync(iconFile, 'utf8')
  const union = source.match(/export type IconName =([\s\S]*?);/)
  if (!union) return fail('could not parse IconName from the frontend Icon.tsx')

  const frontend = [...union[1]!.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]!).sort()
  const backend = [...ICON_NAMES].sort()

  // BACKEND ⊆ FRONTEND. Only the dangerous direction fails — see
  // `iconsNotRenderableByFrontend` for why this is asymmetric.
  const unrenderable = iconsNotRenderableByFrontend(backend, frontend)

  if (unrenderable.length) {
    return fail(
      `icon enum drift — the CMS can store [${unrenderable.join(', ')}], which the frontend cannot render (they would appear as invisible blank boxes). Add the shape to svfrontend's Icon.tsx, or remove the name from ICON_NAMES.`,
    )
  }

  const frontendOnly = frontend.filter((n) => !backend.includes(n as never))
  pass(
    `icon enum: ${backend.length} CMS values, all renderable by the frontend` +
      (frontendOnly.length
        ? ` (+${frontendOnly.length} frontend-only UI icon(s): ${frontendOnly.join(', ')})`
        : ''),
  )
}

// ------------------------------------------------------------- 2. contract
const checkContract = () => {
  const frontendFile = path.join(FRONTEND, 'src/types/content.ts')
  const vendored = path.join(ROOT, 'src/types/frontend-contract.ts')

  if (!existsSync(frontendFile)) {
    console.log('  skip  contract drift — svfrontend not present beside svbackend')
    return
  }
  if (!existsSync(vendored)) return fail('src/types/frontend-contract.ts is missing')

  const a = readFileSync(frontendFile)
  const b = readFileSync(vendored)

  if (!a.equals(b)) {
    return fail(
      'the vendored contract has DRIFTED from svfrontend/src/types/content.ts. ' +
        'Re-copy it and re-run the contract tests — do NOT edit the frontend file to match.',
    )
  }
  pass(`public contract: byte-identical (${a.length} bytes)`)
}

// ------------------------------------------------------------------ 3. env
const checkEnvExample = () => {
  const example = path.join(ROOT, '.env.example')
  if (!existsSync(example)) return fail('.env.example is missing')

  const declared = new Set(
    readFileSync(example, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('=')[0]!.trim()),
  )

  // PAYLOAD_CONFIG_PATH lives in the npm script, not in .env — it is a path,
  // not a secret, and the docs' own example sets it inline.
  const schemaKeys = ENV_KEYS.filter((k) => k !== 'NODE_ENV')

  const missing = schemaKeys.filter((k) => !declared.has(k))
  const orphaned = [...declared].filter(
    (k) => !(ENV_KEYS as readonly string[]).includes(k) && k !== 'NODE_ENV',
  )

  if (missing.length) fail(`.env.example is missing: ${missing.join(', ')}`)
  if (orphaned.length) fail(`.env.example declares unknown keys: ${orphaned.join(', ')}`)
  if (!missing.length && !orphaned.length) {
    pass(`.env.example: ${schemaKeys.length} keys, in sync with the schema`)
  }
}

console.log('\nDrift checks\n')
checkIcons()
checkContract()
checkEnvExample()

if (failures > 0) {
  console.error(`\n${failures} drift check(s) FAILED.\n`)
  process.exit(1)
}
console.log('\nAll drift checks passed.\n')
process.exit(0)
