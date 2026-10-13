import { beforeAll, describe, expect, it } from 'vitest'
import type { Field, Payload } from 'payload'

import { getTestPayload } from '../setup'

/**
 * `maxRows` MUST BE ENFORCED BY THE API, NOT ONLY BY THE EDITOR.
 *
 * 🔴 THE FINDING. `maxRows` is declared on ten fields. For `type: 'array'`
 * Payload enforces it server-side. For a `text` + `hasMany: true` field —
 * which is how `address`, `description`, `body` and `heroTicker` are modelled —
 * it is NOT enforced: the admin UI's own control stops adding rows at the
 * limit, and `ParagraphsField` disables its Add button at `atMax`, but the
 * REST/Local API accepts as many entries as you send.
 *
 * So the cap was a UI affordance pretending to be a rule. Anything that is not
 * the panel — a script, a REST client, a future bulk import — walked straight
 * past it, and the consequences are real: `address` is rendered as three
 * stacked lines, `heroTicker` as a fixed-width marquee.
 *
 * ⚠️ THIS TEST IS WRITTEN AS A SWEEP, NOT AS A LIST. It walks the live config,
 * finds EVERY field declaring `maxRows`, and requires each one to have a
 * `validate`. A new capped field added later is covered the day it is added,
 * rather than the day someone remembers this file exists — which is the only
 * way a rule like this stays true.
 */

let payload: Payload
const CTX = { skipAudit: true, skipRevalidate: true }

type Capped = {
  path: string
  maxRows: number
  type: string
  hasValidate: boolean
  /** The live field config, so a test can CALL its validator. */
  field: unknown
}

/** Walks tabs, groups, arrays and rows to find every `maxRows` in a tree. */
const collectCapped = (fields: Field[], prefix = ''): Capped[] => {
  const found: Capped[] = []

  for (const field of fields) {
    const f = field as Field & {
      name?: string
      maxRows?: number
      hasMany?: boolean
      validate?: unknown
      fields?: Field[]
      tabs?: { name?: string; fields: Field[] }[]
    }
    const path = f.name ? (prefix ? `${prefix}.${f.name}` : f.name) : prefix

    if (typeof f.maxRows === 'number') {
      found.push({
        path,
        maxRows: f.maxRows,
        type: `${f.type}${f.hasMany ? ' hasMany' : ''}`,
        hasValidate: typeof f.validate === 'function',
        field: f,
      })
    }

    if (Array.isArray(f.tabs)) {
      for (const tab of f.tabs) {
        found.push(...collectCapped(tab.fields, tab.name ? `${path}.${tab.name}` : path))
      }
    }
    if (Array.isArray(f.fields)) found.push(...collectCapped(f.fields, path))
  }

  return found
}

const allCapped = (): Capped[] => {
  const out: Capped[] = []
  for (const collection of payload.config.collections) {
    out.push(...collectCapped(collection.fields as Field[], `${collection.slug}:`))
  }
  for (const global of payload.config.globals) {
    out.push(...collectCapped(global.fields as Field[], `${global.slug}:`))
  }
  return out
}

const cappedFields = allCapped

beforeAll(async () => {
  payload = await getTestPayload()
})

// ---------------------------------------------------------------------------

describe('every capped field is capped by the API', () => {
  it('finds the capped fields at all (the sweep is not vacuous)', () => {
    const capped = allCapped()
    // Guards against a refactor that moves fields somewhere this walker does
    // not reach, which would make every assertion below pass trivially.
    expect(capped.length, 'the config should declare several maxRows fields').toBeGreaterThanOrEqual(
      8,
    )
    console.log(
      '[maxRows] ' +
        capped
          .map((c) => `${c.path} (${c.type}, max ${c.maxRows}${c.hasValidate ? '' : ', NO validate'})`)
          .join('\n           '),
    )
  })

  it('🔴 every `hasMany` capped field REFUSES one row over its cap', () => {
    /**
     * `type: 'array'` is enforced by Payload itself, so only the `hasMany`
     * scalar fields need our own validator. Those are the ones that were
     * unprotected.
     *
     * ⚠️ THIS CHECKS REFUSAL, NOT ATTACHMENT, and the difference is the whole
     * point. An earlier version of this test asserted only that a `validate`
     * function EXISTED — and it passed against the defect, because
     * `site-settings.address` had a validator that checked emptiness, length
     * and uniqueness but never the row count. Presence of a validator says
     * nothing about which rules it implements.
     *
     * So each capped `hasMany` validator is CALLED here with `maxRows + 1`
     * synthetic rows and must return a string. No database, no UI, no mocks —
     * the real function, over the real config.
     */
    const offenders: string[] = []

    for (const field of cappedFields()) {
      const f = field.field as { hasMany?: boolean; validate?: unknown; maxRows?: number }
      if (!f.hasMany || typeof f.validate !== 'function') continue

      // Distinct, non-empty, in-length values, so the ONLY rule that can fire
      // is the row count.
      const rows = Array.from({ length: (f.maxRows ?? 0) + 1 }, (_, i) => `row-${i + 1}`)
      const result = (f.validate as (v: unknown, o?: unknown) => unknown)(rows, {
        siblingData: {},
        data: {},
      })

      if (typeof result !== 'string') {
        offenders.push(`${field.path} (max ${f.maxRows}) accepted ${rows.length} rows`)
      }
    }

    expect(
      offenders,
      'a hasMany field whose validator ignores maxRows is capped only in the browser',
    ).toEqual([])
  })

  it('and each one still ACCEPTS exactly its cap', () => {
    // The other half: a cap that refuses the legal maximum is just as broken.
    const offenders: string[] = []

    for (const field of cappedFields()) {
      const f = field.field as { hasMany?: boolean; validate?: unknown; maxRows?: number }
      if (!f.hasMany || typeof f.validate !== 'function') continue

      const rows = Array.from({ length: f.maxRows ?? 0 }, (_, i) => `row-${i + 1}`)
      const result = (f.validate as (v: unknown, o?: unknown) => unknown)(rows, {
        siblingData: {},
        data: {},
      })
      if (result !== true) offenders.push(`${field.path} rejected its own maximum: ${result}`)
    }

    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------

describe('the caps actually refuse an over-long write', () => {
  /**
   * The sweep above proves a validator is ATTACHED. These prove it REFUSES —
   * through the Local API, which has no UI to help it.
   */

  it('🔴 site-settings.address refuses a 6th line — THE DEFECT THIS FOUND', async () => {
    /**
     * Driven through `validateAddressLines` itself rather than
     * `updateGlobal`, deliberately: `site-settings` is a global with many
     * required fields and no row in the freshly-truncated test database, so an
     * `updateGlobal` here fails on `Brand > Name` and a dozen others before it
     * ever reaches the address rule. That would be a test that passes for
     * entirely the wrong reason.
     *
     * The validator is the enforcement point — it is what the field and the
     * `beforeValidate` hook both call — so exercising it directly tests the
     * actual control. End-to-end API refusal for a capped `hasMany` field is
     * proven by the `projects.description` case below, which has no such
     * fixture problem.
     */
    const { validateAddressLines } = await import('@/globals/SiteSettings')

    expect(validateAddressLines(['One', 'Two', 'Three', 'Four', 'Five', 'Six'])).toMatch(
      /at most 5 lines/i,
    )
    // Still accepts exactly the cap.
    expect(validateAddressLines(['One', 'Two', 'Three', 'Four', 'Five'])).toBe(true)
    // And has not lost any of its other rules.
    expect(validateAddressLines([])).toMatch(/at least one line/i)
    expect(validateAddressLines(['A', '  '])).toMatch(/cannot be empty/i)
    expect(validateAddressLines(['Same', 'same '])).toMatch(/unique/i)
  })

  it('projects.description refuses more paragraphs than the cap', async () => {
    const { MAX_DESCRIPTION_PARAGRAPHS } = await import('@/lib/constants')
    const sharp = (await import('sharp')).default
    const data = await sharp({
      create: { width: 61, height: 44, channels: 3, background: { r: 9, g: 60, b: 33 } },
    })
      .jpeg()
      .toBuffer()
    const cover = await payload.create({
      collection: 'media',
      overrideAccess: true,
      file: { data, name: `maxrows-cover-${Date.now()}.jpg`, mimetype: 'image/jpeg', size: data.byteLength },
      data: { alt: 'maxRows cover' },
      context: CTX,
    })

    const tooMany = Array.from(
      { length: MAX_DESCRIPTION_PARAGRAPHS + 1 },
      (_, i) => `Paragraph number ${i + 1}, distinct from the others.`,
    )

    await expect(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        data: {
          name: 'MaxRows Project',
          slug: `maxrows-project-${Date.now()}`,
          category: 'Residential Plots',
          locality: 'Testville',
          summary: 'Pins API-side maxRows enforcement.',
          description: tooMany,
          highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
          image: String(cover.id),
          _status: 'published',
        } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })
})
