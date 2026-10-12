import { APIError, type CollectionConfig } from 'payload'

import { isAdmin, publishedAndConsented } from '@/access'
import { LIMITS } from '@/lib/constants'
import { auditAfterChange, auditAfterDelete } from '@/hooks/audit'
import { revalidateContent } from '@/hooks/revalidate'

/**
 * `testimonials` — Tier 2.
 *
 * 🔴 THE CONSENT GATE IS THE SINGLE MOST IMPORTANT RULE ON THIS ENTITY.
 *
 * ADMIN-CMS-SPEC §8 originally said "Publish is DISABLED until Consented is
 * ticked" — a UI control — and its own architecture header overrides that: it
 * "must be a `beforeValidate` hook, not merely a disabled button" (D-011).
 * THE HOOK WINS, and this is a contradiction resolved inside a single document.
 *
 * WHY: a disabled button is defeated by the REST API, by a script, by a bulk
 * edit, and by any future custom view. And the content it protects is the worst
 * possible thing to get wrong — the three testimonials in the repo today are
 * INVENTED PLACEHOLDERS WITH BRACKETED NAMES, and `pages.ts:10-12` calls
 * publishing them "a fabricated record". Once an admin UI exists, publishing
 * them as-is is the single easiest catastrophic mistake available.
 * MAKE IT IMPOSSIBLE, NOT DISCOURAGED.
 *
 * There are THREE layers: this hook, the DB CHECK constraint added by migration,
 * and `publishedAndConsented` on the public read path.
 */
export const Testimonials: CollectionConfig = {
  slug: 'testimonials',

  admin: {
    group: 'Content',
    useAsTitle: 'name',
    defaultColumns: ['name', 'role', 'consented', '_status', 'updatedAt'],
    description:
      'Client reviews for the homepage. A review CANNOT be published until you confirm the client actually gave it and agreed to it appearing on the website.',
    baseFilter: () => ({ deletedAt: { exists: false } }),
  },

  access: {
    read: publishedAndConsented,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    readVersions: isAdmin,
  },

  orderable: true,
  // Measured: `orderable` emits a fractional-index `_order` varchar column.
  defaultSort: '_order',
  versions: { maxPerDoc: 10, drafts: { autosave: false, validate: false } },
  trash: true,

  hooks: {
    beforeValidate: [
      ({ data, originalDoc }) => {
        const next = { ...(originalDoc ?? {}), ...(data ?? {}) }
        const publishing = next._status === 'published'
        if (publishing && next.consented !== true) {
          throw new APIError(
            'Publishing reviews that were not given by a real, consenting client is a fabricated record. Tick "consented" only if this person actually said this and agreed to it appearing on the website.',
            422,
            { errors: [{ field: 'consented', message: 'CONSENT_REQUIRED' }] },
          )
        }
        return data
      },
    ],
    afterChange: [auditAfterChange, revalidateContent('testimonials', ['/'])],
    /**
     * 🔶 `revalidateContent` ADDED HERE — a PRE-EXISTING gap, not a regression
     * from the media work (this file is unchanged since the foundation commit
     * 1cb5688, 20 Sep 2026; `git diff` on it is empty).
     *
     * 🔴 WHY IT MATTERS MOST ON THIS COLLECTION. Archiving a testimonial is
     * precisely the action that must take effect at once: the reason to remove
     * one is usually that the client WITHDREW CONSENT. Without this hook the
     * quote stayed on the live homepage until the one-hour ISR floor expired,
     * with the admin seeing it removed in the CMS and no way to tell the site
     * had not caught up. `projects` and `blog-posts` already revalidate on
     * delete; these three did not.
     */
    afterDelete: [auditAfterDelete, revalidateContent('testimonials', ['/'])],
  },

  fields: [
    { name: 'name', type: 'text', required: true, maxLength: LIMITS.testimonialName },
    {
      name: 'role',
      type: 'text',
      maxLength: LIMITS.testimonialRole,
      admin: { description: 'e.g. "Plot owner, Sri City Aler Town".' },
    },
    { name: 'body', type: 'textarea', required: true, maxLength: LIMITS.testimonialBody },
    {
      name: 'rating',
      type: 'number',
      min: 1,
      max: 5,
      // OPTIONAL, despite `types/content.ts:25` declaring it required: all three
      // existing records set 5 and `Testimonials.tsx` destructures only id, body,
      // name and role. It stays in the public shape for type compatibility.
      admin: {
        position: 'sidebar',
        description: 'Not currently displayed anywhere on the website.',
      },
    },
    {
      name: 'consented',
      type: 'checkbox',
      required: true,
      // 🔴 FALSE. The default must be the safe answer, not the convenient one.
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description:
          'Tick ONLY if this client actually gave this review and agreed to it appearing on the website. Publishing is blocked until this is ticked — at the form, at the API and at the database.',
      },
    },
  ],
}
