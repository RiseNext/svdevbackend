# MIGRATION-001-DECISIONS.md

> **The six decisions that must be settled before the first irreversible database artefact.**
> Created 20 September 2026 at documentation freeze · Source: [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) §26.3–§26.4

---

## Why this document exists

Migration 001 is the first artefact in this project that cannot be undone by editing a file. Once it has run against a database that holds real data, six choices become expensive-to-impossible to change: three of them alter the type or shape of **every primary key, every foreign key, or every row** in the schema.

The investigation found these six sitting in **no phase at all** — they were implicit in the old roadmap, which meant they would have been made by accident, by whoever wrote the first collection file. This document makes them explicit and states, for each, whether it is already settled and by what authority.

**Scope note.** These are the decisions that block **migration 001** specifically. Two further decisions block the *very first commit* (OQ-35 the Next.js pin, OQ-36 the package manager) and are recorded in `DECISIONS.md` D-016 and D-018 — they are not repeated here because they affect `package.json`, not the schema.

## Summary

| # | ID | Decision | Status | Reversible after data exists? |
|---|---|---|---|---|
| 1 | **OQ-27** | `idType`: `'serial'` vs `'uuid'` | ✅ **RESOLVED** — D-019 | ❌ **No** — type change across every PK and FK |
| 2 | **OQ-28** | Rename the reserved field `status` | ✅ **RESOLVED** — D-020 | ⚠️ Data migration |
| 3 | **OQ-29** | Native `orderable` vs integer `sort_order` | ✅ **RESOLVED** — D-021 | ⚠️ Data migration (int → fractional-index string) |
| 4 | **OQ-30** | Named vs unnamed tabs | ✅ **RESOLVED** — D-022 | ⚠️ Data migration (named tabs nest data into an object) |
| 5 | **OQ-25** | Multilingual (Telugu) | 🔴 **PENDING OWNER DECISION** — safe technical default applied (D-031) | ⚠️ Painful — physical schema change across every localized field |
| 6 | **OQ-31** | The REST-surface fork | ✅ **RESOLVED** — D-024 + D-025 | ✅ Yes — config, not schema |

**Five of six are resolved on technical grounds and need no owner input. One — OQ-25 — is a genuine product question.**

> ### 🔴 Can implementation proceed before OQ-25 is answered?
>
> **Yes, through migration 001 and well beyond.** The safe technical default (`localization` **not** enabled) is already applied by D-031 and is what a single-language site needs today. Implementation is **not blocked**.
>
> **But the cost of a late "yes" is real and must not be hidden:** enabling `localization` after data exists is a physical schema change that adds a `_locales` table per collection, on a model that already produces ~18–20 physical tables for `Project` alone before versions. **The owner should be asked now, while the answer is free, rather than at the point where it is expensive.**
>
> What must *not* happen: recording the default as though the owner chose it. The default is *"engineering adopted the documented interim behaviour"*, never *"the owner decided against Telugu"*.

---

## 1. OQ-27 — `idType`

**1. Decision ID:** OQ-27 → **D-019** (ACCEPTED, 20 Sep 2026)

**2. Exact question:** Should the Postgres adapter use `idType: 'serial'` (auto-incrementing integers) or `idType: 'uuid'` for every primary key?

**3. Why it affects migration 001:** The setting is **adapter-global, not per-collection**, and it determines the column type of every primary key and every foreign key the first migration creates. Changing it afterwards is a type change propagated across roughly 50 child tables, every relation and every version table.

**4. Current evidence:**
- The adapter accepts **only** `'serial'` or `'uuid'`. Custom IDs *"can only be `Number` or `Text` fields"* — so **ULID is not available**, despite `DATABASE-SCHEMA.md` §3.1 specifying "UUID v7/ULID".
- `DATABASE-SCHEMA.md` already specifies `Lead.id` as a UUID.
- Leads are PII-bearing records; a sequential integer id is enumerable.

**5. Available options:**

| Option | For | Against |
|---|---|---|
| `'serial'` | Smaller index, marginally faster joins | Enumerable ids on a PII table; conflicts with the documented `Lead.id` |
| **`'uuid'`** ✅ | Unguessable ids; matches the existing spec; safe to expose in admin URLs | Slightly larger indexes — immaterial at this data volume |
| `ULID` | — | ❌ **Not supported by Payload.** Not an option |

**6. Selected decision:** **`idType: 'uuid'`.** Determined by D-019 on technical grounds. A config test asserts it, so a later edit cannot change it silently. **"ULID" is to be removed from `DATABASE-SCHEMA.md` §3.1.**

**7. Consequence:**
- *Schema:* every PK/FK is `uuid`.
- *API:* none — ids are presented as opaque strings either way.
- *Admin:* none visible.

**8. Reversible?** ❌ **No.** This is the single most irreversible choice on the list.

**9. Source:** `DECISIONS.md` D-019 · plan §16, §26.3 · official Payload Postgres adapter documentation.

---

## 2. OQ-28 — The reserved field name `status`

**1. Decision ID:** OQ-28 → **D-020** (ACCEPTED, 20 Sep 2026)

**2. Exact question:** `status` is a reserved field name on the Postgres adapter when drafts are enabled. What do `Project.status` and `Lead.status` become?

**3. Why it affects migration 001:** The failure is **silent**. Official documentation, verbatim: *"Using reserved field names will result in your field being sanitized from the config."* The field simply **does not exist** — no error, no warning, no column. Drafts **are** enabled on `projects` (D-005), so `Project.status` would vanish, and the first migration would create a table without it. Renaming after data exists is a data migration.

**4. Current evidence:**
- Reserved names on Postgres with drafts: `__v`, `salt`, `hash`, `file`, **`status`**.
- `svfrontend/src/types/content.ts` types `status?: ProjectStatus` — the **public** key must stay `status`.
- `content/projects.ts`: **no project sets `status`** today (the brochures state none), so nothing is lost by renaming internally.
- `leads` carries no `versions` block today, so the reservation would not bite there yet.

**5. Available options:**

| Option | Assessment |
|---|---|
| Keep `status` | ❌ Impossible — silently deleted from the config |
| Disable drafts on `projects` to free the name | ❌ Rejected — drafts are the publish mechanism (D-005) |
| **Rename internally, alias in the serialiser** ✅ | Public contract unchanged; `types/content.ts` untouched |

**6. Selected decision:** **`projectStatus`** on `projects`, **`leadStatus`** on `leads`. `toPublicProject()` maps `projectStatus` → the public key `status`.

> ⚠️ **Naming note.** Earlier investigation artefacts used the working name `saleStatus`. **`projectStatus` is canonical** (D-020), and the master plan and checklist were normalised to it at freeze. If any document still says `saleStatus`, it is stale.

`leadStatus` is aligned defensively: the reservation does not bite today, but enabling versions on `leads` later would silently delete the column.

**7. Consequence:**
- *Schema:* columns are `project_status` / `lead_status` (Payload-derived).
- *API:* **unchanged** — public JSON key remains `status`.
- *Admin:* label reads "Status"; the field name differs underneath.

**8. Reversible?** ⚠️ Free before data exists; a data migration afterwards.

**9. Source:** `DECISIONS.md` D-020 · plan §5, §12, §16, §26.3 · `svfrontend/src/types/content.ts` · official reserved-field-names documentation.

---

## 3. OQ-29 — Ordering mechanism

**1. Decision ID:** OQ-29 → **D-021** (ACCEPTED, 20 Sep 2026)

**2. Exact question:** Use Payload's native `orderable: true` (fractional-index **string** keys, drag-and-drop included), or the integer `sort_order` column specified in `DATABASE-SCHEMA.md`, `VALIDATION-RULES.md` and `API-CONTRACT.md`?

**3. Why it affects migration 001:** The two produce **different column types** — a fractional-index string versus an integer. Whichever the first migration creates is what exists. D-005 makes admin-controlled ordering a first-class capability, so this is not deferrable.

**4. Current evidence:**
- Official documentation: *"If true, enables custom ordering for the collection, and documents can be reordered via drag and drop"*, using **fractional indexing** for efficient reordering, settable via Local API, REST and GraphQL.
- Today, ordering is implicit: position in the `projects.ts` array. There is no existing integer to preserve.
- Three project documents specify `sort_order` as `int`; none of them knew `orderable` existed.

**5. Available options:**

| Option | For | Against |
|---|---|---|
| Integer `sort_order` | Matches the existing written spec; trivially sortable | **Forfeits the drag-reorder UI** D-005 makes first-class; reordering rewrites many rows |
| **`orderable: true`** ✅ | Free drag-and-drop admin UI; O(1) reorder; officially supported | Column is an opaque string; **the generated field name is undocumented** |

**6. Selected decision:** **`orderable: true`.** The integer `sort_order` is deleted from the specification documents.

> ⚠️ **One unresolved sub-item, and it is not a blocker.** The **name** of the column `orderable` generates is not documented. It must be read from `npx payload generate:db-schema` during the Phase-1 spike **before** the public sort is written. This is a 10-minute empirical check, not a decision.

**7. Consequence:**
- *Schema:* an ordering column of string type; no integer `sort_order` anywhere.
- *API:* **the ordering key is never exposed publicly** — the public list is returned already sorted.
- *Admin:* drag-and-drop reordering, at no build cost.

**8. Reversible?** ⚠️ Data migration afterwards (string ↔ int are not interchangeable).

**9. Source:** `DECISIONS.md` D-021 · plan §5.3, §26.3 · official collection-configuration documentation (`orderable`, fractional indexing).

---

## 4. OQ-30 — Named vs unnamed tabs

**1. Decision ID:** OQ-30 → **D-022** (ACCEPTED, 20 Sep 2026)

**2. Exact question:** In the Project editor, should tabs be **named** or **unnamed**? (And, relatedly, should `dbName` and `enumName` be set explicitly?)

**3. Why it affects migration 001:** **Named tabs group their data into an object in the database.** Unnamed tabs are purely presentational and leave the stored shape flat. The choice therefore changes the physical schema and the serialiser, and reversing it after data exists is a data migration rather than a UI tweak.

**4. Current evidence:**
- Official documentation distinguishes named tabs (which introduce a data nesting level) from unnamed tabs (presentational only).
- The Project editor needs tabs for usability — `ADMIN-CMS-SPEC.md` §4 warns: *"Group into sections; do not render one 40-field wall."*
- The public contract is **flat** — `types/content.ts` has no nested groups beyond `image`, `cta`, `seo`.
- Payload's derivation of table and enum names is **undocumented**, and deeply nested paths risk Postgres' **63-byte identifier limit** with silent truncation collisions.
- Auto-generated enum names would create a **separate Postgres enum per icon field** — six identical types, six `ALTER TYPE` statements per icon change, doubled again by the `_v` version tables.

**5. Available options:**

| Option | Assessment |
|---|---|
| Named tabs | Nests stored data into objects the public contract does not have — the serialiser must then flatten it back. Pure cost |
| **Unnamed tabs** ✅ | Same admin UX; stored shape stays flat; serialiser stays simple |
| Implicit `dbName`/`enumName` | Undocumented derivation + 63-byte truncation risk + enum duplication |
| **Explicit `dbName`/`enumName`** ✅ | Names are ours, stable, and reviewable in the config |

**6. Selected decision:** **Unnamed tabs everywhere.** **`dbName` explicitly on every array field**, **`enumName` explicitly on every `select`**.

> ⚠️ **One item to verify empirically:** whether Payload **deduplicates** an identical `enumName` shared across the six icon fields into one Postgres enum, or emits six. Check via `generate:db-schema` in the spike. It changes the migration's size, not the decision.

**7. Consequence:**
- *Schema:* flat `Project` shape; explicitly named arrays and enums.
- *API:* serialiser stays a simple key-by-key allow-list.
- *Admin:* tabbed editor exactly as `ADMIN-CMS-SPEC.md` §4 requires.

**8. Reversible?** ⚠️ Data migration afterwards.

**9. Source:** `DECISIONS.md` D-022 · plan §5, §16, §26.3 · `ADMIN-CMS-SPEC.md` §4 · official tabs/array/select field documentation.

---

## 5. OQ-25 — Multilingual (Telugu) 🔴 PENDING OWNER DECISION

**1. Decision ID:** OQ-25 → technical deferral recorded as **D-031**. **The product question is open.**

**2. Exact question:** Will the site ever be multilingual (Telugu)? The frontend PRD lists it as phase 2.

**3. Why it affects migration 001:** Payload's `localization` puts localized fields in **a separate `_locales` table per collection**. Enabling it after data exists is a physical schema change across **every** localized field — on a model that already generates roughly 18–20 physical tables for `Project` alone before versions are counted. OQ-25's own text says: *"decide before the schema is finalised, or accept a painful migration later."*

**4. Current evidence:**
- `svfrontend` is **English-only**. No i18n library, no locale routing, no `[lang]` segment, no translated content anywhere.
- No requirement ID covers multilingual content.
- `OPEN-QUESTIONS.md` rates OQ-25 **⚪ informational** — which is the rating a future session would have acted on, and is **why this was nearly missed**. The rating understates the schema consequence.

**5. Available options:**

| Option | Cost now | Cost later |
|---|---|---|
| **Do not enable `localization`** ✅ *(default applied)* | Zero | A painful physical migration **if** Telugu is later required |
| Enable `localization` pre-emptively | Doubles the table count; every query and the serialiser gain a locale dimension; admin complexity for content nobody has | Zero |

**6. Selected decision:** ⚠️ **NOT SELECTED — this is the project owner's call.**

**Safe technical default applied (D-031):** `localization` is **not enabled**. Admin-panel `i18n` is narrowed to `{ en }`. The deferral and its cost are recorded in `DATABASE-SCHEMA.md` **and as a comment in `payload.config.ts`**, so its absence is never later read as an oversight.

**This default must be recorded as *"engineering adopted the documented interim behaviour"*, never as *"the owner decided against Telugu"*.** The owner has not been asked.

**Can implementation proceed?** ✅ **Yes** — through migration 001, and through every phase. Nothing is blocked. The reason to ask now is purely that the answer is free today and expensive later.

**7. Consequence:**
- *Schema:* no `_locales` tables. Roughly half the table count of the localized alternative.
- *API:* no locale parameter; single-language responses.
- *Admin:* no locale switcher.

**8. Reversible?** ⚠️ **Yes, but painfully** — a physical schema change across every localized field, plus backfilling a default locale for all existing rows. Not a config flip.

**9. Source:** `OPEN-QUESTIONS.md` OQ-25 · `DECISIONS.md` D-031 · plan §26.2, §27 · `svfrontend/docs/PRD-redesign.md` (phase 2) · official localization documentation.

---

## 6. OQ-31 — The REST-surface fork

**1. Decision ID:** OQ-31 → **D-024** + **D-025** (both ACCEPTED, 20 Sep 2026)

**2. Exact question:** Payload auto-generates REST routes at `{routes.api}/<collection-slug>` and there is **no documented way to switch them off**. Either:
- **(A)** `access.read` returns a published-only `Where` constraint for anonymous callers — keeps `overrideAccess: false` meaningful, but leaves `/api/projects` publicly readable *in Payload's own document shape*; or
- **(B)** `access.read: Boolean(user)` closes the generated route entirely, forcing our public endpoints to use `overrideAccess: true` with a hard-coded `where` — which deliberately reintroduces the single most dangerous flag in the Local API.

**3. Why it affects migration 001:** Strictly this is a Phase-3 concern and is **config, not schema**. It is listed here because **it determines the `access.read` shape the Phase-1 `Project` collection carries**, and writing the collection twice is waste. It is the only one of the six that does not touch the physical schema.

**4. Current evidence — three independent official statements:**
- *"In the Local API, all Access Control is **skipped** by default."*
- `overrideAccess` — *"By default, this property is set to `true` within all Local API operations."*
- *"**Custom endpoints are not authenticated by default. You are responsible for securing your own endpoints.**"*

And on drafts: *"the `draft` argument on its own will not restrict documents with `_status: 'draft'` from being returned from the API"*, combined with *"When you first create a document, it's always written to the main collection"* — meaning **a never-published project is returned by an ordinary `payload.find()`**.

Payload's default access is `({ req: { user } }) => Boolean(user)` — *any authenticated user, full CRUD*. **It is not deny-by-default.**

**5. Available options:**

| Option | For | Against |
|---|---|---|
| **(A)** published-only `Where` ✅ | `overrideAccess: false` stays meaningful; defence in depth survives | `/api/projects` remains readable in Payload's raw shape |
| (B) `Boolean(user)` | Closes the generated route | Forces `overrideAccess: true` in public handlers — one forgotten `where` leaks everything |

**6. Selected decision:** **Option (A)**, plus an **infrastructure-level block** on `{routes.api}/<slug>` paths that are not ours, at the reverse proxy. Config alone cannot close the generated routes, so the block is not optional.

Mandated by **D-025**, every public read passes **three independent layers**:
1. `access.read` returns `({ req }) => req.user ? true : { _status: { equals: 'published' } }`;
2. `overrideAccess: false` **and** `user: undefined` on every Local API call in a public handler;
3. a hard-coded `where: { _status: { equals: 'published' } }` the caller cannot override.

A single shared **`publicFind()`** helper is the **only** permitted way a public handler reads content — **no bare `payload.find` in a public file** — and `draft` is never forwarded from user input.

> ⚠️ **`endpoints: false` is UNVERIFIED.** The collection option is described only as *"Add custom routes to the REST API. Set to `false` to disable routes"*, and **its scope is not stated**. It must be tested empirically before any security claim rests on it.

**7. Consequence:**
- *Schema:* **none.** This is the only one of the six that creates no migration artefact.
- *API:* public responses always pass the serialiser; generated routes are constrained by access control and blocked at the edge.
- *Admin:* unaffected — authenticated users read normally.

**8. Reversible?** ✅ **Yes** — a config change. But reversing it *after* the collection is written means revisiting every access block, so it is settled up front.

**9. Source:** `DECISIONS.md` D-024, D-025 · plan §6, §15, §26.3 · official Local API, access-control, drafts and custom-endpoint documentation.

---

## What to do with this document

1. **Before writing `payload.config.ts`:** confirm decisions 1–4 and 6 are still the intent. They are recorded as ACCEPTED; they are not immutable, but changing one is a decision, not an edit.
2. **Ask the owner about OQ-25 (Telugu) now.** It is the only one that is genuinely theirs, it costs nothing to answer today, and the default is already safe.
3. **During the Phase-1 spike, resolve the three empirical unknowns** — none is a decision, all three are 10-minute checks against `npx payload generate:db-schema`:
   - the column name `orderable: true` generates;
   - whether a shared `enumName` produces one Postgres enum or six;
   - whether `endpoints: false` actually disables the generated REST routes.
4. **Do not run migration 001 until decisions 1–4 are reflected in the config** and the spike has confirmed the gate.

> **Related:** [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) §24 (the gate) · §26 (all open questions) · [`MASTER-IMPLEMENTATION-CHECKLIST.md`](./MASTER-IMPLEMENTATION-CHECKLIST.md) (Phase 0) · [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md) · [`DECISIONS.md`](./DECISIONS.md) D-019 – D-025, D-031
