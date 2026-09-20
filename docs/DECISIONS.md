# DECISIONS.md

Decision log. Each entry: what was decided, when, by whom, why, and what it supersedes.

**A resolved `OPEN-QUESTIONS.md` item moves here — it is never silently deleted.**

Status: `ACCEPTED` · `PROPOSED` (recommendation awaiting owner sign-off) · `SUPERSEDED`.

---

## D-001 — Backend scope expanded from lead-capture to full admin CMS

**Date:** 18 Sep 2026 · **By:** Project owner · **Status:** ACCEPTED

**Decision.** The backend is the website's **admin/CMS backend**, not a single lead-submission API. It provides admin content management and dynamic data for the public site.

**Context.** `../../BACKEND-REQUIREMENTS.md` (17 Sep) concluded the frontend required exactly **one** endpoint — `POST /api/v1/leads` — because the frontend contains zero fetch calls, zero auth, zero env vars, and all content is hardcoded. That audit was **accurate about the code** and intentionally conservative. The owner has since supplied business context the code could not express: admins must manage projects, content, media and leads.

**Consequence.** Scope grows from 1 endpoint / 1 table to ~50 endpoints / 14 tables. Admin authentication moves from "explicitly not required" to **core**.

**Supersedes:** `BACKEND-REQUIREMENTS.md` §0, §6, §7, §15 (scope conclusions).
**Still valid from that audit:** every finding about *what the frontend contains* — the feature inventory, content audit, field shapes, validation rules, mock-data list. It remains the evidence base.

> **Note for future sessions:** the earlier audit is not "wrong". It documented the code faithfully. The scope changed because business context arrived, not because the analysis was flawed. Both documents are true about different things.

## D-002 — Public users never get accounts

**Date:** 18 Sep 2026 · **By:** Project owner · **Status:** ACCEPTED

**Decision.** No public registration, login, or user accounts. Authentication is **admin-only**.

**Why.** The brief states it explicitly, and the frontend corroborates: no login UI, no session handling, no storage, no `middleware.ts`, no auth dependency. All 17 routes are public and static.

**Consequence.** No `users` table. `/api/v1/admin/**` is the sole authenticated surface. **Revisit only if frontend evidence for buyer accounts appears.**

## D-003 — Public/admin API separation by path prefix

**Date:** 18 Sep 2026 · **By:** Specification · **Status:** ACCEPTED

**Decision.** Public at `/api/v1/**`; admin at `/api/v1/admin/**`, with one middleware guarding everything beneath the admin prefix.

**Why.** A single, greppable boundary. Per-route opt-in auth eventually misses a route; a prefix cannot be forgotten. Fails closed — unknown `/admin` paths 401 rather than falling through.

**Alternatives rejected:** separate ports/services (operational overhead unjustified at this size); per-route auth decorators (easy to omit on a new endpoint).

## D-004 — Server-side sessions over stateless JWT

**Date:** 18 Sep 2026 · **Status:** **PROPOSED — needs amending after D-015**

> ⚠️ **Superseded in mechanism, not in intent.** Payload (D-015) uses httpOnly JWT cookies, not server-side session records. That satisfies this decision's XSS rationale (the credential is not readable by script) but **not** its revocation rationale. **Verify revocation-on-password-change and on-deactivation in Phase 2** (OQ-26), then amend this decision to match reality — or add a token-version field to force revocation.

**Decision.** httpOnly `Secure` `SameSite=Lax` cookie carrying an opaque session id, with server-side session records.

**Why.** The admin UI is a browser app on a known origin. Sessions revoke **instantly** server-side when an account is disabled or a password changes; a stateless JWT cannot, without a denylist that reintroduces the very state JWTs avoid. No mobile or third-party client exists to justify bearer tokens. `HttpOnly` keeps the credential unreadable by XSS, unlike `localStorage`.

**If overridden:** short access token (≤15 min) + rotating refresh token stored server-side.

## D-005 — Publish state and explicit ordering are new capabilities

**Date:** 18 Sep 2026 · **Status:** ACCEPTED

**Decision.** `projects` gains `published_at` and `sort_order`.

**Why.** Today, presence in the `projects.ts` array *is* publication, and file order *is* display order. Once editing is online, an admin needs to prepare a project without it appearing live, and to reorder without editing code. Both are explicit in the brief.

**Consequence.** Public queries must filter on `published_at IS NOT NULL AND deleted_at IS NULL`. Unpublished returns **404, not 403**.

## D-006 — Soft delete for projects, leads, media, testimonials

**Date:** 18 Sep 2026 · **Status:** ACCEPTED

**Decision.** `deleted_at` rather than row removal.

**Why.** Hard-deleting a project orphans a live URL and its sitemap entry. A lead is a commercial record. A deleted media asset may still be referenced. Recovery from an accidental click must not require a backup restore.

**Exception:** `admin_users` are **deactivated, never deleted**, so audit attribution survives.

## D-007 — `icon` is a closed enum enforced at API and database

**Date:** 18 Sep 2026 · **Status:** ACCEPTED

**Decision.** Every `icon` must be one of the 41 names in `ui/Icon.tsx:7-48`, validated at the API boundary **and** as a DB CHECK. The admin UI offers a picker, never free text.

**Why.** `Icon` resolves names against a fixed `Record<IconName, ReactNode>`. An unknown name renders nothing — a silently broken page. The failure is invisible to the admin who caused it.

**Consequence.** Adding an icon is a **frontend code change first**, then a constraint update. Documented so nobody tries it from the CMS.

## D-008 — Omit absent fields; never return empty collections

**Date:** 18 Sep 2026 · **Status:** ACCEPTED

**Decision.** Public API omits optional fields that have no value, rather than returning `[]` or `""`.

**Why.** `ProjectDetail.tsx` guards on `project.gallery?.length` etc. and drops the entire section. The repo's rule: *"a project with no location map simply omits the field and the detail template drops that section, rather than rendering an empty shell or inviting invented filler."* Returning `[]` preserves rendering by luck, not contract — and the distinction between "no data" and "empty data" is the design.

**Consequence.** Serialisers strip nulls/empties. Admin UI presents "leave blank" as a normal choice.

## D-009 — `description`, `stats.value`, `statistics.value`, `area`, `measure` stay text

**Date:** 18 Sep 2026 · **Status:** ACCEPTED

**Decision.** No numeric coercion. `description` is `text[]` (ordered paragraphs), not one rich-text blob.

**Why.** Real values are `"6 Acres 22.50 Guntas"`, `"DTCP & RERA"`, `"100%"`, `"[000]+"`, `"Immediate"`, `"5 min"`. Forcing numbers loses the unit, the qualifier, and the fact that some are deliberate placeholders. `text[]` matches `readonly string[]` exactly; a single blob would force the frontend to invent paragraph splitting.

**Corollary:** homepage statistics are **authored strings, not computed aggregates.** Do not derive them from row counts — *"Plots handed over"* is not something this database knows.

## D-010 — Headings stay in frontend code

**Date:** 18 Sep 2026 · **Status:** ACCEPTED

**Decision.** ~17 section headings hardcoded in JSX remain code. If any becomes editable, it keeps the `title` + `titleAccent` two-field split.

**Why.** The `<em>` in a display heading is **structural** — the headline's second line ("Land you can build on *the week you buy it.*"), styled as such in `globals.css`. The README states plainly: *"Do not use `<em>` for mid-sentence emphasis inside a heading."* A single rich-text field would destroy this, and a WYSIWYG would invite exactly the misuse the design forbids.

**Consequence.** No page-builder. `CONTENT-MANAGEMENT-MATRIX.md` §4 is the definitive list.

## D-011 — Testimonials require explicit consent to publish

**Date:** 18 Sep 2026 · **Status:** ACCEPTED

**Decision.** `consented` defaults to `false`; publishing with `consented = false` returns `422 CONSENT_REQUIRED`.

**Why.** The three current testimonials are **invented placeholders with bracketed names**, and the repo flags publishing invented reviews under real-sounding names as a fabricated record. Once an admin UI exists, the easiest possible mistake is publishing them as-is. The constraint makes that mistake impossible rather than merely discouraged.

## D-012 — ISR + on-demand revalidation for frontend integration

**Date:** 18 Sep 2026 · **Status:** **PROPOSED** — needs sign-off

**Decision.** The frontend fetches at build/revalidate time, not per visitor request. Publishing triggers a revalidation webhook.

**Why.** The site is 17 prerendered pages, First Load JS 102–114 kB, LCP < 2.5 s. Per-request fetching converts every page to SSR and destroys those numbers, while tying public uptime to backend uptime. ISR keeps visitors on static HTML and leaves the last good build serving if the backend is down.

**Consequence.** Publishing **must** trigger revalidation, or edits never appear — the most confusing possible admin failure.
**Rejected:** client-side fetching (kills SEO/LCP on a content site); full SSR (couples uptime); backend-rendered HTML (discards the existing frontend).

## D-013 — No `Service` entity; no blog/`Article` entity

**Date:** 18 Sep 2026 · **Status:** ACCEPTED (provisional — OQ-13, OQ-14)

**Decision.** Neither is modelled.

**Why.** *Services:* the brief lists it among examples, but the frontend has no services — only infrastructure *specifications* and *benefits*. *Blog:* `README.md` and `docs/PRD-redesign.md` both document a `/blog` route and `blog.ts`, but **neither exists and the route 404s** — it belonged to the pre-rebuild site and did not survive.

**Consequence.** Either becomes a **new requirement** with its own entity, admin screens and public API if the owner confirms it.

## D-014 — Documentation location

**Date:** 18 Sep 2026 · **Status:** ACCEPTED

**Decision.** Backend docs in `svbackend/docs/`. The forensic frontend audit stays at the workspace root.

**Why.** Backend specification belongs with the backend. The audit describes the *frontend* and predates the backend, so it sits at the root, neutral to both — and writing it into `svfrontend/` would have dirtied a repo that must stay clean.

## D-015 — Backend implementation architecture: Payload CMS 3 over a custom backend

**Date:** 18 Sep 2026 · **By:** Architecture evaluation · **Status:** **DECIDED**
**Full analysis:** [`IMPLEMENTATION-DECISION.md`](./IMPLEMENTATION-DECISION.md)

> **ID note.** This was requested as *D-002*, but `D-002` is already taken by "Public users never get accounts" — an active scope guard that must not be overwritten. Logged as **D-015**, the next free ID. Nothing was deleted. Say the word if you want the log renumbered instead.

### Decision

Build the backend as a **headless CMS: Payload CMS 3, self-hosted, on PostgreSQL**, with **hand-written custom endpoints** serving the public API.

- Public API → custom TypeScript endpoints + a `toPublicProject()` serialiser returning exactly the shapes in `API-CONTRACT.md`
- Admin API + admin UI → generated by Payload from a TypeScript config
- Business rules → Payload hooks and access-control functions
- Frontend integration → unchanged; ISR + on-demand revalidation (D-012)

### Context

`REQUIREMENTS.md` defines 100 requirements across ~60 endpoints, 15 tables and 9 admin screens — for **5 projects** and **one admin role**, with **no transactional business logic** anywhere. Effort is therefore dominated by CRUD surface and admin UI, not by algorithms.

Two facts verified in frontend source drove the evaluation:

1. `Project` in `types/content.ts` has **17 of 25 fields optional**, and `ProjectDetail.tsx` drops an entire page section per falsy field. Response shape is a contract (D-008), not a preference.
2. `ADMIN-CMS-SPEC.md` specifies nine screens including a project editor with four repeatable icon-bearing lists and five media roles, plus a full media library. **That is the largest single deliverable in the project, and a custom backend delivers none of it.**

This resolves **OQ-21**, which `BACKEND-ROADMAP.md` Phase 0 required to be settled before any code.

### Alternatives considered

| Option | Verdict |
|---|---|
| **Custom backend — TypeScript/Fastify** | Rejected. Technically ideal, economically poor: perfect contract control bought by hand-building an admin UI and media library that are commodity solved problems |
| **Custom backend — Python/FastAPI** | Rejected. Would force a hand-maintained Pydantic copy of a TypeScript contract in a second language — silent drift on a 25-field type — while still leaving the admin UI unbuilt. No Python-specific need exists |
| **Strapi** | Rejected. Furthest API shape from the contract; **ordering is not natively drag-and-drop** though D-005 makes it first-class; customisation via plugin conventions rather than plain TypeScript; no frontend-aligned type generation |
| **Directus** | **Closest competitor; designated fallback.** Database-first, so it would accept `DATABASE-SCHEMA.md` literally — directly solving this decision's main weakness. Rejected because schema lives in the DB rather than reviewable code, and it generates no types matching the frontend `Project` |
| **Payload CMS 3** | **Selected** |

### Rationale

1. **It does not force the trade-off.** Payload's first-class custom endpoints mean the exact documented public API *and* a generated admin UI — the reason a generic CMS would have failed and this one does not.
2. **The two largest cost items collapse to near zero** — admin UI and media library — while the one irreducible item, the public serialiser, is identical work in every option.
3. **Contract-drift resistance.** Config-as-code plus generated TypeScript types make backend/frontend disagreement a *compile-time* failure. This was the decisive criterion.
4. **Tier-2 content becomes config, not code.** Six further content types are already planned.
5. **Security surface shrinks** — password hashing, sessions and upload processing come maintained rather than hand-rolled.
6. **Stack continuity.** TypeScript and Next.js throughout; Node 20 matches the frontend's documented engine range.
7. **Lock-in is low** — MIT, self-hosted, own PostgreSQL, config in the repo, public API in our own code.

### Consequences

- ✅ `API-CONTRACT.md` **public** section stands unchanged, via custom endpoints.
- 🟡 `API-CONTRACT.md` **admin** section becomes **descriptive** — the operations exist; exact paths are Payload's.
- 🟡 **`DATABASE-SCHEMA.md` becomes a logical specification rather than literal DDL.** Field meanings, relationships, cardinality, ordering and deletion semantics remain binding; physical table/column names become Payload's.
- 🟡 **D-007 weakens at the database layer.** Enforcement moves to field validation and hooks, with custom-migration CHECK constraints retained for the two highest-value cases: the 41-value `icon` enum and testimonial consent (D-011).
- 🟡 **D-004 needs amending.** Payload uses httpOnly JWT cookies, which satisfy the *intent* (not XSS-readable) but differ from the proposed server-side session records. D-004 is PROPOSED, not accepted — amend it once Payload's revocation-on-password-change behaviour is verified.
- 🟡 **OQ-5 is partially answered** — the admin UI is served by the backend app. Who builds the remaining custom components stays open.
- ✅ `ADMIN-CMS-SPEC.md` stays valid as a **behavioural** specification; its layout detail becomes guidance.
- ✅ `CONTENT-MANAGEMENT-MATRIX.md`, `VALIDATION-RULES.md`, `SECURITY.md`, `MEDIA-MANAGEMENT.md`, `TRACEABILITY.md` are unaffected.
- The backend is a **Next.js application**, separate from `svfrontend`.

### Trade-offs — accepted knowingly

| Gained | Given up |
|---|---|
| Admin UI and media library for free | Literal control of the physical database schema |
| Auth, RBAC, draft/publish maintained upstream | Some DB-level CHECK constraints move to the app layer |
| Tier-2 content as config | Exposure to a framework's major-version upgrade cycle |
| Compile-time contract safety | A learning curve on Payload's conventions |
| Much faster to a usable admin | A small amount of non-zero lock-in |

**The sharpest trade is §7:** `DATABASE-SCHEMA.md` stops being executable DDL. This is the real cost and is not glossed over — mitigation is field validation and hooks everywhere, plus custom migrations for the two constraints that matter most.

### Validation gate

**This decision is provisional until Phase 1's exit criteria pass** — specifically that Payload's PostgreSQL adapter can express the full `Project` model, that `description` round-trips as `string[]`, and that absent optional fields are **absent** from the JSON. If those fail, the decision is void and **Directus is the designated fallback**.

---

---

# Decisions added by the 20 September 2026 implementation investigation

> These 23 entries are settled on **technical grounds only** — official Payload 3 documentation, `svfrontend` source, or a measured environment fact. **None makes a business choice.** Business decisions remain in `OPEN-QUESTIONS.md`.
> Full reasoning and evidence: [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) · [`DOCUMENTATION-CORRECTIONS.md`](./DOCUMENTATION-CORRECTIONS.md)

## D-016 — Backend Next.js and React versions are pinned exactly, inside a Payload-supported range

**Date:** 20 Sep 2026 · **By:** Official-documentation research · **Status:** ACCEPTED

**Decision.** `svbackend` pins `next`, `react` and `react-dom` to **exact versions** — no `^`, no `~` — inside a
Payload-supported range. Default: `next@16.3.3`, `react@19.2.6`, `react-dom@19.2.6`, which is what Payload's
official 3.x blank template pins. Every `payload` and `@payloadcms/*` package is pinned to the **same exact
version** and installed exactly once.

**Why.** Official docs: *"Next.js (one of the following version ranges): 15.2.9 - 15.2.x · 15.3.9 - 15.3.x ·
15.4.11 - 15.4.x · 16.2.6+"* and *"Not all Next.js 15/16 releases are compatible."* `@payloadcms/next@3.90.1`
peer-depends on `">=15.2.9 <15.3.0 || >=15.3.9 <15.4.0 || >=15.4.11 <15.5.0 || >=16.3.3 <17.0.0"`.
**`svfrontend` runs 15.5.25, which is outside every one of those ranges.**

**Constrains.** Never match the backend's Next version to the frontend's. **Any future proposal to merge Payload
into `svfrontend` is blocked** until `svfrontend` is upgraded off 15.5.x — which makes D-015's separate-app
choice *forced*, not merely preferred. A caret range on any `@payloadcms/*` package is a review failure.

## D-017 — `svbackend` Node engine range is `>=20.9.0` with no upper bound

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** `svbackend/package.json` sets `engines.node` to `">=20.9.0"`, with an `.nvmrc` per app so the two
apps' Node expectations are explicit and independent.

**Why.** Payload requires *"Node.js version 20.9.0+"* with **no upper bound**; `payload@3.90.1` declares
`"node": "^18.20.2 || >=20.9.0"`; Payload's own documented production Dockerfile starts `FROM node:24-alpine`.
The "Node 20 LTS" mandated in three project documents is an inherited **frontend** pin (`>=20.9.0 <23`) that has
nothing to do with the backend — and the build machine runs **Node v24.11.0**, so copying `<23` would make
`svbackend` refuse to install on the machine it is being built on.

**Constrains.** Do not copy `<23`. Noted for later: Payload **4** (canary only today) will require Node ≥24.15.0,
Next ≥16.2.6 and TS ≥6.0.3 — the local 24.11.0 is *below* 24.15.0, so a v4 migration carries a Node bump.

## D-018 — npm is the package manager for `svbackend`

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** **npm 11.6.1**, with `package-lock.json` committed. Every documented `pnpm payload …` command is
translated once, in writing, in `svbackend/README.md`.

**Why.** Official docs: *"Any JavaScript package manager (pnpm, npm, or yarn 2+ — pnpm is preferred, **yarn 1.x
is not supported**)"*. Measured on this machine: **npm 11.6.1, yarn 1.22.22, no pnpm.** yarn is therefore ruled
out by the vendor, pnpm is absent, and npm is present and supported. Committing the lockfile also activates the
`npm ci` branch of Payload's own official Dockerfile.

**Rejected alternative, named so it stays reversible:** installing pnpm via corepack to match every docs example
verbatim. Legitimate, and it costs one setup step; npm was chosen because it is already here and already
supported.

**Constrains.** Every CLI example in this corpus reads `npm run payload …` / `npx payload …`. ⚠️ Note that
`npx payload jobs:run` and `npm run payload …` are **inferred equivalents of the documented `pnpm payload …`
form, not separately documented**. The docs' own migration script additionally requires **`cross-env`** as a
dependency. If npm reports a peer conflict, the documented workaround is `npm i --legacy-peer-deps`.

## D-019 — `idType: 'uuid'`

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** The Postgres adapter is configured `idType: 'uuid'`. A config test asserts it so a later edit
cannot change it silently. **"ULID" is removed from `DATABASE-SCHEMA.md` §3.1.**

**Why.** The adapter accepts only `'serial'` or `'uuid'`; custom IDs *"can only be `Number` or `Text` fields"*,
so ULID is unavailable. `DATABASE-SCHEMA.md` specifies `Lead.id` as a UUID, and an unguessable id on a
PII-bearing record is worth having. The setting is **adapter-global, not per-collection, and effectively
irreversible**: changing it after migration 001 is a type change across every primary key and every foreign key
in ~50 child tables.

**Constrains.** Must be decided before migration 001. The API's opaque-string presentation is unaffected —
nothing in the frontend parses an id, and projects are addressed publicly by **`slug`**; `types/content.ts` has
no `id` on `Project` at all. The `req_01JBX…` **request id** is a different generator (our logging middleware)
and may remain a ULID. ⚠️ Two things the docs do not state and that must be read off `generate:db-schema` in the
Phase 1 spike: the **uuid version** generated, and whether the column is native `uuid` or `varchar`.

## D-020 — `status` is a reserved field name; the fields are `projectStatus` and `leadStatus`

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** The Payload field on `projects` is **`projectStatus`** and on `leads` is **`leadStatus`**.
`toPublicProject()` maps `projectStatus` back to the public key **`status`**, which `types/content.ts:63`
requires and which does not change.

**Why.** Official docs, verbatim: *"Payload reserves various field names for internal use. **Using reserved
field names will result in your field being sanitized from the config.** The following field names are forbidden
and cannot be used: `__v` · `salt` · `hash` · `file` · **`status` — with Postgres Adapter and when drafts are
enabled**."* Drafts **are** enabled on `projects` (D-005). The failure is **silent**: the field disappears, no
error is raised.

**Constrains.** Decide before migration 001 — renaming after data exists is a data migration. `leads` carries no
`versions` block, so the reservation would not bite there today, but the name is aligned anyway so that enabling
versions later cannot silently delete the column. The public contract is unchanged in both directions.

## D-021 — Ordering is `orderable: true`; the integer `sort_order` is deleted

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** Collections that need admin-controlled order set **`orderable: true`**. `sort_order` / `sortOrder`
is deleted from `DATABASE-SCHEMA.md`, `VALIDATION-RULES.md` and `API-CONTRACT.md`. The order key is **never
exposed publicly**.

**Why.** Official docs: *"If true, enables custom ordering for the collection, and documents can be reordered via
drag and drop"* and *"When `orderable` is enabled, Payload uses **fractional indexing** to efficiently manage
document order"* (helpers `generateKeyBetween` / `generateNKeysBetween` from `payload/shared`). Fractional
indexes are **strings, not integers**. Hand-rolling an integer order would re-incur exactly the cost that got
Strapi rejected — *"collection ordering is not natively drag-and-drop, and D-005 makes ordering a first-class
requirement."*

**Constrains.** ⚠️ **The name of the field `orderable` creates is NOT DOCUMENTED** — read it off
`npx payload generate:db-schema` in the Phase 1 spike, before migration 001, so the public list query can sort on
it. `PATCH /admin/projects/order` and its six siblings are either dropped or kept only as compatibility shims
that convert positional integers to fractional keys via `generateNKeysBetween` — and as shims they must also fix
the `order`-vs-`{id}` path collision.

## D-022 — Physical naming is explicit: unnamed tabs, `dbName` on every array, `enumName` on every select

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** Tabs in the project editor are **unnamed** (presentational only). **`dbName` is set explicitly on
every array field** and **`enumName` explicitly on every `select`**.

**Why.** Named tabs **group their data into an object in the database**; unnamed tabs do not. Choosing named tabs
and reversing later is a data migration, not a UI tweak — and an unnamed tab keeps the stored shape flat, which
keeps the serialiser simple. For `dbName`/`enumName`: Payload's derivation is **undocumented**, deeply nested
paths risk Postgres' **63-byte identifier limit** with silent truncation collisions, and auto-generated enum names
would produce a *separate* Postgres enum per icon field — six identical types, six `ALTER TYPE` statements per
icon change, doubled again by the `_v` tables.

**Constrains.** Must be decided before migration 001. ⚠️ **Whether Payload deduplicates an identical `enumName`
across fields into a single Postgres type is NOT VERIFIED** — spike it by running `generate:db-schema` with two
icon fields sharing an `enumName` and counting the emitted enums. If it does not dedupe, accept six and write the
migration as a loop, but know that going in.

## D-023 — URL layout: `routes.api` stays `/api`, the public contract is Next.js Route Handlers at `/api/v1/**`

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** `routes.api` keeps its default **`/api`** and `routes.admin` its default **`/admin`**. **The entire
public contract at `/api/v1/**` is implemented as Next.js Route Handlers** under `src/app/(public)/api/v1/`, and
`/healthz` and `/livez` are **root** Route Handlers outside `/api`. **No Payload `config.endpoints` entry is
used.** `/api/v1/admin/**` does not exist and is not built.

**Why.** Official docs, verbatim: *"Custom endpoints defined in your Payload Config are **always** mounted under
your configured `routes.api` path (default: `/api`). To define a route that is not prefixed by this path, add a
Next.js Route Handler at the desired location in your app directory."* Our contract specifies `/api/v1/**` and
`/healthz` **outside** `/api` — neither is expressible as a Payload endpoint. **Moving `routes.api` also moves
every config-level `endpoints` entry: they travel together**, so there is no configuration that keeps one where
the contract wants it. Mixing the two mechanisms would produce inconsistent error shapes and auth behaviour, so
exactly one is used.

**Constrains.** Route Handlers receive **no `PayloadRequest`** — no `req.user`, no ambient transaction — which is
fine for read-only public reads and must be handled deliberately for `POST /api/v1/leads`. **CORS and preflight
are entirely ours** (D-030's sibling problem): `headersWithCors` in a shared wrapper, and ⚠️ **preflight
behaviour for hand-written routes is NOT DOCUMENTED — register an `options` handler and test it.** `/healthz`
needs `export const dynamic = 'force-dynamic'` or it may be statically generated at build. ⚠️ Do not design
around an endpoint property **`root: true`** — **it does not exist in the v3 docs.**

## D-024 — Generated-surface lockdown: GraphQL disabled, access control everywhere, infrastructure block

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** Risk R-9's mitigation is, in this order: (1) **`graphQL: { disable: true }`** at the root;
(2) an **explicit `access` block on 100 % of collections and globals**, including **`readVersions`**;
(3) an **infrastructure-level block** of `{routes.api}/<slug>` paths that are not ours, at the reverse proxy;
(4) a **Phase 10 negative test** that no public route returns lead or draft data.

**Why.** *"Disable or lock down every generated endpoint"* names no mechanism and Payload documents none for
REST. `graphQL.disable: true` exists and removes GraphQL entirely — and since we hand-write REST, GraphQL is
pure attack surface. **There is no documented REST equivalent:** the collection option `endpoints` is described
only as *"Add custom routes to the REST API. Set to `false` to disable routes"*, and **its scope is not stated**.
Access control is therefore the only documented lever over the generated routes.

**Constrains.** **`endpoints: false` is UNVERIFIED** and must be tested empirically before any security claim
rests on it. The lockdown must cover `{routes.api}/{collection}/versions` too — version records are a second copy
of every approval/RERA/title claim ever entered. **`admin.hidden` is navigation only and is never a security
control.**

## D-025 — Every public read passes three independent safety layers

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** Mandatory on every public read, all three:
1. collection `access.read` returns a query constraint — `({ req }) => req.user ? true : { _status: { equals: 'published' } }`;
2. `overrideAccess: false` **and** `user: undefined` on every Local API call in a public handler;
3. a hard-coded `where: { _status: { equals: 'published' } }` the caller cannot override.

A single shared **`publicFind()`** helper is the **only** permitted way a public handler reads content — **no bare
`payload.find` in a public file** — and `draft` is never forwarded from user input.

**Why.** Three independent official statements: *"In the Local API, all Access Control is **skipped** by
default."* · `overrideAccess` — *"By default, this property is set to `true` within all Local API operations."* ·
*"**Custom endpoints are not authenticated by default. You are responsible for securing your own endpoints.**"*
And on drafts: *"the `draft` argument on its own will not restrict documents with `_status: 'draft'` from being
returned from the API"*, combined with *"When you first create a document, it's always written to the main
collection"* — so **a never-published project is returned by an ordinary `payload.find()`**. Two independent leak
paths sit under D-015's hand-written public surface.

**Constrains.** Phase 10 carries explicit negative tests: an unpublished project must **404**, `GET
{routes.api}/leads` must return nothing anonymously, and `?draft=true` and `?where[_status][equals]=draft` must
both **404**. Do **not** copy Payload's documented `_status: { exists: false }` OR-branch — it exists for
collections that pre-date drafts; enable drafts from the first migration so no `_status`-less rows exist.

## D-026 — Soft delete is Payload Trash, declared explicitly on every collection

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** D-006 is realised as **`trash: true`** on `projects`, `media`, `documents`, `leads`,
`testimonials`, `faqs` and `statistics`; **`trash: false`** on `users` (with `delete: () => false`) and on
`audit-log`. **Every collection states it — silence is not acceptable.** The admin list hides trashed rows via
`admin.baseFilter`.

**Why.** Official docs: *"**Trash** (also known as soft delete) allows documents to be marked as deleted without
being permanently removed… deleted documents will receive a **`deletedAt`** timestamp"*, plus the collection
option `trash` — *"Boolean to enable soft deletes for this collection. **Defaults to false.**"* Two research
files contradicted each other on whether this feature exists; the docs settle it. Hand-rolling a `deletedAt`
field would have produced a duplicate of a native feature.

**Constrains.** The option **defaults to `false`**, so an omission means hard delete. ⚠️ The option is
**`baseFilter`, not `baseListFilter`**. ⚠️ A trashed document *"can no longer have a version restored until it is
first restored from trash"* — surface that in the restore UI copy. `statistics` gets the same treatment as its
siblings, correcting the one content entity that had a `DELETE` endpoint and no soft-delete column.

## D-027 — The job queue is Payload's `payload-jobs`; `notification_jobs` is not built

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** `DATABASE-SCHEMA.md` Table 15 is deleted. Lead notification is a Payload **Task**
(`sendLeadNotification`), enqueued by an `afterChange` hook on `leads`, run by a supervised runner.

**Why.** Payload's Jobs Queue is a first-party feature — the `payload-jobs` collection, tasks, workflows,
retries, `waitUntil`, cron schedules and an admin surface — and the field mapping to the hand-designed table is
**one-to-one**. Building our own would mean a second queue, a second runner and a second failure surface for one
async task.

**Constrains — and these are the reason this entry exists.** **Both failure modes are silent.** With no runner
configured, queued jobs *"will never be executed"* and nothing in the request path errors: the lead saves, the
API returns `201`, nobody is told. With no email adapter configured, **Payload logs a warning rather than
throwing**, so the task can complete and report success having sent nothing. Payload documents **no backoff
configuration and no dead-letter queue**, while `INTEGRATIONS.md` §2 requires a dead-letter path. Therefore three
**named deliverables**, not assumptions: a **boot-time assertion** refusing to start in production without a
configured SMTP host and `SALES_NOTIFICATION_EMAIL`; a **supervised runner** with a liveness check plus monitoring
on queue depth and oldest-pending-job age; and a **watchdog task** alerting through a second channel. The task
must be **idempotent** (set `notifiedAt`, short-circuit) — retries are at-least-once.

## D-028 — Versions policy: explicit everywhere, `autosave: false`, `readVersions` admin-only

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** No `versions` block inherits a default. `projects` uses `maxPerDoc: 20`; `testimonials`, `faqs`
and `statistics` use `maxPerDoc: 10`; the `site-settings` **global** uses **`max: 50`** (⚠️ globals use `max`,
collections use `maxPerDoc` — writing `maxPerDoc` on a global is silently ignored). `leads`, `media`,
`documents`, `users` and `audit-log` carry **no `versions` key at all**. **`autosave: false` everywhere.**
`readVersions` is **admin-only and explicit** on every versioned collection.

**Why.** `maxPerDoc` defaults to **100**; inheriting it on nine entities is how a five-project brochure site ends
up with version tables larger than its content tables. **Autosave defaults to an 800 ms write interval, every
autosave is a real database write, and every autosave fires the collection's `afterChange` hooks** — and D-038
puts the audit log and the revalidation webhook on exactly those hooks, so an editor typing a paragraph would
produce an audit row and a revalidation call roughly every second. ⚠️ **The hook-argument property that
identifies an autosave write is NOT DOCUMENTED**, so the guard cannot even be written correctly today.
`readVersions` matters because version records are a **second copy of every approval / RERA / title claim ever
entered**, and its default when omitted is undocumented.

**Constrains.** Versioning an operational/PII collection multiplies PII copies — hence none on `leads`. A version
table on an audit table is a second, prunable copy of the thing that must not be prunable — hence none on
`audit-log`. Phase 4 exit: *"exactly one audit row per admin mutation, verified by editing and publishing one
project."* Autosave may be enabled later **only** after the autosave signal is established empirically and the
audit guard proven.

## D-029 — Authentication mechanism, stated accurately

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** Payload's local auth strategy owns the `users` collection. Passwords are stored as a per-user salt
plus a **PBKDF2-SHA256** derived key, and `salt`/`hash` are stripped from every read. **`auth.disableLocalStrategy`
is never used. `auth.useSessions` is never set to `false`.** Compensating controls: minimum password length ≥12
via a `password` field `validate`, `maxLoginAttempts` + `lockTime`, admin-only account creation, and edge rate
limiting.

**Why.** Official docs: *"The `hash` field stores a **PBKDF2-SHA256** derived key prefixed with the scheme it was
created with, for example `pbkdf2-sha256-v1:<derived-key>`."* The `auth` config exposes **13 options and none
concerns hashing**. **argon2id, mandated in three documents, is not achievable.** The only escape —
`disableLocalStrategy: true` plus a hand-written strategy — is gated by the docs' own warning and would forfeit
login, forgot-password, reset-password, unlock, `maxLoginAttempts`/`lockTime`, the admin login UI **and the
session machinery D-004 depends on**: it destroys more security than it buys. `useSessions: false` yields
stateless JWTs which *"cannot be revoked."*

**Constrains.** `SECURITY.md` is a client-facing document; leaving "argon2id" in it means publishing a control
that will be false in production. FR-AUTH-04 and `TRACEABILITY.md` §5 carry the same claim and are corrected in
the same pass.

## D-030 — All HTTP rate limiting is edge infrastructure, not application configuration

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** Every limit in `SECURITY.md` §11 is implemented at the reverse proxy / CDN / WAF in front of the
container and is a **tracked infrastructure deliverable**. **No `RATE_LIMIT_*` application variable exists.**
Phase 10 carries an explicit test that each limit fires, returning `429` with `Retry-After`.

**Why.** **Payload 3 ships no HTTP rate limiting.** v2's Express-era `rateLimit` option is gone; the dedicated
*Preventing Production API Abuse* page has sections for *Limit Failed Login Attempts, Max Depth, CSRF, CORS,
Limiting GraphQL Complexity, Malicious File Uploads* — **no rate-limiting section and no recommended
replacement**; the only occurrence of "rate limit" in the entire documentation bundle is an example of throwing
your own `APIError`. Payload contributes only `auth.maxLoginAttempts` and `auth.lockTime` (**per account, not per
IP**), `auth.forgotPassword.minRequestInterval` (default 15 000 ms), `maxDepth`, `defaultMaxTextLength` and
`graphQL.maxComplexity`.

**Constrains.** The **requirements stand** — FR-AUTH-08 and FR-LEAD-07 are CONFIRMED/P0 and every number in
`SECURITY.md` §11 is unchanged. Only the ownership moves. ⚠️ **One interaction must be built into the rule:**
under D-012's ISR model, public `GET`s originate from **one build machine**, so a naive per-IP ceiling on public
GETs will throttle a full site rebuild — the limit needs a **build-origin exemption**. An app-level
`RATE_LIMIT_*` variable would imply the application enforces something it does not, which is the most dangerous
kind of wrong documentation.

## D-031 — Content localization is deliberately deferred; `localization` is not enabled

**Date:** 20 Sep 2026 · **Status:** ACCEPTED *(technical deferral; whether the site is ever multilingual remains an owner question — OQ-25)*

**Decision.** **`localization` is not enabled.** The deferral and its cost are recorded in
`DATABASE-SCHEMA.md` **and as a comment in `payload.config.ts`**, so its absence is never read as an oversight.
Admin-panel `i18n` is narrowed to `{ en }`.

**Why.** The Postgres adapter puts localized fields in **a separate `_locales` table per collection**
(`localesSuffix`). Turning `localization` on after data exists is a **physical schema change across every
localized field**, on a model that already produces ~18–20 physical tables for `Project` alone before versions.
OQ-25's own body says *"decide before the schema is finalised, or accept a painful migration later"* — while the
register rated it ⚪ informational, which is the rating a future session would have acted on.

**Constrains.** Must be recorded before migration 001. **Content localization (`localization`, schema-affecting,
deferred) and admin-panel language (`i18n`, free, reversible) are different things** — no project document
currently draws that distinction. This decision defers the first and narrows the second; it does **not** decide
whether the business ever wants Telugu, which stays with the owner.

## D-032 — Media splits into two upload collections: `media` (images) and `documents` (PDFs)

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** Two upload collections. **`media`**: `image/jpeg`, `image/png`, `image/webp`, `image/avif`, with
`imageSizes` as needed. **`documents`**: `application/pdf` only, ≤25 MB, `crop: false`, **no `imageSizes`**, a
static `adminThumbnail`. The site logo is a plain `upload` field on the `site-settings` global. Both collections
are `trash: true`.

**Why.** ⚠️ **A single Payload upload collection cannot express two different `mimeTypes` allow-lists**, and
images and PDFs need different ones — that is the whole reason for the split. Sharp cannot thumbnail a PDF, so
`documents` needs a static `adminThumbnail`. It also gives FR-MEDIA-10 (master-plan PDF, P1) a real home: the
site-scoped `document` role previously had **no table, no column, no endpoint and no requirement binding**, while
`pages.ts:254` needs `masterPlan.downloadHref`.

**Constrains.** `MEDIA-MANAGEMENT.md` §4's single seven-row table is split into **"Project media roles (5)"** and
**"Site-scoped media (2)"** — the two halves were answering different questions and had been merged by mistake.
The in-use delete guard must count references across `media`, `documents`, all four upload fields on `projects`
**and** the `site-settings` global.

## D-033 — The public serialiser contract (extends D-008)

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** `toPublicProject()` and every sibling serialiser:
1. **build output key by key.** `...doc` spread is **banned in the public-API module** by review rule;
2. **omit every absent optional field — scalar, array and object alike. Never `null`, never `[]`, never `""`.**
   The only optional field always emitted is `featured`, because `false` is assignable to `boolean | undefined`;
3. **never emit** `_status`, `id`, `createdAt`, `updatedAt`, `publishedAt`, `deletedAt`, `_order` / any
   fractional order key, `createdBy`, `updatedBy`, **any array-row `id`**, or `hasPlaceholders`; and on an
   `ImageRef`, nothing except **exactly** `{ src, alt, width, height }`;
4. **emit `^\[.*\]$` values verbatim** — never trimmed, never defaulted, never omitted for looking like a
   placeholder;
5. **fall back to `'check'`** rather than passing an unknown icon name through.

**Why.** `svfrontend/tsconfig.json` runs `strict: true` and `Project`'s optional fields are typed `T | undefined`,
so a response returning `null` for an absent field **is not assignable** — it produces a **compile failure in the
other repository**, not a bug report. `select` cannot do any of this: *"A selected-but-empty field still returns
as `null`"* and *"the `id` field is always included in the result, regardless of your select query."* On
placeholders: `svfrontend/src/lib/href.ts:5-7` requires the **whole** string to be bracketed, so stripping
brackets ships a **live-looking dead link** — the exact failure the frontend was built to prevent.

**Constrains.** The acceptance test is a **specific record**: `GET /api/v1/projects/siri-vanam-gummadavelli` must
return **exactly** `{slug, name, category, locality, tagline, summary, description, highlights, image, featured}`.
A mirror assertion runs against the fattest record `sri-nivasam-swarnagiri`, plus two structural assertions —
every array row carries **no `id`**, and every `ImageRef` carries **exactly four keys**. This is Phase 1 exit
criterion #4 and is inside the D-015 gate (FIX-03).

## D-034 — One shared constants module, with a CI drift check against `svfrontend`

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** `ICON_NAMES` (41 values), the four `category` values, the four `projectStatus` values, the six
provisional `leadStatus` values, every length limit and the phone-digit threshold live in **one shared constants
module**, imported by **both** the Payload field config **and** the Zod schemas **and** the seed. A **CI job
diffs `ICON_NAMES` against `svfrontend/src/components/ui/Icon.tsx`** and fails the build on drift.

**Why.** NFR-11's stated mechanism — *"define each schema once (Zod)"* — **is not achievable under D-015**: admin
UI form rules and DB constraints come from Payload field config while public Route Handlers use Zod. That is two
definitions of "phone must be ≥N digits", which is exactly what NFR-11 exists to prevent. Sharing the
*constants* preserves the intent with the mechanism that exists. The CI diff is necessary because **the
`IconName` union lives in the other repository** and nothing else will catch a change to it — and an
out-of-union icon renders as *"a silent, invisible 24 px blank box. No error, no warning, no visual indication in
logs."*

**Constrains.** **Stop maintaining the icon count by hand** — it appears in five documents and already produced a
40-vs-41 disagreement in the research record. Adding an icon remains a **frontend code change first**, then a
constants update (D-007's consequence, unchanged).

## D-035 — `CONSENT_REQUIRED` is the tenth top-level error code

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** `API-CONTRACT.md`'s top-level error vocabulary becomes **ten** codes, adding **`CONSENT_REQUIRED`**
(`422`). Payload `APIError`s thrown from hooks are **translated into the project's error envelope by the same
error handler that produces `requestId`**.

**Why.** `CONSENT_REQUIRED` is already normative in four documents — **D-011 (ACCEPTED, owner-signed) states the
top-level form verbatim**, and `VALIDATION-RULES.md` §6, `API-CONTRACT.md`'s content section and
`BACKEND-ROADMAP.md` Phase 8's exit criterion all use it. It appears in neither the nine-code top-level list nor
the twelve-value `details[].code` list. **Correcting the vocabulary leaves a signed decision untouched; demoting
the code to a `details[].code` would require editing one.** The translation rule exists because Payload's native
error body is a different shape, and nothing in the corpus currently says who converts it.

**Rejected alternative, named so it stays reversible:** express consent as `VALIDATION_ERROR` with
`details[0] = { field: 'consented', code: 'CONSENT_REQUIRED', … }`, keeping the top-level list closed at nine and
reusing the inline-error rendering path. Equally defensible on API-design grounds; rejected only because it would
mean amending D-011.

## D-036 — Idempotency TTL 24 hours; lead dedupe window 10 minutes

**Date:** 20 Sep 2026 · **Status:** ACCEPTED *(technical only — the lead record's own retention lifetime remains an owner question)*

**Decision.** `Idempotency-Key` has a **24-hour TTL**; a repeat key inside the window returns the original `201`
**verbatim**. Lead dedupe is **10 minutes** on `(phoneNormalised, projectSlug)`. `ipAddress` / `userAgent` purge
at **90 days**. The dedupe window is a **constant in `src/hooks/leadDedupe.ts`, not an environment variable.**

**Why.** Three windows were required by the specification and none was given a number. 24 hours is sufficient for
a mobile double-submit and bounded in storage. 10 minutes is long enough to absorb a retry and short enough that
a genuine second enquiry about the same project the same afternoon is not swallowed. 90 days for `ipAddress` /
`userAgent` is already the figure `SECURITY.md` §17 proposes and is accepted as written. The dedupe window is a
constant rather than a variable because **widening it rejects real enquiries and narrowing it admits spam** — a
behaviour change that belongs in a reviewed commit, not in a platform console where it can be changed with no
diff and no audit trail.

**Constrains.** ⚠️ A **time-windowed partial unique index is not expressible in Postgres** (non-immutable
predicate), so dedupe is application logic in a `beforeValidate` hook over a **non-unique** compound index.
**`phoneNormalised` is explicitly NOT unique** — one buyer may legitimately enquire about several projects.
**The lead record's own retention lifetime is NOT decided here**: it must be stated in the privacy policy and is
an owner decision (OQ-24).

## D-037 — `svbackend/` becomes a git repository before the scaffold

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** `git init` `svbackend/` (or add it to a workspace repo) and commit the 18 specification documents
**before** scaffolding, so the scaffold arrives as a reviewable diff. Scaffold procedure: create in a temporary
directory → move `docs/` in → commit. `.gitignore` blocks `.env*` and allow-lists `.env.example`.

**Why.** Measured: `svbackend/` contains **only `docs/`**, is **not a git repository**, and has no remote and no
history — while `svfrontend` is a clean git repo on `main` (remote `RiseNext/sv-dev`). Roughly 3 500 lines of
specification are currently unversioned, including every document this correction plan edits. ⚠️ Separately,
**whether `create-payload-app` refuses a non-empty directory is NOT VERIFIED IN OFFICIAL DOCS**, which is why the
temp-directory procedure is specified rather than discovered.

**Constrains.** D-014 (documentation location) assumed a repository; this entry supplies the missing step rather
than changing D-014. It also makes the corrections in this plan auditable: without history, "what did the
document say before?" has no answer. R-8's instruction — *"two Next.js apps in one workspace… document clearly in
`AI-CONTEXT.md`"* — is satisfied by FIX-21.

## D-038 — The audit log is written entirely by hooks; versions contribute nothing to it

**Date:** 20 Sep 2026 · **Status:** ACCEPTED

**Decision.** A dedicated **`audit-log` collection** with `create`, `update` and `delete` access all `() => false`
— **only hooks write, via `overrideAccess`** — `read` admin-only, **no `versions` block**, `trash: false`. Fed by
a shared `afterChange` / `afterDelete` **collection** hook plus Payload's `afterLogin` / `afterLogout` /
`afterForgotPassword` auth hooks. The `action` vocabulary is **eleven** values: `create`, `update`, `publish`,
`unpublish`, `delete`, `restore`, `login`, `logout`, `login_failed`, `lockout`, `password_change`, with
`enumName: 'enum_audit_action'`.

**Why.** Payload's version history contributes **nothing** the audit requirement needs: a version document's
documented properties are exactly `_id`, `parent`, `autosave`, `version`, `createdAt`, `updatedAt` — **no actor,
no IP, no action type, no auth events** — and `maxPerDoc` discards history while `restoreVersion` mutates, both
of which violate append-only. Two documents currently rate the audit log *"🟡 Hooks write entries; Payload's
version history covers part of it"*, **and that wording is the actual hazard** — a future session will read it
and trust it. The **hooks must live on the collections, not on custom endpoints**: the Admin UI publishes through
its own button and never touches our endpoints, so endpoint-level logging would produce an audit log that is
empty in production. The previous seven-value enum omitted four values the system will emit, and a Postgres enum
**rejects** an unlisted value at write time — the hook would throw on the first logout.

**Constrains.** ⚠️ **`lockout` must be derived** — `maxLoginAttempts`/`lockTime` emits no event, so the hook
detects the transition. The same `afterChange` seam carries the **D-012 revalidation webhook**, which is why
`autosave: false` (D-028) is load-bearing for both. `enumName` is explicit so a later value is one
`ALTER TYPE … ADD VALUE`. Per-session `ip` / `user_agent` review — lost with `admin_sessions` (D-004 as amended)
— is rebuilt here.

---

---

## Pending — recommendations awaiting sign-off

These are **PROPOSED defaults**, not decisions. Each is the recommended answer to an open question; none may be treated as settled.

| Ref | Recommendation | OQ |
|---|---|---|
| ~~P-01~~ | ~~Node + TypeScript + Fastify + Prisma + PostgreSQL~~ ✅ **SUPERSEDED by D-015 (18 Sep 2026).** The stack is Payload CMS 3 on its own Next.js app with the Postgres adapter and Drizzle-based migrations. **Neither Fastify nor Prisma is used.** Retained struck-through rather than deleted, because `ARCHITECTURE.md` §2 still describes this stack and a reader comparing the two documents needs to see which one lost. | — |
| P-02 | S3-compatible object storage (not a transforming media SaaS) | OQ-7 |
| P-03 | Resend or SES for transactional email | OQ-7 |
| P-04 | Single `admin` role; `role` column present for future expansion | OQ-4 |
| P-05 | Persist leads in our DB **and** email sales | OQ-1 |
| P-06 | Ship `status` column but hide the control until confirmed | OQ-3 |
| P-07 | Separate admin SPA on its own subdomain | OQ-5 |
| P-08 | Standardise phone validation on **10 digits** | OQ-19 |
| P-09 | No password reset initially | OQ-8 |
| P-10 | Lock slug after publish, override with warning | OQ-9 |
| P-11 | Keep `noindex` in code, not as an admin toggle | OQ-12 |
| P-12 | Surface unresolved `[BRACKETED]` placeholders in the admin | OQ-15 |
| ~~P-13~~ | ~~Build custom rather than adopt a headless CMS~~ | ✅ **RESOLVED by D-015 — decided the other way: Payload CMS 3** |

> ✅ **P-13 / OQ-21 is settled.** The earlier recommendation (build custom) was **overturned** by the full evaluation in `IMPLEMENTATION-DECISION.md`: it under-weighted admin-UI cost, and it wrongly assumed a CMS could not produce the exact documented API shape. Payload's custom endpoints remove that objection.
>
> **Still-open recommendations that D-015 touches:**
> - **P-07** (separate admin SPA) — superseded in part: the admin UI is now served by the backend app itself. OQ-5's remaining question is who builds the custom components.
> - **D-004** (server-side sessions) — needs amending to match Payload's httpOnly cookie model. Still PROPOSED.
> - **P-02 / P-03** (storage and email providers) — **unaffected**; OQ-7 remains open.

---

# MASTER IMPLEMENTATION RUN â€” 20 September 2026

> Decisions taken during the master implementation run, in the order of
> `MASTER-IMPLEMENTATION-PLAN.md` Â§29 Phase 0 (steps 1â€“22). Each is a decision an
> implementer had to make before writing a line of code, recorded so it is never
> re-derived. **Owner/business questions remain open and are NOT decided here** â€”
> see D-100 and plan Â§26.5.

## D-100 â€” Scope of engineering authority in this run Â· ACCEPTED

The master implementation prompt authorises engineering to execute the entire plan
autonomously, **including Phase 9 frontend integration** (plan Â§29 step 181's human
approval gate, T-170). That authorisation is the recorded approval.

It does **not** authorise inventing business decisions. Every "safe temporary
default" adopted below is recorded as *engineering adopted the documented interim
behaviour*, never as the owner's answer. The owner decisions listed in plan Â§26.5
(company name OQ-6, bracketed values OQ-22, testimonials OQ-23, privacy policy
OQ-24, CRM OQ-1, notification recipient OQ-2, providers OQ-7, brochure gating
OQ-18, lead retention lifetime, photography, hosting vendor) remain **OPEN**.

## D-101 â€” Toolchain, measured Â· ACCEPTED  *(plan step 2, T-016)*

| Tool | Measured |
|---|---|
| Node | **v24.11.0** |
| npm | **11.6.1** |
| Docker | **29.3.1** (Desktop; daemon started for this run) |
| git | **2.47.1.windows.1** |
| `psql` | **absent from PATH** â€” all Postgres client tooling goes through `docker run postgres:15` |

Node 24 confirmed acceptable: `payload@3.90.1` declares `engines.node: "^18.20.2 || >=20.9.0"`,
verified live against the npm registry during this run. `svbackend` sets
`engines.node: ">=20.9.0"` and **does not** copy `svfrontend`'s `<23`.

## D-102 â€” Package manager: npm Â· ACCEPTED  *(plan step 3, OQ-36)*

npm 11.6.1. yarn 1.22.22 is explicitly unsupported by Payload; pnpm is not installed.
`package-lock.json` is committed. Every `pnpm payload â€¦` in the official docs
translates to `npm run payload -- â€¦`; recorded in `svbackend/README.md`.

## D-103 â€” Exact version pins Â· ACCEPTED  *(plan step 4, OQ-35, T-004)*

**Verified live against the npm registry during this run**, not assumed:

| Package | Pin | Registry evidence |
|---|---|---|
| `payload` | `3.90.1` exact | `dist-tags.latest = 3.90.1` |
| `@payloadcms/next` | `3.90.1` exact | peer `next: ">=15.2.9 <15.3.0 \|\| >=15.3.9 <15.4.0 \|\| >=15.4.11 <15.5.0 \|\| >=16.3.3 <17.0.0"` â€” **confirms the plan's Â§3.3 claim verbatim** |
| `@payloadcms/db-postgres` | `3.90.1` exact | peer `payload: 3.90.1` |
| `@payloadcms/storage-s3` | `3.90.1` exact | â€” |
| `@payloadcms/email-nodemailer` | `3.90.1` exact | â€” |
| `next` | `16.3.3` exact | published; the lowest version inside the supported 16.x range |
| `react` / `react-dom` | `19.2.6` exact | published |
| `graphql` | `^16.8.1` | **a declared peer of `payload` itself** â€” installed even though `graphQL.disable: true` |
| `sharp` | `^0.34.5` | plan Â§3.1 pins 0.34.x; 0.35.x exists but the plan's pin is honoured |
| `zod` | `^4` | |
| `pino` / `pino-pretty` | `^9` | |
| `file-type` | `^21` | |
| `vitest` | `^3` | |
| `cross-env` | `^7` | required by the docs' own npm scripts |

`svfrontend` stays on Next **15.5.25**, which is outside every supported range.
The two apps can never share a dependency tree. **Never match the backend's Next
version to the frontend's.**

## D-104 â€” `idType: 'uuid'` Â· ACCEPTED  *(plan step 5, OQ-27)*

Adapter-global and **effectively irreversible after migration 001** â€” changing it
later is a type change across every PK and FK in ~50 child tables. ULID is not a
supported value; only `'serial'` and `'uuid'` exist.

## D-105 â€” Reserved-name renames Â· ACCEPTED  *(plan step 6, OQ-28, P6)*

`Project.status` â†’ **`projectStatus`**; `Lead.status` â†’ **`leadStatus`**.
`status` is reserved on Postgres collections with drafts enabled, and *"using
reserved field names will result in your field being sanitized from the config"* â€”
silently. `toPublicProject()` aliases `projectStatus` back to the public key
`status`, so `svfrontend/src/types/content.ts` is unchanged.

## D-106 â€” Unnamed `tabs` everywhere Â· ACCEPTED  *(plan step 7, OQ-30)*

Named tabs group data into an object in the database; unnamed tabs are purely
presentational. Unnamed keeps the stored shape flat and the serialiser simple.
Changing later is a data migration, not a UI tweak.

## D-107 â€” `localization` is NOT enabled Â· ACCEPTED  *(plan step 8, OQ-25)*

**English only. Telugu is deferred.** Confirmed as settled project scope by the
project owner in the master implementation instruction.

**The cost of the deferral, recorded so its absence is never read as an oversight:**
Payload's Postgres adapter puts localized fields in a **separate `_locales` table per
collection**. Enabling `localization` after data exists is a physical schema change
across every localized field, on top of a model that already produces ~18 tables for
`projects` alone. It is not a config flip; it is a data migration.

Admin-panel `i18n` is narrowed to `{ en }` â€” a **different, free, reversible** thing
from content localization. No document draws that distinction; it is drawn here.

## D-108 â€” Public URL layout Â· ACCEPTED  *(plan step 9, OQ-34, T-014)*

- Public contract: **Next.js Route Handlers** under `src/app/(public)/api/v1/**`
- `/healthz` and `/livez`: root Route Handlers, **outside `/api`**
- Payload's generated REST: relocated to **`/payload-api`**
- GraphQL: **disabled** (`graphQL: { disable: true }`)
- `src/endpoints/` stays **empty by decision**

Forced by two documented facts: Payload `config.endpoints` are *always* mounted under
`routes.api`, and six of our public paths (`projects`, `testimonials`, `faqs`,
`statistics`, `leads`, `media`) are collection slugs â€” leaving `routes.api` at `/api`
would collide Payload's raw document shape with our contract.
**Mixing the two mechanisms is the failure mode**, so one is chosen and enforced.

## D-109 â€” Deployment origins Â· INTERIM (owner supplies the domain)  *(plan step 10, T-015)*

Shape decided: `www.<domain>` (site) Â· `cms.<domain>` (admin + API) Â· `media.<domain>` (CDN).
**`cms` must be a subdomain of the public site's registrable domain** or admin cookies
become third-party and `SameSite=Lax` stops working â€” an architecture requirement, not
a preference. The literal domain is an owner deliverable.

## D-110 â€” REST-surface fork: option (A) Â· ACCEPTED  *(plan step 11, OQ-31)*

`access.read` returns a published-only `Where` for anonymous callers, **plus** an
infrastructure block on `/payload-api/<collection-slug>` at the reverse proxy.

Recorded explicitly: **there is no documented REST kill switch in Payload 3.** The
collection `endpoints: false` option's scope is unverified. Config alone cannot close
the generated surface; the edge block is load-bearing.

## D-111 â€” `notification_jobs` deleted in favour of `payload-jobs` Â· ACCEPTED  *(plan step 12, OQ-32)*

Field mapping recorded one-to-one so the intent survives the table's deletion:

| `notification_jobs` | `payload-jobs` |
|---|---|
| `status` | `completedAt` + `hasError` + `processing` |
| `attempts` | `totalTried` |
| `last_error` | `error` |
| `scheduled_for` | `waitUntil` |
| `payload` | `input` |

## D-112 â€” OQ-7 closed to a *shape* only Â· INTERIM  *(plan step 13, T-008)*

`@payloadcms/storage-s3` + `nodemailerAdapter` over SMTP. **The provider, region,
account and credential ownership remain the owner's.** Both are reduced to
environment variables; no code changes when the provider is chosen.

## D-113 â€” OQ-1 / OQ-2 / OQ-3 Â· INTERIM, engineering-adopted  *(plan step 14, T-009)*

- **OQ-1** â€” build the `leads` collection and persist. **No CRM integration** and none
  designed in. A CRM is later an additive `payload-jobs` task fed by the same
  `afterChange` hook. *Engineering adopted the interim posture; the owner has not ruled.*
- **OQ-2** â€” a single Task `sendLeadNotification`, instant, email-only, recipient from
  `SALES_NOTIFICATION_EMAIL`, **plus a boot guard that refuses to start in production
  if it is unset**, so the default can never silently become "nobody is notified".
  *The literal recipient address is an owner deliverable; it blocks production, not implementation.*
- **OQ-3** â€” `leadStatus` is **NOT built**. `ADMIN-CMS-SPEC.md` Â§5 is explicit:
  *"Do not default to building it."* The field is absent; adding it later is one
  additive migration.

## D-114 â€” OQ-19 phone transition Â· ACCEPTED as a time-boxed divergence  *(plan step 15, T-010)*

`MIN_PHONE_DIGITS = 8` in `src/lib/constants.ts`, imported by **both** the Zod schema
and the Payload field `validate`. This is **deliberately not P-08's "standardise on 10"**:
a backend enforcing 10 while the live form accepts 8 creates a silent lead-loss
regression inside the phase whose entire purpose is to stop lead loss.

**Closing condition:** the tightening to 10 ships in the **same release** that changes
`ContactForm.tsx:34` and `EnquiryPill.tsx:29`. All three move together or none moves.
Rejected submissions are logged (without being stored as leads) so anyone 422'd can be
re-contacted â€” the only signal that would ever reveal a mis-set threshold.

## D-115 â€” SVG seeding paradox resolved by rasterisation Â· ACCEPTED  *(plan step 16, T-011)*

1. The data seed **uploads nothing** â€” projects are created as drafts with
   `versions.drafts.validate: false`, so the required `image` is not enforced.
2. The asset seed **rasterises SVG to PNG offline**; the PNGs are **committed** to
   `src/seed/assets/` and uploaded through the normal pipeline, hooks and all.
3. **No SVG exception is created.** Rejected: *"allow SVG for the seeded five"*
   (a permanent hole for a temporary problem) and *"a seed path that bypasses the
   upload hook"* (a flag that skips magic-byte sniffing exists forever).

## D-116 â€” Phase 1 gate executed in place, not as a throwaway Â· ACCEPTED (deviation, recorded)

**Plan Â§29 Phase 1 specifies a throwaway spike in a temp directory, deleted at step 49.**
This run executes every gate criterion (#1â€“#8) against the real `svbackend` foundation
instead, under three conditions that preserve the gate's substance:

1. **No migration is created until the schema facts are measured.** The dev sandbox runs
   on Drizzle `push` (the documented dev default) until `generate:db-schema` has been read
   and recorded. Migration 001 is written only afterwards. The irreversibility the
   throwaway protects against is therefore still protected against.
2. **The gate report is written before any phase beyond 4 proceeds**, with a pass/fail
   verdict per criterion and the measured schema facts.
3. **A gate failure is reported as a failure and stops backend expansion**, exactly as
   Â§29 step 48 requires. Sunk cost is not a defence.

Rationale: the throwaway exists so the gate is not judged by people invested in the code.
In a single autonomous run the duplication costs a full rebuild of the foundation and buys
no additional independence. The measured-facts-before-migration-001 property â€” the part
that is actually irreversible â€” is preserved in full.

## D-117 â€” D-004 amended: Payload's session model Â· ACCEPTED-AS-AMENDED  *(plan step 17, OQ-26)*

**Mechanism struck** (*"an opaque session id with server-side session records"*);
**intent kept** (*httpOnly, not script-readable, server-revocable*).

Payload's httpOnly JWT cookie with `useSessions: true` satisfies **both** rationales.
`admin_sessions` is **not built**. `tokenVersion` is **not built** â€” the rationale it
was proposed to fix is met natively.

Four hard rules:
- **(a)** never set `useSessions: false` â€” *"Stateless JWTs cannot be revoked"*
- **(b)** account deactivation is a **two-step runbook entry**: set `isActive: false`
  **and** change that user's password as an admin (which *is* documented to end all
  their sessions). `isActive` is our field, not Payload's, so nothing revokes on it.
- **(c)** any script or hook that updates a user must **thread the acting user** â€”
  *"A Local API update that runs without an authenticated user has no session to keep,
  so it ends all of the user's sessions"* â€” or it silently logs that person out of everything.
- **(d)** `PAYLOAD_SECRET` rotation is **break-glass only**, never the revocation mechanism.

**OQ-26 is closed.** Risk R-3 downgraded.

## D-118 â€” FR-AUTH-04 argon2id: ACCEPTED DOCUMENTED DEVIATION  *(plan step 18, T-006)*

Payload stores a per-user salt and a **PBKDF2-SHA256** derived key, prefixed
`pbkdf2-sha256-v1:`. The `auth` config has 13 options and **none concerns hashing**.
Reaching argon2id requires `disableLocalStrategy: true` plus a hand-written strategy,
which forfeits login, forgot-password, reset-password, unlock, `maxLoginAttempts`/`lockTime`,
the admin login UI **and the session machinery D-117 depends on**.

**This is recorded as a deviation, not as "satisfied".** `REQUIREMENTS.md` FR-AUTH-04,
`SECURITY.md` Â§1 and `TRACEABILITY.md` Â§5 are amended to the vendor-accurate statement:
*"Passwords are never stored in reversible form. The CMS stores a per-user salt and a
PBKDF2-SHA256 derived key, and strips `salt` and `hash` from every read operation.
Never MD5, SHA-1 or plaintext."*

**Compensating controls, all of which we do own:** a 12-character minimum with a
breach-list check, `maxLoginAttempts: 5` + `lockTime: 900000`, admin-only account
creation, edge rate limiting on the login path, two admin accounts per environment,
and full auth-event auditing. Per NIST SP 800-63B there is **no forced rotation and
no composition rule**.

## D-119 â€” D-012 (ISR + on-demand revalidation) promoted to ACCEPTED  *(plan step 19, T-007)*

It was simultaneously PROPOSED and a hard deliverable. Now ACCEPTED.

## D-120 â€” "15 core tables" amended to "15 core logical entities"  *(plan step 20, T-012)*

`AI-CONTEXT.md`'s rule now reads: *15 core **logical entities**; Payload-generated
`_rels`, `_v`, `_locales` and array-child tables are exempt and are expected to number
40â€“60.* Left unamended, the next session counts fifty tables and concludes something
has gone badly wrong.

## D-121 â€” Project ordering deferred to the measured-schema step  *(plan step 22, OQ-29, T-003)*

`orderable: true` (native fractional-index **string** keys) is the intended mechanism;
integer `sort_order` is struck from `DATABASE-SCHEMA.md`, `VALIDATION-RULES.md` and
`API-CONTRACT.md`. **The name of the column `orderable` creates is not documented** and
must be measured from `generate:db-schema` before the public `sort` is written.
Closed in D-130 once measured.

