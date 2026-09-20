import type { CollectionConfig } from 'payload'

import { isAdmin, nobody, serverOnlyField } from '@/access'
import { LEAD_SOURCES, LIMITS, MAX_PHONE_DIGITS, MIN_PHONE_DIGITS } from '@/lib/constants'
import { auditAfterChange, auditAfterDelete } from '@/hooks/audit'
import {
  derivePhoneNormalised,
  digitsOnly,
  enqueueLeadNotification,
  isJunkPhone,
  leadDedupe,
  normaliseText,
  stripHtml,
} from '@/hooks/leadHooks'

/**
 * `leads` — THE ONLY FEATURE THAT GENUINELY REQUIRES A BACKEND.
 *
 * PRD §1 problem 2, verbatim: "Every enquiry typed into that form today is lost."
 * `ContactForm.tsx:45-50` does not even fake a success — it tells the visitor
 * nothing was sent, on the stated principle that "a visitor told 'we'll call you
 * back' when nothing was sent is worse off than one who sees no form at all."
 * Everything here exists to keep that honesty while making the outcome true.
 *
 * 🔴 FR-LEAD-15: NEVER exposed on any public endpoint. Ever. Four independent
 * facts make that true, and each is testable:
 *   1. `access.read: isAdmin` — Payload's GENERATED REST route returns nothing
 *      anonymously.
 *   2. GraphQL is disabled entirely, so there is no second shape.
 *   3. NO PUBLIC SERIALISER FOR LEADS EXISTS. There is no `toPublicLead()`
 *      anywhere, and `publicFind()` is TYPED to the collections it may read —
 *      `leads` is not one of them, so a public handler cannot even name it.
 *   4. The edge blocks `/payload-api/leads` from the public internet.
 */
export const Leads: CollectionConfig = {
  slug: 'leads',

  admin: {
    group: 'Enquiries',
    useAsTitle: 'name',
    defaultColumns: ['name', 'phone', 'projectNameSnapshot', 'source', 'createdAt'],
    description:
      'Enquiries from the website contact form. A lead is a COMMERCIAL RECORD — archive it, never delete it.',
    baseFilter: () => ({ deletedAt: { exists: false } }),
    pagination: { defaultLimit: 50 },
  },

  access: {
    // 🔴 The public endpoint calls `payload.create({ overrideAccess: true })` —
    // the ONE sanctioned use of that flag in the entire codebase. Everything
    // else that needs it is a hook or a seed script, not a request path.
    create: nobody,
    read: isAdmin,
    update: isAdmin,
    // Granted, but the admin UI never offers it: trash only.
    delete: isAdmin,
  },

  // Versioning an operational PII table MULTIPLIES PII COPIES. A lead has no
  // editorial lifecycle, so there is nothing a version would be useful for.
  versions: false,
  // Soft only, forever. FR-LEAD-14.
  trash: true,
  disableBulkDelete: true,
  disableBulkEdit: true,
  disableDuplicate: true,
  defaultSort: '-createdAt',

  indexes: [
    // Supports the windowed dedupe query. DELIBERATELY NOT UNIQUE: one buyer may
    // legitimately enquire about several projects, and a hard unique constraint
    // would reject real leads.
    { fields: ['phoneNormalised', 'projectSlug'] },
  ],

  hooks: {
    beforeValidate: [derivePhoneNormalised, leadDedupe],
    afterChange: [enqueueLeadNotification, auditAfterChange],
    afterDelete: [auditAfterDelete],
  },

  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      maxLength: LIMITS.leadName,
      hooks: { beforeValidate: [normaliseText] },
      validate: (value: unknown): true | string => {
        if (typeof value !== 'string' || value.trim() === '') return 'A name is required.'
        if (value.length > LIMITS.leadName) return `At most ${LIMITS.leadName} characters.`
        // Reject punctuation- or digits-only. A name must contain a letter in
        // some script — \p{L} covers Telugu and Devanagari as well as Latin.
        if (!/\p{L}/u.test(value)) return 'That does not look like a name.'
        return true
      },
    },
    {
      name: 'phone',
      type: 'text',
      required: true,
      // 🔴 STORED VERBATIM, EXACTLY AS SUBMITTED. This is what a salesperson
      // dials. `phoneNormalised` is the machine-readable sibling.
      admin: { description: 'As the visitor typed it.' },
      validate: (value: unknown): true | string => {
        if (typeof value !== 'string' || value.trim() === '') return 'A phone number is required.'
        const d = digitsOnly(value)
        if (d.length < MIN_PHONE_DIGITS) return 'That number looks incomplete.'
        if (d.length > MAX_PHONE_DIGITS) return 'That number is too long.'
        if (isJunkPhone(value)) return 'That number does not look real.'
        return true
      },
    },
    {
      name: 'phoneNormalised',
      type: 'text',
      index: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'E.164 form, used to spot duplicate enquiries.',
      },
      access: serverOnlyField,
    },
    {
      name: 'projectSlug',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'Which project the visitor selected, if any.',
      },
      // NEVER TRUSTED: the public handler verifies it against a published slug
      // before the document is created, and rejects an unknown one with
      // UNKNOWN_PROJECT.
      access: serverOnlyField,
    },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      admin: { readOnly: true },
      access: serverOnlyField,
      // DELIBERATELY A SOFT REFERENCE, not an FK with cascade semantics:
      // `projectSlug` and `projectNameSnapshot` are plain text alongside it, so
      // a lead SURVIVES its project being renamed or archived.
    },
    {
      name: 'projectNameSnapshot',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'The project name as it was when the enquiry arrived.',
      },
      access: serverOnlyField,
    },
    {
      name: 'message',
      type: 'textarea',
      maxLength: LIMITS.leadMessage,
      hooks: { beforeValidate: [stripHtml] },
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      defaultValue: 'contact_form',
      options: LEAD_SOURCES.map((v) => ({ label: v, value: v })),
      enumName: 'enum_lead_source',
      admin: { position: 'sidebar', readOnly: true },
      // 🔴 SERVER-ASSIGNED, NEVER CLIENT-TRUSTED. `admin.readOnly` is "without
      // affecting the API" and is trivially spoofable over REST — the field
      // access is the actual control. The test is concrete: POST a lead with
      // "source":"whatsapp" in the body and assert the stored value is
      // `contact_form`.
      access: serverOnlyField,
    },
    {
      name: 'sourcePath',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Which page the enquiry came from.',
      },
      access: serverOnlyField,
    },
    {
      name: 'notifiedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'When the sales notification was sent.',
      },
      // Makes `sendLeadNotification` IDEMPOTENT. Retries are at-least-once:
      // without this marker, three retries during a provider blip send the sales
      // team three copies of the same lead.
      access: serverOnlyField,
    },
    {
      name: 'consentGiven',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description:
          'Implicit consent by submission: the privacy note is rendered next to the submit button. There is no separate consent checkbox on the form today.',
      },
      access: serverOnlyField,
    },
    {
      name: 'isRead',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Housekeeping only — nothing on the dashboard depends on it.',
      },
      // Kept because it costs one boolean, but NOTHING DEPENDS ON IT: the
      // dashboard's "new leads" is a DATE-WINDOW query (createdAt within 7
      // days), which needs no column, no write path, no audit entry, no
      // migration and no owner ruling.
    },
    {
      name: 'ipAddress',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Purged automatically after 90 days.',
      },
      access: serverOnlyField,
    },
    {
      name: 'userAgent',
      type: 'text',
      admin: { position: 'sidebar', readOnly: true, hidden: true },
      access: serverOnlyField,
    },

    // `leadStatus` is DELIBERATELY NOT BUILT. ADMIN-CMS-SPEC §5 is blunt:
    // "If the owner confirms no pipeline, remove the control entirely rather
    // than shipping a field nobody maintains. DO NOT DEFAULT TO BUILDING IT."
    // OQ-3 is open. Adding it later is one additive migration.
    // (And it could never be named `status` — reserved on Postgres with drafts.)
  ],
}
