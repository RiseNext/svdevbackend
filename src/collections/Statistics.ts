import type { CollectionConfig } from 'payload'

import { isAdmin, publishedOrAuthenticated } from '@/access'
import { LIMITS } from '@/lib/constants'
import { auditAfterChange, auditAfterDelete } from '@/hooks/audit'
import { revalidateContent } from '@/hooks/revalidate'

/**
 * `statistics` — Tier 2. Rendered on `/` (PinnedProof) and `/about`, BOTH
 * `tablet:grid-cols-4` — so exactly four published rows, or the grid goes ragged.
 *
 * 🔴 `value` IS TEXT AND IS AUTHORED, NEVER COMPUTED (D-009).
 * The real values today are `[00]+`, `[000]+`, `[0]` and `Immediate`.
 * "Do not 'helpfully' derive them from row counts — 'Plots handed over' is not
 * something this database knows." Three of the four are bracketed placeholders
 * rendering in display type on two pages: the highest-visibility placeholder in
 * the entire build.
 */
export const Statistics: CollectionConfig = {
  slug: 'statistics',

  admin: {
    group: 'Content',
    useAsTitle: 'label',
    defaultColumns: ['label', 'value', '_status', 'updatedAt'],
    description:
      'The four-up figure strip on the homepage and the About page. The grid is exactly FOUR columns — publish four, or the row goes ragged. These figures are TYPED IN, never calculated: the database does not know how many plots have been handed over.',
    baseFilter: () => ({ deletedAt: { exists: false } }),
  },

  access: {
    read: publishedOrAuthenticated,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    readVersions: isAdmin,
  },

  orderable: true,
  // Measured: `orderable` emits a fractional-index `_order` varchar column.
  defaultSort: '_order',
  versions: { maxPerDoc: 10, drafts: { autosave: false, validate: false } },
  // DATABASE-SCHEMA.md §13 omits `deleted_at` for statistics while the uniform
  // content CRUD block gives it a DELETE (CONF-39). Be consistent: trash it.
  trash: true,

  hooks: {
    afterChange: [auditAfterChange, revalidateContent('statistics', ['/', '/about'])],
    afterDelete: [auditAfterDelete],
  },

  fields: [
    {
      name: 'label',
      type: 'text',
      required: true,
      maxLength: LIMITS.statLabel,
      unique: true,
      admin: { description: 'e.g. "Plots handed over". Must be unique.' },
    },
    {
      name: 'value',
      type: 'text',
      required: true,
      maxLength: LIMITS.statValue,
      admin: {
        description:
          'TEXT, not a number. "250+", "100%" and "Immediate" are all valid. Typed in by hand — nothing derives this from the database.',
      },
    },
  ],
}
