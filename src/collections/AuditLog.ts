import type { CollectionConfig } from 'payload'

import { isAdmin, nobody } from '@/access'
import { AUDIT_ACTIONS } from '@/lib/constants'

/**
 * `audit-log` — APPEND-ONLY BY CONSTRUCTION.
 *
 * Written EXCLUSIVELY by hooks. See `src/hooks/audit.ts` for why Payload's
 * version history does not satisfy FR-AUDIT and never could.
 *
 * THE SCREEN IS FREE: audit STORAGE is P1; the audit SCREEN is P2 and is
 * satisfied entirely by Payload's default collection list view on a read-only
 * collection. No custom screen exists, which keeps the nine-admin-screen count
 * correct and removes a phantom tenth.
 */
export const AuditLog: CollectionConfig = {
  slug: 'audit-log',

  admin: {
    group: 'System',
    defaultColumns: ['createdAt', 'action', 'entityType', 'entityId', 'adminUser'],
    useAsTitle: 'action',
    description:
      'A permanent record of every change made through this CMS, and of every sign-in. Read-only: nothing here can be edited or deleted, by anyone, through any interface.',
    hidden: false,
  },

  // 🔴 APPEND-ONLY. This blocks REST, GraphQL and the Admin UI — the threat model
  // that matters. It does NOT stop our own hooks, because `overrideAccess`
  // defaults to TRUE in the Local API; `writeAuditRow` is the single sanctioned
  // writer and a code-review rule covers the rest.
  access: {
    read: isAdmin,
    create: nobody,
    update: nobody,
    delete: nobody,
  },

  // No versions (a version table on an audit table is a second, PRUNABLE copy of
  // the thing that must not be prunable) and no trash.
  versions: false,
  trash: false,
  defaultSort: '-createdAt',
  disableBulkEdit: true,
  disableBulkDelete: true,
  disableDuplicate: true,

  fields: [
    {
      name: 'adminUser',
      type: 'relationship',
      relationTo: 'users',
      // Nullable: a scheduled or system action has no actor.
      admin: { readOnly: true },
    },
    {
      name: 'action',
      type: 'select',
      required: true,
      // ⚠️ ELEVEN values, not the documented seven. SECURITY.md §13 additionally
      // requires logout, lockout and password_change, and `restore` had no value
      // at all. A Postgres enum REJECTS an unlisted value at write time, so a
      // missing value means the audit hook THROWS on the first logout.
      options: AUDIT_ACTIONS.map((v) => ({ label: v, value: v })),
      enumName: 'enum_audit_action',
      admin: { readOnly: true },
    },
    {
      name: 'entityType',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'entityId',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'changes',
      type: 'json',
      admin: {
        readOnly: true,
        description:
          'Before and after values for legally sensitive fields only — approvals, area, proximity and anything title-related. Never lead data.',
      },
    },
    {
      name: 'ipAddress',
      type: 'text',
      admin: { readOnly: true },
    },
  ],
}
