# AI-CONTEXT.md — Master context for SV Developers backend

> **Read this first, every session.** It is the authoritative orientation document.
> Last updated: **20 September 2026 (owner decision pass)** · Status: **BUILT and CONFIGURED — the backend exists, the D-015 gate PASSED, the frontend is integrated, production targets are chosen**
>
> 🟢 **Owner decisions, 20 Sep 2026** — company name **SV Developers** (D-122, closes OQ-6) · media storage **Cloudinary** (D-123, closes OQ-7a, replaces S3) · database **Neon PostgreSQL** (D-124) · the **domain and privacy-policy URL are deliberately still open** (D-125, OQ-24).
> **What to set before go-live, and what is still waiting on the owner:** [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md).
>
> 🟢 **What was actually built, measured rather than assumed:** [`PHASE-1-GATE-REPORT.md`](./PHASE-1-GATE-REPORT.md). It records four silent defects the gate caught, and every previously-unverified Payload behaviour that is now measured. **Read it before trusting a `NOT VERIFIED IN OFFICIAL DOCS` marker anywhere in this set — several are now resolved.**
> **Primary execution blueprint:** [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) · See §11b for the corrections that change what gets built, §12 for the source-of-truth hierarchy, and §12b for the binding safety rules.

---

## 1. What this project is

**SV Developers** is a real-estate business in Telangana, India, selling residential and farm **plots** (and one apartment building) across the Aler / Warangal-highway corridor, Bhongir, and Genome Valley near Hyderabad.

The software is **two halves**:

| Half | What it is | Who uses it | Where it lives |
|---|---|---|---|
| **Public website** | Marketing site — browse projects, read details, submit an enquiry. **No login.** | Anonymous visitors (prospective plot buyers) | `svfrontend/` — exists, built, working |
| **Admin backend / CMS** | Private system where staff manage projects, content, media and leads | **Administrators only** | `svbackend/` — **built** (see §11; this row said "does not exist yet" before implementation) |

The backend's job is to **become the source of the content the public website displays**, replacing today's hardcoded TypeScript content files, and to **capture and manage leads**.

## 2. What already exists

`svfrontend/` is a complete, working Next.js 15 site (App Router, React 19, TypeScript strict, Tailwind v4, GSAP, Lenis). It is cloned from `https://github.com/RiseNext/sv-dev`, branch `main`.

- **15 routes, all statically prerendered.** No SSR, no API routes, no server actions. *(Corrected 20 Sep 2026: previously “17”. Actual emitted routes = 7 static pages + 5 project details + 404 + `robots.txt` + `sitemap.xml` = **15**. `PRD.md` § “route patterns” enumerates them and its own list sums to 15.)*
- **All content is hardcoded** in `src/content/site.ts`, `src/content/pages.ts`, `src/content/projects.ts`.
- **5 projects** exist as typed objects in `projects.ts`.
- **The contact form has no endpoint.** It validates, then deliberately says "not connected to a handler yet" — it does **not** fake success.
- **No authentication of any kind** exists in the frontend.
- **Most factual values are `[BRACKETED]` placeholders** — phone, email, WhatsApp, address, domain, approval numbers, statistics, drive times. `lib/href.ts` renders bracketed destinations inert so a placeholder can never ship looking live.

Full evidence: `../../BACKEND-REQUIREMENTS.md` (the forensic frontend audit at the workspace root).

## 2b. Selected architecture — **DECIDED**

> **Payload CMS 3, self-hosted, on PostgreSQL — with hand-written custom endpoints for the public API.**
> Decided 18 Sep 2026. Full analysis: [`IMPLEMENTATION-DECISION.md`](./IMPLEMENTATION-DECISION.md) · Logged as `DECISIONS.md` **D-015** · Resolves **OQ-21**.

```
svfrontend (Next.js, static/ISR)
      │  build + revalidate — never per visitor request
      ▼
Custom public endpoints ──► toPublicProject() serialiser  (exact documented shape)
      ▼
Payload CMS 3  ──► auto-generated admin UI + media library
      ├──► PostgreSQL / Neon       (Payload-managed schema — D-124)
      ├──► Cloudinary              (media — D-123, custom adapter)
      └──► Email                   (queued lead notifications — provider OQ-7b)
```

**Stack:** TypeScript · **Node ≥ 20.9.0** *(Node 24.11.0 in use — see §11b #5; **not** "Node 20 LTS", and the frontend's `<23` pin must not be copied)* · Payload CMS 3 (MIT, self-hosted) hosted in its own Next.js app **separate from `svfrontend`**, pinned to **`next@16.3.3`** *(§11b #1 — the frontend's 15.5.x is unsupported by Payload)* · PostgreSQL 15+ via Payload's Postgres adapter (**Neon** in production — D-124) · Payload/Drizzle migrations · **Cloudinary** media via a hand-written adapter on `@payloadcms/plugin-cloud-storage` (D-123 — *this line said "S3-compatible storage" before that decision*) · Zod for custom endpoints · Vitest + contract tests · **npm** *(yarn 1.x is unsupported; pnpm not installed)*.

**Rejected:** custom TypeScript backend · **Python/FastAPI** (would hand-maintain a TS contract in a second language while still leaving the admin UI unbuilt) · Strapi (weak ordering, furthest API shape) · **Directus — the designated fallback** if Phase 1 invalidates the Postgres adapter.

**Division of responsibility under this decision:**

| Concern | Owner |
|---|---|
| Public API shape, omit-don't-empty, serialiser | **Custom code** — hand-written, contract-tested |
| Admin UI, media library, auth, draft/publish, ordering | **Payload** — generated from config |
| Business rules (consent gate, media-in-use guard, icon enum, notifications) | **Payload hooks + access control** |
| Page structure, headings, design tokens, animation, routing | **Frontend — unchanged** (D-010) |
| Rendering strategy (ISR + revalidation) | **Frontend** (D-012) |

⚠️ **Provisional until Phase 1's exit criteria pass** — Payload's Postgres adapter must express the full `Project` model, `description` must round-trip as `string[]`, and absent optional fields must be **absent** from the JSON. If those fail, the decision is void and Directus is the fallback.

## 3. What the backend is responsible for

1. **Project/property management** — full CRUD, publish/unpublish, ordering, featured flag, media attachment.
2. **Media management** — upload, store, serve and delete images and documents (brochures, master-plan PDF).
3. **Lead capture and management** — public submit endpoint; admin list, view, status update.
4. **Site settings** — brand, contact channels, social links, legal text.
5. **Supporting content** — testimonials (with consent), FAQs, homepage statistics.
6. **Admin authentication** — login, session, protected endpoints, audit trail.
7. **Public read APIs** the website consumes at build/revalidate time.

## 4. What admins can manage

**Tier 1 — confirmed, build first:** Projects (all fields, media, ordering, publish state) · Leads (view, status) · Site settings (contact, brand, social, legal) · Media library · Own admin account.

**Tier 2 — justified but confirm priority:** Testimonials (with a consent flag) · FAQs · Homepage statistics · Hero ticker claims · Site-wide amenity specifications · Site-wide proximity list · CTA banner copy.

**Tier 3 — deliberately NOT admin-managed:** Section headings, page structure, design tokens, fonts, icon set, navigation structure, animation behaviour, the legal disclaimer wording. These are frontend code. See `CONTENT-MANAGEMENT-MATRIX.md` for the line-by-line boundary and the reasoning.

## 5. What public users can see

Everything on the marketing site, with no account: home, about, projects catalogue + 5 detail pages, amenities, master plan, location, contact, 404. They can submit **one thing**: a contact enquiry (name, phone, optional project, optional message).

**Public users never log in. Do not build public user accounts.** There is zero frontend evidence for them.

## 6. API shape (summary — full detail in `API-CONTRACT.md`)

```
PUBLIC   (unauthenticated, read-only except leads)
  GET  /api/v1/projects              GET /api/v1/projects/{slug}
  GET  /api/v1/site-settings         GET /api/v1/testimonials
  GET  /api/v1/faqs                  GET /api/v1/statistics
  POST /api/v1/leads                 GET /healthz

ADMIN    (authenticated, /api/v1/admin/**)
  auth: login · logout · refresh · me · change-password
  projects · project-media · media · testimonials · faqs
  statistics · site-settings · leads · audit-log
```

**The `/api/v1/admin/**` prefix is the security boundary.** Every route under it requires a valid admin session. Nothing under it is ever reachable unauthenticated.

## 7. Database scope

**9 Payload entities — 8 collections + 1 global — plus Payload's built-in `payload-jobs`** *(corrected 20 Sep 2026 from "15 core tables")*:

`users` (auth) · `projects` · `media` (images) · **`documents`** (PDFs) · `leads` · `testimonials` · `faqs` · `statistics` · `audit-log` — and the **`site-settings` global**.

These generate roughly 40–60 **physical** Postgres tables (arrays, blocks and version tables each become their own), which is Payload's business, not ours.

**Four tables from the old 15 are NOT built:** `admin_sessions` (Payload owns the session store — D-029) · `notification_jobs` (`payload-jobs` is already this — D-027) · `project_media` (roles are named `upload` fields — D-032) · and `media_assets` **splits** into `media` + `documents` (D-032). `project_features`, `project_stats` and `project_proximity` become Payload array fields on `projects`, not hand-modelled tables.

`DATABASE-SCHEMA.md` remains binding on **field meanings, relationships, cardinality, ordering and deletion semantics**; its physical DDL does not. **Do not add entities without a traceable requirement.**

## 8. Media scope

Project cover image (required), gallery, layout plan, location map, brochure scans, master-plan PDF, logo. Images need explicit `width`/`height` in the API response — the frontend's CLS budget depends on it. Only quality values **75 and 90** are permitted (declared in `next.config.mjs`). No public upload endpoint — uploads are admin-only.

## 9. Lead scope

Public create; admin read and status update. Fields: `name` (required), `phone` (required), `projectSlug` (optional), `message` (optional), plus server-assigned `source`, timestamps and soft-delete. **The status pipeline is INFERRED, not confirmed** — see `OPEN-QUESTIONS.md` Q3.

## 10. Security requirements (summary — full detail in `SECURITY.md`)

The admin backend can change what the public website says about legally-regulated matters (approval numbers, land titles). Treat it accordingly: argon2id password hashing, httpOnly cookie sessions, rate limiting on login and on the public lead endpoint, strict CORS allow-list, server-side validation independent of the client, upload type/size validation with content-sniffing, audit log on every admin mutation, no error disclosure.

## 11. Current implementation status

| | |
|---|---|
| Frontend | ✅ Built, and now **integrated with the CMS** on branch `feat/cms-integration`. Verified against a baseline build of `main`: **zero route regressions**, First Load JS unchanged-or-smaller |
| **Architecture decision** | ✅ **DECIDED — Payload CMS 3 (§2b, D-015)** — reconfirmed 20 Sep 2026 against the official Payload 3 docs; **no technical blocker found** |
| **Implementation plan** | ✅ **[`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md)** + **[`MASTER-IMPLEMENTATION-CHECKLIST.md`](./MASTER-IMPLEMENTATION-CHECKLIST.md)** (20 Sep 2026) |
| Backend code | ✅ **BUILT.** Payload 3.90.1 + Next 16.3.3 + PostgreSQL 15. 9 collections + 1 global, 50 physical tables, 7 public endpoints, 2 probes, **132 passing tests** |
| Backend docs | ✅ This set (21 documents) |
| Database | ✅ Created. Migrations 001 (schema) + 002 (consent CHECK) + 003 (`payload-jobs-stats` global + `payload_jobs.meta`, required by task scheduling), reversibility proven up→down→up on each |
| Production targets | ✅ **CHOSEN 20 Sep 2026** — **Neon PostgreSQL** (D-124) + **Cloudinary** (D-123). Code, env schema and docs all reflect it; no migration was needed |
| Hosting | ❌ Not provisioned. `Dockerfile`, `docker-compose.prod.yml`, `RUNBOOK.md` and `PRODUCTION-CONFIG.md` are ready |
| Next step | **Owner deliverables** — see [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md) §4–§6. Nothing engineering-side blocks. Still open: the **domain**, the **privacy-policy URL**, **testimonials**, all `[BRACKETED]` values, the **registered legal entity name**, and the email provider |

### 11b. Corrections established 20 September 2026

A full technical investigation of the entire roadmap verified every Payload-specific assumption in this doc set against the **current official Payload 3 documentation**. Five findings change what gets built. Each is a correction to something a document here previously asserted.

| # | Correction | Was |
|---|---|---|
| 1 | **Payload 3 does not support Next.js 15.5.x.** Peer range is `>=15.2.9 <15.3.0 \|\| >=15.3.9 <15.4.0 \|\| >=15.4.11 <15.5.0 \|\| >=16.3.3 <17.0.0`. `svbackend` pins its own Next; it can never share a dependency tree with `svfrontend` (15.5.25) without a frontend upgrade. | No document named a Next version at all |
| 2 | **Payload 3 ships no rate limiting.** v2's `rateLimit` died with Express; the official anti-abuse page offers no replacement. Every HTTP throttle is our own code, at the edge. | Five documents assumed it existed or was free |
| 3 | **`status` is a reserved field name** on Postgres collections with drafts. `Project.status` → `projectStatus`, `Lead.status` → `leadStatus`, **before migration 001**. The public JSON key stays `status`, via the serialiser. | Specified as `status` throughout |
| 4 | **Password hashing is not configurable and is not argon2id.** Reaching argon2id means discarding Payload's entire auth stack — login, lockout, reset, sessions. Accepted deviation + compensating controls: plan §10. | `argon2id` mandated in three documents (incl. §10 above) |
| 5 | **Node 24 is supported.** `payload@3.90.1` declares `engines.node: "^18.20.2 \|\| >=20.9.0"`; Payload's own production Dockerfile runs `node:24-alpine`. The `"<23"` pin in `svfrontend/package.json` is a **frontend** constraint — do not copy it. | "Node 20 LTS" mandated three times |

**Also resolved:** **OQ-26 / D-004** — Payload's sessions *are* stateful and revocable, and an admin changing another user's password **ends all of that user's sessions**. Do not build a `tokenVersion` field. See `OPEN-QUESTIONS.md` OQ-26 and `DECISIONS.md` D-029.

**Also corrected:** ordering is Payload's native `orderable: true` (fractional-index **string**), not an integer `sort_order`; `project_media`, `admin_sessions` and `notification_jobs` are **not built** (D-021, D-026, D-027, D-032).

> The complete 92-finding conflict audit and the full ordered correction plan for the remaining documents are in [`DOCUMENTATION-CORRECTIONS.md`](./DOCUMENTATION-CORRECTIONS.md). **Several documents in this set have not yet been corrected** — most importantly `ARCHITECTURE.md` §2, which still prescribes Fastify + Prisma. Read the correction plan before trusting any technical detail in an uncorrected document.

## 12. Source-of-truth hierarchy — **updated at freeze, 20 Sep 2026**

When two sources disagree, the higher one wins:

| # | Source | Note |
|---|---|---|
| **1** | **Actual project-owner decisions** | Recorded in `DECISIONS.md`. An owner ruling beats everything |
| **2** | **Actual frontend source** (`svfrontend/src/`) | The public contract is what the code *does*, not what a document says it does |
| **3** | **Confirmed business requirements** | CONFIRMED-status items in `REQUIREMENTS.md`. *(INFERRED items are not confirmed requirements — they sit at level 6)* |
| **4** | **`MASTER-IMPLEMENTATION-PLAN.md`** | 🟢 **THE PRIMARY EXECUTION BLUEPRINT.** Beats every individual technical document below it |
| **5** | **`MASTER-IMPLEMENTATION-CHECKLIST.md`** | The executable companion. If it contradicts the plan, **the plan wins** and the checklist is corrected |
| **6** | **Individual technical documents** | `PRD.md` → `REQUIREMENTS.md` → `CONTENT-MANAGEMENT-MATRIX.md` → `API-CONTRACT.md` → `DATABASE-SCHEMA.md` → `VALIDATION-RULES.md` → `MEDIA-MANAGEMENT.md` → `SECURITY.md` → `INTEGRATIONS.md` → `ARCHITECTURE.md` → `TRACEABILITY.md`, in that order |
| **7** | **Historical decision records** | Superseded entries, struck-through recommendations, `<details>` blocks. **Read for context; never execute from them** |

**Two rules that override the ordering:**

- **On any *Payload* behaviour, the current official documentation at `payloadcms.com/docs` beats every document in this set**, including the plan. The plan records what the docs said on 20 Sep 2026; if the docs now say otherwise, the docs win and the plan is corrected.
- **The hierarchy does not license overriding an explicit current decision.** A lower-ranked document is not "wrong" merely because it is lower — if `DATABASE-SCHEMA.md` states a field's *meaning*, that meaning is binding even though the plan outranks it on *mechanism*. Use the hierarchy to resolve genuine contradictions, not to discard specification.

**`MASTER-IMPLEMENTATION-PLAN.md` is the primary execution blueprint.** Build from it. Use `MASTER-IMPLEMENTATION-CHECKLIST.md` to track completion, `MIGRATION-001-DECISIONS.md` before the first migration, and the individual documents for the detail behind a requirement.

**On conflict: do not guess. Record it in `OPEN-QUESTIONS.md`, and once the owner rules, record the ruling in `DECISIONS.md` and update the affected documents.**

## 12b. Implementation safety rules — **binding on every implementation session**

These are not style preferences. Each one exists because the investigation found a concrete way this system fails.

**Scope and honesty**

1. **Do not invent business decisions.** If `OPEN-QUESTIONS.md` says a question is open, it is open. Adopting a documented safe default is recorded as *"engineering adopted the interim behaviour"* — **never** as the owner's answer.
2. **Do not silently expand scope.** A capability with no requirement ID and no frontend evidence is not built. Flag it as a new requirement first.
3. **Do not modify `svfrontend` design.** Frontend integration is a separate, explicitly-approved phase. Structure, headings, design tokens, animation and routing are unchanged (D-010). Even in that phase, the changes are the listed ones — not a redesign.

**Access control and data exposure**

4. **Do not bypass Payload access control.** Every collection and every global declares an explicit `access` block — including `readVersions`. Payload's default is `Boolean(user)` (*any authenticated user, full CRUD*), **not** deny-by-default.
5. **Do not use `overrideAccess` casually.** It defaults to `true` in Local API calls. Every public read uses `overrideAccess: false`, `user: undefined`, and a hard-coded `where` — via the shared `publicFind()` helper. **No bare `payload.find` in a public file.**
6. **Do not expose unpublished content.** A never-published document *is* returned by an ordinary `payload.find()`. Unpublished → **404, never 403** (a 403 confirms existence).
7. **Do not expose leads publicly.** `leads` is write-only from the public surface. A negative test must prove no public route returns lead data.
8. **Do not expose internal Payload fields.** Public responses are built **key by key** by an allow-list serialiser — **never spread a document**. Strip `_status`, `id`, `createdAt`, `updatedAt`, array-row ids, and the ordering key. Absent optional fields are **omitted**, not `null` and not `[]` (D-008 — `null` fails `tsc` against the frontend's `T | undefined`).

**Media**

9. **Do not upload SVGs where prohibited.** `image/svg+xml` is not in the MIME allow-list. Payload validates the *declared* MIME type only — magic-byte sniffing is our code. The seed **stores path strings and uploads nothing**, so the existing SVG placeholders are never ingested.

**Database**

10. **Do not skip migration verification.** Every migration is reviewed before it runs and must have a working `down`. Read `npx payload generate:db-schema` before writing migration 001.
11. **Do not mix development `push` with production migrations.** `push` is for the local sandbox only. `payload migrate` is never run against the local sandbox. Mixing them produces a migration history matching no real schema.

**Release**

12. **Do not deploy with unresolved critical security failures.** The security checklist passes in full, or the deploy does not happen.
13. **Do not mark a phase complete without its acceptance criteria passing.** "It looks right" is not a verification. A box is checked when its stated test passes — not before.

## 13. Forbidden assumptions

Future agents **must not**:

- ❌ Build **public user accounts, registration, or login**. Admin-only auth. Zero frontend evidence otherwise.
- ❌ Build **payments, checkout, carts, or pricing transactions**. No pricing appears anywhere in the frontend.
- ❌ Build **online booking or scheduling**. Site visits are arranged by phone.
- ❌ Invent real-estate fields with no frontend evidence — no plot inventory, no per-plot pricing, no floor plans, no possession dates, no RERA numbers as structured fields.
- ❌ Create a **`Service` entity.** The brief mentions "services"; the frontend has none. What exists is infrastructure *specifications* and *benefits*.
- ❌ Build a **blog / Article entity**. `README.md` and the PRD document a `/blog` route, but **it does not exist and 404s**. Unresolved — see `OPEN-QUESTIONS.md` Q14.
- ❌ Make **every** frontend string editable. Section headings and layout copy stay in code by design.
- ❌ Treat headings as one field. `title` + `titleAccent` is a **two-field structural split** (the `<em>` is the headline's second line).
- ❌ Add analytics, search, or pagination to the **public** API. No public consumer exists for them.
- ❌ Modify `svfrontend/` while building the backend. Frontend integration is a separate, later, explicitly-approved phase.
- ❌ Assume the lead **status pipeline** is confirmed. It is inferred.

**Architecture-specific (added by D-015):**

- ❌ **Do not serve the public API straight from Payload's generated routes.** Public responses go through hand-written endpoints + `toPublicProject()`. Generated output violates omit-don't-empty (D-008) and returns `description` as objects, not `string[]`.
- ❌ **Do not treat `DATABASE-SCHEMA.md` as literal DDL any more.** It is now a *logical* spec — field meanings, relationships, cardinality, ordering and deletion semantics are binding; physical table/column names are Payload's.
- ❌ **Do not leave Payload's generated REST/GraphQL endpoints open by default** (risk R-9). Lock down anything not required, and test that no public route returns lead data.
- ❌ **Do not add a rich-text field.** It would break the `title`/`titleAccent` split (D-010) and widen the XSS surface.
- ❌ Do not treat D-015 as final before Phase 1's exit criteria pass. **Directus is the designated fallback.**

## 14. Required reading before implementing

Before any major backend work, read: **`AI-CONTEXT.md`** (this) → **`IMPLEMENTATION-DECISION.md`** → `PRD.md` → `REQUIREMENTS.md` → `CONTENT-MANAGEMENT-MATRIX.md` → `ADMIN-CMS-SPEC.md` → `API-CONTRACT.md` → `DATABASE-SCHEMA.md` → `OPEN-QUESTIONS.md`.

**If a requested feature is not traceable in `TRACEABILITY.md`, stop and flag it as a new requirement before writing code.**
