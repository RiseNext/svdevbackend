import type { CollectionConfig } from 'payload'

import { isAdmin, publishedOrAuthenticated } from '@/access'
import { LIMITS } from '@/lib/constants'
import { auditAfterChange, auditAfterDelete } from '@/hooks/audit'
import { revalidateContent } from '@/hooks/revalidate'

/**
 * `faqs` — Tier 2. Rendered on TWO pages: `/` and `/contact`.
 *
 * `Accordion.tsx:28` uses `key={item.q}`, so QUESTIONS MUST BE UNIQUE across the
 * published set — a duplicate does not error, it makes React reconcile
 * unstably on a prerendered page where no console is being watched.
 * `Accordion.tsx:18` opens item 0 by default, which is why order matters.
 */
export const Faqs: CollectionConfig = {
  slug: 'faqs',

  admin: {
    group: 'Content',
    useAsTitle: 'question',
    defaultColumns: ['question', '_status', 'updatedAt'],
    description:
      'Questions and answers shown on the homepage and the contact page. Drag to reorder — the first one is open by default.',
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
  trash: true,

  hooks: {
    afterChange: [auditAfterChange, revalidateContent('faqs', ['/', '/contact'])],
    afterDelete: [auditAfterDelete],
  },

  fields: [
    {
      name: 'question',
      type: 'text',
      required: true,
      maxLength: LIMITS.faqQuestion,
      // Collection-wide uniqueness IS correct here (unlike inside an array),
      // because each FAQ is its own document and the website renders the whole
      // published set on one page.
      unique: true,
      admin: { description: 'Must be unique — the website uses the question text as a rendering key.' },
    },
    { name: 'answer', type: 'textarea', required: true, maxLength: LIMITS.faqAnswer },
  ],
}
