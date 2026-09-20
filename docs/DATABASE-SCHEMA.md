# DATABASE-SCHEMA.md

> ### ⚠️ Status change (D-015 — Payload CMS 3)
> **This document is now a LOGICAL specification, not literal DDL.** Payload generates and owns the physical PostgreSQL schema from its TypeScript config.
>
> **Still binding:** every field and its meaning · required/optional · relationships and cardinality · ordering semantics · publish state · soft-delete semantics · uniqueness intent · which data is admin-only.
> **No longer binding:** exact table names, column names, and the literal DDL below.
>
> **Known divergences to expect:** `description` becomes a child table (array field) and is **flattened back to `string[]` by the public serialiser** · `site_settings` becomes a Payload *global* rather than a `CHECK (id = 1)` singleton · partial unique indexes and most CHECK constraints move to field validation and hooks.
>
> **Retained at the database layer via custom migration** — the two highest-value constraints: the **41-value `icon` enum** (an invalid value silently breaks a page) and **testimonial consent** (D-011). This partially mitigates the weakening of D-007; see `IMPLEMENTATION-DECISION.md` §7.

> ### 🔴 Entity corrections — 20 Sep 2026 (extends the banner above)
>
> The investigation resolved the model to **9 entities (8 collections + 1 global) + `payload-jobs`**, down from the 15 tables below. **Four tables specified here are NOT built:**
>
> | Table below | Status | Why |
> |---|---|---|
> | **`admin_sessions`** (§2) | ❌ **Not built** | Payload owns the session store. `useSessions: true` gives stateful, revocable sessions; a password change ends the user's other sessions, and an admin changing another user's password ends **all** of them (D-029, OQ-26) |
> | **`notification_jobs`** (§15) | ❌ **Not built** | Payload's **`payload-jobs`** is already this. Field mapping: `status`→`completedAt`+`hasError`+`processing` · `attempts`→`totalTried` · `last_error`→`error` · `scheduled_for`→`waitUntil` · `payload`→`input` (D-027) |
> | **`project_media`** (§8) | ❌ **Not built** | The five roles are named `upload` fields on `Project`. *(The partial unique index here is also defective as written — `UNIQUE(project_id) WHERE role IN (...)` forbids a project having both a cover **and** a layout; intent was `UNIQUE(project_id, role)`. Moot now.)* (D-032) |
> | **`media_assets`** | ↔ **Split** | Becomes **two** upload collections: `media` (images) and **`documents`** (PDFs — closes the master-plan-PDF gap that had no table) (D-032) |
>
> **Column-level corrections:**
>
> - `id` — **`idType: 'uuid'`**. ⚠️ **ULID is not supported**; Payload offers only `'serial'` or `'uuid'`. Delete "UUID v7/ULID" from the conventions line (D-019).
> - `sort_order` **int** → **`orderable: true`**, a *fractional-index string*, never exposed publicly (D-021).
> - `published_at` NULL = draft → Payload **`_status`** (`draft` | `published`) via `versions: { drafts: true }`.
> - `projects.status` → **`projectStatus`**; `leads.status` → **`leadStatus`**. `status` is a **reserved field name** on Postgres with drafts and is *silently sanitized out of the config* — the field simply disappears with no error (D-020).
> - `deleted_at` soft delete → Payload's native **Trash** (`trash: true`), which supplies `deletedAt` (D-026).
> - `password_hash` "argon2id" → ❌ **not achievable.** Payload's KDF is not named in the docs and not configurable; see `SECURITY.md` banner and plan §10.
> - `audit_log.action` — the 7 values below omit `logout`, `lockout`, `password_change` and `restore`, all of which are required.
>
> **Authoritative model:** [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) §5 · Migration-blocking choices: [`MIGRATION-001-DECISIONS.md`](./MIGRATION-001-DECISIONS.md)

PostgreSQL. **Every table is justified by a requirement ID.** No speculative tables.

Conventions: `snake_case`; PK `id` **UUID** *(see the correction banner — `idType: 'uuid'`; **ULID is not supported**)*; `created_at`/`updated_at` `timestamptz` NOT NULL; soft delete via **Payload Trash** (`deletedAt`); publish state via **`_status`**, not a nullable `published_at`.

---

## ER overview

```
admin_users ──1:N──► admin_sessions
     │
     └──1:N──► audit_log

projects ──1:N──► project_features     (kind: highlight|amenity|approval|location)
    │     ──1:N──► project_stats
    │     ──1:N──► project_proximity
    │     ──1:N──► project_media ──N:1──► media_assets
    │
    └──0:N◄── leads (soft reference by slug, NOT a hard FK)

media_assets ──1:N──► project_media
             ──0:1◄── testimonials.avatar_media_id
             ──0:1◄── site_settings.logo_media_id

testimonials · faqs · statistics · site_settings   (independent)
```

---

## 1. `admin_users` — FR-AUTH-01..09

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | ✖ | PK |
| `email` | citext | ✖ | **UNIQUE**. Login identifier |
| ~~`password_hash`~~ | — | — | **NOT A FIELD WE DEFINE.** Payload auto-injects `hash` and `salt` on an auth-enabled collection and strips both from every read. The KDF is **PBKDF2-SHA256**, not argon2id, and is not configurable (D-118) |
| `name` | text | ✖ | Display name, audit attribution |
| `role` | text | ✖ | DEFAULT `'admin'`. **Single role today** — column exists so OQ-4 does not require a migration |
| `is_active` | bool | ✖ | DEFAULT true. Disable without deleting |
| `last_login_at` | timestamptz | ✔ | |
| `failed_login_count` | int | ✖ | DEFAULT 0. Lockout — FR-AUTH-08 |
| `locked_until` | timestamptz | ✔ | |
| `created_at` / `updated_at` | timestamptz | ✖ | |

Indexes: UNIQUE(`email`). **No `deleted_at`** — deactivate, never delete, so audit attribution survives.

## 2. `admin_sessions` — FR-AUTH-01, 02, 05

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | ✖ | PK. The cookie value (or its hash) |
| `admin_user_id` | uuid | ✖ | FK → `admin_users` **ON DELETE CASCADE** |
| `expires_at` | timestamptz | ✖ | |
| `last_seen_at` | timestamptz | ✖ | Sliding expiry |
| `ip_address` / `user_agent` | inet / text | ✔ | Session review |
| `created_at` | timestamptz | ✖ | |

Indexes: (`admin_user_id`), (`expires_at`) for sweeping. Server-side revocation is the whole point (`ARCHITECTURE.md` §6).

## 3. `projects` — FR-PROJ-01..18

Mirrors `svfrontend/src/types/content.ts` exactly.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | ✖ | PK |
| `slug` | text | ✖ | **UNIQUE**. Drives `/projects/[slug]` |
| `name` | text | ✖ | |
| `category` | text | ✖ | CHECK IN the 4 values |
| `status` | text | ✔ | CHECK IN the 4 values. **NULL on every project today** |
| `locality` | text | ✖ | |
| `developer` | text | ✔ | Only when it differs from site name |
| `tagline` | text | ✔ | |
| `summary` | text | ✖ | |
| `description` | text[] | ✖ | **Ordered paragraphs.** Not rich text |
| `area` | text | ✔ | Free text — `"6 Acres 22.50 Guntas"` |
| `road_details` | text | ✔ | Free text |
| `cta_title` / `cta_description` | text | ✔ | Both-or-neither (CHECK) |
| `seo_title` / `seo_description` | text | ✔ | |
| `featured` | bool | ✖ | DEFAULT false |
| `sort_order` | int | ✖ | DEFAULT 0. **New capability** |
| `published_at` | timestamptz | ✔ | NULL = draft |
| `deleted_at` | timestamptz | ✔ | Archive — FR-PROJ-06 |
| `created_at` / `updated_at` | timestamptz | ✖ | |
| `created_by` / `updated_by` | uuid | ✔ | FK → `admin_users` ON DELETE SET NULL |

Indexes: UNIQUE(`slug`); partial `(published_at, sort_order) WHERE deleted_at IS NULL AND published_at IS NOT NULL`; partial `(featured) WHERE featured AND published_at IS NOT NULL`.

**Deletion:** soft only. A hard delete orphans a live URL and its sitemap entry.

> `description` as `text[]` matches the frontend's `readonly string[]` exactly. A single text blob would force the frontend to invent paragraph splitting.

## 4. `project_features` — FR-PROJ-13

One table for four lists, discriminated by `kind`. Four near-identical tables would be worse.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | ✖ | PK |
| `project_id` | uuid | ✖ | FK → `projects` **ON DELETE CASCADE** |
| `kind` | text | ✖ | CHECK IN (`highlight`,`amenity`,`approval`,`location`) |
| `icon` | text | ✖ | **CHECK against the 41 `IconName` values** — FR-PROJ-15 |
| `title` | text | ✖ | |
| `body` | text | ✔ | Optional — `FeatureItem.body?` |
| `sort_order` | int | ✖ | |

Index: (`project_id`, `kind`, `sort_order`).

> `kind = 'approval'` rows carry **legally sensitive** claims (DTCP/RERA/title). Audit these edits specifically — FR-AUDIT-02.

## 5. `project_stats` — FR-PROJ-12

`id` · `project_id` (FK CASCADE) · `label` text · `value` text · `sort_order` int.

> `value` is **text, not numeric** — real values are `"6 Acres 22.50 Guntas"`, `"DTCP & RERA"`, `"100%"`.

## 6. `project_proximity` — FR-PROJ-14

`id` · `project_id` (FK CASCADE) · `icon` (CHECK IconName) · `measure` text · `place` text · `sort_order` int.

> `measure` is text (`"5 min"`, `"[00] km"`). **Only populate from printed figures** — the most-challenged claim on a land page.

## 7. `media_assets` — FR-MEDIA-01..13

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | ✖ | PK |
| `storage_key` | text | ✖ | **UNIQUE**. Path/key in object storage |
| `public_url` | text | ✖ | Stable URL for `next/image` |
| `original_filename` | text | ✖ | Display only — never used as the storage key |
| `mime_type` | text | ✖ | CHECK against the allow-list |
| `size_bytes` | bigint | ✖ | |
| `width` / `height` | int | ✔ | **Required for images** (CHECK). NULL for PDFs |
| `alt_text` | text | ✔ | **Required before public attachment** — FR-MEDIA-04 |
| `asset_type` | text | ✖ | CHECK IN (`image`,`document`) |
| `uploaded_by` | uuid | ✔ | FK → `admin_users` ON DELETE SET NULL |
| `deleted_at` | timestamptz | ✔ | Soft delete; storage object removed by a sweeper |
| `created_at` / `updated_at` | timestamptz | ✖ | |

Indexes: UNIQUE(`storage_key`); (`asset_type`, `created_at DESC`); partial WHERE `deleted_at IS NULL`.

> `width`/`height` are **mandatory for images** because `ImageRef` requires them and the CLS budget (< 0.05) depends on them. Extract server-side on upload — never trust the client.

## 8. `project_media` — FR-MEDIA-05, 06

Join table with a role.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | ✖ | PK |
| `project_id` | uuid | ✖ | FK → `projects` ON DELETE CASCADE |
| `media_asset_id` | uuid | ✖ | FK → `media_assets` **ON DELETE RESTRICT** — cannot delete an asset in use (FR-MEDIA-08) |
| `role` | text | ✖ | CHECK IN (`cover`,`gallery`,`layout`,`location_map`,`brochure`) |
| `sort_order` | int | ✖ | |

Indexes: (`project_id`, `role`, `sort_order`); **UNIQUE partial (`project_id`) WHERE `role` IN ('cover','layout','location_map')** — those are single-valued; `gallery` and `brochure` are collections.

## 9. `leads` — FR-LEAD-01..18

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | ✖ | PK |
| `name` | text | ✖ | |
| `phone` | text | ✖ | As submitted |
| `phone_normalised` | text | ✖ | E.164. Dedupe |
| `project_slug` | text | ✔ | **Soft reference, not an FK** — a lead must survive its project being renamed or archived |
| `message` | text | ✔ | |
| `source` | text | ✖ | CHECK IN (`contact_form`,`hero_pill`,`whatsapp`,`phone`). **Server-assigned** |
| `source_path` | text | ✔ | Which page converted |
| `status` | text | ✔ | **INFERRED — OQ-3.** Nullable so it can be dropped without data loss |
| `consent_given` | bool | ✖ | DEFAULT true. The `formNote` promise |
| `is_read` | bool | ✖ | DEFAULT false — FR-LEAD-13 |
| `ip_address` / `user_agent` | inet / text | ✔ | **PII — purge early** (FR-LEAD-16) |
| `deleted_at` | timestamptz | ✔ | Soft delete. A lead is a commercial record |
| `created_at` / `updated_at` | timestamptz | ✖ | |

Indexes: (`created_at DESC`), (`phone_normalised`), (`project_slug`), (`status`), partial WHERE `deleted_at IS NULL`.

**No unique constraint on phone** — one buyer may legitimately enquire about several projects. Dedupe on `(phone_normalised, project_slug)` within a time window at the application layer.

## 10. `site_settings` — FR-CONT-01, 02

**Singleton** — enforce with `CHECK (id = 1)`.

`id` (int, =1) · `name` · `legal_name` · `tagline` · `description` · `url` · `email` · `phone` · `whatsapp` (**digits only, country code first**) · `address` text[] (ordered) · `map_url` · `office_hours` · `social` jsonb (`[{label, href, icon}]`) · `legal_links` jsonb (`[{label, href}]`) · `copyright_text` · `form_note` · `cta_title` · `cta_body` · `logo_media_id` (FK → `media_assets` ON DELETE SET NULL) · `updated_at` · `updated_by`.

> `social` and `legal_links` are JSONB because they are small, ordered, always read whole, and never queried by their contents. Every `icon` inside must still validate against `IconName`.

## 11. `testimonials` — FR-CONT-03, 04

`id` · `name` · `role` · `rating` smallint (CHECK 1–5) · `body` text · `consented` bool DEFAULT **false** · `avatar_media_id` (FK SET NULL, optional) · `sort_order` · `published_at` · `deleted_at` · timestamps.

> **`consented` defaults to `false`, and publishing requires `consented = true`.** The repo is explicit that publishing invented reviews under real-sounding names is a fabricated record. This constraint is the safeguard.

## 12. `faqs` — FR-CONT-05

`id` · `question` · `answer` · `sort_order` · `published_at` · `deleted_at` · timestamps. Index (`sort_order`) partial WHERE published and not deleted.

## 13. `statistics` — FR-CONT-06

`id` · `label` · `value` text · `sort_order` · `published_at` · timestamps.

> `value` is **text, not numeric** — `"[000]+"`, `"Immediate"`. These are **authored strings, not computed aggregates.** Do not "helpfully" derive them from row counts; `"Plots handed over"` is not something this database knows.

## 14. `audit_log` — FR-AUDIT-01..03

`id` · `admin_user_id` (FK SET NULL) · `action` (`create`/`update`/`publish`/`unpublish`/`delete`/`login`/`login_failed`) · `entity_type` · `entity_id` · `changes` jsonb (before/after for sensitive fields) · `ip_address` · `created_at`.

Indexes: (`created_at DESC`), (`entity_type`, `entity_id`), (`admin_user_id`). **Append-only** — no update or delete path in the application.

## 15. `notification_jobs` — FR-LEAD-06

DB-backed queue; avoids an external broker for one async task.

`id` · `type` (`lead_notification`) · `payload` jsonb · `status` (`pending`/`processing`/`sent`/`failed`) · `attempts` int · `last_error` text · `scheduled_for` · `created_at` · `updated_at`. Index (`status`, `scheduled_for`).

---

## Tier-2 tables (only when the matching requirement is approved)

`ticker_items` (FR-CONT-07) · `site_features` (FR-CONT-08, site-wide specs) · `site_proximity` (FR-CONT-09) · `steps` (home.steps) · `page_content` (about story etc.).

All follow the same pattern: `id`, content columns, `sort_order`, `published_at`, timestamps.

## Explicitly NOT modelled

| Table | Why not |
|---|---|
| `users` / `customers` | No public accounts — zero evidence |
| `services` | Brief mentions "services"; frontend has none — OQ-13 |
| `articles` / `posts` | `/blog` documented but does not exist — OQ-14 |
| `plots`, `prices`, `bookings`, `payments` | No pricing or inventory anywhere in the frontend |
| `roles` / `permissions` | Single role. The `role` column covers OQ-4 without a join table |
| `categories` | Fixed 4-value enum, not user-extensible |

## Migration and operations

Versioned, reversible, one concern per migration (NFR-09). Seed: one admin user, one `site_settings` row, the 41 icon names as a CHECK constraint or lookup table, and the 5 existing projects migrated verbatim from `projects.ts` — **including their bracketed placeholders**, so nothing is silently "fixed" during migration. Daily backups with a tested restore (NFR-10).
