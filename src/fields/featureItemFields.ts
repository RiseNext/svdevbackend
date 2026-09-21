import type { ArrayField, Field } from 'payload'

import { LIMITS, MAX_ARRAY_ROWS } from '@/lib/constants'

import { iconField } from './iconField'

/**
 * `FeatureItem` — `{ icon, title, body? }`. Shared by the four feature arrays
 * (`highlights`, `amenities`, `approvals`, `locationHighlights`).
 *
 * `body` is optional and NOT ONE of the 96 project feature items in the repo
 * uses it. It stays optional because the shared frontend type declares it and
 * `pages.ts` lists do use it.
 */
export const featureItemFields = (): Field[] => [
  iconField(),
  {
    name: 'title',
    type: 'text',
    required: true,
    maxLength: LIMITS.featureTitle,
  },
  {
    name: 'body',
    type: 'textarea',
    maxLength: LIMITS.featureBody,
    admin: { description: 'Optional. Most brochure highlights are one line.' },
  },
]

/**
 * Uniqueness validator for a repeatable list whose rows supply a React key.
 *
 * 🔴 WHY THIS EXISTS AND WHY IT IS NOT `unique: true`:
 * The docs are unambiguous that `unique` on a field nested inside an array
 * "creates a COLLECTION-WIDE unique index on the dotted path … it prevents ANY
 * TWO DOCUMENTS from having the same value at that path." A well-meaning
 * `unique` on `proximity.place` would mean the second project that mentions the
 * same landmark CANNOT BE SAVED. Per-document uniqueness is a custom `validate`
 * on the array field, which is what the docs themselves prescribe.
 *
 * 🔴 WHY UNIQUENESS MATTERS AT ALL: the frontend renders these with
 * `key={item.title}` / `key={item.place}` / `key={stat.label}`. A duplicate does
 * not error — React logs to a console nobody is watching on a prerendered page
 * and reconciles unstably.
 */
export const uniqueByKey =
  (key: string, label: string) =>
  (value: unknown): true | string => {
    if (!Array.isArray(value)) return true
    const seen = new Set<string>()
    for (const row of value) {
      const raw = (row as Record<string, unknown> | null)?.[key]
      if (typeof raw !== 'string') continue
      const normalised = raw.trim().toLowerCase()
      if (!normalised) continue
      if (seen.has(normalised)) {
        return `Each ${label} must be unique — "${raw.trim()}" appears more than once. The website uses this text as a rendering key.`
      }
      seen.add(normalised)
    }
    return true
  }

/** A `FeatureItem[]` array field with the shared shape, limits and guards. */
export const featureArray = (args: {
  name: string
  dbName: string
  label: string
  required?: boolean
  minRows?: number
  description?: string
}): ArrayField =>
  ({
    name: args.name,
    type: 'array',
    label: args.label,
    // Postgres identifiers cap at 63 bytes and Payload's derivation is
    // undocumented — set dbName EXPLICITLY on every array field.
    dbName: args.dbName,
    maxRows: MAX_ARRAY_ROWS,
    ...(args.required ? { required: true } : {}),
    ...(args.minRows ? { minRows: args.minRows } : {}),
    fields: featureItemFields(),
    validate: uniqueByKey('title', 'title'),
    admin: {
      // 🔴 FALSE, DELIBERATELY — this is the "Add Highlight makes a blank row"
      // bug. `ADD_ROW` in Payload's field reducer creates the row WITHOUT a
      // `collapsed` flag; `isRowCollapsed()` then falls through to
      // `field.admin.initCollapsed` whenever the editor has no saved collapse
      // preference for this array yet — which is ALWAYS the case on a brand-new
      // Create form. So `true` meant every freshly added row came back
      // COLLAPSED, showing only "Item 01" and hiding all of its inputs.
      //
      // The row label components still earn their keep on a SAVED document with
      // many rows; the editor can collapse rows themselves, and that preference
      // is remembered. What must not happen is a row arriving collapsed at the
      // moment it is created, because there is nothing in it to label yet.
      initCollapsed: false,
      components: {
        RowLabel: '@/components/admin/FeatureRowLabel#FeatureRowLabel',
      },
      ...(args.description ? { description: args.description } : {}),
    },
  }) as ArrayField
