import type { Field } from 'payload'

import { ICON_NAMES, humaniseIcon } from '@/lib/icons'

/**
 * The icon field — a `select` over the 41 frontend icon names.
 *
 * WHY `select` AND NOT `text` + validate:
 *   · Admin UI: a native dropdown over 41 values satisfies FR-PROJ-15 /
 *     ADMIN-CMS-SPEC §4-C ("never a free-text field") FOR FREE. A text box would
 *     need a hand-built picker or the hard rule is violated on day one.
 *   · DB enforcement: `enumName` produces a REAL POSTGRES ENUM TYPE — closed at
 *     the database, and strictly stronger than the CHECK constraint D-007
 *     planned. That planned custom CHECK migration is therefore unnecessary.
 *   · `BACKEND-ROADMAP.md` line 79 ("rejects invalid values at API AND DB") is
 *     satisfied by construction.
 *
 * The churn argument answered honestly: `text + CHECK` IS cheaper to change,
 * because Postgres has no `DROP VALUE`. But `Icon.tsx:50` is
 * `Record<IconName, ReactNode>` — exhaustive — so the CMS cannot introduce an
 * icon at all; adding one is a frontend code change first. Icon-set churn
 * happens once or twice in the life of the project, inside a deploy that already
 * touches both repos.
 *
 * 🔴 `enumName` is set EXPLICITLY and identically on every call site. Auto-
 * generated enum names derive from the field/table path, which would produce a
 * SEPARATE Postgres enum per list — the icon appears in at least six places on
 * `projects` alone, plus `site-settings.social` and `heroTicker`, doubled again
 * by the `_v` version tables. Whether Payload deduplicates an identical
 * `enumName` across fields into a single type is measured in the Phase-1 gate.
 */
export const iconField = (overrides?: Partial<Field>): Field =>
  ({
    name: 'icon',
    type: 'select',
    required: true,
    options: ICON_NAMES.map((value) => ({ label: humaniseIcon(value), value })),
    enumName: 'enum_icon_name',
    admin: {
      isClearable: false,
      description: 'Closed list. A new icon requires a frontend release.',
    },
    ...overrides,
  }) as Field
