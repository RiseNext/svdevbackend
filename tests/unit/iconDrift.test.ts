import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ICON_NAMES, iconsNotRenderableByFrontend } from '@/lib/icons'

/**
 * THE ICON DRIFT INVARIANT — **BACKEND ⊆ FRONTEND**.
 *
 * 🔴 WHY THIS FILE EXISTS. The invariant used to be EQUALITY, and equality is
 * stricter than the risk it guards. The danger is one-directional:
 *
 *   · backend icon the frontend lacks -> the CMS can STORE a name `Icon.tsx`
 *     has no shape for, and it renders as "a silent, invisible 24px blank box.
 *     No error, no warning, no visual indication in logs." This must FAIL.
 *   · frontend icon the backend lacks -> UI-internal only. Nothing can store
 *     it, so nothing can fail to render it. This must PASS.
 *
 * The frontend's hero carousel added `play` and `pause` for its pause control.
 * Under equality those failed CI, and the only ways to satisfy it were to add
 * two meaningless options to `enum_icon_name` — a shared production enum behind
 * `projects` feature/proximity icons and `site-settings` social/ticker icons,
 * requiring a migration — or to stop running the check. Neither addresses any
 * real risk.
 *
 * ⚠️ THESE CASES EXIST SO THE RELAXATION CANNOT QUIETLY BECOME A HOLE. The
 * dangerous direction is asserted first and hardest; if someone ever "tidies"
 * this predicate into a no-op, the first four cases fail.
 */

describe('iconsNotRenderableByFrontend — the dangerous direction still FAILS', () => {
  it('flags a backend icon the frontend cannot render', () => {
    const drift = iconsNotRenderableByFrontend(['check', 'tree', 'ghostIcon'], ['check', 'tree'])
    expect(drift).toEqual(['ghostIcon'])
  })

  it('flags EVERY unrenderable backend icon, sorted deterministically', () => {
    const drift = iconsNotRenderableByFrontend(['zeta', 'check', 'alpha'], ['check'])
    expect(drift).toEqual(['alpha', 'zeta'])
  })

  it('flags the whole backend set when the frontend union is empty', () => {
    expect(iconsNotRenderableByFrontend(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('is NOT a no-op — a single missing shape is still caught', () => {
    // The guard against someone later "simplifying" this to `() => []`.
    expect(iconsNotRenderableByFrontend([...ICON_NAMES, 'notInFrontend'], [...ICON_NAMES])).toEqual([
      'notInFrontend',
    ])
  })
})

describe('iconsNotRenderableByFrontend — frontend-only UI icons are ALLOWED', () => {
  it('passes when the frontend adds `play`', () => {
    expect(iconsNotRenderableByFrontend(['check', 'tree'], ['check', 'tree', 'play'])).toEqual([])
  })

  it('passes when the frontend adds `pause`', () => {
    expect(iconsNotRenderableByFrontend(['check', 'tree'], ['check', 'tree', 'pause'])).toEqual([])
  })

  it('passes with BOTH transport controls, which is the real-world case', () => {
    expect(
      iconsNotRenderableByFrontend([...ICON_NAMES], [...ICON_NAMES, 'play', 'pause']),
    ).toEqual([])
  })

  it('passes on identical sets — the previously valid state still passes', () => {
    expect(iconsNotRenderableByFrontend([...ICON_NAMES], [...ICON_NAMES])).toEqual([])
  })

  it('passes on two empty sets', () => {
    expect(iconsNotRenderableByFrontend([], [])).toEqual([])
  })
})

describe('the invariant holds against the REAL frontend union', () => {
  /* Parses `svfrontend/src/components/ui/Icon.tsx` exactly as the drift script
     does, so this fails in the suite rather than only in CI. Skipped when the
     sibling repository is not checked out, matching the script's own behaviour. */
  const dirname = path.dirname(fileURLToPath(import.meta.url))
  const iconFile = path.resolve(dirname, '../../../svfrontend/src/components/ui/Icon.tsx')
  const present = existsSync(iconFile)

  it.skipIf(!present)('every CMS icon is renderable by the real frontend', () => {
    const source = readFileSync(iconFile, 'utf8')
    const union = source.match(/export type IconName =([\s\S]*?);/)
    expect(union, 'could not parse IconName from the frontend').toBeTruthy()

    const frontend = [...union![1]!.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]!)
    expect(iconsNotRenderableByFrontend([...ICON_NAMES], frontend)).toEqual([])
  })

  it.skipIf(!present)('`play` and `pause` are frontend-only and NOT in the CMS enum', () => {
    // Pins the decision: they are transport controls, never content icons, and
    // were deliberately NOT added to `enum_icon_name`.
    expect(ICON_NAMES).not.toContain('play')
    expect(ICON_NAMES).not.toContain('pause')

    const source = readFileSync(iconFile, 'utf8')
    const union = source.match(/export type IconName =([\s\S]*?);/)
    const frontend = [...union![1]!.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]!)
    expect(frontend).toContain('play')
    expect(frontend).toContain('pause')
  })
})
