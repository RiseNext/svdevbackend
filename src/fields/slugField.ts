import type { Field, FieldHook } from 'payload'

import { LIMITS } from '@/lib/constants'

/**
 * HAND-ROLLED, deliberately.
 *
 * Payload ships a `slugField()` helper, and its own documentation describes it as
 * "experimental and may change, or even be removed". Slugs here are PUBLIC URLs:
 * they drive `/projects/[slug]`, `generateStaticParams`, the sitemap, every
 * canonical tag, and `ContactForm`'s `<option value>`. A slug that changes
 * because a helper changed is an indexed 404 and orphaned lead attribution.
 * Twenty lines of our own code is the cheaper risk.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const slugify = (input: string): string =>
  input
    .normalize('NFKD')
    // Strip combining marks so accented input reduces to plain ASCII.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug)
    // A trailing hyphen can survive the slice.
    .replace(/-+$/g, '')

/**
 * Derive from the source field when the editor has not typed one; always
 * normalise.
 *
 * Now a factory so a second collection can derive from `title` rather than
 * `name`. `formatSlug('name')` is identical to the hook this replaced.
 */
const formatSlug =
  (sourceField: string): FieldHook =>
  ({ value, data, operation }) => {
    if (typeof value === 'string' && value.trim() !== '') return slugify(value)
    // Only auto-derive on create. On update, an empty slug is an error the
    // validator should surface, not something to silently regenerate — silently
    // regenerating would change a live URL when someone clears the box.
    const source = (data as Record<string, unknown> | undefined)?.[sourceField]
    if (operation === 'create' && typeof source === 'string') return slugify(source)
    return value
  }

/**
 * `beforeDuplicate` is a FIELD hook, not a collection hook.
 *
 * A unique index on `slug` means Payload's Duplicate action would otherwise fail
 * with a raw Postgres constraint violation. Suffixing here turns that into a
 * working feature. The duplicate is also forced back to draft by the collection
 * (see `_status` handling) so a copy can never go live by accident.
 */
const suffixOnDuplicate: FieldHook = ({ value }) => {
  if (typeof value !== 'string' || value === '') return value
  return `${value}-copy`.slice(0, LIMITS.slug)
}

/**
 * Options exist ONLY so a second collection can reuse this field without
 * inheriting `projects`-specific wording.
 *
 * 🔴 EVERY OPTION DEFAULTS TO WHAT `projects` ALREADY GOT, so `slugField()`
 * with no arguments is byte-for-byte the field it was before this parameter
 * existed. That is deliberate: `projects.slug` drives live, indexed URLs and
 * `ContactForm`'s `<option value>`, and a reuse convenience is not a reason to
 * risk it. The `blog-posts` call site passes its own values.
 */
export type SlugFieldOptions = {
  /** The route the slug addresses, for the admin help text. */
  routePrefix?: string
  /** The field a slug is derived from on create. */
  sourceField?: string
  /** What the record is called, for the admin help text. */
  noun?: string
  /** An example slug, for the validation message. */
  example?: string
}

export const slugField = (options: SlugFieldOptions = {}): Field => {
  const {
    routePrefix = '/projects',
    sourceField = 'name',
    noun = 'project',
    example = 'sri-city-aler-town',
  } = options

  return {
    name: 'slug',
    type: 'text',
    required: true,
    unique: true,
    index: true,
    maxLength: LIMITS.slug,
    hooks: {
      beforeValidate: [formatSlug(sourceField)],
      beforeDuplicate: [suffixOnDuplicate],
    },
    validate: (value: unknown): true | string => {
      if (typeof value !== 'string' || value.trim() === '') return 'A slug is required.'
      if (!SLUG_PATTERN.test(value)) {
        return `Use lowercase letters, numbers and single hyphens only — for example "${example}".`
      }
      if (value.length > LIMITS.slug) return `A slug may be at most ${LIMITS.slug} characters.`
      return true
    },
    admin: {
      position: 'sidebar',
      description: `The public web address for this ${noun}: ${routePrefix}/<slug>. Generated from the ${sourceField}. LOCKED once the ${noun} has been published — changing it would break every link and search-engine listing that already points here.`,
    },
  }
}
