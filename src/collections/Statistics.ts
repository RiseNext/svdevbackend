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
    /**
     * 🔴 CORRECTED. This used to promise "The four-up figure strip on the
     * homepage and the About page" and warn to "publish four, or the row goes
     * ragged". Both bands were REMOVED from the frontend, and
     * `svfrontend/src/app/page.tsx` + `about/page.tsx` now bind `getStatistics()`
     * to an empty destructuring slot — the data is fetched and discarded. An
     * administrator who read the old text, published four rows and then went
     * looking for them on the website was misled by the panel itself.
     */
    description:
      'NOT CURRENTLY DISPLAYED ON THE WEBSITE. The figure strip that showed these was removed from the homepage and the About page, so editing anything here changes nothing a visitor can see. The records are kept, and putting a figure strip back is a developer change. These figures are TYPED IN, never calculated: the database does not know how many plots have been handed over.',
    // 🔴 NO `baseFilter` — see the long note on `projects`. Payload's own
    // `appendNonTrashedFilter` already hides archived rows from this list, and
    // a `baseFilter` additionally leaks into the Trash view as
    // `deleted_at IS NULL AND deleted_at IS NOT NULL`, emptying the bin and
    // making "Restore" unreachable. It must stay absent — and as with `faqs`,
    // `label` is UNIQUE, so an archived row keeps owning its label.
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
    // 🔶 PRE-EXISTING gap, same as `testimonials` — see the note there.
    afterDelete: [auditAfterDelete, revalidateContent('statistics', ['/', '/about'])],
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
