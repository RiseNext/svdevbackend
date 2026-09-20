# MASTER-IMPLEMENTATION-PLAN.md

> **The single definitive implementation blueprint for the SV Developers backend.**
> Produced: 20 September 2026 · Status: **investigation complete — no implementation performed**
> Supersedes `BACKEND-ROADMAP.md` on phase structure. Does **not** supersede `IMPLEMENTATION-DECISION.md` (D-015), which it confirms.

---

## What this document is

This is the output of a read-only technical investigation covering the **entire** approved backend roadmap — from the current state through production deployment — not just the early phases. It exists so that a later **MASTER IMPLEMENTATION PROMPT** can build the complete backend in one controlled execution without re-deriving anything.

**Nothing in this plan has been built.** No file under `svfrontend/` or `svbackend/` was created, edited or deleted during the investigation; no dependency was installed; no database was touched; no migration was generated or run; no scaffolder was executed. The only artefacts produced are this document, `MASTER-IMPLEMENTATION-CHECKLIST.md`, and verified corrections to the existing docs.

## How it was produced

| Input | Weight |
|---|---|
| `svfrontend/src/**` — the actual frontend source | **Primary technical evidence.** Outranks every document. |
| The 18 documents in `svbackend/docs/` | Authoritative on intent; corrected where the investigation proved them wrong. |
| `BACKEND-REQUIREMENTS.md` (workspace root) | Evidence base; superseded on *scope* by D-001, still authoritative on *what the frontend contains*. |
| **Official Payload CMS 3 documentation** at `payloadcms.com/docs` + `payloadcms.com/posts/releases` | **Sole authority on all Payload behaviour.** No tutorials, blog posts, videos, or v2 patterns were used. Unverifiable claims are marked `NOT VERIFIED IN OFFICIAL DOCS` rather than assumed. |

Where the official documentation and the project documentation conflict, the conflict is **recorded, not silently resolved in favour of whichever was easier** — see §32.Y and the 92-finding conflict audit that backs it.

## The question this answers

> *"If we wanted to complete the entire backend from the current state to a production-ready deployed system as quickly as realistically possible, without sacrificing correctness, security, maintainability, or the frontend contract, exactly how should we build it?"*

## Contents

| § | Section | § | Section |
|---|---|---|---|
| 1 | Project Summary | 17 | Seed Strategy |
| 2 | Final Architecture | 18 | Testing |
| 3 | Approved Technologies | 19 | Frontend Integration |
| 4 | Official Documentation References | 20 | Production Deployment |
| 5 | Final Entity Model | 21 | Repository Structure |
| 6 | Public API | 22 | Environment Variables |
| 7 | Admin Capabilities | 23 | Phase Dependency Graph |
| 8 | Media Architecture | 24 | Critical Path |
| 9 | Lead Architecture | 25 | Parallel Tasks |
| 10 | Auth Architecture | 26 | Remaining Business Decisions |
| 11 | Globals vs Collections | 27 | Deferred Functionality |
| 12 | Draft / Version / Audit Strategy | 28 | Risk Register + Disaster Recovery |
| 13 | Jobs / Background Work | 29 | Exact Implementation Order |
| 14 | Email / Notifications | 30 | Acceptance Criteria |
| 15 | Security | 31 | Complete Definition of Done |
| 16 | Database and Migrations | 32 | **Official Documentation Evidence** |

## Source of truth

This document is **the primary execution blueprint**. Build from it. When sources disagree:

**1.** Owner decisions (`DECISIONS.md`) → **2.** `svfrontend/src/` → **3.** Confirmed requirements → **4.** **this plan** → **5.** `MASTER-IMPLEMENTATION-CHECKLIST.md` → **6.** individual technical documents → **7.** historical records (context only, never executed from).

Two overrides: **the current official Payload documentation beats this plan on any Payload behaviour** (this plan records what the docs said on 20 Sep 2026); and **the hierarchy resolves contradictions, it does not license discarding specification** — a lower-ranked document's statement of a field's *meaning* stays binding even where this plan outranks it on *mechanism*.

Full hierarchy and rationale: `AI-CONTEXT.md` §12.

## Implementation safety rules — binding

Each exists because the investigation found a concrete failure path. Full text with reasoning: `AI-CONTEXT.md` §12b.

| # | Rule |
|---|---|
| 1 | **Do not invent business decisions.** Adopting a safe default is *"engineering adopted the interim behaviour"*, never the owner's answer |
| 2 | **Do not silently expand scope.** No requirement ID and no frontend evidence → not built |
| 3 | **Do not modify `svfrontend` design.** Integration is separately approved; structure/tokens/animation unchanged (D-010) |
| 4 | **Do not bypass access control.** Explicit `access` on 100% of collections and globals, incl. `readVersions`. Payload's default is `Boolean(user)`, **not** deny-by-default |
| 5 | **Do not use `overrideAccess` casually.** It defaults to `true`. Public reads go through `publicFind()` — **no bare `payload.find` in a public file** |
| 6 | **Do not expose unpublished content.** Unpublished → **404, never 403** |
| 7 | **Do not expose leads publicly.** Proven by a negative test |
| 8 | **Do not expose internal Payload fields.** Allow-list serialiser, key by key, **never spread**. Absent optionals **omitted**, not `null`/`[]` |
| 9 | **Do not upload SVGs where prohibited.** Magic-byte sniffing is our code; the seed uploads nothing |
| 10 | **Do not skip migration verification.** Every migration reviewed, with a working `down` |
| 11 | **Do not mix dev `push` with production migrations.** `push` = local sandbox only |
| 12 | **Do not deploy with unresolved critical security failures.** |
| 13 | **Do not mark a phase complete without its acceptance criteria passing.** |

## Read this first

Five facts shape everything below. Each is verified against the official Payload 3 documentation and is a correction to an assumption held somewhere in the existing doc set.

1. **Payload 3 does not support Next.js 15.5.x.** `@payloadcms/next` peers are `>=15.2.9 <15.3.0 || >=15.3.9 <15.4.0 || >=15.4.11 <15.5.0 || >=16.3.3 <17.0.0`. `svfrontend` runs 15.5.25. Harmless — the apps are separate — but `svbackend` must pin its own Next, and the two can never share a dependency tree without a frontend upgrade.
2. **Payload 3 ships no rate limiting.** The v2 `rateLimit` option died with Express, and the official anti-abuse page offers no replacement. Every HTTP throttle in this system is our own code.
3. **`status` is a reserved field name** on Postgres collections with drafts enabled. `Project.status` and `Lead.status` must be renamed *before* migration 001, and aliased back by the public serialiser.
4. **Payload's password hashing is not configurable and is not argon2id.** Three project documents mandate argon2id; it is unreachable without discarding Payload's entire auth stack. §10 states the accepted deviation and the compensating controls.
5. **Node 24 is fine.** `payload@3.90.1` declares `engines.node: "^18.20.2 || >=20.9.0"`, and Payload's own documented production Dockerfile runs `node:24-alpine`. The `"<23"` pin in `svfrontend/package.json` is a frontend constraint and must not be copied into the backend.

---
## 1. Project Summary

SV Developers is a finished, statically prerendered Next.js 15.5.25 marketing site (`svfrontend/`) whose entire content layer is hardcoded TypeScript in `src/content/*.ts`, and whose one interactive form is a deliberate dead end — `ContactForm.tsx:45-50` tells the visitor that nothing was sent rather than faking a success. This plan builds the missing half: a **Payload CMS 3 backend in its own Next.js application** (`svbackend/`, currently containing only `docs/` and not yet a git repository) that (a) stores the project catalogue, site settings and Tier-2 content in PostgreSQL, (b) exposes a hand-written, contract-exact public JSON API at `/api/v1/**` that the frontend consumes at build and revalidate time, (c) captures leads through the one public write endpoint in the system, and (d) gives a non-technical administrator a login-protected admin UI — Payload's own, generated from config — to edit all of it. The end state is one site whose content is editable without a developer and whose enquiries reach a human, with the frontend's rendered output, design system, animation and performance budget **unchanged** (D-010).

**This plan is the product of a 27-agent read-only investigation. NO implementation has been performed.** No file under `svfrontend/` or `svbackend/` has been created, edited or deleted; no package has been installed; no database has been touched; no migration has been written or run; no scaffolder has been executed. Everything below is a specification for a later MASTER IMPLEMENTATION PROMPT to execute in one controlled run.

### 1.1 Status of every moving part

| Component | State today | Evidence | End state |
|---|---|---|---|
| `svfrontend/` application | Complete and working. 15 prerendered routes (7 content pages + `/_not-found` + 5 project pages + `robots.txt` + `sitemap.xml`) | A5 §1.6 from `.next/server/app-paths-manifest.json` + `prerender-manifest.json`. The corpus's "17 routes" and the README's "18" are both wrong; `/blog` does not exist (CONF-58) | Unchanged in output; data source swapped from static arrays to `fetch` |
| `svfrontend/src/types/content.ts` | The contract. `strict: true`, `noUncheckedIndexedAccess: true` | A4 §2.1 — `Project` has exactly 25 fields | **Never edited.** Vendored into `svbackend/src/types/frontend-contract.ts` and CI-diffed |
| `svfrontend/src/content/projects.ts` | 5 real brochure-sourced records, zero bracketed placeholders | A4 §6 | Re-export of the data layer (Phase 9) |
| `svfrontend/src/content/site.ts` | 10 of 11 top-level values are placeholders; `url = 'https://www.example.com'` is the one **unbracketed** placeholder | A4 §4.1, CONF-22 | Fetched from the `site-settings` global |
| `svfrontend/next.config.mjs` | **No `images.remotePatterns`.** Has `dangerouslyAllowSVG` | A5 §5.7, CONF-45 | `remotePatterns` added (Phase 9, CRITICAL); `dangerouslyAllowSVG` deleted once raster art lands |
| Lead capture | **Every enquiry typed into the live form is discarded** | PRD §1 problem 2; `ContactForm.tsx:45-50` | `POST /api/v1/leads` → `leads` collection + queued notification |
| `svbackend/` | `docs/` only — 18 specification documents, 3 495 lines. **Not a git repository.** Zero code | measured; CONF-10 | A full Payload 3 + Next.js app; `git init` before the first file exists |
| Environment | Node **v24.11.0**, npm **11.6.1**, yarn 1.22.22, **no pnpm**, Docker 29.3.1, **`psql` not on PATH**, git 2.47.1. **No `.env` files exist in either repo** | measured | §3 resolves the runtime; §22 (already written) defines every variable |
| Admin users / auth | Nothing. The frontend has zero auth primitives | A6 §7 | Payload `users` collection, `auth: true`, seeded first admin, no self-registration |
| Media | 8 placeholder SVGs on disk; 2 referenced files (`hero.svg`, `hero-portrait.svg`) **do not exist** | A4 §7.1, CONF-56 | `media` (images) + `documents` (PDF) upload collections on S3-compatible storage |
| Architecture decision | **D-015 ACCEPTED**: Payload CMS 3, self-hosted, own Next.js app, PostgreSQL 15+ via `@payloadcms/db-postgres`, S3-compatible storage, hand-written public endpoints + `toPublicProject()` | A3/DECISIONS | Unchanged. The Phase-1 gate (§5.1) is the only thing that can void it |

### 1.2 The two halves

**Public half** (unauthenticated, read-mostly): six read endpoints + one write endpoint + two probes, hand-written as Next.js Route Handlers calling Payload's Local API, serialised through `toPublicProject()` and its siblings so that the emitted key set matches `types/content.ts` field-for-field. Consumed by the frontend at build and revalidate time — **never by a visitor's browser**, except `POST /api/v1/leads`.

**Private half** (session-authenticated): Payload's own generated Admin Panel at `/admin`, plus Payload's generated REST surface relocated to `/payload-api` and locked down by access control. Roughly 80 % of `ADMIN-CMS-SPEC.md` is satisfied by field configuration alone; the genuine custom work is six items, enumerated in §7.

---

## 2. Final Architecture

### 2.1 System diagram

```mermaid
flowchart TB
    subgraph PUB["PUBLIC INTERNET — untrusted"]
        V["Visitor browser"]
        BOT["Search crawler"]
        ADM["Administrator browser"]
    end

    subgraph EDGE["EDGE — reverse proxy / CDN / WAF  ·  TRUST BOUNDARY 1"]
        RP["TLS termination · HSTS · security headers<br/>RATE LIMITING (100% ours — Payload ships none)<br/>blocks /payload-api/&lt;slug&gt; from the internet"]
    end

    subgraph FE["svfrontend — Next.js 15.5.25  ·  www.&lt;domain&gt;"]
        STATIC["Statically prerendered HTML<br/>15 routes · ISR revalidate 3600"]
        DL["src/lib/api/* — typed data layer<br/>server-only fetch"]
        REVAL["src/app/api/revalidate/route.ts<br/>verifies REVALIDATE_SECRET"]
        CF["ContactForm.tsx — the ONLY<br/>browser→backend call"]
    end

    subgraph BE["svbackend — Next.js 16.3.3 + Payload 3  ·  cms.&lt;domain&gt;"]
        subgraph PUBAPI["/api/v1/** — Next Route Handlers (OURS)  ·  TRUST BOUNDARY 2"]
            H1["definePublicEndpoint()<br/>CORS · Cache-Control · ETag · error envelope"]
            H2["publicFind() — overrideAccess:false<br/>+ user:undefined + published-only where"]
            H3["serializers/ — key-by-key, no spread"]
        end
        subgraph PAYLOAD["Payload core  ·  TRUST BOUNDARY 3 = access-control functions"]
            AC["access/ — isAdmin · anyone · nobody<br/>publishedOrAuthenticated"]
            HOOKS["hooks/ — audit · revalidate · uploadGuard<br/>mediaDeleteGuard · slugLock · leadNormalise"]
            LOCAL["Local API (payload.find / create / update)"]
            ADMINUI["/admin — generated Admin Panel"]
            RESTGEN["/payload-api/** — generated REST<br/>GraphQL DISABLED"]
        end
        HEALTH["/healthz · /livez — Route Handlers"]
        JOBS["payload-jobs runner<br/>separate supervised process"]
    end

    subgraph DATA["STATE  ·  TRUST BOUNDARY 4 — private network only"]
        PG[("PostgreSQL 15+<br/>~40-60 physical tables")]
        S3[("S3-compatible bucket")]
        CDN["media.&lt;domain&gt; — separate origin"]
        SMTP["SMTP provider"]
    end

    V --> RP --> STATIC
    BOT --> RP --> STATIC
    ADM --> RP --> ADMINUI
    STATIC -.build/revalidate.-> DL
    DL --> RP --> H1
    CF -- "POST /api/v1/leads" --> RP --> H1
    H1 --> H2 --> LOCAL
    H2 --> H3
    LOCAL --> AC
    LOCAL --> HOOKS
    LOCAL --> PG
    ADMINUI --> LOCAL
    RESTGEN --> AC
    HOOKS -- "afterChange" --> REVAL
    HOOKS -- "jobs.queue" --> JOBS
    JOBS --> SMTP
    JOBS --> PG
    LOCAL --> S3
    S3 --> CDN
    CDN --> V
    HEALTH --> PG
```

**The four trust boundaries, stated plainly.**

| # | Boundary | What enforces it | What does NOT enforce it |
|---|---|---|---|
| 1 | Internet → application | Reverse proxy / WAF: TLS, HSTS, rate limits, a path block on `/payload-api/<slug>` | Payload — it ships **no** HTTP rate limiting and **no** security-header surface (CONF-04, D2 §15 row 38) |
| 2 | Public handler → data | `publicFind()`: `overrideAccess: false` **and** `user: undefined` **and** a hard-coded `where: { _status: { equals: 'published' } }` | Nothing automatic. *"Custom endpoints are not authenticated by default. You are responsible for securing your own endpoints."* (official docs) |
| 3 | Any caller → collection | Per-collection and per-field `access` functions, declared explicitly on 100 % of collections and globals including `readVersions` | Payload's default, which is `({ req: { user } }) => Boolean(user)` — **allow-any-authenticated, not deny-by-default** (CONF-35) |
| 4 | Application → state | Private network, least-privilege DB role, `DATABASE_SSL`, bucket policy | — |

**`ARCHITECTURE.md` §1's model — *"The `/admin` path prefix is the security boundary. One middleware guards everything beneath it"* — does not exist under Payload and must be struck.** There is no middleware choke point. `/admin` is the Payload Admin Panel UI; authorization lives in access-control functions; audit, revalidation and business rules live in hooks; route handlers exist only for the public surface (CONF-05, CONF-15, CONF-69).

### 2.2 Request-flow walkthroughs

**(a) A public page build / revalidate.**

```
next build (or ISR revalidate, or POST /api/revalidate)
  → svfrontend/src/lib/api/projects.ts  getProjects()
      fetch(`${NEXT_PUBLIC_API_BASE_URL}/projects`, { next: { revalidate: 3600, tags: ['projects'] } })
  → svbackend  src/app/(public)/api/v1/projects/route.ts   GET
      src/lib/definePublicEndpoint.ts      → headersWithCors, Cache-Control, ETag, try/catch envelope
      src/lib/publicFind.ts                → payload.find({ collection:'projects',
                                               overrideAccess:false, user:undefined,
                                               where:{ _status:{equals:'published'} },
                                               sort:'<ORDER_FIELD>', depth:1,
                                               select: PUBLIC_PROJECT_CARD_SELECT })
      src/serializers/toPublicProjectCard.ts → key-by-key output, absent keys omitted
  → 200 { "data": [ … ] }  Cache-Control: public, max-age=60, stale-while-revalidate=600 + ETag
  → svfrontend renders static HTML; the visitor never touches svbackend
```
Modules: `src/lib/api/projects.ts` (FE) · `src/app/(public)/api/v1/projects/route.ts` · `src/lib/definePublicEndpoint.ts` · `src/lib/publicFind.ts` · `src/serializers/toPublicProjectCard.ts` · `src/lib/cache.ts`.

**(b) A public lead submission** — the only runtime call a visitor's browser makes.

```
ContactForm.tsx onSubmit  → fetch POST ${NEXT_PUBLIC_API_BASE_URL}/leads  (cross-origin, no credentials)
  → EDGE: rate limit 5/min/IP  (429 + Retry-After if exceeded — NOT Payload)
  → src/app/(public)/api/v1/leads/route.ts  POST
      definePublicEndpoint()      → CORS preflight + headersWithCors (mandatory: custom endpoints get none free)
      Content-Type allow-list     → 415 if not application/json
      src/schemas/lead.ts (Zod)   → 422 VALIDATION_ERROR with details[].field ∈ {name,phone,project,message}
      honeypot filled?            → return an INDISTINGUISHABLE 201, persist nothing (CONF-31)
      Idempotency-Key present?    → replay the original 201 within 24 h
      payload.create({ collection:'leads', overrideAccess:true, data })   ← the ONE sanctioned overrideAccess
          hooks/leadNormalise.ts  beforeValidate: trim, NFC, strip HTML from message, phone → E.164 (+91)
          hooks/leadDedupe.ts     beforeValidate: (phoneNormalised, projectSlug) within 10 min
          field access            source / sourcePath / ipAddress / userAgent / project* are create:()=>false
          hooks/enqueueLeadNotification.ts  afterChange(create): payload.jobs.queue(...) inside try/catch
  → 201 { "data": { "id", "createdAt", "message": "Thanks — we will call you back." } }  Cache-Control: no-store
  → jobs runner picks up sendLeadNotification → nodemailerAdapter → SALES_NOTIFICATION_EMAIL
```
Modules: `src/app/(public)/api/v1/leads/route.ts` · `src/lib/definePublicEndpoint.ts` · `src/schemas/lead.ts` · `src/collections/Leads.ts` · `src/hooks/leadNormalise.ts` · `src/hooks/leadDedupe.ts` · `src/hooks/enqueueLeadNotification.ts` · `src/jobs/sendLeadNotification.ts` · `src/email/renderLeadEmail.ts`.

**(c) An admin login.**

```
Administrator browses https://cms.<domain>/admin
  → src/app/(payload)/admin/[[...segments]]/page.tsx  (VENDOR, generated, never edited)
  → Payload's login view → POST {routes.api}/users/login   i.e. /payload-api/users/login
      src/collections/Users.ts  auth: { useSessions:true, tokenExpiration:7200,
                                        maxLoginAttempts:5, lockTime:900000,
                                        cookies:{ secure: prod, sameSite:'Lax' } }
      PBKDF2-SHA256 verification (Payload's KDF — not configurable)
      hooks/authEvents.ts  afterLogin → audit-log row  action:'login'
  → Set-Cookie: sv-token=<JWT>; HttpOnly; Secure; SameSite=Lax; Path=/
  → every subsequent admin request carries the cookie; access/isAdmin.ts gates every operation
```
Modules: `src/collections/Users.ts` · `src/hooks/authEvents.ts` · `src/access/isAdmin.ts` · vendor `(payload)/admin/**`.

**(d) An admin publishes a project, and the site updates.**

```
Admin clicks "Publish" in the Payload document editor
  → Payload's own PublishButton → an ordinary Local API update with data: { _status: 'published' }
     ⚠ It NEVER calls a custom /admin/projects/{id}/publish endpoint. Therefore:
      src/hooks/slugLock.ts        beforeValidate: reject a slug change on a published doc (SLUG_LOCKED)
      src/hooks/publishedAt.ts     beforeChange: stamp publishedAt on draft → published
      full validation runs (drafts are written with validate:false; publish is the validated path)
      src/hooks/audit.ts           afterChange: one audit-log row, actor + IP + action:'publish' + changes
      src/hooks/revalidate.ts      afterChange: fetch POST ${REVALIDATE_WEBHOOK_URL}
                                     { secret: REVALIDATE_SECRET,
                                       paths: ['/', '/projects', `/projects/${slug}`, '/sitemap.xml'] }
                                     fire-and-forget; on failure → payload.jobs.queue('revalidatePaths')
  → svfrontend/src/app/api/revalidate/route.ts verifies the secret → revalidateTag / revalidatePath
  → admin sees "Saved. The website may take a few minutes to update."  (a warning toast, never an error)
```
Modules: `src/collections/Projects.ts` · `src/hooks/slugLock.ts` · `src/hooks/publishedAt.ts` · `src/hooks/audit.ts` · `src/hooks/revalidate.ts` · `src/jobs/revalidatePaths.ts` · `svfrontend/src/app/api/revalidate/route.ts`.

**Why audit and revalidation are hooks and not endpoints:** the admin UI publishes directly through the Local API. Realistically 100 % of real publishes bypass any custom endpoint. Logic placed in `POST /admin/projects/{id}/publish` would never run (CONF-15).

**(e) A media upload.**

```
Admin drops a JPEG into the Media collection (or into a project's Cover picker)
  → Payload upload pipeline → src/collections/Media.ts
      upload.limits.fileSize (root, 25 MB, abortOnLimit:true → 413) is checked first
      hooks.beforeOperation (create AND update) — src/hooks/uploadGuard.ts, IN THIS ORDER:
        1. src/media/sniff.ts        magic-byte detection on req.file.data
        2. declared MIME ≠ sniffed  → 415
        3. sniffed type is SVG      → HARD REJECT (Payload does not block SVG for us)
        4. src/media/dimensions.ts  sharp().metadata(); > 10000 px a side → reject
        5. images > 10 MB           → reject (the 10/25 split is not expressible in config)
        6. re-encode, EXIF stripped
        7. req.file.name = `${randomUUID()}.${ext}`   ← ext from the SNIFFED type, after sniffing
        8. capture originalFilename into req.data
      Payload generates the `thumbnail` imageSize; our filename is threaded to it
      s3Storage plugin (enabled: Boolean(S3_BUCKET)) writes to the bucket under prefix 'media'
      generateFileURL composes ${CDN_BASE_URL}/media/<uuid>.jpg
  → the document holds filename/mimeType/filesize/width/height/url/sizes + our alt, isDecorative,
    originalFilename, uploadedBy
  → toImageRef() later flattens it to { src, alt, width, height } — the ONLY public shape
```
Modules: `src/collections/Media.ts` · `src/hooks/uploadGuard.ts` · `src/media/sniff.ts` · `src/media/dimensions.ts` · `src/media/storage.ts` · `src/serializers/toImageRef.ts`.

### 2.3 Payload-generated vs hand-written — the honest split

| Concern | Payload-generated | Hand-written |
|---|---|---|
| Admin UI (list, edit, tabs, drag-order, search, filters, pagination) | ✅ entirely, from config | 6 small components (§7) |
| Authentication, sessions, cookies, lockout, password reset | ✅ | password policy `validate`; auth-event audit hooks |
| Access control **engine** | ✅ | **every policy** — 4 functions on 100 % of collections/globals |
| Postgres schema, migrations, Drizzle | ✅ | 2 CHECK constraints via `afterSchemaInit`; migration review |
| Drafts / versions / publish / unpublish / restore | ✅ | `publishedAt` stamp; `readVersions` policy |
| Soft delete (`trash: true` → `deletedAt`) | ✅ | `baseFilter`, restore copy, the media sweeper |
| Document ordering (`orderable: true`, fractional index) | ✅ | the public `sort` key (name to be spiked) |
| Uploads: storage, resize, admin thumbnails, S3 adapter | ✅ | **all validation**: sniff, SVG reject, EXIF, UUID rename, dimension bomb, delete guard, orphans, sweeper |
| Jobs queue, retries, cron | ✅ (`payload-jobs`) | tasks, the runner process, boot guards, watchdog, dead-letter |
| Email transport (`nodemailerAdapter`) | ✅ | templates, HTML escaping, boot guard |
| GraphQL | ✅ (and **disabled**) | — |
| Generated REST | ✅ (relocated + locked down) | the edge path block |
| **Public API `/api/v1/**`** | ❌ none | **100 % ours** — 7 routes + 2 probes |
| **Omit-don't-empty serialisation (D-008)** | ❌ none. `select` controls what is *queried*, not what is *emitted*; *"A selected-but-empty field still returns as `null`"* | **100 % ours** — `put()` + key-by-key serialisers |
| **Rate limiting** | ❌ none in v3 | edge / WAF |
| **CORS on custom endpoints** | ❌ *"custom endpoints don't handle CORS headers in responses"* | `headersWithCors` in `definePublicEndpoint()` |
| **Security headers, CSP, HSTS** | ❌ none | `next.config.mjs` `headers()` + reverse proxy |
| **Audit log (actor, IP, action, auth events, append-only)** | ❌ versions provide none of it | `audit-log` collection + hooks |
| **Health checks** | ❌ none documented | `/healthz`, `/livez` Route Handlers |
| **Backup / restore** | ❌ no documentation at all | `pg_dump -Fc` + bucket versioning + a rehearsed restore |
| **ISR revalidation** | ❌ | `afterChange` hooks + the frontend route |
| Env validation | ❌ (`secret: process.env.PAYLOAD_SECRET \|\| ''` silently accepts empty) | Zod `src/schemas/env.ts`, fail-fast |

---

## 3. Approved Technologies

### 3.1 The stack

| Package | Version | Why | Source |
|---|---|---|---|
| `payload` | **`3.90.1` exact** (npm `latest`) | D-015. Pin exact; *"All `payload` and `@payloadcms/*` packages must be on exactly the same version and installed only once"* | `https://registry.npmjs.org/-/package/payload/dist-tags` |
| `@payloadcms/next` | `3.90.1` exact | Admin Panel + the entire HTTP layer | `https://payloadcms.com/docs/getting-started/installation` |
| `@payloadcms/db-postgres` | `3.90.1` exact | D-015: PostgreSQL 15+ via the Postgres adapter (Drizzle) | `https://payloadcms.com/docs/database/postgres` |
| `@payloadcms/storage-s3` | `3.90.1` exact | S3 / R2 / Spaces / MinIO. `config` is a pass-through to `S3ClientConfig`, which is what non-AWS providers need. **Not `@payloadcms/storage-r2`** — that is documented for the Cloudflare Workers environment, which is not a self-hosted Node deployment | `https://payloadcms.com/docs/upload/storage-adapters` |
| `@payloadcms/email-nodemailer` | `3.90.1` exact | Any SMTP provider is then an env var, not an architecture decision (D2 §14.1) | `https://payloadcms.com/docs/email/overview` |
| `next` | **`16.3.3` exact** | See §3.2 — 15.5.x is outside every supported range | `https://raw.githubusercontent.com/payloadcms/payload/3.x/templates/blank/package.json` |
| `react` / `react-dom` | `19.2.6` exact | What the official 3.x blank template pins. React is **not** a declared peer of `@payloadcms/next`, so the template is the only evidence | same |
| `typescript` | `5.7.3`+ | Template pin; `strict: true` | same |
| `sharp` | latest 0.34.x | Required in `buildConfig({ sharp })` for `imageSizes`, crop and focal point — and we use it directly for dimension extraction, the bomb guard and EXIF stripping | `https://payloadcms.com/docs/upload/overview` |
| `zod` | ^4 | Public-endpoint body validation and the fail-fast env module. Payload performs **no** env validation | project decision (NFR-11) |
| `pino` | ^9 | Pre-instantiated and passed as `buildConfig({ logger })`. **Never use Pino `transport`** — it fails under ESM/bundling and Payload is fully ESM | D2 §15 row 32 |
| `file-type` | ^21 | Magic-byte sniffing. Payload documents **no** content sniffing anywhere | B07 §4 |
| `cross-env` | ^7 | The docs' own migration/CLI npm scripts require it | CONF-09 |
| `vitest` | ^3 | D2 §18.4 — `fileParallelism: false`, 30 s timeout | D2 §18 |
| PostgreSQL | **15+** | D-015 | — |

**Do not install:** `dotenv` (Next loads env itself; two loaders produce a class of "works in the script, not in the app" bugs), `@payloadcms/richtext-lexical` on any content field (§11 / D-010 — no rich text exists in the content model and adding one is a new stored-XSS surface), `@payloadcms/plugin-cloud-storage` (the concrete adapter supersedes it).

### 3.2 The Node version question — resolved

| Fact | Value | Source |
|---|---|---|
| Payload 3's documented requirement | *"Node.js version 20.9.0+"* — **no upper bound** | installation docs |
| `payload@3.90.1` `engines.node` | `"^18.20.2 \|\| >=20.9.0"` | npm registry |
| Payload's own documented production Dockerfile | `FROM node:24-alpine AS base` | deployment docs |
| Installed on this machine | **v24.11.0** | measured |
| `svfrontend/package.json` `engines.node` | `">=20.9.0 <23"` — **already violated locally** | measured |
| Three project documents mandate | "Node 20 LTS" | `BACKEND-ROADMAP.md` P1, `IMPLEMENTATION-DECISION.md` §11/§17, `ARCHITECTURE.md` §2 |

**Decision: Node ≥ 20.9.0, and Node 24.11.0 is what we run.** Payload 3 supports it; its own production container uses Node 24. The "Node 20 LTS" mandate is a self-imposed constraint inherited from a *frontend* `engines` field that has nothing to do with the backend (CONF-08).

**Developer action, exactly:**
1. Set `svbackend/package.json` → `"engines": { "node": ">=20.9.0" }`. **Do not copy `<23` from the frontend** — the backend would refuse to install on the machine it is being built on.
2. Add `svbackend/.nvmrc` containing `24.11.0`, and (separately, Phase 9) `svfrontend/.nvmrc` containing `22.x`, so the two apps' expectations are explicit and independent.
3. Correct `BACKEND-ROADMAP.md` Phase 1, `IMPLEMENTATION-DECISION.md` §11 + §17 and `ARCHITECTURE.md` §2 to *"Node ≥20.9.0 (Node 24.x is supported and is what Payload's own production Dockerfile uses)."*
4. **Leave `svfrontend`'s own pin alone** until Phase 9. It is a frontend file and Phase 9 is approval-gated.
5. Record for the future: **Payload 4 (canary only, `4.0.0-canary.35`) will require Node ≥ 24.15.0, Next ≥ 16.2.6, TS ≥ 6.0.3.** The local 24.11.0 is *below* 24.15.0, so a v4 migration carries a Node bump. Stay on the 3.x line.

### 3.3 The Next.js version question — a hard blocker if ignored

Payload 3 supports exactly: `15.2.9`–`15.2.x`, `15.3.9`–`15.3.x`, `15.4.11`–`15.4.x`, `16.2.6`+. `@payloadcms/next@3.90.1`'s published `peerDependencies` are tighter still: `">=15.2.9 <15.3.0 || >=15.3.9 <15.4.0 || >=15.4.11 <15.5.0 || >=16.3.3 <17.0.0"` — treat the peer range as binding at install time.

**`svfrontend` is on Next 15.5.25, which is outside every supported range.** Therefore:
- `svbackend` pins `next: "16.3.3"` exactly (no `^`, no `~`) — what the official 3.x blank template pins.
- **Never match the backend's Next version to the frontend's.**
- **Any future proposal to merge Payload into `svfrontend` is blocked** until `svfrontend` is upgraded off 15.5.x. This makes D-015's separate-app choice *forced*, not merely preferred (CONF-01).
- CI asserts the installed `next` is in the supported set and that every `@payloadcms/*` version is identical, and that `npm ls react` shows exactly one copy.

### 3.4 Package manager — decided

Official wording: *"Any JavaScript package manager (pnpm, npm, or yarn 2+ — **pnpm is preferred, yarn 1.x is not supported**)."* Measured: npm 11.6.1, yarn **1.22.22** (ruled out), **no pnpm**.

**Decision: npm 11.6.1.** It is present, supported, and the official Dockerfile's `npm ci` branch fires when `package-lock.json` is committed — so nothing about the documented deployment path has to be rewritten. Installing pnpm adds a toolchain dependency to gain literal command parity with doc examples, which is not worth it.

Consequences to write down once, in `svbackend/README.md`:
- `package-lock.json` is **committed**.
- If npm objects to peer ranges, the documented escape is `npm i --legacy-peer-deps`.
- **Every `pnpm payload …` in the official docs translates to `npm run payload -- …`.** The npm script is `"payload": "cross-env NODE_OPTIONS=--no-deprecation PAYLOAD_CONFIG_PATH=src/payload.config.ts payload"`.
- ⚠️ `npx payload jobs:run` / `npm run payload -- jobs:run` are **inferred equivalents, not documented** (B09). Verify each CLI invocation once and record the working form.

---

## 4. Official Documentation References Consulted

The full evidence table — every claim, its source URL, and whether it was verified — is **§32**. This section states only the method and the coverage.

**Method.** Every Payload claim in this plan traces to one of exactly three authorities, in this precedence order:

1. **The official Payload 3 documentation**, fetched during the B-phase research (`payloadcms.com/docs/v3/**`, including the raw `.md` variants discovered via `payloadcms.com/llms.txt`) and re-verified against a local copy of the complete bundle, `payload-llms-full.txt` (1.9 MB, header *"Payload 3.x Documentation"*). Where the B-files disagreed with each other, the bundle was re-read and the disagreement resolved in writing (C2 §0.4 — three such resolutions, plus two B-file claims that **failed** verification: `root: true` on endpoint objects does not exist in v3, and `width`/`height`/`url` **are** documented auto-added upload fields, which removed a risk the research had escalated).
2. **The official `payloadcms/payload` GitHub repository, branch `3.x`** — used only for the generated `(payload)` files and the blank template's `package.json` pins, both of which the docs explicitly link to.
3. **The npm registry** — for published `engines`, `peerDependencies` and dist-tags.

No blog post, tutorial, Discord thread or GitHub issue was used as authority. **Anything not found in those three sources is marked `NOT VERIFIED IN OFFICIAL DOCS` at the point of use, and never papered over.**

**Doc areas verified, and the sections that depend on them:**

| Doc area | B-file | Consumed by |
|---|---|---|
| Installation, software requirements, `withPayload`, the `(payload)` route group, Import Map, `generate:types` | B01 | §3, §21 |
| Postgres adapter, field→table mapping, `push` vs `migrate`, transactions, `idType` | B02 | §5, §16 |
| Local API defaults, `select`/`populate`, custom endpoints, disabling generated REST, `routes`, Route Handlers, `APIError`/`afterError`, pagination | B03 | §6, §21 |
| `auth` config (13 options), cookies, sessions, `useSessions`, operations, password/KDF, lockout, first-user flow, CSRF, rate limiting | B04 | §10 |
| Collection/field/global access, defaults, `overrideAccess`, `admin.hidden` | B05 | §6, §7, §10 |
| Every field type, arrays/blocks/groups, `select`+`enumName`, validation, hooks (collection + field), globals, `orderable`, collection `admin` options, timestamps | B06 | §5, §7, §11 |
| `upload` options, auto-added fields, `imageSizes`, `mimeTypes`/restricted types/SVG, size limits, filenames, `s3Storage`, local-vs-S3, URLs/CDN, deletion, replacement, PDFs | B07 | §8 |
| Drafts, versions, `maxPerDoc`/`max`, publish/unpublish, `_status`, Trash, version tables, autosave | B08 | §5, §12 |
| Jobs queue, tasks, retries, runners, email adapters | B09 | §9, §13, §14 |
| Deployment, env vars, CORS/CSRF, the rate-limiting reality, logging, the KDF name | B10 | §10, §15, §20, §22 |
| Testing, seeding, CLI, admin customisation | B11 | §7, §17, §18 |

**Cross-document conflict resolution** is `C2-conflict-audit.md`: 92 findings (10 BLOCKER, 32 HIGH, 35 MEDIUM, 15 LOW), split into **76 verified corrections** (established by official docs, frontend source, or arithmetic — safe to apply) and **16 owner rulings** (must not be written as fact). Every `CONF-nn` reference in this plan points there.

---

## 5. Final Entity Model

**Nine Payload entities at Tier 1–2 — 8 collections + 1 global — plus Payload's own `payload-jobs`.** Down from the 15 documented logical tables; up to roughly **40–60 physical Postgres tables** once array-child, `_rels`, `_v` and `payload-*` internal tables are counted. `AI-CONTEXT.md` line 110's rule *"15 core tables … do not add tables without a traceable requirement"* must be amended to *"15 core **logical entities**; Payload-generated relation, version, array-child, locale and internal tables are exempt and are expected to number 40–60"* — left unamended, the next session reads it against a 50-table database and concludes something has gone badly wrong (CONF-54).

### 5.0 The six governing principles

| # | Principle | Consequence |
|---|---|---|
| **P1** | **Name every Payload field after the FRONTEND key, not the documented SQL column.** `types/content.ts` is the contract (NFR-12); `DATABASE-SCHEMA.md` is now a *logical* spec only | `image` not `cover`; `roadDetails` not `road_details`; `locationHighlights` not `project_features.kind='location'`. The serialiser becomes a near-identity function plus omission logic |
| **P2** | **Absence is modelled by field ABSENCE, never by a discriminator column** | `project_features.kind` and `project_media.role` disappear. Two documented tables eliminated |
| **P3** | **Omit, never null — for scalars too.** `null` is not assignable to `string \| undefined` under the frontend's `strict: true` | Extends D-008 from arrays/objects to *everything*. `featured` is the one optional field always emitted, because `false` **is** assignable to `boolean \| undefined` |
| **P4** | **A field with zero render sites is not modelled** | `brochureImages` deferred; `home.benefits`, `media.hero`, `media.heroPortrait`, `home.hero.lead/primaryCta/secondaryCta`, `location.intro.title/lead` dropped |
| **P5** | **Payload's structural guarantees beat hand-written constraints where they overlap** | A non-`hasMany` upload field enforces "one cover per project" better than the documented partial unique index — which is *written wrong in the source anyway* (A2 defect D-8: as written it permits only one of the three single-valued roles in total) |
| **P6** | **Two reserved-name renames are mandatory before migration 001** | `status` is reserved *"with Postgres Adapter and when drafts are enabled"*, and *"Using reserved field names will result in your field being sanitized from the config."* → `Project.status` → **`projectStatus`**; `Lead.status` → **`leadStatus`** (defensively — leads have no drafts today, but relying on a *conditional* reserved name is a trap). Both map back to `status` in serialisers |

### 5.1 Hard problem (a) — `description: readonly string[]`, the Phase-1 gate

**The requirement.** `types/content.ts:72` declares `description: readonly string[]`. `ProjectDetail.tsx:100-104` maps it to one `<p>` per entry with **`key={paragraph}`** — so entries must be unique strings. The public JSON must be `["para one","para two"]`, never `[{id,value}]`. This is Phase-1 exit criterion #2 and one of the four conditions that void D-015.

| | **`text` + `hasMany: true`** ← chosen | `array` with one `text` sub-field |
|---|---|---|
| Official wording | Text Field: `hasMany` — *"Makes this field an **ordered array of text** instead of just a single text."* | Array Field: *"It stores an array of **objects** containing fields that you define."* |
| JSON round-trip | `string[]` — the only reading consistent with "ordered array of text" | `Array<{ value: string, id?: string }>` — definitively objects |
| Serialiser work | **zero** — identity pass-through | `doc.description.map(r => r.value)` + strip row `id` |
| Per-entry length | ⚠️ whether `minLength`/`maxLength` apply per-entry or to the joined value is **NOT VERIFIED IN OFFICIAL DOCS** | unambiguous, on the sub-field |
| Postgres storage | ⚠️ **NOT VERIFIED** — child table vs `text[]` vs JSON. Text exposes **no `dbName`**, so the table name is not controllable | child table, name controllable via `dbName` |

**Decision: `text` + `hasMany: true`.** It is the only option that satisfies the contract with an identity serialiser. The gate **cannot hard-fail**: the array fallback also reaches `string[]` at the cost of one `.map()`.

```ts
// src/collections/Projects.ts
{
  name: 'description',
  type: 'text',
  hasMany: true,
  required: true,          // required AND minRows: minRows is enforced only "when a value is present"
  minRows: 1,
  maxRows: 12,
  label: 'Description paragraphs',
  admin: {
    description:
      'One entry per paragraph. Order is meaningful. Each paragraph must be unique — ' +
      'the website uses the text itself as a rendering key.',
  },
  validate: (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) return 'Add at least one paragraph.'
    for (const v of value) {
      if (typeof v !== 'string' || v.trim() === '') return 'Paragraphs cannot be empty.'   // EMPTY_ITEM
      if (v.length > 5000) return 'A paragraph may be at most 5000 characters.'            // TOO_LONG
    }
    if (new Set(value).size !== value.length) return 'Paragraphs must be unique.'          // DUPLICATE
    return true
  },
}
```
The validator does two things no Payload built-in does: **per-entry length and non-emptiness** (because `maxLength` semantics on `hasMany` text are unverified while `VALIDATION-RULES.md` §3 demands *each 1–5000, no empty strings*), and **uniqueness within the array** (because of `key={paragraph}`; nothing in Payload catches a React key collision).

**The gate procedure — run before migration 001:** scaffold in a throwaway sandbox on `push` → `npm run payload -- generate:db-schema` → read the emitted Drizzle schema for `description` and record whether it is a child table, a `text[]` column, or JSON → round-trip through the Local API and assert `Array.isArray(doc.description) && doc.description.every(d => typeof d === 'string')`. **Fallback if it misbehaves:** `array` + a single `text` named `value`, `dbName: 'proj_description'`, and `description: doc.description.map(r => r.value)` in `toPublicProject()`. Contract still met.

**The same shape appears again:** `site-settings.address` (`site.ts:24`, `readonly string[]`, 3 lines rendered as `<span class="block">` in three places) → `text` `hasMany` with `minRows: 1, maxRows: 5`, each ≤120. **Not a textarea.**

### 5.2 Hard problem (b) — the closed 41-value icon enum

**The GraphQL blocker-in-waiting is CLEARED.** The docs warn that select option values *"should be strings that do not contain hyphens or special characters due to GraphQL enumeration naming constraints."* Checked against the actual union (`Icon.tsx:7-48`), all 41 values are pure camelCase alphanumeric:

```
arrowRight bank bolt briefcase bus check chevronDown chevronRight city close
compass document download drain droplet external facebook fence hospital
instagram key lamp mail mapPin menu phone plane road route ruler school
shield shop star temple train tree wall whatsapp youtube zoomIn
```
**Zero hyphens, zero special characters.** The option values can be the frontend strings verbatim and `toPublicProject()` needs no icon translation layer. (The count is **41**, not 40: A4 enumerates all 41 with per-line citations and cross-checks them against `Icon.tsx:51-257`'s exhaustive `shapes` record; A5 §9.4's "40" is a counting error — CONF-79.)

| Dimension | `select` with `options` ← chosen | `text` + custom `validate` (+ hand-written CHECK) |
|---|---|---|
| Admin UI | Native dropdown over 41 values — **satisfies FR-PROJ-15 / ADMIN-CMS-SPEC §4-C "never a free-text field" for free** | A free text box. A picker must be hand-built or the hard rule is violated on day one |
| API enforcement | Rejected by Payload | Rejected only by our validator |
| DB enforcement | **A real Postgres enum type** via `enumName` — closed at the database, and *stronger* than a CHECK | none unless we write and maintain a CHECK in a custom migration |
| `BACKEND-ROADMAP` line 79 (*"rejects invalid values at API **and** DB"*) | satisfied by construction | satisfied only with extra migration work |
| Cost when the 41 values change | `ALTER TYPE … ADD VALUE` is cheap and forward-only on PG 15. **Removing or renaming is expensive** — Postgres has no `DROP VALUE`, so it is create-new-type → `ALTER COLUMN … USING` on every column → drop old type | one `ALTER TABLE … DROP/ADD CONSTRAINT` per table — genuinely cheaper |

**The churn argument, answered honestly:** `text + CHECK` *is* cheaper to change. But `Icon.tsx:50` is `const shapes: Record<IconName, ReactNode>` — an **exhaustive** mapped type. Adding a name to the union without adding an SVG is a TypeScript error, so the CMS **cannot** introduce an icon at all; adding one is a frontend code change first (D-007). Icon-set churn happens once or twice in the life of the project, inside a deploy that already touches both repos. **Choose `select`.**

```ts
// src/lib/icons.ts — ONE source of truth, CI-diffed against svfrontend/src/components/ui/Icon.tsx
export const ICON_NAMES = [
  'arrowRight','bank','bolt','briefcase','bus','check','chevronDown','chevronRight','city','close',
  'compass','document','download','drain','droplet','external','facebook','fence','hospital',
  'instagram','key','lamp','mail','mapPin','menu','phone','plane','road','route','ruler','school',
  'shield','shop','star','temple','train','tree','wall','whatsapp','youtube','zoomIn',
] as const
export type IconName = (typeof ICON_NAMES)[number]

// src/fields/iconField.ts
import type { Field } from 'payload'
export const iconField = (): Field => ({
  name: 'icon',
  type: 'select',
  required: true,
  options: ICON_NAMES.map((v) => ({ label: humanise(v), value: v })),
  enumName: 'enum_icon_name',        // explicit and stable — never rely on auto-generation
  admin: { isClearable: false, description: 'Closed list. A new icon requires a frontend release.' },
})
```

Three mandatory mitigations:
1. **`enumName: 'enum_icon_name'` explicitly, on every icon field.** Auto-generated enum names derive from the field/table path and would produce a *separate* PG enum per list — the icon appears in at least **six** places on `projects` (`highlights`, `amenities`, `approvals`, `locationHighlights`, `proximity`) plus `site-settings.social` plus `heroTicker`, doubled again by `_v` version tables. ⚠️ **NOT VERIFIED IN OFFICIAL DOCS whether Payload deduplicates an identical `enumName` across fields into a single PG type.** Spike it in Phase 1: `generate:db-schema` with two icon fields sharing an `enumName`, then count the emitted enums. If it does not dedupe, accept six enums and write the migration as a loop — but know that going in.
2. **A CI guard** (`src/scripts/checkIconDrift.ts`) that diffs `ICON_NAMES` against `svfrontend/src/components/ui/Icon.tsx` and fails the build on drift. The union lives in the other repo; nothing else catches it.
3. **A defensive serialiser fallback** — `ICON_NAMES.includes(v) ? v : 'check'`. Unreachable given the DB enum, but the failure mode it guards is the worst in the codebase: an unknown icon renders *"a silent, invisible 24 px blank box… No error, no warning, no visual indication in logs."*

A *visual* picker (ADMIN-CMS-SPEC §4-C wants pictures) is a small custom `admin.components.Field` over the same select. **Optional** — the plain select already satisfies FR-PROJ-15.

**The other closed enums, by the same reasoning:**

| Enum | Field | `enumName` | Note |
|---|---|---|---|
| `category` (4) | `projects.category` | `enum_project_category` | required. Values contain **spaces** (`Premium Villa Plots`). Spaces are not hyphens and are not named in the caveat, but spike it in 60 seconds. Fallback: `value: 'premium_villa_plots'` + `label: 'Premium Villa Plots'`, mapped back in the serialiser |
| `projectStatus` (4) | `projects.projectStatus` | `enum_project_status` | optional, `isClearable: true`, **no `defaultValue`**. Populated on **0/5** projects |
| `source` (4) | `leads.source` | `enum_lead_source` | server-assigned |
| `action` (11) | `audit-log.action` | `enum_audit_action` | extended from the documented 7 — see §5.7 |

**`categoryOrder` stays in frontend code.** `projects.ts:328-333` declares the display order of the filter pills as a second, independent 4-value tuple. It is structural, closed, and changing it requires a frontend deploy regardless. Do not model it. `usedCategories()` becomes a value derived from the published set.

### 5.3 Hard problem (c) — project ordering

**The brief's premise is wrong and the correction is load-bearing: Payload DOES have native collection drag-ordering.** Verified verbatim on the Collections page: **`orderable`** — *"If true, enables custom ordering for the collection, and documents can be reordered via drag and drop"*, and *"When `orderable` is enabled, Payload uses **fractional indexing** to efficiently manage document order."* Payload exports `generateKeyBetween` / `generateNKeysBetween` from `payload/shared`. This is precisely the capability that got Strapi rejected in `IMPLEMENTATION-DECISION.md` §16.

**The conflict it creates:**

| Source | Says |
|---|---|
| `DATABASE-SCHEMA.md` §3 | `sort_order int DEFAULT 0`, indexed `(published_at, sort_order)` |
| `VALIDATION-RULES.md` §3 | `sortOrder` validated as `int ≥0` |
| `API-CONTRACT.md` §2.6.2 | `PATCH /admin/projects/order` with `{ "order": [{"id":"…","sortOrder":0}] }` |
| Payload `orderable` | a **fractional-index string key**, not an integer |

These are mutually exclusive. **Decision: adopt `orderable: true` and delete integer `sortOrder` from the schema, the validation rules and the API contract.** Hand-rolling an integer `sortOrder` plus a reorder UI with optimistic update and rollback (ADMIN-CMS-SPEC §3) re-incurs exactly the cost D-015 chose Payload to avoid.

```ts
export const Projects: CollectionConfig = {
  slug: 'projects',
  orderable: true,                  // native fractional-index drag ordering in the List View
  defaultSort: '<ORDER_FIELD>',     // ⚠ name unresolved — see the spike below
  // …
}
```

⚠️ **The one unresolved fact, stated plainly:** the **name** of the field/column that `orderable` creates is **NOT VERIFIED IN OFFICIAL DOCS** (B06 §12 fetched the Collections page twice specifically for it), and therefore neither is how to `sort` a public query by it. The commonly-assumed `_order` is *not stated on the page*. Public `GET /projects` must return catalogue order (FR-PUB-01, *"in admin order"*), so we need that name.

**Phase-1 spike (≈10 minutes, must run before the public endpoint is written):** enable `orderable: true` on a throwaway collection → `npm run payload -- generate:db-schema` → read the added column off the emitted Drizzle schema → confirm `payload.find({ sort: '<name>' })` returns drag order → record the name in `DECISIONS.md`. Fractional-index keys sort correctly as plain lexicographic strings, which is the whole point of the scheme, so once the name is known a plain `sort` works. **Do not build a derived integer mirror** — a hook maintaining `displayOrder` alongside the fractional key creates a second source of truth that drifts the moment anyone reorders through the API rather than the UI. **The order key is never exposed publicly** — it is not in `types/content.ts`.

| What needs ordering | Mechanism | Free? |
|---|---|---|
| Projects in catalogue / homepage / sitemap / `<select>` | `orderable: true` + `sort` on the public endpoint | ✅ native |
| Rows inside `stats` / `highlights` / `amenities` / `approvals` / `locationHighlights` / `proximity` | Array fields are drag-sortable by default (`admin.isSortable` — *"Disable order sorting by setting this value to `false`"*) | ✅ native |
| Paragraphs inside `description` | *"an ordered array of text"* | ✅ (verify in the §5.1 gate) |
| `gallery` image order | `upload` + `hasMany` — ordering is **asserted but not documented** | ⚠️ verify in the Phase-1 spike. Fallback: an `array` of `{ image: upload }` rows, drag-sortable by construction, at the cost of one child table and one `.map()` |
| `site-settings.address` lines | `hasMany` text | ✅ |
| `social` / `legalLinks` / `heroTicker` | array fields in the global | ✅ |
| Testimonials / FAQs / Statistics | `orderable: true` per collection | ✅ native |

**Cardinality traps ordering cannot fix** (carry these into admin field descriptions, never into hard constraints): `featuredProjects` renders in `tablet:grid-cols-3` (`app/page.tsx:75`) — a 4th featured project produces a ragged row. `project.stats` renders `tablet:grid-cols-4` — 4 is the convention on all four projects that have stats. The homepage borrows `projects[0..2]` for MediaSequence and `projects.slice(0,4)` for PinnedProof. `app/page.tsx:66` hardcodes the literal string **"Five layouts."** — publishing a sixth project silently makes the homepage lie (OQ-10). **And `approvals[0].title` feeds every project's meta description via `lib/seo.ts:51`, so reordering that one list silently changes SEO** — that sentence belongs in the field's admin description.

### 5.4 Hard problem (d) — `ProjectMedia`: its own collection, or named upload fields?

`MEDIA-MANAGEMENT.md` §4 defines **seven** roles — five project-scoped and two site-scoped. The two lists answer different questions and were merged into one table by mistake (CONF-21).

| Role | Cardinality | Scope | Rendering | Frontend key |
|---|---|---|---|---|
| `cover` | **1, required** | project | cropped 4:3 card + 16:9 hero + OG image | `image` |
| `gallery` | 0..n ordered | project | cropped 4:3 grid | `gallery` |
| `layout` | 0..1 | project | **contained**, zoomable, never cropped | `layoutImage` |
| `location_map` | 0..1 | project | **contained** | `locationMap` |
| `brochure` | 0..n ordered | project | — **no render site exists anywhere in `src/`** | `brochureImages` |
| `logo` | 0..1 | **site** | circular badge | `site-settings.logo` |
| `document` | 0..n | **site** | download link | ⚠️ had **no modelled home at all** (A2 contradiction C-7) |

**Decision: NO separate `project-media` collection. Four named upload fields on `projects`** (five when `brochureImages` is un-deferred), plus a separate `documents` upload collection for the site-scoped PDFs.

| Requirement | Named upload fields | A `project-media` join collection |
|---|---|---|
| Role discrimination | **The field name IS the role.** Zero enum, zero CHECK, zero drift | a `role` select + a CHECK + a hook, because nothing stops role/field mismatch |
| `cover`/`layout`/`location_map` single-valued | **Enforced by the schema** — a non-`hasMany` upload field physically cannot hold two. *"the equivalent in Payload is simply a non-`hasMany` field, which is enforced by the schema, not a partial index"* | a partial unique index Payload does not generate — and which **is written wrong in the source spec** (A2 D-8 / CONF-19: as written it forbids a project from having both a cover and a layout) |
| `cover` required | `required: true` on the field | a hook — "at least one row with role=cover" is not expressible declaratively |
| ordering within multi-valued roles | field-level | a `sort_order` column + a reorder endpoint *within a role* |
| Replace in place (FR-MEDIA-07) | **native** — the media document id never changes, so every reference survives | identical |
| In-use delete guard (FR-MEDIA-08) | one `join` field per referencing field + a `beforeDelete` hook summing them | one query on one table — **the only axis on which the join table wins** |
| Orphan detection (FR-MEDIA-11) | the same join fields, `totalDocs === 0` across all | one `NOT EXISTS` |
| Admin UX (§4-D: five labelled pickers) | **exactly five labelled pickers, generated from config** | one generic repeater with a role dropdown — strictly worse, and it permits two covers until a hook stops it |
| `toPublicProject()` | identity mapping to `image` / `gallery` / `layoutImage` / `locationMap` | group-by-role then re-split into five differently-shaped keys — pure overhead |

The join table wins on one axis and loses on seven, and the axis it wins is solved by a documented Payload feature — the **Join Field**, *"used to make Relationship and Upload fields available in the opposite direction"*, virtual, no storage, supported on Postgres, returning `{ docs, hasNextPage, totalDocs }`.

**Consequences that must be written down:**
1. **`project_media` disappears** from the table count, along with its `role` CHECK, its partial unique index, and the three endpoints `POST|DELETE|PATCH /admin/projects/{id}/media…`. Payload's own document editor is the attach UI, and the `409` documented for "single-valued role already taken" ceases to exist.
2. **`ON DELETE RESTRICT` is not replicated.** Payload documents **no** referential-integrity or cascade behaviour for relationship/upload fields, and the Postgres adapter page documents no `ON DELETE` semantics — **NOT VERIFIED IN OFFICIAL DOCS**. The guard is 100 % application-level (`beforeDelete` + join fields). A2 gap G-14 already notes the FK never fires anyway because media delete is a *soft* delete. Amend `DATABASE-SCHEMA.md` §3.21 to say so rather than mandating a constraint Payload will not create.
3. **Site-scoped `document` (0..n) gets a home**: a separate `documents` upload collection (§5.8), referenced from `site-settings`. A single upload collection cannot express two different `mimeTypes` allow-lists — that is *why* it is two collections.
4. **`brochureImages` is not built in Tier 1.** `types/content.ts:98` declares it; A4 §2.4 and A5 §2.4 both confirm **zero render sites anywhere in `src/`**; 0/5 projects populate it. By P4 it is not modelled. One field + one migration adds it the day a render slot exists. Record the conflict: `CONTENT-MANAGEMENT-MATRIX.md` row 23 and FR-MEDIA-05 both put `brochure` at T1; **the code wins.**

### 5.5 ER diagram

```mermaid
erDiagram
    USERS ||--o{ AUDIT_LOG : "adminUser (nullable)"
    USERS ||--o{ MEDIA : "uploadedBy"
    PROJECTS }o--|| MEDIA : "image (required, 1)"
    PROJECTS }o--o{ MEDIA : "gallery (hasMany)"
    PROJECTS }o--o| MEDIA : "layoutImage (0..1)"
    PROJECTS }o--o| MEDIA : "locationMap (0..1)"
    SITE_SETTINGS }o--o| MEDIA : "logo (0..1)"
    SITE_SETTINGS }o--o{ DOCUMENTS : "masterPlan / brochures (T2)"
    TESTIMONIALS }o--o| MEDIA : "avatar (DEFERRED - untraced)"
    LEADS }o--o| PROJECTS : "project (soft ref + slug + name snapshot)"
    PROJECTS ||--o{ PROJ_STATS : "stats[]"
    PROJECTS ||--o{ PROJ_HIGHLIGHTS : "highlights[] (>=1)"
    PROJECTS ||--o{ PROJ_AMENITIES : "amenities[]"
    PROJECTS ||--o{ PROJ_APPROVALS : "approvals[] (audited)"
    PROJECTS ||--o{ PROJ_LOC_HL : "locationHighlights[]"
    PROJECTS ||--o{ PROJ_PROXIMITY : "proximity[]"
    PROJECTS ||--o{ PROJECTS_V : "versions (_v) + drafts"

    USERS {
        uuid id PK
        text email UK "auth-injected, lowercased by hook"
        text name
        enum role "admin"
        bool isActive "deactivate, never delete"
        int tokenVersion "D-004 fallback, see 10.7"
    }
    PROJECTS {
        uuid id PK
        text slug UK "index, locked after publish"
        text name
        enum category "4 values"
        enum projectStatus "RENAMED from status - P6"
        text locality
        text summary
        text_array description "hasMany text - the gate"
        bool featured
        date publishedAt "hook-stamped, not native"
        text _status "draft|published - injected"
        date deletedAt "trash:true"
        text order_key "orderable - NAME UNVERIFIED"
    }
    MEDIA {
        uuid id PK
        text alt "required; '' allowed via isDecorative"
        bool isDecorative
        int width "WE own it"
        int height "WE own it"
        text filename "UUID, hook-renamed"
        text originalFilename "display only"
        date deletedAt "trash:true"
    }
    LEADS {
        uuid id PK
        text name
        text phone "verbatim as submitted"
        text phoneNormalised "E.164, indexed"
        text projectSlug "soft, never trusted"
        text projectNameSnapshot
        enum source "server-assigned"
        bool isRead
        bool consentGiven
        text ipAddress "purged at 90 days"
        date deletedAt "trash:true, NEVER hard delete"
    }
    AUDIT_LOG {
        uuid id PK
        enum action "11 values, not 7"
        text entityType "indexed"
        text entityId "indexed"
        json changes "sensitive fields only"
        text ipAddress
    }
```

### 5.6 The Tier-1 entities

---

#### `users` — COLLECTION (auth) · Tier 1

**Kind & justification.** COLLECTION. Globals are for *"a single Document"* and *"If you have more than one Global that share the same structure, consider using a Collection instead."* Multiple admins exist, and Payload's auth is a collection-level feature (`auth: true`), so this is forced.
**Why it exists.** FR-AUTH-01..09 (P0, CONFIRMED); the business brief's *"only authorized administrators"*; `DATABASE-SCHEMA.md` §1 `admin_users`. A6 §7 confirms the frontend has **zero** auth primitives — this entity is 100 % new capability evidenced by the brief, not by code, and that is correct.
**Managed by.** Seeded/invited only. **FR-AUTH-09: no self-registration endpoint.**
**Visibility.** Admin-only. **No public representation at all.**

| Field | Payload type | Req | Validation / default | Admin | Reason |
|---|---|---|---|---|---|
| `email` | auth-injected | ✔ | unique; lowercase+trim via a `beforeValidate` field hook | — | login identifier. ⚠️ `citext` is not a Payload concept — without the hook, `Admin@x.com` and `admin@x.com` are two rows under `unique: true` (CONF-51) |
| `password` | auth-injected | ✔ | redefined with `validate`: ≥12 chars + breach-list check | — | FR-AUTH-04. ⚠️ attaching `validate` to the injected password field is **NOT VERIFIED IN OFFICIAL DOCS** — prove it in the Phase-2 spike (§10.4) |
| `name` | `text` | ✔ | ≤120 | — | display name + audit attribution |
| `role` | `select` | ✔ | `options: ['admin']`, `defaultValue: 'admin'`, `enumName: 'enum_admin_role'` | sidebar | single role today (OQ-4). The column exists so OQ-4 needs no migration |
| `isActive` | `checkbox` | ✔ | `defaultValue: true` | sidebar, `description: 'Disable instead of deleting — audit attribution must survive.'` | A2 §3.3: *"No `deleted_at` — deactivate, never delete"* |
| `tokenVersion` | `number` | ✔ | `defaultValue: 0`, `hidden: true` | — | the D-004 fallback — **build only if §10.7's Phase-2 verification fails** |

**Relations.** Referenced by `audit-log.adminUser` and `media.uploadedBy` — those live in the *referencing* side's `_rels` table.
**Ordering.** `defaultSort: 'email'`. **Publication.** `versions: false` — versioning an auth collection multiplies credential-adjacent history for no benefit.
**Archive vs delete.** **Neither.** `access.delete: () => false`, `trash: false`. Deactivate via `isActive`. The one entity where soft delete is explicitly rejected (D-006's own exception).
**Access.** `create: isAdmin · read: isAdmin · update: isAdmin · delete: () => false · unlock: isAdmin · admin: isAdmin`. **`readVersions` N/A** (no versions).
**Public JSON.** None, ever.

---

#### `media` — COLLECTION (upload) · Tier 1 · **upstream of `projects`**

**Why it exists.** FR-MEDIA-01..09, 11..13. `ImageRef` (`types/content.ts:29-34`) requires `src`, `alt`, `width`, `height` — **all four non-optional**. Six `next/image` call sites plus two raw `<img>` in `Lightbox.tsx:61-70, 118-128`.

🔴 **Sequencing correction (CONF-26).** `BACKEND-ROADMAP.md` builds Projects in Phase 1 and Media in Phase 5. **That ordering is impossible** — a media role is an `upload` field with `relationTo: 'media'`, and the target collection must exist in the config for the relation to resolve. **The `media` skeleton (the collection, `alt`, `width`, `height`, local-disk storage) is a Phase-1 prerequisite.** Media *hardening* (S3, sniffing, EXIF, UUID keys, delete guard, sweeper, orphans) stays in Phase 5. Phase 5's entry criterion also relaxes from *"Phase 4 + OQ-7"* to *"Phase 4; OQ-7 required only for the S3 adapter task"*, because `enabled: Boolean(env.S3_BUCKET)` is the documented conditional pattern.

Full upload config, hooks, storage and the SVG conflict: **§8**. Field table:

| Field | Payload type | Req | Validation / default | Admin | Reason |
|---|---|---|---|---|---|
| `alt` | `text` | ✔ | ≤300, `''` permitted when `isDecorative` | `description: 'Describe the image for screen readers. Tick "decorative" instead if it carries no information.'` | FR-MEDIA-04; `ImageRef.alt` is a required non-nullable string |
| `isDecorative` | `checkbox` | ✖ | `defaultValue: false` | — | **the `alt: ''` problem.** `pages.ts:20` deliberately sets `alt: ''`; `Logo.tsx` and `PinnedProof.tsx:119-126` pass `alt=""`. `required: true` on `alt` rejects `''`. The serialiser emits `alt: isDecorative ? '' : alt` |
| `width` | `number` | ✔ | server-extracted; `admin.readOnly` **plus** field `access.create/update: () => false` | sidebar | see the note below |
| `height` | `number` | ✔ | same | sidebar | same |
| `originalFilename` | `text` | ✖ | server-set, readOnly + field access closed | sidebar | *"Display only — never used as the storage key"* |
| `uploadedBy` | `relationship → users` | ✖ | server-set in `beforeChange`, readOnly + field access closed | sidebar | audit attribution |
| `usedAsCover` / `usedInGallery` / `usedAsLayout` / `usedAsLocationMap` | `join → projects` on `image` / `gallery` / `layoutImage` / `locationMap` | — | virtual, no storage | tab "Used in" | FR-MEDIA-08 / FR-MEDIA-11 |
| *(auto)* `filename`, `mimeType`, `filesize`, `width`, `height`, `url`, `thumbnailURL`, `sizes` | — | — | Payload-injected | — | documented verbatim: *"`filename`, `mimeType`, `filesize`, `width`, `height`, `url`, `thumbnailURL` — Added when: Uploads are enabled"* |

⚠️ **The `width`/`height` provenance decision, made deliberately.** B07 §2 escalated as HIGH/blocking that these are undocumented; **C2 CONF-33 verified against the docs bundle that they ARE documented** and removed the risk. They are nevertheless produced by *Payload's* pipeline, not by our contract, and the **CLS budget < 0.05** (NFR-03) plus `lib/seo.ts:62-65`'s Open Graph tags depend on them. **Decision: declare our own `width`/`height` fields and populate them from `sharp().metadata()` in the same `beforeOperation` hook that already reads dimensions for the bomb guard.** The read is already happening; writing two integers costs nothing, and it makes the contract surface ours. A contract test asserts every emitted `ImageRef` has exactly four keys with `width`/`height` as numbers.

**Publication.** `versions: false` — versioning binary metadata is pointless and multiplies rows.
**Archive vs delete.** **`trash: true`** → native `deletedAt`. Hard delete only by `src/jobs/sweepDeletedMedia.ts` after the OQ-17 grace period (recommend **30 days**), which **re-checks attachment before removing the storage object**, inside the same transaction. ⚠️ **What happens to the OLD S3 object after a replace is NOT VERIFIED IN OFFICIAL DOCS** — capture `previousDoc.filename` in `afterChange` and enqueue it for the sweeper, or the "an accidental replace is recoverable for 30 days" promise is silently false.
**Access.** `create: isAdmin · read: isAdmin · update: isAdmin · delete: isAdmin`. The *files* are public via the CDN; the *documents* are not.
**Public JSON.** Media documents are **never** returned as documents. They appear only flattened:
```jsonc
{ "src": "https://media.<domain>/media/9f3c…c41.jpg",
  "alt": "Sri City Aler Town — premium villa plots on the Warangal highway",
  "width": 1200, "height": 800 }
```

---

#### `projects` — COLLECTION ★ the core entity · Tier 1

**Why it exists.** FR-PROJ-01..18 (11× P0). `types/content.ts:57-105`. `content/projects.ts:56-320` — five real, brochure-sourced records with **zero** bracketed placeholders. PRD §6: *"The `Project` entity is the heart of the CMS."*

```ts
export const Projects: CollectionConfig = {
  slug: 'projects',
  orderable: true,                              // §5.3
  defaultSort: '<ORDER_FIELD>',                 // resolved by the §5.3 spike
  trash: true,                                  // FR-PROJ-06 archive → native deletedAt
  versions: {
    maxPerDoc: 20,                              // EXPLICIT — the default is 100 and pruning is undocumented
    drafts: { autosave: false, validate: false },
  },
  defaultPopulate: { slug: true, name: true, locality: true },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name','category','locality','featured','_status','updatedAt'],
    listSearchableFields: ['name','locality','slug'],
    group: 'Content',
    baseFilter: hideTrashed,                    // ⚠ the option is `baseFilter`, NOT `baseListFilter`
    preview: (doc) => `${process.env.FRONTEND_URL}/projects/${doc.slug}`,
  },
  access: {
    read: publishedOrAuthenticated, create: isAdmin, update: isAdmin,
    delete: isAdmin, readVersions: isAdmin,
  },
  hooks: {
    beforeValidate: [slugify, slugLock],
    beforeChange:   [stampPublishedAt],
    afterChange:    [writeAudit, revalidateProject],
    afterDelete:    [writeAudit, revalidateProject],
    beforeDuplicate:[suffixSlug],
  },
  fields: [ /* tabs below */ ],
}
```

**Tab: Identity** (unnamed `tabs` have zero schema impact)

| # | Field | Type | Req | Validation / default | Admin | Reason |
|---|---|---|---|---|---|---|
| 1 | `name` | `text` | ✔ | trim, 1–120 | `useAsTitle` | `content.ts:59` |
| 2 | `slug` | `text` | ✔ | `unique: true`, `index: true`, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1–100; slugified from `name` in `beforeValidate`; `beforeDuplicate` suffixes to avoid a unique-index violation; **locked after first publish** | `position: 'sidebar'` | `content.ts:58`. Drives `/projects/[slug]`, `generateStaticParams`, sitemap, canonical, and `ContactForm`'s `<option value>` |
| 3 | `category` | `select` | ✔ | 4 options, `enumName: 'enum_project_category'` | — | `content.ts:61`. Card badge, filter predicate, SEO title |
| 4 | `projectStatus` | `select` | ✖ | 4 options, `enumName: 'enum_project_status'`, `isClearable: true`, **no `defaultValue`** | `description: 'Leave blank unless the brochure states one — no project has one today.'` | ⚠️ **renamed from `status` (P6)**. `content.ts:63`. **0/5 populated.** Renders only at `ProjectCard.tsx:30-33` |
| 5 | `locality` | `text` | ✔ | trim, 1–200 | — | `content.ts:65`. Card, detail, `ContactForm.tsx:107`, SEO |
| 6 | `developer` | `text` | ✖ | ≤200 | `description: 'Only if different from the site's own company name. e.g. Sri Virinchi Infra Developers Pvt. Ltd.'` | `content.ts:68`. **1/5 populated.** `ProjectDetail.tsx:63-68` only |
| 7 | `tagline` | `text` | ✖ | ≤200 | — | `content.ts:70`. 5/5 populated — de facto required, but both consumers guard it, so keep it optional |

**Tab: Narrative**

| # | Field | Type | Req | Validation | Admin | Reason |
|---|---|---|---|---|---|---|
| 8 | `summary` | `textarea` | ✔ | trim, 1–600 | `description: 'Rendered as the large heading on the detail page — not a paragraph.'` | `content.ts:71`; `ProjectDetail.tsx:97` renders it as an `<h2>` |
| 9 | `description` | `text` **`hasMany`** | ✔ | §5.1 in full | `description: 'One entry per paragraph. Order matters. Each must be unique.'` | `content.ts:72` |
| 10 | `area` | `text` | ✖ | ≤100. **Never coerce to a number** (D-009) | `description: 'Exactly as printed, e.g. "6 Acres 22.50 Guntas".'` | `content.ts:86`. 1/5 |
| 11 | `roadDetails` | `text` | ✖ | ≤200 | — | `content.ts:88`. 3/5 |

**Tab: Lists** — **six** repeatable lists, not four. ADMIN-CMS-SPEC §4's header says "4 repeatable lists" and then enumerates six; `BACKEND-ROADMAP.md` Phase 1 says "4 repeatable feature arrays", which is right only if it means the four `featureItem` arrays. Say it unambiguously: **six lists — four `featureItem` arrays (`highlights`, `amenities`, `approvals`, `locationHighlights`) plus `stats` `{label,value}` and `proximity` `{icon,measure,place}`** (CONF-87).

Every one is an `array` with an explicit **`dbName`** (Postgres identifiers cap at 63 bytes and Payload's derivation is undocumented), `maxRows: 50`, `admin.initCollapsed: true`, and a `RowLabel` client component so rows read as their title rather than "Item 03".

| # | Field | `dbName` | Row shape | Req | Notes |
|---|---|---|---|---|---|
| 12 | `stats` | `proj_stats` | `label` text req ≤60 · `value` text req ≤120 | ✖ | 4/5, always exactly 4 when present. `value` is **text** — `"6 Acres 22.50 Guntas"`, `"DTCP & RERA"`, `"100%"` (D-009). `key={stat.label}` → **labels must be unique** |
| 13 | `highlights` | `proj_highlights` | `iconField()` · `title` text req ≤200 · `body` textarea ≤1000 | ✔ `minRows: 1` | 5/5, always exactly 4. Unguarded in JSX at `ProjectDetail.tsx:122`; `FeatureList.tsx:24` self-guards on empty |
| 14 | `approvals` | `proj_approvals` | same | ✖ | 4/5. ⚠️ `admin.description`: *"Legal claims — these edits are audited. **The first item appears in this project's search-result description.**"* |
| 15 | `amenities` | `proj_amenities` | same | ✖ | 4/5 (1, 5, 6, 9 items — **a 1-item repeater must be legal**) |
| 16 | `locationHighlights` | `proj_loc_hl` | same | ✖ | 3/5 (9, 10, 11 items) |
| 17 | `proximity` | `proj_proximity` | `iconField()` · `measure` text req ≤40 · `place` text req ≤200 | ✖ | **0/5 populated but fully wired** (`ProjectDetail.tsx:176-190`). ⚠️ `admin.description`: *"Only enter distances printed on the brochure. An unmeasured proximity claim is the most likely to be challenged."* `key={item.place}` → **places must be unique** |

`FeatureItem.body` is optional and **not one of the 96 project feature items uses it**. Keep it optional (the shared type requires it and `pages.ts` lists do use it) with `admin.description: 'Optional. Most brochure highlights are one line.'`

**Tab: Media** (§5.4, §8)

| # | Field | Type | Req | Notes |
|---|---|---|---|---|
| 18 | `image` | `upload → media` | ✔ | `content.ts:90`. **Named `image`, not `cover`** (P1). Card 4:3 + hero 16:9 + OG |
| 19 | `gallery` | `upload → media`, `hasMany` | ✖ | `content.ts:92`. 0/5. Ordering verified in the Phase-1 spike |
| 20 | `layoutImage` | `upload → media` | ✖ | `content.ts:94`. 0/5. `description: 'Shown contained and zoomable — never cropped.'` |
| 21 | `locationMap` | `upload → media` | ✖ | `content.ts:96`. 0/5. Same |
| — | ~~`brochureImages`~~ | — | — | **DEFERRED (P4).** Zero render sites; 0/5 populated. Do not create the field in Tier 1 |

**Tab: Overrides** (collapsed by default)

| # | Field | Type | Req | Notes |
|---|---|---|---|---|
| 22 | `cta` | named `group` `{ title text ≤120, description text ≤400 }` | ✖ | `content.ts:100` — **both members required inside.** Enforce *both-or-neither* in a group-level `validate` → `INCOMPLETE_PAIR`. 0/5 |
| 23 | `seo` | named `group` `{ title text ≤70, description text ≤160 }` | ✖ | `content.ts:102` — **both members optional inside**, asymmetric with `cta`. Mirror that exactly or `seo: {}` becomes impossible and `cta: { title }` becomes possible. **Do not add a generated default:** `seo.ts:36-39` guarantees the auto-description is facts-only, *"superlatives are absent by construction: there is no field they could come from."* Preserve that. 0/5 |

⚠️ **The site-wide CTA is `{title, body}`; the per-project override is `{title, description}`. They are different fields and must not be unified** (A2 defect D-11). `ProjectDetail.tsx:213-217` falls back to a *hardcoded literal*, not to the site CTA, so they really are independent.

**Sidebar**

| # | Field | Type | Req | Notes |
|---|---|---|---|---|
| 24 | `featured` | `checkbox` | ✖ | `defaultValue: false`. 3/5. `description: 'The homepage strip is a 3-column grid. A fourth featured project leaves a ragged row.'` |
| 25 | `publishedAt` | `date` | ✖ | `admin.readOnly` **+** field `access.create/update: () => false`; stamped in `beforeChange` on the `draft → published` transition | ⚠️ **Payload gives `_status`, not a publish date.** `IMPLEMENTATION-DECISION.md` §7 maps `published_at` to *"✅ Native draft/publish"* — **that mapping is wrong in mechanism** (CONF-11). We need a real timestamp for `sitemap.xml` `lastModified` (there is none today) |
| — | `_status` | injected | — | `'draft' \| 'published'`. **Stripped by the serialiser** |
| — | `deletedAt` | Trash | — | native under `trash: true` |
| — | *(order key)* | `orderable` | — | fractional index, **name TBD by the spike**, never public |

**Relations and their Postgres consequences.** Four `upload → media` fields → rows in **`projects_rels`** (`relationshipsSuffix` default `_rels`); `gallery` contributes one row per image. Six array fields → **six child tables**, each with its own columns plus (undocumented but universally observed) a parent id and an order column — ⚠️ **array row `id` and `_order` columns are NOT VERIFIED IN OFFICIAL DOCS**; read `generate:db-schema` before writing any migration or raw SQL. `description` → **probably a seventh child table**, name uncontrollable. Versions → **`projects_v`** plus a versioned counterpart of *every* child table and of `_rels`. Realistic physical count for this one collection: **≈18–20 tables**.

⚠️ Payload's own Database Overview says *"You should prefer MongoDB if … You leverage a lot of Arrays, Blocks, or `hasMany` Select fields."* We are deliberately going against that grain. It is a documented trade-off, not a bug — but `GET /projects` fans out into many joins. Mitigate with include-mode `select` and `defaultPopulate` on the public endpoint, pin `depth` explicitly, and cache the response.

**Publication behaviour.** Drafts **ON**.
- `autosave: false` **for v1, deliberately, with the reason recorded**: the default interval is **800 ms**, every autosave is a real DB write and fires *every* `afterChange` hook — which would flood `audit-log` and call the revalidation webhook roughly once per second while an editor types a paragraph. ⚠️ The hook-argument property that identifies an autosave write is **NOT VERIFIED IN OFFICIAL DOCS**; before autosave is ever enabled, the audit and revalidate hooks must first be *proven* to skip autosave writes — an empirical task, not a config change.
- `validate: false` on drafts (the documented default), **against `VALIDATION-RULES.md`'s preference**: the 8 required fields (including the required `image`) genuinely cannot be filled on day one of a new project, and ADMIN-CMS-SPEC's preamble demands that *"I don't have this information"* be an easy choice. **Drafts are scratch; publish is validated.**
- The admin surfaces three states — Draft / Published / **Changed** — which maps onto ADMIN-CMS-SPEC §3's Published/Draft/Archived plus one the spec did not anticipate.
- 🔴 **A plain `find()` does NOT filter out drafts.** Official: *"the `draft` argument on its own will not restrict documents with `_status: 'draft'` from being returned from the API."* A brand-new document is always written to the main collection with `_status: 'draft'`, and an unpublished document is reverted there. Compounding it, the Local API defaults `overrideAccess: true`. **Three layers are mandatory — §6.5.** For SV Developers the leaked content is DTCP/RERA approval numbers and land-title claims not cleared for publication: the severity is legal, not merely technical.
- ⚠️ **Which collection hooks run for drafts, versions and autosave is NOT VERIFIED IN OFFICIAL DOCS.** Establish it empirically before wiring the audit hook, or it double-fires (draft save + publish) or never fires.

**Archive vs delete.** `trash: true`. *"Hard-deleting a project orphans a live URL and its sitemap entry"* (D-006). `admin.baseFilter` hides trashed rows. A trashed document *"can no longer have a version **restored** until it is first restored from trash"* — surface that in the restore UI copy, because `API-CONTRACT.md` §2.6.2 offers `POST /admin/projects/{id}/restore` with no such caveat. Archived → public **404**, never 403.

**Public JSON.** See §6.2 for the exact key sets and the thin-record acceptance test.

**Frontend consumers.** `ProjectCard.tsx:14,19-22,28,30-34,38,41,43` · `ProjectCatalogue.tsx:21,53,54` · `ProjectDetail.tsx:21-218` · `FeatureList.tsx:38-49` · `app/projects/page.tsx:24` · `app/projects/[slug]/page.tsx:10,25` · `app/page.tsx:36-39,56,76-77` · `app/sitemap.ts:16` · `lib/seo.ts:42,50,51,52,60-66` · `ContactForm.tsx:104-108` · `content/projects.ts:322-345`.

⚠️ **`ContactForm.tsx:8` imports `projects` directly into a `'use client'` module.** A client module cannot import server-fetched data. The project list must become a prop from `app/contact/page.tsx`. A Phase-9 frontend change with a P0 requirement hanging off it (FR-LEAD-03 requires `projectSlug` to be validated against known slugs, so the options the visitor sees and the set the server accepts must be the same set). It is in no plan today (CONF-42) — add it as a named Phase-9 deliverable.

---

#### `leads` — COLLECTION · Tier 1

**Why it exists.** FR-LEAD-01..18. `ContactForm.tsx:27-30, 102-122`. PRD §1 problem 2: ***"Every enquiry typed into that form today is lost."*** This is the single feature that genuinely requires a backend.
**Managed by.** Created by the **public** (the only public write); read and updated by admins only.
**Visibility.** **FR-LEAD-15: never exposed on any public endpoint. Ever.**

| Field | Type | Req | Validation / default | Admin | Reason |
|---|---|---|---|---|---|
| `name` | `text` | ✔ | trim, 1–120; reject control characters; reject punctuation/digits-only | — | `ContactForm.tsx:32` |
| `phone` | `text` | ✔ | **stored verbatim, as submitted** | — | A5 §4.5 |
| `phoneNormalised` | `text` | ✔ | `index: true`; `beforeValidate` field hook → E.164 assuming `+91`; ≥8 **(interim)** and ≤15 digits; reject `0000000000` and all-same-digit | readOnly + field access closed | dedupe key. **See §9.6 for the 8-vs-10 conflict** |
| `projectSlug` | `text` | ✖ | absent / `""` / `null`, else must match a known slug → `UNKNOWN_PROJECT`. **Never trusted** | readOnly | `ContactForm.tsx:105` posts the slug |
| `project` | `relationship → projects` | ✖ | resolved server-side from `projectSlug` | readOnly + field access closed | *"store the resolved project id and a name snapshot alongside the slug so historic leads survive a rename"* |
| `projectNameSnapshot` | `text` | ✖ | server-set | readOnly + field access closed | the snapshot half of that rule |
| `message` | `textarea` | ✖ | trim, ≤2000, **strip HTML** in `beforeValidate` | — | stored-XSS defence — the lead is rendered in the admin and in a notification email |
| `source` | `select` | ✔ | `['contact_form','hero_pill','whatsapp','phone']`, `defaultValue: 'contact_form'`, `enumName: 'enum_lead_source'` | readOnly **+ field `access.create/update: () => false`** | **server-assigned, never client-trusted.** ⚠️ `admin.readOnly` is *"without affecting the API"* — readOnly alone is trivially spoofable over REST |
| `sourcePath` | `text` | ✖ | server-derived from `Referer`, validated same-origin and path-only, truncated | readOnly + field access closed | which page converted |
| `isRead` | `checkbox` | ✔ | `defaultValue: false` | sidebar | FR-LEAD-13 is INFERRED/P2 *"no evidence it is wanted"* — **but see §7.4; the dashboard should not depend on it** |
| `notifiedAt` | `date` | ✖ | set by the notification task | readOnly + field access closed | makes `sendLeadNotification` **idempotent** — retries are at-least-once |
| `consentGiven` | `checkbox` | ✔ | `defaultValue: true` | readOnly | the `formNote` promise (`pages.ts:342-343`). **Implicit consent by submission** — §9.8 |
| `ipAddress` | `text` | ✖ | server-set | readOnly, `description: 'Purged after 90 days.'` | anti-spam + FR-LEAD-16 |
| `userAgent` | `text` | ✖ | server-set | readOnly | same |
| `leadStatus` | `select` | — | **DEFER — do not build until OQ-3 answers** | — | ADMIN-CMS-SPEC §5 is blunt: *"If the owner confirms no pipeline, **remove the control entirely** rather than shipping a field nobody maintains. **Do not default to building it.**"* If built: `enumName: 'enum_lead_status'`, values `new · contacted · visit_scheduled · visited · won · lost`, renamed from `status` per P6 |

**`lead_status_history` is explicitly NOT modelled.** The audit's conditional table is answered by two facts: drafts are forbidden on `leads` (P6), so versions are the wrong tool; and the `audit-log` already captures actor, action, entity and timestamp for every status change. Record the reasoning — that is the difference between a decision and an omission (CONF-71).

**Relations.** `project → projects` (a row in `leads_rels`). **Deliberately soft:** `projectSlug` and `projectNameSnapshot` are plain text, so a lead survives its project being renamed or archived. `DATABASE-SCHEMA.md` §9 is explicit that this is *not* an FK.
**Ordering.** `defaultSort: '-createdAt'` — `createdAt` is indexed by default, so newest-first costs nothing.
**Publication.** **`versions: false`** — versioning an operational/PII table multiplies PII copies.
**Archive vs delete.** **Soft only, forever.** `trash: true`; `access.delete: isAdmin` but **the admin UI must never offer hard delete** — *"a lead is a commercial record"* (FR-LEAD-14). `disableBulkDelete: true`. A scheduled `purgeLeadPii` job nulls `ipAddress`/`userAgent` at ~90 days. ⚠️ **The lead record's own retention lifetime is undefined in every source document** and must be decided by the owner before go-live, because DPDP requires it.
**Access.** `create: () => false · read: isAdmin · update: isAdmin · delete: isAdmin`. Public creation goes through the hand-written endpoint calling `payload.create({ overrideAccess: true })` — the one sanctioned use of `overrideAccess: true` in the codebase.
**Public JSON.** `POST` returns `201 { "data": { id, createdAt, message } }` and nothing else. **No public GET representation exists.**

---

#### `site-settings` — GLOBAL ★ the only Tier-1 global · Tier 1

Full treatment, field list and the Tier-2 decision table: **§11**. Summary: exactly one site → a Global by the docs' own test. `versions: { max: 50, drafts: false }` — note the key is **`max`** on globals and **`maxPerDoc`** on collections; writing the wrong one is silently ignored. Drafts off deliberately: a draft/published split on site settings creates a *"why isn't my new phone number live?"* failure mode. Keep the version history for instant rollback of a fat-fingered phone number — which is a site-wide outage of the primary conversion path — without the publish gate.
**Access.** `read: () => true · update: isAdmin · readVersions: isAdmin`. Globals cannot be deleted and have no delete hooks.
⚠️ **How globals are physically stored in Postgres is NOT VERIFIED IN OFFICIAL DOCS** — the only lever is `dbName`.

---

#### `audit-log` — COLLECTION · Tier 1 (storage) / Tier 2 (screen)

**Why it exists.** FR-AUDIT-01..03; `SECURITY.md` §13; Matrix §1 row 14 marks project `approvals` *"Legally sensitive — audit these edits."*

🔴 **Payload's version history does NOT satisfy this, and two project documents say it partly does.** The versions overview *claims* audit value — *"including monitoring for what user made which change"* — but the documented version-document shape is `_id`, `parent`, `autosave`, `version`, `createdAt`, `updatedAt`. **There is no `createdBy`, no user, no IP.** Versions fail FR-AUDIT on five counts: no actor, no IP, no action type, **no auth events at all** (login/logout/lockout/password change produce no version), and **not append-only** (`maxPerDoc` discards old versions and `restoreVersion` mutates). `IMPLEMENTATION-DECISION.md` lines 240 and 331 rate this 🟡 *"Payload's version history covers part of it"* — **that wording is the actual hazard**, because a future session will read it and trust it. Downgrade both lines to: *"🟠 Hooks write **every** entry. Payload versions contribute before/after reconstruction only — not actor, not IP, not action type, not auth events, and not append-only integrity."*

**Managed by.** **System only** — written exclusively by hooks. **Visibility.** Admin-only, read-only, never public.

| Field | Type | Req | Notes |
|---|---|---|---|
| `adminUser` | `relationship → users` | ✖ | nullable: a scheduled or system action has no actor |
| `action` | `select` | ✔ | `enumName: 'enum_audit_action'`. ⚠️ **11 values, not the documented 7**: `create, update, publish, unpublish, delete, restore, login, logout, login_failed, lockout, password_change`. The spec lists 7; `SECURITY.md` §13 additionally requires logout, lockout and password_change; and `POST /admin/projects/{id}/restore` has no value at all. An enum with a missing value means **the audit hook throws on the first logout** |
| `entityType` | `text` | ✔ | `index: true` — the collection slug |
| `entityId` | `text` | ✔ | `index: true` |
| `changes` | `json` | ✖ | before/after for **sensitive fields only** — `approvals`, `area`, `proximity`, anything title-related (FR-AUDIT-02) |
| `ipAddress` | `text` | ✖ | from `req.headers` |

**Access — append-only by construction.**
```ts
access: {
  read:   ({ req: { user } }) => Boolean(user),
  create: () => false, update: () => false, delete: () => false,
}
```
⚠️ `overrideAccess` defaults to **true** in the Local API, so `create: () => false` does not stop *our own* code writing carelessly. It blocks REST, GraphQL and the Admin UI — the threat model that matters — but it is not a hard guarantee.
**`versions: false`, `trash: false`.** `defaultSort: '-createdAt'`.

**Two design rules that follow.** (1) **The audit hooks go on the collections, never on custom endpoints** — the admin UI writes directly and will never call them. (2) Auth events come from Payload's `afterLogin` / `afterLogout` / `afterForgotPassword` collection hooks; **`lockout` must be derived**, because `maxLoginAttempts`/`lockTime` emit no event — the hook must detect the transition.

**The screen is free.** Audit **storage** is P1 and built in Phase 2. The audit **screen** is P2 (FR-AUDIT-03, INFERRED) and is satisfied by Payload's default collection list view on `audit-log` — read-only, admin-only, no custom screen. That keeps the nine-admin-screen count correct and removes a phantom tenth (CONF-88).

### 5.7 The Tier-2 entities

#### `testimonials` — COLLECTION · Tier 2
**Why.** FR-CONT-03/04. `pages.ts:310-332` (3 records), `Testimonials.tsx:28-47`, homepage only.
**Fields.** `name` text req ≤120 · `role` text ≤120 · `body` textarea req ≤2000 · **`consented` checkbox `defaultValue: false`** · `rating` number `min:1 max:5` **optional** · ~~`avatar`~~ **deferred, not modelled** (no render site, no public key, no media role, and it would add an inbound reference the delete guard must then count — CONF-44).
**Ordering** `orderable: true` · **drafts on** · `trash: true` · `readVersions: isAdmin`.
**Public JSON.** `{ id, name, role, rating, body }` — **published AND consented only** (FR-PUB-05).

🔴 **The consent gate is the single most important rule on this entity.** D-011 + FR-CONT-04: `consented` defaults to `false`, and publishing without it fails. ADMIN-CMS-SPEC §8 originally said *"Publish is **disabled** until Consented is ticked"* — a UI control — and its own architecture header overrides that: it **must be a `beforeValidate` hook, not merely a disabled button** (the hook wins). Plus one of only **two** CHECK constraints retained at the DB layer via `afterSchemaInit`. Reason: the three testimonials that exist today are **invented placeholders with bracketed names**, and `pages.ts:10-12` calls publishing them *"a fabricated record."* The easiest possible mistake, once an admin UI exists, is publishing them as-is. **Make it impossible, not discouraged.**

Error shape, decided: keep the nine top-level codes closed and emit consent as a field error —
`422 VALIDATION_ERROR` with `details[0] = { field: 'consented', code: 'CONSENT_REQUIRED', message: 'Publishing reviews that were not given by a real, consenting client is a fabricated record.' }`. This reuses the existing inline-error rendering path. (The alternative — a tenth top-level code — is acceptable but then `API-CONTRACT.md` §2.4 must say "ten". **Owner's call; this is the safe default.**)

⚠️ **`rating` has no render site.** `types/content.ts:25` declares it required; all three records set `5`; `Testimonials.tsx` destructures only `id`, `body`, `name`, `role`. Make it **optional**, keep it in the public shape because the documented contract has it, and add `admin.description: 'Not currently displayed on the website.'`

#### `faqs` — COLLECTION · Tier 2
**Why.** FR-CONT-05. `pages.ts:344-365` (5 items), rendered **twice** — `contact/page.tsx:99` and `app/page.tsx:100`.
**Fields.** `question` text req ≤300 · `answer` textarea req ≤2000. `orderable: true` · drafts on · `trash: true`.
**Public JSON.** `{ id, question, answer }`. `Accordion.tsx:28` uses `key={item.q}` → **questions must be unique**; `Accordion.tsx:18` opens item 0 by default.

#### `statistics` — COLLECTION · Tier 2
**Why.** FR-CONT-06. `pages.ts:66-71` (4 items), rendered on **`/` (PinnedProof) and `/about`**, both `tablet:grid-cols-4` — **exactly 4 or the grid goes ragged**.
**Fields.** `label` text req ≤60 · `value` **text** req ≤60.
🔴 **`value` is text and is authored, not computed** (D-009): real values are `[00]+`, `[000]+`, `[0]`, `Immediate`. *"Do not 'helpfully' derive them from row counts; **'Plots handed over' is not something this database knows.**"* Three of the four are bracketed placeholders rendering in display type on two pages — the highest-visibility placeholder in the build.
`orderable: true` · drafts on · **`trash: true` anyway**: `DATABASE-SCHEMA.md` §13 omits `deleted_at` for statistics while the uniform content CRUD block gives it a `DELETE` (CONF-39). Be consistent.

#### `documents` — COLLECTION (upload) · Tier 2
**Why.** FR-MEDIA-10. `pages.ts:254` `masterPlan.downloadHref = '[MASTER_PLAN_PDF_URL]'`, consumed at `master-plan/page.tsx:29` → `Lightbox.tsx:98-109`. **This resolves A2 contradiction C-7** — the site-scoped `document` role that has no table, no column and no endpoint anywhere in the documented schema.
**A separate collection, not a second role on `media`,** because a single upload collection cannot express two `mimeTypes` allow-lists and the validation genuinely differs: images ≤10 MB / jpeg-png-webp-avif with `crop` + `focalPoint` + `imageSizes`; PDFs ≤25 MB / `application/pdf` with `crop: false`, `focalPoint: false`, **no `imageSizes`**, and a static `adminThumbnail` function (sharp cannot thumbnail a PDF).
**Fields.** `title` text req · `originalFilename` text readOnly + field access closed. The same UUID-rename and magic-byte hooks, sniffing for `%PDF-`.
⚠️ **OQ-18 must close before the storage plugin is configured.** Public brochures → `disablePayloadAccessControl: true`, CDN-served. Lead-gated brochures → leave access control on, optionally `signedDownloads`. **These are mutually exclusive settings on the same collection.**

#### `site-settings.heroTicker` — an array field, not an entity · Tier 2
FR-CONT-07; `pages.ts:59-65`; `Hero.tsx:82-85`. `CONTENT-MANAGEMENT-MATRIX.md` names a `ticker_items` table; the docs' own test points the other way — five rows, one consumer, no independent publish state, no per-item lifecycle, never queried alone. A collection would buy an admin list screen nobody needs and a table nobody joins. **This removes one documented table.**
⚠️ `Hero.tsx:83` writes `item.icon as IconName` — a **type assertion**, because `ticker` is an untyped `as const` literal. It is the only icon-bearing list in the codebase that is not compile-time validated, and once the data is fetched that cast becomes a lie TypeScript will no longer catch. **The DB enum is what actually protects it.**

### 5.8 Entities recommended for DROP or DEFERRAL — with the evidence

| Candidate | Where documented | Evidence found | Verdict |
|---|---|---|---|
| **`project_media` join collection** | `DATABASE-SCHEMA.md` §8; 3 admin endpoints | every requirement met better by named upload fields (§5.4) | **DROP** |
| **`admin_sessions`** | `DATABASE-SCHEMA.md` §2; `ARCHITECTURE.md` §6; D-004 | Payload uses **httpOnly JWT cookies, not session rows**; with `useSessions` it adds a `sessions` **field on the user document** whose shape is undocumented | **DROP the table. Amend D-004** (§10.7) |
| **`notification_jobs`** | `DATABASE-SCHEMA.md` §15 | **Payload's Jobs Queue already is this** — `payload-jobs`, retries, cron, `waitUntil`, `autoRun` | **DROP; adopt `payload-jobs`.** Hard dependency: with no runner, jobs *"will never be executed"* and the UI gives no warning |
| **`Project.brochureImages`** | `types/content.ts:98`; Matrix row 23 (T1); FR-MEDIA-05 | **zero render sites** in the entire codebase; 0/5 populated | **DEFER.** Add the field the day `ProjectDetail` gains a render slot. Label it *"stored, not rendered"* so an admin who uploads five brochure scans is told nothing will change on the site |
| **`Testimonial.rating`** | `types/content.ts:25` | populated `5` on all three; **never rendered** | **Make optional**, keep in the public shape for type compatibility |
| **`testimonials.avatar_media_id`** | `DATABASE-SCHEMA.md` §11 | no render site, no public key, no media role, **no traceability row** | **DEFER, not modelled in Tier 1** (owner ruling to delete outright) |
| **`ticker_items` as a collection** | Matrix §3 row 2 | 5 rows, 1 consumer, no lifecycle | **DROP the collection.** Array on `site-settings` |
| **`site_features`** (7 site-wide specs) | Matrix §3 row 11; FR-CONT-08 (INFERRED/P2) | renders at `amenities/page.tsx:29` **and** feeds homepage MediaSequence titles — but `/amenities` is a **footer-only legacy page** and `amenities.hero.lead` hardcodes *"Seven"* against the array length | **DEFER.** Decide whether `/amenities`, `/master-plan`, `/location` are **retired** before investing in modelling them |
| **`site_proximity`** (11) | Matrix §3 row 15; FR-CONT-09 | **all 11 `place` values are bracketed placeholders**, and `Corridor.tsx:26` hard-slices to 8 — items 9–11 render **nowhere** | **DEFER / retire** with the page. If built: the help text must say *"the first eight items appear on the homepage; items beyond the eighth are stored but not displayed"* |
| **`steps`** (5) | Matrix §3 row 6 (FUTURE/T2) | live at `app/page.tsx:96`, but classed FUTURE and `app/page.tsx:92` hardcodes *"Five steps"* | **DEFER.** If built: array-in-global |
| **`page_content`** (about story, values, approvals) | Matrix §3 rows 8–10 (FUTURE/T2) | live but classed FUTURE; `about.approvals.items` are legally sensitive and all bracketed | **DEFER** |
| **`home.benefits`** (6) | Matrix §3 row 7 | **completely unreferenced — zero consumers** | **DROP. Do not migrate** |
| **`home.hero.lead` / `primaryCta` / `secondaryCta`** | `pages.ts:54-56` | `Hero.tsx:28` destructures only `{eyebrow,title,titleAccent,ticker}`; the hero renders `EnquiryPill` instead of buttons | **DROP** |
| **`location.intro.title` / `.lead`** | `pages.ts:280-281` | unreferenced; `Corridor.tsx:23` renders `location.hero.lead` instead | **DROP** |
| **`media.hero` / `media.heroPortrait`** | `pages.ts:18-24` | unreferenced **and the files do not exist on disk**; `heroPortrait` is a bare string, not an `ImageRef` | **DROP. Do not migrate.** The asset migration must **fail loudly on a missing source file** rather than create a `media` row whose `src` 404s — a silent dead row is how these two survived |
| **`Service` entity** | the brief mentions "services" | the frontend has none — only infrastructure *specifications* and *benefits* | **DO NOT BUILD.** D-013 / OQ-13 |
| **`Article` / blog** | `README.md:34`, `PRD-redesign.md:61` | `src/app/blog/` and `src/content/blog.ts` **do not exist**; the route 404s | **DO NOT BUILD.** D-013 / OQ-14 |
| **`roles` / `permissions`** | — | single role; the `role` column covers OQ-4 without a join table | **DO NOT BUILD** |
| **`categories`** | — | fixed 4-value enum, not user-extensible | **DO NOT BUILD** |
| **`lead_status_history`** | A6 §12 conditional | the audit log already covers status changes; drafts are forbidden on leads | **DO NOT BUILD — and record why** |
| **Public users / customers / orders / plots / prices / bookings** | — | zero frontend evidence | **DO NOT BUILD.** D-002 forbids |

### 5.9 `title` / `titleAccent` stays in frontend code — D-010, confirmed and strengthened

**It is not a CMS field, and the evidence is stronger than D-010 itself claims.** D-010 says ~17 headings are hardcoded JSX and must stay code, and that any heading which *ever* becomes editable keeps the two-field split because *"the `<em>` in a display heading is **structural** — the headline's second line"*, styled as such in `globals.css`.

A4 §5.9 proves the situation is already worse than D-010 describes:
- `pages.ts` declares **12** heading `title` values. **Only 3 are actually rendered from content** — `home.hero.title`+`titleAccent`, `home.intro.title`+`titleAccent`, and `amenities.maintenance.title`.
- The other **9 are dead string literals shadowed by hardcoded JSX**, and **4 of them render completely different text** than the content string says. `contact.hero.title` says `"Book a site visit"`; the page renders `"Book a site visit."` + `"We will meet you at the gate."`
- A further **~20 headings exist only in JSX with no content counterpart at all.**

**The consequence is a scoping fact, not a preference:** migrating `pages.ts` verbatim into a CMS global would produce an editor UI whose fields **visibly do nothing** — the single worst thing a CMS can teach its users.

1. **No `pages` / `page_content` collection or global for headings.** Not at Tier 1, not at Tier 2.
2. **No `richText` field anywhere in this model.** *"There is no `body`-rich-text anywhere. Every long-form field is `readonly string[]` or a plain `string`. Nothing in the content layer is HTML, Markdown or Lexical. A CMS rich-text field would be a *new* capability, not a migration."* D-010's security side-benefit is real: no rich-text field means no stored-XSS surface, and Payload's Lexical editor is one config line away — which is exactly why the rule is written down. If the blog ever returns (OQ-14), this decision must be reopened **deliberately, not by reflex**.
3. **If OQ-11 ever resolves "yes" for the homepage hero** — the one heading pair that genuinely is live from content — it becomes **two adjacent `text` fields** on a global, named `heroTitle` and `heroTitleAccent`, with an `admin.description` explaining that the accent is the headline's second line. **Never one field. Never a `richText`. Never a WYSIWYG.**
4. **Section anchor ids** (`#why`, `#how`, `#faq`, `#highlights`, `#approvals`, `#amenities`, `#surroundings`) are hardcoded in JSX and are likewise not CMS data.

### 5.10 Cross-cutting rules this model imposes

1. **`toPublicProject()` is the single control point for D-008 + P3.** No public route calls `payload.find` directly; everything goes through `publicFind()` and one serialiser, contract-tested against `types/content.ts`.
2. **Every public query pins `depth` explicitly.** Too shallow and an upload field returns a bare id string and the serialiser silently emits a broken image; too deep and the join fan-out returns the object graph. Pair with `defaultPopulate` on `media`.
3. **Strip on the way out, always:** Payload's `{docs, totalDocs, …}` envelope, `id`, `_status`, `publishedAt`, `deletedAt`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, the fractional order key, `hasPlaceholders`, and **every array-row `id`**.
4. **Every access function is written explicitly on every collection and global — including `readVersions`.** Payload's default is *"checks if a user is present"*, i.e. **allow-any-authenticated**, the opposite of *"deny-by-default access control on every collection."* `readVersions` is a seventh, non-obvious function, and version records contain **every historical value of legally-sensitive approval fields**; `GET /api/{collection}/versions` exists on the generated REST surface.
5. **`admin.readOnly` is never used alone for a server-assigned field.** It is *"without affecting the API"*. Pair it with field-level `access: { create: () => false, update: () => false }`, every time. Same for the slug lock: **a UI lock is not a lock.**
6. **Payload's generated REST and GraphQL surface must be disabled or locked down** — §6.5.
7. **Bracketed placeholders round-trip verbatim.** A value matching `^\[.*\]$` bypasses *format* validation, still obeys length limits, and is **never** "helpfully" cleaned. The serialiser emits it unchanged — strip the brackets from `[EMAIL@DOMAIN]` and `lib/href.ts` stops rendering it inert, so **a live-looking dead link ships**, which is the exact failure the frontend was built to prevent. Surface `hasPlaceholders` on the **admin** side only.
8. **Set `enumName` and `dbName` explicitly everywhere.** Auto-derivation is undocumented, and deeply nested paths risk Postgres' 63-byte identifier limit with silent truncation collisions.
9. **Run `npm run payload -- generate:db-schema` and read it before writing migration 001.** It is the empirical substitute for every `NOT VERIFIED IN OFFICIAL DOCS` in B02/B06/B07/B08.
10. **`idType: 'uuid'` is decided before migration 001.** Adapter-global and effectively irreversible — changing it later is a type change across every PK and FK in ~50 child tables. **ULID is not supported**; remove "UUID/ULID" from `DATABASE-SCHEMA.md` §3.1.
11. **Do not enable `localization`.** Enabling it after data exists puts every localized field in a separate `_locales` table per collection — a physical schema change across a model that already produces ~18 tables for `projects` alone. Record the deferral **as a decision with its cost**, so its absence is never read as "nobody thought about it". Note the distinction no document draws: this is **content localization** (schema-affecting, deferred) and is **not** admin-panel `i18n`, which is free, reversible, and worth narrowing to `{ en }` for bundle size.
12. **React keys are content strings.** `key={paragraph}`, `key={item.title}`, `key={item.place}`, `key={stat.label}`, `key={image.src}`, `key={item.q}`, `key={tile.src}`. A duplicate does not error — React logs to a console nobody is watching on a prerendered page and reconciles unstably. Add a **uniqueness validator with `details[].code = 'DUPLICATE'` to every repeatable list that supplies a key**: `title` within each of the four feature arrays, `label` within `stats`, `place` within `proximity`, `question` within `faqs`, `text` within `heroTicker`, `src` within `gallery`, and each line of `address`.
13. **Cardinality: three classes, not one rule.** (a) **Hard validation** — `stats` on a project: exactly 4 or 0 (the grid is a fixed 4 columns and the thin record proves 0 must stay legal). (b) **Soft admin warning, never a rejection** — `featured` ≠ 3, fewer than 4 published projects, testimonials ≠ 3: these degrade a layout, they do not break it, and blocking a publish over a ragged grid is worse than the grid. (c) **A documented ordering contract** — `approvals[0]` feeds the meta description.

---

## 6. Public API

### 6.1 URL layout — decided before the first endpoint is written

This is an irreversible decision and it is currently **unrecorded anywhere in the corpus** (CONF-69). `API-CONTRACT.md` §2.1 specifies base path `/api/v1`. Payload mounts its generated REST surface at `{routes.api}/{collection-slug}` and **six of our documented public paths are collection slugs**: `projects`, `testimonials`, `faqs`, `statistics`, `leads`, `media`. Leaving `routes.api` at its default `/api` puts Payload's raw document shape one segment away from our contract at `/api/projects` and `/api/leads`; setting `routes.api = '/api/v1'` makes the generated route **the same URL** as ours.

```ts
// src/payload.config.ts
routes: {
  admin: '/admin',                                    // the Admin Panel UI stays where editors expect it
  api: '/payload-api',                                // Payload's generated REST + config endpoints move here
  graphQL: '/payload-api/graphql',                    // present but disabled at the root
  graphQLPlayground: '/payload-api/graphql-playground',
},
```

| Surface | Path | Mechanism | Auth |
|---|---|---|---|
| Public contract | `/api/v1/**` | **Next.js Route Handlers** under `src/app/(public)/api/v1/` calling the Local API | none |
| Health / liveness | `/healthz`, `/livez` | Next.js Route Handlers at the app root | none |
| Admin Panel UI | `/admin` | Payload-generated | session cookie |
| Payload's own REST | `/payload-api/**` | Payload-generated | access control + an edge path block |
| GraphQL | — | **disabled** (`graphQL: { disable: true }`) | — |

Two documented facts force this shape. *"Custom endpoints defined in your Payload Config are **always** mounted under your configured `routes.api` path (default: `/api`). To define a route that is not prefixed by this path, add a Next.js Route Handler at the desired location in your app directory."* And *"Moving `routes.api` also moves every config-level `endpoints` entry"* — they travel together. ⚠️ **B05's claimed `root: true` endpoint property does not exist in the v3 docs** (verified absent); do not design around it.

**`src/endpoints/` stays empty by decision.** Both mechanisms work; **mixing them is the failure mode** — inconsistent error shapes, inconsistent auth behaviour, two places to remember `headersWithCors`. The cost of Route Handlers is that they receive a plain `Request`, not a `PayloadRequest` — no `req.user`, no `req.routeParams`, no transaction-carrying `req`. That cost is nil here: six unauthenticated reads plus one unauthenticated write that opens its own transaction.

`ARCHITECTURE.md` §1 must be corrected to: *"There is no `/admin` path-prefix guard. `/admin` is the Payload Admin Panel. Authorization lives in collection access-control functions; the public surface is a separate set of hand-written Route Handlers that never receive an admin identity."*

### 6.2 The endpoint inventory

**Denominators, stated so the exit criteria are falsifiable** (the corpus says 6, 7 and 8 in three places — CONF-64): the public surface is **8 routes** = **6 read content endpoints** + `POST /api/v1/leads` + `/healthz`. `GET /projects/{slug}` ships in Phase 1; Phase 6 ships the remaining 7.

| # | Method | Path | Auth | Params | Cache | Rate limit (edge) | Serialiser |
|---|---|---|---|---|---|---|---|
| 1 | `GET` | `/api/v1/projects` | none | `category?` (one of 4) · `featured?` (bool). **No pagination, search or sort** — 5 records, filtered client-side (FR-PUB-12) | `public, max-age=60, stale-while-revalidate=600` + `ETag` | per-IP ceiling **with a build-origin exemption** | `toPublicProjectCard` |
| 2 | `GET` | `/api/v1/projects/{slug}` | none | path `slug` | same | same | `toPublicProject` |
| 3 | `GET` | `/api/v1/site-settings` | none | none | same | same | `toPublicSiteSettings` |
| 4 | `GET` | `/api/v1/testimonials` | none | none | same | same | `toPublicTestimonial` — published **AND** consented only |
| 5 | `GET` | `/api/v1/faqs` | none | none | same | same | `toPublicFaq` |
| 6 | `GET` | `/api/v1/statistics` | none | none | same | same | `toPublicStatistic` |
| 7 | `POST` | `/api/v1/leads` | none | JSON body | **`no-store`** | **5/min/IP and 3/hour/phone** | §9 |
| 8 | `GET` | `/healthz` | none | none | `no-store`, `export const dynamic = 'force-dynamic'` | generous | — |
| 8b | `GET` | `/livez` | none | none | `no-store` | generous | — |

⚠️ **The build-origin exemption is not optional.** Under D-012's ISR model **all public GETs originate from one build machine**, so a naive per-IP ceiling throttles a full site rebuild. The build egress IP must be exempted, and the Phase-10 test is that a full `next build` of `svfrontend` completes without a single `429`.

⚠️ **`/healthz` cannot be a Payload `endpoints` entry** — config endpoints are always under `routes.api`. It is a plain Route Handler at `src/app/healthz/route.ts`, and `export const dynamic = 'force-dynamic'` is mandatory or Next may statically generate it. The `"db":"ok"` half needs a real round-trip: `payload.db.drizzle` with `sql` imported from `@payloadcms/db-postgres/drizzle`, kept trivial — **every probe consumes a pool connection.** `/livez` is DB-free. Payload ships **no** health check and **no** backup/restore guidance: 100 % of both is ours. The body contains `{"status":"ok","db":"ok"}` and **nothing else** — no version, no hostname, no database name.

### 6.3 Exact response JSON

**`GET /api/v1/projects`** — card fields only. The list payload feeds the catalogue, the homepage strip, the nav/footer project links (FR-CONT-11), the sitemap and **`ContactForm`'s `<select>`**, which renders `` `${project.name} — ${project.locality}` `` — which is why `locality` is in the card shape and is not an accident to be optimised away.

```jsonc
{ "data": [
  {
    "slug": "sri-city-aler-town",
    "name": "Sri City Aler Town",
    "category": "Premium Villa Plots",
    "locality": "Aler, Warangal Highway",
    "tagline": "Premium villa plots on the Warangal highway",
    "summary": "A DTCP and RERA approved villa plot layout on the Warangal highway.",
    "featured": true,
    "image": {
      "src": "https://media.svdevelopers.example/media/9f3c1e0a-4b7d-4d2e-8f11-8a2c0d31cc41.jpg",
      "alt": "Sri City Aler Town — premium villa plots on the Warangal highway",
      "width": 1200, "height": 800
    }
  }
] }
```
Note what is **not** there: no `"status": null`, no `"developer": null`, no `id`, no `_status`, no timestamps, no `meta` (this route has no pagination).

**`GET /api/v1/projects/{slug}`** — the fattest realistic record, every optional key populated:

```jsonc
{ "data": {
  "slug": "sri-nivasam-swarnagiri",
  "name": "Sri Nivasam Swarnagiri",
  "category": "Premium Villa Plots",
  "status": "Open for booking",
  "locality": "Bhongir",
  "developer": "Sri Virinchi Infra Developers Pvt. Ltd.",
  "tagline": "Approved villa plots beside the Swarnagiri hill",
  "summary": "A gated villa-plot layout with finished internal roads and avenue plantation.",
  "description": [
    "Sri Nivasam Swarnagiri is a DTCP and RERA approved villa plot layout at Bhongir.",
    "Internal roads, drainage and street lighting are complete and walkable today."
  ],
  "stats": [
    { "label": "Total area",  "value": "6 Acres 22.50 Guntas" },
    { "label": "Approvals",   "value": "DTCP & RERA" },
    { "label": "Roads",       "value": "30 feet BT" },
    { "label": "Handed over", "value": "100%" }
  ],
  "highlights": [
    { "icon": "city",   "title": "Premium residential villa plots" },
    { "icon": "road",   "title": "30 feet BT internal roads" },
    { "icon": "droplet","title": "Underground drainage" },
    { "icon": "lamp",   "title": "Street lighting throughout" }
  ],
  "amenities": [
    { "icon": "tree",  "title": "Avenue plantation" },
    { "icon": "fence", "title": "Compound wall" }
  ],
  "approvals": [
    { "icon": "shield", "title": "DTCP & RERA approved layout" }
  ],
  "locationHighlights": [
    { "icon": "temple", "title": "Yadagirigutta" },
    { "icon": "train",  "title": "Bhongir railway station" }
  ],
  "proximity": [
    { "icon": "plane", "measure": "55 min", "place": "Rajiv Gandhi International Airport" }
  ],
  "area": "6 Acres 22.50 Guntas",
  "roadDetails": "30 feet BT roads",
  "image":       { "src": "https://media…/9f3c….jpg", "alt": "…", "width": 1200, "height": 800 },
  "gallery": [   { "src": "https://media…/a12b….jpg", "alt": "…", "width": 1600, "height": 1067 } ],
  "layoutImage": { "src": "https://media…/c44d….png", "alt": "Master layout plan", "width": 2400, "height": 1700 },
  "locationMap": { "src": "https://media…/e90f….png", "alt": "Location map", "width": 1600, "height": 1200 },
  "cta": { "title": "Come and walk the layout", "description": "We will meet you at the gate any day of the week." },
  "seo": { "title": "Sri Nivasam Swarnagiri — villa plots at Bhongir", "description": "DTCP & RERA approved villa plots at Bhongir." },
  "featured": true
} }
```

**The thin record — `siri-vanam-gummadavelli`, the acceptance test for the whole architecture.** It populates only the 8 required fields plus `tagline`, and its detail page must render with `stats`, `approvals`, `amenities`, `locationHighlights`, `proximity`, `layoutImage`, `locationMap` and `gallery` **entirely absent — not empty**:

```jsonc
{ "data": {
  "slug": "siri-vanam-gummadavelli",
  "name": "Siri Vanam Gummadavelli",
  "category": "Farm Villa Plots",
  "locality": "Gummadavelli",
  "tagline": "Farm villa plots near Gummadavelli",
  "summary": "A farm villa plot layout with completed internal roads.",
  "description": ["Siri Vanam Gummadavelli is a farm villa plot layout near Gummadavelli."],
  "highlights": [ { "icon": "tree", "title": "Farm villa plots" } ],
  "image": { "src": "https://media…/7b21….jpg", "alt": "Siri Vanam Gummadavelli", "width": 1200, "height": 800 },
  "featured": false
} }
```

**Phase-1 exit criterion #3 restated so it is falsifiable** (CONF-53): *"`GET /api/v1/projects/siri-vanam-gummadavelli` returns **exactly** the key set `{slug, name, category, locality, tagline, summary, description, highlights, image, featured}` — no `status`, no `developer`, no `stats`, no `approvals`, no `amenities`, no `locationHighlights`, no `proximity`, no `area`, no `roadDetails`, no `gallery`, no `layoutImage`, no `locationMap`, no `cta`, no `seo`, and none of `id`, `_status`, `publishedAt`, `deletedAt`, `createdAt`, `updatedAt`."* Plus the mirror assertion on the fattest record, and two structural ones: **every array row carries no `id`**, and **every `ImageRef` carries exactly `{src, alt, width, height}`**.

**`GET /api/v1/site-settings`** — note `copyrightText` is **computed, not stored** (§11.2):

```jsonc
{ "data": {
  "name": "SV Developers",
  "legalName": "SV Developers",
  "tagline": "Approved residential plots",
  "description": "DTCP and RERA approved plot layouts on the Warangal highway corridor.",
  "url": "https://www.svdevelopers.example",
  "email": "[EMAIL@DOMAIN]",
  "phone": "[PHONE NUMBER]",
  "whatsapp": "[910000000000]",
  "address": ["[ADDRESS LINE 1]", "[ADDRESS LINE 2]", "[CITY, PIN]"],
  "mapUrl": "[GOOGLE MAPS URL]",
  "officeHours": "Site visits seven days a week, 9am – 7pm",
  "social":     [ { "label": "Facebook", "href": "[FACEBOOK URL]", "icon": "facebook" } ],
  "legalLinks": [ { "label": "Privacy policy", "href": "[LINK TO PRIVACY POLICY]" } ],
  "copyrightText": "© 2026 SV Developers. All rights reserved.",
  "formNote": "We will only use your number to talk to you about this project. [LINK TO PRIVACY POLICY]",
  "cta": { "title": "Come and walk the layout", "body": "We will meet you at the gate." },
  "logo": { "src": "https://media…/1d0e….png", "alt": "", "width": 160, "height": 160 }
} }
```
**The bracketed values above are the point, not a mistake.** Placeholder fidelity is a contract rule: *"Any stored value matching `^\[.*\]$` is emitted verbatim. The serialiser never trims brackets, never substitutes a default, and never omits a field because its value is a placeholder."* Strip them and `lib/href.ts` stops rendering the link inert; null them and `EnquiryPill`'s `whatsappReady` test flips, changing hero behaviour. Contract tests assert a bracketed `email`, `whatsapp`, `mapUrl` and master-plan `downloadHref` survive a full round trip. **Two deliberate exceptions:** `url` is *not* bracketed and must validate as a real URL (§11.2), and `copyrightText` is computed so its embedded `[YEAR]` disappears by construction.

**`GET /api/v1/testimonials`** → `{ "data": [ { "id", "name", "role", "rating", "body" } ] }` — published **and** consented only; **no avatar**.
**`GET /api/v1/faqs`** → `{ "data": [ { "id", "question", "answer" } ] }` — ordered, published.
**`GET /api/v1/statistics`** → `{ "data": [ { "id", "label", "value" } ] }` — ordered, published, `value` is **text**.

### 6.4 Status codes, error envelope, and the serialiser contract

**Conventions.** Base path `/api/v1`, JSON in/out, **UTF-8**, **`camelCase` throughout**, timestamps **ISO-8601 UTC**. `/api/v1` is frozen once the frontend consumes it; breaking changes go to `/api/v2`.

**Status codes:** `200` · `201` · `204` · `400` malformed body or a decoding failure · `401` unauthenticated · `403` authenticated but not permitted · **`404` not found, also used to hide unpublished and archived content** · `409` conflict · `422` validation failed · `429` rate limited (**always with `Retry-After`**) · `500` internal (opaque message, `requestId` logged). **`404`, never `403`, for unpublished content — a `403` confirms it exists.**

**Error envelope — reproduce verbatim:**
```jsonc
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "requestId": "req_01JBX…",
    "details": [
      { "field": "phone", "code": "TOO_SHORT", "message": "That number looks incomplete." }
    ]
  }
}
```
**`details[].field` must exactly match the frontend input `name`** — `name`, `phone`, `project`, `message` — so `ContactForm`'s existing `Errors` map renders server errors in the same inline slots **with no redesign**. (Note the asymmetry: the request body key is `projectSlug`, the error field is `project`.)

> ⚠️ **The `message` text above is illustrative, and deliberately matches the frontend's current copy** (`ContactForm.tsx:34` — *"That number looks incomplete."*) rather than `API-CONTRACT.md`'s *"Enter a 10-digit mobile number."* **Do not hard-code a "10-digit" message while `MIN_PHONE_DIGITS` is 8** — it would tell the visitor a rule the server is not enforcing. The message becomes 10-digit wording only in the same release that raises the constant, per §9.6 and OQ-19.

**Top-level codes — exactly nine, closed:** `VALIDATION_ERROR` · `UNAUTHENTICATED` · `FORBIDDEN` · `NOT_FOUND` · `CONFLICT` · `RATE_LIMITED` · `PAYLOAD_TOO_LARGE` · `UNSUPPORTED_MEDIA_TYPE` · `INTERNAL_ERROR`.
**Field codes — twelve:** `REQUIRED` · `TOO_SHORT` · `TOO_LONG` · `INVALID` · `INVALID_TYPE` · `INVALID_FORMAT` · `INVALID_ENUM` · `DUPLICATE` · `SLUG_LOCKED` · `UNKNOWN_PROJECT` · `EMPTY_ITEM` · `INCOMPLETE_PAIR`. `CONSENT_REQUIRED` joins this list as a field code (§5.7).

**A mandatory `try/catch` in every public handler** maps internal errors onto this envelope with a `requestId`. **`afterError` is not documented to fire for Local API calls** and cannot be relied on to reshape responses. Payload's own `APIError` (imported from `'payload'`, **not** `'payload/errors'` — that is the v2 path) has a different body shape and must be translated by the same handler. Never pass `error.message` through; `debug: false` in production.

**`requestId` and resource ids are different generators.** `requestId` is ours (`req_` + ULID) and may stay a ULID; resource ids are Postgres UUIDs. Nothing in the frontend parses an id — projects are addressed by **`slug`**, and `types/content.ts` has no `id` on `Project` at all.

**`Content-Type` and UTF-8, restored to the contract** (CONF-76): `POST /api/v1/leads` accepts `Content-Type: application/json` only (an optional `; charset=utf-8` is fine); anything else is **`415 UNSUPPORTED_MEDIA_TYPE`**. The body is parsed as UTF-8; a decoding failure is **`400`**, not `422`. These are different codes for different failures and the contract must say so once, or whoever writes the handler will use them interchangeably. A Route Handler receives a bare Web `Request` and performs **no** content-type negotiation of its own.

**Unknown properties** are rejected with `422`, **except** a closed carve-out list: the five system fields (`id`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`) are silently dropped; the **named** honeypot field is accepted and discarded; and `source` is accepted and overwritten server-side. Any other unknown key is an error. This rule governs **our hand-written endpoints only** — Payload's generated REST surface has its own behaviour, which is another reason §6.5 matters.

### 6.5 `toPublicProject()` — the exact contract

**Payload provides ZERO tooling for omit-don't-empty.** This is verified and it is the finding that most strongly validates D-015:

| Payload feature | What it does | Omits null/empty keys? |
|---|---|---|
| `select` (include mode) | restricts which fields are **queried from the DB** | **No.** *"A selected-but-empty field still returns as `null`."* |
| `defaultPopulate` / `populate` | restricts fields on populated relationships | No |
| `forceSelect` | forces fields to always be selected | No — the opposite |
| field `hidden` | Admin Panel input type only | **No** — explicitly not an API concern |
| field `access.read` | removes a field when denied | user-driven, not emptiness-driven |
| `afterRead` hook | can mutate the doc | runs for **all** consumers incl. the Admin Panel, and may receive a partial doc under `select`. **Wrong layer** |
| `id` | always present | **Cannot be excluded, ever** |

**The rule — D-008 extended by P3:** *"The serialiser omits every absent optional field — scalar, array, object alike. The only optional field that is always emitted is `featured`, because `false` is assignable to `boolean | undefined`."*

**The TypeScript technique that omits rather than nulls a key.** The primitive is a single `put()` helper with **one documented emptiness rule**, and the serialiser is built **key by key**:

```ts
// src/serializers/put.ts — ONE emptiness rule, written down once.
//  undefined → omit · null → omit · '' (after trim) → omit · [] → omit
//  0 is KEPT.  false is KEPT.  A bracketed placeholder string is KEPT verbatim.
export const put = <T>(target: Record<string, unknown>, key: string, value: T | null | undefined): void => {
  if (value === null || value === undefined) return
  if (typeof value === 'string' && value.trim() === '') return
  if (Array.isArray(value) && value.length === 0) return
  target[key] = value
}
```

```ts
// src/serializers/toPublicProject.ts
import type { Project } from '@/payload-types'
import type { Project as PublicProject } from '@/types/frontend-contract'   // the VENDORED contract
import { put } from './put'
import { toImageRef } from './toImageRef'
import { ICON_NAMES } from '@/lib/icons'

const icon = (v: unknown) => (typeof v === 'string' && (ICON_NAMES as readonly string[]).includes(v) ? v : 'check')
const feature = (r: { icon: string; title: string; body?: string | null }) => {
  const o: Record<string, unknown> = { icon: icon(r.icon), title: r.title }
  put(o, 'body', r.body)                       // array-row `id` is never copied — it is not read
  return o
}

export const toPublicProject = (doc: Project): PublicProject => {
  const out: Record<string, unknown> = {}
  // ALWAYS PRESENT
  out.slug        = doc.slug
  out.name        = doc.name
  out.category    = doc.category
  out.locality    = doc.locality
  out.summary     = doc.summary
  out.description = doc.description               // string[] — identity pass-through (§5.1)
  out.highlights  = (doc.highlights ?? []).map(feature)
  out.image       = toImageRef(doc.image)         // throws if unpopulated — see the depth note
  out.featured    = Boolean(doc.featured)         // the ONE optional always emitted (P3)
  // OMITTED WHEN ABSENT — scalars included (P3 corrects API-CONTRACT.md)
  put(out, 'status',             doc.projectStatus)   // ← P6 rename mapped back to the contract key
  put(out, 'developer',          doc.developer)
  put(out, 'tagline',            doc.tagline)
  put(out, 'area',               doc.area)
  put(out, 'roadDetails',        doc.roadDetails)
  put(out, 'stats',              doc.stats?.map((s) => ({ label: s.label, value: s.value })))
  put(out, 'amenities',          doc.amenities?.map(feature))
  put(out, 'approvals',          doc.approvals?.map(feature))
  put(out, 'locationHighlights', doc.locationHighlights?.map(feature))
  put(out, 'proximity',          doc.proximity?.map((p) => ({ icon: icon(p.icon), measure: p.measure, place: p.place })))
  put(out, 'gallery',            doc.gallery?.map(toImageRef))
  put(out, 'layoutImage',        doc.layoutImage ? toImageRef(doc.layoutImage) : undefined)
  put(out, 'locationMap',        doc.locationMap ? toImageRef(doc.locationMap) : undefined)
  put(out, 'cta',                doc.cta?.title && doc.cta?.description
                                   ? { title: doc.cta.title, description: doc.cta.description } : undefined)
  put(out, 'seo',                seoOrUndefined(doc.seo))
  return out as unknown as PublicProject
}
```

Five rules that make this hold, and they are enforced mechanically, not by memory:

1. **`...doc` spread is BANNED** anywhere under `src/serializers/`. A review rule plus the key-set snapshot suite.
2. **The exhaustive strip-list** — `id`, `_status`, `publishedAt`, `deletedAt`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, the fractional order key, **every array-row `id`**, `hasPlaceholders`, and Payload's `{docs, totalDocs, …}` envelope. `hasPlaceholders` is an **admin-surface-only** derived value and must never be emitted publicly.
3. **`toImageRef()` emits exactly four keys** — `{ src, alt, width, height }` — with `alt: doc.isDecorative ? '' : doc.alt`. ⚠️ **If `depth` is too shallow an upload field returns a bare id string** and the serialiser silently emits a broken image. Pin `depth: 1` explicitly on every public query, and set `defaultPopulate` on `media`. Also: when selecting `url` on an upload collection, *"it is important to specify `filename: true` as well"* — otherwise Payload returns `url: null`.
4. **Include-mode `select` only, never exclude mode.** Exclude mode is a deny-list and silently leaks every future field someone adds.
5. **Final cast to the vendored `Project` type.** `src/types/frontend-contract.ts` is a byte-identical copy of `svfrontend/src/types/content.ts`, CI-diffed by `src/scripts/checkContractDrift.ts`. Payload has **no built-in cross-app type sharing** — if the contract drifts, the build fails in *this* repo instead of the other one. And because `ProjectCatalogue.tsx` receives `Project` objects across the RSC boundary, serialiser output must be JSON-serialisable: **no `Date` objects, no class instances.**

**The `API-CONTRACT.md` defect, called out and resolved.** `API-CONTRACT.md` §2.5.1 and §2.5.2 both show, verbatim, `"status": null,` and `"developer": null,`, and its own omit-rule box undercuts itself with the parenthetical *"(**or `null` for scalars**)"*. That is wrong and it is the version a future implementer will copy. `types/content.ts:63` declares `status?: ProjectStatus` and `:68` declares `developer?: string`; `svfrontend/tsconfig.json` runs `strict: true`; **`null` is not assignable to `ProjectStatus | undefined` under `strictNullChecks`.** If the frontend types an API response as `Project` — which NFR-12 requires — every `null` scalar is a **compile error in the other repository**, and fixing it means editing `types/content.ts`, which is forbidden outside Phase 9. `BACKEND-ROADMAP.md` Phase 1 exit criterion #3 already states the correct rule. **Corrections:** delete the parenthetical; re-render both examples **without** the `status` and `developer` keys — which is also factually right, since `status` is populated on 0/5 projects and `developer` on 1/5; and add the exact-key-set contract test.

**`publicFind()` — the only permitted way a public handler reads content:**

```ts
// src/lib/publicFind.ts
import { getPayload, type CollectionSlug, type Where } from 'payload'
import config from '@payload-config'

export const publishedWhere = (): Where => ({ _status: { equals: 'published' } })

export async function publicFind<T extends CollectionSlug>(args: {
  collection: T
  where?: Where
  select: Record<string, unknown>     // INCLUDE MODE ONLY — required, never optional
  sort?: string
  limit?: number
}) {
  const payload = await getPayload({ config })
  return payload.find({
    collection: args.collection,
    // LAYER 2 — the Local API defaults overrideAccess to TRUE
    overrideAccess: false,
    user: undefined,
    // LAYER 3 — hard-coded, caller cannot override, `draft` is NEVER forwarded from user input
    where: args.where ? { and: [publishedWhere(), args.where] } : publishedWhere(),
    depth: 1,
    select: args.select,
    sort: args.sort,
    limit: args.limit ?? 100,
  })
}
```

**Three independent layers on every public read, and all three are required:**
1. Collection `access.read` returns a query constraint — `({ req: { user } }) => user ? true : { _status: { equals: 'published' } }`. This protects Payload's *own* generated REST surface. **Do not copy the docs' legacy `_status: { exists: false }` OR-branch** — it exists for collections that pre-date drafts; enable drafts from migration 001 so no `_status`-less rows ever exist.
2. `overrideAccess: false` **and** `user: undefined` on every Local API call in a public handler.
3. An explicit hard-coded published-only `where` the caller cannot override.

**Why all three:** the Local API sets `overrideAccess: true` by default, and *"Custom endpoints are not authenticated by default. You are responsible for securing your own endpoints."* One omission in one handler returns drafts, unpublished projects and full lead PII — **silently and unlogged**. Enforcement: a lint/CI rule fails the build if `payload.find` or `payload.findByID` appears anywhere under `src/app/(public)/**` without going through `publicFind()`.

**`definePublicEndpoint()` — the wrapper that cannot be forgotten:**

```ts
// src/lib/definePublicEndpoint.ts  (shape)
//  · headersWithCors({ headers, req })   ← custom endpoints get NO CORS for free
//  · Cache-Control + ETag (public GETs) / no-store (POST /leads, /healthz)
//  · try/catch → the nine-code error envelope + requestId
//  · an `options` method for preflight
```
⚠️ *"By default, custom endpoints don't handle CORS headers in responses."* Under D-015 **every public endpoint is hand-written**, so the one route that genuinely needs CORS — `POST /api/v1/leads`, the only live call from a visitor's browser — is precisely the route the root `cors` config does not cover. The root `cors: { origins: env.CORS_ORIGINS, headers: [] }` is *also* set, for Payload's own routes and the admin UI. **The Phase-10 test must run in a real browser** from the frontend origin: a curl test passes either way and proves nothing. ⚠️ **Preflight/`OPTIONS` behaviour for custom endpoints is NOT VERIFIED IN OFFICIAL DOCS** — register an `options` method and test it.

### 6.6 Which Payload-generated routes are DISABLED, and the exact config

🔴 **There is NO documented REST kill switch.** `graphQL.disable: true` exists and works. The collection option `endpoints` is described only as *"Add custom routes to the REST API. Set to `false` to disable routes"* — **whose scope is not stated and is unverified**. There is no `disableREST`, no per-operation switch. Risk R-9's mitigation as written (*"disable or lock down every generated endpoint"*) **is not executable as stated** (CONF-06). What *is* achievable, in this order:

```ts
// src/payload.config.ts
export default buildConfig({
  graphQL: { disable: true },        // (1) we hand-write REST; GraphQL is pure attack surface.
                                     //     Removes /payload-api/graphql and /graphql-playground entirely.
  routes: { admin: '/admin', api: '/payload-api', /* … */ },   // (2) move the generated surface off /api
  maxDepth: 3,
  defaultDepth: 1,
  defaultMaxTextLength: 20000,
  cors: { origins: env.CORS_ORIGINS, headers: [] },
  csrf: env.CSRF_ORIGINS,
  // …
})
```
```ts
// (3) EXPLICIT access on 100% of collections and globals — the ONLY documented lever
//     over the generated REST routes. Never rely on the default.
// src/collections/Projects.ts
access: {
  read:         publishedOrAuthenticated,   // ({req:{user}}) => user ? true : { _status: { equals: 'published' } }
  create:       isAdmin,
  update:       isAdmin,
  delete:       isAdmin,
  readVersions: isAdmin,                    // the seventh function no project document mentions
},
disableBulkEdit: true,
disableBulkDelete: true,
disableDuplicate: false,                    // duplicate is useful; beforeDuplicate suffixes the slug

// src/collections/Leads.ts  — the strictest in the system
access: { create: () => false, read: isAdmin, update: isAdmin, delete: isAdmin },
disableBulkDelete: true,

// src/collections/AuditLog.ts — append-only
access: { read: isAdmin, create: () => false, update: () => false, delete: () => false },
```
```
(4) Reverse-proxy rule: block every /payload-api/<slug> path that is not ours from the public internet,
    allowing only the admin origin. Payload offers no kill switch; this is the compensating control.
(5) Phase-10 negative tests, each an explicit assertion:
      GET  /payload-api/graphql               → 404
      GET  /payload-api/graphql-playground    → 404
      GET  /payload-api/leads                 → 401/403/empty, anonymously
      GET  /payload-api/projects/versions     → nothing, anonymously
      GET  /api/v1/projects/<unpublished>     → 404  (also with ?draft=true and
                                                 ?where[_status][equals]=draft)
      No public route returns lead data in ANY shape, authenticated or not (T-135).
```

**Record explicitly that `endpoints: false` is UNVERIFIED and must be empirically tested before any security claim rests on it.** `admin.hidden` is **navigation and admin routing only and is never a security control**. Field `hidden` is an Admin-Panel input type and does **not** keep a field out of the API.

**So no raw document, no version record and no lead data can leak:** GraphQL is gone entirely; the generated REST surface is off `/api` and behind an edge block; every collection declares explicit access including `readVersions`; `leads.read` is admin-only and `leads.create` is `() => false`; and the only code path that reads content for the public is `publicFind()`, which cannot be called without `overrideAccess: false` and a published-only `where`.

---

## 7. Admin Capabilities

### 7.1 The governing rule

**We do not rebuild CRUD that Payload already provides.** `ADMIN-CMS-SPEC.md`'s own architecture header says it: the document *"remains binding as a **BEHAVIOURAL** specification — what each screen must do, which validation applies, which states exist, and what must be impossible. Its **layout** descriptions become guidance, because Payload generates the admin UI from config."* **~80 % is satisfied by configuration alone.** Every hour spent reproducing a list view with filters, search, pagination, drag-ordering, a document editor with tabs, a publish button, a version history and a trash bin is an hour spent rebuilding something that already exists and will be maintained by someone else.

Therefore: **ADMIN-CMS-SPEC becomes a behavioural spec, not a layout spec.** Where it describes a column order, a tab arrangement or a button position, that is guidance. Where it describes a *rule* — "publish is impossible without consent", "never offer hard delete on a lead", "the error message must be identical for an unknown email and a wrong password" — that is binding and is implemented in config, access control or a hook.

### 7.2 Capability → mechanism map

Mechanisms: **Native** = Payload's generated admin UI, zero code · **Config** = a field/collection option · **Access** = an access-control function · **Hook** = a collection or field hook · **Component** = a small custom admin React component · **Script** = a CLI/Local-API script · **Route** = a hand-written Route Handler.

| # | Capability (ADMIN-CMS-SPEC §) | Mechanism | Why | Custom code |
|---|---|---|---|---|
| 1 | Log in / log out (§1) | **Native** | Payload ships the login view, the cookie, the session | none |
| 2 | Generic "Incorrect email or password", never revealing whether the email exists | **Native + verify** | Payload's own login failure message. ⚠️ the docs do **not** state whether responses differ for unknown vs known accounts — **verify in the Phase-2 spike**, and if they differ, normalise in a `beforeLogin` hook | possibly Hook |
| 3 | No "create account" link (§1) | **Access** | `users.access.create: isAdmin` — anonymous `POST /payload-api/users` 403s. There is no "disable registration" flag; it is purely an access consequence | none |
| 4 | Dashboard: new-lead count + 5 most recent, project counts, unused media (§2) | **Component** | Payload's default landing view is a collection list. Dashboard tiles are genuinely custom | **YES — custom views** |
| 5 | Dashboard "unresolved placeholders" counter (§2, §11) | **Component** | derived from `^\[.*\]$` across content fields | **YES — optional, OQ-15** |
| 6 | Projects list: cover thumb, name, category, locality, status badge, featured, updated (§3) | **Config** | `admin.defaultColumns`, `admin.useAsTitle`, `adminThumbnail` | none |
| 7 | Filters by status/category + text search (§3) | **Config** | `admin.listSearchableFields`; Payload's list view provides filtering | none |
| 8 | **Reorder (drag)**, writes immediately, optimistic with rollback (§3) | **Native** | `orderable: true` — the exact capability that got Strapi rejected | none |
| 9 | Publish / Unpublish (§3, §4-F) | **Native** | drafts + `_status`, Payload's own PublishButton | none |
| 10 | Archive / Restore, with the consequence named (§3) | **Config + copy** | `trash: true` + `admin.baseFilter`. The confirm copy — *"This removes the project from the public website. Its page will 404. You can restore it later."* — plus the documented caveat that a trashed document cannot have a **version** restored until it is first restored from trash | copy only |
| 11 | Project editor grouped into sections, not a 40-field wall (§4) | **Config** | unnamed `tabs` — Identity / Narrative / Lists / Media / Overrides — with **zero schema impact** | none |
| 12 | Six repeatable lists with drag-reorder (§4-C) | **Config** | `array` fields, drag-sortable by default | none |
| 13 | Repeater rows read as their title, not "Item 03" | **Component** | `RowLabel` — a tiny `'use client'` component using `useRowLabel` | **YES — trivial, high value** |
| 14 | **Icon is a picker over 41 names, never free text** (§4-C, FR-PROJ-15) | **Config** | a `select` over `ICON_NAMES` satisfies the hard rule outright | none |
| 15 | A *visual* icon picker showing pictures (§4-C) | **Component** | `admin.components.Field` over the same select | **OPTIONAL** |
| 16 | Slug auto-generated from name | **Hook** | field `beforeValidate`. **Hand-rolled, not Payload's `slugField()` helper** — that helper is documented as *"experimental and may change, or even be removed"*, and slugs are public URLs | **YES — small** |
| 17 | **Slug locked after first publish** (§4-A, FR-PROJ-18) | **Hook + field Access** | `beforeValidate` rejecting the change with `SLUG_LOCKED`, **plus** field `access.update` — *a UI lock is not a lock*, `admin.readOnly` does not bind the API | **YES** |
| 18 | Field-level `422` mapping, unsaved-changes guard, success toasts (§4 states) | **Native** | Payload's editor does all three | copy only |
| 19 | Five labelled media pickers (§4-D) | **Config** | four (five with brochures) named `upload` fields, generated from config | none |
| 20 | **Alt text required before attaching** (§4-D, FR-MEDIA-04) | **Config** | `alt: { required: true }` on `media` + the `isDecorative` escape hatch for genuinely decorative images | none |
| 21 | Media library: grid, thumbnails, search, upload, detail, replace (§6) | **Native** | the upload collection's list and edit views | none |
| 22 | **"Used in" list** on a media document (§6) | **Config** | `join` fields — virtual, no storage, rendered natively | none |
| 23 | **"Unused only" filter** (§6, FR-MEDIA-11) | **Config + Component** | a saved filter over the join counts. Orphans are **never auto-deleted** — an asset may be staged before attachment | **YES — small** |
| 24 | **Delete blocked while in use, `409` naming what uses it** (§6, FR-MEDIA-08) | **Hook** | `beforeDelete` summing `totalDocs` across every join + the `site-settings.logo` query. Payload documents **no** referential guard at all | **YES** |
| 25 | Leads list: newest first, filters, click-to-call (§5) | **Config** | `defaultSort: '-createdAt'` + `defaultColumns` | none |
| 26 | **Never offer hard delete on a lead** (§5, FR-LEAD-14) | **Config + Access** | `trash: true`, `disableBulkDelete: true`, and admin copy that says *archive* | none |
| 27 | **Lead status control** (§5) | **DO NOT BUILD** | ADMIN-CMS-SPEC: *"If the owner confirms no pipeline, remove the control entirely… **Do not default to building it.**"* OQ-3 | none |
| 28 | **Leads CSV export** (§5 / FR-LEAD-18) | **Route or plugin** | not a Payload primitive. Preferred: a small admin-only Route Handler streaming CSV from `payload.find`. ⚠️ If `@payloadcms/plugin-import-export` is adopted instead, the docs warn verbatim: *"Users who have read access to the upload collection may be able to download data that is normally not readable due to access control"* — scope it to `leads` only, lock the exports collection with `overrideExportCollection`, strip internal fields in `hooks.before`, and set `disableJobsQueue: true` | **YES** |
| 29 | Site settings as one tabbed form (§7) | **Config** | `tabs` on the global | none |
| 30 | **WhatsApp field warns that a real value changes hero behaviour** (§7) | **Config copy** | `admin.description` — and it must carry **all three** consequences (§11.2) | copy only |
| 31 | Live `wa.me` preview on the WhatsApp field (§7) | **Component** | cosmetic | **OPTIONAL** |
| 32 | **Testimonial consent gate** (§8, D-011, FR-CONT-04) | **Hook + DB CHECK** | *"must be a `beforeValidate` hook, not merely a disabled button"* — the hook wins over the spec's own UI wording. Plus one of only two retained DB CHECKs | **YES** |
| 33 | Content screens for Testimonials / FAQs / Statistics (§8) | **Native** | list → reorder → create/edit → publish, all from config | none |
| 34 | Change own password; **"invalidates all other sessions and says so"** (§9) | **Native** | documented: *"changing a user's password ends that user's other sessions"* | copy only |
| 35 | **No user management until OQ-4** (§9) | **Access** | single role; `users` hidden from navigation is *not* a security control — the access functions are | none |
| 36 | **Every mutation writes to `audit_log`** (§10, FR-AUDIT-01) | **Hook** | collection `afterChange`/`afterDelete` + auth hooks. **On the collections, never on endpoints** — the admin UI writes directly | **YES** |
| 37 | Audit screen (§10, FR-AUDIT-03, P2) | **Native** | Payload's default list view on a read-only collection. **No custom screen.** Keeps the nine-screen count correct | none |
| 38 | **Placeholder-awareness field highlighting** (§11, OQ-15) | **Component** | split in two: the *validation half* (a `validate` that **warns, never rejects**) is free and should ship; the *field-component half* may be dropped | **YES — split** |
| 39 | Admin branding (login graphic, logo) | **Component** | `BeforeLogin.tsx`, `graphics/{Logo,Icon}.tsx` | **OPTIONAL** |
| 40 | `admin.autoLogin` | **NEVER** | must not be set in any non-dev environment | — |

### 7.3 The genuine exceptions — the build-effort list

Six items, in priority order. Everything else on the admin side is configuration.

| # | Custom item | Kind | Justification | Consequence if skipped |
|---|---|---|---|---|
| 1 | **Testimonial consent gate** (`src/collections/Testimonials.ts` `beforeValidate` + a CHECK via `afterSchemaInit`) | Hook | D-011 + FR-CONT-04. The three testimonials that exist today are invented placeholders with bracketed names; `pages.ts:10-12` calls publishing them *"a fabricated record"* | The single easiest catastrophic mistake once an admin UI exists |
| 2 | **Media in-use delete guard** (`src/hooks/mediaDeleteGuard.ts` `beforeDelete`) | Hook | FR-MEDIA-08. Payload documents **no** referential integrity, no cascade config and no in-use protection for upload relations | Deleting a cover **breaks the build**: `image` is required on `Project` and `ProjectDetail.tsx:84`, `ProjectCard.tsx:19-22` and `lib/seo.ts:61-66` all dereference it **unguarded** — and `generateStaticParams` prerenders every project |
| 3 | **Audit hooks** (`src/hooks/audit.ts`, `src/hooks/authEvents.ts`) | Hook | FR-AUDIT-01. Payload versions contribute no actor, no IP, no action type, no auth events, and are not append-only | A legally-sensitive CMS with no record of who changed an approval claim |
| 4 | **Dashboard views** (lead counts, placeholder counter) | Component | ADMIN-CMS-SPEC §2. Payload's landing view is a collection list | The admin has no "what needs attention today" — a usability loss, not a correctness one. **Lowest of the six.** Define "new leads" as a **date-window query** (`createdAt` within 7 days) rather than as the `isRead` flag, so the tile needs no column, no write path, no audit entry, no migration and **no owner ruling** (CONF-86) |
| 5 | **Leads CSV export** | Route | FR-LEAD-18; the one bulk export the spec permits (*"Bulk import/export beyond lead CSV"* is in the "Deliberately NOT built" list) | The sales team cannot get their leads out |
| 6 | **Placeholder-awareness** | Hook (warn) + Component (highlight) | §11: *"Without this, the CMS quietly becomes a way to publish placeholders — the exact failure the frontend was carefully built to prevent."* | Ship the warning validator; the field component is droppable |

Plus three small, high-value ergonomics items that are not "exceptions" so much as polish: `RowLabel` components (#13 above), the hand-rolled `slugField` (#16), and the slug lock (#17).

**The five-item list in ADMIN-CMS-SPEC's own architecture header is correct** — dashboard views, icon picker, consent gate hook, media delete guard, placeholder awareness — with two amendments this plan makes: the **visual** icon picker is optional because a plain `select` already satisfies FR-PROJ-15, and the **audit hooks** and **CSV export** belong on the list and are missing from it.

### 7.4 Two admin rules that come from the frontend, not from the admin spec

**The design principle, verbatim:** *"the admin mirrors the frontend's honesty rules. The frontend refuses to fake a form success and renders unresolved placeholders inert. The admin must not undo that — **it must make 'I don't have this information' an easy, unalarming choice**."* This is why drafts run with `validate: false`, why every list is optional except `highlights`, why an empty list produces the helper *"Leave empty and this section will not appear on the website"*, and why bracketed placeholders are accepted rather than rejected.

**The interim-state disclosure.** Until Phase 9 ships the nav/footer derivation (FR-CONT-11), a newly published project will appear at `/projects`, in the sitemap and at its own URL, **but not in the navigation or footer** — `site.ts:41-49` and `:78-86` hardcode five slugs by hand, and `README.md:42`'s claim that the dropdown entry is created automatically is **factually wrong** (A5 §0.2 verifies it). **Say so in the Projects collection's `admin.description`.** That is the honest statement of the interim state, and nothing currently says it.

---

## 8. Media Architecture

### 8.1 The final design

**Two upload collections, because one cannot express two `mimeTypes` allow-lists.**

| Collection | Contents | Limit | `imageSizes` | `crop` / `focalPoint` | `adminThumbnail` | Tier |
|---|---|---|---|---|---|---|
| `media` | `image/jpeg`, `image/png`, `image/webp`, `image/avif` | **10 MB**, hook-enforced | one: `thumbnail` 400×300 | `true` / `true` | `'thumbnail'` | 1 |
| `documents` | `application/pdf` | **25 MB**, config-enforced | **none** — sharp cannot thumbnail a PDF | `false` / `false` | a static function | 2 |

### 8.2 The complete upload config, every option and its value

```ts
// src/payload.config.ts — the ROOT upload block. `limits` lives here, NOT on the collection.
import sharp from 'sharp'

export default buildConfig({
  sharp,                                           // REQUIRED for imageSizes, crop and focal point
  upload: {
    limits: { fileSize: 25 * 1024 * 1024 },        // the HIGHER (PDF) ceiling — see the note below
    abortOnLimit: true,                            // documented to return HTTP 413
    useTempFiles: true,
    tempFileDir: '/tmp/payload-uploads',
    responseOnLimit: 'That file is too large.',    // never echoes a path or a bucket name
    // requestSizeLimit: left at the default; the multipart envelope is bounded by fileSize
  },
  // safeFileNames / preserveExtension: NOT set — they are sanitisers, not anonymisers,
  //   and still leak the original filename into the public URL. UUID keys supersede them.
})
```

```ts
// src/collections/Media.ts
import type { CollectionConfig } from 'payload'
import { uploadGuard } from '@/hooks/uploadGuard'
import { mediaDeleteGuard } from '@/hooks/mediaDeleteGuard'
import { isAdmin } from '@/access/isAdmin'

export const Media: CollectionConfig = {
  slug: 'media',
  upload: {
    staticDir: 'media',                            // dev only; the S3 plugin overrides in production
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],  // image/svg+xml DELIBERATELY ABSENT
    allowRestrictedFileTypes: false,
    pasteURL: false,                               // ⚠ ENABLED BY DEFAULT — must be turned off (FR-MEDIA-12)
    skipSafeFetch: false,
    bulkUpload: true,
    crop: true,
    focalPoint: true,
    withMetadata: false,                           // never re-append metadata — EXIF concern
    cacheTags: false,                              // some CDNs reject the ?cacheTag= query
    filesRequiredOnCreate: true,
    imageSizes: [
      {
        name: 'thumbnail', width: 400, height: 300, position: 'centre',
        withoutEnlargement: true,                  // ⚠ default `undefined` returns NULL for small images
        admin: { disableGroupBy: true, disableListFilter: true },
      },
    ],
    adminThumbnail: 'thumbnail',
    // modifyResponseHeaders: NOT relied upon — it only covers the Payload-served path, and
    //   disablePayloadAccessControl takes Payload out of the serving path entirely (§8.7).
  },
  admin: { group: 'Media', useAsTitle: 'alt', defaultColumns: ['filename','alt','width','height','updatedAt'] },
  access: { create: isAdmin, read: isAdmin, update: isAdmin, delete: isAdmin },
  trash: true,
  versions: false,
  defaultSort: '-createdAt',
  defaultPopulate: { filename: true, url: true, alt: true, isDecorative: true, width: true, height: true },
  hooks: { beforeOperation: [uploadGuard], beforeDelete: [mediaDeleteGuard] },
  fields: [ /* §5.6 */ ],
}
```

⚠️ **`upload.limits.fileSize` is one application-wide value.** The 10 MB-image / 25 MB-PDF split is **not expressible in config**. Set the global limit to the higher ceiling with `abortOnLimit: true` (documented to return `413`) and enforce the tighter image ceiling in the hook. **A hook-thrown rejection surfaces as a 4xx, not the `413` the contract specifies** — `API-CONTRACT.md` must record that.

⚠️ **`withoutEnlargement: true` on every size.** The default `undefined` means *"uploading images with smaller width AND height than the image size will return null"* — the SV logo (146 KB) and every placeholder are exactly the assets that would hit this, producing broken admin thumbnails with no error.

**`imageSizes` is deliberately minimal — one size.** OQ-16 asks whether the backend generates responsive variants; the answer is **no**. `next/image` already produces AVIF/WebP responsive variants at the edge (`next.config.mjs:11`). Generating card/tablet/hero sizes duplicates that work and multiplies S3 objects and orphan-cleanup surface by 4×. The one `thumbnail` exists purely to feed `adminThumbnail`. Note also: *"Image cropping occurs before any resizing, the resized images will therefore be generated from the cropped image (not the original image)."*

### 8.3 The MIME allow-list, SVG rejection, and magic-byte sniffing

🔴 **Payload gives us almost nothing here, and its own example would allow SVG.**

- **SVG is NOT on Payload's restricted-file-type list.** That list covers executables, scripts, HTML/PHP/JS, `.hta`, `.reg` and similar — 30 entries, none of them `image/svg+xml`.
- Worse: *"If your Collection has defined `mimeTypes` … restricted file verification **will be skipped**"*, and Payload's own documented example is `mimeTypes: ['image/*']` — **which includes `image/svg+xml`. Never copy that example.**
- `mimeTypes` is documented as restricting *"the file picker"*, i.e. an Admin-UI-level constraint. **Server-side enforcement on a raw REST `multipart/form-data` POST is unproven** — treat it as UX, not as a control.
- **Payload documents no content sniffing anywhere.** The docs put the onus on us explicitly: *"Remember that all custom hooks attached to the `media` collection will still trigger. Ensure that files match the specified mimeTypes or sizes."*

Our allow-list is therefore **strictly narrower than Payload's deny-list**, which is the only reason skipping the restricted check is acceptable — and it **must be re-reviewed whenever it is widened**.

```ts
// src/hooks/uploadGuard.ts — ONE beforeOperation hook on create AND update. Order matters.
import type { CollectionBeforeOperationHook } from 'payload'
import { APIError } from 'payload'
import { randomUUID } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'

const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' } as const
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_SIDE_PX = 10_000

export const uploadGuard: CollectionBeforeOperationHook = async ({ req, operation }) => {
  if (operation !== 'create' && operation !== 'update') return
  if (!req.file) return
  const buf = req.file.data as Buffer

  // 1. MAGIC-BYTE SNIFF — a .jpg extension proves nothing
  const sniffed = await fileTypeFromBuffer(buf)
  if (!sniffed) throw new APIError('Unrecognised file type.', 415)

  // 2. HARD SVG REJECTION — belt and braces, because Payload blocks nothing here.
  //    file-type reports SVG as image/svg+xml; also reject a leading '<' after BOM/whitespace,
  //    because SVG is text and sniffers are not always decisive on it.
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (sniffed.mime === 'image/svg+xml' || head.startsWith('<?xml') || head.startsWith('<svg')) {
    throw new APIError('SVG files cannot be uploaded.', 415)
  }

  // 3. DECLARED vs ACTUAL MIME mismatch -> 415
  if (!(sniffed.mime in ALLOWED)) throw new APIError('That file type is not allowed.', 415)
  if (req.file.mimetype && req.file.mimetype !== sniffed.mime) {
    throw new APIError('The file contents do not match its declared type.', 415)
  }

  // 4. DIMENSIONS — decompression-bomb guard AND the width/height we own
  const meta = await sharp(buf).metadata()
  if (!meta.width || !meta.height) throw new APIError('Could not read image dimensions.', 415)
  if (meta.width > MAX_SIDE_PX || meta.height > MAX_SIDE_PX) {
    throw new APIError(`Images may be at most ${MAX_SIDE_PX} pixels on a side.`, 400)
  }

  // 5. PER-COLLECTION SIZE CEILING (the 10/25 split is not expressible in config)
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new APIError('Images may be at most 10 MB.', 400)

  // 6. RE-ENCODE WITH EXIF STRIPPED — drops GPS, camera metadata and any embedded payload
  const ext = ALLOWED[sniffed.mime as keyof typeof ALLOWED]
  const out = await sharp(buf).rotate().toFormat(ext === 'jpg' ? 'jpeg' : ext).toBuffer()

  // 7. CAPTURE the original name for display, THEN rename to a UUID.
  //    Rename AFTER sniffing so the extension reflects reality.
  //    FLAT key under the adapter's `prefix` — whether `/` in req.file.name is honoured
  //    as an S3 key prefix is NOT VERIFIED IN OFFICIAL DOCS. Drop yyyy/mm rather than fight it.
  if (req.data) {
    req.data.originalFilename = req.file.name
    req.data.width  = meta.width      // WE own these; field access.create/update are () => false,
    req.data.height = meta.height     //   so only this server path can set them
  }
  req.file.data = out
  req.file.size = out.byteLength
  req.file.mimetype = sniffed.mime
  req.file.name = `${randomUUID()}.${ext}`
}
```

The documented lever is exactly this: *"You can customize the filename before it's uploaded to the server by using a `beforeOperation` hook… The filename from here will also be threaded to image sizes if they're enabled."* Ordering inside the single hook is load-bearing: **rename after sniffing**, and **apply the hook to `update` as well as `create`** or a replace reverts to user-supplied filenames.

**`documents` uses the same hook shape with `%PDF-` as the sniff target**, `application/pdf` as the only allowed MIME, a 25 MB ceiling, no sharp call, and no dimension fields.

### 8.4 UUID filenames, replacement, and why the key changes

**Never use the uploaded filename as the storage key.** The repo already contains the cautionary case — `WhatsApp Image 2026-09-15 at 11.27.17 AM.jpeg`: spaces, colons, mixed case. A flat `{uuid}.{ext}` under the adapter's `prefix: 'media'` prevents path traversal, collisions, case-sensitivity bugs across platforms and URL-encoding problems, and it satisfies every stated goal in `MEDIA-MANAGEMENT.md` §7. The `yyyy/mm` partition buys nothing at single-digit-project volume and rests on an unverified assumption.

**Replacement (FR-MEDIA-07) writes a NEW key and keeps the same document id.** Payload's default already aligns: `overwriteExistingFiles` defaults to *not* overwriting (*"instead of generating a new filename"*), and our UUID rename on `update` guarantees a brand-new key. **Do not set `overwriteExistingFiles: true`** — it would break the immutable-cache design (`Cache-Control: public, max-age=31536000, immutable` is only safe because the key contains a UUID). Because the document id never changes, every project and site reference survives a replace untouched.

⚠️ **What happens to the OLD stored object after a replace is NOT VERIFIED IN OFFICIAL DOCS.** Capture `previousDoc.filename` in `afterChange` and enqueue it for `sweepDeletedMedia`, or the *"an accidental replace is recoverable for 30 days"* promise is silently false — and if Payload *does* eagerly delete, we would never notice.

### 8.5 Local dev vs S3 production — one config, two behaviours

```ts
// src/media/storage.ts
import { s3Storage } from '@payloadcms/storage-s3'
import { env } from '@/lib/env'

export const storage = s3Storage({
  // The documented conditional switch. The plugin is ALWAYS REGISTERED — never conditionally
  // included in `plugins` — because a config whose SHAPE varies by environment generates
  // divergent migrations between machines. With S3_BUCKET unset it is inert and Payload
  // falls back to local disk at svbackend/media/.
  enabled: Boolean(env.S3_BUCKET),
  collections: {
    media: {
      prefix: 'media',
      disablePayloadAccessControl: true,        // URLs point at the CDN, not through the app
      generateFileURL: ({ filename, prefix }) =>
        `${env.CDN_BASE_URL}/${prefix ? `${prefix}/` : ''}${filename}`,
    },
    documents: {
      prefix: 'documents',
      // ⚠ OQ-18: public brochures -> disablePayloadAccessControl: true.
      //    Lead-gated brochures -> leave access control ON, optionally signedDownloads.
      //    THESE ARE MUTUALLY EXCLUSIVE on the same collection. Decide before configuring.
      disablePayloadAccessControl: true,
    },
  },
  bucket: env.S3_BUCKET,
  acl: 'public-read',                            // the only value shown in the official example
  config: {
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    // ⚠ endpoint / forcePathStyle are AWS-SDK pass-throughs that Payload's own docs NEVER name.
    //    Valid by virtue of `config` being "an S3ClientConfig object passed to the AWS SDK client".
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    ...(env.S3_FORCE_PATH_STYLE ? { forcePathStyle: true } : {}),
  },
})
```

**Do not hard-code `disableLocalStorage: true` on the collection** — *"When enabled, this package will automatically set `disableLocalStorage` to `true` for each collection"*, so the same config works both ways.

**Env vars (canonical list in §22):** `S3_BUCKET` · `S3_REGION` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` · `S3_ENDPOINT` · `S3_FORCE_PATH_STYLE` · `CDN_BASE_URL`. The `STORAGE_*` names in `ARCHITECTURE.md` §7 are retired — the `S3_*` names are the ones the adapter's own documentation uses, so every future example pastes in without translation.

⚠️ `CDN_BASE_URL` wrong → **every image on the public site 404s**, and `next/image` throws `Invalid src prop` unless that exact host is in `svfrontend`'s `images.remotePatterns`. ⚠️ **The exact `generateFileURL` signature is NOT published in the docs** (only the type name `GenerateFileURL` and a one-line description) — verify the destructured argument names against the generated `.d.ts` before relying on them.

⚠️ **Dev-with-local + prod-with-S3 means `url` values in a DB dump are environment-specific.** Never restore a production dump into dev and expect images to resolve. And there is **no documented migration path** for files already on local disk when a collection later switches to S3 — that is a manual copy plus a DB check.

### 8.6 Public URL generation, and why `disablePayloadAccessControl: true`

The most important paragraph in the storage-adapter documentation, verbatim: *"To preserve this feature, by default, this plugin **keeps all file URLs exactly the same**. Your file URLs won't be updated to point directly to your cloud storage source, as in that case, Payload's Access control will be completely bypassed… Instead, all uploads will still be reached from the default `/collectionSlug/staticURL/filename` path. This plugin will 'pass through' all files."*

Left at the default, **every image URL routes through the Payload Next.js server, which then proxies S3** — latency, egress cost, and it defeats the "separate origin" requirement (files would be served from the *app* origin, which is precisely the XSS adjacency the spec is trying to avoid). So `disablePayloadAccessControl: true` plus `acl: 'public-read'` plus `generateFileURL` rewriting to `media.<domain>`.

**The trade is explicit:** turning it on removes file-level access control entirely. Correct for public marketing imagery; **wrong the moment brochures become gated** — which is exactly why `documents` is a separate collection and why OQ-18 must close first.

⚠️ **How the `url` field is composed is NOT documented** beyond the `/collectionSlug/staticURL/filename` pattern. Compose `src` deterministically in the serialiser from `CDN_BASE_URL` + prefix + filename rather than trusting the field blindly. And when a public query selects `url`, **also select `filename: true`** or Payload returns `url: null`.

**Headers come from the bucket/CDN, not from Payload.** `s3Storage()` exposes **no** option to set `Cache-Control`, and `upload.modifyResponseHeaders` only covers the Payload-served path — which `disablePayloadAccessControl: true` removes us from. So the bucket policy / CDN behaviour must set: `Cache-Control: public, max-age=31536000, immutable` (safe because the key is a UUID), `X-Content-Type-Options: nosniff` on all media responses, and `Content-Disposition: attachment` for PDFs. **This split must be written into `SECURITY.md` and `INTEGRATIONS.md` or it will be forgotten.**

### 8.7 In-use deletion protection, orphans, and the sweeper

**Payload documents no referential integrity, no cascade behaviour, no soft delete for files, no orphan reporting and no grace-period sweeper for relations.** All of it is ours. The `ON DELETE RESTRICT` FK that `DATABASE-SCHEMA.md` §3.21 mandates **is not something Payload's Postgres adapter is documented to create** — and it would never fire anyway, because media delete is a *soft* delete.

```ts
// src/collections/Media.ts — reference counting is virtual, via Join Fields
{ name: 'usedAsCover',       type: 'join', collection: 'projects', on: 'image' },
{ name: 'usedInGallery',     type: 'join', collection: 'projects', on: 'gallery' },
{ name: 'usedAsLayout',      type: 'join', collection: 'projects', on: 'layoutImage' },
{ name: 'usedAsLocationMap', type: 'join', collection: 'projects', on: 'locationMap' },
// ⚠ The Join Field documents `collection` (a collection slug). A GLOBAL reference —
//    site-settings.logo — must be counted with an explicit query in the hook, not a join field.
```
```ts
// src/hooks/mediaDeleteGuard.ts — beforeDelete
//  1. sum totalDocs across the four join fields
//  2. + one explicit query for site-settings.logo === id
//  3. > 0 and no force flag  -> throw APIError(409) LISTING what uses it, by project name
//  4. ?force=true            -> detach first, THEN soft-delete
```

**Three rules, written down because silence picks the wrong variant:**

1. **The attachment guard is application code, not a constraint.** Amend `MEDIA-MANAGEMENT.md` §9 and `DATABASE-SCHEMA.md` §3.21 to say so rather than mandating a FK Payload will not create.
2. **`?force=true` may never leave a published project without a cover.** `types/content.ts` makes `image` **required**, and three call sites dereference `project.image.*` **without guards** — a missing image does not degrade the page, it **throws at build**, because `generateStaticParams` prerenders every project. **Decision: force-delete refuses with `409` when the asset is a published project's `image`.** (The documented alternative — unpublish the affected projects and say so in the response — is acceptable but noisier; pick one and never leave it silent.)
3. **The sweeper re-checks attachment immediately before removing the storage object and the row, in the same transaction.** The soft-delete window means the guard and the hard delete are separated in time by ~30 days.

**Orphans (FR-MEDIA-11)** are `totalDocs === 0` across all joins plus the logo query. Surfaced as an **"unused" filter** and **never auto-deleted** — an asset may legitimately be staged before attachment.

**The admin workflow, end to end:** upload (drag-drop or picker; client-side pre-check for type and size is UX only — *"server-side is authoritative"*) → on success the UI prompts immediately for alt text → attach from a project's labelled picker or from the media library → "Used in" tab shows every referencing project → Replace writes a new key and every reference survives → Delete shows *"This image is used by 2 projects. Remove it there first, or delete anyway."* — **never silently break a live page.**

### 8.8 The SVG conflict, head-on

**The conflict, stated exactly:**
- `MEDIA-MANAGEMENT.md` §11 steps 1–3 instruct the cutover to **upload the five project SVGs and attach them as `cover`** *"so nothing renders blank"*, plus the logo and `master-plan.svg`, `plot-sizes.svg`, `location-thumb.svg` as site assets.
- `MEDIA-MANAGEMENT.md` §6, `VALIDATION-RULES.md` §4, `SECURITY.md` §10 and the `SECURITY.md` §18 checklist **all** state SVG is always rejected — *"an admin-uploaded SVG is a stored-XSS vector that the placeholder-only rationale does not cover."*
- `BACKEND-ROADMAP.md` Phase 1 deliverable 4 requires the five projects seeded *"verbatim"* / *"byte-faithfully"*, and every one of those records carries `image.src = '/images/projects/<slug>.svg'` with `width: 1200, height: 800`.
- And **Local API uploads still fire all hooks**, so a seed script gets no free pass.

**The resolution — three parts, and none of them is an exception to the SVG ban:**

1. **Phase 1's seed uploads nothing.** It stores the existing `/images/projects/*.svg` **path strings** exactly as they are in `projects.ts` today, so the byte-faithful seed is achievable without touching the upload pipeline at all. Say so explicitly in Phase 1's deliverable. The Phase-1 gate is about the *schema and the serialiser*, not about media.
2. **The real asset migration rasterises first.** `src/seed/rasterise.ts` converts the eight placeholder SVGs to PNG **once, offline**; the PNGs are **committed** under `src/seed/assets/` and the seed uploads those. The output is committed rather than generated at seed time so that seeding is deterministic and does not depend on a rasteriser being installed. Rewrite `MEDIA-MANAGEMENT.md` §11 accordingly.
3. **Do not create an "allow SVG for the seeded five" exception.** It is a permanent hole for a temporary problem, and the hole sits on the one collection an authenticated editor can write to. (A one-off seed path that bypasses the hook and is deleted afterwards is the only acceptable alternative, and it is strictly worse because "deleted afterwards" is a promise, not a control.)

**Record that Payload gives us nothing here:** the SVG block, magic-byte sniffing, declared-vs-actual MIME mismatch → 415, EXIF stripping, re-encoding and the 10 000 px bomb guard are **all** custom `beforeOperation` code, and defining `mimeTypes` *disables* Payload's own restricted-type check.

### 8.9 The frontend consequences

| # | Change | File | Urgency |
|---|---|---|---|
| 1 | **Add `images.remotePatterns`** for the CDN host, the bucket host, and the Payload host if media is ever proxied. Keep `pathname` as tight as possible: `{ protocol: 'https', hostname: 'media.<domain>', pathname: '/media/**' }` | `svfrontend/next.config.mjs` | 🔴 **CRITICAL.** Without it, **six `next/image` call sites throw `Invalid src prop … hostname is not configured`** the instant URLs become remote — `Media.tsx` `Frame` and `Plate`, `ProjectCard.tsx`, `MediaSequence.tsx`, `PinnedProof.tsx`, `Logo.tsx` |
| 2 | **Delete `dangerouslyAllowSVG`, `contentDispositionType`, `contentSecurityPolicy`** (3 lines) — **but only after** real raster art replaces every placeholder | `svfrontend/next.config.mjs:19-21` | Deferred. Its stated justification (*"the files are first-party"*) evaporates the moment a CMS can upload |
| 3 | Extend `qualities: [75, 90]` if any CMS image needs a third value | `svfrontend/next.config.mjs:14` | Low. `Logo.tsx:28` is the only non-default today, and Next **rejects** unlisted quality values |
| 4 | The two raw `<img>` tags in `Lightbox.tsx:61-70, 118-128` need **no** `remotePatterns` config — and get **no** optimisation | `Lightbox.tsx` | Note only. This is the largest image-weight risk once real brochure scans replace the placeholder SVGs |

**Phase 5's exit criterion must be rewritten.** As written — *"uploaded URLs render through `next/image`"* — it **cannot be satisfied without editing `svfrontend/`**, and Phase 9 is the only phase permitted to do that and is approval-gated. Rewrite it to what Phase 5 can actually prove: *"an uploaded asset is reachable at a stable public URL, and that URL is recorded as a required entry in the Phase 9 `remotePatterns` list."*

**One dependency chain nobody has drawn, and it terminates in an unowned input** (CONF-77): **photography → real raster assets → `dangerouslyAllowSVG` deleted → the SVG ban is finally consistent → `remotePatterns` exercised with real files.** All five project images are *"SVG placeholder title cards, not photographs"*, declared 1200×800. **Photography has no open question, no requirement ID, no roadmap item and no owner**, yet it is listed as blocking launch. Two things are decidable without the owner and should be written now: the **asset specification** (formats, minimum dimensions consistent with the declared 1200×800 cover and the `qualities: [75, 90]` constraint, and a per-project shot list derived from the five render slots **plus the three homepage `MediaSequence` tiles**), and the **interim disclosure in the admin UI**: *"every project image is a placeholder title card; replacing them is a content task, not a CMS task."*

---

## 9. Lead Architecture

**This is the only feature that genuinely requires a backend.** PRD §1 problem 2, verbatim: ***"Every enquiry typed into that form today is lost."*** `ContactForm.tsx:45-50` does not even fake a success — it tells the visitor nothing was sent, on the stated principle that *"a visitor told 'we'll call you back' when nothing was sent is worse off than one who sees no form at all."* Everything below exists to keep that honesty while making the outcome true.

### 9.1 The public POST contract

```
POST /api/v1/leads
Content-Type: application/json          ← the ONLY accepted type; anything else → 415
Idempotency-Key: <opaque string>        ← optional, 24 h TTL
Origin: https://www.<domain>            ← must be in CORS_ORIGINS
```
```jsonc
{
  "name":    "Ramesh Kumar",            // required
  "phone":   "9876543210",              // required, raw as typed
  "projectSlug": "sri-city-aler-town",  // optional; "" | null | absent all mean "no preference"
  "message": "Looking for a 200 sq yd plot, can visit this Sunday.",   // optional
  "website": ""                         // the HONEYPOT — must be empty (§9.4)
}
```
```jsonc
// 201 Created   ·   Cache-Control: no-store
{ "data": { "id": "9f3c1e0a-4b7d-4d2e-8f11-8a2c0d31cc41",
            "createdAt": "2026-09-20T09:30:00Z",
            "message": "Thanks — we will call you back." } }
```
```jsonc
// 422 Unprocessable Entity
{ "error": { "code": "VALIDATION_ERROR", "message": "One or more fields are invalid.",
  "requestId": "req_01JBX…",
  "details": [ { "field": "phone", "code": "TOO_SHORT", "message": "That number looks incomplete." } ] } }
```

Rules the response obeys: **never echoes stored PII beyond the id**; `Cache-Control: no-store`; **no public GET representation exists**; `source` is server-assigned and a client value is advisory only; `projectSlug` is **never trusted**. `details[].field` values are `name`, `phone`, **`project`** (note: the body key is `projectSlug`, the error field is `project`) and `message` — they match `ContactForm`'s input `name` attributes exactly, **so the inline error slots need no redesign**. The client's `Errors` type is currently `Partial<Record<'name'|'phone', string>>` and must widen to include `'project' | 'message'` in Phase 9.

### 9.2 Zod validation — the exact rules

```ts
// src/schemas/lead.ts
import { z } from 'zod'
import { MIN_PHONE_DIGITS } from '@/lib/constants'   // 8 today — see §9.6. ONE shared constant.

const digits = (s: string) => s.replace(/\D/g, '')
const CONTROL_CHARS = /[\x00-\x1F\x7F]/

export const leadBody = z.strictObject({            // strict: unknown properties are REJECTED (§6.4 carve-outs)
  name: z.string()
    .transform((s) => s.normalize('NFC').trim())
    .refine((s) => s.length >= 1,   { params: { code: 'REQUIRED' } })
    .refine((s) => s.length <= 120, { params: { code: 'TOO_LONG' } })
    .refine((s) => !CONTROL_CHARS.test(s), { params: { code: 'INVALID' } })
    .refine((s) => /\p{L}/u.test(s),       { params: { code: 'INVALID' } }),   // not punctuation/digits only

  phone: z.string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 1, { params: { code: 'REQUIRED' } })
    .refine((s) => digits(s).length >= MIN_PHONE_DIGITS, { params: { code: 'TOO_SHORT' } })
    .refine((s) => digits(s).length <= 15,               { params: { code: 'TOO_LONG' } })   // E.164 max
    .refine((s) => !/^(\d)\1+$/.test(digits(s)),         { params: { code: 'INVALID' } }),   // 0000000000 etc.

  projectSlug: z.union([z.literal(''), z.null(), z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)]).optional(),
  //  existence is checked against the DB in the handler → UNKNOWN_PROJECT

  message: z.string()
    .transform((s) => s.normalize('NFC').trim())
    .refine((s) => s.length <= 2000, { params: { code: 'TOO_LONG' } })
    .optional(),

  website: z.string().max(0).optional(),            // THE HONEYPOT — named, and carved out of `strict`
})
```

| Field | Req | Rule | Field code |
|---|---|---|---|
| `name` | ✔ | NFC-normalise, trim, 1–120, reject control characters, reject punctuation/digits-only | `REQUIRED`, `TOO_LONG`, `INVALID` |
| `phone` | ✔ | strip non-digits; **≥8 (interim, §9.6)**; ≤15; reject all-same-digit | `REQUIRED`, `TOO_SHORT`, `TOO_LONG`, `INVALID` |
| `projectSlug` | ✖ | absent / `""` / `null` allowed; otherwise **must match an existing published slug** | `UNKNOWN_PROJECT` |
| `message` | ✖ | NFC-normalise, trim, ≤2000, **strip HTML** (in the field hook, after Zod) | `TOO_LONG` |
| `source` | — | **server-assigned**; a client value is accepted and overwritten | — |
| `website` (honeypot) | ✖ | must be empty; if filled → §9.4 | — |

**Body-size cap, `Content-Type` allow-list and UTF-8 enforcement** are all applied before Zod runs (§6.4). Arrays are capped at 50 items globally; nothing in the lead body is an array today.

### 9.3 Normalisation — field hooks, not endpoint code

Normalisation lives in `beforeValidate` **field** hooks so that the validator sees the clean value and so the admin path and the public path normalise identically. This is the achievable form of NFR-11: **one shared constants module** (`MIN_PHONE_DIGITS`, every length limit, `ICON_NAMES`, the category values) imported by *both* the Payload field config and the Zod schemas, plus a CI guard on the icon list. *"One Zod schema that generates everything"* is not achievable under D-015 — the admin UI form rules and the DB constraints come from Payload field config while custom endpoints use Zod — and `VALIDATION-RULES.md` §9 must be restated to the shared-constants form rather than left asserting something the architecture cannot deliver.

```ts
// src/hooks/leadNormalise.ts  (field-level beforeValidate hooks)
//  name      → NFC + trim
//  phone     → stored VERBATIM, exactly as submitted (A5 §4.5)
//  phoneNormalised → digits only; if 10 digits assume +91; else keep the leading country code → E.164
//  message   → NFC + trim + STRIP HTML  (stored-XSS defence: the lead is later rendered in the
//              admin AND in a notification email; React escapes, the email renderer must too)
//  source, sourcePath, ipAddress, userAgent, project, projectNameSnapshot, consentGiven
//            → server-set in the handler / beforeChange, and ALL of them carry
//              field access: { create: () => false, update: () => false }
```

⚠️ **`admin.readOnly` alone is not enough for any of those.** It is *"without affecting the API"* — trivially spoofable over REST. The Phase-10 test is concrete: **POST a lead with `"source":"whatsapp"` in the body and assert the stored value is `contact_form`.**

**`sourcePath`** is server-derived from the `Referer` header, validated to be same-origin and path-only, and truncated. It is never trusted as free text. **`project` and `projectNameSnapshot`** are resolved server-side from `projectSlug` — the id makes the relation queryable, the snapshot makes a historic lead survive a project rename or archive. `DATABASE-SCHEMA.md` §9 is explicit that this is *not* an FK.

### 9.4 Anti-abuse

| Control | Mechanism | Owner | Note |
|---|---|---|---|
| **Rate limit 5/min/IP** | reverse proxy / CDN / WAF (`nginx limit_req`, Caddy `rate_limit`, or Cloudflare) | **infrastructure** | 🔴 **Payload 3 ships NO HTTP rate limiting.** v2's Express-era `rateLimit` config is gone; the dedicated *Preventing Production API Abuse* page has **no rate-limiting section and recommends no replacement**; the only occurrence of "rate limit" in the entire docs corpus is an example of throwing your own `APIError`. Returns `429` **with `Retry-After`** |
| **Rate limit 3/hour/phone** | application, keyed on `phoneNormalised` | ours | the edge cannot see the body |
| **Honeypot** | a named field, rendered off-screen, `autocomplete="off"`, `tabindex="-1"` | ours | **does not exist in `ContactForm.tsx` today** — adding it is a **Phase-9** frontend change. Until then the honeypot protects nothing, and the rate limit plus `Idempotency-Key` are the only spam controls. **Say that rather than implying coverage.** |
| **Windowed dedupe** | `(phoneNormalised, projectSlug)` within **10 minutes** | ours | long enough to absorb a double-tap, short enough that a genuine second enquiry the same afternoon is not swallowed. **A constant in `src/hooks/leadDedupe.ts`, deliberately not an env var** — widening it rejects real enquiries and narrowing it admits spam, a behaviour change that belongs in a reviewed commit, not in a platform console with no diff and no audit trail |
| **`Idempotency-Key`** | 24 h TTL; a repeat key within the window replays the original `201` verbatim | ours | bounded storage, and 24 h comfortably covers a mobile double-submit |
| **Body size, `Content-Type`, UTF-8** | the handler | ours | §6.4 |
| **CSRF** | **not applicable** | — | `POST /api/v1/leads` is intentionally cross-origin and unauthenticated; it is defended by rate limiting, the honeypot and the dedupe window instead |

**The honeypot status-code oracle — resolved.** `VALIDATION-RULES.md` §2 says a filled honeypot *"accept with **`200`** and silently discard"*; `API-CONTRACT.md` §2.5.7 documents exactly one success shape, **`201`**. A `200` with a different or absent body is **an observable difference a spam bot can use to fingerprint the honeypot** — which defeats the entire mechanism, because the value of a honeypot is that the bot cannot tell.

> **Rule: a honeypot hit is indistinguishable from success in status, headers, body shape and latency.** Return **`201`** with a well-formed body — a synthetic id that corresponds to no stored row, a real `createdAt`, and the same `message` string. Nothing is persisted; nothing is queued. Add a deliberate small random delay only if the real path's latency is measurably different; do not add one speculatively.

The honeypot field must be **named** in `VALIDATION-RULES.md` (it currently is not) and added to the explicit carve-out list from the *"reject unknown properties"* rule — otherwise §8's blanket rule and §2's honeypot rule contradict each other, requiring the same field to be both accepted and rejected (CONF-48).

### 9.5 Storage, access, and the proof that leads are never public

The `leads` collection and every field is specified in §5.6. The access block is the strictest in the system:

```ts
// src/collections/Leads.ts
access: {
  create: () => false,      // the public endpoint calls payload.create({ overrideAccess: true })
  read:   isAdmin,
  update: isAdmin,
  delete: isAdmin,          // but the admin UI never offers hard delete — trash only
},
versions: false,            // versioning an operational PII table multiplies PII copies
trash: true,
disableBulkDelete: true,
defaultSort: '-createdAt',
```

**Four independent facts make FR-LEAD-15 (*"Leads are never exposed on any public endpoint"*) true, and each is testable:**
1. `access.read: isAdmin` — Payload's **generated** REST route `GET /payload-api/leads` returns nothing anonymously.
2. GraphQL is disabled entirely, so there is no second shape.
3. **No public serialiser for `leads` exists.** There is no `toPublicLead()` anywhere in `src/serializers/`, and `publicFind()` is typed to the collections it may read.
4. The edge blocks `/payload-api/leads` from the public internet.

**Phase-10 test T-135, stated as an assertion:** *no public route returns lead data in any shape, authenticated or not — including Payload's generated `/payload-api/leads` and its `/versions` sub-route.*

### 9.6 The phone-digit conflict — and the coordinated fix

| Source | Rule |
|---|---|
| `ContactForm.tsx:34` (live today) | `phone.replace(/\D/g,'').length < 8` → *"That number looks incomplete."* → **accepts ≥8** |
| `EnquiryPill.tsx:29` (live today) | `digits.length < 10` → *"Enter a 10-digit mobile number."* → **demands ≥10** |
| `VALIDATION-RULES.md` §2 | *"strip non-digits; **≥10 digits** (see OQ-19); ≤15"* |
| `OPEN-QUESTIONS.md` OQ-19 / P-08 | *"standardise on **10**. ⚠️ a backend enforcing 10 will reject submissions the current form accepts — **the frontend must be aligned in the same release**"* |
| `BACKEND-ROADMAP.md` | Phase 7 ships server validation; **Phase 9** aligns the form — and Phase 9 *"requires explicit approval"* and may never be approved |

**The roadmap's own sequence guarantees the lead-loss window OQ-19 warns about.** A backend enforcing 10 while a live form accepts 8 creates a **silent lead-loss regression inside the phase whose stated purpose is to stop lead loss** — *"This phase closes the only gap that exists today."* And the rejections are invisible to the business: a `422` on a form the visitor has already filled in reads as "the site is broken", not as a policy.

**Resolution — a deliberate, time-boxed divergence from P-08, not a decision that 8 is correct:**

1. **The server accepts ≥8 digits from Phase 7.** `MIN_PHONE_DIGITS = 8` in `src/lib/constants.ts`, imported by both the Zod schema and the Payload field `validate`.
2. **The normaliser is threshold-independent.** It strips non-digits and formats E.164 assuming `+91`; tightening is then a **one-line constant change**, not a rewrite.
3. **Phase 7 exit criterion, added:** *"the accepted phone length matches the live `ContactForm` rule."*
4. **Phase 9 deliverable, added:** *"tighten `MIN_PHONE_DIGITS` to 10 **in the same release** that aligns `ContactForm.tsx:34` and `EnquiryPill.tsx:29`."* All three move together or none of them moves.
5. **Operational safety net:** **log rejected submissions** — without storing them as leads — so that if the threshold is ever wrong, the affected enquirers can be identified rather than lost silently. This is also the only signal that would ever reveal a mis-set threshold.

### 9.7 The notification path — queued, not direct, and why

**Decision: `afterChange(create)` on `leads` enqueues a `sendLeadNotification` job. The email is never sent inline.**

The official jobs documentation answers this question **by name**: *"If the email service is temporarily down, the hook would fail and potentially block the user creation. Jobs can retry automatically."* FR-LEAD-06 requires the same thing from the other direction — *"a failed notification must not fail the request"*. An inline send couples a visitor's `201` to a third party's uptime, on the one endpoint in the system whose failure costs the business money directly.

```ts
// src/hooks/enqueueLeadNotification.ts — afterChange, operation === 'create'
//  payload.jobs.queue({ task: 'sendLeadNotification', input: { leadId: doc.id }, queue: 'default' })
//  wrapped in try/catch: a queue failure MUST NOT fail the visitor's request either.
//  input is an ID, never the object — the docs' own rule.
```

**`notification_jobs` is deleted from the schema.** Payload's Jobs Queue **already is** that table — `payload-jobs`, with tasks, retries, `waitUntil`, cron schedules and an admin surface. Building a second queue for one async task means a second runner and a second failure surface. Record the field mapping in `DATABASE-SCHEMA.md` §15 so the intent survives, then delete the table.

**Retry and failure behaviour** (full detail in §13; the lead-specific parts here):

| Aspect | Value | Note |
|---|---|---|
| `retries` | `3` | a plain count is **all the docs support** |
| Backoff | **none documented** | hand-rolled: `watchdogFailedJobs` re-queues with `waitUntil = now + 15 min`, max 2 re-queues |
| Dead-letter | **Payload documents none** | `A2` §6.2 demands *"queued with retry and a dead-letter path"*. The watchdog is that path |
| Idempotency | **mandatory** — `notifiedAt` short-circuit | retries are at-least-once. Without it, three retries during a provider blip send the sales team three copies of the same lead |
| Poison input | `JobCancelledError` | a missing `SALES_NOTIFICATION_EMAIL` or a deleted lead can never succeed; cancelling stops the retry loop instead of hiding the real failure behind `totalTried: 3` |
| `onFail` / `onSuccess` | **do not use** | listed in the options table with **no signature, no arguments and no example anywhere** |

🔴 **Two documented silent-failure modes that no project document mentions, and both are fatal for a lead-generation product:**
1. **With no runner configured, queued jobs *"will never be executed"*** — nothing in the request path errors. The lead saves, the API returns `201`, and no notification is sent.
2. **With no email adapter configured, Payload logs a warning rather than throwing** — a task can complete and report success having sent nothing.

Both are **indistinguishable from "business is quiet."** Three named controls close them, and they are deliverables, not assumptions:
- **A boot-time assertion** that refuses to start in production without a configured email transport (`SMTP_HOST`) and without `SALES_NOTIFICATION_EMAIL`.
- **The runner as its own supervised process** with a liveness check, plus monitoring on queue depth and oldest-pending-job age.
- **The watchdog task** alerting on a **second channel**, plus two standing alarms that catch the fully silent break: *"a `sendLeadNotification` job has been pending more than N minutes"* and **"zero leads in 72 hours."** The second is the only control that catches a completely silent failure, and it costs one scheduled query. It is **operational observability, not analytics** — it introduces no third-party script, no cookie banner and no DPDP consequence, and it does **not** reopen the deliberate analytics deferral.

### 9.8 Admin lead management, export, retention and PII

**List:** newest first (`defaultSort: '-createdAt'`, and `createdAt` is indexed by default), columns Name · Phone · Project · Source · Received, with click-to-call and WhatsApp deep links for immediate follow-up. Filters by project, source and date range.
**Detail:** all fields plus the full message, `sourcePath` and timestamps. Payload's native document view covers this entirely.
**Status:** **not built.** OQ-3 is open and ADMIN-CMS-SPEC §5 is unusually blunt — *"If the owner confirms no pipeline, **remove the control entirely** rather than shipping a field nobody maintains. **Do not default to building it.**"*
**Archive:** `trash: true`. **Never hard delete** — *"a lead is a commercial record"* (FR-LEAD-14). `disableBulkDelete: true`, and the admin copy says *archive*, never *delete*.
**Read/unread:** FR-LEAD-13 is INFERRED/P2 and annotated *"no evidence it is wanted"*, yet ADMIN-CMS-SPEC builds the dashboard on it. **Prefer the answer that needs no ruling: define the dashboard's "new leads" as a date-window query (`createdAt` within 7 days)** — no column, no write path, no audit entry, no migration. The `isRead` field stays in the model because it costs one boolean and the tile may later want it, but **nothing depends on it**.
**CSV export:** FR-LEAD-18, the one bulk export the spec permits. A small **admin-only Route Handler** streaming CSV from `payload.find` is preferred over `@payloadcms/plugin-import-export`, whose documentation carries an explicit warning: *"Users who have read access to the upload collection may be able to download data that is normally not readable due to access control."* If the plugin is adopted anyway: scope it to `leads` only, lock the exports collection with `overrideExportCollection`, strip internal fields in `hooks.before`, and set `disableJobsQueue: true`.

**Retention and PII — three windows, two decided here and one for the owner:**

| Window | Value | Status |
|---|---|---|
| `Idempotency-Key` TTL | **24 hours** | **decided** — technical, bounded, covers a mobile double-submit |
| Dedupe window | **10 minutes** on `(phoneNormalised, projectSlug)` | **decided** — technical |
| `ipAddress` / `userAgent` purge | **90 days**, by the `purgeLeadPii` cron task | **decided** — `SECURITY.md` §17 already quantifies it |
| **The lead record's own lifetime** | — | 🔴 **OWNER DECISION.** `SECURITY.md` §17 says *"define a lifetime for lead records"* and never does. Under DPDP, *"define a lifetime"* is not a retention policy. It must be stated in the privacy policy and enforced by a scheduled purge |

**Consent, stated honestly.** `consentGiven` defaults to `true` and means **implicit consent by submission**, evidenced by `formNote` being rendered adjacent to the submit control (`ContactForm.tsx:130`). `ContactForm` has four controls and **no consent checkbox**; the note itself still contains the literal token `[LINK TO PRIVACY POLICY]`, rendered as plain text. That sentence belongs in `SECURITY.md` §17 verbatim, because a hardcoded `DEFAULT true` is a weaker artefact than the audit implied. **Gate:** `POST /api/v1/leads` **must not be reachable in production until a reachable privacy URL is configured** (OQ-24, *"the largest compliance gap in the project"*). If explicit consent is ever required, it is a Phase-9 frontend change (a checkbox), not a schema change.

**Backups contain PII** and inherit the same access controls and retention as live data; erasure-on-request is Trash plus a purge path.

### 9.9 The second capture surface — and the hole that is about to open

`EnquiryPill.tsx` is the hero's phone-capture pill. `whatsappReady = !isPlaceholder(site.whatsapp)` (`:23`). Today `site.whatsapp` is bracketed, so the pill routes to `/contact?phone=…` and the lead **is** captured. **The moment an admin types a real number into the CMS — a Tier-1, one-field edit in the first build — the pill stops routing to `/contact` and opens WhatsApp directly, and the lead never touches any server.**

`REQUIREMENTS.md` FR-LEAD-17 (INFERRED/P2) requires the hand-off to be logged, and `leads.source` has a `whatsapp` value — **with literally no documented way to produce such a row.** `API-CONTRACT.md` defines no endpoint, `VALIDATION-RULES.md` no shape, `BACKEND-ROADMAP.md` Phase 7 no deliverable.

**This is an owner decision, and the safe default is to define the endpoint rather than leave an enum value with no writer:**

```
POST /api/v1/leads/whatsapp        public · same rate limits and honeypot as POST /leads
body: { phone, sourcePath? }       source server-assigned to 'whatsapp'
→ 204 No Content                   (the visitor has already been sent to WhatsApp; there is nothing to say)
   Cache-Control: no-store
   Called BEFORE window.open in EnquiryPill.tsx:38-42, and NOT awaited.
```
⚠️ **The DPDP consequence nothing currently states:** this records a phone number **without the `formNote` promise having been shown**. Either the pill must surface the same promise, or `consentGiven` must be `false` on these rows. And the `whatsapp` site-setting field's admin help text must carry the warning *"until this ships, enquiries that go to WhatsApp are not recorded anywhere"* — see §11.2, where that same field carries **three** consequences and ADMIN-CMS-SPEC currently mentions one.

---

## 10. Auth Architecture

### 10.1 The design in one paragraph

One auth-enabled collection (`users`) bound to the Admin Panel via `admin.user`. **Session-backed httpOnly JWT cookies** — Payload's default — with a 2-hour token lifetime, account lockout after 5 failures for 15 minutes, a ≥12-character password policy, **no public registration**, **one role**, and **no hand-written auth UI at all**: the administrator uses Payload's own login view, and for Phase 1 we write **zero** auth screens.

### 10.2 The exact config block

```ts
// src/collections/Users.ts
import type { CollectionConfig } from 'payload'
import { isAdmin } from '@/access/isAdmin'
import { lowercaseEmail } from '@/hooks/leadNormalise'   // shared NFC/lowercase field hooks
import { auditLogin, auditLogout, auditForgotPassword, detectLockout } from '@/hooks/authEvents'
import { MIN_PASSWORD_LENGTH } from '@/lib/constants'    // 12

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    useSessions: true,              // DEFAULT — and NEVER set to false.
                                    //   "Stateless JWTs cannot be revoked, so they stay valid until
                                    //    tokenExpiration even after a password change."
    tokenExpiration: 7200,          // seconds. "JWTs and HTTP-only cookies will both expire at the same time."
    maxLoginAttempts: 5,            // per ACCOUNT, not per IP — see §10.6
    lockTime: 15 * 60 * 1000,       // milliseconds = 15 min
    depth: 0,                       // how deep the `user` bound to req is populated
    removeTokenFromResponses: true, // the cookie is the transport; the body does not need the JWT
    cookies: {
      secure: process.env.NODE_ENV === 'production',   // cannot be true over http://localhost
      sameSite: 'Lax',                                 // viable ONLY because of §10.3
      // domain: NOT set — the admin and the API share one host (cms.<domain>)
    },
    forgotPassword: {
      expiration: 60 * 60 * 1000,   // 1 hour
      minRequestInterval: 15000,    // the documented default; the ONLY throttle Payload gives us here
    },
    // loginWithUsername: NOT used — email login is correct for a 2-person admin team
    // verify:            NOT used — there is no self-signup, so there is no verification loop
    // useAPIKey:         NOT used — the public endpoints are unauthenticated reads
    // disableLocalStrategy: NEVER — see §10.5
    // strategies:        NOT used
  },
  admin: { useAsTitle: 'email', group: 'Administration', defaultColumns: ['email','name','isActive'] },
  access: {
    create: isAdmin,
    read:   isAdmin,
    update: isAdmin,
    delete: () => false,            // deactivate, never delete — audit attribution must survive
    unlock: isAdmin,                // so one admin can release the other (§10.6)
    admin:  isAdmin,                // who may enter the Admin Panel at all
  },
  versions: false,
  trash: false,
  defaultSort: 'email',
  hooks: {
    afterLogin:          [auditLogin, detectLockout],
    afterLogout:         [auditLogout],
    afterForgotPassword: [auditForgotPassword],
  },
  fields: [
    { name: 'email', type: 'text', hooks: { beforeValidate: [lowercaseEmail] } },  // redefine to attach the hook
    {
      name: 'password', type: 'text',        // redefine the injected field to attach validation
      validate: (value: unknown) => {
        if (typeof value !== 'string') return true                 // unchanged on update
        if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
        if (isBreached(value)) return 'That password appears in a known breach list. Choose another.'
        return true
      },
    },
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'role', type: 'select', required: true, defaultValue: 'admin',
      options: [{ label: 'Administrator', value: 'admin' }],
      enumName: 'enum_admin_role', admin: { position: 'sidebar' } },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true,
      admin: { position: 'sidebar',
        description: 'Disable instead of deleting — audit attribution must survive. See the deactivation runbook.' } },
  ],
}
```
```ts
// src/payload.config.ts
admin: { user: Users.slug },      // "The Admin Panel can only be used by a single auth-enabled Collection."
cookiePrefix: 'sv',               // → the cookie is `sv-token`
```

⚠️ **The one thing to prove in the Phase-2 spike:** the *ability* to redefine `email`/`username`/`password` in the `fields` array is documented; **a documented example of attaching `validate` specifically to the injected `password` field is NOT VERIFIED IN OFFICIAL DOCS.** Prototype it before promising a password policy (task T-061). If it does not attach, the fallback is a collection `beforeValidate` hook inspecting `data.password`.

⚠️ **No default values are printed for `tokenExpiration`, `maxLoginAttempts` or `lockTime`.** Set all three explicitly and assert them in a config test rather than relying on undocumented defaults.

### 10.3 Cookies, and the deployment constraint that keeps `SameSite=Lax` viable

**httpOnly is inherent, not configurable.** *"HTTP-only cookies are a highly secure method of storing identifiable data on a user's device… They are totally protected from common XSS attacks and cannot be read by JavaScript in the browser, unlike JWT's."* The `auth.cookies` row lists **only** `secure`, `sameSite` and `domain` as settable — **`httpOnly` is not a configurable key**, which is correct.

Production `Set-Cookie` must show: `sv-token=…; Path=/; HttpOnly; Secure; SameSite=Lax`.

🔴 **Deploy the CMS on a subdomain of the public site's registrable domain — `cms.<domain>` beside `www.<domain>`.** This is an *architecture* requirement, not a preference. *"Cookies can cross subdomains without being considered third party cookies."* An unrelated host forces `SameSite=None`, which removes the browser's own CSRF defence and makes the `csrf` allow-list load-bearing on its own. With `Lax`, CSRF has two independent layers.

**CSRF:** `csrf: env.CSRF_ORIGINS` — *"A whitelist array of URLs to allow Payload to accept cookies from"*; `config.serverURL` is added to it by default. Missing the admin origin → **admin login silently fails to set cookies**; over-broad → the allow-list stops being a defence. `POST /api/v1/leads` is intentionally cross-origin and unauthenticated, so CSRF does not apply to it.

**CORS:** the root `cors: { origins: env.CORS_ORIGINS, headers: [] }` — **exactly two origins**, the public site and the admin origin. **Never `*`.** And remember that this does **not** cover our custom endpoints (§6.5).

### 10.4 The session-vs-JWT reality, and login/logout/me

Payload issues an **httpOnly JWT cookie** and, with `useSessions: true` (the default), maintains a server-side session identity: the JWT's reserved keys are `id`, `collection`, `email`, **`sid`**, `iat`, `exp`, and *"Payload signs an `authVersion: 1` marker in each token's protected JWT header."* So it is **neither** a pure stateless JWT **nor** the `admin_sessions` table three project documents model.

**`admin_sessions` does not exist and must be deleted from `DATABASE-SCHEMA.md` §2, `ARCHITECTURE.md` §6 and `TRACEABILITY.md` §5.** What Payload adds instead is a **`sessions` field on the user document** — and ⚠️ **its shape, its Postgres storage and any API to enumerate it are NOT VERIFIED IN OFFICIAL DOCS.** Do not build an "active devices" UI on it. The documented sliding-expiry/absolute-cap design is replaced by what Payload actually exposes: `tokenExpiration`, `admin.autoRefresh`, and `POST {routes.api}/users/refresh-token`. Per-session `ip`/`user_agent` review is **not available** and must be dropped or rebuilt on the audit log instead.

| Operation | Path (with `routes.api = '/payload-api'`) | Notes |
|---|---|---|
| Login | `POST /payload-api/users/login` | driven by Payload's own login view — **we write no UI** |
| Logout | `POST /payload-api/users/logout?allSessions=false` | `allSessions=true` → *"end all sessions for the user logging out"* |
| Me | `GET /payload-api/users/me` | *"Returns either a logged in user with token or null"* |
| Refresh | `POST /payload-api/users/refresh-token` | `admin.autoRefresh` drives it from the panel. ⚠️ `autoRefresh: true` *"keeps users logged in indefinitely while the browser remains open"* — that works against a 2-hour token and should be a deliberate choice, not a default |
| Unlock | `POST /payload-api/users/unlock` | gated by `access.unlock` |
| Forgot / Reset | `POST /payload-api/users/forgot-password` · `/reset-password` | §10.8 |

If a custom login screen is ever built, use the **documented `@payloadcms/next/auth` server functions** (`login`, `logout`, `refresh`) — they are the cookie-correct path in an App Router app. ⚠️ Local API code samples are **missing** for `logout`, `me`, `refresh` and `resetPassword`; their exact argument objects are **NOT VERIFIED IN OFFICIAL DOCS**. Prefer the server functions.

### 10.5 Password storage — the truth, and the SECURITY.md conflict resolved

**Payload stores a per-user salt and a PBKDF2-SHA256 derived key.** Verbatim: *"The `hash` field stores a **PBKDF2-SHA256** derived key prefixed with the scheme it was created with, for example `pbkdf2-sha256-v1:<derived-key>`."* Auth-enabled collections are *"automatically injected with the `hash`, `salt`, and `email` fields"*, and *"All find operations are sanitized, and specifically `hash` and `salt` are removed from the document."*

**The `auth` config table has 13 options and NONE of them concerns hashing.** There is no `minPasswordLength`, no algorithm selector, no cost parameter. The only escape is `auth.disableLocalStrategy: true` plus a fully hand-written strategy — which the docs gate with *"Only use this property if you have replaced Payload's auth mechanisms with your own"* and which forfeits login, forgot-password, reset-password, unlock, `maxLoginAttempts`/`lockTime`, the admin login UI **and the session machinery D-004 depends on**.

**Three documents mandate `argon2id`:** `REQUIREMENTS.md` FR-AUTH-04 (*"argon2id (bcrypt acceptable fallback)"*, CONFIRMED/P0), `SECURITY.md` §1 (*"argon2id (bcrypt cost ≥12 acceptable)"*), and `TRACEABILITY.md` §5. **All three will be false in production, and `SECURITY.md` is a client-facing document.**

> **Resolution: an ACCEPTED, DOCUMENTED DEVIATION — not "satisfied", and not silently mitigated.**
>
> Amend FR-AUTH-04, `SECURITY.md` §1 and `TRACEABILITY.md` §5 to a vendor-accurate, algorithm-neutral statement: *"Passwords are never stored in reversible form. The CMS stores a per-user salt and a PBKDF2-SHA256 derived key, and strips `salt` and `hash` from every read operation. Never MD5, SHA-1 or plaintext."* Record the deviation in `DECISIONS.md` with its reason.
>
> **Do not pursue `disableLocalStrategy`.** It destroys more security than it buys — it would hand us responsibility for login, lockout, reset and session revocation, every one of which Payload currently does correctly.
>
> **Compensate with the controls we do own and Payload does document:** a ≥12-character minimum with a breach-list check (§10.2), `maxLoginAttempts: 5` + `lockTime: 900000`, admin-only account creation, edge rate limiting on the login path, two admin accounts, and full auth-event auditing. Following NIST SP 800-63B, there is **no forced rotation and no composition rule** — length plus a breach check is the current standard and is stronger in practice than a complexity matrix.
>
> **Verification test:** a `users` row shows the `pbkdf2-sha256-v1:` prefix, and `salt`/`hash` never appear in any API read. **`grep -r argon2 svbackend/docs/` returns zero hits** once the amendment lands.

⚠️ API-key caveat, if `useAPIKey` is ever enabled: *"An API key is independent of the user's password. Changing or resetting a password does not disable an existing API key."* And *"If you change your `PAYLOAD_SECRET`, you will need to regenerate your API keys."*

### 10.6 No public registration, first-admin creation, and brute force

**The exact config that guarantees no self-registration** is `users.access.create: isAdmin` (§10.2). There is **no "disable registration" flag** — it is purely an access-control consequence, and anonymous `POST /payload-api/users` then returns 403. There is also **no documented admin-invitation flow**: inviting a colleague means an admin creates their user and either sets a password or triggers forgot-password.

⚠️ **The single most likely bootstrap footgun in this whole plan:** *"The interaction between `access.create: () => false` and the create-first-user screen is NOT documented."* No official page states whether Payload special-cases the very first user when `create` access is denied. **Deploying with `create` locked down and no user in the database could produce a lockout recoverable only with shell access.**

**Therefore first-admin creation never depends on the web screen.** The seed script (`src/seed/index.ts`, run via `npm run payload -- run src/seed/index.ts`, gated on `PAYLOAD_SEED === 'true'`) calls `payload.create({ collection: 'users', … })` using the Local API, where access control is skipped by default. It is **step 9 of the deployment order** and it is in the runbook. Verify first-admin creation end to end in a throwaway environment during the Phase-2 spike. The `/admin/create-first-user` route exists and may work; **we do not depend on it.**

**Brute force — concrete values and the DoS they create:**

| Control | Value | Source |
|---|---|---|
| `auth.maxLoginAttempts` | **5** | *"Automatically locks out a user from authenticating if this limit is passed. Set to `0` to disable."* |
| `auth.lockTime` | **900000** ms (15 min) | *"the time (in milliseconds) that a user should be locked out"* |
| `auth.forgotPassword.minRequestInterval` | **15000** ms (the default) | the only other documented throttle, and it applies only to reset emails |
| Unlock | `POST /payload-api/users/unlock`, gated by `access.unlock: isAdmin` | so an admin can release a locked peer rather than waiting out the lock |

⚠️ **The lock is per ACCOUNT, not per IP.** With a single admin account, a targeted attacker can trivially deny service by locking the sole administrator out on purpose. **Mitigation, and it is a process requirement not a config one: two admin accounts in every environment from day one**, one per real person, with `access.unlock: isAdmin` so either can release the other. The Phase-11 check is that every environment has ≥2 active admin users.

⚠️ Undocumented and therefore to be established by test, not assumed: whether the failed-attempt counter resets on a successful login, whether the lock auto-expires after `lockTime` without an explicit unlock call, the field names used, and **what HTTP status a locked account returns**. Also undocumented: whether login and forgot-password responses differ for unknown vs known accounts — ADMIN-CMS-SPEC §1 requires a **generic** *"Incorrect email or password."* for unknown email, wrong password **and** locked account. If Payload's responses differ, normalise them.

### 10.7 Login rate limiting, and D-004 / OQ-26 session revocation

**Login rate limiting: Payload provides NONE, and this must be stated truthfully.** `rateLimit` does not exist in the v3 config options table — v2's Express-era option is gone with Express. The dedicated *Preventing Production API Abuse* page has sections for *Limit Failed Login Attempts, Max Depth, CSRF, CORS, Limiting GraphQL Complexity, Malicious File Uploads* and **no rate-limiting section and no recommended replacement**. Five project documents assume it exists or is free.

**The exact mitigation layer:** the reverse proxy / CDN / WAF in front of the container — `nginx limit_req`, Caddy `rate_limit`, or Cloudflare — enforcing **5 failed attempts / 15 minutes / IP** on `POST /payload-api/users/login` and `/forgot-password`, returning `429` **with `Retry-After`**. This is a tracked **infrastructure deliverable with a Phase-10 test that it actually fires**, not a middleware line-item. `ARCHITECTURE.md` §3 places "rate limit" in a `middleware/` layer as if framework-provided and §7 lists `RATE_LIMIT_*` env vars; **both must be corrected**, and `RATE_LIMIT_*` must not exist as an application variable — a variable implying the app enforces something it does not is the most dangerous kind of wrong documentation.

What Payload *does* contribute, and it is worth stating so the edge rules are sized correctly: `maxLoginAttempts` + `lockTime` (per **account**), `forgotPassword.minRequestInterval`, `maxDepth: 3`, `defaultDepth: 1`, `defaultMaxTextLength`, and `graphQL.maxComplexity` (moot — GraphQL is disabled).

#### D-004 / OQ-26 — SESSION REVOCATION: the definitive answer

**OQ-26 is answerable today from official documentation, and the answer is YES for every case the requirement names.** B04 recorded revocation-on-password-change as *"NOT VERIFIED IN OFFICIAL DOCS"*; **that is wrong**, and C2 §0.4 re-verified it against the docs bundle. The official text:

- *"With sessions enabled, changing a user's password **ends that user's other sessions**, so tokens that were issued before the change stop working."*
- *"Updating the password of the user making the request … keeps the session that the request was made with and ends the rest."*
- ***"Updating a user's password on their behalf, such as an admin updating another user, ends ALL of that user's sessions."***
- *"The `resetPassword` operation **ends all existing sessions** and returns a token for the new session that it creates."*
- Logout accepts `allSessions: true` — *"end all sessions for the user logging out."*

| D-004's requirement | Payload's answer | Verdict |
|---|---|---|
| httpOnly, not script-readable (the XSS rationale) | httpOnly cookie, *"cannot be read by JavaScript in the browser"* | ✅ **satisfied natively** |
| Server-side revocation, not mere expiry (the revocation rationale) | `useSessions: true` by default; *"Stateless JWTs cannot be revoked"* is the documented contrast | ✅ **satisfied natively** |
| Revoke on password change | documented, verbatim, above | ✅ **satisfied natively** |
| An admin revoking another admin's sessions | documented via admin-initiated password change | ✅ **satisfied natively** |
| FR-AUTH-06 *"Invalidates all other sessions and says so"* | exactly the documented behaviour | ✅ **the UI claim is true** |
| **Revoke on account deactivation (`isActive → false`)** | **not documented — `isActive` is our field, not Payload's** | ⚠️ **THE ONE RESIDUAL GAP** |

**`tokenVersion` is NOT built.** It was proposed as the cheap fix for an unmet revocation rationale; the rationale is met. Building it would add a field, a bump path on two events, and a check in every access function, to duplicate behaviour the framework already has.

**The exact mitigation for the one residual gap — two parts, both cheap:**

```ts
// src/access/isAdmin.ts — the ENTIRE authorisation model routes through this one function,
// so deactivation takes effect on the next request without a token-version scheme.
import type { Access } from 'payload'
export const isAdmin: Access = ({ req: { user } }) =>
  Boolean(user) && user?.isActive === true && user?.role === 'admin'
```
1. **`isActive` is checked in `isAdmin`**, and every collection and global routes its access through it. ⚠️ Verify in the Phase-2 spike that `req.user` carries `isActive` under `auth.depth: 0` — `depth` controls relationship *population*, not field presence, so it should; **prove it with a test rather than assuming it.**
2. **Deactivation is a documented two-step runbook entry**, not a checkbox: set `isActive: false` **and** change that user's password as an admin — which **is** documented to end all of their sessions. The first step closes the authorization door; the second closes the session.

**The amendment D-004 needs, precisely:**

> **D-004 — amend from PROPOSED to ACCEPTED-AS-AMENDED.** Strike the mechanism (*"an opaque session id with server-side session records"*) and keep the intent (*"httpOnly, not script-readable, server-revocable"*). Record that Payload's httpOnly JWT cookie with `useSessions: true` satisfies **both** rationales. Delete `admin_sessions` from `DATABASE-SCHEMA.md` §2, `ARCHITECTURE.md` §6 and `TRACEABILITY.md` §5. Add four hard rules: **(a) never set `useSessions: false`**; **(b)** account deactivation is the two-step above; **(c)** the documented gotcha — *"A Local API update that runs without an authenticated user has no session to keep, so it ends all of the user's sessions. **Pass the `user` returned by `payload.auth`** when the user making the request should stay logged in"* — which means any script or hook that updates a user must thread the acting user or it will silently log that person out of everything; **(d)** `PAYLOAD_SECRET` rotation is **break-glass only** and is never the revocation mechanism — sessions are.
>
> **Close OQ-26** with the quotes above and move it into `DECISIONS.md` (the log's own rule: *"A resolved `OPEN-QUESTIONS.md` item moves here — it is never silently deleted"*). **Downgrade risk R-3 from Medium.** Strike **P-01** (*"Node + TypeScript + Fastify + Prisma + PostgreSQL"*) in the same pass, exactly as P-13 is struck — it is the only stale row in the pending table that is not marked as such.

**Verification test:** log in twice from two browsers, change the password from session A, and assert session B's cookie is rejected on the next request.

### 10.8 Password reset — included, with the justification

**Decision: enable `forgotPassword` / `resetPassword`.** OQ-8 asks whether it is needed; the answer is yes, and the reasoning is operational rather than aspirational.

**The justification.** With exactly two admin accounts and no self-registration, the only recovery path without reset-by-email is "ask the other admin to change your password" — which works right up until the other admin is unavailable, or until both accounts are locked by the per-account lockout (§10.6), at which point recovery requires shell access to the production database. Reset is **native, free, already wired to `NEXT_PUBLIC_SERVER_URL`** (the link is `${serverURL}/admin/reset/${token}`), and it is documented to **end all existing sessions**, which makes it a genuine security control rather than merely a convenience.

**The cost, and how it is paid.** A public `forgot-password` route is an enumeration and spam surface. Mitigations, all of them already specified elsewhere in this plan: `forgotPassword.minRequestInterval: 15000` (Payload's own throttle), `expiration: 3600000` (a 1-hour token), an **edge rate limit on the path** alongside the login limit, a **generic response regardless of whether the email exists** (normalised by us if Payload's differs — §10.6), an `afterForgotPassword` **audit-log entry**, and a **boot guard** that refuses to start in production without a configured email transport — because a reset feature with no mail adapter logs a warning and silently sends nothing, which is worse than not having the feature at all.

**`NEXT_PUBLIC_SERVER_URL` must be exactly right** — *"protocol, domain and (optionally) port"*, so **a trailing path breaks it**. Wrong value → reset emails link to the wrong host → an unusable account-recovery path, discovered at the worst possible moment.

### 10.9 No unnecessary RBAC — and why

**There is exactly one role, `admin`, and there is no permission system.**

Payload ships **no RBAC model at all** — roles, permissions, matrices, inheritance and any UI for them would be 100 % our code, our tests and our maintenance. The requirement does not exist: OQ-4 is open, ADMIN-CMS-SPEC §10 says *"Single `admin` role"* and notes that the `403` branch is *"unused under a single role, but the check exists"*, and `REQUIREMENTS.md` has no requirement for a second role. A permission matrix for one role is pure liability: code that is never exercised, never correctly tested, and confidently wrong the first time a second role appears.

**What we build instead: four access primitives, and nothing else.**

```
src/access/isAdmin.ts                   → Boolean(user) && user.isActive && user.role === 'admin'
src/access/anyone.ts                    → () => true
src/access/nobody.ts                    → () => false
src/access/publishedOrAuthenticated.ts  → ({req:{user}}) => user ? true : { _status: { equals: 'published' } }
```

**Three rules keep this honest.**
1. **Every collection and every global declares an explicit `access` block — including `readVersions`.** Payload's default is `({ req: { user } }) => Boolean(user)`, i.e. **allow-any-authenticated, full CRUD** — the *opposite* of the roadmap's *"deny-by-default access control on every collection"*. It is benign **today** with one role and becomes a hole the moment a second auth-enabled collection exists. A **config test enumerates every collection and global and fails on any missing key**.
2. **`role` exists as a column from migration 001**, with `enumName: 'enum_admin_role'` and a single option, so answering OQ-4 later is `ALTER TYPE … ADD VALUE` plus new access functions — **not a migration on a populated table**.
3. **`admin.hidden` is navigation and admin routing only and is NEVER a security control.** Neither is field `hidden`, which is an Admin-Panel input type and does not keep a value out of the API.

---

## 11. Globals vs Collections

### 11.1 The official test, and how it applies

Payload's documentation gives one criterion and it is decisive. Globals *"correspond to a **single Document** stored in the database"*, and: ***"If you have more than one Global that share the same structure, consider using a Collection instead."*** Globals are positioned for site-wide singletons — navigation headers, banner alerts — and their `afterChange` hook is documented for exactly our use: *"Use this hook to **purge caches of your applications**, sync site data to CRMs, and more."*

Globals also have a **different, shorter hook set** than collections — `beforeOperation`, `beforeValidate`, `beforeChange`, `afterChange`, `beforeRead`, `afterRead`. **There is no `afterOperation`, no `beforeDelete`, no `afterDelete`**, because a global cannot be deleted; and `beforeValidate`/`beforeChange` run only within `update`, because a global has no create path.

| Content | Kind | The reasoning |
|---|---|---|
| `site-settings` | **GLOBAL** | Exactly one site. `DATABASE-SCHEMA.md` §10 already models it as a `CHECK (id = 1)` singleton, and its own D-015 banner says it *"becomes a Payload global rather than a `CHECK (id = 1)` singleton."* |
| `projects`, `leads`, `media`, `documents`, `testimonials`, `faqs`, `statistics`, `audit-log`, `users` | **COLLECTIONS** | Many documents, identical structure — the docs' own test, stated in the inverse |
| `site-settings.heroTicker` (5 rows) | **array field inside the global** | Five rows, one consumer (`Hero.tsx:82-85`, homepage only), no independent publish state, no per-item lifecycle, never queried on their own. A collection would buy an admin list screen nobody needs and a table nobody joins |
| `pages` / page headings | **NEITHER — stays in frontend code** | §5.9 / D-010. 9 of 12 `pages.ts` titles are already dead; ~20 more headings exist only in JSX. A `pages` global would produce an editor UI whose fields visibly do nothing |

⚠️ **How globals are physically stored in Postgres is NOT VERIFIED IN OFFICIAL DOCS.** The only lever is `dbName`. This matters only for hand-written migrations — read `generate:db-schema` before writing one.

### 11.2 `site-settings` — the complete field list

```ts
// src/globals/SiteSettings.ts
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site Settings',
  dbName: 'site_settings',
  access: { read: () => true, update: isAdmin, readVersions: isAdmin },
  admin: { group: 'Configuration',
    description: 'These values appear on every page of the public website.' },
  versions: { max: 50, drafts: false },   // ⚠ the key is `max` on globals, `maxPerDoc` on collections.
                                          //    Writing the wrong one is SILENTLY IGNORED.
  hooks: { afterChange: [writeAudit, revalidateEverything] },
  fields: [{ type: 'tabs', tabs: [ /* below */ ] }],
}
```
**Drafts off, deliberately.** A draft/published split on site settings creates a *"why isn't my new phone number live?"* failure mode. Version history is kept for **instant rollback of a fat-fingered phone number** — which is a site-wide outage of the primary conversion path — without imposing a publish gate on a one-field edit.

**Revalidation is different for this global than for a project.** `site-settings` feeds `layout.tsx`, `PillNav`, `Footer` and `robots.txt`, so its `afterChange` needs a **revalidate-everything** path, distinct from the per-project `['/', '/projects', '/projects/{slug}', '/sitemap.xml']` set.

| Tab | Field | Type | Req | Validation | Tier | Notes |
|---|---|---|---|---|---|---|
| **Brand** | `name` | `text` | ✔ | ≤120 | 1 | `site.ts:14`. ⚠️ **OQ-6 unresolved: "SV Developers" (repo) vs "SRR Developers Pvt. Ltd." (brief + live site).** Renders in every heading, SEO title, the oversized footer wordmark and the WhatsApp message template |
| Brand | `legalName` | `text` | ✔ | ≤120 | 1 | `site.ts:15`. **A distinct field with a distinct use** — it is the entity in the copyright line. Answering OQ-6 must not silently change both |
| Brand | `tagline` | `text` | ✖ | ≤200 | 1 | `site.ts:16`; `layout.tsx:48` |
| Brand | `description` | `textarea` | ✖ | ≤400 | 1 | `site.ts:17`; root meta description |
| Brand | `url` | `text` | ✔ | absolute `https://`, **no trailing slash**, and a **publish-blocking deny-list** on `example.com` / `example.org` hosts | 1 | 🔴 `site.ts:19` = `https://www.example.com` — **the one known UNBRACKETED placeholder.** `isPlaceholder()` requires the whole string to start `[` and end `]`, so the inert-link guard never fires, and the value feeds `metadataBase`, all 12 sitemap URLs and `robots.txt`. `VALIDATION-RULES.md` §5's rule (*"valid absolute https:// URL"*) **passes** it. The deny-list is cheaper and stronger than any admin warning, because the failure is silent and slow to notice — wrong canonicals get indexed |
| Brand | `logo` | `upload → media` | ✖ | — | 2 | FR-MEDIA-13. Today a 146 KB opaque JPEG, duplicated. Should be an SVG or transparent PNG — but **SVG cannot be uploaded** (§8.3), so transparent PNG |
| **Contact** | `email` | `text` | ✔ | valid email **or** `^\[.*\]$`; **publish-blocking on a bracketed value** | 1 | `site.ts:20`. ⚠️ `Footer.tsx:51` and `contact/page.tsx:22` build `` `mailto:${site.email}` `` — the bracket ends up *inside* the string, `isPlaceholder` returns `false`, and **a live, focusable, non-struck-through `mailto:[EMAIL@DOMAIN]` ships on every page today.** `telHref()` exists to avoid exactly this for phone numbers; **there is no `mailHref()` equivalent.** The validator is the server-side compensator until Phase 9 adds one |
| Contact | `phone` | `text` | ✔ | free text (displayed verbatim) or bracketed | 1 | `site.ts:21`. PillNav, Footer, ProjectDetail, `/contact` |
| Contact | `whatsapp` | `text` | ✔ | **`^\d{10,15}$`** or bracketed. **Must not contain `+`, spaces or dashes** | 1 | `site.ts:23`. `EnquiryPill.tsx:39` builds `wa.me/<value>` directly. ⚠️ **`admin.description` must carry all THREE consequences** — ADMIN-CMS-SPEC §7 mentions one: (1) *"Setting a real value changes the hero: the capture pill stops routing to /contact and opens WhatsApp directly"*; (2) *"until FR-LEAD-17 ships, those enquiries are not recorded anywhere"* (§9.9); (3) *"`/contact`'s WhatsApp link is currently the raw digit string and will 404 until Phase 9 fixes it"* — `contact/page.tsx:21` passes `href: site.whatsapp`, inert today **only by accident**, and the browser will resolve `919XXXXXXXXX` as a relative path to `/919XXXXXXXXX`. **This fires on the first day of real content** |
| Contact | `address` | `text` **`hasMany`** | ✔ | `minRows: 1, maxRows: 5`, each ≤120, **unique lines** | 1 | `site.ts:24` — an ordered 3-line array rendered as `<span class="block">` in three places. **Not a textarea.** `key={line}` → duplicate lines collide |
| Contact | `mapUrl` | `text` | ✖ | URL or bracketed | 1 | `site.ts:25` |
| Contact | `officeHours` | `text` | ✖ | ≤200 | 1 | `site.ts:26`. ⚠️ `contact.faq[0].a` embeds `[OFFICE HOURS]` separately — two sources for one fact |
| **Social** | `social` | `array` (3 rows) | ✖ | `label` text · `href` URL-or-bracketed · `iconField()` | 1 | `site.ts:53-57`. All three hrefs bracketed today |
| **Legal** | `legalLinks` | `array` | ✖ | `label` · `href` | 1 | `site.ts:93-96`. **A privacy policy is legally required once PII is collected** — and `POST /api/v1/leads` is gated on it being reachable (§9.8) |
| **Content** | `formNote` | `textarea` | ✖ | ≤400 | 2 | `pages.ts:342-343`. ⚠️ *"must stay truthful to actual data use"* — it is the consent artefact (§9.8) |
| Content | `cta` | named `group` `{ title ≤120, body ≤400 }` | ✖ | — | 2 | `pages.ts:370-375`, `ClosingCta.tsx:11-12`. ⚠️ **the shape differs from `Project.cta`**: site is `{title, **body**}`, project is `{title, **description**}`. **Keep them distinct and say so in both documents** |
| Content | `heroTicker` | `array` (5 rows) | ✖ | `iconField()` · `text` text req, **unique** | 2 | `pages.ts:59-65`, `Hero.tsx:82-85`. `key={item.text}` |

**NOT fields on this global, and why:**

| Not a field | Class | Reason |
|---|---|---|
| `legal.copyright` | **computed** | `site.ts:90` stores `` `© [YEAR] ${site.legalName}. All rights reserved.` `` — `[YEAR]` is embedded **mid-string**, so `isPlaceholder()` returns `false` and **the literal text `© [YEAR] SV Developers.` renders live in the footer today**, unstyled and unguarded. The serialiser computes `` copyrightText: `© ${new Date().getFullYear()} ${legalName}. All rights reserved.` ``. **Drop `copyright_text` from the settings model and from the admin Legal tab**, and say *"computed; not an editable field"* in `API-CONTRACT.md` §2.5.3 so nobody re-adds it. This deletes a whole class of bug |
| `legal.disclaimer` | **STATIC / T3** | *"Changing it is a lawyer's job, not a CMS edit."* Writing that down converts a dangling cross-reference into a decision at no cost (OQ-12 is currently one identifier doing two unrelated jobs — CONF-91) |
| `nav[]` / `footerNav[]` **structure** | **STATIC / T3** | Route structure is code. Changing the nav means changing routes |
| The **project children** inside `nav` and `footerNav` | **SYSTEM / derived** | FR-CONT-11. `site.ts:41-49` and `:78-86` are the third and second hand-duplications of the project list, and `README.md:42`'s claim that they update automatically is **verified false**. Derive them on the **frontend at build time from `GET /api/v1/projects`** — which is why that endpoint must return **admin order**. **Not stored, not a field, and never becoming one** |
| `noindex` / `Disallow: /` | **STATIC / T3** | P-11 answers OQ-12: keep it in code. *"An accidental admin click de-indexing the site is a real risk."* The **removal at launch** is env-gated in `svfrontend` (`NEXT_PUBLIC_ALLOW_INDEXING`) and belongs on the pre-production checklist — where it currently appears **nowhere**, which makes it *"the single most consequential launch action in the audit with no checkbox anywhere"* (CONF-55). Both blocks must be lifted together: `robots.ts`'s `disallow: '/'` **and** `layout.tsx:53`'s `robots: { index: false }` |

### 11.3 Every Tier-2 item, resolved

`CONTENT-MANAGEMENT-MATRIX.md`'s Tier-2 statement, verbatim: *"Tier 2 (next): **Testimonials · FAQs · Statistics · Ticker · Site-wide specs/proximity · CTA · Logo · Master-plan PDF**."* Each one, resolved:

| Tier-2 item | Verdict | Justification against the Matrix |
|---|---|---|
| **Testimonials** | **COLLECTION** — `orderable: true`, drafts on, `trash: true` | Matrix §3 row 17 ADMIN/T2 → `testimonials`. Many documents, identical structure, an independent publish lifecycle, and a **per-document consent gate** — four reasons it cannot be an array in a global |
| **FAQs** | **COLLECTION** — `orderable: true`, drafts on, `trash: true` | Matrix §3 row 18 ADMIN/T2 → `faqs`. Rendered on **two** pages (`/` and `/contact`), ordered, independently publishable |
| **Statistics** | **COLLECTION** — `orderable: true`, drafts on, `trash: true` | Matrix §3 row 1 ADMIN/T2 → `statistics`, *"the dashboard statistics"*. Rendered on **two** pages (`/` and `/about`). `value` is **text and authored, never derived from row counts** (D-009) |
| **Hero ticker** | **ARRAY FIELD inside `site-settings`**, *not* the `ticker_items` collection the Matrix names | Matrix §3 row 2 names a table; the docs' own test overrules it — 5 rows, **one** consumer, no independent publish state, no per-item lifecycle, never queried alone. **This removes one documented table.** ⚠️ `Hero.tsx:83` writes `item.icon as IconName` — a type assertion, the only icon list not compile-time validated. **The DB enum is what actually protects it** |
| **Site-wide specs** (`amenities.specifications`, 7) | **DEFERRED — do not model yet** | Matrix §3 row 11 ADMIN/T2 → `site_features`; FR-CONT-08 is INFERRED/P2. It renders at `amenities/page.tsx:29` **and** feeds the homepage MediaSequence titles — but `/amenities` is a **footer-only legacy single-layout page**, and `amenities.hero.lead` hardcodes the word *"Seven"* against the array length. **Decide whether `/amenities`, `/master-plan` and `/location` are retired before investing in modelling them.** If built: an array in the global, not a collection |
| **Site-wide proximity** (11) | **DEFERRED / retire with the page** | Matrix §3 row 15 ADMIN/T2 → `site_proximity`, noting *"All 11 drive times are illustrative placeholders. Must be measured."* Worse: `Corridor.tsx:26` hard-slices to 8, so **items 9–11 render nowhere**, and reordering is exactly the edit that decides which three disappear. If ever built, the help text must say *"the first eight items appear on the homepage; items beyond the eighth are stored but not displayed"*, and the admin list should visually separate the first eight |
| **CTA banner** | **A named `group` inside `site-settings`** (Content tab) | Matrix §3 row 20 ADMIN/T2 → `site_settings`. One instance, site-wide, overridden per project. `{title, body}` — **distinct from `Project.cta`'s `{title, description}`.** `ProjectDetail.tsx:213-217` falls back to a **hardcoded literal**, not to this value, so they are genuinely independent |
| **Logo** | **An `upload → media` field on `site-settings`** | Matrix §5 row 11 ADMIN/T2. One asset, one owner, no lifecycle. FR-MEDIA-13. Counting its reference requires an **explicit query in `mediaDeleteGuard`**, not a join field — the Join Field documents `collection`, i.e. a collection slug, and this is a global |
| **Master-plan PDF** | **A `documents` COLLECTION** (upload), referenced from `site-settings` | Matrix §3 row 13 ADMIN/T2 → `media_assets`; FR-MEDIA-10. It is a **separate collection**, not a second role on `media`, because one upload collection cannot express two `mimeTypes` allow-lists and the validation genuinely differs (§5.7). **This resolves A2 contradiction C-7** — the site-scoped `document` role that had no table, no column and no endpoint anywhere |
| ~~`steps`~~ (home.steps, 5) | **DEFERRED** | Matrix §3 row 6 classes it **FUTURE**/T2, and `app/page.tsx:92` hardcodes *"Five steps"*. If built: an array in the global |
| ~~`page_content`~~ (about story / values / approvals) | **DEFERRED** | Matrix §3 rows 8–10 class them **FUTURE**/T2; `about.approvals.items` are legally sensitive and all bracketed |
| ~~`home.benefits`~~ | **DROP** | Matrix §3 row 7 — and the code says **zero consumers** |

**A cross-cutting note the corpus never writes down and which explains the mixed cases above:** ***Tier is build order. Priority is obligation. They are independent axes.*** A P0 requirement may sit in a T2 row (FR-CONT-01 is P0 and lands in a T1 screen containing T2 fields), and a T1 screen may contain T2 fields. `REQUIREMENTS.md`'s CONTENT section is titled *"CMS content (Tier 2)"* and contains a P0 — retitle it to *"CMS content"* and state the rule in identical words in both documents. Concretely: **FR-CONT-01's P0 half** (contact channels, legal links, `url`) lands in the phase that builds the Site Settings global, **not** in Phase 8 with the Tier-2 copy fields.

### 11.4 The testimonial consent gate — a `beforeValidate` hook, not a disabled button

```ts
// src/collections/Testimonials.ts
import { APIError } from 'payload'

hooks: {
  beforeValidate: [
    ({ data, originalDoc, operation }) => {
      const next = { ...originalDoc, ...data }
      const publishing = next._status === 'published'
      if (publishing && next.consented !== true) {
        // Emitted through the shared error translator as
        //   422 VALIDATION_ERROR, details[0] = { field: 'consented', code: 'CONSENT_REQUIRED', … }
        throw new APIError(
          'Publishing reviews that were not given by a real, consenting client is a fabricated record.',
          422,
        )
      }
      return data
    },
  ],
},
```
Plus **one of only two DB CHECK constraints retained under D-015**, added via `afterSchemaInit` (the other is the icon enum, which the `select` + `enumName` materialises as a Postgres enum type — a *stronger* guarantee than a CHECK).

**Why a hook and not the UI control the spec describes.** ADMIN-CMS-SPEC §8 originally said *"Publish is **disabled** until Consented is ticked"*, and its own architecture header overrides that: the gate *"**must be a `beforeValidate` hook, not merely a disabled button**"* (D-011). **The hook wins, and this is a contradiction resolved inside a single document.** A disabled button is defeated by the REST API, by a script, by a bulk edit, and by any future custom view. The content it protects is the worst possible thing to get wrong: the three testimonials that exist today are **invented placeholders with bracketed names**, and `pages.ts:10-12` calls publishing them *"a fabricated record."* Once an admin UI exists, publishing them as-is is the single easiest catastrophic mistake available. **Make it impossible, not discouraged.**

⚠️ **Payload throws its own error shape from a hook**, and no project document defines the mapping to our envelope. The same error handler that produces `requestId` must translate every `APIError` — otherwise the consent failure arrives at the admin UI in a shape the inline-error renderer does not understand, and the editor sees a generic failure instead of the sentence that explains why.

**Public exposure is doubly gated:** `GET /api/v1/testimonials` returns **published AND consented** only (FR-PUB-05) — the `where` clause carries both conditions, so even if a row were somehow published without consent, it would not reach the site.
## 12. Draft / Version / Audit Strategy

**Governing rule for this section:** *do not enable a feature merely because Payload supports it.* Every `versions` block below is written explicitly. Nothing inherits a Payload default — in particular, `maxPerDoc` defaults to **100** (B08 §1) and inheriting it silently on nine entities is how a 5-project brochure site ends up with a version table larger than its content tables.

### 12.1 Per-entity matrix

| Entity | Kind | `versions` | `drafts` | `maxPerDoc` / `max` | `autosave` | History + restore in admin | `trash` | One-line justification |
|---|---|---|---|---|---|---|---|---|
| `projects` | collection | **ON** | **ON** | `maxPerDoc: 20` | **OFF** | **Yes**, `readVersions` admin-only | **ON** | D-005 makes publish/unpublish first-class; approvals and title claims are legally sensitive so a 20-deep rollback trail has real value. |
| `media` | collection (upload) | **OFF** | — | — | — | No | **ON** | Versioning binary metadata buys nothing and duplicates every row per edit; Trash gives the 30-day grace the delete policy needs (OQ-17). |
| `documents` (T2) | collection (upload) | **OFF** | — | — | — | No | **ON** | Same reasoning as `media`. |
| `users` | collection (auth) | **OFF** | — | — | — | No | **OFF** (`delete: () => false`) | Versioning an auth collection multiplies credential-adjacent history for zero benefit; accounts are deactivated via `isActive`, never deleted (D-006 exception). |
| `leads` | collection | **OFF** | — | — | — | No | **ON** | B08 §1: versioning an operational/PII table *"multiplies PII copies"*. A lead has no editorial lifecycle. |
| `audit-log` | collection | **OFF** | — | — | — | No | **OFF** | Append-only by construction; a version table on an audit table is a second, prunable copy of the thing that must not be prunable. |
| `testimonials` (T2) | collection | **ON** | **ON** | `maxPerDoc: 10` | **OFF** | Yes, admin-only | **ON** | Drafts are the mechanism that keeps the three invented placeholder quotes unpublished (OQ-23); 10 is ample for 3 records. |
| `faqs` (T2) | collection | **ON** | **ON** | `maxPerDoc: 10` | **OFF** | Yes, admin-only | **ON** | Rendered on two pages; a bad edit is site-visible, rollback is cheap. |
| `statistics` (T2) | collection | **ON** | **ON** | `maxPerDoc: 10` | **OFF** | Yes, admin-only | **ON** | Values render in display type on `/` and `/about`; same reasoning. Note A2 defect D-10 omits `deleted_at` here — use `trash: true` anyway, consistently. |
| `site-settings` | **global** | **ON** | **OFF** | **`max: 50`** | **OFF** | Yes, admin-only | n/a (globals cannot be deleted) | A fat-fingered phone number is a site-wide outage of the primary conversion path; version history gives instant rollback. Drafts are **off deliberately** — a draft/published split on site settings creates a *"why isn't my new phone number live?"* failure mode. |
| `payload-jobs` | Payload-internal | n/a | n/a | n/a | n/a | read-only list via `jobsCollectionOverrides` | n/a | Not ours to configure beyond access. |

⚠️ **The key asymmetry:** collections use **`maxPerDoc`**, globals use **`max`** (B08 §8). Writing `maxPerDoc` on a global is silently ignored. This is the single most likely typo in this section.

### 12.2 Exact config blocks

```ts
// src/collections/Projects.ts
versions: {
  maxPerDoc: 20,                 // explicit — NOT the default 100
  drafts: {
    autosave: false,             // see 12.3
    validate: false,             // default; deliberate — see 12.4
    schedulePublish: false,      // no requirement asks for it; enabling it without a
                                 // runner means it silently never fires (B08 §7)
  },
},
trash: true,
```

```ts
// src/globals/SiteSettings.ts
versions: { max: 50, drafts: false },   // `max`, NOT `maxPerDoc`
```

```ts
// src/collections/Leads.ts, Media.ts, Documents.ts, Users.ts, AuditLog.ts
// NO `versions` key at all. Absence is the decision; do not write `versions: false`
// and do not write `versions: {}`.
```

### 12.3 `autosave: false` — the reason, stated once

The documented default interval is **800 ms** (B08 §5) and *every* autosave is a real Postgres write that fires *every* `afterChange` hook. Our audit hook is an `afterChange` hook. Autosave at 800 ms would flood `audit-log` and defeat FR-AUDIT-01. Compounding it: **the hook-argument property that identifies an autosave write is NOT VERIFIED IN OFFICIAL DOCS** (B08 §5, §10), so the guard cannot even be written correctly today.

**Decision: ship with `autosave: false`.** Revisit only after the autosave signal has been established empirically and the audit guard proven.

### 12.4 `validate: false` on drafts — the reason, stated once

Payload's default is `false` (B08 §1); `VALIDATION-RULES.md` pushes for `true`. We keep **`false`**, against that push, for one concrete reason: `projects` has 8 required fields including a required `image` upload, and none of them can be filled on day one of a new project. `ADMIN-CMS-SPEC.md`'s preamble demands that *"I don't have this information"* be an easy choice.

**The rule: drafts are scratch; publish is validated.** Publishing runs the `draft: false` path with full validation, which is where completeness belongs. This is also what makes the Phase-1 seed possible without uploading media (§17.4).

### 12.5 `readVersions` — the seventh access function nobody writes

`readVersions` is one of seven collection access functions (`create`, `read`, `update`, `delete`, `admin`, `unlock`, `readVersions`). **Its default when omitted is NOT VERIFIED IN OFFICIAL DOCS**; the framework-wide default is `({ req: { user } }) => Boolean(user)` — i.e. any authenticated user. Version records are a second copy of **every historical value of every DTCP/RERA approval claim ever entered**, and `GET /api/{collection}/versions` exists on the generated REST surface.

Write it explicitly on every versioned collection:

```ts
access: {
  read:         publishedOrAuthenticated,
  readVersions: isAdmin,      // never omit — CONF-36
  create:       isAdmin,
  update:       isAdmin,
  delete:       isAdmin,
}
```

A Phase-3 config test must enumerate every collection and global and fail if any access key — including `readVersions` on versioned collections — is missing.

### 12.6 Do Payload versions satisfy the AUDIT requirement? **No.**

`IMPLEMENTATION-DECISION.md` §7 and §10 rate `audit_log` as *"🟡 Hooks write entries; Payload's version history covers part of it."* **That wording is the actual hazard** — a future session will read it and trust it. It must be downgraded.

The documented version-document shape is exactly: `_id`, `parent`, `autosave`, `version`, `createdAt`, `updatedAt` (B08 §10). Measured against `SECURITY.md` §13:

| FR-AUDIT / SECURITY §13 requirement | Payload versions |
|---|---|
| Actor (which admin) | ❌ not stored — no `createdBy`, no `user` |
| IP address | ❌ not stored |
| Action type (`create`/`update`/`publish`/`unpublish`/`delete`/`restore`) | ❌ must be inferred from `_status` deltas |
| Auth events (login, logout, failed login, lockout, password change) | ❌ produce **no version at all** |
| Before/after for sensitive fields | 🟡 derivable by reconstruction only, not queryable |
| **Append-only** | ❌ **violated** — `maxPerDoc` discards, `restoreVersion` mutates |
| Unified, filterable log across entities | ❌ versions are per-collection |

**A dedicated `audit-log` collection plus hooks is required.** Versions contribute before/after reconstruction only.

### 12.7 The audit design — exact

**Collection** (`src/collections/AuditLog.ts`), append-only by access control:

```ts
export const AuditLog: CollectionConfig = {
  slug: 'audit-log',
  admin: { group: 'System', defaultColumns: ['createdAt','action','entityType','entityId','adminUser'],
           defaultSort: '-createdAt', hidden: false },
  access: {
    read:   isAdmin,
    create: () => false,   // hooks are the only writer, via overrideAccess
    update: () => false,   // FR-AUDIT-03: never writable
    delete: () => false,
  },
  // NO versions. NO trash.
  fields: [
    { name: 'adminUser',  type: 'relationship', relationTo: 'users' },   // nullable: system actions have no actor
    { name: 'action',     type: 'select', required: true, enumName: 'enum_audit_action',
      options: ['create','update','publish','unpublish','delete','restore',
                'login','logout','login_failed','lockout','password_change'] },  // 11, not 7 — A2 defect C-9
    { name: 'entityType', type: 'text', required: true, index: true },
    { name: 'entityId',   type: 'text', required: true, index: true },
    { name: 'changes',    type: 'json' },      // before/after for sensitive fields ONLY
    { name: 'ipAddress',  type: 'text' },
  ],
}
```

**The shared hook** (`src/hooks/audit.ts`), attached to **collections, not endpoints**:

```ts
export const auditAfterChange: CollectionAfterChangeHook = async ({
  req, doc, previousDoc, operation, collection, context,
}) => {
  if (context?.skipAudit) return
  // ⚠️ autosave guard: the hook-side autosave signal is NOT VERIFIED IN OFFICIAL DOCS.
  // Safe today only because autosave is OFF (§12.3). Establish the signal before enabling it.
  await req.payload.create({
    collection: 'audit-log',
    overrideAccess: true,          // create: () => false blocks REST/GraphQL/admin, not us
    req,                           // same transaction as the mutation it records
    data: {
      adminUser:  req.user?.id ?? null,
      action:     deriveAction(operation, previousDoc, doc),   // create|update|publish|unpublish
      entityType: collection.slug,
      entityId:   String(doc.id),
      changes:    diffSensitiveFields(previousDoc, doc),
      ipAddress:  req.headers.get('x-forwarded-for') ?? null,
    },
  })
}
```

`diffSensitiveFields` is an allow-list, not a whole-document diff. Per `SECURITY.md` §13 it covers: `approvals[]`, `area`, `proximity[]`, `name`, `slug`, `category`, `projectStatus`, `locality`, `developer` — *"anything title-related"*. It must **never** capture lead PII.

**Attached to:** `projects`, `testimonials`, `faqs`, `statistics`, `media`, `documents`, `leads` (update/delete only — creation is public and is its own record), `site-settings`. Also `afterDelete` (Trash soft-delete fires this) and the auth hooks `afterLogin` / `afterLogout` / `afterForgotPassword`, plus a wrapper around `restoreVersion` for the `restore` action.

**Two rules that follow, both load-bearing:**

1. **Hooks live on collections, never on custom endpoints.** The Payload admin publishes through its own `PublishButton` → an ordinary `update`. It will never call `POST /admin/projects/{id}/publish`. Realistically **100% of real publishes go through the path that bypasses endpoints** (B08 §4, R-14). Endpoint-based audit would produce a log with a hole exactly where the legally sensitive edits are.
2. **`overrideAccess` defaults to `true` in the Local API**, so `create: () => false` does *not* stop careless code in our own repo writing audit rows. It blocks REST, GraphQL and the Admin UI — the threat model that matters — but it is not a hard guarantee. A code-review rule covers the rest.

### 12.8 The Postgres version-table growth consequence — stated plainly

Enabling `versions` on `projects` does not add one table. It adds a versioned counterpart of **the collection table, its `_rels` table, and every one of its child tables**:

```
projects            → projects_v
projects_rels       → projects_v_rels
proj_stats          → (versioned counterpart)
proj_highlights     → (versioned counterpart)
proj_amenities      → (versioned counterpart)
proj_approvals      → (versioned counterpart)
proj_loc_hl         → (versioned counterpart)
proj_proximity      → (versioned counterpart)
description storage → (versioned counterpart, if it is a child table — NOT VERIFIED)
```

**≈ 9–10 additional physical tables for one collection.** Across the nine entities the realistic physical table count is **40–60**, against `AI-CONTEXT.md` line 110's rule *"15 core tables … Do not add tables without a traceable requirement."*

**That rule must be amended to: "15 core *logical entities*; Payload-generated `_rels`, `_v`, `_locales` and array tables are exempt."** Left unamended, the next session opens the database, counts fifty tables, and concludes something has gone badly wrong.

Three further facts that size the database and are **NOT VERIFIED IN OFFICIAL DOCS** (B08 §9):

- **What actually prunes versions when `maxPerDoc` is exceeded** — synchronous on write, batched, or background. Never stated. Must be measured (T-197) before sizing the DB. If it does not prune retroactively when `maxPerDoc` is lowered, a scheduled pruning task is required.
- **Whether `_status` is indexed.** It is the predicate on every public read. Add `index: true` via a field override or a hand-written migration rather than assuming.
- **Whether enabling versions on an already-populated collection needs a bespoke data migration.** Enable versions from migration 001 so the question never arises.

---

## 13. Jobs / Background Work

### 13.1 Where the Jobs Queue IS used

| Task slug | Trigger | Queue | Why it must be a job |
|---|---|---|---|
| `sendLeadNotification` | `afterChange` (create) on `leads` | `default` | FR-LEAD-06: a failed send must never fail the public request. The Payload docs answer this question by name — *"If the email service is temporarily down, the hook would fail and potentially block the user creation. Jobs can retry automatically."* (B09 §12) |
| `revalidatePaths` | **retry path only** — enqueued when the direct revalidation fetch fails | `default` | A2 §6.6 requires revalidation to be *"fire-and-forget with retry"*. The direct attempt gives immediacy; the job gives the retry. |
| `sweepDeletedMedia` | cron, daily | `maintenance` | Deleting an S3 object after the OQ-17 grace period is by definition deferred work. |
| `purgeLeadPii` | cron, daily | `maintenance` | FR-LEAD-16 / DPDP: purge `ipAddress` + `userAgent` at ~90 days. |
| `watchdogFailedJobs` | cron, every 15 min | `maintenance` | Payload ships **no dead-letter queue and no alerting** (B09 §3). "It's in the database" is not monitoring. |

### 13.2 Where the Jobs Queue is deliberately NOT used

| Not a job | Why |
|---|---|
| **The first revalidation attempt** | The entire value of on-demand ISR revalidation is that an editor's publish appears within seconds. The bin-script runner's floor is one cron tick (`--cron "* * * * *"` ⇒ up to ~60 s, B09 §12 limitation 1). Direct `fetch` first, job only on failure. |
| **Image processing (`sharp` resize, EXIF strip, dimension read)** | Runs synchronously inside the upload request. Volume is tens of images over the product's life; a queue adds a second failure surface and a "where is my thumbnail?" support class for zero benefit. |
| **Sending the lead email inline in the hook** | Explicitly rejected — see 13.1. |
| **Seeding** | A `payload run` script, not a job (§17). |
| **Scheduled publishing (`schedulePublish`)** | **No requirement in `REQUIREMENTS.md` asks for it.** Enabling it without a proven runner means an editor schedules a launch and it silently never fires (B08 §7). Off. |
| **Search indexing, cache warming, sitemap generation** | None exist. ISR is the cache; `sitemap.xml` is a Next.js metadata route. |

### 13.3 Task definitions — exact

```ts
// src/jobs/sendLeadNotification.ts
import type { TaskConfig } from 'payload'
import { JobCancelledError } from 'payload'

export const sendLeadNotification: TaskConfig<'sendLeadNotification'> = {
  slug: 'sendLeadNotification',
  label: 'Send lead notification',
  retries: 3,                                   // B09 §3: a plain count is ALL the docs support
  inputSchema:  [{ name: 'leadId', type: 'text', required: true }],
  outputSchema: [{ name: 'emailSent', type: 'checkbox', required: true }],
  handler: async ({ input, req }) => {
    const to = process.env.SALES_NOTIFICATION_EMAIL
    if (!to) throw new JobCancelledError('SALES_NOTIFICATION_EMAIL is unset — retrying cannot help')

    const lead = await req.payload.findByID({
      collection: 'leads', id: input.leadId, overrideAccess: true, depth: 0,
    })
    if (!lead) throw new JobCancelledError(`Lead ${input.leadId} no longer exists`)
    if (lead.notifiedAt) return { output: { emailSent: true } }   // idempotency short-circuit

    let result: unknown
    try {
      result = await req.payload.sendEmail({
        to,
        subject: `New enquiry — ${lead.projectNameSnapshot ?? 'general'}`,
        html: renderLeadEmail(lead),      // OUR renderer; HTML-escapes every lead field
        text: renderLeadEmailText(lead),  // plaintext alternate
      })
    } catch (err) {
      throw new Error(`Lead notification send failed for ${input.leadId}: ${(err as Error).message}`)
    }
    // ⚠️ Whether sendEmail throws or resolves on transport failure is NOT VERIFIED IN
    // OFFICIAL DOCS (B09 §10). This assertion covers the "resolved but did nothing" case,
    // which is exactly what happens when no email adapter is configured.
    if (!result) throw new Error(`Lead notification produced no provider result for ${input.leadId}`)

    await req.payload.update({
      collection: 'leads', id: input.leadId, overrideAccess: true,
      data: { notifiedAt: new Date().toISOString() },
      context: { skipAudit: true },
    })
    return { output: { emailSent: true } }
  },
}
```

| Task | `inputSchema` | Handler responsibility | `retries` | Backoff | `onFail` |
|---|---|---|---|---|---|
| `sendLeadNotification` | `{ leadId: text }` — **an id, never the object**; the docs' own rule (B09 §2) | fetch lead → render + escape → send → assert a provider result → stamp `notifiedAt` | `3` (docs' own guidance for external APIs) | **None documented.** Hand-rolled: `watchdogFailedJobs` re-queues with `waitUntil = now + 15 min`, max 2 re-queues | ⚠️ `onFail`/`onSuccess` are **listed in the options table with no signature, no arguments and no example anywhere** (B09 §2). **Do not use them.** Failure handling lives in the watchdog. |
| `revalidatePaths` | `{ paths: text hasMany }` | POST to `REVALIDATE_WEBHOOK_URL` with `REVALIDATE_SECRET`; non-2xx → throw | `5` | same hand-rolled re-queue | not used |
| `sweepDeletedMedia` | none | find `media`/`documents` with `deletedAt < now-30d` → **re-check attachment via the `join` fields** → delete S3 object → hard-delete the row | `2` | n/a | not used |
| `purgeLeadPii` | none | `updateMany` leads with `createdAt < now-90d` → null `ipAddress`, `userAgent` | `2` | n/a | not used |
| `watchdogFailedJobs` | none | query `payload-jobs` for `hasError: true`, `processing: true` aged, `completedAt: null` aged → alert on a **second channel** → re-queue transient failures | `1` | n/a | not used |

**Idempotency is mandatory on every task.** The docs warn verbatim: *"Tasks should be idempotent when possible … retries might cause the task to run more than once."* `sendLeadNotification` is made idempotent by the `notifiedAt` marker; without it, three retries during a provider blip send the sales team three copies of the same lead.

**`JobCancelledError` for poison input.** A missing recipient address or a deleted lead can never succeed; throwing `JobCancelledError` stops retrying immediately instead of burning three attempts and hiding the real failure behind `totalTried: 3`.

### 13.4 Queue design

Two queues, no more:

| Queue | Contents | Runner cadence | Rationale |
|---|---|---|---|
| `default` | `sendLeadNotification`, `revalidatePaths` | every minute, `--limit 25` | Latency-sensitive. Lead volume is tens per month; 25 per tick is an enormous headroom. |
| `maintenance` | `sweepDeletedMedia`, `purgeLeadPii`, `watchdogFailedJobs` | every 15 minutes, `--handle-schedules` | Scheduled work must not sit behind, or delay, a lead notification. |

```ts
// payload.config.ts
jobs: {
  tasks: [sendLeadNotification, revalidatePaths, sweepDeletedMedia, purgeLeadPii, watchdogFailedJobs],
  processingOrder: 'createdAt',            // FIFO — the oldest lead is notified first
  access: {
    run: ({ req }) => {
      if (req.user) return true
      const secret = process.env.CRON_SECRET
      if (!secret) return false
      return req.headers.get('authorization') === `Bearer ${secret}`
    },
  },
  jobsCollectionOverrides: ({ defaultJobsCollection }) => ({
    ...defaultJobsCollection,
    access: { ...defaultJobsCollection.access, read: ({ req }) => Boolean(req.user) },
    admin: { ...defaultJobsCollection.admin, hidden: false, group: 'System' },
  }),
}
```

**Do not set `jobs.deleteJobOnComplete`, `jobs.depth` or `jobs.runHooks`.** All three names appear **nowhere** in the live 3.x docs (B09 §1); `depth`/`runHooks` are evidenced only by the **v4** migration guide's removal notice. Accept the defaults. We *want* retention — a successfully sent lead notification is an operational record. If `payload-jobs` growth ever matters, add our own cleanup task rather than relying on an undocumented flag.

**Do not set `jobs.enableConcurrencyControl`.** It is a v3-only flag that *"adds an indexed `concurrencyKey` field to your jobs collection schema and may require a database migration"*. We have one meaningful task at a volume of tens per month.

### 13.5 The runner — concrete, per environment

**Local development.** **Do not use `autoRun`.** The docs record a concrete dev-only failure: *"Jobs work initially but stop running after you make code changes in development. Diagnosis: Hot Module Reload (HMR) in Next.js disrupts cron schedules. This is expected behavior in development."* A developer who relies on `autoRun` will see notifications stop after the first file save and will lose hours to it.

```jsonc
// package.json
"jobs:run":  "cross-env NODE_OPTIONS=--no-deprecation payload jobs:run --queue default --limit 25",
"jobs:loop": "cross-env NODE_OPTIONS=--no-deprecation payload jobs:run --cron \"* * * * *\" --queue default --limit 25"
```

Run `npm run jobs:run` on demand. In tests, never wait on wall-clock cron — use the documented deterministic pattern:

```ts
const job = await payload.jobs.queue({ task: 'sendLeadNotification', input: { leadId } })
await payload.jobs.runByID({ id: job.id })
```

**Production.** The bin script as a **separate container/process** — the docs' own top recommendation for a dedicated server (*"Separate process: Runs completely independently from your Next.js server, preventing any impact on API response times"*), and exactly the deployment shape D-015 chose.

```yaml
services:
  cms:
    command: node server.js
  worker-default:
    command: npx payload jobs:run --cron "* * * * *" --queue default --limit 25
    restart: unless-stopped
    depends_on: [postgres]
  worker-maintenance:
    command: npx payload jobs:run --cron "*/15 * * * *" --queue maintenance --handle-schedules
    restart: unless-stopped
    depends_on: [postgres]
```

⚠️ **Every CLI example in the official docs is written `pnpm payload …`. The npm/npx equivalents are NOT VERIFIED IN OFFICIAL DOCS** (B09 §4). `npx payload jobs:run` is the obvious translation and must be verified once, in Phase 2, and written down.

⚠️ **Exactly one process may handle schedules.** The docs call out both footguns by name: *"Using both the `handle-schedules` bin script AND `autoRun` for the same queue, causing duplicate jobs to be queued … Choose ONE approach"* and *"If multiple servers are handling schedules, they might each queue jobs. Solution: Only enable schedule handling on one server."* `--handle-schedules` appears on `worker-maintenance` and nowhere else, and `worker-maintenance` never scales beyond one replica.

**Fallback if a second container is refused on cost:** `jobs.autoRun: [{ cron: '* * * * *', queue: 'default', limit: 25 }]` inside the CMS process, gated by `shouldAutoRun: async () => process.env.ENABLE_JOB_WORKERS === 'true'` so only one instance ever runs jobs. This is the docs' own "Environment-Based Execution" pattern. It is second choice because it puts job execution on the request-serving process.

### 13.6 Failure handling, poison messages, monitoring

**The enqueue itself must not be able to fail the public request:**

```ts
// src/collections/Leads.ts
hooks: {
  afterChange: [async ({ req, doc, operation }) => {
    if (operation !== 'create') return
    try {
      await req.payload.jobs.queue({
        task: 'sendLeadNotification', input: { leadId: doc.id }, queue: 'default',
      })
    } catch (err) {
      req.payload.logger.error({ err, leadId: doc.id }, 'Failed to enqueue lead notification')
    }
  }],
}
```

The `try/catch` is what keeps FR-LEAD-06 true. Note the ordering guarantee this design leans on: `afterChange` runs **after** the lead row is written, so *"persist first, enqueue second"* (A2 §6.2) is structurally guaranteed rather than remembered.

⚠️ **The documented async-hook footgun applies precisely here** (B02 §6): *"an async call made with the same `req`, but NOT awaited, may fail resulting in an OK response being returned with response data that is not committed."* The enqueue above **is** awaited and **does** carry `req`, so it shares the transaction — that is correct and deliberate. Any non-awaited call must **not** receive `req`.

**Triage signals** (the docs' own checklist): `processing: true` but stuck → the worker crashed. `hasError: true` → read `error` and `log`. `completedAt: null` and aged → never picked up, i.e. the runner is dead.

**Poison vs transient.** A poison message (missing recipient, deleted lead) throws `JobCancelledError` and stops immediately. A transient failure (SMTP outage) exhausts `retries: 3` and lands in `hasError: true` — with **no dead-letter queue and no documented backoff**, three fast retries can burn through a 20-minute provider outage and lose the notification with nothing but a database row to show for it. That is exactly what `watchdogFailedJobs` exists to catch: it re-queues with `waitUntil` set 15 minutes out, at most twice, then alerts.

**Monitoring.** `watchdogFailedJobs` alerts on a **second channel** — not email, because the failure mode being detected is *email is broken*. Metrics to export: queue depth, oldest-pending-job age, failed-job count, worker liveness. Killing the worker must raise an alert within one monitoring interval (Phase 5 exit criterion 12).

**How an admin sees a failed job.** `jobsCollectionOverrides` makes `payload-jobs` visible and **read-only** in the admin (`read` re-opened to authenticated users; create/update/delete stay denied, as the docs advise: *"Enabling raw collection access can expose job data and execution-control fields. Prefer read-only access for trusted administrators"*). Columns: `taskSlug`, `createdAt`, `completedAt`, `hasError`, `totalTried`, `error`. There is **no built-in retry button** — a manual re-queue is a small authenticated custom endpoint calling `payload.jobs.runByID({ id })`, surfaced as a `listMenuItems` action. That endpoint is IMPORTANT, not CRITICAL; until it exists, re-queue from a shell.

---

## 14. Email / Notifications

### 14.1 Adapter decision

**`@payloadcms/email-nodemailer`, exporting `nodemailerAdapter`.** Pinned to the identical version as `payload` and every other `@payloadcms/*` package.

Reason, in one line: the docs' own tie-breaker is that `@payloadcms/email-resend` is *"preferred for serverless platforms such as Vercel because it is much more lightweight"* — we are a long-running self-hosted container, not serverless — and `nodemailerAdapter` speaks *"any Nodemailer transport, including SMTP, Resend, SendGrid, and more"*, which turns the unresolved provider question into an environment-variable change rather than a code change.

```bash
npm i @payloadcms/email-nodemailer@<exact same version as payload>
```

### 14.2 Config block

```ts
// payload.config.ts
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'

email: nodemailerAdapter(
  env.NODE_ENV === 'production'
    ? {
        defaultFromAddress: env.EMAIL_FROM_ADDRESS,   // e.g. no-reply@<sending-domain>
        defaultFromName:    env.EMAIL_FROM_NAME,      // e.g. 'SV Developers'
        transportOptions: {
          host:   env.SMTP_HOST,
          port:   env.SMTP_PORT,          // 587 STARTTLS, or 465 with secure: true
          secure: env.SMTP_SECURE,        // see the docs' own caveat below
          auth:   { user: env.SMTP_USER, pass: env.SMTP_PASS },
        },
      }
    : undefined,     // no args ⇒ ethereal.email; credentials printed to console on startup
),
```

`defaultFromName` and `defaultFromAddress` are the two options the docs mark **required on every adapter**. `secure` carries a documented pointer rather than a rule — *"See the Nodemailer SMTP documentation … including details on when `secure` should and should not be set to `true`"* — so it is an env var, not a hardcoded value.

**From-address / from-name.** `EMAIL_FROM_ADDRESS` must be on a domain whose SPF, DKIM and DMARC records the owner controls. `EMAIL_FROM_NAME` is the display name. Both are env-driven so staging and production can differ. Payload supports *"a single transporter of email"* per instance — one From identity; a marketing/transactional split would have to be hand-wired and is out of scope.

### 14.3 Templates approach

**Payload ships no templating engine.** Verbatim: *"Payload doesn't ship with an HTML templating engine, so you are free to choose your own."*

**Decision: no templating library. One hand-written function, `src/email/renderBrandedEmail.ts`,** producing a table-based HTML layout with inline styles and a matching plaintext alternate. Reason: we have two email bodies, both fewer than twenty lines; a template engine, a CSS inliner and a build step would be more moving parts than the thing they render.

```ts
// src/email/escapeHtml.ts — ONE reviewed, tested helper
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// src/email/renderLeadEmail.ts
export const renderLeadEmail = (lead: Lead): string => renderBrandedEmail({
  heading: 'New enquiry',
  rows: [
    ['Name',    escapeHtml(lead.name)],
    ['Phone',   escapeHtml(lead.phone)],
    ['Project', escapeHtml(lead.projectNameSnapshot ?? '— no preference —')],
    ['Message', escapeHtml(lead.message ?? '')],
    ['Source',  escapeHtml(lead.source)],
    ['Page',    escapeHtml(lead.sourcePath ?? '')],
    ['Received', new Date(lead.createdAt).toISOString()],
  ],
})
```

**Every attacker-controlled field is escaped.** `name` and `message` are public free text going straight into an HTML email read by SV staff. Payload provides zero escaping (B09 §9). This is a reviewed, unit-tested helper, not an inline `.replace()` at the call site.

### 14.4 What emails exist

| Email | Trigger | Recipient | Content |
|---|---|---|---|
| **Lead notification** | `sendLeadNotification` job | `SALES_NOTIFICATION_EMAIL` | name, phone, project, message, timestamp, source — the exact list A2 §6.2 mandates |
| **Admin password reset** | Payload's built-in `forgotPassword` flow | the admin requesting it | branded via `generateEmailHTML` / `generateEmailSubject`; links to Payload's **built-in** reset page at `${serverURL}/admin/reset/${token}` |

**On password reset:** this is enabled per §10's auth decision. The reason it is enabled rather than removed is that under Payload it is something we would have to *remove* — forgot-password, reset-password and the reset page all ship on by default (C4 OQ-8), and keeping them directly mitigates R-39 (a sole admin locked out by `maxLoginAttempts` with no self-service recovery). `forgotPassword.minRequestInterval` defaults to 15 000 ms and is a free anti-abuse throttle. **If §10 disables the flow, delete this row and the config block below.**

```ts
// src/collections/Users.ts
auth: {
  forgotPassword: {
    generateEmailSubject: () => 'Reset your SV Developers admin password',
    generateEmailHTML: ({ token }) => renderBrandedEmail({
      heading: 'Reset your password',
      bodyHtml: `<p><a href="${process.env.NEXT_PUBLIC_SERVER_URL}/admin/reset/${token}">Reset password</a></p>`,
    }),
    // minRequestInterval defaults to 15000 ms — leave it
  },
},
```

**No autoresponder to the buyer.** OQ-20's documented default is "no"; it is a marketing message to someone who gave a phone number and it changes the DPDP purpose-limitation position against `formNote`'s promise *"We will only use your number to talk to you about this project."* Adding it later converts the single Task into a Workflow — mechanical, per B09 §11.

### 14.5 Failure handling and retries

| Failure | Behaviour |
|---|---|
| SMTP transport error | Task throws → job retries (3) → `hasError: true` → `watchdogFailedJobs` re-queues with `waitUntil`, then alerts |
| `sendEmail` resolves without sending | Caught by the `if (!result) throw` assertion. **This exists because whether `sendEmail` throws or resolves on transport failure is NOT VERIFIED IN OFFICIAL DOCS** (B09 §10) — if it swallows, the retry count is decorative and `hasError` never becomes true |
| No email adapter configured | **Payload logs a warning; it is not documented to throw.** The task would resolve and report `emailSent: true` having sent nothing (B09 §8). Closed by the boot guard below |
| Enqueue fails (DB down) | Logged, request still returns `201` — but if the DB is down the lead was not saved either |
| Provider outage > retry window | Lead is persisted. Sales reads it from the admin and calls manually. **That is the entire point of persisting first** |
| Recipient unset | `JobCancelledError` — retrying cannot help |

**The boot guard is non-negotiable and belongs in Phase 2, not Phase 5:**

```ts
// src/lib/env.ts (see §22)
if (env.NODE_ENV === 'production') {
  if (!env.SMTP_HOST) throw new Error('SMTP_HOST is required in production — refusing to boot without an email adapter')
  if (!env.SALES_NOTIFICATION_EMAIL) throw new Error('SALES_NOTIFICATION_EMAIL is required in production — refusing to boot with nobody to notify')
}
```

For a lead-generation product, *reporting success while sending nothing* is the only truly unacceptable failure mode. The guard costs four lines.

### 14.6 The unresolved owner decision, stated plainly

**OQ-7b — the email provider is NOT decided.** The exact decision required is: **which provider account, which sending domain, and who configures SPF/DKIM/DMARC for it.** Candidates on record: Resend, AWS SES, Postmark, SendGrid — all four offer SMTP, so all four work behind `nodemailerAdapter` with no code change.

This is **BLOCKING PRODUCTION, not blocking implementation**. Deliverability is entirely outside Payload, and a lead notification that lands in spam is indistinguishable from a lost lead.

**The safe default that lets development proceed:** in dev and staging, call `nodemailerAdapter()` with **no arguments**. The docs state: *"During development, if you pass nothing to `nodemailerAdapter`, it will use the ethereal.email service. This will log the ethereal.email details to console on startup."* Mail is captured, viewable at a printed URL, and **never delivered to a real inbox** — which is simultaneously the documented satisfier of the standing rule *"Staging must not send real notifications"* (PRD §11), at zero custom code.

**What the mock adapter does when none is configured:** there is **no Payload mock/console adapter export** — no `MockEmailAdapter`, nothing named anywhere (B09 §8, §14 item 9). With no adapter at all Payload logs a warning on startup and again on every send attempt, and the send silently appears to succeed. That is the failure the boot guard exists to prevent; do not rely on the warning.

### 14.7 Env vars introduced by this section

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `SALES_NOTIFICATION_EMAIL`. Full table in §22.

---

## 15. Security

**Threat framing, carried forward from `SECURITY.md`:** *"the admin backend controls what a public website says about legally regulated matters — DTCP/RERA approval claims, clear-title assertions, land extents, proximity claims. A compromise is not just defacement; it is publishing false regulatory claims under the company's name."* Second surface: **one public, unauthenticated write** (`POST /api/v1/leads`) storing **PII** under India's DPDP Act.

**The single most important correction in this section:** `ARCHITECTURE.md` §1's model — *"The `/admin` path prefix is the security boundary. One middleware guards everything beneath it"* — **does not exist under Payload.** There is no one middleware. Authorization lives in per-collection access-control functions; audit and business rules live in hooks; route handlers exist only for the public surface. Any plan that assumes a single choke point will leave gaps.

### 15.1 The requirement table

| # | Control | Requirement (source) | Mechanism | Native / Custom | Verification test |
|---|---|---|---|---|---|
| 1 | **Admin authentication** | FR-AUTH-01..09; only authorised administrators | `users` collection with `auth: true`; `useSessions: true` (**never `false`** — *"Stateless JWTs cannot be revoked"*); `tokenExpiration: 7200`; `admin.user: 'users'` | **Native** | Unauthenticated `GET /admin` redirects to login; `GET /api/users/me` returns no user |
| 2 | **Password storage** | FR-AUTH-04 mandates argon2id — **unachievable** | Payload's KDF is `pbkdf2-sha256-v1:<derived-key>` with a per-user salt. The `auth` config has 13 options and **none concerns hashing**. `disableLocalStrategy` would forfeit login, reset, unlock, lockout **and the session machinery D-004 depends on** | **Native, not configurable** | A `users` row shows a `pbkdf2-sha256-v1:` prefix; `salt`/`hash` never appear in any API read |
| 2a | **Amend the requirement** | `SECURITY.md` is client-facing and currently states a falsehood | Rewrite FR-AUTH-04, `SECURITY.md` §1 and `TRACEABILITY.md` §5 to: *"Passwords are never stored in reversible form. A per-user salt and a PBKDF2-SHA256 derived key are stored, and `salt`/`hash` are stripped from every read. Never MD5/SHA-1/plaintext."* | **Doc change** | Grep `svbackend/docs/` for `argon2` → zero hits |
| 3 | **Password policy** | ≥12 chars, breach-checked (NIST SP 800-63B: no forced rotation, no composition rules) | Redefine the injected `password` field with a `validate` plus a breach-list check | **Custom** | An 11-char password → 422; a top-1000 breached password → 422. ⚠️ **Attaching `validate` to the injected password field is not shown in the docs — verify it actually attaches** (T-061) |
| 4 | **Brute force** | FR-AUTH-08; 5 attempts / 15 min | `auth.maxLoginAttempts: 5`, `auth.lockTime: 900000` | **Native** | 5 failures lock the account; identical failure message for unknown email, wrong password and locked account; unlock after `lockTime` |
| 4a | **Lockout DoS** | R-39 — lockout is **per account, not per IP** | **Two admin accounts in every environment from day one**; `access.unlock: isAdmin` so one admin can release the other | **Process** | Every environment has ≥2 active admin users |
| 5 | **Session revocation** | D-004's revocation intent; FR-AUTH-06 | Documented and satisfied: a password change ends the user's **other** sessions; an **admin** changing another user's password ends **all** of theirs; `resetPassword` ends all; `logout({ allSessions: true })` | **Native** | Log in twice, change the password from session A, assert session B's cookie is rejected. ⚠️ Documented gotcha: *"A Local API update that runs without an authenticated user … ends all of the user's sessions. Pass the `user` returned by `payload.auth`"* |
| 6 | **Cookie security** | `SECURITY.md` §2 | `auth.cookies: { secure: NODE_ENV === 'production', sameSite: 'Lax' }`; httpOnly is inherent — *"cannot be read by JavaScript in the browser"*; `cookiePrefix: 'sv'` | **Native** | Production `Set-Cookie` shows `HttpOnly; Secure; SameSite=Lax; Path=/` |
| 6a | **Keep `SameSite=Lax` viable** | R-34 | **Deploy the CMS on a subdomain of the public site's registrable domain** (`cms.<domain>` beside `www.<domain>`). An unrelated host forces `SameSite=None`, removing the browser's own CSRF defence and making the `csrf` allow-list load-bearing | **Infrastructure** | Admin login succeeds in a real browser in production, not only in curl |
| 7 | **HTTPS / HSTS** | `SECURITY.md` §14; TLS 1.2+ | TLS terminates at the reverse proxy; HTTP→HTTPS redirect; HSTS with a long `max-age`. `secure: true` **cannot** work over `http://localhost`, hence the env-conditional in row 6 | **Infrastructure** | `curl -I http://cms.<domain>` → 301; the response carries `Strict-Transport-Security` |
| 8 | **CORS** | `SECURITY.md` §5 — *"Never `*`"* | `cors: { origins: env.CORS_ORIGINS, headers: [] }` at the root. **Exactly two origins**: the public site and the admin origin | **Native** | A request from an unlisted origin receives no `Access-Control-Allow-Origin` |
| 8a | **CORS on custom endpoints** | R-35 | ⚠️ **Custom endpoints get no CORS for free**: *"By default, custom endpoints don't handle CORS headers in responses."* Every handler returns `headers: headersWithCors({ headers: new Headers(), req })`, enforced by the shared `definePublicEndpoint()` wrapper | **Custom** | Fetch `/api/v1/projects` **from a browser** on the frontend origin, not curl. ⚠️ Preflight/`OPTIONS` behaviour for custom endpoints is **NOT VERIFIED IN OFFICIAL DOCS** — register an `options` method and test it |
| 9 | **CSRF** | `SECURITY.md` §6 | `csrf: env.CSRF_ORIGINS` — *"A whitelist array of URLs to allow Payload to accept cookies from"*; `config.serverURL` is added by default. The primary defence remains `SameSite=Lax` | **Native** | A cross-site cookie-bearing POST to an admin route is rejected |
| 9a | **CSRF scope note** | — | `POST /api/v1/leads` is intentionally cross-origin and unauthenticated, so CSRF does not apply to it; it is defended by rate limiting, a honeypot and windowed dedupe instead | — | — |
| 10 | **Rate limiting** | FR-AUTH-08, FR-LEAD-07; `SECURITY.md` §11 gives exact numbers | 🔴 **Payload 3 ships NO HTTP rate limiting.** v2's `rateLimit` config is gone with Express; the dedicated anti-abuse page has **no rate-limiting section and recommends no replacement**; the only occurrence of "rate limit" in the entire docs corpus is an example of throwing your own `APIError`. **Concrete mitigation layer: the reverse proxy / CDN / WAF in front of the container** — `nginx limit_req`, Caddy `rate_limit`, or Cloudflare. This is a tracked **infrastructure deliverable**, not a config line | **100% custom** | Limits fire: `/leads` 5/min/IP and 3/hour/phone; admin login 5/15min/IP; a public-GET per-IP ceiling. Each returns `429` **with `Retry-After`** |
| 10a | **Build-origin exemption** | A2 gap G-22 | Under D-012's ISR model **all public GETs originate from one build machine**. A naive per-IP ceiling on public GETs throttles a full site rebuild. The build egress IP must be exempted | **Infrastructure** | A full `next build` of svfrontend completes without a single `429` |
| 10b | **What Payload does contribute** | — | `auth.maxLoginAttempts` + `lockTime` (per **account**), `auth.forgotPassword.minRequestInterval` (15 000 ms), `maxDepth: 3`, `defaultDepth: 1`, `defaultMaxTextLength`, `graphQL.maxComplexity` | **Native** | Config test asserts each value |
| 10c | **Correct the documents** | — | `ARCHITECTURE.md` §3 places "rate limit" in a `middleware/` layer as if framework-provided and §7 lists `RATE_LIMIT_*`. Both must state that all HTTP rate limiting is ours | **Doc change** | — |
| 11 | **Collection access control** | Roadmap: *"deny-by-default access control on every collection"* | 🔴 **Payload's default is `({ req: { user } }) => Boolean(user)` — any authenticated user, full CRUD.** That is the opposite of deny-by-default. **Every** collection and **every** global declares an explicit `access` block built from four primitives only: `isAdmin`, `anyone`, `nobody`, `publishedOrAuthenticated` | **Custom** | A config test enumerates every collection and global and fails on any missing key, **including `readVersions`** |
| 11a | **The public-read constraint** | FR-PUB-03 | `read: ({ req: { user } }) => user ? true : { _status: { equals: 'published' } }`. Do **not** copy the docs' legacy `_status: { exists: false }` OR-branch — enable drafts from migration 001 so no `_status`-less rows ever exist | **Custom** | Anonymous `GET /api/projects` returns only published rows |
| 12 | **Field-level access** | Server-assigned fields must not be client-settable | ⚠️ **`admin.readOnly` is *"without affecting the API"*** — trivially spoofable over REST. Every server-assigned field pairs it with field-level `access: { create: () => false, update: () => false }`: `leads.source`, `leads.phoneNormalised`, `leads.sourcePath`, `leads.ipAddress`, `leads.userAgent`, `leads.projectNameSnapshot`, `leads.notifiedAt`, `media.width`, `media.height`, `media.originalFilename`, `media.uploadedBy`, `projects.publishedAt` | **Custom** | POST a lead with `"source":"whatsapp"` in the body → the stored value is `contact_form` |
| 13 | **Public API exposure** | FR-PUB-08; NFR-12 — responses match `types/content.ts` exactly | `toPublicProject()` builds output **key by key**; **`...doc` spread is banned by review rule** inside the public-API module. Strip-list: `id`, `_status`, `publishedAt`, `deletedAt`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, every array-row `id`, `hasPlaceholders`, the fractional order key, and Payload's `{docs, totalDocs, …}` envelope | **Custom** | Exact key-set snapshot per endpoint for a thin and a fully-populated document (§18) |
| 14 | **Three-layer leak defence** | R-10, R-12 — the highest-severity pair in the stack | Three independent layers on **every** public read: (1) collection `access.read` returns the published-only constraint; (2) `overrideAccess: false` **and** `user: undefined` on every Local API call in a public handler; (3) an explicit hard-coded `where: { _status: { equals: 'published' } }` the caller cannot override. All three enforced by one `publicFind()` wrapper | **Custom** | A never-published project and an unpublished project both return **404, not 403**. `?draft=true` cannot surface a draft. `?where[_status][equals]=draft` returns nothing |
| 14a | **Why all three** | — | The Local API sets `overrideAccess: true` **by default**, and *"Custom endpoints are not authenticated by default. You are responsible for securing your own endpoints."* One omission in one handler returns drafts, unpublished projects and full lead PII — **silently and unlogged**. For SV Developers the leaked content is DTCP/RERA numbers and land-title claims not cleared for publication: the severity is legal, not merely technical | — | Lint/CI rule: `payload.find` or `payload.findByID` appearing inside `src/endpoints/**` or `src/app/api/**` without `publicFind()` fails the build |
| 15 | **Disabling generated routes** | R-9 (**High**); *"Generated endpoints not required by this contract must be disabled or locked down"* | 🔴 **There is NO documented REST kill switch.** `graphQL.disable: true` exists and works; the collection `endpoints` option is described only as *"Add custom routes to the REST API. Set to `false` to disable routes"* — **its scope is not stated and is unverified**. Achievable, in this order: (1) `graphQL: { disable: true }` at the root; (2) explicit `access` on 100% of collections and globals — **the only documented lever over the generated REST surface**; (3) a reverse-proxy rule blocking `/api/<collection-slug>` paths that are not ours; (4) the Phase-10 negative test suite | **Mostly custom** | `GET /api/graphql` and `/api/graphql-playground` → 404. `curl /api/leads` anonymously → 401/403/empty. `curl /api/projects/versions` anonymously → nothing |
| 16 | **Leads are never public** | FR-LEAD-15 (P0) | `leads.access.read: isAdmin`; `create: () => false` (the public endpoint calls `payload.create({ overrideAccess: true })`); `update`/`delete`: `isAdmin`. **No public GET representation exists at all** | **Custom** | **Dedicated test (T-135):** no public route returns lead data in any shape, authenticated or not — including Payload's generated `/api/leads` |
| 17 | **Media security** | `SECURITY.md` §10 | Files served from a **separate origin** (the CDN host, not the app origin) so uploaded content cannot script against the app; `X-Content-Type-Options: nosniff` on all media responses; `Content-Disposition: attachment` for PDFs. ⚠️ These headers come from the **bucket/CDN, not from Payload** — `s3Storage()` has no option to set them, and `upload.modifyResponseHeaders` only covers the Payload-served path | **Infrastructure** | `curl -I <cdn>/media/<uuid>.jpg` shows `nosniff` and `Cache-Control: public, max-age=31536000, immutable` |
| 18 | **No public upload endpoint** | FR-MEDIA-12 | `media.access.create: isAdmin`; **`pasteURL: false` on both upload collections** — ⚠️ it is **enabled by default**, letting an authenticated editor make the server fetch an arbitrary remote URL | **Custom** | Config test asserts `pasteURL === false` on `media` and `documents`; an unauthenticated POST to the upload route → 401 |
| 19 | **Upload validation** | FR-MEDIA-02; `SECURITY.md` §10 | One `beforeOperation` hook on `create` **and** `update`, in this exact order: magic-byte sniff → declared-vs-actual MIME mismatch → **hard SVG rejection** → `sharp().metadata()` dimension read → re-encode with EXIF stripped → **rename `req.file.name` to a UUID** → capture `originalFilename`. Rename **after** sniffing so the extension reflects reality | **100% custom** | See rows 20–23 |
| 20 | **SVG rejection** | `SECURITY.md` §10, `VALIDATION-RULES.md` §4, `MEDIA-MANAGEMENT.md` §6 | 🔴 **SVG is NOT on Payload's restricted-file-type list**, and the docs' own example `mimeTypes: ['image/*']` **would accept `image/svg+xml`**. Worse: *"If your Collection has defined `mimeTypes` … restricted file verification **will be skipped**."* Our allow-list is therefore strictly narrower than Payload's deny-list **and must be re-reviewed whenever it is widened**: `['image/jpeg','image/png','image/webp','image/avif']`, `allowRestrictedFileTypes: false`, **plus** an explicit hook-level SVG rejection | **100% custom** | A `.svg` upload → 415. An SVG renamed `.png` → 415 by magic bytes |
| 21 | **MIME / type spoofing** | `MEDIA-MANAGEMENT.md` §6 — *"A `.jpg` extension proves nothing"* | Magic-byte sniff; extension **and** declared MIME **and** sniffed type must agree, else `415` | **Custom** | A `.jpg`-renamed executable → 415 |
| 22 | **File size limits** | Images ≤10 MB, PDF ≤25 MB, `413` on exceed | ⚠️ **`upload.limits.fileSize` is one application-wide value** — the 10/25 split is not expressible in config. Set the global limit to the higher (PDF) ceiling with `abortOnLimit: true` (which *"returns HTTP 413"*) and enforce the tighter image ceiling in the `beforeOperation` hook. **A hook-thrown rejection surfaces as a 4xx, not the `413` the contract specifies** — the contract must record this | **Mixed** | A 26 MB PDF → 413; an 11 MB JPEG → 4xx with a size message. `responseOnLimit` never echoes paths or bucket names |
| 23 | **Decompression bomb** | Reject > 10 000 px on a side | Dimension check via `sharp().metadata()` in the same hook | **Custom** | A 10 001 px image → rejected |
| 24 | **Content injection / XSS** | `SECURITY.md` §9 | Lead `message` and `name` are attacker-controlled: HTML stripped on input (`beforeValidate`), escaped on output in the admin (React escapes by default) **and in the notification email** (§14.3). `dangerouslySetInnerHTML` is banned on any CMS or lead content | **Custom** | A lead whose `name` contains `<script>alert(1)</script>` renders escaped in the admin and in the email |
| 25 | **Why there is NO rich-text field** | D-010; `SECURITY.md` §9 — *"No rich-text/HTML content type exists in this CMS. Keep it that way."* | **No `richText` field appears anywhere in this model.** A4 §7.1 is decisive: *"There is no `body`-rich-text anywhere. Every long-form field is `readonly string[]` or a plain `string`. Nothing in the content layer is HTML, Markdown or Lexical."* `description` is `text` + `hasMany`. A rich-text field would be a **new capability, not a migration**, and would hand every admin a stored-XSS surface the product does not need. Payload's Lexical editor is one config line away — which is exactly why the rule is written down | **Policy** | Grep the config for `richText` / `lexicalEditor` on any content field → zero hits. (If the blog returns — OQ-14 — this decision must be reopened **deliberately**, not by reflex) |
| 26 | **Input validation** | `SECURITY.md` §7; NFR-11 | Zod schema at the public endpoint boundary **plus** Payload field `validate` for the admin path. Allow-list not deny-list; enums checked against fixed sets (`icon` against the 41-name union); `projectSlug` verified to exist; unknown properties rejected; body size capped; arrays capped at 50 items | **Custom** | A lead with an unknown `projectSlug` → 422 `UNKNOWN_PROJECT`; a 51-item array → 422 |
| 27 | **SQL injection** | `SECURITY.md` §8 | Drizzle parameterises everything. Raw `sql` template literals appear only inside migrations, with bound parameters, never interpolation. **No user string ever reaches `ORDER BY`** — sort keys map through a fixed allow-list | **Native + policy** | Review rule; a `sort` value outside the allow-list → 400 |
| 28 | **Secrets management** | `SECURITY.md` §12 | Env vars only, never committed (`.gitignore` blocks `.env*`); distinct per environment; platform secret store in production; never logged, never returned in an error, never echoed by a debug route | **Custom** | `git log -p -- .env*` returns nothing; grep production logs for secret values returns nothing |
| 29 | **`PAYLOAD_SECRET` handling** | R-36 | 🔴 The official example is `secret: process.env.PAYLOAD_SECRET \|\| ''`, which **silently accepts an empty secret**, yielding a deterministic, empty-derived JWT signing key. **Never ship that pattern.** Fail fast at boot if absent or under 32 characters. Payload derives the JWT key as `sha256(secret).slice(0,32)` | **Custom** | Booting with `PAYLOAD_SECRET` unset, empty, or 31 chars produces a **named error and the process exits** (Phase-2 exit criterion 2) |
| 30 | **`PAYLOAD_SECRET` rotation** | R-36 | **Payload documents the consequences of rotation but publishes no procedure.** Documented consequence, verbatim: *"If you change your `PAYLOAD_SECRET`, you will need to regenerate your API keys."* Rotation is **break-glass only** — never the revocation mechanism (use sessions, row 5). A rotation runbook must be **written and rehearsed in staging while nothing yet depends on API keys** | **Custom** | The runbook exists, names "regenerate all API keys" as a mandatory step, and has been executed once in staging |
| 31 | **DB credentials / database security** | `SECURITY.md` §16 | Least-privilege application role; **TLS to the database** via `pool.ssl`; never publicly reachable; encryption at rest; `disableCreateDatabase: true` in production (it defaults to `false`, i.e. Payload attempts `CREATE DATABASE` at boot). ⚠️ Under D-015 Payload runs migrations from the app process, so *"migrations run as a separate migration role"* needs explicit handling: run `payload migrate` as a **separate pre-deploy job** under a DDL-capable role and give the running app a role without DDL | **Mixed** | The app role cannot `DROP TABLE`; the migrate job can |
| 32 | **Logging hygiene** | `SECURITY.md` §13 | Pino, JSON to stdout in production. **Never use Pino `transport`** — the docs warn it fails with *"unable to determine transport target"* under ESM/bundling, and Payload is fully ESM. Redact PII and secrets; never log passwords, session ids, cookie values, or full lead records | **Custom** | Grep a production log sample for phone numbers, `hash`, `salt`, cookie values → nothing |
| 33 | **Error leakage** | `SECURITY.md` §15; R-37 | `debug: false` in production (*"Enable to expose more detailed error information"*). A **mandatory `try/catch` in every public handler** mapping internal errors onto the fixed envelope with a `requestId` — `afterError` is **not documented to fire for Local API calls** and cannot be relied on to reshape responses. Never pass `error.message` through | **Custom** | A deliberately-thrown internal error returns the documented envelope with a `requestId` and **no** stack trace, SQL, file path or driver string (Phase-2 exit criterion 4) |
| 34 | **404 vs 403** | `SECURITY.md` §4 — *"a 403 confirms it exists"* | Unpublished and archived content returns **404**. `401` unauthenticated and `403` authenticated-but-forbidden are kept distinct, deliberately | **Custom** | An unpublished slug → 404 with the `NOT_FOUND` envelope |
| 35 | **Dependency discipline** | R-60, R-57 | *"All `payload` and `@payloadcms/*` packages must be on exactly the same version and installed only once"*; remove every `^`/`~` from `payload`, `@payloadcms/*`, `next`, `react`, `react-dom`. The backend's Next is pinned inside a supported range — **never matched to svfrontend's 15.5.25, which is outside every supported range** | **Custom** | `npm ls react` → exactly one copy; a CI check asserts the installed `next` is in the supported set and that every `@payloadcms/*` version is identical |
| 36 | **Dependency updates** | — | `npm audit` in CI; pin exact and bump deliberately in a reviewed PR; stay on the 3.x line (Payload 4 is **canary only** — `4.0.0-canary.35` — and requires Node ≥24.15.0, Next ≥16.2.6, TS ≥6.0.3) | **Custom** | `npm audit --audit-level=high` clean in CI |
| 37 | **Backups** | NFR-10 — *"Daily backups with tested restore"* | 🔴 **Payload documents no backup or restore procedure at all** — the only two occurrences of "backup" in the entire docs corpus are pre-flight warnings on the Lexical migration — while simultaneously shipping `migrate:fresh` (*"Drops all entities from the database"*) and `migrate:reset`. Nightly `pg_dump -Fc` or managed PITR, **plus S3 bucket versioning** (two stores, one stated consistency story), plus a mandatory pre-migration backup step | **100% custom** | **A restore has actually been performed** into a scratch environment and the site brought up from it. A statement that backups exist is not sufficient |
| 37a | **Destructive CLI adjacency** | R-28 | **Rule: `migrate:fresh` and `migrate:reset` never appear in any npm script, CI job or runbook.** They sit one keystroke from the harmless `migrate:status` and would drop the leads table | **Policy** | Grep `package.json` and CI config for `migrate:fresh` / `migrate:reset` → zero hits |
| 38 | **Security headers** | `SECURITY.md` §14 | 🔴 **Payload provides no global security-header surface** — no CSP, no HSTS, no `X-Frame-Options`. The only header API in the entire 3.x docs is `upload.modifyResponseHeaders`, which covers only the Payload-served media path. Set them in the Next layer (`headers()` in `next.config.mjs`) **and** at the reverse proxy: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` on `/admin`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal `Permissions-Policy`, and a CSP on the admin origin | **100% custom** | An observatory scan of the admin origin shows CSP + HSTS + nosniff + frame-deny present |
| 39 | **Admin endpoint protection** | `SECURITY.md` §3 — *"Fail closed"* | Access control (row 11) is the mechanism; there is no middleware boundary to rely on. `admin.hidden` is **navigation and admin routing only and is never a security control**. Additionally `disableBulkEdit`, `disableBulkDelete`, `disableDuplicate` where they are not needed, and `admin.autoLogin` **never** set in any non-dev environment | **Custom** | An automated matrix hits every `/admin/**` and every generated `/api/<slug>` route unauthenticated and asserts 401/403 |
| 40 | **Health-check exposure** | FR-PUB-11 | `/healthz` is a **root Next.js Route Handler** (a Payload `endpoints` entry is *always* mounted under `routes.api`). It returns `{status:'ok'}` or 503 and **nothing else** — no version, no hostname, no database name | **100% custom** | The `/healthz` body contains no build, host or schema information |
| 41 | **Privacy policy** | OQ-24 — *"the largest compliance gap in the project"* | **`POST /api/v1/leads` must not be reachable in production until a reachable privacy URL is configured.** The policy must enumerate sub-processors (email provider, storage provider), so **OQ-7's answers are inputs to OQ-24** | **Owner / policy** | The privacy URL resolves to a real page and is linked from `formNote` before the form goes live |
| 42 | **PII retention** | `SECURITY.md` §17; DPDP | The `purgeLeadPii` job nulls `ipAddress`/`userAgent` at ~90 days. ⚠️ **The lead record's own lifetime is undefined in every source document** (A2 gap G-18) and must be decided before go-live. Erasure-on-request = Trash plus a purge path | **Custom** | The job runs on schedule and a 91-day-old lead has a null `ipAddress` |
| 43 | **Backups contain PII** | `SECURITY.md` §16 | Backups inherit the same access controls and retention as live data; encrypted at rest; offsite copies access-controlled | **Infrastructure** | Backup storage ACL reviewed and recorded |
| 44 | **CSV export PII leak** | R-41 | If `@payloadcms/plugin-import-export` is ever adopted, the docs warn verbatim: *"Users who have read access to the upload collection may be able to download data that is normally not readable due to access control."* Scope it to `leads` only, use `overrideExportCollection` to lock the exports collection to admins, add a `hooks.before` stripping internal fields, and set `disableJobsQueue: true` | **Custom** | A non-admin cannot read the exports upload collection |

### 15.2 Root config — the security-relevant options in one block

```ts
// payload.config.ts — security-relevant options only
export default buildConfig({
  secret: env.PAYLOAD_SECRET,                 // validated >= 32 chars at boot — never `|| ''`
  serverURL: env.NEXT_PUBLIC_SERVER_URL,
  cookiePrefix: 'sv',
  telemetry: false,
  debug: env.NODE_ENV !== 'production',
  graphQL: { disable: true },                 // we hand-write REST; GraphQL is pure attack surface
  maxDepth: 3,
  defaultDepth: 1,
  defaultMaxTextLength: 20000,
  cors: { origins: env.CORS_ORIGINS, headers: [] },
  csrf: env.CSRF_ORIGINS,
  upload: {
    limits: { fileSize: 25 * 1024 * 1024 },   // the HIGHER ceiling; image ceiling is hook-enforced
    abortOnLimit: true,                        // documented to return HTTP 413
    useTempFiles: true,
    tempFileDir: '/tmp/payload-uploads',
    responseOnLimit: 'That file is too large.',  // never echoes paths or bucket names
  },
  logger,                                      // pre-instantiated pino — never Pino `transport`
})
```

### 15.3 Pre-production security checklist

Execute with **evidence recorded per item** — a tick is not evidence. Items 1–13 are `SECURITY.md` §18 corrected for D-015; 14–22 are additions this research forced.

- [ ] 1. No default or seeded credentials remain; **two** admin accounts exist, one per real person
- [ ] 2. `PAYLOAD_SECRET` is unique per environment, ≥32 bytes, and **boot fails without it** — proven by a test
- [ ] 3. `cors` and `csrf` are two-origin allow-lists, not `*`, and are proven **from a browser**
- [ ] 4. Rate limits are active and **proven to fire** on `/api/v1/leads` and the admin login route, with the build-origin exemption in place
- [ ] 5. Uploads reject SVG, enforce magic-byte checks, cap size and dimensions, strip EXIF, and use UUID storage keys
- [ ] 6. Error responses leak nothing — no stack trace, SQL, file path, driver string or library version in any 5xx body
- [ ] 7. Audit logging verified on every mutation **by publishing from the Admin UI** (not from an endpoint) and finding the row
- [ ] 8. Backups tested **by an actual restore** into a scratch environment
- [ ] 9. HTTPS + HSTS enforced; the admin is on its own subdomain of the public registrable domain
- [ ] 10. Privacy policy published and linked, naming every sub-processor
- [ ] 11. PII retention job scheduled and observed to run
- [ ] 12. Public endpoints verified to expose **no** lead data and **no** admin fields — asserted by the key-set snapshot suite
- [ ] 13. Unpublished and archived content verified to **404**, including via `?draft=true` and `?where[_status][equals]=draft`
- [ ] 14. `GET /api/graphql` and `/api/graphql-playground` return **404**
- [ ] 15. An **explicit `access` block on 100%** of collections and globals, including `readVersions` — proven by a config test
- [ ] 16. Every server-assigned field carries field-level `access.create/update: () => false`, not merely `admin.readOnly`
- [ ] 17. `pasteURL: false` on both upload collections — proven by a config test
- [ ] 18. A reverse-proxy rule blocks `/api/<collection-slug>` paths that are not ours
- [ ] 19. `npm ls react` shows exactly one copy; all `payload` / `@payloadcms/*` versions identical and exact
- [ ] 20. No `migrate:fresh` or `migrate:reset` anywhere in `package.json`, CI, or the runbook
- [ ] 21. Security headers present on a real response from both the admin origin and the media origin
- [ ] 22. The `PAYLOAD_SECRET` rotation runbook exists **and has been executed once in staging**

---

## 16. Database and Migrations

### 16.1 The adapter config, with every relevant option

```ts
// src/payload.config.ts
import { postgresAdapter } from '@payloadcms/db-postgres'

db: postgresAdapter({
  pool: {
    connectionString: env.DATABASE_URL,
    max: 10,                       // node-postgres option, NOT a Payload option
    idleTimeoutMillis: 30_000,
    ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
  },
  idType: 'uuid',                  // adapter-global, irreversible after migration 001 — §16.2
  migrationDir: './src/migrations',// explicit; never rely on the "best effort" search
  disableCreateDatabase: env.NODE_ENV === 'production',  // default is FALSE — Payload will try CREATE DATABASE
  // push: left at its DEFAULT (enabled in dev only) — §16.6 mode (a)
  // schemaName: NOT set. It is marked "(experimental)"; stay on `public`.
  // transactionOptions: NOT set. Transactions are ON by default on Postgres and we want them.
  // blocksAsJSON: NOT set. We use no Blocks fields.
  // readReplicas: NOT set. Five projects.
  // versionsSuffix / relationshipsSuffix / localesSuffix: left at defaults `_v` / `_rels` / `_locales`.
  generateSchemaOutputFile: './src/payload-generated.schema.ts',
  afterSchemaInit: [addUnexpressibleConstraints],   // §16.5
}),
```

⚠️ Two adapter facts worth stating because they bite at boot: `disableCreateDatabase` **defaults to `false`**, so on a managed Postgres where the app role lacks `CREATE DATABASE` Payload throws on startup; and `pool` sizing is **entirely undocumented by Payload** (delegated to node-postgres/Drizzle), so `pool.max × replica count` must be kept comfortably under the server's `max_connections` by our own arithmetic.

### 16.2 `idType` — decision and reason

**`idType: 'uuid'`.**

Two reasons, both dispositive: (1) `DATABASE-SCHEMA.md` specifies `Lead.id` as a UUID and an unguessable id on a PII-bearing record is worth having; (2) `idType` is **adapter-global and effectively irreversible** — changing it after migration 001 is a type change across every primary key and every foreign key in every one of the ~50 child tables, i.e. a rebuild and reseed. Deciding it late costs far more than deciding it now.

**ULID is not available.** The only documented values are `'serial'` and `'uuid'`, and custom IDs *"can only be `Number` or `Text` fields"*. **Remove "UUID/ULID" from `DATABASE-SCHEMA.md`.**

Two things the docs do **not** state and that must be read off `generate:db-schema` in the Phase-1 spike: the **uuid version** generated (v4 vs v7), and whether the column is a native Postgres `uuid` or a `varchar`. The second matters — uuid-as-text degrades index and join performance across an already join-heavy model.

### 16.3 How our model maps onto Postgres tables

Payload publishes **no "how fields map to tables" page**. What follows is what the docs do establish (per-field `dbName` options prove one table per array; suffix options prove the `_rels`/`_v` pattern), plus what must be read off the generated Drizzle schema.

**The `projects` collection alone:**

| Model element | Physical artefact | Controlled by |
|---|---|---|
| scalar fields (`name`, `slug`, `summary`, `area`, …) | columns on `projects` | — |
| `cta` / `seo` named groups | ⚠️ **assumed** flattened into prefixed columns on `projects`. Group exposes **no `dbName`**, which is strong circumstantial evidence — but the docs **never state it**. Verify | — |
| `description` (`text` + `hasMany`) | ⚠️ **NOT VERIFIED**: child table vs `text[]` vs JSON. Text exposes **no `dbName`**, so the name is **not controllable**. Verify before migration 001 | — |
| `stats[]` | `proj_stats` | `dbName` |
| `highlights[]` | `proj_highlights` | `dbName` |
| `amenities[]` | `proj_amenities` | `dbName` |
| `approvals[]` | `proj_approvals` | `dbName` |
| `locationHighlights[]` | `proj_loc_hl` | `dbName` |
| `proximity[]` | `proj_proximity` | `dbName` |
| `image`, `gallery`, `layoutImage`, `locationMap` (upload relations) | rows in **`projects_rels`** (one row per reference; `gallery` contributes one row per image) | `relationshipsSuffix` |
| `category`, `projectStatus`, every `icon` | **real Postgres enum types** | `enumName` |
| versions + drafts | `projects_v`, `projects_v_rels`, and a versioned counterpart of **every** child table above | `versionsSuffix` |

**≈ 18–20 physical tables for one collection.** Across the nine entities the realistic total is **40–60**.

**Two undocumented structural facts** that must be read off the generated schema before any migration or raw SQL is written: whether **array rows carry an `id` column**, and whether they carry an **`_order` column**. Neither is mentioned on the Array, Blocks or "Fields Generated by Payload" pages. The serialiser must strip row `id`s (§15 row 13), so their existence is load-bearing for the contract.

**Set `dbName` explicitly on every array field and `enumName` explicitly on every select.** Payload's derivation is undocumented, deeply nested paths risk Postgres' **63-byte identifier limit** with silent truncation collisions, and auto-generated enum names would produce a *separate* PG enum per icon field — six identical types, six `ALTER TYPE` statements per icon change, doubled again by the `_v` tables. ⚠️ **Whether Payload deduplicates an identical `enumName` across fields into a single PG type is NOT VERIFIED IN OFFICIAL DOCS** — spike it by running `generate:db-schema` with two icon fields sharing an `enumName` and counting the emitted enums. If it does not dedupe, accept six and write the migration as a loop, but know that going in.

**Payload-implicit tables that appear without being in anyone's count:** `payload-migrations`, `payload-preferences`, `payload-locked-documents` (document locking is **on by default**), `payload-jobs`, every `*_rels`, every `*_v` and `*_v_rels`, one per array field, probably one for `hasMany` text, plus a Postgres enum type per `select`.

⚠️ Payload's own Database Overview steers array-heavy models toward MongoDB: *"You should prefer MongoDB if … You leverage a lot of Arrays, Blocks, or `hasMany` Select fields."* We are deliberately going against that grain. It is a documented trade-off, not a bug — the commercial lead record and enforced integrity are worth it — but it means `GET /projects` fans out into many joins. Mitigate with an include-mode `select`, `defaultPopulate` on `media`, a pinned `depth`, and a cached response. Never let the default `depth` pull the whole graph.

### 16.4 Indexes and unique constraints — the exact list

| Table / field | Index | Why |
|---|---|---|
| `projects.slug` | `unique: true, index: true` | Public URL key; `getProject(slug)` and `generateStaticParams` both address by slug |
| `projects.category` | `index: true` | Catalogue filter predicate (`ProjectCatalogue.tsx:21`) and `usedCategories()` |
| `projects.featured` | `index: true` | Homepage featured strip |
| `projects._status` | `index: true` **via field override or hand-written migration** | The predicate on **every** public read. ⚠️ Whether Payload indexes `_status` is **NOT VERIFIED IN OFFICIAL DOCS** — do not assume |
| `projects.publishedAt` | `index: true` | `sitemap.xml` `lastModified`; any "published on" sort |
| `leads.phoneNormalised` | `index: true`, **explicitly NOT `unique`** | Dedupe lookups. One buyer may legitimately enquire about several projects — a hard unique constraint would reject real leads |
| `leads.projectSlug` | `index: true` | Admin filtering |
| `leads` compound | `indexes: [{ fields: ['phoneNormalised','projectSlug'] }]`, **not unique** | Supports the windowed dedupe query. A time-windowed partial unique index is **not expressible in Postgres** (non-immutable predicate), so the dedupe itself is application logic in a `beforeValidate` hook |
| `leads.isRead` | `index: true` | The dashboard's "new leads" query (`?isRead=false`) |
| `audit-log.entityType`, `audit-log.entityId` | `index: true` each | `GET /admin/audit-log` filters by both |
| `users.email` | unique (auth-provided) | Login identifier |
| `id`, `createdAt`, `updatedAt` | **indexed by default** on every collection | Documented — no action. This is why `defaultSort: '-createdAt'` on `leads` costs nothing |

🔴 **Forbidden: `unique: true` on any field nested inside an array.** The docs are unambiguous — it *"creates a collection-wide unique index on the dotted path … it prevents **any two documents** from having the same value at that path."* A well-meaning `unique` on `proximity.place` would mean the second project that mentions the same landmark cannot be saved. Per-document uniqueness (the React-key guard on `description`, `stats.label`, `proximity.place`) is a **custom `validate` function on the array field**, which is what the docs themselves prescribe.

⚠️ Two limits to record: **no partial, conditional or expression indexes** are expressible through `index`/`indexes` — anything beyond "these columns, optionally unique" needs `afterSchemaInit` or raw SQL. And **Payload's index-naming scheme is undocumented**, which matters when hand-writing a `down` that drops an index.

### 16.5 Constraints Payload cannot express, and how they are added

Two escape hatches, both documented: `beforeSchemaInit` (adds tables Payload does not manage, plus `adapter.rawTables[...].indexes`) and `afterSchemaInit` + the `extendTable` utility (adds columns, indexes and `extraConfig` to tables Payload does manage). Raw `sql` inside a migration's `up` is the third.

| Constraint | Status under Payload | How it is added |
|---|---|---|
| `CHECK category IN (…)`, `CHECK projectStatus IN (…)`, `CHECK icon IN (41)` | ✅ **Stronger than planned** — `select` + `enumName` produces a **real Postgres enum type**, which *is* the constraint. D-007's planned custom CHECK migration for the icon enum is **unnecessary** | nothing to add |
| `testimonials.consented` publish gate | ❌ not expressible | **Retained as a real DB CHECK via a custom migration** — one of only two kept. `beforeValidate` hook throws `422 CONSENT_REQUIRED`; the CHECK is the backstop, because *"a disabled button is not the control"* |
| `CHECK (cta_title IS NULL) = (cta_description IS NULL)` | ❌ | group-level `validate` returning `INCOMPLETE_PAIR` |
| `UNIQUE partial (project_id) WHERE role IN (…)` | ❌ and **written wrong in the source** (A2 defect D-8) | **Replaced by schema cardinality** — a non-`hasMany` upload field physically cannot hold two |
| `project_media.media_asset_id → media_assets ON DELETE RESTRICT` | ❌ **Payload documents no referential-integrity or cascade behaviour for relationship/upload fields — NOT VERIFIED IN OFFICIAL DOCS** | 100% application-level: `join` fields for reference counting + a `beforeDelete` hook throwing `409` with the usage list. **Amend `DATABASE-SCHEMA.md` §9 to say so** rather than mandating a constraint Payload will not create |
| `citext` on email | ❌ not a Payload concept | `afterSchemaInit` + `extendTable`, or a lowercasing `beforeValidate` hook |
| case-insensitive slug uniqueness | ❌ | a `lower()` expression index via `afterSchemaInit` or raw SQL |
| `CHECK rating BETWEEN 1 AND 5` | ✅ | `min`/`max` on the number field |
| `CHECK (id = 1)` singleton on site_settings | ✅ | it is a Global |
| partial indexes `WHERE deleted_at IS NULL` | ➡️ replaced | Trash + `admin.baseFilter` (⚠️ **`baseFilter`, not `baseListFilter`**) + access-control constraints |
| `timestamptz` for `createdAt`/`updatedAt` | ⚠️ present as camelCase `createdAt`/`updatedAt` and indexed by default, but **the Postgres column type (`timestamptz` vs `timestamp`) is NOT VERIFIED** | read `generate:db-schema`; if it is `timestamp`, fix it in migration 001 |

⚠️ One consequence of using `afterSchemaInit` that must become a written convention: *"Columns and tables added in schema hooks won't be added to the generated `payload generate:db-schema` Drizzle schema."* A later developer regenerating that file silently loses our custom indexes **from the typed file** (not from the database). Document it next to the hook.

### 16.6 THE MIGRATION WORKFLOW

Three modes. They are not interchangeable, and the single most common way to corrupt a Payload + Postgres project is to mix modes (a) and (c).

#### Mode (a) — LOCAL DEVELOPMENT SCHEMA SYNCHRONISATION

**Mechanism: Drizzle `push`, left at its default (enabled in development mode only).**

The docs are emphatic: *"we suggest that you leave `push` as its default setting and **treat your local dev database as a sandbox**"* and *"importantly, **you do not need to run migrations against your development database**, because Drizzle will have already pushed your changes to your database for you."* Setting `push: false` locally is explicitly warned against — *"you may see frequent errors while running development mode."*

```bash
# start the sandbox
docker compose up -d postgres
npm run dev            # push syncs the schema automatically on config change

# reset the sandbox — this is the ONLY sanctioned reset
docker compose down -v && docker compose up -d postgres
```

🔴 **THE RULE, stated once and written into `svbackend/README.md`:**
> **The local dev database is a disposable sandbox managed by `push`. Every other environment is migrations-only. `payload migrate` is NEVER run against the local dev database.**

Verbatim from the docs: *"do not mix 'push' and migrations with your local development database. If you use 'push' locally, and then try to migrate, Payload will throw a warning, telling you that these two methods are not meant to be used interchangeably."* Doing it produces a migration history that matches no real schema — it then fails in CI, or worse, does the wrong thing there.

**Never reset the sandbox with `migrate:reset` or `migrate:fresh`.** Use `docker compose down -v`. That is why the reset script exists.

#### Mode (b) — MIGRATION GENERATION

**Mechanism: `payload migrate:create`, run by a human, after a feature is complete.**

Generation reads **the existing migration files plus the current config** — *"We will look for any existing migrations, and automatically generate SQL changes necessary to convert your schema from its prior state to the new state of your Payload Config"* — and writes a new file. It **does not run it**: *"We won't immediately run this migration for you."* This is why generation is safe to perform on a machine whose sandbox is push-managed: it is *running* `migrate`, not *creating* it, that must never touch that database.

```bash
npm run payload migrate:create add-projects-collection
# → src/migrations/YYYYMMDD_HHMMSS_add_projects_collection.ts   (up + down)
# → src/migrations/index.ts is regenerated, exporting the `migrations` array
```

Rules, all non-negotiable:

1. **Name every migration.** `migrate:create add-lead-dedupe-index`, not a bare timestamp. The git history has to read.
2. **One migration per logical change**, committed separately. `migrate:down` rolls back **a batch, not a single migration** — small batches are the only rollback granularity available.
3. **Read every generated file before committing it.** The docs advise exactly this: *"it's a good idea to always double-check the contents of the migration files."*
4. **Hand-write the `down` for any data migration.** Only schema DDL is auto-generated, and an auto-generated `down` restores **structure, not data**.
5. **The config must be environment-invariant in shape.** Always register every plugin and switch behaviour by env var *inside* it — `s3Storage({ enabled: Boolean(env.S3_BUCKET) })` — never by conditionally including the plugin. Otherwise *"it can lead to discrepancies"*: `migrate:create` produces a different diff on a colleague's machine, and one of the two is wrong.
6. `--skip-empty` only in CI. Our flow makes generation a deliberate human step.

#### Mode (c) — PRODUCTION MIGRATION EXECUTION

**Mechanism: `payload migrate` in CI, before the build.**

Documented ordering, verbatim: *"Generally, you want to run migrations **before** you build Payload for production… By calling `payload migrate`, Payload will automatically execute any migrations in your `/migrations` folder that have not yet been executed against your production database, in the order that they were created. **If it fails, the deployment will be rejected.**"*

```jsonc
// package.json
"payload":  "cross-env NODE_OPTIONS=--no-deprecation PAYLOAD_CONFIG_PATH=src/payload.config.ts payload",
"build":    "payload generate:importmap && next build",
"ci":       "payload migrate && npm run build"
```

**Exact deployment ordering — each step gates the next:**

```
1. npm ci                                   (package-lock.json committed; the official Dockerfile's npm ci branch)
2. npm run payload migrate:status           READ-ONLY GATE — shows what would run
3. pg_dump -Fc                              MANDATORY pre-migration backup
4. npm run payload migrate                  as a SEPARATE pre-deploy job, DDL-capable role
5. payload generate:importmap && next build a stale import map is a PRODUCTION-ONLY failure
6. build + push the container image
7. deploy the CMS container                 app role has no DDL
8. /healthz green
9. restart worker-default and worker-maintenance
10. smoke: synthetic lead end-to-end including the notification
```

Why step 4 is a separate job rather than inside the image build: it lets the migrate role differ from the app role (§15 row 31), and it keeps the failure surface at "deployment rejected" rather than "container crash-loops."

**`prodMigrations` is the fallback, not the primary path.** Passing `prodMigrations: migrations` to the adapter runs migrations at boot; the docs' warning about serverless cold starts does not apply to us (long-running container), but a failed boot-time migration produces a crash-looping container instead of a cleanly rejected deployment. Use it only if CI genuinely cannot reach the production database.

⚠️ **Concurrent-deploy migration races are NOT VERIFIED IN OFFICIAL DOCS** — no migration locking or advisory-lock behaviour is documented. **Serialise deploys.** If `prodMigrations` is ever used, scale to one instance for the migrating release.

**Rollback.** Each migration runs in its own transaction and aborts on error, so the database should be at a clean boundary — **verify that, do not assume it**. Then: additive migrations (new nullable column, new table) are safe to leave in place — **roll the code back and leave the schema forward**, which is the normal case and should be the design target. Destructive migrations (dropped or renamed column, narrowed type) are **not** safely reversible by code rollback, because an auto-generated `down` restores structure and not data. **Default posture: fix forward.** Restoring from backup is for data loss, not for a bad release. Use expand-contract discipline on every schema change — add the new shape, dual-write, migrate readers, drop the old shape in a *later* release — so at every point the previous code version still works against the current schema.

### 16.7 Test database strategy

**A disposable Postgres container per CI job, migrated — never pushed.**

Reason: running `payload migrate` against the test database makes **the migration chain itself a tested artefact**. A migration that fails on a clean database fails in CI, not in production. It also removes the mode-(a)/mode-(c) mixing hazard entirely, because the test DB never sees `push`.

```bash
# CI
docker run -d --name sv-test-db -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:15
DATABASE_URL=postgres://postgres:test@localhost:5433/sv_test npm run payload migrate
DATABASE_URL=postgres://postgres:test@localhost:5433/sv_test npm test
```

Details that matter:

- `DATABASE_URL` is set **before the config is imported** — a test runner does **not** get `payload run`'s Next-style env loading, so the runner's setup file loads env itself.
- `disableCreateDatabase` stays `false` in test so Payload can create the database if absent.
- Isolation between suites is `delete`-based in `afterEach`; **there is no documented transaction-rollback-per-test helper**.
- `psql` is **not on PATH on this machine** — all Postgres client tooling goes through `docker run postgres:15 pg_dump …`.
- **`migrate:fresh` is not used as a test reset**, despite being technically capable. A fresh container per job is cheaper and cannot be pointed at the wrong database by a stray env var.

---

## 17. Seed Strategy

### 17.1 What gets seeded, and why

| # | Seeded | Why | Gate |
|---|---|---|---|
| 1 | **Two admin users** | FR-AUTH-09 forbids self-registration, so `access.create` on `users` is locked down — the seed is therefore the **only** bootstrap path. **Two**, not one, because account-level lockout with a sole admin is a trivial self-inflicted denial of service (R-39) | always, idempotent by email |
| 2 | **`site-settings` global** | 10 of its 11 top-level values are placeholders today (A4 §4.1). Seeding them verbatim keeps the gap visible instead of leaving the global empty and the public site 500-ing | always |
| 3 | **The 5 real projects from `svfrontend/src/content/projects.ts`** | Phase-1 exit criterion 7: *"Seeded projects match `projects.ts` byte-faithfully."* These are five real, brochure-sourced records with **zero bracketed placeholders** (A4 finding 6) — they are the contract fixture, not demo data | always, idempotent by slug |
| 4 | **Rasterised media for the 5 covers + logo + 3 site images** | `projects.image` is a **required** upload relation; without it no project can be published | production seed only — §17.4 |
| 5 | Tier-2 content (testimonials, faqs, statistics) | ❌ **NOT seeded.** The three testimonials are *"invented placeholders with bracketed names"* and `pages.ts:10-12` calls publishing them *"a fabricated record"* (OQ-23). Seeding them creates the exact artefact the CMS must make impossible | never |

### 17.2 The mechanism

**A standalone script run with `payload run` — the documented pattern (B11 §4).**

```jsonc
// package.json
"seed": "cross-env NODE_OPTIONS=--no-deprecation payload run src/seed/index.ts"
```

```ts
// src/seed/index.ts  — ESM, as Payload requires
import { getPayload } from 'payload'
import config from '@payload-config'

const run = async () => {
  const payload = await getPayload({ config })
  if (process.env.PAYLOAD_SEED !== 'true') {
    payload.logger.warn('PAYLOAD_SEED is not "true" — refusing to seed')
    process.exit(1)
  }
  await seedAdmins(payload)
  await seedSiteSettings(payload)
  await seedMedia(payload)      // production seed only; no-op if already present
  await seedProjects(payload)
  payload.logger.info('Seed complete')
  process.exit(0)
}
await run()
```

Why `payload run` and not bare `node`/`tsx`: the docs state it *"loads the environment variables the same way Next.js loads them, eliminating the need for additional dependencies like `dotenv`. **The usage of `dotenv` is not recommended, as Next.js loads environment variables differently**"*, and it *"initializes tsx, allowing direct execution of TypeScript files."*

**`onInit` is NOT used — for anything.** The docs describe it only as *"a function that is called immediately following startup"*. They do **not** document how many times it runs across multiple instances, whether it runs during `next build`, whether it runs on every HMR reload, or whether a throw aborts startup. All four are **NOT VERIFIED IN OFFICIAL DOCS**. An `onInit` content seed in a two-replica deployment is a race that produces duplicate projects. The script is deterministic and auditable; `onInit` is neither.

**The `PAYLOAD_SEED` gate is a hard refusal, not a skip.** A seed run by accident against production is exactly the incident this guard exists to prevent.

### 17.3 Idempotency

**Every entity is a natural-key upsert. No blind `create` anywhere.**

```ts
const upsertProject = async (payload: Payload, data: ProjectSeed) => {
  const existing = await payload.find({
    collection: 'projects',
    where: { slug: { equals: data.slug } },
    limit: 1, depth: 0, overrideAccess: true,
  })
  const doc = existing.docs[0]
  return doc
    ? payload.update({ collection: 'projects', id: doc.id, data, overrideAccess: true,
                       context: { skipAudit: true } })
    : payload.create({ collection: 'projects', data, overrideAccess: true,
                       context: { skipAudit: true } })
}
```

Natural keys: `projects` → `slug`; `users` → `email`; `media` → `originalFilename`; `site-settings` → it is a global, so `updateGlobal` is inherently idempotent.

`context: { skipAudit: true }` keeps the audit log clean of seed noise — the log is a record of *human* mutations. `overrideAccess: true` is required because `users.access.create` is `() => false` and `projects` is admin-only; the Local API skips access control by default anyway, but stating it makes the intent explicit.

**Acceptance (Phase-4 exit criterion 12): running the seed twice produces 5 projects, not 10.**

### 17.4 Media seeding, honestly

This is the one genuinely awkward part of the seed, and it must not be papered over.

**The contradiction (A2 C-1 / CONF-16 / R-50).** `MEDIA-MANAGEMENT.md` §11 steps 1–3 instruct the cutover to **upload the 5 project SVGs** plus `master-plan.svg`, `plot-sizes.svg` and `location-thumb.svg`. `MEDIA-MANAGEMENT.md` §6, `VALIDATION-RULES.md` §4, `SECURITY.md` §10 and the §18 checklist all state SVG is **always rejected**. And the docs confirm there is no free pass: **all hooks attached to the `media` collection still fire on Local API uploads**, so a seed script hits our own SVG ban.

Compounding it: all eight assets are generated **SVG title cards, not photographs**, and the five project placeholders are `1200 × 800` (3:2) while they render at `aspect-[4/3]` on cards and `aspect-[16/9]` in the detail hero — **the placeholder art is already cropped in both places today**.

**The resolution, in two stages.**

**Stage 1 — the Phase-1 spike seeds NO media at all.** Projects are created as **drafts**, and `versions.drafts.validate` is `false` (§12.4), so the required `image` field is not enforced on a draft save. This is exactly what that setting was chosen for. Exit criterion 7 ("byte-faithful") is satisfied for **data**; the gate report records media as out of scope for the spike.

**Stage 2 — the production seed rasterises before uploading.** A one-off script converts the eight SVGs to PNG with sharp and commits the output to `src/seed/assets/`:

```bash
npm run seed:rasterise   # sharp: SVG → PNG at 1600px wide, committed to src/seed/assets/
```

The seed then uploads the committed PNGs through the normal pipeline, hooks and all. Nothing bypasses validation; no SVG exception is created.

**Rejected alternatives, and why:**

- *"Allow SVG only for the seeded five."* A permanent hole for a temporary problem. Rejected outright.
- *"A seed path that bypasses the upload hook with a flag."* A flag that skips magic-byte sniffing, SVG rejection and EXIF stripping exists forever, and the next person who needs to seed something will use it.

**Consequence to state plainly:** the seeded covers are rasterised placeholders, not photographs. `dangerouslyAllowSVG` can only be removed from `svfrontend/next.config.mjs` (T-183) once **real raster art** replaces them — that is a content deliverable (README "before you go live" item 6), not an engineering one.

**Do not seed `media.hero` / `media.heroPortrait`.** `MEDIA-MANAGEMENT.md` §11 step 4 already says so, and A5 §5.4 confirms both point at files that **do not exist on disk** and are referenced by nothing.

### 17.5 How seeds relate to the test database

**They are separate concerns and must stay separate.**

| | Seed | Test fixtures |
|---|---|---|
| Purpose | Bootstrap a usable environment | Establish a minimal, known state for one assertion |
| Volume | 5 projects, 2 users, 1 global, 9 assets | one or two documents |
| Mechanism | `npm run seed` | typed factory helpers in `tests/factories/` |
| Reuse | The seed's **project data module** (`src/seed/data/projects.ts`) is imported by the contract tests as the canonical fixture | — |

A test that needs a fully-populated project imports the seed's data module; a test that needs a *thin* project (the omit-don't-empty case) uses a factory that sets only the required fields. Running the whole seed in every test file would make the suite slow and couple unrelated assertions to nine media uploads.

### 17.6 Commands

```bash
# local: reset the sandbox and reseed
docker compose down -v && docker compose up -d postgres
npm run dev                       # push syncs the schema
PAYLOAD_SEED=true npm run seed

# one-off, before the first production seed
npm run seed:rasterise            # SVG → PNG, output committed

# production / staging: migrations first, then seed, once
npm run payload migrate
PAYLOAD_SEED=true npm run seed
```

🔴 **Never compose `migrate:fresh && npm run seed` into a script.** It reads as a convenience and is one typo from dropping the leads table.

---

## 18. Testing

### 18.1 The honest starting point

**There is no Testing page in the official Payload v3 documentation.** The complete machine-readable docs index at `llms.txt` contains no Testing section, and `/docs/testing/overview`, `/docs/local-api/testing` and `/docs/production/testing` all return **HTTP 404**. **Vitest and Playwright are named nowhere in the official docs.** The only testing guidance anywhere is inside the *plugin-authoring* page, which says: *"Payload typically uses Jest; a popular testing framework."* Its example declares `let payload: Payload` and **never shows how that variable is initialised in a test**.

So: **the entire test harness is our own engineering decision.** Any plan that says "follow Payload's official testing guide" is planning against a document that does not exist.

**Tool choice, and the justification.** **Vitest**, not Jest. The official docs name only Jest, and that is recorded here honestly — but the docs also state the constraint that decides it: *"Payload and all of its official packages are fully ESM. If you want to use Payload within your own projects, make sure you are writing your scripts in ESM format."* Vitest is ESM-native; Jest requires extra configuration against an all-ESM package graph. **This is recorded as our ADR, not as Payload guidance.**

**What IS documented, and is all we actually need:** `getPayload({ config })` — the Local API boots in-process, so tests never need HTTP and never need the Next.js server running.

### 18.2 The layers

| Layer | What it covers | Tool | Runner setup | Rough count | CRITICAL / DEFERRED |
|---|---|---|---|---|---|
| **UNIT** | `toPublicProject()` and the other serialisers, `put()`/`omitEmpty()`, `escapeHtml`, phone normalisation, slugify, `deriveAction`, `diffSensitiveFields`, the Zod schemas | Vitest | none — pure functions, no Payload boot | ~45 | **CRITICAL** |
| **INTEGRATION** | Collection behaviour through the Local API: hooks fire, validation rejects, defaults apply, relations populate | Vitest + `getPayload` | memoised singleton in `beforeAll`, disposable Postgres container | ~40 | **CRITICAL** |
| **CONTRACT** | Every public response satisfies the real `Project` / `SiteSettings` / etc. types from `svfrontend/src/types/content.ts` | Vitest + `expectTypeOf` + runtime key-set snapshots | vendored types + CI drift check | 6 endpoints × 2 shapes = ~12 | **CRITICAL** |
| **DATABASE** | Migrations apply and roll back on a clean database; `generate:types` produces no diff; identifier lengths; enum types exist | Vitest + shell | fresh container per job | ~8 | **CRITICAL** |
| **AUTH** | Login, lockout, unlock, password policy, session revocation on password change, `logout?allSessions=true` | Vitest + Local API | seeded two-admin fixture | ~12 | **CRITICAL** |
| **ACCESS CONTROL** | The authz matrix: anonymous vs authenticated × every collection × every operation, plus `readVersions` | Vitest + Local API with `overrideAccess: false` | — | ~35 | **CRITICAL** |
| **UPLOAD** | SVG rejection, magic-byte mismatch, size, dimension bomb, EXIF strip, UUID rename, in-use delete guard | Vitest + real fixture files in `tests/fixtures/` | local-disk storage (`s3Storage({enabled:false})`) | ~12 | **CRITICAL** |
| **PUBLIC API** | Handler behaviour end-to-end: status codes, cache headers, `ETag`, CORS headers, the error envelope | Vitest against the handler functions; plus a small `fetch` suite against `next dev` | — | ~20 | **CRITICAL** |
| **ADMIN WORKFLOW** | create → draft → publish → reorder → unpublish → archive → restore, through the **Local API** (same access control and hooks the admin UI uses) | Vitest + Local API | — | ~10 | **CRITICAL** |
| **LEAD FLOW** | `POST /api/v1/leads` end-to-end: validation, honeypot, dedupe, provenance, `422` field names, `Cache-Control: no-store` | Vitest | — | ~18 | **CRITICAL** |
| **JOB / EMAIL** | `sendLeadNotification` idempotency, `JobCancelledError` on poison input, escaping, the no-adapter boot guard | Vitest + `payload.jobs.runByID()` + a stub transport | the docs' own recommended test pattern | ~10 | **CRITICAL** |
| **RATE LIMIT** | Limits fire at the documented thresholds and return `429` + `Retry-After` | shell/HTTP against a staging proxy | not unit-testable — it is proxy config | ~4 | IMPORTANT (needs infra) |
| **LOAD** | `POST /leads` < 500 ms p95 (NFR-01) | k6 or autocannon | staging | 1 scenario | IMPORTANT |
| **E2E (browser, admin panel)** | — | — | — | 0 | **DEFERRED — do not build** |

**Why admin E2E is deferred, not merely descoped.** There is **zero official guidance**; Playwright, Cypress, Selenium and Puppeteer appear nowhere in the docs. Any suite we build couples to Payload's internal admin DOM and CSS class names, which the docs **never guarantee as stable**, against a project shipping minors roughly weekly. The admin panel is first-party Payload code that Payload tests upstream. **Risk of attempting: HIGH. Risk of skipping: LOW.** Cover it instead with (a) the ADMIN WORKFLOW integration layer, which exercises the same access control and hooks the UI calls, and (b) a one-page manual smoke checklist at release.

**The tight-deadline cut.** Everything marked CRITICAL stays. Cut: LOAD, and the RATE LIMIT suite may be reduced to a single manual verification recorded with evidence. Nothing else is cuttable, because every CRITICAL layer defends either a silent data leak, a silent data loss, or the public contract.

### 18.3 The must-have test cases, named

These six are the ones the whole suite exists for. Each maps to a failure that is **silent** in production.

**1 — Leads are not public (FR-LEAD-15, R-9).**
```ts
it('exposes lead data on no public route, in any shape', async () => {
  await createLead({ name: 'Canary', phone: '9876543210' })
  for (const path of ['/api/v1/projects','/api/v1/projects/sri-city-aler-town',
                      '/api/v1/site-settings','/api/v1/testimonials','/api/v1/faqs','/api/v1/statistics']) {
    expect(JSON.stringify(await getPublic(path))).not.toContain('Canary')
    expect(JSON.stringify(await getPublic(path))).not.toContain('9876543210')
  }
  // and Payload's OWN generated surface
  await expect(payload.find({ collection: 'leads', overrideAccess: false, user: undefined }))
    .rejects.toThrow()   // or resolves with 0 docs — assert whichever the access fn produces
})
```

**2 — Unpublished projects do not leak (R-12, the highest-severity finding).**
```ts
it('404s a never-published project, an unpublished project, and resists ?draft=true', async () => {
  const draft = await createProject({ slug: 'unapproved-rera', _status: 'draft' })
  expect(await getPublic('/api/v1/projects/unapproved-rera')).toMatchObject({ status: 404 })
  expect((await getPublic('/api/v1/projects')).data.map(p => p.slug)).not.toContain('unapproved-rera')
  expect(await getPublic('/api/v1/projects/unapproved-rera?draft=true')).toMatchObject({ status: 404 })
  expect(await getPublic('/api/v1/projects?where[_status][equals]=draft')).toMatchObject({ status: 404 })
  // and: 404, NEVER 403 — a 403 confirms existence
})
```
A never-published document sits in the **main** table with `_status: 'draft'` and **is returned by a plain `find()`**. For SV Developers the leaked content is uncleared DTCP/RERA claims. This test is the backstop for all three defence layers.

**3 — Omit, don't empty (D-008 + P3).**
```ts
it('omits absent optional keys entirely — never null, never "", never []', async () => {
  const thin = await getPublic('/api/v1/projects/thin-project')
  for (const k of ['status','developer','tagline','stats','amenities','approvals',
                   'locationHighlights','proximity','area','roadDetails','gallery',
                   'layoutImage','locationMap','cta','seo']) {
    expect(k in thin.data).toBe(false)        // `in`, not `=== undefined`
  }
  expect(Object.keys(thin.data).sort()).toEqual(
    ['category','description','featured','highlights','image','locality','name','slug','summary'])
})
```
`null` is **not assignable to `string | undefined`** under `svfrontend`'s `strict: true`. The moment the frontend types an API response as `Project`, every `null` scalar is a compile error. Payload provides **zero** tooling for this — `select` restricts which fields are *queried*, not which keys are *emitted*, and *"the `id` field is always included in the result, regardless of your select query."* This test is 100% a test of our serialiser.

**4 — `description` round-trips as `string[]` (the Phase-1 gate).**
```ts
it('returns description as a flat array of strings', async () => {
  const doc = await payload.findByID({ collection: 'projects', id, overrideAccess: true })
  expect(Array.isArray(doc.description)).toBe(true)
  expect(doc.description.every(d => typeof d === 'string')).toBe(true)   // Local API layer

  const res = (await getPublic('/api/v1/projects/sri-city-aler-town')).data
  expect(res.description).toEqual(['First paragraph.', 'Second paragraph.'])  // HTTP layer
  expect(res.description[0]).not.toHaveProperty('value')   // not [{id, value}]
  expect(new Set(res.description).size).toBe(res.description.length)  // React-key uniqueness
})
```
Both layers, because the Local API shape and the serialised shape are different assertions.

**5 — SVG rejection and type spoofing.**
```ts
it('rejects SVG, an SVG renamed .png, and a .jpg-renamed executable', async () => {
  await expect(upload('fixtures/placeholder.svg', 'image/svg+xml')).rejects.toThrow(/415|unsupported/i)
  await expect(upload('fixtures/svg-renamed.png',  'image/png')).rejects.toThrow(/415|magic/i)
  await expect(upload('fixtures/exe-renamed.jpg',  'image/jpeg')).rejects.toThrow(/415|magic/i)
  await expect(upload('fixtures/10001px.png',      'image/png')).rejects.toThrow(/dimension/i)
  const ok = await upload('fixtures/real-photo.jpg', 'image/jpeg')
  expect(ok.filename).toMatch(/^[0-9a-f-]{36}\.jpg$/)              // UUID storage key
  expect(ok.originalFilename).toBe('real-photo.jpg')               // preserved for display
  expect(await readExif(ok)).toEqual({})                            // stripped
})
```

**6 — Rate limiting.** Not unit-testable: it is reverse-proxy configuration, and **Payload ships none of it**. Verified against staging with evidence recorded: 6 lead submissions in one minute from one IP → the 6th returns `429` **with `Retry-After`**; 4 submissions from one phone in one hour → the 4th returns `429`; 6 failed logins in 15 minutes → `429`; and **a full `next build` of svfrontend completes with zero `429`s** (the build-origin exemption, G-22).

**Plus two supporting cases that catch regressions the six above assume:**
- **Key-set snapshot per endpoint** for a thin and a fully-populated document. This — not the type test — is what catches a new internal field leaking into a public response six months from now.
- **`generate:types` produces no diff** against the committed `payload-types.ts`, run in CI, so a schema change cannot land silently.

### 18.4 Harness setup

```ts
// tests/setup.ts — loaded via vitest.config.mts `setupFiles`
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'

let instance: Payload | null = null
export const getTestPayload = async (): Promise<Payload> => {
  if (!instance) instance = await getPayload({ config })   // memoised — boot once per process
  return instance
}
```

```ts
// vitest.config.mts
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,      // one Postgres container, shared state
    testTimeout: 30_000,         // Payload boot is not instant
    teardownTimeout: 10_000,
    pool: 'forks',
  },
})
```

⚠️ **There is no documented teardown, no `payload.destroy()`, no connection-close API** (B11 §2). Test processes can therefore hang in CI holding the pg pool open. Mitigation: `fileParallelism: false`, a single memoised instance, and an explicit force-exit in the CI command. **Phase-2 exit criterion 8 is precisely this: `npm test` boots Payload, runs one trivial assertion, and *the process exits*.**

**Type sharing.** The contract tests compare serialiser output against `svfrontend/src/types/content.ts`, which means **that file must be importable by the backend**. There is **no built-in mechanism for sharing types between two Payload/Next apps** (B01, explicitly unverified). Decision: **vendor a copy** at `src/types/frontend-contract.ts` with a CI step that diffs it against the frontend file and fails on drift. A shared npm package is more machinery than two apps in one workspace justify. Budget this as real work, not a formality.

### 18.5 Commands

```jsonc
"test":          "vitest run",
"test:watch":    "vitest",
"test:unit":     "vitest run tests/unit",
"test:int":      "vitest run tests/integration",
"test:contract": "vitest run tests/contract",
"test:db":       "docker compose -f docker-compose.test.yml up -d && npm run payload migrate && vitest run tests/database",
"ci":            "payload migrate && npm run build"
```

```bash
# full local run from cold
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgres://postgres:test@localhost:5433/sv_test npm run payload migrate
DATABASE_URL=postgres://postgres:test@localhost:5433/sv_test npm test
docker compose -f docker-compose.test.yml down -v
```

---

## 19. Frontend Integration

⚠️ **This phase requires explicit human approval before a single file under `svfrontend/` is touched** (T-170). Nothing in this section may be executed before that approval exists.

### 19.1 The non-negotiable constraint, first

**NO REDESIGN (D-010).** Structure, headings, design tokens, Tailwind classes, GSAP/Lenis animation, component hierarchy, `Reveal` behaviour, the pill nav, the scroll-scrub sequences — **none of it changes.** The only thing that changes is *where the data comes from*.

Three specific consequences:

- **Most headings are not data and must not become data.** A4 §5.9 proves 9 of the 12 heading `title` values in `pages.ts` are already **dead string literals shadowed by hardcoded JSX**, and 4 of those render *completely different text* than the content string says. A further ~20 headings exist only in JSX. Migrating `pages.ts` into a CMS global would produce an editor UI whose fields **visibly do nothing** — the single worst thing a CMS can teach its users. **No `pages` collection or global. Not at Tier 1, not at Tier 2.**
- **No rich text anywhere.** `description` stays `readonly string[]`; `summary` stays a plain string.
- **The `title` / `titleAccent` split survives intact** if OQ-11 ever makes the hero editable: two adjacent `text` fields, never one, never a WYSIWYG. The `<em>` is *the headline's second line*, styled structurally in `globals.css`.

### 19.2 Where each fetch happens

The frontend has **zero fetch calls and zero environment variables today**. Every route is a Server Component prerendered at build. That property is the thing being protected.

| Consumer | Where the fetch lives | Timing | Cache directive |
|---|---|---|---|
| `getProjects()` | `src/lib/api/projects.ts`, called from Server Components | build + revalidate | `next: { revalidate: 3600, tags: ['projects'] }` |
| `getProject(slug)` | same module | build + revalidate | `next: { revalidate: 3600, tags: ['projects', \`project:${slug}\`] }` |
| `getSiteSettings()` | `src/lib/api/site.ts` | build + revalidate | `next: { revalidate: 3600, tags: ['site-settings'] }` |
| `getFaqs()` / `getStatistics()` / `getTestimonials()` | `src/lib/api/content.ts` | build + revalidate | tagged per resource |
| `generateStaticParams()` | `src/app/projects/[slug]/page.tsx` | **build only** | reuses `getProjects()` |
| `sitemap()` | `src/app/sitemap.ts` | build + revalidate | reuses `getProjects()` |
| `generateMetadata()` | `src/app/projects/[slug]/page.tsx` | build + revalidate | reuses `getProject()` — the fetch cache dedupes it against the page's own call |
| **`POST /api/v1/leads`** | `ContactForm.tsx` — **the browser** | live, on submit | `no-store`; the **only** runtime call a visitor's browser makes to the backend |

**Everything except the lead POST is server-side.** Visitors never wait on the backend; backend downtime leaves the site serving the last good build (NFR-02).

### 19.3 Caching / ISR strategy and the revalidation trigger

**ISR with on-demand revalidation (D-012).** The alternatives were evaluated and rejected on record: client-side fetching destroys SEO and LCP for a content site; full SSR ties public uptime to the backend; backend-rendered HTML throws away the entire frontend.

```
Build / revalidate:  Next.js ──fetch──► Public API ──► static HTML
Visitor request:     Visitor ────────► CDN (static HTML) ─── backend not involved
Admin publishes:     Admin ─► Payload ─► afterChange hook ─► POST /api/revalidate ─► Next rebuilds affected paths
```

- **Time-based floor:** `revalidate: 3600` on every content fetch. A safety net, not the mechanism.
- **On-demand:** an `afterChange` / `afterDelete` **collection hook** — never endpoint logic, because the admin UI publishes directly and never touches our endpoints (R-14) — POSTs to `REVALIDATE_WEBHOOK_URL` with `REVALIDATE_SECRET`, naming the affected paths.
- **Paths named on a project change:** `/`, `/projects`, `/projects/{slug}`, `/sitemap.xml`. On a `site-settings` change: **everything** — it feeds `layout.tsx`, `PillNav`, `Footer` and `robots.txt`, so this one global needs a revalidate-all path, distinct from the per-project case.
- **Fire-and-forget with retry.** A revalidation failure **must never fail the admin's save**. Direct `fetch` first (immediacy); on failure, enqueue the `revalidatePaths` job (§13). The admin sees *"Saved. The website may take a few minutes to update."* — a warning toast, not an error.
- **The frontend side** is a new route, `src/app/api/revalidate/route.ts`, that verifies the shared secret and calls `revalidateTag` / `revalidatePath`. This is the only `route.ts` in a repo that currently has none.

Without this, *"publishing silently does nothing visible — the single most confusing possible failure for an admin."*

### 19.4 The API base URL env var

The frontend currently has **no environment variables at all**. Integration adds exactly three:

| Var | Used by | Note |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | the data layer (server, build-time) **and** `ContactForm` (browser) | One variable, both sides. It must be `NEXT_PUBLIC_` because the lead POST happens in the browser. It holds a public URL, so exposure is correct — but per the docs' own warning, *"Only ever include keys that are safe for the public to read in plain text."* |
| `REVALIDATE_SECRET` | `src/app/api/revalidate/route.ts` | server-only — **no `NEXT_PUBLIC_` prefix, ever** |
| `NEXT_PUBLIC_SITE_URL` | `metadataBase`, `sitemap`, `robots` | replaces the hardcoded `site.url = 'https://www.example.com'`, which today makes **every canonical, OG url and sitemap URL wrong** |

### 19.5 What changes in svfrontend, file by file

| # | File | Change | Type |
|---|---|---|---|
| 1 | **`src/lib/api/` (new)** | `projects.ts`, `site.ts`, `content.ts` — the typed fetch layer. Every function returns **the existing types from `src/types/content.ts`, unchanged** | new |
| 2 | `src/content/projects.ts` | The literal array is deleted. `getProject`, `usedCategories`, `featuredProjects` move to the data layer and become `async`. `categoryOrder` **stays in code** — it is structural display order, a 4-value closed set, and changing it requires a deploy regardless | rewrite |
| 3 | `src/content/site.ts` | The literal object is deleted and replaced by `getSiteSettings()`. `nav` / `footerNav` **structure stays in code** (route structure is code) — but see row 8 | rewrite |
| 4 | `src/content/pages.ts` | **Mostly unchanged.** Only the keys with real render sites and a CMS home move. `home.benefits`, `home.hero.lead/primaryCta/secondaryCta`, `location.intro.title/lead`, `media.hero`, `media.heroPortrait` are **deleted** — all have zero consumers, and the last two point at files that do not exist | prune |
| 5 | `next.config.mjs` | **Add `images.remotePatterns`** for the CDN host, the bucket host, and the Payload host if media is ever proxied. Keep `pathname` tight. 🔴 **Without this, six `next/image` call sites throw `Invalid src prop … hostname is not configured` the instant URLs become remote** — this is the single highest-probability breakage in the phase | **CRITICAL** |
| 5a | `next.config.mjs` | Extend `qualities: [75, 90]` if any CMS image needs a third value — `Logo.tsx:28` is the only non-default today and Next **rejects** unlisted quality values | edit |
| 5b | `next.config.mjs` | **Delete `dangerouslyAllowSVG`, `contentDispositionType`, `contentSecurityPolicy`** (3 lines) — but **only after** real raster art replaces every placeholder. Its stated justification (*"the files are first-party"*) evaporates the moment a CMS can upload | deferred |
| 6 | `src/components/sections/ContactForm.tsx` | Replace the deliberate dead-end at `:45-50` with a real `fetch` to `POST /api/v1/leads`. **Success only on a real `201`.** Map server `422` `details[].field` into the existing `Errors` map — the server's field names (`name`, `phone`, `project`, `message`) match the input `name` attributes exactly, **so the inline error slots need no redesign**. Add a pending state and a double-submit guard (neither exists today). Widen the `Errors` type from `'name' \| 'phone'` to include `'project' \| 'message'` | **CRITICAL** |
| 6a | `ContactForm.tsx:8` | 🔴 **The hard one.** It is a `'use client'` module that **imports `projects` directly**. A client module cannot import server-fetched data. The project list must become a **prop** passed down from `src/app/contact/page.tsx` | **CRITICAL** |
| 7 | `src/app/projects/[slug]/page.tsx` | `generateStaticParams()` becomes `async` and sources slugs from `getProjects()`. `dynamicParams` is **left at its default `true`** — that is the natural ISR hook for a project created after the last build | edit |
| 8 | `src/content/site.ts` nav + footer project children | 🔴 **`README.md:42` is factually wrong**: *"Adding a project … creates its dropdown entry … automatically."* The nav (`:41-49`) and footer (`:78-86`) hold **hardcoded lists of five slugs**. Derive both from the published projects (FR-CONT-11), or a CMS-added project is invisible in navigation | **CRITICAL** |
| 9 | `src/app/sitemap.ts` | Becomes `async`; sources projects from the data layer; **adds `lastModified` from `publishedAt`** (there is no timestamp in the content model today to derive one from) | edit |
| 10 | `src/app/robots.ts` + `src/app/layout.tsx:53` | **Two independent indexing blocks** (`disallow: '/'` and `robots: { index: false }`), both hardcoded. Make them env-gated so staging and production can differ, and lift both at launch | edit |
| 11 | The 7 static pages' `export const metadata` | A module-level constant cannot `await`. Each becomes `export async function generateMetadata()`. `/projects/[slug]` already uses `generateMetadata` and is fine | edit ×7 |
| 12 | `src/app/page.tsx`, `about`, `contact`, `location`, `master-plan`, `amenities`, `projects` | Become `async` where they are not already; `await` the data layer. `app/projects/page.tsx` calls `usedCategories()` **inline in JSX** today and must become `async` to `await` it | edit |
| 13 | **`src/app/api/revalidate/route.ts` (new)** | Shared-secret verification + `revalidateTag`/`revalidatePath`. The repo has **no `route.ts` anywhere** today | new |
| 14 | `src/lib/href.ts` | 🔴 **Add `mailHref()`.** `Footer.tsx:51` and `contact/page.tsx:22` build `` `mailto:${site.email}` `` — the bracket ends up *inside* the string, `isPlaceholder()` returns false, and **a live `mailto:[EMAIL@DOMAIN]` ships on every page today**. Three-line helper, mirroring the existing `telHref()` | **CRITICAL bugfix** |
| 15 | `src/app/contact/page.tsx:21` | 🔴 `href: site.whatsapp` — the **raw digit string**, not a URL. Inert today only by accident. The moment it holds `919XXXXXXXXX` it becomes a **relative link to `/919XXXXXXXXX`** → 404. Fix to `` `https://wa.me/${site.whatsapp}` `` (the correct construction already exists at `EnquiryPill.tsx:39`) | **CRITICAL bugfix** |
| 16 | `app/page.tsx:66`, `app/projects/page.tsx:19-21`, `Hero.tsx:105` | Three count-coupled hardcoded strings — **"Five layouts."** ×2 and "Aler · Bhongir · Genome Valley". Publishing a sixth project silently makes the site lie (OQ-10). Derive or reword | IMPORTANT |
| 17 | React keys | Keys are derived from content strings (`key={paragraph}`, `{item.title}`, `{item.place}`, `{stat.label}`, `{image.src}`, `{tile.src}`). Backend uniqueness validators cover `description`; `key={tile.src}` on `PinnedProof` collides **today** if two projects share an image. Either switch those to index/id keys or accept the backend guard | DEFERRED |
| 18 | `ProjectCatalogue.tsx` | **No change.** It already receives `projects` as a prop — correct by construction. Its `Project` objects cross the RSC boundary, so serialiser output must be JSON-serialisable: **no `Date` objects, no class instances** | none |
| 19 | `ProjectDetail.tsx`, `ProjectCard.tsx`, `FeatureList.tsx`, `Media.tsx`, `Lightbox.tsx` | **No change.** All are Server Components (or prop-driven) and the data shape is identical. `Lightbox`'s two raw `<img>` tags need **no** `remotePatterns` config — but also get **no** optimisation | none |
| 20 | Error / loading / fallback states | The repo has **no `loading.tsx`, no `error.tsx`, no `template.tsx`** anywhere. Add `error.tsx` at the root and `not-found` handling for a slug that 404s from the API. **`loading.tsx` is deliberately NOT added** — pages are static; a loading skeleton on a prerendered page is a visual regression, not an improvement | new (error only) |

### 19.6 The migration sequence — shippable at every step

The rule: **the adapter layer lands first, returning the same types from the same static data. The source is swapped last.** At no point is the site broken.

| Step | What ships | Shippable? |
|---|---|---|
| **1** | Create `src/lib/api/*` whose functions return **the existing static arrays**, typed exactly as today. Convert every consumer to `await` them. Convert the 7 `export const metadata` to `generateMetadata`. Make `sitemap`, `generateStaticParams` and the pages `async`. | ✅ Identical output. Pure refactor, zero behaviour change. |
| **2** | Lift `ContactForm`'s `projects` import to a prop from `app/contact/page.tsx`. | ✅ Identical output; removes the client-boundary violation. |
| **3** | Fix the two latent href bugs (`mailHref()`, `wa.me`). | ✅ Strictly a bugfix — `mailto:[EMAIL@DOMAIN]` stops shipping live. |
| **4** | Add `images.remotePatterns` and `NEXT_PUBLIC_*` env vars. Nothing consumes them yet. | ✅ Inert config. |
| **5** | Add `src/app/api/revalidate/route.ts`. Still nothing calls it. | ✅ Inert route. |
| **6** | **Swap the source**: the data-layer functions now `fetch` the public API instead of returning static arrays. **The types, the call sites and the rendered output are unchanged.** | ✅ This is the only risky step, and it is one module. |
| **7** | Derive nav + footer project children from published projects. | ✅ |
| **8** | Wire `ContactForm` to `POST /api/v1/leads`. | ✅ Success only on a real `201`. |
| **9** | Verify the performance contract (§19.7), then fix the count-coupled strings. | ✅ |
| **10** | Once real raster art lands: remove `dangerouslyAllowSVG`. | ✅ |

**Rollback at any step is a `git revert` of one commit.** Step 6 is the only one that changes runtime behaviour, and reverting it restores the static arrays.

### 19.7 The acceptance gate (T-182)

The performance contract is measurable and can fail. All of it must still hold:

- **All routes still prerender** — `.next/prerender-manifest.json` lists the same set, plus any new project.
- **LCP < 2.5 s**, **CLS < 0.05**, First Load JS within **102–114 kB**.
- `tsc --noEmit` clean under TS 5.9 strict with `noUncheckedIndexedAccess`.
- **No horizontal overflow at any width from 320 px to 1920 px.**
- Publishing an edit in the admin makes it appear on the site **without a redeploy**.
- The contact form shows success **only** on a real `201`; a `422` renders inline in the existing slots **with no redesign**; a `500` shows a failure state and a request id.
- Adding a 6th project through the CMS makes it appear in the catalogue, the nav dropdown, the footer column, the sitemap **and** `generateStaticParams` — with **no hand-edited slug list anywhere**.
- `[BRACKETED]` values still render inert.

**CLS is the metric most directly threatened.** `Plate` and `ProjectCard` use the intrinsic `width`/`height` from `ImageRef`; if the serialiser emits wrong or missing dimensions, CLS regresses past budget. That is why `media.width`/`media.height` are server-extracted and owned by us (§15 row 12) rather than trusted to undocumented auto-added fields.

---

## 20. Production Deployment

### 20.1 What the official Payload deployment docs actually support

Payload takes a **deliberately platform-agnostic position** and recommends no vendor: *"Payload can be deployed anywhere that Next.js can run — including Vercel, Netlify, SST, DigitalOcean, AWS, and more. Because it's open source, you can self-host it."* With the caveat: *"most Payload projects will also need a database, file storage, an email provider, and a CDN."*

What is **first-class documented**: a complete multi-stage **Dockerfile** (base image `node:24-alpine`), a hard requirement of `output: 'standalone'`, the `payload migrate && build` CI ordering, `prodMigrations` as the long-running-server alternative, storage adapters, and the `jobs:run --cron` worker compose snippet.

What is **documented but serverless-only and therefore irrelevant to us**: `@payloadcms/db-vercel-postgres`, the 4.5 MB Vercel upload cap and `clientUploads`, *"Never use `autoRun` on serverless platforms"*, `@payloadcms/email-resend` as the lightweight serverless choice.

What is **documented nowhere**: backup/restore, health checks, security headers, rate limiting, connection-pool sizing, sharp's native-binary deployment caveats, zero-downtime/expand-contract guidance, migration locking. All of it is ours.

**D-015's shape — self-hosted, Docker, Postgres, S3-compatible — sits squarely on the best-documented path** and avoids every serverless caveat above. No technical blocker to D-015 was found. Do not reopen it.

### 20.2 The final production architecture

Sized for this project's actual scale: five projects, tens of leads a month, two admins, a site whose public traffic never touches the backend.

```
                    ┌──────────────────────────────────────────────┐
  visitors ────────►│  CDN / static host  ·  www.<domain>          │  svfrontend
                    │  prerendered HTML — backend NOT involved     │  (separate deploy)
                    └──────────────┬───────────────────────────────┘
                                   │ build + on-demand revalidate (server-side fetch)
                                   │ POST /api/v1/leads (the ONE live browser call)
                                   ▼
                    ┌──────────────────────────────────────────────┐
                    │  reverse proxy · TLS · HSTS · RATE LIMITING  │  ← rate limiting lives HERE
                    │  blocks /api/<collection-slug> not ours      │     (Payload ships none)
                    └──────────────┬───────────────────────────────┘
                                   │  cms.<domain>   ← subdomain of the SAME registrable
                    ┌──────────────▼───────────────────────────────┐    domain, so SameSite=Lax holds
                    │  container: cms          (node server.js)    │
                    │  container: worker-default     (jobs:run)    │
                    │  container: worker-maintenance (jobs:run)    │
                    └────────┬──────────────────────┬──────────────┘
                             │                      │
                   ┌─────────▼────────┐   ┌─────────▼──────────┐
                   │  PostgreSQL 15+  │   │  S3-compatible     │──► CDN  media.<domain>
                   │  TLS, PITR/dump  │   │  bucket versioning │     (separate origin)
                   └──────────────────┘   └────────────────────┘
```

### 20.3 Hosting — an owner decision, with a recommendation and criteria

**No vendor has been chosen and this plan does not choose one.** What *is* decided is the **shape**: a long-running container host, not serverless. That follows from D-015, from the job worker, and from the fact that every serverless caveat in the docs exists to work around constraints we do not have.

**Recommendation: a single small VPS (2 vCPU / 4 GB) running Docker Compose, plus a managed PostgreSQL instance, plus an S3-compatible bucket behind a CDN.** Reason in one line: three containers, one database, tens of writes a month — orchestration beyond Compose is machinery with no workload to justify it, and a managed Postgres buys PITR and patching that we would otherwise have to build (§15 row 37).

**The criteria the owner should decide against:**

| Criterion | Why it matters here |
|---|---|
| **Region** | Audience is Indian; keep app and database **in the same region** — the docs warn proximity *"can significantly impact performance"* |
| **Managed Postgres with PITR** | Payload documents **no backup procedure at all** while shipping `migrate:fresh`. Managed PITR converts NFR-10 from a build item into a configuration item |
| **Persistent vs ephemeral filesystem** | The docs list *"Heroku, DigitalOcean Apps"* as ephemeral and *"DigitalOcean Droplets, Amazon EC2"* as persistent. We use S3 for media anyway, but `useTempFiles` needs a writable `/tmp` |
| **Can it run a second long-lived process?** | The job worker is a separate container. A host that only runs one web process forces the `autoRun` fallback |
| **Subdomain control** | `cms.<domain>` must be a subdomain of the public site's registrable domain, or admin cookies become third-party (§15 row 6a) |
| **Egress cost for media** | Media is served from the bucket/CDN, not the app |
| **Who holds the credentials** | Two vendor relationships (storage, email) become DPDP sub-processors and must be named in the privacy policy (OQ-24) |

**Explicitly ruled out: Vercel for the backend.** Not because it cannot run Payload — it can — but because it forces the 4.5 MB upload cap + `clientUploads`, forbids `autoRun`, penalises `prodMigrations` on cold start, and would still need a separate worker. All of that is friction bought for a workload that does not need it.

### 20.4 The concrete stack

| Layer | Choice | Detail |
|---|---|---|
| **Node runtime** | **Node 24 LTS-line** (`node:24-alpine`, matching Payload's own documented Dockerfile) | Docs say *"Node.js version 20.9.0+"* with **no upper bound**; `payload@3.90.x` engines are `^18.20.2 \|\| >=20.9.0`. Set `svbackend` `engines.node: ">=20.9.0"` — **do not copy svfrontend's `<23`**, or the backend refuses to install on the machine it is being built on. Add a per-app `.nvmrc`. Note Payload 4 will need ≥24.15.0 (local is 24.11.0) |
| **Next.js** | pinned **exactly**, inside a supported range — the official blank template pins `16.3.3` | `15.5.x` is **outside every supported range**, and the published `@payloadcms/next` peer range is tighter than the docs (`>=16.3.3 <17`). **Never match the frontend's version.** No `^`, no `~` |
| **Build output** | `output: 'standalone'` inside the config wrapped by `withPayload(...)` | Required by the documented Dockerfile; `server.js` is produced by `next build` |
| **Container** | Payload's official multi-stage Dockerfile verbatim as the baseline | We use npm, so the `npm ci` branch fires — **`package-lock.json` must be committed** |
| **Package manager** | **npm 11.6.1** | yarn 1.22.22 is **explicitly unsupported**; pnpm is absent. Every documented `pnpm payload …` command must be translated once, in writing. `cross-env` is a required dependency (the docs' own script uses it) |
| **Postgres** | **15+**, managed, TLS, PITR, encryption at rest | ⚠️ The **minimum supported Postgres version is NOT VERIFIED IN OFFICIAL DOCS** — the adapter page states none. 15+ is our floor. `disableCreateDatabase: true` |
| **Object storage** | S3-compatible + CDN on a **separate origin** (`media.<domain>`) | `@payloadcms/storage-s3`, `s3Storage({ enabled: Boolean(env.S3_BUCKET), … })`. `endpoint` and `forcePathStyle` are **AWS-SDK pass-throughs that Payload's docs never name** — valid, but unverified by Payload |
| **Bucket/CDN policy** | public-read; `Cache-Control: public, max-age=31536000, immutable`; `nosniff`; `Content-Disposition: attachment` for PDFs | 🔴 **`s3Storage()` cannot set any of these.** They are bucket/CDN configuration. This split must be written into `SECURITY.md` or it will be forgotten |
| **Domain / HTTPS** | `www.<domain>` (site), `cms.<domain>` (admin+API), `media.<domain>` (CDN) | TLS at the proxy; HSTS long max-age; TLS 1.2+; auto-renewal |
| **Email** | SMTP via `nodemailerAdapter` | Provider is an owner decision (§14.6); the code does not change |
| **sharp** | installed, imported, and **passed to `buildConfig`** | Required for `imageSizes`/crop/focal point. ⚠️ **Deployment caveats are documented nowhere** — musl vs glibc, cross-arch prebuilds, `npm ci --omit=optional`. Classic symptom: build green, **first upload throws at runtime**. The only reliable detector is uploading a real image in a staging container as part of the deploy smoke test |

### 20.5 Env vars in production

All from the platform secret store, **distinct per environment**, never committed, never logged. Full table in §22. Production-specific values: `NODE_ENV=production`, `DISABLE_LOGGING` unset, `LOG_LEVEL=info`, `PAYLOAD_SEED` **unset** (a set value is how a seed runs by accident), `debug: false` derived from `NODE_ENV`.

### 20.6 The migration step in the pipeline

Covered in full in §16.6 mode (c). The pipeline-level summary:

```
npm ci
  → npm run payload migrate:status      # read-only gate; prints what would run
  → pg_dump -Fc                          # MANDATORY pre-migration backup
  → npm run payload migrate              # SEPARATE pre-deploy job, DDL-capable role
  → payload generate:importmap && next build
  → build + push image
  → deploy cms
  → /healthz green
  → restart workers
```

Two rules that belong to the pipeline specifically: **`generate:importmap` runs inside the build**, before `next build` — the import map *"never regenerates during normal runtime or after production builds"*, so a stale map is a **production-only** component-not-found crash. And **`migrate:fresh` / `migrate:reset` appear in no script, ever.**

### 20.7 Backups

100% ours — Payload documents none of it.

| What | How | Cadence | Verified by |
|---|---|---|---|
| Postgres | managed PITR, **or** `docker run postgres:15 pg_dump -Fc` (⚠️ **`psql` is not on PATH on this machine** — all client tooling goes through Docker) | nightly + before every migration | **an actual restore into a scratch environment** |
| Media | **S3 bucket versioning** + lifecycle rules | continuous | restore one deleted object and re-attach it |
| Consistency between the two | Documented, not automated: restoring Postgres to T leaves objects uploaded after T as harmless orphans, and objects deleted after T as broken images recoverable from bucket versioning | — | written into the runbook |

**NFR-10 is not satisfied by having backups. It is satisfied by having restored one.** This is a Phase-3 exit criterion, repeated in Phase 10 and in the §15 checklist, precisely because it is the control everyone plans and nobody executes.

### 20.8 The jobs worker / cron

Two extra containers, both `restart: unless-stopped`, both scaled to **exactly one replica**:

- `worker-default` — `npx payload jobs:run --cron "* * * * *" --queue default --limit 25`
- `worker-maintenance` — `npx payload jobs:run --cron "*/15 * * * *" --queue maintenance --handle-schedules`

`--handle-schedules` appears on **one** container only; multiple schedulers queue duplicate jobs, which the docs call out by name. Neither worker serves HTTP. Both must be **restarted after every deploy** so they run the new code.

🔴 **Silent worker death is the defining operational risk of this deployment.** If the worker dies, `jobs.queue()` still succeeds, leads still save, the API still returns `201`, and **zero notifications go out with no error anywhere in the request path**. Worker liveness is a first-class alert, not a nice-to-have.

### 20.9 Health checks

Payload exposes **no health-check endpoint** — verified absent; full-text search of the 3.x docs for "health" returns nothing relevant. 100% ours.

- **Readiness** — `src/app/healthz/route.ts`, a **root Next.js Route Handler** (a Payload `endpoints` entry is *always* mounted under `routes.api`, so `/healthz` could not live there). `export const dynamic = 'force-dynamic'` or it may be statically generated at build. Body: `{ status: 'ok' }` / 503. DB probe via `payload.db.drizzle` with `sql` imported from `@payloadcms/db-postgres/drizzle` — **keep the query trivial and the probe interval sane: every probe consumes a pool connection.**
- **Liveness** — a separate, DB-free route. A degraded database should not cause the orchestrator to kill a healthy process.
- **Worker liveness** — not an HTTP check. Monitor queue depth and oldest-pending-job age.

### 20.10 Scaling expectations

**One CMS replica is the correct answer, and scaling out is a real decision, not a slider.** Reasons: `--handle-schedules` must run on exactly one process; concurrent-deploy migration races are undocumented; and the actual workload is five projects plus tens of writes a month. If a second replica is ever added: serialise deploys, keep `--handle-schedules` on one worker only, and keep `pool.max × replicas` comfortably under Postgres `max_connections` — Payload publishes **no pool-sizing guidance whatsoever**.

Public read traffic does **not** scale the backend: under ISR it is served from the CDN as static HTML.

### 20.11 Logging

Pino, already built in. Production: the default JSON-to-stdout, collected by the container log driver — that **is** structured logging, no extra work. Development: `pino-pretty` via a **pre-instantiated logger**. 🔴 **Never use Pino `transport`** — documented to fail with *"unable to determine transport target"* under ESM/bundling, and Payload is fully ESM. Never `pino.destination('/var/log/…')` — the official Dockerfile runs as `USER nextjs` (uid 1001), which cannot write there anyway.

Ours to add: request-id correlation, PII/secret redaction, log shipping and retention, alerting.

### 20.12 Rollback

Governed by §16.6's additive-vs-destructive distinction, which belongs in the runbook verbatim:

1. **Migrate step failed** → the deploy was already rejected, the previous release is still serving. Triage, do not retry blindly.
2. **New release is running and misbehaving, last migration was additive** → redeploy the previous image, **leave the schema forward**. Old code ignores new nullable columns. ~2 minutes.
3. **Last migration was destructive** → a code rollback is **not** safe. `migrate:down` rolls back a *batch*, and an auto-generated `down` restores structure, not data. Choose: restore from the pre-migration backup and accept losing writes since, **or fix forward** with a new migration and a new release. **Default posture: fix forward.**
4. **Frontend** deploys independently; its rollback is a redeploy of the previous build.

### 20.13 The deployment ORDER

**First-time go-live**, each step gating the next:

```
 1. Decide + provision: host, region, Postgres, bucket + CDN, DNS for
    www / cms / media, TLS certificates
 2. Reverse proxy: TLS, HSTS, security headers, rate limits (+ build-origin exemption),
    the /api/<collection-slug> block rule
 3. Secrets into the platform store; PAYLOAD_SECRET >= 32 bytes, unique to production
 4. Create the database; app role WITHOUT DDL, migrate role WITH DDL
 5. pg_dump baseline (of an empty database — it proves the tooling works)
 6. npm run payload migrate:status  →  npm run payload migrate
 7. Build + push the image (generate:importmap runs inside the build)
 8. Deploy the cms container; /healthz green
 9. PAYLOAD_SEED=true npm run seed   → 2 admins, site-settings, 5 projects, 9 media assets
10. Rotate the seeded admin passwords; confirm no default credentials remain
11. Deploy worker-default and worker-maintenance
12. Upload one real image in production  ← the ONLY reliable sharp native-binary check
13. Point svfrontend at NEXT_PUBLIC_API_BASE_URL; build and deploy the frontend
14. Verify revalidation end to end: publish a change, watch it appear without a redeploy
15. Execute the §15.3 checklist, with evidence per item
16. Perform a restore drill into a scratch environment (NFR-10)
17. Publish and link the privacy policy   ← BLOCKS LAUNCH (OQ-24)
18. Lift BOTH indexing blocks: robots.ts disallow AND layout.tsx robots.index
19. Go-live smoke: a synthetic lead flows end to end INCLUDING the notification
    landing in the sales inbox; an admin publishes and the change appears;
    alerts fire on a simulated failure (kill the worker, break SMTP, stop the DB)
```

**Steady-state deploy** is steps 6–8 plus 11, in that order, serialised, with step 5's backup first.

### 20.14 Monitoring and alerts

Minimum viable, all ours: error rate, **lead-submission failure rate**, **job queue depth and oldest-pending-job age**, **worker liveness**, health-check probe, database connection count, disk. Alert on a **second channel** for anything email-related — the failure being detected may be that email is broken.

Three alarms that must exist on day one, because each corresponds to a failure that is otherwise **silent**: the worker is dead; a `sendLeadNotification` job has `hasError: true`; `/healthz` has been 503 for more than one interval.

---

## 21. Repository Structure

> 🔴 **NO FILES ARE CREATED BY THIS INVESTIGATION.** Everything below is a specification of what the MASTER IMPLEMENTATION PROMPT will create. Nothing under `c:/progromming/SV DEVELOPERS/svfrontend` or `c:/progromming/SV DEVELOPERS/svbackend` has been created, edited or deleted. `svbackend/` currently contains **only `docs/`** and **is not a git repository**.

**Two preconditions before the first file exists.** (1) `git init` `svbackend/` so the 3 495 lines of existing specification have history and the scaffold is a reviewable diff. (2) ⚠️ **Whether `create-payload-app` refuses a non-empty directory is NOT VERIFIED IN OFFICIAL DOCS** — scaffold into a temp directory, then move `docs/` in, then commit.

### 21.1 The complete file map

```
svbackend/
├── .env.example                      # committed template — real .env* are gitignored (§22)
├── .gitignore                        # must block .env*, .next, node_modules, /media (local disk)
├── .nvmrc                            # per-app Node expectation, independent of svfrontend
├── package.json                      # engines.node ">=20.9.0" — NOT svfrontend's "<23"
├── package-lock.json                 # committed — the official Dockerfile's `npm ci` branch needs it
├── next.config.mjs                   # ESM required: withPayload(...) + output:'standalone' + headers()
├── tsconfig.json                     # strict; paths: { "@payload-config": ["./src/payload.config.ts"] }
├── vitest.config.mts                 # fileParallelism:false, setupFiles, 30s timeout (§18.4)
├── Dockerfile                        # Payload's official multi-stage file, node:24-alpine
├── docker-compose.yml                # local Postgres + MinIO sandbox (disposable)
├── docker-compose.test.yml           # disposable Postgres for the test suite, port 5433
├── README.md                         # THE house rules: push-vs-migrate, never migrate:fresh, npm not pnpm
│
├── docs/                             # ← ALREADY EXISTS. 18 specification documents. Preserved, not moved.
│
└── src/
    ├── payload.config.ts             # the single config: db, secret, collections, globals, endpoints,
    │                                 #   jobs, email, cors, csrf, graphQL:{disable:true}, admin, upload
    ├── payload-types.ts              # GENERATED by `payload generate:types`. Committed. CI diff-checked.
    ├── payload-generated.schema.ts   # GENERATED by `payload generate:db-schema`. Read before migration 001.
    │
    ├── app/
    │   ├── (payload)/                # VENDOR CODE — generated, never edited, never linted, never reviewed
    │   │   ├── admin/[[...segments]]/page.tsx     # the Admin Panel
    │   │   ├── admin/importMap.js                 # regenerated by generate:importmap; NEVER hand-edited
    │   │   ├── api/[...slug]/route.ts             # Payload's REST catch-all (REST_GET/POST/...)
    │   │   ├── api/graphql/route.ts               # present but DISABLED via graphQL.disable
    │   │   ├── api/graphql-playground/route.ts    # ditto
    │   │   ├── custom.scss                        # the sanctioned admin-styling hook
    │   │   └── layout.tsx                         # a ROOT layout; safe to edit for folder structure only
    │   ├── (public)/
    │   │   └── api/v1/                            # OUR public surface — Next Route Handlers, §21.2
    │   │       ├── projects/route.ts              # GET card fields, published, in admin order
    │   │       ├── projects/[slug]/route.ts       # GET full record; 404 for unpublished/archived
    │   │       ├── site-settings/route.ts         # GET
    │   │       ├── testimonials/route.ts          # GET — published AND consented only
    │   │       ├── faqs/route.ts                  # GET
    │   │       ├── statistics/route.ts            # GET
    │   │       └── leads/route.ts                 # POST — the only public write in the system
    │   ├── healthz/route.ts          # readiness + DB probe. MUST be outside /api. force-dynamic.
    │   └── livez/route.ts            # liveness, no DB touch
    │
    ├── collections/                  # one file per collection; each exports a CollectionConfig
    │   ├── Users.ts                  # auth:true, sessions, lockout, password policy, forgotPassword
    │   ├── Media.ts                  # upload: images only; pasteURL:false; join fields; trash
    │   ├── Documents.ts              # upload: PDF only — a SECOND collection because one cannot
    │   │                             #   express two mimeTypes allow-lists (Tier 2)
    │   ├── Projects.ts               # the core entity: 25 fields, 6 arrays, 4 uploads, tabs, orderable
    │   ├── Leads.ts                  # PII; no versions; trash; server-assigned provenance
    │   ├── AuditLog.ts               # append-only: create/update/delete all () => false
    │   ├── Testimonials.ts           # Tier 2 — the consent gate lives here
    │   ├── Faqs.ts                   # Tier 2
    │   └── Statistics.ts             # Tier 2 — label/value both TEXT, never derived
    │
    ├── globals/
    │   └── SiteSettings.ts           # the only global. versions:{max:50}, drafts:false, access.read:()=>true
    │
    ├── fields/                       # reusable field factories — one definition, many call sites
    │   ├── iconField.ts              # select over the 41 IconName values, enumName:'enum_icon_name'
    │   ├── slugField.ts              # HAND-ROLLED. Payload's own slugField() helper is documented as
    │   │                             #   "experimental and may change, or even be removed" — slugs are public URLs
    │   ├── featureItemFields.ts      # { icon, title, body? } — shared by 4 arrays
    │   └── placeholderText.ts        # text field tolerant of ^\[.*\]$ (bypasses format, keeps length)
    │
    ├── access/                       # the ENTIRE authorisation model — four functions, no RBAC scaffolding
    │   ├── isAdmin.ts
    │   ├── anyone.ts
    │   ├── nobody.ts
    │   └── publishedOrAuthenticated.ts   # user ? true : { _status: { equals: 'published' } }
    │
    ├── hooks/
    │   ├── audit.ts                  # afterChange/afterDelete → audit-log; the sensitive-field differ
    │   ├── authEvents.ts             # afterLogin/afterLogout/failed/lockout/password change → audit-log
    │   ├── revalidate.ts             # afterChange/afterDelete → direct fetch, job on failure (D-012)
    │   ├── uploadGuard.ts            # beforeOperation: sniff → SVG reject → dimensions → EXIF → UUID rename
    │   ├── mediaDeleteGuard.ts       # beforeDelete: join counts → 409 with the usage list (FR-MEDIA-08)
    │   ├── slugLock.ts               # beforeValidate: reject a slug change on a published doc (FR-PROJ-18)
    │   ├── publishedAt.ts            # beforeChange: stamp on the draft → published transition
    │   ├── leadNormalise.ts          # beforeValidate: trim, NFC, phone → E.164, strip HTML from message
    │   ├── leadDedupe.ts             # beforeValidate: windowed (phoneNormalised, projectSlug) check
    │   └── enqueueLeadNotification.ts# afterChange(create): jobs.queue inside try/catch
    │
    ├── endpoints/                    # kept EMPTY by decision — see §21.2
    │
    ├── serializers/                  # the single control point for the public contract (D-008 + P3)
    │   ├── toPublicProject.ts        # built key-by-key; `...doc` spread is BANNED in this directory
    │   ├── toPublicProjectCard.ts    # the thinner list shape
    │   ├── toPublicSiteSettings.ts   # computes copyrightText; never emits updatedBy or internal ids
    │   ├── toImageRef.ts             # populated upload doc → { src, alt, width, height }
    │   └── put.ts                    # the omit-don't-empty primitive; ONE documented emptiness rule
    │
    ├── schemas/                      # Zod — one definition per shape (NFR-11)
    │   ├── lead.ts                   # the POST /leads body; rejects unknown properties
    │   └── env.ts                    # the fail-fast env module (§22.2)
    │
    ├── lib/
    │   ├── publicFind.ts             # FORCES overrideAccess:false + user:undefined + published where + select
    │   ├── definePublicEndpoint.ts   # wraps every handler: headersWithCors, cache headers, ETag, envelope
    │   ├── errors.ts                 # the 9 top-level codes, the details[].code vocabulary, requestId
    │   ├── logger.ts                 # pre-instantiated pino — never Pino `transport`
    │   ├── icons.ts                  # ICON_NAMES: the 41 values, one source of truth (CI-diffed)
    │   └── cache.ts                  # Cache-Control + ETag helpers
    │
    ├── jobs/
    │   ├── sendLeadNotification.ts
    │   ├── revalidatePaths.ts
    │   ├── sweepDeletedMedia.ts
    │   ├── purgeLeadPii.ts
    │   └── watchdogFailedJobs.ts
    │
    ├── email/
    │   ├── renderBrandedEmail.ts     # the one shared layout function
    │   ├── renderLeadEmail.ts        # HTML + plaintext
    │   └── escapeHtml.ts             # ONE reviewed, unit-tested helper. Payload provides none.
    │
    ├── media/
    │   ├── sniff.ts                  # magic-byte detection
    │   ├── dimensions.ts             # sharp().metadata() — we OWN width/height
    │   └── storage.ts                # s3Storage({ enabled: Boolean(env.S3_BUCKET), ... }) + generateFileURL
    │
    ├── migrations/                   # migrationDir, set explicitly
    │   ├── index.ts                  # GENERATED — exports the `migrations` array
    │   └── YYYYMMDD_HHMMSS_<name>.ts # one per logical change, named, reviewed before commit
    │
    ├── seed/
    │   ├── index.ts                  # run via `payload run src/seed/index.ts`; PAYLOAD_SEED gate
    │   ├── data/projects.ts          # the 5 records, verbatim. Imported by the contract tests as fixture.
    │   ├── data/siteSettings.ts      # bracketed placeholders preserved byte-for-byte
    │   ├── assets/                   # the RASTERISED placeholders (PNG). Committed. §17.4
    │   └── rasterise.ts              # one-off SVG → PNG script; output is committed, not generated at seed time
    │
    ├── scripts/
    │   ├── resetSandbox.sh           # docker compose down -v && up -d — so nobody reaches for migrate:fresh
    │   ├── checkIconDrift.ts         # diffs lib/icons.ts against svfrontend Icon.tsx; fails CI on drift
    │   └── checkContractDrift.ts     # diffs the vendored types against svfrontend/src/types/content.ts
    │
    ├── types/
    │   └── frontend-contract.ts      # VENDORED copy of svfrontend/src/types/content.ts. CI-diffed.
    │                                 #   There is NO built-in cross-app type sharing in Payload.
    │
    └── components/admin/             # optional; every one needs `generate:importmap` in the build
        ├── RowLabel*.tsx             # 'use client' + useRowLabel — so rows read as titles, not "Item 03"
        ├── BeforeLogin.tsx           # branding
        └── graphics/{Logo,Icon}.tsx  # branding

tests/
├── setup.ts                          # memoised getPayload({ config }) singleton
├── factories/                        # minimal builders: thinProject(), fullProject(), lead()
├── fixtures/                         # real files: placeholder.svg, svg-renamed.png, exe-renamed.jpg, 10001px.png
├── unit/                             # serialisers, put(), escapeHtml, phone, slugify, differ
├── integration/                      # collection behaviour via the Local API
├── contract/                         # response shape vs types/content.ts + key-set snapshots
├── access/                           # the authz matrix, incl. readVersions and the lead-leak test
├── upload/                           # SVG, magic bytes, size, dimension bomb, EXIF, UUID rename
├── auth/                             # lockout, password policy, session revocation
├── jobs/                             # runByID, idempotency, JobCancelledError, the boot guard
└── database/                         # migrate up/down, generate:types diff, enum existence
```

### 21.2 Why `src/endpoints/` is empty — the decision

**All seven public routes are Next.js Route Handlers under `src/app/(public)/api/v1/`, not Payload `config.endpoints`.**

Both mechanisms are documented and both work. **Mixing them is the failure mode** — inconsistent error shapes, inconsistent auth behaviour, two places to remember `headersWithCors`. So one is chosen and enforced.

Route Handlers win on the point that actually matters: **Payload `config.endpoints` are *always* mounted under `routes.api`** (default `/api`). Our contract specifies `/api/v1/...`, and `/healthz` explicitly **outside** `/api` — neither is expressible as a Payload endpoint without moving Payload's own REST surface. ⚠️ Note that **B05's claimed `root: true` endpoint property does not exist in the v3 docs** (verified absent); do not design around it.

The cost is that a Route Handler receives a plain `Request`, not a `PayloadRequest` — no `req.user`, no `req.routeParams`, no transaction-carrying `req`. That cost is nil for us: the public surface is six unauthenticated reads plus one unauthenticated write that opens its own transaction.

`src/endpoints/` stays in the tree as a deliberate empty marker with a README line explaining the decision, so the next person does not re-litigate it silently.

### 21.3 The four directories that are guard rails, not code

These exist because a rule that lives only in a review checklist is a rule that will be broken:

| Directory | The rule it enforces | How it is enforced |
|---|---|---|
| `src/lib/publicFind.ts` | `overrideAccess: false` + `user: undefined` + published-only `where` + include-mode `select`, on **every** public read | A lint/CI rule fails the build if `payload.find` or `payload.findByID` appears in `src/app/(public)/**` without going through it (Phase-2 exit criterion 5) |
| `src/serializers/` | No `...doc` spread; output built key by key | Review rule + the key-set snapshot suite |
| `src/access/` | Four functions, no RBAC scaffolding, every collection declares all of them explicitly | A config test enumerates collections + globals and fails on any missing key, including `readVersions` |
| `src/lib/definePublicEndpoint.ts` | `headersWithCors` + cache headers + `ETag` + the error envelope cannot be forgotten | Every handler is written through it; a handler that is not fails browser-side CORS in the Phase-2 "hello world" check |

### 21.4 What svfrontend gains during integration

Additive only. **No file is deleted except dead content keys; no component is redesigned.**

```
svfrontend/
├── .env.local                        # NEW — the repo has ZERO env vars today
│                                     #   NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_SITE_URL, REVALIDATE_SECRET
├── next.config.mjs                    # EDIT — images.remotePatterns (CRITICAL); later drop dangerouslyAllowSVG
└── src/
    ├── lib/api/                       # NEW — the typed data layer
    │   ├── projects.ts                #   getProjects, getProject, getFeaturedProjects, usedCategories
    │   ├── site.ts                    #   getSiteSettings
    │   └── content.ts                 #   getFaqs, getStatistics, getTestimonials
    ├── lib/href.ts                    # EDIT — add mailHref(); fixes a LIVE mailto:[EMAIL@DOMAIN] bug
    ├── app/api/revalidate/route.ts    # NEW — the repo has no route.ts anywhere today
    ├── app/error.tsx                  # NEW — no error boundary exists today
    ├── content/projects.ts            # REWRITE — literal array → re-export of the data layer
    ├── content/site.ts                # REWRITE — literal object → data layer; nav/footer children derived
    ├── content/pages.ts               # PRUNE — delete the keys with zero consumers
    └── types/content.ts               # UNCHANGED — this file is the contract. Do not touch it.
```

**`src/types/content.ts` is untouched.** It is the authority the backend was designed against; every serialiser, every contract test and every field name in the Payload config exists to match it.

**What svfrontend does NOT gain:** no UI library, no state manager, no data-fetching library, no analytics, no CSS modules, no new animation dependency. The README's own standard — *"7 direct, 24 total. If something wants to add a UI library, weigh it against these numbers first"* — holds through integration.

---

## 22. Environment Variables

**Why this section restates the list rather than citing the existing one.** `ARCHITECTURE.md` §7 and `INTEGRATIONS.md` §9 are both pre-D-015. Between them they name `SESSION_SECRET`, `STORAGE_*`, `EMAIL_API_KEY`, `RATE_LIMIT_*`, `WHATSAPP_*` and `SMS_PROVIDER_KEY` — and **neither list contains a single Payload-required variable.** `PAYLOAD_SECRET` appears nowhere in any project document. Separately, `DATABASE_URI` is **not a name Payload uses**: it has zero occurrences in the entire 3.x docs corpus, while `process.env.DATABASE_URL` appears 13 times. The table below is the canonical set; §22.3 records what is retired and why.

### 22.1 How environment variables are loaded — and the rules that follow

Payload's own statement, verbatim: *"**Next.js Applications** — If you are using Next.js, no additional setup is required other than creating your `.env` file."* And for the CLI: *"The `payload run` command … loads the environment variables the same way Next.js loads them, eliminating the need for additional dependencies like `dotenv`. **The usage of `dotenv` is not recommended, as Next.js loads environment variables differently.**"*

Five rules follow, each with a consequence:

1. **Do not install `dotenv`.** `svbackend` is a Next.js app; Next's own loader is the mechanism. Adding `dotenv` produces two loaders with different precedence rules and a class of "it works in the script but not in the app" bug.
2. **Every script that touches Payload runs through `payload run` or the `payload` npm script.** ⚠️ Env loading is documented explicitly **only for `payload run`**; the docs do **not** state the same for `payload migrate` (the migrations page merely shows a `cross-env PAYLOAD_CONFIG_PATH=… payload` script). Therefore **CI passes `DATABASE_URL` explicitly on the command line** for migrate steps rather than trusting file loading — §16.7 already does exactly this.
3. **`PAYLOAD_CONFIG_PATH` lives in the npm script, not in `.env`.** It is a path, not a secret, and the docs' own example sets it inline: `"payload": "cross-env NODE_OPTIONS=--no-deprecation PAYLOAD_CONFIG_PATH=src/payload.config.ts payload"`.
4. **`NEXT_PUBLIC_` is a one-way door.** *"the Admin Panel does **not** include Environment Variables in its client-side bundle by default"*; prefixing exposes the value, with the docs' own warning — *"Only ever include keys that are safe for the public to read in plain text."* Exactly one variable carries the prefix in `svbackend` (`NEXT_PUBLIC_SERVER_URL`) and three in `svfrontend`. **`REVALIDATE_SECRET` never carries it.**
5. **`.gitignore` blocks `.env*` and allow-lists `.env.example`.** `.env.example` is the only env file in version control, in either repo.

**Port convention, decided here because two Next.js apps cannot share one:** `svfrontend` keeps `3000`; `svbackend` runs on `3001` in development. Every dev example below assumes that.

### 22.2 The complete variable list

Legend — **Required?**: `REQ` always · `REQ-PROD` required in production, optional in dev · `OPT` optional everywhere.

#### Payload core

| Name | Required? | Used by | Dev value / example | Production source | Secret? | What breaks if wrong |
|---|---|---|---|---|---|---|
| `PAYLOAD_SECRET` | **REQ** | `buildConfig({ secret })`; password salt/hash workflows; the JWT signing key, derived as `sha256(secret).slice(0,32)` | `openssl rand -hex 32` → 64 hex chars | platform secret store, **unique per environment** | 🔴 **YES** | 🔴 Unset or empty → the official `\|\| ''` pattern yields a **deterministic, empty-derived JWT signing key**: an admin session can be forged. Changed after go-live → *"you will need to regenerate your API keys"* and every issued cookie stops verifying. **Boot must fail if absent or < 32 chars** (§15 row 29) |
| `PAYLOAD_CONFIG_PATH` | **REQ** *(in the npm script, not in `.env`)* | the `payload` CLI — `migrate`, `generate:types`, `generate:db-schema`, `run` | `src/payload.config.ts` | same, baked into the script | no | CLI commands resolve the wrong config, or fall back to the undocumented "best effort" search. `migrate:create` then diffs against a config that is not ours |
| `NEXT_PUBLIC_SERVER_URL` | **REQ** | `config.serverURL`; media URLs; the password-reset link `${serverURL}/admin/reset/${token}`; added to the `csrf` list by default | `http://localhost:3001` | `https://cms.<domain>` | no (public by design) | Reset emails link to the wrong host — an unusable account-recovery path. `serverURL` is documented as *"protocol, domain and (optionally) port"*, so **a trailing path breaks it**. ⚠️ This name is a **convention shown once in a Payload example**, not a Payload-defined variable |
| `CORS_ORIGINS` | **REQ** | `cors: { origins: env.CORS_ORIGINS, headers: [] }` — comma-separated, split in the env module | `http://localhost:3000,http://localhost:3001` | `https://www.<domain>,https://cms.<domain>` | no | Too narrow → the frontend's browser-side lead POST fails CORS in production while passing every curl test. Set to `*` → `SECURITY.md` §5's *"Never `*`"* is violated |
| `CSRF_ORIGINS` | **REQ** | `csrf: env.CSRF_ORIGINS` — *"A whitelist array of URLs to allow Payload to accept cookies from"* | `http://localhost:3001` | `https://cms.<domain>` | no | Missing the admin origin → admin login silently fails to set cookies. Over-broad → the cookie-acceptance allow-list stops being a defence |
| `NODE_ENV` | **REQ** | `debug`, `cookies.secure`, `disableCreateDatabase`, Drizzle `push` (dev-only), the email-adapter branch, the logger branch | `development` | `production` | no | 🔴 `development` in production turns on `debug` (*"expose more detailed error information"*), turns **off** `cookies.secure`, turns **on** `push` against the production database, and swaps SMTP for ethereal — **every lead notification goes to a throwaway inbox** |

#### Database

| Name | Required? | Used by | Dev value / example | Production source | Secret? | What breaks if wrong |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | **REQ** | `postgresAdapter({ pool: { connectionString } })`; every `migrate` and test command | `postgres://postgres:postgres@localhost:5432/sv_dev` | managed-Postgres connection string from the platform store | 🔴 **YES** (contains the password) | Wrong host → boot failure, loud and immediate. **Wrong *database* is the dangerous case:** migrations apply to the wrong schema, or a dev machine writes into staging. Never spell it `DATABASE_URI` — that name exists in community templates, not in Payload |
| `DATABASE_SSL` | **REQ-PROD** | `pool.ssl = { rejectUnauthorized: true }` when true | `false` | `true` | no | `false` in production → credentials and lead PII cross the network in plaintext. `true` against a local container → boot failure |

#### Storage (S3-compatible)

`enabled: Boolean(env.S3_BUCKET)` is the switch (B07 §8): with `S3_BUCKET` unset the plugin is registered but inert and Payload falls back to local disk. **The plugin is always registered** — never conditionally included — because a config whose *shape* varies by environment generates divergent migrations between machines (R-31, a hazard Payload documents itself).

| Name | Required? | Used by | Dev value / example | Production source | Secret? | What breaks if wrong |
|---|---|---|---|---|---|---|
| `S3_BUCKET` | **REQ-PROD** | `s3Storage({ bucket, enabled: Boolean(...) })` | *empty* → local disk at `svbackend/media/` | bucket name | no | Unset in production → **uploads land on the container filesystem and vanish on the next deploy**, with no error at upload time. Wrong bucket → every existing `ImageRef.src` 404s |
| `S3_REGION` | **REQ-PROD** | `config.region` | `us-east-1` (MinIO ignores it; the SDK still demands one) | provider region — **the same region as the app and the database** | no | Region mismatch → SDK signature failures on every upload, or silent cross-region latency |
| `S3_ACCESS_KEY_ID` | **REQ-PROD** | `config.credentials.accessKeyId` | `minioadmin` | platform secret store | 🔴 **YES** | Uploads throw at request time. Leaked → the media bucket is writable by a third party, i.e. arbitrary content published under the company's domain |
| `S3_SECRET_ACCESS_KEY` | **REQ-PROD** | `config.credentials.secretAccessKey` | `minioadmin` | platform secret store | 🔴 **YES** | as above |
| `S3_ENDPOINT` | **OPT** | `config.endpoint` — ⚠️ an **AWS-SDK pass-through that Payload's own docs never name** (B07 §8). Valid by virtue of the pass-through, unverified by Payload | `http://localhost:9000` (MinIO) | unset for AWS S3; set for every S3-compatible provider | no | Set wrong → every upload times out. Unset against a non-AWS provider → the SDK addresses `s3.amazonaws.com` instead |
| `S3_FORCE_PATH_STYLE` | **OPT** | `config.forcePathStyle` — same pass-through caveat | `true` (MinIO requires it) | `false` on AWS; usually `true` elsewhere | no | Wrong value → `NoSuchBucket` against a bucket that exists, because the SDK put the name in the hostname instead of the path |
| `CDN_BASE_URL` | **REQ-PROD** | `generateFileURL` on the `media` collection, composing `ImageRef.src` | *empty* → Payload-served local URLs | `https://media.<domain>` | no | 🔴 Wrong host → **every image on the public site 404s**, and `next/image` throws `Invalid src prop` unless that exact host is in `svfrontend`'s `images.remotePatterns`. ⚠️ The exact `generateFileURL` signature is **NOT published in the docs** — verify against the generated `.d.ts` before relying on destructured argument names |

#### Email

| Name | Required? | Used by | Dev value / example | Production source | Secret? | What breaks if wrong |
|---|---|---|---|---|---|---|
| `SMTP_HOST` | **REQ-PROD** | `nodemailerAdapter({ transportOptions: { host } })` | *empty* → ethereal.email; credentials printed to console on startup | provider SMTP host | no | 🔴 Unset in production → **no adapter is configured; Payload logs a warning and the send appears to succeed.** For a lead-generation product this is the only truly unacceptable failure mode. Closed by the §14.5 boot guard |
| `SMTP_PORT` | **REQ-PROD** | `transportOptions.port` | *empty* | `587` (STARTTLS) or `465` (with `SMTP_SECURE=true`) | no | Port/`secure` mismatch → the connection hangs on every send; jobs exhaust `retries: 3` and land in `hasError: true` |
| `SMTP_SECURE` | **REQ-PROD** | `transportOptions.secure` | `false` | `false` for 587, `true` for 465 | no | As above. Kept as a variable rather than hardcoded because the docs defer to Nodemailer — *"including details on when `secure` should and should not be set to `true`"* |
| `SMTP_USER` | **REQ-PROD** | `transportOptions.auth.user` | *empty* | platform secret store | 🔴 **YES** | Auth failure on every send |
| `SMTP_PASS` | **REQ-PROD** | `transportOptions.auth.pass` | *empty* | platform secret store | 🔴 **YES** | As above. Leaked → a third party sends mail as the company |
| `EMAIL_FROM_ADDRESS` | **REQ** | `defaultFromAddress` — one of the two options the docs mark **required on every adapter** | `dev@sv.local` | an address on a domain whose **SPF, DKIM and DMARC the owner controls** | no | Wrong domain → notifications land in spam, which is operationally identical to a lost lead. Payload supports *"a single transporter of email"* — one From identity; no marketing/transactional split |
| `EMAIL_FROM_NAME` | **REQ** | `defaultFromName` — the second required option | `SV Developers (dev)` | `SV Developers` | no | Cosmetic only, but it is the sender line a busy sales person filters on |
| `SALES_NOTIFICATION_EMAIL` | **REQ-PROD** | the `sendLeadNotification` task's recipient | `sales@example.test` | the real sales inbox | no (but it is a business contact) | Unset → the task throws `JobCancelledError` immediately — correct behaviour, and **still means nobody is told about the enquiry**. Wrong address → leads are persisted and silently unread. Boot-guarded in production alongside `SMTP_HOST` |

#### Jobs and revalidation

| Name | Required? | Used by | Dev value / example | Production source | Secret? | What breaks if wrong |
|---|---|---|---|---|---|---|
| `CRON_SECRET` | **REQ-PROD** | the `jobs.access.run` predicate — `req.headers.get('authorization') === 'Bearer ' + secret` | *empty* — locally `req.user` satisfies the predicate | platform secret store | 🔴 **YES** | Unset in production → the predicate's `if (!secret) return false` closes the door and **an HTTP-triggered run is refused**. The bin-script workers authenticate as local processes, not over HTTP, so they keep running — which makes this failure quiet. Leaked → anyone can drain the queue |
| `ENABLE_JOB_WORKERS` | **OPT** | `jobs.shouldAutoRun` — **only in the `autoRun` fallback** (§13.5), never when separate worker containers are used | `false` | `true` on **exactly one** instance, or unset entirely | no | `true` on two instances → **duplicate lead notifications**; combined with `--handle-schedules`, duplicate scheduled jobs. The docs name both footguns explicitly |
| `REVALIDATE_WEBHOOK_URL` | **REQ-PROD** | the `revalidate` hook's direct `fetch`, and the `revalidatePaths` job | `http://localhost:3000/api/revalidate` | `https://www.<domain>/api/revalidate` | no | 🔴 Wrong or unset → **publishing silently does nothing visible on the website** — the single most confusing possible failure for an admin. Fails soft by design: the save still succeeds and the job retries |
| `REVALIDATE_SECRET` | **REQ-PROD** | the shared secret sent by the hook and verified by `svfrontend/src/app/api/revalidate/route.ts`. **Must be byte-identical in both repos** | any dev string | platform secret store, the same value in both environments | 🔴 **YES** | Mismatch → every revalidation is rejected with a 401 that only the job log sees: content appears to publish but the site never updates. **Never `NEXT_PUBLIC_`-prefixed** — that would publish the secret in the browser bundle |

#### Ops

| Name | Required? | Used by | Dev value / example | Production source | Secret? | What breaks if wrong |
|---|---|---|---|---|---|---|
| `LOG_LEVEL` | **OPT** | the pre-instantiated pino logger | `debug` | `info` | no | `debug` in production floods the log driver and raises the chance a phone number or query string is written to disk |
| `DISABLE_LOGGING` | **OPT** | documented Payload variable — *"Set to `'true'` to suppress all log output"* | `false` | **unset / false** | no | `true` in production → **no logs at all**, including job failures and the worker-death signal §20.14 alerts on |
| `PAYLOAD_SEED` | **OPT** | our own hard gate in `src/seed/index.ts`; the script refuses to run unless it is exactly `'true'` | `true` only while seeding | 🔴 **unset**, set transiently for the one-time go-live seed (step 9 of §20.13) | no | Left set in a production environment → the seed can run by accident, upserting the five projects over live edits. Its absence *is* the guard |

#### Frontend — `svfrontend/.env.local` (the repo has **zero** environment variables today)

| Name | Required? | Used by | Dev value / example | Production source | Secret? | What breaks if wrong |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | **REQ** | `src/lib/api/*` at build and revalidate time **and** `ContactForm`'s browser `fetch` — one variable, both sides | `http://localhost:3001/api/v1` | `https://cms.<domain>/api/v1` | no (public by necessity) | 🔴 Wrong at build → `next build` fails, or produces a site with no content. Wrong at runtime → the contact form posts into the void, which is precisely the problem the backend exists to solve. Must be `NEXT_PUBLIC_` because the lead POST happens in the browser |
| `NEXT_PUBLIC_SITE_URL` | **REQ** | `metadataBase`, `sitemap.ts`, `robots.ts` | `http://localhost:3000` | `https://www.<domain>` | no | This value is hardcoded today as `site.url = 'https://www.example.com'`, which makes **every canonical URL, every OG url and every sitemap entry wrong**. Getting it wrong here reintroduces that bug |
| `REVALIDATE_SECRET` | **REQ-PROD** | `src/app/api/revalidate/route.ts` | any dev string, identical to the backend's | platform secret store | 🔴 **YES** | Mismatch → revalidation 401s. **Server-only — no `NEXT_PUBLIC_` prefix, ever** |
| `NEXT_PUBLIC_ALLOW_INDEXING` | **OPT** | gates the **two independent indexing blocks** — `robots.ts`'s `disallow: '/'` and `layout.tsx:53`'s `robots: { index: false }` | `false` | `true` at launch; `false` on staging | no | Both blocks are hardcoded today. Lifting only one leaves the site unindexed with a non-obvious cause; forgetting both makes the launch invisible to search |

#### Not provisioned — named in project documents, deliberately absent

| Name | Where named | Why it does not exist |
|---|---|---|
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | `INTEGRATIONS.md` §9 | Server-sent WhatsApp is *"a significant undertaking — Meta business verification, template approval, per-message cost. **Not recommended initially.**"* FR-LEAD-17 is not built and **OQ-2 (notification channel) is unresolved** |
| `SMS_PROVIDER_KEY` | `INTEGRATIONS.md` §9 | Same. No SMS notification is in scope |
| `MAPS_API_KEY` | `INTEGRATIONS.md` §5 prose — and **absent from both of its own env lists** | A **frontend** concern, and a future one: the embedded map is a *"before you go live"* item, not a backend capability. Either add it to `INTEGRATIONS.md` §9 or delete the §5 reference — do not carry it here |

### 22.3 Variables deliberately retired from `ARCHITECTURE.md` §7 / `INTEGRATIONS.md` §9

Each of these is currently written into a specification document and must be struck, not silently dropped.

| Retired | Replaced by | Reason |
|---|---|---|
| `SESSION_SECRET` | `PAYLOAD_SECRET` | Belongs to D-004's superseded server-side-session design. Payload issues **httpOnly JWT cookies, not session rows**; there is no `admin_sessions` table and no second secret to hold (CONF-12) |
| `DATABASE_URI` | `DATABASE_URL` | **Zero occurrences in the entire Payload 3.x docs corpus**, against 13 for `process.env.DATABASE_URL`. A common community-template name, not a Payload one |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_PUBLIC_URL` | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `CDN_BASE_URL` | The `S3_*` names are the ones the storage-adapter documentation itself uses. Matching the docs means every future example pastes in without translation |
| `EMAIL_API_KEY`, `EMAIL_FROM` | `SMTP_HOST/PORT/SECURE/USER/PASS`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | We chose `nodemailerAdapter` over a provider-specific adapter (§14.1), so the provider is SMTP credentials rather than an API key. `defaultFromAddress` and `defaultFromName` are **two separate required options**, not one |
| `ADMIN_ORIGIN`, `PUBLIC_SITE_ORIGIN` | `CORS_ORIGINS`, `CSRF_ORIGINS` | Payload's `cors.origins` and `csrf` each take a **list**. Two discrete single-origin variables would have to be recombined at every use site; one comma-separated list per concern is the shape the API already expects |
| `RATE_LIMIT_*` | **nothing in the app** | 🔴 **Payload 3 ships no HTTP rate limiting** (§15 row 10). The limits are reverse-proxy / CDN / WAF configuration. An app-level `RATE_LIMIT_*` variable would imply the application enforces something it does not — the most dangerous kind of wrong documentation. `ARCHITECTURE.md` §3 and §7 must both be corrected |

Also **not** an environment variable, by decision: the **lead dedupe window**. It is a constant in `src/hooks/leadDedupe.ts`, because widening it rejects real enquiries and narrowing it admits spam — a behaviour change that belongs in a reviewed commit, not in a platform console where it can be changed with no diff and no audit trail.

### 22.4 The env module — Zod-parsed, fail-fast at boot

**Payload performs no environment validation at all**, and its own documented example is `secret: process.env.PAYLOAD_SECRET || ''` — a pattern that **silently accepts an empty secret** and produces a deterministic, empty-derived JWT signing key. That single line justifies this entire subsection.

**Two files, which reconciles the two references made earlier in this plan** (§14.5 cites `src/lib/env.ts`; §21.1 lists `src/schemas/env.ts`):

- `src/schemas/env.ts` — the Zod schema and nothing else. Importable by tests and by the drift-check script with no side effects.
- `src/lib/env.ts` — parses `process.env` **once**, freezes the result, exports `env`. This is the only module anything else imports.

```ts
// src/schemas/env.ts
import { z } from 'zod'

const csv  = z.string().transform(s => s.split(',').map(v => v.trim()).filter(Boolean))
const bool = z.enum(['true', 'false']).transform(v => v === 'true')

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ---- Payload core ----
  PAYLOAD_SECRET: z.string().min(32, 'PAYLOAD_SECRET must be at least 32 characters'),
  NEXT_PUBLIC_SERVER_URL: z.string().url().refine(
    u => new URL(u).pathname.replace(/\/$/, '') === '',
    'serverURL must be protocol + domain (+ port) only — no path',
  ),
  CORS_ORIGINS: csv,
  CSRF_ORIGINS: csv,

  // ---- Database ----
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: bool.default('false'),

  // ---- Storage: all optional; S3_BUCKET is the enable switch ----
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: bool.default('false'),
  CDN_BASE_URL: z.string().url().optional(),

  // ---- Email ----
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: bool.default('false'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  EMAIL_FROM_ADDRESS: z.string().email(),
  EMAIL_FROM_NAME: z.string().min(1),
  SALES_NOTIFICATION_EMAIL: z.string().email().optional(),

  // ---- Jobs + revalidation ----
  CRON_SECRET: z.string().min(32).optional(),
  ENABLE_JOB_WORKERS: bool.default('false'),
  REVALIDATE_WEBHOOK_URL: z.string().url().optional(),
  REVALIDATE_SECRET: z.string().min(16).optional(),

  // ---- Ops ----
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  DISABLE_LOGGING: bool.default('false'),
  PAYLOAD_SEED: bool.default('false'),
})
.superRefine((v, ctx) => {
  if (v.NODE_ENV !== 'production') return

  const requiredInProd = [
    'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'CDN_BASE_URL',
    'SMTP_HOST', 'SMTP_PORT', 'SALES_NOTIFICATION_EMAIL',
    'CRON_SECRET', 'REVALIDATE_WEBHOOK_URL', 'REVALIDATE_SECRET',
  ] as const

  for (const key of requiredInProd) {
    if (!v[key]) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` })
    }
  }
  if (!v.DATABASE_SSL) {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_SSL'],
      message: 'DATABASE_SSL must be true in production' })
  }
  if (v.PAYLOAD_SEED) {
    ctx.addIssue({ code: 'custom', path: ['PAYLOAD_SEED'],
      message: 'PAYLOAD_SEED must not be set in a production environment' })
  }
})

export type Env = z.infer<typeof envSchema>
```

```ts
// src/lib/env.ts — parsed once, at import time
import { envSchema, type Env } from '../schemas/env'

const parsed = envSchema.safeParse({
  NODE_ENV:               process.env.NODE_ENV,
  PAYLOAD_SECRET:         process.env.PAYLOAD_SECRET,
  NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,   // literal access — see rule 1
  CORS_ORIGINS:           process.env.CORS_ORIGINS,
  CSRF_ORIGINS:           process.env.CSRF_ORIGINS,
  DATABASE_URL:           process.env.DATABASE_URL,
  DATABASE_SSL:           process.env.DATABASE_SSL,
  // … one literal line per variable. NEVER `process.env[key]` inside a loop.
})

if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    // names and messages only — NEVER echo a value
    console.error(`[env] ${issue.path.join('.')}: ${issue.message}`)
  }
  throw new Error('Invalid environment. Refusing to boot.')
}

export const env: Readonly<Env> = Object.freeze(parsed.data)
```

```ts
// src/payload.config.ts — the env import is the FIRST import, before anything Payload
import { env } from './lib/env'
// … then buildConfig({ secret: env.PAYLOAD_SECRET, ... })   — never `|| ''`
```

**Six implementation rules, each covering a real failure mode:**

1. 🔴 **Read every variable as a literal `process.env.NAME`, never `process.env[key]`.** Next.js replaces literal occurrences at build time; a dynamic lookup is not substituted and returns `undefined` in any bundled context. A generic `Object.keys(shape).map(k => process.env[k])` loop looks cleaner and **silently breaks `NEXT_PUBLIC_SERVER_URL`**.
2. **The env import is the first line of `payload.config.ts`.** Validation must run before the adapter is constructed, or the first error a developer sees is a connection failure rather than *"DATABASE_URL is malformed"*.
3. **Report names, never values.** A validation error that prints the malformed `DATABASE_URL` puts the database password into the CI log.
4. **Production-only requirements live in `superRefine`, not in the base schema.** A base-schema `required` on `S3_BUCKET` would make local disk storage impossible; `.optional()` everywhere would leave production unguarded. The split is the point.
5. **`next build` must be able to parse this schema**, because the build imports the config. §20.13 already orders `migrate` before `build`, so real values are present in CI — but if a build stage ever runs without them, supply a `.env.ci` of syntactically valid dummy values rather than weakening the schema. **Never add a `SKIP_ENV_VALIDATION` escape hatch**: it will be set in production the first time a deploy is urgent.
6. **CI diffs `.env.example` against the schema keys.** `src/scripts/checkEnvDrift.ts` (a third sibling to `checkIconDrift.ts` and `checkContractDrift.ts` in §21.1) fails the build when the schema gains a key the example lacks, or vice versa. Without it `.env.example` rots within two sprints and the next developer's first day is spent guessing.

**Acceptance (Phase-2 exit criterion 2):** booting with `PAYLOAD_SECRET` unset, empty, or 31 characters produces a **named error and a non-zero exit** — proven by a test, not by inspection.

### 22.5 `.env.example`

```bash
# =============================================================================
# svbackend/.env.example — copy to .env and fill in. NEVER commit .env
# Loaded by Next.js and by `payload run`. Do NOT add dotenv.
# PAYLOAD_CONFIG_PATH is set inside the `payload` npm script, not here.
# =============================================================================

NODE_ENV=development

# --- Payload core ------------------------------------------------------------
# Generate with: openssl rand -hex 32   (>= 32 chars; boot FAILS if shorter)
PAYLOAD_SECRET=
NEXT_PUBLIC_SERVER_URL=http://localhost:3001
# Comma-separated. svfrontend runs on 3000, svbackend on 3001.
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
CSRF_ORIGINS=http://localhost:3001

# --- Database ----------------------------------------------------------------
# NOT `DATABASE_URI` — that name does not appear anywhere in the Payload docs.
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sv_dev
DATABASE_SSL=false

# --- Storage -----------------------------------------------------------------
# Leave S3_BUCKET EMPTY for local development: the s3Storage plugin is always
# registered but stays inert, and uploads fall back to local disk.
S3_BUCKET=
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
# S3_ENDPOINT / S3_FORCE_PATH_STYLE are AWS-SDK pass-throughs that Payload's own
# docs never name. Required by MinIO and by most non-AWS providers.
S3_ENDPOINT=
S3_FORCE_PATH_STYLE=false
# Whatever host this resolves to MUST also appear in svfrontend's
# next.config.mjs images.remotePatterns, or every next/image call site throws.
CDN_BASE_URL=

# --- Email -------------------------------------------------------------------
# Leave SMTP_HOST EMPTY in dev: nodemailerAdapter() with no transport uses
# ethereal.email and prints preview credentials to the console. Nothing is
# delivered to a real inbox. In PRODUCTION an empty SMTP_HOST FAILS BOOT.
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM_ADDRESS=dev@sv.local
EMAIL_FROM_NAME=SV Developers (dev)
SALES_NOTIFICATION_EMAIL=sales@example.test

# --- Jobs & revalidation -----------------------------------------------------
# CRON_SECRET guards jobs.access.run for HTTP-triggered runs. Leave empty
# locally: an authenticated req.user satisfies the predicate.
CRON_SECRET=
# Only for the autoRun fallback (13.5). With worker containers, leave false.
ENABLE_JOB_WORKERS=false
REVALIDATE_WEBHOOK_URL=http://localhost:3000/api/revalidate
# Must be byte-identical to svfrontend's REVALIDATE_SECRET.
REVALIDATE_SECRET=

# --- Ops ---------------------------------------------------------------------
LOG_LEVEL=debug
DISABLE_LOGGING=false
# Hard gate on src/seed/index.ts. MUST be false/unset in production.
PAYLOAD_SEED=false
```

```bash
# =============================================================================
# svfrontend/.env.example — the repo has ZERO environment variables today
# =============================================================================
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Server-only. NEVER prefix this with NEXT_PUBLIC_.
REVALIDATE_SECRET=
# Lifts BOTH indexing blocks: robots.ts disallow AND layout.tsx robots.index.
NEXT_PUBLIC_ALLOW_INDEXING=false
```

### 22.6 Per-environment differences that are easy to get wrong

| Variable / concern | dev | test (CI) | staging | production |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | `production` |
| `DATABASE_URL` | local container, `sv_dev` | disposable container on **port 5433**, `sv_test` | staging DB | production DB |
| **Schema sync** | **Drizzle `push`** (the dev-only default) | **`payload migrate`** | **`payload migrate`** | **`payload migrate`** |
| `S3_BUCKET` | *empty* → local disk | *empty* → local disk, so upload tests need no network | staging bucket | production bucket |
| `SMTP_HOST` | *empty* → ethereal; nothing delivered | *empty* → stub transport in tests | *empty* → **ethereal, deliberately**: satisfies *"Staging must not send real notifications"* at zero custom cost | real SMTP |
| `PAYLOAD_SEED` | `true` while seeding | `false` — tests use factories, not the seed | `true` once | **unset**, except transiently at go-live |
| `DISABLE_LOGGING` | `false` | `false` | `false` | **`false`** — never `true` |
| `PAYLOAD_SECRET` | any 32+ chars | any 32+ chars | **unique** | **unique**, platform store |
| `REVALIDATE_SECRET` | any | unused | unique, matched across both repos | unique, matched across both repos |
| `CRON_SECRET` | empty | empty | set | set |

🔴 **The highest-consequence row is schema sync.** `push` and migrations are documented as *"not meant to be used interchangeably"*; mixing them yields a migration history that matches no real schema. Development is the **only** environment where `push` is permitted, and `payload migrate` is **never** run against the local sandbox (§16.6).
## 23. Phase Dependency Graph

This section supersedes `svbackend/docs/BACKEND-ROADMAP.md` Phases 0–11. The phase numbers used from here to the end of this plan are the **restructured** numbers defined below, not the roadmap's. Where sections 12–22 name a phase, they use these same numbers.

### 23.1 What changed, and the dependency that forced each change

Every change below is justified by a **technical** dependency discovered in the official Payload documentation (the B01–B11 research), not by a preference for a different shape. Where the old ordering was merely conventional and still correct, it was left alone.

| Original roadmap phase | Action | The real dependency that forced it |
|---|---|---|
| **P0** Architecture decision (D-015) | **KEPT**, complete | — |
| **P1** Foundation + schema validation gate | **SPLIT into new Phase 0 + Phase 1 + Phase 2** | The old Phase 1 bundled a throwaway spike, permanent foundation and the Projects domain into one unit, so the gate would have been evaluated against code the team was already invested in. Separately, three **irreversible-after-migration-001** schema decisions (`status` rename, `idType`, ordering mechanism) were in no phase at all. A decision that cannot be reversed after the first migration must precede the first migration; that is a hard ordering constraint, not a process preference. |
| **P2** Admin auth and access control | **SPLIT + RESEQUENCED.** Users collection → Phase 2. Access control → a per-collection acceptance criterion, not a phase. Lockdown work → new **Phase 3 Security Spine**, which precedes every content collection | Payload's `access` block lives on **each collection** (B05 §2), so "do auth in Phase 2" has no meaning once collections are added in Phases 4–8. Meanwhile Payload's default access is `Boolean(user)` — *any authenticated user, full CRUD* — and there is **no documented kill switch for the generated REST API** (B03 §5, B05 §8). Until that is closed, **every collection added is a new publicly-addressable endpoint.** That is a strict precedence relation. |
| **P3** DB foundation + "create the remaining 14 collections" | **DISSOLVED**; each collection moved to the phase that owns its behaviour | "Create 14 collections" is a false unit. Creating `testimonials` in Phase 3 and its consent gate in Phase 8 splits one small feature across five phases while leaving a publishable collection with no consent gate in between. |
| **P4** Projects: full admin capability | **MERGED** with the Projects half of old P1 → new **Phase 4** | Modelling the collection and making it publishable/orderable/archivable is one artefact; `versions.drafts` must be on from migration 001 or `_status`-less rows exist forever (R-12 mitigation). |
| **P5** Media | **MOVED EARLIER + SPLIT.** Media *skeleton* is a Phase-1 prerequisite; media *core* is in Phase 4; media *hardening* is Phase 6, parallel | **F-2 / CONF-26:** `Project`'s five media roles are `upload` fields with `relationTo: 'media'`; the target collection must exist before the field can be declared (B07 §12, B06 §1). Projects-in-Phase-1/Media-in-Phase-5 is **not a late ordering, it is impossible.** And OQ-7 only ever blocked the S3 adapter (`s3Storage({ enabled })`), never the collection (B07 §8). |
| **P6** Public APIs | **SPLIT.** `toPublicProject()` + `GET /projects/{slug}` + the contract test moved **into the Phase-1 gate**; the remaining endpoints + revalidation → Phase 7 | The serialiser **is** the gate. Payload provides *no* tooling for omit-don't-empty (B03 §10), so D-008 is 100 % hand-written; deferring it to Phase 6 means discovering that after five phases of work. |
| **P7** Leads and notifications | **PROMOTED to Phase 5 and PARALLELISED** | It depends on nothing in the projects chain, and `@payloadcms/email-nodemailer` speaks any SMTP transport (B09 §7), so the email provider never blocked it. It is also the only phase closing an **active, ongoing loss** — every enquiry typed into the live form today is discarded. |
| **P8** Tier-2 CMS content | **PARALLELISED** as Phase 8, runnable any time after the Security Spine | Near-pure configuration with exactly one piece of real logic (the consent gate), and zero dependency on projects, media or leads. |
| **P9** Frontend integration | **KEPT as a gated phase** (now Phase 9), with the human approval made an explicit task (T-170) and four newly-found frontend defects folded in | The guard rails were right; the scope was incomplete — `next.config.mjs` has **no `images.remotePatterns`** (R-66/CONF-45), a live `mailto:[EMAIL@DOMAIN]` ships today (CONF-80), the `/contact` WhatsApp href is raw digits (CONF-81), and React keys are derived from content strings (CONF-82). |
| **P10** Testing and hardening | **SPLIT.** Contract, authz, upload and leak tests **distributed to the task they cover**; only checklist execution, load test, dependency audit and the backup restore drill remain terminal | A terminal testing phase lets the highest-severity defect class in this stack (F-4: `overrideAccess` defaults to `true`, custom endpoints are unauthenticated by default) exist for the entire build, silently and unlogged. Contract tests are a **Phase-1 gate criterion**, not a Phase-10 deliverable. |
| **P11** Production deployment | **SPLIT.** Infrastructure (T-200…T-205) becomes an **early parallel workstream**; only the go-live smoke test stays terminal (Phase 11) | The jobs worker (T-130) runs as a separate container and the backup restore drill (T-196) needs a real database — both require infrastructure the old plan only created at the very end (B09 §4, B10 §13). |

**Net: 12 phases → 12 phases, but three run in parallel, one is a true throwaway gate, and the two riskiest items — schema irreversibility and public-data exposure — moved to the front.**

**The restructured phases:**

| # | Phase | Mode | Complexity |
|---|---|---|---|
| 0 | Decisions & Environment Lock | sequential | S |
| 1 | The Validation Gate (throwaway spike) | sequential | L |
| 2 | Foundation | sequential | L |
| 3 | Security Spine | sequential | M |
| 4 | Projects Domain + Media Core | **critical path** | XL |
| 5 | Leads & Notifications | **parallel** | L |
| 6 | Media Hardening | **parallel** | L |
| 7 | Public API Surface & Revalidation | **critical path** | M |
| 8 | Tier-2 Content | **parallel** | M |
| 9 | Frontend Integration ⚠️ approval gate | **critical path** | L |
| 10 | Hardening & Verification | sequential | M |
| 11 | Production Deployment & Go-Live | sequential | M |

### 23.2 The dependency graph

```mermaid
graph TD
  subgraph P0["PHASE 0 · Decisions & environment"]
    T001["T-001 status rename"]
    T002["T-002 idType uuid"]
    T004["T-004 pin Next16/React19/payload"]
    T008["T-008 OQ-7 → SMTP + S3"]
    T009["T-009 OQ-1/2/3"]
    T010["T-010 OQ-19 transition"]
    T011["T-011 SVG seed paradox"]
    T014["T-014 URL layout"]
    T015["T-015 subdomain/origins"]
    T016["T-016 toolchain"]
  end

  subgraph P1["PHASE 1 · VALIDATION SPIKE (throwaway)"]
    T020["T-020 scaffold"]
    T021["T-021 postgres adapter"]
    T023["T-023 Media skeleton"]
    T022["T-022 full Project model"]
    T024["T-024 generate:db-schema — READ IT"]
    T025["T-025 migrate up/down"]
    T026["T-026 seed 5 projects"]
    T027["T-027 toPublicProject v0"]
    T028["T-028 GET /projects/{slug}"]
    T029["T-029 contract test vs types/content.ts"]
    T003["T-003 ordering decision"]
    T035["T-035 GATE REPORT"]
  end

  subgraph P2["PHASE 2 · Foundation"]
    T040["T-040 real repo"]
    T041["T-041 payload.config"]
    T042["T-042 env fail-fast"]
    T047["T-047 error envelope"]
    T048["T-048 publicFind wrapper"]
    T049["T-049 definePublicEndpoint + CORS + cache"]
    T051["T-051 Vitest + getPayload harness"]
    T145["T-145 /healthz + /livez"]
  end

  subgraph P3["PHASE 3 · Security spine"]
    T060["T-060 Users + auth opts"]
    T062["T-062 access primitives"]
    T063["T-063 explicit access everywhere"]
    T064["T-064 first-admin bootstrap"]
    T066["T-066 lock down generated surface"]
    T068["T-068 edge rate limiting"]
    T071["T-071 verify revocation → OQ-26"]
  end

  subgraph P4["PHASE 4 · Projects + Media core"]
    T080["T-080 Project collection"]
    T091["T-091 audit-log + hooks"]
    T100["T-100 media + documents collections"]
    T102["T-102 upload guard: magic bytes/SVG/EXIF"]
    T104["T-104 own width/height"]
    T109["T-109 5 media roles"]
    T114["T-114 ImageRef serialisation"]
  end

  subgraph P5["PHASE 5 · Leads (PARALLEL)"]
    T120["T-120 Leads collection"]
    T123["T-123 POST /leads"]
    T126["T-126 sendLeadNotification task"]
    T128["T-128 email adapter + boot guard"]
    T130["T-130 worker containers"]
    T131["T-131 failed-job watchdog"]
  end

  subgraph P6["PHASE 6 · Media hardening (PARALLEL)"]
    T107["T-107 s3Storage adapter"]
    T110["T-110 in-use delete guard"]
    T111["T-111 soft delete + sweeper"]
    T113["T-113 asset migration"]
  end

  subgraph P7["PHASE 7 · Tier-2 + Public API"]
    T160["T-160 testimonials + consent"]
    T163["T-163 site-settings global"]
    T140["T-140 GET /projects"]
    T147["T-147 revalidation hooks"]
    T148["T-148 contract tests ×6 in CI"]
  end

  subgraph P9["PHASE 9 · Frontend integration (APPROVAL)"]
    T170["T-170 human approval"]
    T171["T-171 data layer"]
    T174["T-174 ContactForm → 201"]
    T176["T-176 images.remotePatterns"]
    T182["T-182 LCP/CLS/prerender verify"]
  end

  subgraph P10["PHASE 10 · Hardening"]
    T190["T-190 SECURITY §18 checklist"]
    T191["T-191 authz matrix"]
    T196["T-196 backups + REAL restore"]
    T198["T-198 privacy policy"]
  end

  subgraph P11["PHASE 11 · Production"]
    T200["T-200 infra"]
    T202["T-202 CI: migrate→build"]
    T204["T-204 monitoring"]
    T206["T-206 go-live smoke"]
  end

  T016 --> T020
  T004 --> T020
  T002 --> T021
  T020 --> T021
  T021 --> T023
  T001 --> T022
  T023 --> T022
  T021 --> T022
  T022 --> T024
  T024 --> T025
  T024 --> T003
  T011 --> T026
  T022 --> T026
  T022 --> T027
  T027 --> T028
  T028 --> T029
  T024 --> T035
  T029 --> T035
  T026 --> T035

  T035 --> T040
  T040 --> T041
  T041 --> T042
  T041 --> T047
  T041 --> T048
  T047 --> T049
  T048 --> T049
  T041 --> T051
  T041 --> T145

  T041 --> T060
  T041 --> T062
  T062 --> T063
  T060 --> T064
  T063 --> T066
  T015 --> T068
  T060 --> T071
  T051 --> T071

  T035 --> T080
  T041 --> T080
  T003 --> T080
  T080 --> T091
  T063 --> T091
  T041 --> T100
  T100 --> T102
  T100 --> T104
  T080 --> T109
  T100 --> T109
  T104 --> T114

  T041 --> T120
  T001 --> T120
  T010 --> T120
  T009 --> T120
  T049 --> T123
  T120 --> T123
  T068 --> T123
  T120 --> T126
  T008 --> T128
  T042 --> T128
  T126 --> T130
  T128 --> T130
  T200 --> T130
  T130 --> T131

  T008 --> T107
  T100 --> T107
  T109 --> T110
  T110 --> T111
  T102 --> T113
  T011 --> T113
  T109 --> T113

  T041 --> T160
  T041 --> T163
  T100 --> T163
  T049 --> T140
  T080 --> T140
  T114 --> T140
  T080 --> T147
  T163 --> T147
  T029 --> T148
  T140 --> T148
  T160 --> T148
  T163 --> T148

  T148 --> T170
  T170 --> T171
  T147 --> T171
  T123 --> T174
  T171 --> T174
  T107 --> T176
  T171 --> T176
  T171 --> T182
  T174 --> T182
  T176 --> T182

  T066 --> T191
  T051 --> T191
  T200 --> T196
  T071 --> T190
  T102 --> T190
  T196 --> T190
  T009 --> T198

  T015 --> T200
  T200 --> T202
  T196 --> T202
  T145 --> T204
  T131 --> T204
  T200 --> T204
  T182 --> T206
  T204 --> T206
  T130 --> T206
  T198 --> T206
  T190 --> T206
```

### 23.3 Explicit dependency list

Tasks not listed have no technical prerequisite beyond their phase's entry criteria. "Depends on" means **technically blocked by**, never "comes after in the plan".

```
T-003 depends on: T-024   (the order-field name and its storage shape are UNDOCUMENTED; decide after measuring)
T-020 depends on: T-004, T-016
T-021 depends on: T-002, T-020
T-023 depends on: T-021
T-022 depends on: T-001, T-021, T-023          ← Media BEFORE Project (F-2 / CONF-26)
T-024 depends on: T-022, T-023
T-025 depends on: T-024
T-026 depends on: T-011, T-022
T-027 depends on: T-022
T-028 depends on: T-027
T-029 depends on: T-028
T-030 depends on: T-029
T-031 depends on: T-029
T-032 depends on: T-022
T-033 depends on: T-022, T-023
T-034 depends on: T-026, T-028
T-035 depends on: T-024, T-030, T-031, T-032, T-033, T-034

T-040 depends on: T-035                         ← nothing real is built before the gate passes
T-041 depends on: T-040
T-042 depends on: T-041
T-043 depends on: T-040
T-044 depends on: T-040
T-045 depends on: T-041
T-046 depends on: T-041
T-047 depends on: T-041
T-048 depends on: T-041
T-049 depends on: T-047, T-048
T-050 depends on: T-044
T-051 depends on: T-041
T-052 depends on: T-027

T-060 depends on: T-005, T-041
T-061 depends on: T-060
T-062 depends on: T-041
T-063 depends on: T-062
T-064 depends on: T-051, T-060
T-065 depends on: T-060, T-091
T-066 depends on: T-063
T-067 depends on: T-015, T-049
T-068 depends on: T-015
T-069 depends on: T-015
T-070 depends on: T-047
T-071 depends on: T-051, T-060

T-080 depends on: T-003, T-035, T-041
T-081 depends on: T-080
T-082 depends on: T-080
T-083 depends on: T-082
T-084 depends on: T-082
T-085 depends on: T-080
T-086 depends on: T-085
T-087 depends on: T-003, T-024, T-080
T-088 depends on: T-080
T-089 depends on: T-080
T-090 depends on: T-080
T-091 depends on: T-063, T-080
T-092 depends on: T-080
T-093 depends on: T-011, T-080
T-094 depends on: T-080, T-082, T-085, T-087, T-089, T-090

T-100 depends on: T-041
T-101 depends on: T-100
T-102 depends on: T-100
T-103 depends on: T-102
T-104 depends on: T-100
T-105 depends on: T-100
T-106 depends on: T-100
T-107 depends on: T-008, T-100
T-108 depends on: T-107
T-109 depends on: T-080, T-100
T-110 depends on: T-109
T-111 depends on: T-110
T-112 depends on: T-110
T-113 depends on: T-011, T-102, T-109
T-114 depends on: T-052, T-104
T-115 depends on: T-068

T-120 depends on: T-001, T-009, T-010, T-041
T-121 depends on: T-120
T-122 depends on: T-010, T-120
T-123 depends on: T-049, T-068, T-122
T-124 depends on: T-068, T-123
T-125 depends on: T-120
T-126 depends on: T-120
T-127 depends on: T-126
T-128 depends on: T-008, T-042
T-129 depends on: T-128
T-130 depends on: T-126, T-128, T-200
T-131 depends on: T-130
T-132 depends on: T-126
T-133 depends on: T-009, T-120
T-134 depends on: T-120
T-135 depends on: T-051, T-066, T-120

T-140 depends on: T-049, T-080, T-114
T-141 depends on: T-049, T-163
T-142 depends on: T-049, T-160
T-143 depends on: T-049, T-161
T-144 depends on: T-049, T-162
T-145 depends on: T-041
T-146 depends on: T-049
T-147 depends on: T-007, T-080, T-163
T-148 depends on: T-029, T-140, T-141, T-142, T-143, T-144
T-149 depends on: T-148

T-160 depends on: T-041, T-063
T-161 depends on: T-041, T-063
T-162 depends on: T-041, T-063
T-163 depends on: T-041, T-100
T-164 depends on: T-163
T-165 depends on: T-160, T-161, T-162, T-163
T-166 depends on: T-165
T-167 depends on: T-081, T-163

T-170 depends on: T-148
T-171 depends on: T-147, T-148, T-170
T-172 depends on: T-171
T-173 depends on: T-171
T-174 depends on: T-123, T-171
T-175 depends on: T-147, T-171
T-176 depends on: T-108, T-171
T-177 depends on: T-170
T-178 depends on: T-010, T-174
T-179 depends on: T-170
T-180 depends on: T-090, T-170
T-181 depends on: T-170
T-182 depends on: T-171, T-172, T-173, T-174, T-175, T-176
T-183 depends on: T-113, T-182

T-190 depends on: T-071, T-102, T-196, plus T-060..T-069
T-191 depends on: T-051, T-063, T-066, T-135
T-192 depends on: T-051, T-102
T-193 depends on: T-068, T-124
T-194 depends on: T-051, T-123
T-195 depends on: T-004
T-196 depends on: T-200
T-197 depends on: T-051, T-085
T-198 depends on: T-009

T-200 depends on: T-015, T-043
T-201 depends on: T-042, T-200
T-202 depends on: T-044, T-050, T-196
T-203 depends on: T-015, T-200
T-204 depends on: T-131, T-145, T-200
T-205 depends on: T-131, T-196, T-201
T-206 depends on: T-130, T-182, T-190, T-198, T-204
T-207 depends on: T-102, T-200
T-208 depends on: T-064, T-200
```

### 23.4 Dependencies the old roadmap assumed that are NOT real

Each was challenged and found to be a phase-ordering convention, not a technical constraint.

| Assumed edge | Verdict | Why |
|---|---|---|
| Projects (P1) → Media (P5) | **INVERTED** | Project's 5 media roles are `upload` fields; `relationTo` must point at an existing collection (B07 §12) |
| Auth (P2) → DB (P3) → Projects (P4) | **FALSE as a chain** | `access` lives on each collection; writing `Users` does not unblock writing `Projects` (B05 §2) |
| Media entry requires OQ-7 | **FALSE** | Only `s3Storage()` wiring (T-107) needs the provider; `enabled: Boolean(process.env.S3_BUCKET)` is the documented conditional (B07 §8) |
| Leads entry requires the email provider | **FALSE** | `nodemailerAdapter` speaks any SMTP transport; the no-arg ethereal.email form covers dev and staging (B09 §7) |
| Public APIs require Projects **and** Media | **PARTIALLY FALSE** | `/site-settings`, `/faqs`, `/statistics`, `/testimonials` depend only on their own collections |
| Testing is a terminal phase | **FALSE and dangerous** | The contract test is a Phase-1 gate criterion; the lead-leak test and authz matrix must exist before any public endpoint is exposed |
| Deployment is the last phase | **PARTIALLY FALSE** | The jobs worker and the restore drill need production infrastructure to exist first |
| "Node 20 LTS" is a deliverable | **FALSE** | Payload 3 `engines` are `^18.20.2 \|\| >=20.9.0`; its own Dockerfile is `node:24-alpine`. Node 24.11.0 is fine. The `<23` bound is **svfrontend's** pin and must not be copied |
| The icon CHECK constraint needs a custom migration | **FALSE — and better** | `select` + explicit `enumName` produces a real Postgres enum type, which *is* the constraint (B06 §5) |
| `notification_jobs` is a table we build | **FALSE** | Payload's `payload-jobs` collection is the same concept, managed and typed (B09 C-1) |

### 23.5 Complete task inventory

**Arithmetic corrections applied here.** C3 states *"Inventory total: 141 tasks"* — the enumerated rows total **154**. C3 §6 states 62 CRITICAL / 34 IMPORTANT — the enumerated members total **87 CRITICAL / 52 IMPORTANT**. Seven tasks (T-008, T-014, T-015, T-016, T-033, T-043, T-044) appear in no C3 classification list and are classified **CRITICAL** here with the reason given in the row. **T-197 appears in both the IMPORTANT and DEFERRED lists in C3**; it is resolved here as IMPORTANT, because Phase 10 exit criterion 8 requires the pruning behaviour *measured*.

Classification key: **CRITICAL** = cutting it produces silent data exposure, silent data loss, an unrecoverable schema, a broken public contract or a fabricated record · **IMPORTANT** = cut only with a written, owner-signed acknowledgement · **DEFERRED** = ship without, add in v1.1 · **OPTIONAL** = build only if explicitly requested.

Complexity: **S** = hours · **M** = 1–3 days · **L** = ~1 week · **XL** = multi-week. These are **relative effort, not a schedule.** No effort or date estimate exists in any source document (R-71); the per-task sizes below are derived in this plan and must not be quoted to the owner as a commitment.

| ID | Task | Phase | Depends on | Cx | Class |
|---|---|---|---|---|---|
| T-001 | Rename `Project.status`→`projectStatus`, `Lead.status`→`leadStatus`; serialiser aliases back to `status` | 0 | — | S | CRITICAL |
| T-002 | Decide `idType: 'uuid'` (only `'serial'`/`'uuid'` exist; ULID unsupported) | 0 | — | S | CRITICAL |
| T-003 | Decide ordering: `orderable: true` (fractional-index strings) vs integer `sortOrder` | 1 | T-024 | S | CRITICAL |
| T-004 | Pin `next@16.3.3`, `react@19.2.6`, `react-dom@19.2.6`, `payload@3.90.x` + all `@payloadcms/*` identical, no `^`/`~`; `engines.node ">=20.9.0"`; npm | 0 | — | S | CRITICAL |
| T-005 | Amend D-004 to Payload's session model; close OQ-26/R-3 | 0 | — | S | IMPORTANT |
| T-006 | Amend FR-AUTH-04 / `SECURITY.md`: drop `argon2id`, state PBKDF2-SHA256 vendor-neutrally | 0 | — | S | IMPORTANT |
| T-007 | Promote D-012 (ISR + on-demand revalidation) to ACCEPTED, or add a sign-off gate | 0 | — | S | IMPORTANT |
| T-008 | Close OQ-7 to nodemailer+SMTP and `@payloadcms/storage-s3`; provider deferred to env vars | 0 | — | S | CRITICAL *(unclassified in C3; blocks T-107 and T-128)* |
| T-009 | Owner sign-off on OQ-1 (leads destination), OQ-2 (recipient/channel), OQ-3 (status pipeline) | 0 | — | S | IMPORTANT |
| T-010 | OQ-19 two-release transition plan: server accepts ≥8 digits, tightens to 10 with the frontend | 0 | — | S | IMPORTANT |
| T-011 | Resolve the SVG seeding paradox (rasterise vs validated seed bypass) | 0 | — | S | IMPORTANT |
| T-012 | Amend `AI-CONTEXT.md` "15 core tables" → "15 logical entities; generated child tables exempt" | 0 | — | S | IMPORTANT |
| T-013 | Correct `TRACEABILITY.md` pre-D-015 residue (`admin_sessions`, `argon2id`, CHECK cells, literal admin paths) | 0 | — | S | IMPORTANT |
| T-014 | Decide the public URL layout: Next Route Handlers under `src/app/(public)/api/v1/**` (§21.2) | 0 | — | S | CRITICAL *(unclassified in C3; mixing mechanisms is the failure mode)* |
| T-015 | Decide origins: backend on `cms.<domain>`, a subdomain of the public registrable domain | 0 | — | S | CRITICAL *(unclassified in C3; `SameSite=Lax` depends on it)* |
| T-016 | Verify the toolchain: Node 24.11.0 OK, Docker 29.3.1, npm 11.6.1, `psql` absent → dockerised client | 0 | — | S | CRITICAL *(unclassified in C3; gates the scaffold)* |
| T-020 | Scaffold a throwaway Payload 3 app in a temp dir (`npx create-payload-app -t blank --use-npm`) | 1 | T-004, T-016 | S | CRITICAL |
| T-021 | `postgresAdapter({ pool, idType, migrationDir, disableCreateDatabase })` against Postgres 15 in Docker | 1 | T-002, T-020 | S | CRITICAL |
| T-022 | Model the **complete** Project collection (25 fields, 6 arrays, 5 media roles, drafts on) | 1 | T-001, T-021, T-023 | L | CRITICAL |
| T-023 | Minimal Media collection (`upload: true`, `alt` required, explicit width/height) — **first** | 1 | T-021 | S | CRITICAL |
| T-024 | `payload generate:db-schema` and **read the emitted Drizzle schema**; record every measured fact | 1 | T-022, T-023 | M | CRITICAL |
| T-025 | `migrate:create` → `migrate` → `migrate:down` → `migrate` on a clean database | 1 | T-024 | S | CRITICAL |
| T-026 | Seed the 5 projects verbatim from `content/projects.ts` via `payload run` | 1 | T-011, T-022 | M | CRITICAL |
| T-027 | `toPublicProject()` v0 — allow-list, key-by-key, never spread, omit empties, alias `projectStatus`→`status` | 1 | T-022 | M | CRITICAL |
| T-028 | `GET /api/v1/projects/{slug}` with all three guards (`overrideAccess:false` + published `where` + include `select`) | 1 | T-027 | S | CRITICAL |
| T-029 | Make `types/content.ts` importable by the backend; write the contract test | 1 | T-028 | M | CRITICAL |
| T-030 | **GATE #2:** `description` round-trips as `string[]` at Local-API and HTTP layers | 1 | T-029 | S | CRITICAL |
| T-031 | **GATE #3:** absent optionals are absent — exact key-set snapshots, thin and full | 1 | T-029 | S | CRITICAL |
| T-032 | **GATE #5:** invalid icon rejected at the API **and** by the Postgres enum | 1 | T-022 | S | CRITICAL |
| T-033 | **GATE #6:** admin project editor usable with zero custom components | 1 | T-022, T-023 | S | CRITICAL *(unclassified in C3; it is a gate exit criterion)* |
| T-034 | **GATE #7:** seeded records diff clean against `projects.ts` field-for-field | 1 | T-026, T-028 | S | CRITICAL |
| T-035 | **THE GATE REPORT** — pass/fail per criterion, measured schema facts, forced decisions, verdict line | 1 | T-024, T-030..T-034 | S | CRITICAL |
| T-040 | Create `svbackend` as a git repo and scaffold the real app alongside `docs/` | 2 | T-035 | S | CRITICAL |
| T-041 | `src/payload.config.ts` baseline (db, secret, serverURL, cookiePrefix, telemetry:false, graphQL disabled, depths, sharp, admin) | 2 | T-040 | M | CRITICAL |
| T-042 | Fail-fast env validation at boot (`src/schemas/env.ts`) — never `PAYLOAD_SECRET \|\| ''` | 2 | T-041 | M | CRITICAL |
| T-043 | `next.config.mjs` with `withPayload(...)` + `output:'standalone'` + `headers()` | 2 | T-040 | S | CRITICAL *(unclassified in C3; the documented Dockerfile requires it)* |
| T-044 | npm scripts: `dev`,`build`,`start`,`payload`,`generate:*`,`migrate*`,`ci`,`seed`,`test` | 2 | T-040 | S | CRITICAL *(unclassified in C3; every later command depends on it)* |
| T-045 | Commit `payload-types.ts`; CI check that `generate:types` produces no diff | 2 | T-041 | S | IMPORTANT |
| T-046 | Structured logging: pre-instantiated pino, JSON to stdout, request-id correlation | 2 | T-041 | M | IMPORTANT |
| T-047 | Error-envelope helper: 9 top-level codes, `details[].code`, `requestId`, mandatory `try/catch` per handler | 2 | T-041 | M | CRITICAL |
| T-048 | `publicFind()` forcing `overrideAccess:false` + `user:undefined` + published `where` + include `select` | 2 | T-041 | M | CRITICAL |
| T-049 | `definePublicEndpoint()` attaching `headersWithCors`, cache headers, `ETag`, the envelope | 2 | T-047, T-048 | M | CRITICAL |
| T-050 | Migration discipline: explicit `migrationDir`, named migrations, sandbox reset script, push-vs-migrate house rule | 2 | T-044 | S | CRITICAL |
| T-051 | Test harness: Vitest, memoised `getPayload({ config })`, disposable Postgres, force-exit teardown | 2 | T-041 | M | CRITICAL |
| T-052 | `put()`/`omitEmpty()` primitive with **one** documented emptiness rule; ban object spread in serialisers | 2 | T-027 | S | CRITICAL |
| T-060 | `Users` collection with every `auth` option explicit (`useSessions`, `maxLoginAttempts:5`, `lockTime:900000`, cookies) | 3 | T-005, T-041 | M | CRITICAL |
| T-061 | ≥12-char password policy by redefining the injected `password` field + breach check — **verify it attaches** | 3 | T-060 | M | IMPORTANT |
| T-062 | Four access primitives: `isAdmin`, `anyone`, `nobody`, `publishedOrAuthenticated`. No RBAC scaffolding | 3 | T-041 | S | CRITICAL |
| T-063 | Explicit `access` block on **every** collection and global, incl. `readVersions`, `admin`, `unlock` | 3 | T-062 | M | CRITICAL |
| T-064 | First-admin bootstrap via seed script using the Local API (never `/create-first-user`) | 3 | T-051, T-060 | M | CRITICAL |
| T-065 | Auth-event audit hooks: `afterLogin`, `afterLogout`, failed login, lockout, password change | 3 | T-060, T-091 | M | IMPORTANT |
| T-066 | Lock down the generated surface: `graphQL.disable`, bulk-edit/delete/duplicate off, proxy block on `/api/<slug>` | 3 | T-063 | M | CRITICAL |
| T-067 | `cors` + `csrf` allow-lists from env; register and verify `OPTIONS`/preflight on custom endpoints | 3 | T-015, T-049 | S | CRITICAL |
| T-068 | Edge rate limiting: `/leads` 5/min/IP + 3/hr/phone, login 5/15min/IP, public-GET ceiling with build-origin exemption | 3 | T-015 | M | CRITICAL |
| T-069 | Security headers at the Next/proxy layer: HSTS, nosniff, frame-deny on admin, Referrer-Policy, Permissions-Policy, CSP | 3 | T-015 | M | CRITICAL |
| T-070 | Verify production error verbosity leaks nothing (`debug:false`; no stack/SQL/path/driver in any 5xx) | 3 | T-047 | S | CRITICAL |
| T-071 | Verify session revocation end-to-end; record the formal closure of OQ-26 / R-3 | 3 | T-051, T-060 | S | CRITICAL |
| T-080 | Port the spiked Project collection with final `dbName`s, `enumName`s, indexes (`slug` unique, `category`, `featured`, `_status`) | 4 | T-003, T-035, T-041 | L | CRITICAL |
| T-081 | Icon enum single source of truth: `src/lib/icons.ts` (41 camelCase values) + CI drift check | 4 | T-080 | S | CRITICAL |
| T-082 | Hand-rolled slug `text` field + `beforeValidate` normaliser, `unique`, `index`, `beforeDuplicate` | 4 | T-080 | M | CRITICAL |
| T-083 | Post-publish slug lock: `beforeValidate` collection hook + field-level `access.update` (not `admin.readOnly`) | 4 | T-082 | S | CRITICAL |
| T-084 | Map duplicate slug to a friendly `409 CONFLICT` with the contract message | 4 | T-082 | S | IMPORTANT |
| T-085 | `versions: { maxPerDoc: 20, drafts: { autosave: false, validate: true, schedulePublish: false } }` | 4 | T-080 | S | CRITICAL |
| T-086 | Custom `publishedAt` date field + `beforeChange` hook on the `_status` transition | 4 | T-085 | S | CRITICAL |
| T-087 | Implement ordering per T-003 (+ reorder shim if `orderable: true`) | 4 | T-003, T-024, T-080 | M | IMPORTANT |
| T-088 | `featured` checkbox + the published-and-featured read path | 4 | T-080 | S | IMPORTANT |
| T-089 | Archive/restore via Payload Trash (`trash: true`, `deletedAt`) + access filters + `admin.baseFilter` | 4 | T-080 | M | CRITICAL |
| T-090 | Field validation per `VALIDATION-RULES.md` (lengths, ≥1 paragraph, ≤50 items, cta both-or-neither, seo 70/160, NFC) | 4 | T-080 | L | CRITICAL |
| T-091 | `audit-log` collection (all writes denied) + shared `afterChange`/`afterDelete` hooks with sensitive-field diffs | 4 | T-063, T-080 | L | CRITICAL |
| T-092 | Admin list/editor config: `useAsTitle`, `defaultColumns`, `listSearchableFields`, `group`, `RowLabel` components | 4 | T-080 | M | IMPORTANT |
| T-093 | Production seed: 5 projects verbatim, idempotent by slug, gated on `PAYLOAD_SEED` | 4 | T-011, T-080 | M | CRITICAL |
| T-094 | Projects-domain migration + reversibility test in CI | 4 | T-080, T-082, T-085, T-087, T-089, T-090 | M | CRITICAL |
| T-100 | **Two** upload collections: `media` (images) and `documents` (PDF) | 4 | T-041 | S | CRITICAL |
| T-101 | `pasteURL: false` on both (it is **enabled by default**) | 4 | T-100 | S | CRITICAL |
| T-102 | `beforeOperation` upload guard: magic-byte sniff → MIME mismatch 415 → **hard SVG reject** → dimensions → EXIF strip | 4 | T-100 | L | CRITICAL |
| T-103 | UUID storage keys: rewrite `req.file.name` on **create and update**; extension from the sniffed type; keep `originalFilename` | 4 | T-102 | M | CRITICAL |
| T-104 | Own `width`/`height` — populate from `sharp().metadata()`, field-level access locked | 4 | T-100 | M | CRITICAL |
| T-105 | `alt` required; enforce "required before public attachment" in the serialiser/validate layer | 4 | T-100 | S | CRITICAL |
| T-106 | Exactly one `thumbnail` `imageSize` with `withoutEnlargement: true`, for `adminThumbnail` only | 4 | T-100 | S | IMPORTANT |
| T-107 | `s3Storage({ enabled: Boolean(env.S3_BUCKET), collections, bucket, config })` + `generateFileURL` to the CDN host | 6 | T-008, T-100 | M | IMPORTANT |
| T-108 | Bucket/CDN policy (not settable from `s3Storage()`): public-read, immutable cache, nosniff, PDF attachment | 6 | T-107 | M | IMPORTANT |
| T-109 | Project media roles as upload fields: `cover`, `gallery`, `layout`, `locationMap`, `brochure`→`documents` | 4 | T-080, T-100 | M | CRITICAL |
| T-110 | In-use delete guard: `join` fields + `beforeDelete` → `409` with the usage list; `?force=true` detaches | 6 | T-109 | L | IMPORTANT |
| T-111 | Media soft delete + 30-day sweeper; retain the old key on replace; never `overwriteExistingFiles` | 6 | T-110 | M | IMPORTANT |
| T-112 | Orphan detection ("unused only" filter from join counts). **Never auto-delete** | 6 | T-110 | S | DEFERRED |
| T-113 | Migrate existing assets: rasterise + upload + attach; do **not** migrate `hero.svg`/`hero-portrait.svg` | 6 | T-011, T-102, T-109 | M | IMPORTANT |
| T-114 | `ImageRef` serialisation → `{ src, alt, width, height }` with `depth` pinned on every public query | 4 | T-052, T-104 | M | CRITICAL |
| T-115 | Media rate limiting per session | 6 | T-068 | S | DEFERRED |
| T-120 | `leads` collection: name, phone, phoneNormalised, projectSlug (soft ref), message, source (server-assigned), leadStatus, consentGiven, isRead, ip, ua; trash on, **no versions** | 5 | T-001, T-009, T-010, T-041 | M | CRITICAL |
| T-121 | Field hooks: trim + NFC, phone → digits → E.164 `+91`, strip HTML from `message`, reject control chars | 5 | T-120 | M | CRITICAL |
| T-122 | Validation: name 1–120, phone per T-010 then ≤15, junk-number rejection, message ≤2000, known `projectSlug` | 5 | T-010, T-120 | M | CRITICAL |
| T-123 | `POST /api/v1/leads`: Zod, honeypot → indistinguishable `201`, `Idempotency-Key`, `422` field names, `no-store` | 5 | T-049, T-068, T-122 | L | CRITICAL |
| T-124 | Rate limit the lead endpoint at the edge | 5 | T-068, T-123 | S | CRITICAL |
| T-125 | Windowed dedupe on `(phoneNormalised, projectSlug)` + non-unique compound index; **define the window** | 5 | T-120 | M | IMPORTANT |
| T-126 | Jobs task `sendLeadNotification`: `retries: 3`, input `{ leadId }`, idempotent, `JobCancelledError` on poison input | 5 | T-120 | M | CRITICAL |
| T-127 | `afterChange(create)` hook enqueues inside `try/catch`; never await the send; never pass `req` | 5 | T-126 | S | CRITICAL |
| T-128 | `nodemailerAdapter` + SMTP in prod, no-arg ethereal in dev/staging, **boot guard refusing prod without SMTP** | 5 | T-008, T-042 | M | CRITICAL |
| T-129 | Lead notification template + `escapeHtml` on every attacker-controlled field + plaintext alternate | 5 | T-128 | M | CRITICAL |
| T-130 | Worker containers: `payload jobs:run --cron ... --queue ... --limit 25`, restart policy, liveness alarm | 5 | T-126, T-128, T-200 | M | IMPORTANT |
| T-131 | Failed/stuck-job watchdog (`hasError`, stuck `processing`, aged `completedAt: null`) + second-channel alert | 5 | T-130 | M | IMPORTANT |
| T-132 | Delete `notification_jobs` (DATABASE-SCHEMA Table 15); record the field mapping to `payload-jobs` | 5 | T-126 | S | DEFERRED |
| T-133 | Admin leads list/detail: columns, filters, `defaultSort:'-createdAt'`, click-to-call + WhatsApp links, never hard delete | 5 | T-009, T-120 | M | IMPORTANT |
| T-134 | PII retention job: purge `ipAddress`/`userAgent` at ~90 days; define the lead-record lifetime; erasure path | 5 | T-120 | M | IMPORTANT |
| T-135 | Explicit test that **no public route returns lead data**, incl. Payload's generated `/api/leads` | 5 | T-051, T-066, T-120 | S | CRITICAL |
| T-140 | `GET /api/v1/projects` — card fields, published, admin order, `category?`/`featured?`, no pagination/search/sort | 7 | T-049, T-080, T-114 | M | CRITICAL |
| T-141 | `GET /api/v1/site-settings` + `toPublicSiteSettings()` | 7 | T-049, T-163 | S | IMPORTANT |
| T-142 | `GET /api/v1/testimonials` — published **and consented** only | 7 | T-049, T-160 | S | IMPORTANT |
| T-143 | `GET /api/v1/faqs` — ordered, published | 7 | T-049, T-161 | S | IMPORTANT |
| T-144 | `GET /api/v1/statistics` — ordered; values are authored TEXT | 7 | T-049, T-162 | S | IMPORTANT |
| T-145 | `/healthz` as a **root** Route Handler (`force-dynamic`, trivial DB probe) + DB-free `/livez` | 2 | T-041 | S | IMPORTANT |
| T-146 | Cache semantics: `public, max-age=60, stale-while-revalidate=600` + `ETag`; `no-store` on admin and `POST /leads` | 7 | T-049 | S | CRITICAL |
| T-147 | Revalidation via `afterChange`/`afterDelete` **collection** hooks → `REVALIDATE_WEBHOOK_URL`; fire-and-forget with retry | 7 | T-007, T-080, T-163 | L | CRITICAL |
| T-148 | Contract tests for all 6 read endpoints against `types/content.ts`, in CI | 7 | T-029, T-140..T-144 | L | CRITICAL |
| T-149 | Key-set snapshot tests per endpoint, thin document and full document | 7 | T-148 | M | CRITICAL |
| T-160 | `testimonials` + `consented` default false + `beforeValidate` publish block + **DB CHECK via custom migration** | 8 | T-041, T-063 | M | CRITICAL |
| T-161 | `faqs` collection (ordered, published) | 8 | T-041, T-063 | S | IMPORTANT |
| T-162 | `statistics` collection — `label`/`value` both TEXT | 8 | T-041, T-063 | S | IMPORTANT |
| T-163 | `site-settings` **global**: brand/contact/social/legal/content, `versions:{ max:50 }`, **`access.read: () => true`** | 8 | T-041, T-100 | L | CRITICAL |
| T-164 | Placeholder-tolerant validation: `^\[.*\]$` bypasses format checks, keeps length limits | 8 | T-163 | M | IMPORTANT |
| T-165 | Approved Tier-2 extras (ticker, site specs, site proximity, shared CTA, master-plan PDF) + endpoints | 8 | T-160..T-163 | M | DEFERRED |
| T-166 | Placeholder-awareness field component + dashboard counter (OQ-15) | 8 | T-165 | M | OPTIONAL |
| T-167 | Icon validation inside `social[]` entries | 8 | T-081, T-163 | S | IMPORTANT |
| T-170 | **Obtain explicit human approval** to modify `svfrontend/` | 9 | T-148 | S | CRITICAL |
| T-171 | Typed data layer in `svfrontend/src/lib/api/` fetching the 6 public endpoints at build/revalidate time | 9 | T-147, T-148, T-170 | L | IMPORTANT |
| T-172 | `generateStaticParams` sourced from `GET /projects` | 9 | T-171 | S | IMPORTANT |
| T-173 | Nav and footer project links derived from published projects (FR-CONT-11) | 9 | T-171 | M | IMPORTANT |
| T-174 | Wire `ContactForm` to `POST /leads`; success **only** on a real `201`; map `422` into the existing `Errors` map | 9 | T-123, T-171 | L | CRITICAL |
| T-175 | `svfrontend/src/app/api/revalidate/route.ts` + shared secret | 9 | T-147, T-171 | M | IMPORTANT |
| T-176 | Add `images.remotePatterns` for the CDN host — **six `next/image` call sites throw without it** | 9 | T-108, T-171 | S | CRITICAL |
| T-177 | Fix the three count-coupled hardcoded strings ("Five layouts." ×2, "Aler · Bhongir · Genome Valley") | 9 | T-170 | S | IMPORTANT |
| T-178 | OQ-19 alignment: tighten the form's phone rule to 10 digits in the same release as the backend | 9 | T-010, T-174 | S | IMPORTANT |
| T-179 | Fix the two latent href bugs: live `mailto:[EMAIL@DOMAIN]`, and the raw-digit WhatsApp href | 9 | T-170 | S | IMPORTANT |
| T-180 | React key collisions: backend uniqueness validation per list, or row-id keys | 9 | T-090, T-170 | M | DEFERRED |
| T-181 | Delete the dead `media.hero` / `media.heroPortrait` keys | 9 | T-170 | S | DEFERRED |
| T-182 | Verify the performance contract: prerender set, LCP < 2.5 s, CLS < 0.05, First Load JS 102–114 kB, `tsc --noEmit` | 9 | T-171..T-176 | M | CRITICAL |
| T-183 | Remove `dangerouslyAllowSVG` (3 lines) once real raster art replaces every placeholder | 9 | T-113, T-182 | S | DEFERRED |
| T-190 | Execute and evidence the 22-item pre-production security checklist (§15.3) | 10 | T-060..T-071, T-102, T-196 | M | CRITICAL |
| T-191 | Authz test matrix incl. `?draft=true` and `?where[_status][equals]=draft` | 10 | T-051, T-063, T-066, T-135 | L | CRITICAL |
| T-192 | Upload security tests: SVG, magic bytes, oversize, 10001 px bomb, EXIF | 10 | T-051, T-102 | M | CRITICAL |
| T-193 | Rate-limit tests (lead endpoint, login, public-GET ceiling, build-origin exemption) | 10 | T-068, T-124 | M | IMPORTANT |
| T-194 | Load test `POST /leads` against NFR-01 (< 500 ms p95) | 10 | T-051, T-123 | M | IMPORTANT |
| T-195 | Dependency audit; verify exact pins and a single copy of `react`/`react-dom` | 10 | T-004 | S | IMPORTANT |
| T-196 | Backups: nightly `pg_dump -Fc` or managed PITR, S3 versioning, pre-migration backup, **and a performed restore** | 10 | T-200 | L | CRITICAL |
| T-197 | Empirically measure `versions.maxPerDoc` pruning behaviour before sizing the database | 10 | T-051, T-085 | M | IMPORTANT *(C3 lists this twice; resolved here as IMPORTANT — Phase 10 exit 8 requires it measured)* |
| T-198 | **Publish and link the privacy policy** before the contact form goes live (OQ-24) | 10 | T-009 | S | CRITICAL |
| T-200 | Production infrastructure: container host, managed Postgres (TLS, least-privilege, `disableCreateDatabase:true`), S3 + CDN, reverse proxy | 11 | T-015, T-043 | L | CRITICAL |
| T-201 | Platform secret store; per-environment secrets; `PAYLOAD_SECRET` ≥32 bytes; rotation runbook naming "regenerate all API keys" | 11 | T-042, T-200 | M | CRITICAL |
| T-202 | CI/CD: `npm ci` → `migrate:status` → backup → `migrate` → `generate:importmap && next build` → image → deploy | 11 | T-044, T-050, T-196 | L | CRITICAL |
| T-203 | Admin UI on `cms.<domain>` | 11 | T-015, T-200 | S | IMPORTANT |
| T-204 | Monitoring and alerts: error rate, lead-submission failures, queue depth, **worker liveness**, health probe | 11 | T-131, T-145, T-200 | M | IMPORTANT |
| T-205 | Runbook: deploy, rollback, restore, revoke a session, re-send a notification, rotate secrets, reset the sandbox | 11 | T-131, T-196, T-201 | M | IMPORTANT |
| T-206 | Go-live smoke: synthetic lead end-to-end **including the notification**; admin publish visible; alerts fire | 11 | T-130, T-182, T-190, T-198, T-204 | M | CRITICAL |
| T-207 | Validate the **sharp** native binary on the target architecture by uploading a real image in production | 11 | T-102, T-200 | S | IMPORTANT |
| T-208 | Create **two** admin accounts from day one | 11 | T-064, T-200 | S | IMPORTANT |

**Inventory totals (corrected): 154 tasks — 87 CRITICAL, 52 IMPORTANT, 8 DEFERRED, 1 OPTIONAL, plus 6 non-task DEFERRED/OPTIONAL items carried as requirement ids (FR-LEAD-12/13/17/18, FR-AUDIT-03 screen, FR-MEDIA-13) listed in §27.**

---

## 24. Critical Path

The longest chain of genuinely sequential work from today to a production-ready deployed system. Complexity is relative effort, not a schedule (see §23.5).

### 24.1 Step 0 — the Phase-1 D-015 validation spike, and why it leads

Everything downstream is contingent on it. **D-015 is explicitly provisional**, and the documents say so in four places. The spike is a throwaway app in a temp directory, deleted after the report is written; if the gate fails, nothing of value is thrown away — which is exactly what makes the stop-and-reassess clause executable rather than decorative.

**Run in this order. Total scope: one media skeleton, one collection, one endpoint, one seed, six assertions, one report.**

```
STEP 1   T-001, T-002, T-004  ── status rename · idType:'uuid' · exact version pins        [minutes]
STEP 2   T-020, T-021         ── npx create-payload-app -t blank --use-npm
                                 next@16.3.3 · react@19.2.6 · payload@3.90.x
                                 @payloadcms/db-postgres · Postgres 15 in Docker
                                 dev `push` ON, the DB treated as disposable                [hours]
STEP 3   T-023                ── Media collection FIRST: upload:true, alt required,
                                 explicit width/height, pasteURL:false, raster mimeTypes
                                 ▸ upload relations need an existing target (F-2)
STEP 4   T-022                ── the FULL Project collection, no shortcuts:
                                 description → text + hasMany:true + minRows:1
                                 6 arrays with EXPLICIT dbName · cta/seo as named groups
                                 icon → select with EXPLICIT enumName · category/projectStatus
                                 5 upload roles · versions: { drafts: true }
STEP 5   T-024   ★ THE MOST IMPORTANT STEP ★
                 npx payload generate:db-schema → READ THE EMITTED FILE AND RECORD:
                   every table and column name actually produced · how hasMany text is
                   stored · whether array rows carry id and _order · whether groups
                   flatten · the NAME of the field orderable:true creates (undocumented)
                   · createdAt/updatedAt column type · any identifier near 63 bytes
STEP 6   T-025                ── migrate:create → migrate → migrate:down → migrate
                                 on a CLEAN database. Prove reversibility now.
STEP 7   T-026                ── seed the 5 projects verbatim (covers per T-011)
STEP 8   T-027, T-028         ── toPublicProject() v0 + GET /api/v1/projects/{slug}
                                 with ALL THREE guards
STEP 9   T-029                ── vendor types/content.ts; write the contract test
STEP 10  the six assertions, each a real test, not a manual look
STEP 11  T-035                ── THE GATE REPORT
THEN DELETE THE SPIKE.  It is a decision artefact, not a codebase.
```

**The exact pass/fail assertions.** Each is a test file, not an observation.

| Gate | Assertion, exactly | Passes when | Fails when |
|---|---|---|---|
| **#1** Model expressible | The generated `payload-generated.schema.ts` is read and every one of the 25 `Project` fields, 6 repeatable lists and 5 media roles is located in it | Every field has a column or child table, and no field is missing from `payload-types.ts` | A field is silently absent — the `status` sanitisation failure mode |
| **#2** `description` is `string[]` | `expect(Array.isArray(doc.description)).toBe(true)` and `doc.description.every(d => typeof d === 'string')` at the **Local API** layer; `expect(res.description).toEqual(['First paragraph.','Second paragraph.'])` and `expect(res.description[0]).not.toHaveProperty('value')` at the **HTTP** layer | Both layers return a flat array of primitives | Either layer returns `[{ id, value }]` |
| **#3** Absent optionals absent | For a thin project: `expect(k in thin.data).toBe(false)` — using `in`, not `=== undefined` — for `status, developer, tagline, stats, amenities, approvals, locationHighlights, proximity, area, roadDetails, gallery, layoutImage, locationMap, cta, seo`; plus an exact `Object.keys().sort()` snapshot | No `null`, no `""`, no `[]` for an absent optional | Any absent optional emits a key |
| **#4** Contract test | The response object satisfies the real `Project` type from `svfrontend/src/types/content.ts`, compiled under that repo's `strict: true` | `expectTypeOf` + runtime key-set both pass | `null` appears where the type says `T \| undefined` |
| **#5** Invalid icon rejected | `icon: 'notAnIcon'` rejected at the API boundary **and** by a direct SQL insert against the generated Postgres enum type | Both reject | The DB accepts it → the `enumName` was not set |
| **#6** Admin editor usable | Open the generated project editor; confirm 25 fields, 6 repeatable lists and 5 media pickers are usable with **zero custom components**. Screenshot it | Usable; row labels reading "Item 01" are cosmetic, not a failure | A field cannot be edited at all |
| **#7** Seed is byte-faithful | Field-for-field diff of the seeded records against `content/projects.ts`, `[BRACKETED]` values preserved byte-for-byte | Clean diff | Any value normalised, trimmed or reordered |
| **#8** Migration reversibility | `migrate` then `migrate:down` then `migrate` on a clean database | All three succeed | Any step errors |

**The Directus fallback trigger — exact terms.** Failure of criterion **#1, #2 or #4** voids D-015 and makes **Directus** the stack, because it is database-first and would accept `DATABASE-SCHEMA.md` literally. The documented instruction is *"Do not proceed on hope."*

Three amendments this plan adopts, and their reasons:
1. **Criterion #4 is gating.** The source documents name only #1–#3; failing the contract test is functionally identical to failing #2, and A3 records the omission as contradiction C-20 / C2 records it as CONF-73.
2. **Criterion #3 cannot trigger the fallback on its own.** It tests `toPublicProject()`, which is *our* code and is identical work under Directus. If #3 fails, fix the serialiser — do not switch stacks.
3. **A time-box overrun is soft evidence, not a trigger.** Record it in the gate report and let the owner weigh it. Do not switch architectures on effort alone after one spike.

**Most likely outcome, stated for the record:** the gate passes on all criteria. Nothing in 700 KB of official-docs research is a blocker, and all three B-files that looked for one concluded *"Hard blockers: None."* The spike's real deliverable is the list of forced schema decisions — chief among them the `status` rename, the one finding that would otherwise have caused a **silent, invisible field deletion**.

### 24.2 The ordered critical path

| # | Step | Tasks | Cx | Why it is genuinely unmovable |
|---|---|---|---|---|
| **1** | Irreversible schema decisions | T-001, T-002, T-004 | S | `status` is silently sanitised from the config under Postgres + drafts, and `idType` is adapter-global and cannot change after migration 001 without a full-schema rebuild. Both are irreversible-after-the-fact and cost hours now against a rebuild later. **Nothing can be modelled before them.** |
| **2** | Scaffold → Postgres → Media skeleton → full Project model | T-020, T-021, T-023, T-022 | L | The gate cannot be evaluated against a partial model — the point is that the **complete** 25-field, 6-array, 5-media-role model is expressible. Media must precede Project because upload relations need an existing target. |
| **3** | `generate:db-schema` and read the emitted Drizzle schema | T-024 | S | The only way to learn what the docs do not say: `hasMany` text storage, array `_order`/row-`id` columns, group flattening, the `orderable` order-field name, identifier truncation at 63 bytes, `timestamptz`. T-003 and T-087 both block on it. Skipping it means designing migration 001 on assumption. |
| **4** | Serialiser → endpoint → contract test | T-027, T-028, T-029 | M | The serialiser is the **single control point** for D-008 and the only irreducible cost item in the architecture — it is identical work under every option evaluated. The contract test is what makes changing anything afterwards safe. |
| **5** | The gate assertions and the gate report | T-030, T-031, T-032, T-034, T-035 | M | D-015 is provisional until these pass. Building anything real first means building on hope. |
| **6** | Real repo → config → env guard → envelope → `publicFind` → `definePublicEndpoint` | T-040, T-041, T-042, T-047, T-048, T-049 | L | Every later endpoint is written *through* these wrappers. Retrofitting `overrideAccess: false`, CORS, cache headers and the error envelope onto N handlers is strictly more work, and each omission is a **security defect, not a bug**. |
| **7** | Access primitives → explicit access everywhere → generated-surface lockdown | T-062, T-063, T-066 | M | Payload's default is *any authenticated user, full CRUD*, and the generated REST API is on by default with **no documented kill switch**. Until T-066, **every collection added is a publicly-addressable endpoint in Payload's own JSON shape.** This gates every subsequent collection. |
| **8** | Project collection → drafts + `publishedAt` → ordering → audit hooks | T-080, T-085, T-086, T-087, T-091 | L | The Project entity is the source of the response contract. Audit hooks land **with** the collection, not later, because the **admin UI publishes directly and never touches our endpoints** — any publish before the hooks exist is permanently unlogged, and approval numbers are legally sensitive. |
| **9** | Media collections → upload guard → own width/height → project roles → `ImageRef` | T-100, T-102, T-104, T-109, T-114 | L | `ImageRef` hard-requires `width`/`height` and the CLS budget (< 0.05) depends on them. `/projects` cannot return a valid `Project` without this. The upload guard is security-critical and cannot be deferred past the first real upload. |
| **10** | `GET /projects` → revalidation hooks → 6-endpoint contract suite in CI | T-140, T-147, T-148 | M | Publishing without revalidation is *"the single most confusing possible failure for an admin"* — the edit silently never appears. The contract suite is what makes frontend integration safe to attempt. |
| **11** | Approval → data layer → form wiring → `remotePatterns` → performance verification | T-170, T-171, T-174, T-176, T-182 | L | The only phase touching `svfrontend/`; it needs **separate human approval**; and `next.config.mjs` has no `images.remotePatterns` today, so six `next/image` call sites throw the instant URLs become remote. T-182 is the acceptance of the whole product. |
| **12** | Production infrastructure → backups **with a performed restore** → CI migrate-then-build | T-200, T-196, T-202 | M | Backups need infrastructure; the CI gate needs the backup step; Payload documents none of it and ships `migrate:fresh` one typo from a deploy script. NFR-10 demands a *tested* restore. |
| **13** | Security checklist → go-live smoke | T-190, T-206 | M | Nothing else can be last: the smoke test **is** the definition of production-ready, and it transitively requires the worker (T-130), monitoring (T-204) and the privacy policy (T-198). |

### 24.3 Realistic sequential depth

**13 steps ≈ 4 × L + 5 × M + 2 × S, with compound-L depth inside steps 2, 6, 8, 9 and 11.** Step 8 (Projects + audit) and step 9 (Media core) together form the XL Phase 4, which is the largest single block of work in the project.

**These are relative sizes and nothing more.** No effort or date estimate exists anywhere in the source corpus — the only sizing on record is a directional T-shirt table explicitly labelled *"not a quote"* (R-71). **Do not quote a schedule to the owner.** If dates are needed, produce them deliberately *after* the Phase-1 gate, when the gate report has said whether the architecture holds.

### 24.4 What the critical path does NOT include

Deliberately off the path, developed in parallel and joined before step 12:

- **Leads and notifications** (T-120…T-135) — real work, nothing in the projects chain depends on it. **Business priority ranks it second**, because it closes the only gap that exists today: every enquiry typed into the live form is currently discarded. That is a business priority, not a critical-path position. The resolution is §25: leads is the **first parallel workstream to start** and reaches a shippable state long before the projects chain does. If the deadline compresses, ship leads to production as a standalone slice.
- **Media hardening** (T-107, T-108, T-110…T-113, T-115) — S3 wiring, delete guard, sweeper, orphans, asset migration.
- **Tier-2 content** (T-160…T-167) — near-pure configuration with one piece of real logic.
- **Infrastructure** (T-200…T-205) — can begin during the spike, and **must** complete before the worker (T-130) and the restore drill (T-196).
- **All optional admin polish** — icon picker, placeholder counter, dashboard views.

**The path also does not include, and cannot include, the four launch blockers that are owner deliverables:** the company name (OQ-6), the `[BRACKETED]` values (OQ-22), real testimonial quotes or the section's deletion (OQ-23), and the privacy policy (OQ-24). None blocks a single line of code; all four stop launch dead; three have **no safe default at all**. They are on the go-live checklist (§29 Phase 11, §31), not on the engineering path.

---

## 25. Parallel Tasks

### 25.1 How much parallelism actually exists

**Before the gate: ZERO.** T-020 → T-035 is strictly sequential and must not be parallelised. The whole point is a single, cheap, honest answer to *"does the architecture hold"*. Two people on two branches produce two half-models and no gate report.

**After the gate and after the Foundation + Security Spine: FIVE concurrent workstreams**, converging at T-148 and again at T-206.

```
                          ┌──────────────────────────────────────┐
  T-035 gate ──► FOUNDATION (T-040..T-052)  ──►  SECURITY SPINE  │
                          │  (T-060..T-071)                      │
                          └────────┬─────────────────────────────┘
                                   │
        ┌──────────────┬───────────┼────────────┬──────────────────┐
        ▼              ▼           ▼            ▼                  ▼
   WS-A PROJECTS   WS-B MEDIA   WS-C LEADS   WS-D TIER-2      WS-E INFRA
   T-080..T-094    T-100..T-115 T-120..T-135 T-160..T-167     T-200..T-205
        │              │           │            │                  │
        └──────┬───────┘           │            │                  │
               ▼                   │            │                  │
        T-140 GET /projects        │            │                  │
               └───────────────────┴────────────┴──────► T-148 ◄───┘
                                                          │
                                                          ▼
                                                  T-170 FRONTEND (approval)
                                                          │
                                                          ▼
                                                  T-190 → T-206 GO-LIVE
```

### 25.2 The workstreams

| WS | Scope | Needs before it can start | Must NOT touch | Rejoins at |
|---|---|---|---|---|
| **WS-A · Projects** | T-080…T-094, T-109, T-114 | T-035 (gate report), T-041 (config), T-063 (access), T-003 (ordering decision), T-100 (Media skeleton, for the upload relations) | `src/collections/Leads.ts`, `src/collections/Testimonials.ts`, `src/media/storage.ts`, anything under `svfrontend/`. **Does not own `src/lib/publicFind.ts` or `src/lib/definePublicEndpoint.ts`** — those are frozen foundation | T-140, then T-148 |
| **WS-B · Media** | T-100…T-108, T-110…T-115 | T-041 only. **Not blocked on OQ-7** — build on local disk; `s3Storage({ enabled: Boolean(env.S3_BUCKET) })` gates the adapter | `src/collections/Projects.ts` except the five upload-field declarations (T-109), which are co-owned with WS-A and must be a single reviewed commit | T-140 (via `ImageRef`), T-148 |
| **WS-C · Leads** | T-120…T-135 | T-041, T-049, T-063, T-068 (edge rate limiting), and T-009 + T-010 answered. **Not blocked on the email provider.** T-130 additionally needs T-200 | `src/collections/Projects.ts`, `src/collections/Media.ts`, the serialisers directory. Owns `src/jobs/sendLeadNotification.ts`, `src/email/**`, `src/hooks/lead*.ts` | T-206 (via the worker) |
| **WS-D · Tier-2** | T-160…T-167 | T-041, T-063. Zero dependency on WS-A/B/C | `src/collections/Projects.ts`, `src/collections/Leads.ts`. Owns `src/globals/SiteSettings.ts` and the three tier-2 collections | T-148 |
| **WS-E · Infra** | T-200…T-205, plus T-068, T-069, T-196 | T-015 (origins decision) and T-043. **Can begin during the spike** — it needs no application code | Any file under `src/`. Owns `Dockerfile`, `docker-compose.yml`, the reverse-proxy config, the CI pipeline, the runbook | T-130 (worker host), T-196 (restore drill), T-206 |

### 25.3 Parallelism inside a workstream

- **WS-A:** once T-080 lands, **six mutually independent tasks** — T-081 (icon source of truth), T-082/T-083 (slug + lock), T-085/T-086 (drafts + `publishedAt`), T-089 (trash), T-090 (validation), T-092 (admin config). T-091 (audit) and T-094 (migration) are the joins and must be last.
- **WS-B:** T-101…T-106 are independent of one another once T-100 exists. T-107/T-108 (S3 + CDN) are independent of T-110/T-111/T-112 (delete guard, sweeper, orphans).
- **WS-C:** T-126…T-129 (task, hook, adapter, template) can be built and unit-tested with `payload.jobs.runByID()` **before** the worker deployment (T-130) exists — that is the docs' own recommended test pattern.
- **Testing is not a workstream.** T-051 is foundation; every test after it belongs to the task it covers. Only T-193, T-194 and T-190 are genuinely terminal.

### 25.4 Allocation by team size

**1 developer.** Run the critical path in §24.2 in order, and interleave the parallel streams at the two points where the path is waiting on nothing: start **WS-C (Leads)** immediately after the Security Spine and before Phase 4, because it is the only work closing an active loss and it is fully independent; and pull **WS-E (Infra)** forward into the spike's idle time, because it needs no application code. Order: Phase 0 → 1 → 2 → 3 → **5 (leads, to a shippable slice)** → 4 → 6 → 7 → 8 → 9 → 10 → 11. Do **not** attempt Tier-2 before the public API contract exists; it produces endpoints with no contract test.

**2 developers.** Dev 1 owns the critical path end to end: Phases 0–4, then 7, then 9. Dev 2 owns WS-C then WS-B then WS-D, and carries WS-E throughout. The two must synchronise at exactly three points: **T-109** (the five upload fields on `Projects.ts` — one reviewed commit, co-owned), **T-148** (the contract suite, which both streams feed), and **T-200** (infra must exist before WS-C's worker). Neither developer may edit `src/lib/publicFind.ts`, `src/lib/definePublicEndpoint.ts`, `src/lib/errors.ts` or `src/serializers/put.ts` after Phase 2 closes without a review from the other — those four files are the guard rails and a silent edit to them is a security change.

**3 developers.** Dev 1: critical path (WS-A → Phase 7 → Phase 9). Dev 2: WS-C (leads) then WS-D (tier-2). Dev 3: WS-B (media) then WS-E (infra) then Phase 10 hardening. This is the maximum useful width — a fourth developer would have to be given either the spike (which must not be parallelised) or the frontend phase (which cannot start before T-148 and an approval), and both are false parallelism.

**At every team size, one rule holds:** the Phase-1 spike is done by **exactly one person**, and the gate report has exactly one author.

### 25.5 Merge points, and what breaks if they go badly

| Merge point | Who converges | What breaks if it reconverges badly |
|---|---|---|
| **T-109** — the 5 upload fields on `Projects.ts` | WS-A + WS-B | Two branches declaring upload fields against a Media collection whose slug or field names moved. Symptom: `relationTo: 'media'` resolves, but `depth` population returns a bare id string and `toImageRef()` emits a broken image. **Guard:** one reviewed commit, and a test asserting `ImageRef` has all four keys. |
| **T-140** — `GET /api/v1/projects` | WS-A + WS-B | The card serialiser is written against a `Project` shape one stream has already changed. Symptom: contract test passes on one branch and fails on merge. **Guard:** `src/serializers/` is single-owner; the card shape is derived from the same `put()` primitive as the full shape. |
| **T-148** — the 6-endpoint contract suite in CI | WS-A + WS-B + WS-D (+ WS-C's `POST /leads` shape) | Four streams each added an endpoint with its own error shape, its own cache headers and its own CORS handling. Symptom: browser-side CORS failures that pass every curl test, and four different `422` bodies the frontend cannot map. **Guard:** every handler is written through `definePublicEndpoint()`; a lint rule fails the build on a raw `payload.find` under `src/app/(public)/**`. **This is the merge point that most needs enforcing, because its failure mode is invisible from the server side.** |
| **T-200 → T-130** | WS-E + WS-C | The worker is deployed against infrastructure with a different `DATABASE_URL` or no `CRON_SECRET`. Symptom: `jobs.queue()` succeeds, leads save, the API returns `201`, and **zero notifications go out with no error anywhere in the request path**. **Guard:** T-204's worker-liveness alarm must exist before T-130 is called done. |
| **T-182 → T-206** | all streams | The frontend is verified against a backend that then changes. Symptom: an `Invalid src prop` throw or a `null` in a response, discovered at go-live. **Guard:** Phase 9 entry requires Phase 7 **complete and stable**; the contract suite runs in CI on every backend commit after T-148. |

### 25.6 The two false parallelisms to avoid

1. **Do not parallelise the spike.** It is a single decision with a single report. Two half-models answer nothing.
2. **Do not start frontend integration (T-170+) in parallel with the public API.** It needs an approval the team does not currently have; the endpoints must be contract-stable first; and the frontend's own rule is that the form shows success **only** on a real `201`. Wiring against a moving API produces exactly the fake-success the repository was built to prevent.

---

## 26. Remaining Business Decisions

**Nothing in this section has been decided.** Every "safe temporary default" below is a *technical* posture chosen to be reversible, honest about being undecided, and incapable of being mistaken for the owner's answer. Where a default exists, adopting it must be recorded as *"engineering adopted the documented interim behaviour"*, never as *"the owner chose X"*. Four questions have **no safe default at all** and are marked as such.

### 26.1 Count correction

`OPEN-QUESTIONS.md` contains **26 question ids (OQ-1 … OQ-26)**. Its own summary table sums to **25** — 1 resolved + 4 + 1 + 4 + 9 + 6 — because **OQ-26 is appended *below* the table**, under the heading *"New question raised by D-015:"*, and is never counted. **The true total is 26.** Anyone counting from the table under-reports by one and, worse, misses the D-004 / Payload-session conflict entirely, because OQ-26 *is* that conflict.

Two further register defects, recorded so they are not re-derived:
- **OQ-5 is classified twice and inconsistently** — the body files it under "🔴 Blocking backend implementation"; the summary table reclassifies it as "🟡 Partially answered" and excludes it from the 🔴 count of 4.
- **OQ-1's own "Affects" line points at the wrong phase** (it says Phase 8; leads is Phase 7 in the old roadmap, Phase 5 here).

**Net position: 26 questions. 3 are resolved (OQ-16, OQ-21, OQ-26). 4 block implementation. 4 block launch and nothing else. The remainder are shaping or deferred.** Ten further technical decisions (OQ-27 … OQ-36) were *created* by the official-docs research and are listed in §26.3; they are not business questions and most must be settled before migration 001.

### 26.2 The 26 registered open questions

Phase numbers are the **restructured** numbers from §23.1. "True deadline" is the latest phase at which the question must be answered for work not to be wasted.

| ID | Decision needed | Classification | Phase affected | Why it matters | Safe temporary default | True deadline |
|---|---|---|---|---|---|---|
| **OQ-1** | Where do leads ultimately go — (a) our database only, (b) database **and** email notification, or (c) push to a named CRM (which CRM, which account, whose API key)? | **BLOCKING IMPLEMENTATION** | 5 | Decides whether the `leads` collection, the admin lead screens and FR-LEAD-10..18 exist at all, and whether a third integration enters the system — which changes the secret set, the failure modes and the DPDP data-flow map | Build the `leads` collection and persist. Build **no** CRM integration and do not design one in — a CRM is later an additive `payload-jobs` task fed by the same `afterChange` hook. Record it as the interim posture, **not** as "the owner chose to persist" | **Phase 5 start** |
| **OQ-2** | Who is notified of a new lead, at exactly which address(es); email only or also WhatsApp/SMS; instant or digest? | **BLOCKING IMPLEMENTATION** | 5 | **One channel is a Payload *Task*; two or more is a Payload *Workflow***, because a WhatsApp outage must not re-send the sales email. Choosing wrong means either premature workflow machinery or a later restructure. WhatsApp Business API additionally means Meta business verification, template approval and per-message cost — procurement, not coding | A single Task `sendLeadNotification`, instant, email-only, recipient from `SALES_NOTIFICATION_EMAIL`. **Plus a boot guard that refuses to start in production if it is unset** — the default must not silently become "nobody is notified" | **Phase 5 start** (a literal recipient address is required to ship) |
| **OQ-3** | Is the lead status pipeline real — will a human maintain `new → contacted → visit_scheduled → visited → won → lost`, and is that vocabulary right? | **DESIGN-SHAPING** (downgraded from 🔴) | 5 (field + control); 0 (the name) | *"A status field nobody maintains is worse than none — it looks like data and is not."* Separately, the field **cannot be called `status`** — reserved on Postgres with drafts, and *"using reserved field names will result in your field being sanitized from the config"*, silently | Ship `leadStatus` as a nullable `select` with the six values and `enumName` set, with `admin.condition` **hiding the control**. Never name it `status` | Phase 5 exit (the control's visibility); **Phase 0** for the name |
| **OQ-4** | One admin role, or several (does sales see only leads while marketing sees only content)? If several, the exact matrix | **DESIGN-SHAPING** | 3 | Decides whether `access` functions take a role argument. Payload ships **no RBAC primitive** — roles are an ordinary field you define and check yourself. With one role, membership of the auth collection *is* the authorisation and the whole authorisation codebase is four functions | Single role. **Internal conflict on record:** P-04 says ship a `role` column so adding more is a policy change; B05 §10 says do not carry unused RBAC scaffolding. Recommended: add the field with exactly one option (`admin`) and write every access function as an explicit role check from day one — satisfying P-04's intent without RBAC machinery, and avoiding `Boolean(user)` rotting into an implicit grant | **Phase 3** |
| **OQ-5** | Who builds the small number of custom admin components (icon picker, placeholder counter, CSV export button, dashboard tile), and are they in scope? | **DESIGN-SHAPING** — the residual is **resourcing**, not technical | 8 | The "where" is already answered three times over: D-015 puts the admin UI in the Payload app, Phase 11 puts it on `cms.<domain>`, and svfrontend's Next 15.5.25 puts it **outside every Payload-supported range**, so retrofitting is impossible regardless | Build **zero** custom admin components through Phase 8. Phase 1 gate criterion #6 already requires the editor to be usable without them, so this cannot block Phases 1–7. Revisit only with a concrete list and a named owner | Phase 8 (optional deliverables only) |
| **OQ-6** | The company's legal and display name: "SV Developers" or "SRR Developers Pvt. Ltd."? | **BLOCKING PRODUCTION** | 11 | `content/site.ts` says one, the brief and live site say the other. Every heading and every SEO title renders from `site.name`. On a site making DTCP/RERA claims it is also a **legal identity** question | **NONE EXISTS.** Engineering can only make the answer cheap: model `name` and `legalName` as **distinct fields** on the `site-settings` global so the change is one admin edit plus one revalidation. **Do not pick one to unblock a demo** — a demo screenshot with the wrong company name is exactly the artefact that later gets treated as a decision | **Before go-live (Phase 11)** |
| **OQ-7a** | Storage provider: which S3-compatible provider, which region, who owns the account and keys, and is the bucket public-read behind a CDN? | **BLOCKING IMPLEMENTATION** | 6 | The choice leaks into code: `endpoint` and `forcePathStyle` — which every non-AWS provider needs — are **AWS-SDK pass-throughs Payload's own docs never name**. And `@payloadcms/storage-r2` is documented as a *Cloudflare Workers* adapter, so it is the wrong package for a self-hosted Node deployment even if R2 is chosen | Write the config against `@payloadcms/storage-s3` with `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE` and credentials all env-driven, and run **MinIO in Docker** locally. Gate with `enabled: Boolean(env.S3_BUCKET)` so dev falls back to disk. The production provider then becomes five environment variables | **Phase 6 (T-107)** |
| **OQ-7b** | Email provider: which account, which sending domain, and who configures SPF/DKIM/DMARC? | **NON-BLOCKING for implementation** / **BLOCKING PRODUCTION** | 5 (build) / 11 (launch) | `@payloadcms/email-nodemailer` speaks *any* Nodemailer transport — *"including SMTP, Resend, SendGrid, and more"* — so the provider is an env-var decision, not an architectural one. But **deliverability is entirely outside Payload**, and a notification in spam is indistinguishable from a lost lead | `nodemailerAdapter` with SMTP env vars in production; `nodemailerAdapter()` with **no arguments** in dev/staging, which uses ethereal.email and prints credentials to the console — this also satisfies *"staging must not send real notifications"* with zero custom code | Build: not blocking. **Launch: before Phase 11** |
| **OQ-8** | Enable Payload's built-in forgot-password flow, or remove it? | **DESIGN-SHAPING — and the recommended default now inverts** | 3 | P-09 ("no reset initially") was written assuming reset was something we would *build*. Under Payload it is something we would have to *remove*: forgot-password, reset-password and the reset page at `${serverURL}/admin/reset/${token}` all ship by default. Keeping it costs nothing and directly mitigates a sole admin locked out by `maxLoginAttempts` | **Keep** the built-in flow, branded via `generateEmailHTML`/`generateEmailSubject`, with `forgotPassword.minRequestInterval` (default 15 000 ms) as a free throttle. It depends on an email adapter existing, tying it to OQ-7b. If the owner prefers P-09's "no reset", that is a **deliberate removal** and must be logged as one | **Phase 3** |
| **OQ-9** | Can a published project's slug change — lock after publish, allow with a warning, or allow freely with stored redirects? | **DESIGN-SHAPING** | 4 | Slugs are the public URL. `admin.readOnly` is *"without affecting the API"*, so a UI lock is **not** a lock. And Payload's own `slugField()` helper carries the verbatim warning *"experimental and may change, or even be removed"* | Implement the strictest option — **`SLUG_LOCKED` after first publish** — because it is the only one that cannot cause irreversible loss (an indexed 404, orphaned lead attribution) while the question is open. Hand-rolled `text` field + `beforeValidate` hook + field-level `access.update`; **not** the experimental helper. Build no redirect infrastructure until the owner says slugs will change in practice | **Phase 4** |
| **OQ-10** | Fix the three count-coupled hardcoded strings ("Five layouts." ×2 in JSX, "Aler · Bhongir · Genome Valley" in the hero) — derive, reword, or accept the coupling? | **FUTURE** (frontend-gated) | 9 | A correctness bug that fires only when the CMS is actually used to add a sixth project — i.e. precisely when the backend succeeds | No backend default needed. **Add a guard at zero cost:** an `admin.description` note on the Projects collection stating that publishing a sixth project requires a frontend copy change. That converts a silent lie into a visible prerequisite | Phase 9 (which itself needs approval) |
| **OQ-11** | Should the homepage hero headline be editable? | **NON-BLOCKING** | — | Default = status quo = zero backend work. If it ever changes it must remain **two fields** (`title` + `titleAccent`) — the `<em>` is the headline's second line, not emphasis. A single rich-text field would destroy the split, and Payload's Lexical editor is one config line away | Do not model the headline at all. **Register no Lexical editor on any content field** | — |
| **OQ-12** | Should `noindex` / `Disallow: /` be an admin toggle? | **NON-BLOCKING** | — | Launch is a one-time event, and an accidental admin click de-indexing the site is serious and slow to notice. *(Register defect: OQ-12's id also carries an unrelated second question — see CONF-91.)* | Keep in code, env-gated (`NEXT_PUBLIC_ALLOW_INDEXING`), so staging and production can differ. If ever added to the CMS it must be a deploy-gated setting, **not a checkbox next to the phone number** | — |
| **OQ-13** | What are "services"? | **FUTURE** | — | Position on record (D-013): **no `Service` entity is being created.** The brief mentions services; the frontend has none — only infrastructure *specifications* and *benefits* | Build nothing. If the owner means something specific it is a **new requirement** with its own traceability row, entity, admin screens and public endpoint | — |
| **OQ-14** | Is `/blog` dropped or pending? | **FUTURE** | — | Position on record (D-013): **no `Article` entity.** `src/app/blog/` and `src/content/blog.ts` do not exist; the route 404s. **The trap:** a blog is the single most likely reason someone introduces a Lexical rich-text field, which collides with D-010 and with the XSS posture | Build nothing. If the blog returns, the rich-text decision must be reopened **deliberately, not by reflex** | — |
| **OQ-15** | Should the admin surface unresolved `[BRACKETED]` placeholders? | **NON-BLOCKING** (explicitly optional) | 8 | *"Without it the CMS becomes a way to publish placeholders — the exact failure the frontend was built to prevent."* It is the cheapest mitigation for OQ-22 becoming permanent | Implement the **validation half** (a `validate` that warns when a value still matches `^\[.*\]$`), which is free; defer the **custom field component**, which is the part R-5 permits dropping and which adds a `generate:importmap` build dependency | Phase 8 (optional) |
| **OQ-16** | Responsive image variants generated in the backend? | **ALREADY RESOLVED in substance** | 4 | `next/image` already does this; generating card/tablet/hero sizes multiplies S3 objects and orphan-cleanup surface by 4× | **No** variants. **One exception:** exactly one `thumbnail` `imageSize` to feed `adminThumbnail`, and it **must** carry `withoutEnlargement: true` — the documented default makes a size return `null` when the source is smaller in both dimensions, silently breaking admin thumbnails for small assets like the logo | Closed |
| **OQ-17** | Retention for deleted and replaced media — what grace period, and does it also apply to *replaced* originals? | **DESIGN-SHAPING** | 6 | **What happens to the old stored object after a replace is undocumented.** If Payload eagerly deletes it, the "accidental replace is recoverable for 30 days" promise is silently false | 30 days, applied to **both** deletes and replaces, implemented by capturing `previousDoc.filename` in an `afterChange` hook and enqueueing the old key — which makes the behaviour independent of whatever Payload does internally | **Phase 6 (T-111)** |
| **OQ-18** | Are brochure PDFs public, or gated behind a lead capture? | **DESIGN-SHAPING — now a hard configuration fork** | 6 | The two answers require **mutually exclusive settings on the same collection**. Public ⇒ `disablePayloadAccessControl: true`, files served straight from the CDN. Gated ⇒ that flag left default so Payload's `read` access still applies, which contradicts "serve media from a separate origin" for that one collection. You cannot have both | **Preserve the status quo — brochures stay public**, because the live Lightbox download button is unauthenticated today. Configure `documents` as a **separate collection** from `media` so that if the owner later says "gate them", only that collection's settings change. Preserving observed behaviour is **not** deciding the business question and must be recorded that way | **Before T-107 is written (Phase 6)** |
| **OQ-19** | Phone validation: 8 digits or 10? And is the frontend aligned in the same release? | **DESIGN-SHAPING, with a production trap** | 5 (enforcement) + 9 (alignment) | The contact form accepts 8+; the hero pill demands 10. **A backend enforcing 10 while the live form accepts 8 creates a silent lead-loss regression inside the phase whose entire purpose is to stop lead loss** — and Phase 9 may never be approved | **Deliberately *not* P-08's default:** accept **≥8 digits** server-side until the frontend is aligned, then tighten to 10 **in the same release**. Record it as a known temporary divergence with an explicit closing condition, not as a decision that 8 is correct. The normaliser is written once and is threshold-independent, so tightening is a one-line change. **Log rejected submissions** (without storing them as leads) so anyone 422'd can be re-contacted | Phase 5 (the ≥8 rule); **Phase 9 (the tightening, same release as the form edit)** |
| **OQ-20** | Autoresponder to the buyer? | **NON-BLOCKING** | — | It is the second notification channel that converts a Task into a Workflow, and it materially changes the DPDP purpose-limitation position — `formNote` currently promises *"We will only use your number to talk to you about this project."* | **No autoresponder** | — |
| **OQ-21** | Build this CMS, or adopt a headless CMS? | ✅ **ALREADY RESOLVED** → D-015 | — | Resolved 18 Sep 2026: Payload CMS 3 self-hosted on PostgreSQL, provisional until Phase 1's gate. Directus is the designated fallback | No action. **Do not reopen.** Note that `INTEGRATIONS.md` §7 still reopens it in prose — that is pre-D-015 residue and is stale, not a live question | Closed |
| **OQ-22** | The actual values for every `[BRACKETED]` placeholder — phone, email, WhatsApp, address, domain, approval numbers, RERA registration, statistics, all 11 drive times | **BLOCKING PRODUCTION** | 11 | The site is `noindex` + `Disallow: /` **because of these**. No backend work removes them; they are facts only the client has. Several — approval numbers, title claims — **carry legal weight** | **NONE EXISTS** for the values. Two engineering mitigations that are not decisions: (1) seed the five projects **verbatim including the brackets**, so the gap stays visible; (2) implement OQ-15's validation half so an admin publishing a bracketed value sees a warning | **Before go-live (Phase 11)** |
| **OQ-23** | Testimonials: supply real, consented quotes, or delete the section? | **BLOCKING PRODUCTION** | 11 (values); 8 (mechanism) | The three current quotes are invented placeholders with bracketed names. **Publishing invented reviews under real-sounding names is a fabricated record** | **Ship the section empty.** Enforce it structurally, not by discouragement: a `beforeValidate` hook throwing when `_status === 'published' && !consented`, **plus a DB CHECK constraint via custom migration**. Note `CONSENT_REQUIRED` is not one of the nine top-level error codes — emit it as `VALIDATION_ERROR` with `details[].code = CONSENT_REQUIRED` | Mechanism: **Phase 8**. Values: before go-live |
| **OQ-24** | The privacy policy: who writes it, where it lives, and what it says about retention, sub-processors (email provider, storage provider, any CRM) and erasure requests | **BLOCKING PRODUCTION — the largest compliance gap** | 11 (gates Phase 5's endpoint in production) | `[PRIVACY_URL]` is inert, yet the contact form collects name + phone and promises *"We will only use your number to talk to you about this project."* **Collecting PII without a reachable privacy policy is the largest compliance gap in the project (DPDP Act).** It has an unnamed technical dependency: the policy must enumerate sub-processors, so **OQ-7's answers are inputs to OQ-24** | **NONE EXISTS.** Owner/legal deliverable. The only engineering posture is a hard gate: **`POST /api/v1/leads` must not be reachable in production until a reachable privacy URL is configured.** Two related gaps close at the same time — the lead record's own lifetime is undefined in every document, and erasure-on-request needs a soft-delete + purge path | **Before the form goes live** |
| **OQ-25** | Will the site ever be multilingual (Telugu), and if so within 12 months? | **RE-CLASSIFIED from ⚪ informational to BLOCKING IMPLEMENTATION** | 0 / 1 | Payload's Postgres adapter puts localized fields in **a separate `_locales` table per collection**. Turning `localization` on after data exists is a physical schema change across every localized field, on top of an already array-heavy model (~12 child tables for `Project` alone before versions). **It is not a config flip; it is a data migration.** The OQ's own text says "decide before the schema is finalised" — its impact rating was wrong, its text was right | **Do not enable `localization`.** Record the deferral and its cost explicitly — in the schema documentation *and* as a comment in the config — so nobody later reads its absence as "nobody thought about it". Separately, narrow admin `i18n` to `{ en }` for bundle size; that one is free and reversible | **Before migration 001 (Phase 1)** |
| **OQ-26** | Amend D-004 to accept Payload's session model, or add a token-version field? | **ALREADY RESOLVED BY DOCUMENTATION** — pending one empirical check | 3 | Official text: *"With sessions enabled, changing a user's password ends that user's other sessions, so tokens that were issued before the change stop working"*; an admin updating another user's password *"ends all of that user's sessions"*; *"The `resetPassword` operation ends all existing sessions."* **D-004's revocation intent is satisfiable with Payload's defaults.** The mechanism differs (a `sessions` field on the user document and a `sid` JWT claim, not a bespoke `admin_sessions` table) but the guarantee holds | Leave `useSessions` at its default `true`; **never set it to `false`**. Add one Phase-3 test that proves the guarantee on the installed version (log in twice, change the password from session A, assert session B's cookie is rejected). **Do not design revocation around rotating `PAYLOAD_SECRET`.** Amend the `TRACEABILITY.md` rows naming `admin_sessions` and `argon2id` | **Phase 3 exit** |

### 26.3 The ten technical decisions the research created

These are **not** in `OPEN-QUESTIONS.md` and are **not** business questions. They are decisions the official docs prove must be made explicitly, most of them before migration 001. Ids are proposals for whoever updates the register.

| ID | Decision | Class | Must be decided by | Recommended technical default |
|---|---|---|---|---|
| **OQ-27** | `idType`: `'serial'` or `'uuid'`? ULID is **not supported** — only these two values exist; custom ids may only be `Number` or `Text` | BLOCKING IMPLEMENTATION | migration 001 | `'uuid'`. Adapter-global, not per-collection; changing it after data exists is a type change across every PK and FK in every child table |
| **OQ-28** | Rename `Project.status` and `Lead.status` — `status` is reserved on Postgres with drafts enabled and is **silently sanitized out of the config** | BLOCKING IMPLEMENTATION | migration 001 | `projectStatus` / `leadStatus`, mapped back to `status` in `toPublicProject()` so `types/content.ts` is unchanged |
| **OQ-29** | Native `orderable: true` (fractional-index **string** keys, free drag-and-drop) **vs** the documented integer `sort_order` | BLOCKING IMPLEMENTATION | migration 001 | `orderable: true`, and rewrite `sort_order`/`sortOrder` out of `DATABASE-SCHEMA.md`, `VALIDATION-RULES.md` and `API-CONTRACT.md`. Keeping the integer forfeits the drag-reorder UI D-005 makes first-class. **Confirm the generated field name from T-024 before writing the public sort** |
| **OQ-30** | Named vs unnamed `tabs` in the Project editor (named tabs **group data into an object** in the DB; unnamed are presentational only) | BLOCKING IMPLEMENTATION | migration 001 | **Unnamed everywhere**, so the stored shape stays flat and the serialiser stays simple. Changing later is a data migration, not a UI tweak |
| **OQ-31** | The REST-surface fork: **(A)** `read` returns a published-only `Where` for anonymous — keeps `overrideAccess:false` working but leaves `/api/projects` publicly readable in Payload's own shape; **(B)** `read: Boolean(user)` and public endpoints use `overrideAccess: true` with a hard-coded `where` — closes it but deliberately re-introduces the dangerous flag | BLOCKING IMPLEMENTATION | Phase 3 | **(A)**, plus an infrastructure-level block on `/api/<collection-slug>` at the reverse proxy. **There is no documented kill switch for Payload's generated REST routes**, so config alone cannot close them |
| **OQ-32** | Delete `notification_jobs` (`DATABASE-SCHEMA.md` Table 15) in favour of Payload's built-in `payload-jobs` | DESIGN-SHAPING | Phase 2 | **Delete it.** Two queues, two runners and two failure surfaces for one async task is strictly worse. Field mapping is one-to-one: `status`→`completedAt`+`hasError`+`processing`, `attempts`→`totalTried`, `last_error`→`error`, `scheduled_for`→`waitUntil`, `payload`→`input` |
| **OQ-33** | Soft delete (D-006): Payload's **Trash** feature vs a hand-rolled `deletedAt` field | DESIGN-SHAPING | Phase 4 | **Trash.** The two research files contradicted each other; the contradiction was re-verified against the docs bundle and **B02 is right** — official text: *"Trash (also known as soft delete) … deleted documents will receive a `deletedAt` timestamp"*, with a collection option `trash` defaulting to `false`. Use `trash: true`, `access` filters and `admin.baseFilter` (**`baseFilter`, not `baseListFilter`**) |
| **OQ-34** | Public endpoints as Payload `config.endpoints` **or** as Next.js Route Handlers | DESIGN-SHAPING | Phase 0 | **Route Handlers**, under `src/app/(public)/api/v1/**` (§21.2). Payload `config.endpoints` are *always* mounted under `routes.api`, and our contract specifies `/api/v1/...` plus `/healthz` **outside** `/api`. **Mixing the two mechanisms is the failure mode.** Note B05's claimed `root: true` endpoint property **does not exist** in the v3 docs — do not design around it |
| **OQ-35** | Backend Next.js version pin | BLOCKING IMPLEMENTATION | scaffold | Exactly **`16.3.3`** (what the official blank template pins), or a version inside `15.4.11–15.4.x`. **Never `^`, and never matched to svfrontend's 15.5.25**, which is outside every supported range |
| **OQ-36** | Package manager for `svbackend` | BLOCKING IMPLEMENTATION | scaffold | **npm 11.6.1.** yarn 1.22.22 is *explicitly unsupported* by Payload; pnpm is not installed. Every doc example is written as `pnpm payload …` and must be translated once, in writing, to `npm run payload …` / `npx payload …`. Commit `package-lock.json` — the official Dockerfile's `npm ci` branch needs it |

### 26.4 The only decisions that block starting work

**Nothing blocks scaffolding the spike.** Phase 1's only entry criterion is D-015, and the source is explicit: *"None of the remaining open questions block Phase 1."*

**Two block the very first commit:**
1. **OQ-35** — the backend Next.js pin. Copying svfrontend's 15.5.25 puts the project on an officially unsupported combination whose symptoms are hard-to-attribute admin-panel errors.
2. **OQ-36** — the package manager. yarn 1 is explicitly unsupported and is the only yarn on this machine.

**Six block migration 001 — the first irreversible artefact:**
3. **OQ-27** `idType` · 4. **OQ-28** the `status` renames · 5. **OQ-29** `orderable` vs integer `sort_order` · 6. **OQ-30** named vs unnamed tabs · 7. **OQ-25** multilingual · 8. **OQ-31** the REST-surface fork (strictly Phase 3, but it determines the `access.read` shape Phase 1's collection carries).

**Three block their own phase:** OQ-7a (storage provider, Phase 6 T-107) · OQ-18 (public vs gated brochures, a mutually-exclusive config fork, before T-107 is written) · OQ-1 **and** OQ-2 (leads destination and a literal recipient address, Phase 5).

**Four block launch and nothing else:** OQ-6 (company name) · OQ-22 (all bracketed placeholders) · OQ-23 (testimonials) · **OQ-24 (privacy policy — the only one with legal exposure)**. None blocks a line of code. All four are owner deliverables and **three have no safe default at all**.

> **In one line:** *the only questions that stop work starting are technical ones the research just created (OQ-27…OQ-31, OQ-35, OQ-36) — every question in the existing register can wait until the phase that needs it, except that four of them will stop launch dead and nobody but the owner can answer them.*

### 26.5 Decisions that are the owner's and must not be inferred from this plan

Restating plainly, because a plan this detailed can be mistaken for a mandate: **nothing below has been decided by engineering, and no default in §26.2 may be cited as an answer.**

- The company's legal and display name (OQ-6).
- Every `[BRACKETED]` value, including the approval numbers and RERA registration that carry legal weight (OQ-22).
- Whether real testimonials exist or the section is deleted (OQ-23).
- The privacy policy's existence, author, content and URL (OQ-24).
- Whether leads go to a CRM, and which (OQ-1).
- The literal sales notification address and channel (OQ-2).
- The storage and email providers, their accounts, and who holds the credentials (OQ-7).
- Whether brochures are public or gated (OQ-18).
- The lead record's retention lifetime — **undefined in every source document**.
- Who commissions project photography, and by when — *a stated launch blocker with no open question, no requirement, no phase and no owner*, which additionally gates the `dangerouslyAllowSVG` removal.
- The hosting vendor and region (§20.3 gives criteria and a recommendation; it does not choose).

---

## 27. Deferred Functionality

### 27.1 Forbidden assumptions — things that must NOT be built

These are not "later"; they are **out of scope by an accepted decision or by the absence of any frontend evidence**. The governing instruction, verbatim: *"None of these are in scope. Do not build them."* Building any of them is scope creep with no traceability row, and several would actively damage the product.

| Forbidden | Why it is forbidden | What would have to happen to bring it back |
|---|---|---|
| **Public user accounts, registration, login** | Zero frontend evidence; the brief forbids it. The only auth in the system is the admin collection | A new brief. It changes the threat model, the DPDP position and every access function |
| **Payments, checkout, pricing transactions** | No pricing appears anywhere in the frontend | A new brief plus a payment sub-processor in the privacy policy |
| **Online booking / site-visit scheduling** | Site visits are arranged by phone | A new requirement with its own entity, endpoints and notification path |
| **Plot inventory, per-plot pricing, floor plans, possession dates, structured RERA/DTCP numbers** | No frontend evidence; *"the repo explicitly records that none were supplied"* | The client supplying the data, then a new entity and a new admin screen |
| **`Service` entity** | D-013 / OQ-13. The brief mentions "services"; the frontend has none — only infrastructure *specifications* and *benefits* | The owner defining what a "service" is. It is then a **new requirement**, not a migration |
| **Blog / `Article` entity** | D-013 / OQ-14. `src/app/blog/` and `src/content/blog.ts` do not exist; the route 404s | OQ-14 resolving that way. **Danger:** a blog is the most likely reason someone introduces a Lexical rich-text field — reopen the rich-text decision *deliberately*, never by reflex |
| **Any rich-text / WYSIWYG / Lexical field** | D-010 and the XSS posture: *"No rich-text/HTML content type exists in this CMS. Keep it that way."* Every long-form field is `readonly string[]` or a plain `string`. A rich-text field is a **new capability, not a migration**, and hands every admin a stored-XSS surface the product does not need. Payload's Lexical editor is one config line away — which is exactly why the rule is written down | A deliberate, logged reversal of D-010 with a new XSS control design. **Verification that it has not happened: grep the config for `richText` / `lexicalEditor` → zero hits** |
| **Public analytics** | Frontend PRD defers analytics to phase 2 | A new requirement. Note this is **not** the same as server-side alerting, which §28 requires |
| **Public search, pagination or sort on any read endpoint** | FR-PUB-12: the catalogue filters **5 records client-side**. *"No public pagination/search/sort unless a consumer appears"* | A consumer appearing — i.e. more records than a page can hold |
| **Multilingual / `localization`** | OQ-25. Enabling it after data exists is a physical schema change across every localized field | An owner decision, taken **before migration 001**. Afterwards it is a data migration |
| **Page builder / arbitrary section editing; heading WYSIWYG; theme or colour editor; navigation editor; workflow and approvals** | Headings and layout are code; design tokens are AA-validated contrast pairs; nav structure mirrors routes; there is one role and a small team. **9 of the 12 heading `title` values in `pages.ts` are already dead string literals shadowed by hardcoded JSX**, 4 of which render completely different text — migrating them would produce an editor UI whose fields **visibly do nothing**, the single worst thing a CMS can teach its users | Nothing short of a redesign. **No `pages` collection or global, at Tier 1 or Tier 2** |
| **Microservices, GraphQL, realtime, read replicas** | No requirement. GraphQL is explicitly disabled (`graphQL: { disable: true }`) as pure attack surface | A workload that does not exist at five projects and tens of leads a month |
| **A second job queue (`notification_jobs`)** | Payload's `payload-jobs` **is** that table, with retries, cron, `waitUntil` and an admin surface | Never. Two queues, two runners and two failure surfaces for one async task is strictly worse |
| **`admin_sessions` table, `roles`/`permissions` join tables, a `categories` collection** | Payload uses a `sessions` field on the user document, not session rows; there is one role; `category` is a fixed 4-value enum, not user-extensible | OQ-4 resolving to multiple roles (then it is a `role` field, still not a join table) |
| **`media.hero` / `media.heroPortrait`** | Dead content keys. **The files do not exist on disk**, nothing renders them, and `heroPortrait` is not even an `ImageRef` | Nothing. Delete them (T-181) |
| **`home.benefits`, `home.hero.lead/primaryCta/secondaryCta`, `location.intro.title/.lead`** | Completely unreferenced — zero consumers. The hero renders `EnquiryPill` instead of buttons | Nothing. Do not migrate them |

### 27.2 Deliberately deferred — built later, not never

Each has a reason and a trigger. A deferral is a decision; it is recorded so that a later session does not read the absence as an oversight.

| Deferred | Task | Reason | Cost of deferring | Trigger that brings it back |
|---|---|---|---|---|
| **Tier-2 extras** — ticker items, site-wide specifications, site-wide proximity, shared CTA, master-plan PDF | T-165 | All Tier 2; the frontend renders them from code today. Note **all 11 site-proximity `place` values are bracketed placeholders and `Corridor.tsx` hard-slices to 8** — items 9–11 render nowhere | Those values stay developer-edited | The owner asking to edit them without a developer, or OQ-22 supplying real drive times |
| **Autosave** | — | No requirement asks for it, and it defaults to an **800 ms write interval** that fires every `afterChange` hook — it would **flood the audit log**. Ship Phase 4 with `autosave: false` | None | A requirement for it, *and* an audit hook guarded against autosave writes first |
| **`schedulePublish`** | — | No requirement, and a scheduled job that silently never fires is a real failure mode when the worker is a separate process | None | A requirement for timed publishing, and a monitored worker already in production |
| **Heavy observability** — APM, tracing, dashboards | — | Analytics is deliberately deferred; the workload is five projects and tens of leads a month | Incidents are diagnosed from logs and the health check | Traffic or incident volume that logs cannot explain. **Not deferred:** the three day-one alarms in §28 — worker dead, `sendLeadNotification` `hasError: true`, `/healthz` 503 for more than one interval |
| **RBAC** | — | Payload ships no RBAC primitive; with one role, membership of the auth collection *is* the authorisation and the codebase is four functions | Adding roles later is a cheap field migration; carrying unused RBAC scaffolding for a year is not | OQ-4 resolving to multiple roles |
| **Orphan media detection** | T-112 | A query, not a feature | Storage creeps; nothing breaks | An unexplained storage bill, or a media library nobody can audit |
| **Per-session media upload rate limit** | T-115 | The upload surface is admin-only, behind auth and account lockout | A compromised admin session could spam uploads | Evidence of abuse, or more than two admin accounts |
| **Lead read/unread (FR-LEAD-13), CSV export (FR-LEAD-18), status pipeline (FR-LEAD-12)** | — | All INFERRED / P2 with no frontend evidence; the spec says *"do not default to building it"* | The dashboard's "new leads" query must be redefined — **define it as a date-window query (`createdAt` within 7 days)**: no column, no write path, no audit entry, no migration, no ruling needed | OQ-3 confirming a human maintains the pipeline; a real request for CSV. If CSV is built, note the Import/Export plugin's verbatim warning that *"users who have read access to the upload collection may be able to download data that is normally not readable due to access control"* |
| **WhatsApp hand-off logging (FR-LEAD-17)** | — | INFERRED / P2; a partial fix for an attribution hole. There is a `source = 'whatsapp'` value **with no documented way to produce a row** | WhatsApp-branch leads stay invisible — they already are | The owner deciding it matters. Then either define `POST /api/v1/leads/whatsapp` or **delete the enum value** — do not leave a value with no writer |
| **Audit *screen* (FR-AUDIT-03)** | — | Audit **storage** (T-091) is P1 and ships; the read UI is P2 and is largely free from Payload's default list view | An admin cannot self-serve the log; it is a database query | An audit request from the owner or an incident |
| **Logo replacement (FR-MEDIA-13), per-project CTA/SEO overrides (FR-PROJ-16)** | — | Both Tier 2 | Developer edits | Tier-2 sign-off |
| **The 8 Matrix `FUTURE` content types** — `home.steps`, `home.benefits`, `about.*`, `amenities.maintenance`, `masterPlan.notes`, `location.growth` | — | Explicitly *"justified but deferred; not in the first build"*. `about.approvals.items` are legally sensitive and all bracketed | Those pages stay code-edited — the status quo | Tier-2 sign-off, and OQ-22 supplying the legally sensitive values |
| **React key uniqueness enforcement** | T-180 | Only bites when an editor creates two identical `title`/`place` values in one list. Note `key={tile.src}` on `PinnedProof` collides **today** if two projects share an image | A React key collision — visible, fixable, not silent | The first collision, or Phase 9 approval |
| **Removing `dangerouslyAllowSVG`** | T-183 | Depends on real raster art replacing every placeholder, which depends on photography being commissioned | The flag stays on with a CSP neutralising it — the current state | T-113 completing |
| **Measuring `versions.maxPerDoc` pruning** | T-197 | Only matters at volume, and autosave is off. **The mechanism (sync / batched / background) is undocumented** | Database growth is unmeasured | Phase 10 exit criterion 8, or `_v` row counts climbing faster than edit volume |
| **Admin E2E browser tests** | — | **Zero official guidance** — Playwright, Cypress, Selenium and Puppeteer appear nowhere in the Payload docs. Any suite couples to an admin DOM the docs never guarantee as stable, against a project shipping minors roughly weekly. Risk of attempting: HIGH. Risk of skipping: LOW | Covered instead by the ADMIN WORKFLOW integration layer (same access control and hooks the UI calls) plus a one-page manual smoke checklist at release | Payload publishing testing guidance, or a repeated admin-UI regression |
| **Placeholder-awareness component + dashboard counter** | T-166 | Recommended by the documents, never required; R-5 explicitly permits dropping it | The CMS can publish `[BRACKETED]` values without a visual warning — mitigate with the validation half and a release checklist | OQ-22 dragging on, making placeholder publication a live risk |
| **Visual icon picker; dashboard custom views; lead autoresponder; `Idempotency-Key` handling; version history on `site-settings`** | — | A plain `select` over 41 values already satisfies FR-PROJ-15; the autoresponder changes the compliance picture; honeypot + rate limiting cover the realistic abuse (a double-submit produces a duplicate lead, which is annoying, not harmful) | Minor | An explicit request |

### 27.3 The tight-deadline cut, stated plainly

**Cut everything in §27.2 and ship Phases 0–5, 7 (projects + site-settings only), 9, 10, 11.**

**What you get:** a CMS that manages the 5 projects and site settings, a working contact form with a monitored email notification, a public API that satisfies the contract, and a site that still hits its performance budget.

**What it costs, precisely:** testimonials, FAQs and statistics stay hardcoded (they are already placeholders, so nothing regresses — but `/testimonials`, `/faqs`, `/statistics` do not exist) · the CMS can publish unresolved `[BRACKETED]` values without warning · lead triage is list + detail only · no orphan reporting and deleted media objects are retained rather than swept · the audit log exists and is correct but has no admin screen · `dangerouslyAllowSVG` stays on until real raster art lands.

**What must NOT be cut at any deadline** — the guard rails, restated as one list: `overrideAccess: false` plus an explicit published-only `where` on every public read · the generated-surface lockdown plus the explicit "no public route returns lead data" test · the 41-value icon enum at the database layer · the testimonial consent hook **and** CHECK constraint · magic-byte + SVG + EXIF + dimension upload validation with UUID keys · the media in-use delete guard · auth lockout, secure cookies and the CORS/CSRF allow-lists · edge rate limiting on `/leads` and login · env fail-fast and the email-adapter boot guard · reversible migrations with a **tested** restore · contract + key-set tests for every shipped read endpoint · audit rows for approvals and legal claims · a published privacy policy before the form goes live.

---

## 28. Risk Register

### 28.1 Scoring

**Likelihood:** H = expected unless actively prevented · M = plausible · L = unlikely but possible.
**Impact:** H = data loss, PII exposure, legal exposure, or an unrecoverable/undetected failure · M = rework, outage, or degraded correctness · L = friction.
**Category:** TECH · SEC · DATA · SCHED · VENDOR.

### 28.2 The register — 72 risks

| ID | Risk | Cat | L | I | Early warning | Mitigation | Contingency |
|---|---|---|---|---|---|---|---|
| R-1 | Public response shape drifts from `Project` in `types/content.ts` | TECH | M | H | A new field in `payload-types.ts` with no serialiser line; a frontend `tsc --noEmit` failure | One `toPublicProject()` as the single control point; include-mode `select` only; **ban `...doc` spread in the public-API module**; key-set contract tests in CI | Pin the serialiser, patch forward, re-run contract tests. Under ISR the failure is caught at build, not in production |
| R-2 | Payload 3's Postgres adapter cannot express the model *(downgraded — adapter is first-party and fully featured)* | TECH | L | H | `generate:db-schema` output that cannot represent a documented field | The Phase-1 spike **is** the mitigation: read the emitted Drizzle schema before migration 001 | The documented fallback stands — if gate criteria 1, 2 or 4 fail, D-015 is void and **Directus** is the stack |
| R-3 | Payload's cookie/JWT session model differs from D-004 *(downgraded — revocation is documented)* | SEC | L | M | An integration test showing an old cookie still works after a password change | Leave `useSessions: true`; write the Phase-3 verification test; amend D-004 | Add a token-version field (D-004 option (b)) — **only** if the test fails on the installed version |
| R-4 | DB-level constraints weaken vs `DATABASE-SCHEMA.md` | DATA | M | M | An invalid value reaching the database in a direct-SQL test | Field validation + hooks always; `select` + explicit `enumName` for the icon enum (a real Postgres enum); a custom-migration CHECK for testimonial consent | Accept application-layer enforcement and add a nightly integrity query |
| R-5 | Admin UI customisation hits a wall | TECH | L | L | A custom component that cannot get its data from `WidgetServerProps`/`useRowLabel` | Keep every custom component optional | Degrade to a plain `select` and drop the placeholder counter |
| R-6 | Major-version upgrade cost | VENDOR | M | M | `payload@latest` moving to a 4.x dist-tag; a 3.x security advisory | Pin exact versions across `payload`, all `@payloadcms/*`, `next`, `react`, `react-dom`; config-as-code makes the upgrade diff reviewable | Stay on 3.x until a maintained upgrade window exists; budget the Node/Next/TS bumps with it |
| R-7 | Team unfamiliarity with Payload | SCHED | M | M | PRs using the Payload **v2** handler signature `(req, res, next)` — community pages are full of it and it is wrong for v3 | A shared `definePublicEndpoint()` so the signature can only be written one way; a short conventions page | Pair-review the first endpoint of each kind |
| R-8 | Two Next.js apps confuse contributors | TECH | M | L | Someone proposing to merge them | Document the separation in `AI-CONTEXT.md` **with R-57 as the reason** — it is a hard technical constraint now, not a preference | None needed |
| R-9 | Over-exposure via auto-generated endpoints *(upgraded to near-certain)* | SEC | **H** | H | `curl /api/leads` returning anything other than 401/403/empty | Explicit `access` on **100 %** of collections and globals; `graphQL: { disable: true }`; `disableBulkEdit`/`disableBulkDelete`; **plus a reverse-proxy rule blocking `/api/<slug>`**, because no documented config kill switch exists | The mandatory negative test suite is the backstop; the proxy rule is the immediate fix while access control is corrected |
| R-10 | `overrideAccess` defaults to **`true`** in the Local API — one omission returns drafts, unpublished projects and full lead PII, with field-level stripping also disabled, silently and unlogged | SEC | H | H | Any `payload.find`/`findByID` in a public-surface file without an explicit `overrideAccess` | One `publicFind()` forcing `overrideAccess:false` + `user:undefined`; a lint rule banning raw `payload.find` under the public-API directory; the wrapper **also** applies a published-only `where` and an include-mode `select`, so any one of the three suffices | Treat any confirmed leak of lead data as a personal-data breach under DPDP and follow the credential-compromise path (§28.4.9) |
| R-11 | Custom endpoints are **unauthenticated by default** — *"You are responsible for securing your own endpoints"* | SEC | H | H | A new endpoint merged without a guard | Every handler wrapped in `definePublicEndpoint()` / an admin guard; the guard, not the handler, decides | Block the route at the proxy while the guard is added |
| R-12 | A never-published or unpublished document lives in the **main** table with `_status: 'draft'` and **is returned by a plain `find()`**; `draft` is not authorization | SEC | H | H | A project that has never been published appearing in `GET /api/v1/projects` | Three layers: `access.read` returning `{ _status: { equals: 'published' } }` for anonymous; an explicit `where` in every public query; a shared `publishedWhere()`. **Do not copy the docs' legacy `_status: { exists: false }` OR-branch** — enable drafts from migration 001 so no `_status`-less rows exist | Unpublish, purge the ISR cache, audit which slugs were reachable and for how long. Unpublished content here means **unapproved DTCP/RERA claims** — a legal escalation, not just a bug |
| R-13 | `select` restricts which fields are *queried*, not which keys are *emitted* — a selected-but-empty field still returns `null`. D-008 is 100 % hand-written | TECH | H | M | A `null` or `[]` in a public response body | A shared `put()` primitive with **one** documented emptiness rule (decide once whether `0`, `false`, `""` are empty); key-set snapshot tests | Patch the serialiser. The frontend's `?.length` guards mean an erroneous `[]` drops a section rather than crashing — which is why this is M-impact |
| R-14 | **Dual publish path** — the admin UI publishes through its own button and never touches our custom endpoints, so audit and revalidation placed in endpoints miss every real publish | DATA | H | H | An `audit_log` with fewer publish rows than the version history has publish transitions | **Put audit and revalidation in collection `afterChange` hooks, never in endpoints** | Reconstruct the missing window from version diffs (partial — no actor, no IP) and fix forward |
| R-15 | **Payload versions are not an audit trail** — no actor, no IP, no action type, no auth events; `maxPerDoc` prunes, violating append-only | SEC | M | H | Someone citing "Payload's version history covers part of it" as sufficient | A dedicated append-only `audit-log` collection with `create`/`update`/`delete` all `false`, fed by shared hooks capturing actor, IP, action and a sensitive-field diff. **Amend the documents that rate versions as partial audit coverage** — they are what a future session will read and trust | None — an audit log that cannot say *who* changed an approval number is not an audit log. This must be built, not recovered |
| R-16 | `status` is a **reserved field name** on Postgres + drafts; the field is *"sanitized from the config"* — silently, with no error | DATA | H | H | A `status` field missing from `payload-types.ts` after `generate:types` | Rename before any code exists; map back in the serialiser | Rename + data migration; caught cheaply if the Phase-1 generated types are reviewed |
| R-17 | `idType` is adapter-global and effectively irreversible after migration 001; **ULID is not supported** | DATA | M | H | None — the cost is invisible until reversal is needed | Decide at OQ-27, set it in the very first config, assert it in a config test | A full type change across every PK and FK — effectively a rebuild and reseed. At 5 projects that is survivable *if caught before launch* |
| R-18 | **Postgres enum churn** — changing the 41 icon values or `category` later requires a real `ALTER TYPE`; Payload's behaviour on option add/remove/rename is **[UNDOCUMENTED]** | DATA | M | M | An icon rename request | Set `enumName` explicitly from day one; **spike one `migrate:create` after adding and after removing an option** before committing to the model; document that adding an icon is a frontend change first, then a migration | Hand-write the `ALTER TYPE` migration |
| R-19 | `select` option values must contain **no hyphens** (GraphQL enum naming) | TECH | M | M | Reading `ui/Icon.tsx` and finding kebab-case names | Check this **in the first hour of Phase 1** — five minutes, schema-shaped consequence. ✅ All 41 `IconName` values are camelCase with zero hyphens | Underscore the stored values and translate back in the serialiser; do **not** change the frontend union |
| R-20 | `orderable: true` uses **fractional-index string keys**, contradicting `sort_order int` in three documents; the order field's **name is [UNDOCUMENTED]** | TECH | H | M | Inability to write the `sort` argument for the public projects endpoint | Spike `orderable: true`, read `generate:db-schema`, learn the real column name, then rewrite `sort_order` out of the three documents that name it | Fall back to an integer `sortOrder` + `defaultSort` and hand-build the reorder UI — forfeiting one of the savings D-015 was chosen for |
| R-21 | Table explosion — ~12 child tables for `Project` alone before versions; deep names risk silent truncation at Postgres' **63-byte** identifier limit | DATA | M | M | A generated table name near 63 bytes in the `generate:db-schema` output | Explicit short `dbName` on **every** array and block field; verify against the generated schema | Rename via migration before data exists |
| R-22 | Version-table growth — `maxPerDoc` defaults to **100**; the pruning mechanism is **[UNDOCUMENTED]**; autosave at 800 ms amplifies writes and can flood `audit_log` | DATA | M | M | `_v` row counts climbing faster than edit volume | Set `maxPerDoc` explicitly and low (10–20) on every versioned collection; **no versions** on `leads`, `audit-log`, `users`, `media`; ship with `autosave: false` | A scheduled pruning task — needed anyway if `maxPerDoc` turns out not to prune retroactively |
| R-23 | `unique: true` on a field **inside an array** creates a *collection-wide* unique index on the dotted path — two projects could not both mention the same landmark | DATA | M | M | A second project failing to save because it mentions a landmark the first one uses | Forbid nested `unique: true` in the review checklist; use an array-level `validate` for per-document uniqueness | Drop the index via migration |
| R-24 | Soft delete (D-006) is not free *(resolved: Trash is native — `trash: true`, `deletedAt`)* | DATA | M | M | The Trash behaviour disagreeing with the assumption the schema was written against | Use Payload Trash; verify in Phase 4 before writing delete semantics; `admin.baseFilter` (**not** `baseListFilter`) to hide trashed rows | Hand-roll `deletedAt` + `access.read` filter + convert the Delete button via `beforeDelete` |
| R-25 | Named vs unnamed `tabs` changes the stored shape; switching later is a data migration | TECH | M | M | `payload-types.ts` showing an unexpected nested object | Decide once (OQ-30 → unnamed), document it, review the generated types | Data migration |
| R-26 | `hasMany: true` text storage shape on Postgres is **[UNDOCUMENTED]**, and `Text` exposes no `dbName` | TECH | M | L | The round-trip assertion failing in the Phase-1 gate | The gate already tests this; there are **two** independent routes to `string[]` | Switch to the array-field route — but only before data exists |
| R-27 | **push-vs-migrate corruption** — running `migrate` against a `push`-managed database produces a history matching no real schema | DATA | H | H | Payload's own warning in a terminal; a migration that "worked locally" failing in CI | One house rule: *local dev DB is a disposable sandbox on `push`; every other environment is migrations-only; `migrate` is **never** run against the local dev database.* Reset with `docker compose down -v` | Drop and rebuild the sandbox; regenerate the migration from a clean database |
| R-28 | `migrate:fresh` (*"Drops all entities"*) and `migrate:reset` sit one keystroke from `migrate:status` and would destroy the leads table | DATA | M | H | Either command appearing in any npm script, CI job or runbook | Never wire them into a script; restrict production credentials so the app role cannot DROP; require a confirmed backup before any manual migration command | Restore from backup (§28.4.13) |
| R-29 | `migrate:down` rolls back a **batch**, not one migration; an auto-generated `down` restores structure, not data | DATA | M | H | Needing to undo one migration out of a batch | One migration per logical change, committed separately, so batches stay small; review every generated migration before commit | Hand-write a targeted forward migration instead of rolling back |
| R-30 | **Concurrent-deploy migration race** — no migration locking or advisory-lock behaviour is documented | DATA | L | H | Two deploys overlapping | Serialise deploys; run `payload migrate` as a **single pre-deploy job**, not inside N replicas' start-up | If `prodMigrations` is used, scale to one instance for the migrating release |
| R-31 | Environment-conditional config generates **divergent migrations between machines** — documented by Payload as a real hazard | DATA | M | M | `migrate:create` producing a different diff on a colleague's machine | Keep the config **environment-invariant in shape**: always register every plugin and switch behaviour by env var *inside* it (`s3Storage({ enabled: Boolean(env.S3_BUCKET) })`) | Hand-edit the generated migration — an accepted remedy in Payload's docs |
| R-32 | `disableCreateDatabase` defaults to **`false`** — Payload attempts `CREATE DATABASE` at boot and throws where the app role lacks the privilege | TECH | M | M | A permission error at boot on managed Postgres | `disableCreateDatabase: true` in production | Grant the privilege temporarily, or pre-create the database |
| R-33 | **Payload 3 ships no HTTP rate limiting** — v2's `rateLimit` config is gone with Express and the anti-abuse page recommends no replacement | SEC | H | H | A scraping spike on `/api/v1/projects`; brute-force on `/admin/login`; duplicate lead submissions | Edge rate limiting as an explicit **infrastructure deliverable** (nginx `limit_req` / Caddy / Cloudflare). Inside Payload use what exists: `maxLoginAttempts` + `lockTime`, `graphQL.disable`, `maxDepth: 3`, `defaultDepth: 1`, `defaultMaxTextLength`. On `/leads` add honeypot + `Idempotency-Key` + windowed dedupe. **Correct any document implying the CMS rate-limits — it does not** | Emergency proxy rule; CDN "under attack" mode. **Exempt the build egress IP** so a full ISR rebuild from one origin is not throttled |
| R-34 | Cross-origin cookie auth — if the backend is not a subdomain of the frontend's registrable domain, admin cookies become third-party and `SameSite=None` is forced | SEC | M | H | Admin login working locally and failing in a real browser in production | **Mandate the subdomain now** — `cms.<domain>` beside `www.<domain>` — the documented happy path, keeping `SameSite=Lax` | `SameSite=None` + `Secure` + a tight `csrf` allow-list, accepting a weakened CSRF posture |
| R-35 | Custom endpoints get **no CORS for free** — `headersWithCors` must be attached by hand | TECH | H | M | "Works in curl, fails in the browser" | `headersWithCors({ headers: new Headers(), req })` inside `definePublicEndpoint()` so it cannot be forgotten; register an `options` method (preflight behaviour for custom endpoints is undocumented) | Add the header and redeploy; no data impact |
| R-36 | `PAYLOAD_SECRET` — the official example is `process.env.PAYLOAD_SECRET \|\| ''`, silently accepting an **empty secret**; rotation **invalidates every API key**; no rotation procedure is documented | SEC | M | H | A boot with an unset secret; an API key stopping work for no apparent reason | Fail-fast env validation at boot — **never ship the `\|\| ''` pattern**; platform secret store; rotation is break-glass only | §28.4.14. Rotation invalidates every API key and every issued JWT; the runbook must exist and be rehearsed before it is needed |
| R-37 | `debug: true` in production leaks internals | SEC | M | M | A stack trace or SQL fragment in a production response body | `debug: env.NODE_ENV !== 'production'`; a `try/catch` in **every** public handler mapping to a fixed envelope with a `requestId`; never pass `error.message` through | Patch and rotate any credential that appeared in a leaked message |
| R-38 | **`SECURITY.md` mandates argon2id; Payload's KDF is PBKDF2-SHA256 and is not configurable** | SEC | H | M | `SECURITY.md` being shown to the client as-is | Amend to a vendor-neutral statement and compensate with controls we own: ≥12-char minimum via a `validate` on the password field, `maxLoginAttempts` + `lockTime`, admin-only account creation | The argon2id route needs `disableLocalStrategy: true` and a hand-written strategy, forfeiting login, reset, unlock, lockout and the session machinery OQ-26's resolution depends on. **Not recommended** |
| R-39 | Lockout is **per account, not per IP** — with one admin, an attacker trivially DoSes the sole administrator | SEC | M | M | Repeated lockouts of the only admin account | **Two admin accounts on day one**; `access.unlock` so another admin can release a lock; keep the forgot-password flow as a second recovery path; restrict `/admin` at the network layer if feasible | Unlock via the Local API from a shell or the seed script |
| R-40 | First-user bootstrap — how `access.create: () => false` interacts with `/create-first-user` is **[UNDOCUMENTED]**; a fresh production deploy could be unrecoverable without shell access | SEC | M | H | A fresh environment with zero users and `create` locked | Make a **seed script the documented bootstrap path** (the Local API skips access control) and verify it in a throwaway environment during the spike | Run the seed script against production once from a controlled shell, then rotate the password |
| R-41 | The Import/Export plugin warns verbatim that *"users who have read access to the upload collection may be able to download data that is normally not readable due to access control"* — a leads CSV can leak PII | SEC | M | H | The exports upload collection readable by anyone who can read uploads | Scope the plugin to `leads` only; `overrideExportCollection` locking exports to admins; a `hooks.before` stripping internal fields; `disableJobsQueue: true` | Disable the plugin; fall back to a hand-written **authenticated** CSV endpoint with its own explicit `req.user` check |
| R-42 | Payload provides **no global security-header surface** — no CSP, no HSTS, no `X-Frame-Options`; only `upload.modifyResponseHeaders` exists, and only on the Payload-served media path | SEC | H | M | An observatory scan showing no CSP/HSTS | Set them in the Next layer (`headers()` in `next.config.mjs`) **and** at the reverse proxy | Proxy-level headers can be added without a code deploy |
| R-43 | **`pasteURL` is enabled by default** — an authenticated editor can make the server fetch an arbitrary remote URL into the media library | SEC | H | M | A media item whose origin nobody can explain | `pasteURL: false` explicitly on **every** upload collection. It is on by default and silence is consent | Audit the media library for unexpected entries |
| R-44 | **SVG is not on Payload's restricted list**, and the docs' own `mimeTypes: ['image/*']` example would accept `image/svg+xml`. Worse: declaring `mimeTypes` **disables Payload's own restricted-type verification** | SEC | H | H | An `image/svg+xml` file in the media library | An explicit raster-only allow-list (**never** the `image/*` example), `allowRestrictedFileTypes: false`, **plus** a `beforeOperation` hook: magic-byte sniff → MIME-mismatch 415 → hard SVG rejection → dimension guard → EXIF strip. **Correct any document claiming "Payload blocks dangerous file types for us"** | Delete the asset, purge the CDN, audit every page that referenced it |
| R-45 | `width`/`height` on uploads *(downgraded — they **are** documented auto-added fields)*; the CLS contract still means we should own them | TECH | L | H | A public `ImageRef` with `undefined` dimensions; a CLS regression | Populate `width`/`height`/`originalFilename` ourselves from `sharp().metadata()`, locked by field-level `access`. Ours are authoritative either way | Backfill via a data migration over existing media |
| R-46 | `upload.limits.fileSize` is a **single application-wide value** — the 10 MB image / 25 MB PDF split is not expressible in config, and a hook-thrown error is not an HTTP 413 | TECH | M | L | A 12 MB "image" accepted | Set the global limit to the higher (PDF) ceiling with `abortOnLimit: true`; enforce the tighter image ceiling in the same `beforeOperation` hook; record in the contract that the image case is a 4xx, not a 413 | Accept the 4xx, or write a `limitHandler` |
| R-47 | Payload derives filenames from the uploaded name and collision-suffixes them; whether `req.file.name` may contain `/` is **[UNDOCUMENTED]** | SEC | M | M | A public URL containing a human filename | UUID rename in `beforeOperation`, on **both** create and update; extension from the **sniffed** type, so ordering inside the hook matters; a flat UUID under a static `prefix` rather than a `yyyy/mm` partition | Rename on the next replace |
| R-48 | **No referential integrity, no cascade config, no orphan reporting, no grace-period sweeper** — all custom, and they fight the admin UI's Delete and bulk-delete buttons | DATA | H | M | A 404 image on a live project page | Join fields for reference counting + a `beforeDelete` guard returning 409 with the usage list; soft delete with a sweeper; `disableBulkDelete` on `media`; an orphan query in the admin | Restore the object from bucket versioning and re-attach |
| R-49 | `disablePayloadAccessControl` fork — default proxies every image through the app (latency, egress, media served from the *app* origin); on removes file-level access control entirely. `Cache-Control`/`nosniff`/`Content-Disposition` must then come from the bucket/CDN, which `s3Storage()` cannot set | SEC | M | M | Media served from the app origin, or a brochure downloadable that should not be | Settle OQ-18 **before** writing the storage config; two collections so the two answers never coexist on one; record that those headers are CDN/bucket responsibilities | Flip the flag and purge the CDN — but flipping changes every stored URL's meaning, so treat it as a migration |
| R-50 | The documented migration of the five placeholder **SVGs** collides with the absolute SVG ban; the documented cutover cannot be executed through the documented upload path | DATA | H | M | The seed failing on the five placeholder covers | Choose one deliberately and write it down: rasterise to PNG before seeding (recommended); a one-off validated seed bypass; or allow SVG only for the five seeded assets with a documented expiry | Seed with raster placeholders and accept a visual difference from `projects.ts` — but that breaks gate criterion #7, so it is not free |
| R-51 | **No documented retry backoff and no dead-letter queue** — three fast retries during a 20-minute provider outage lose the notification, leaving only a DB row | TECH | M | H | `payload-jobs` rows with `hasError: true` and nobody looking | A **watchdog** querying for failed `sendLeadNotification` jobs and alerting on a second channel; hand-rolled backoff by re-queueing with `waitUntil`; `JobCancelledError` for permanently-invalid input so retries are not burned | A manual re-queue action plus an admin-visible read-only notification log via `jobsCollectionOverrides` |
| R-52 | **Silent worker death** — if the worker dies, `jobs.queue()` still succeeds, leads still save, the API still returns `201`, and **zero notifications go out** with no error anywhere in the request path | TECH | M | H | Queue depth rising while `completedAt` stays null; no notifications reported by sales | Worker as its own container with a restart policy and a liveness check; monitor queue depth and oldest-pending-job age; alert on both | Restart the worker — queued jobs drain automatically, so no leads are lost provided retention is on |
| R-53 | **Missing email adapter = silent success** — with no adapter Payload *logs a warning* on a send attempt and is not documented to throw; the task resolves reporting success | TECH | L | H | **None at runtime — that is the whole problem** | A boot-time assertion refusing to start in production without SMTP configuration; in the handler, **assert the provider actually returned a result** rather than assuming | Re-run the failed notifications from the persisted lead records once the adapter is fixed |
| R-54 | Duplicate notification emails on retry if the task is not idempotent | TECH | M | L | Sales reporting two identical notifications | Mark the lead `notifiedAt` and short-circuit the task if already set | Apologise; no data impact |
| R-55 | **HTML injection** from attacker-controlled lead `name`/`message` into the staff notification email; Payload ships **no templating engine and no escaping** | SEC | M | M | A lead `message` containing markup | One reviewed, unit-tested `escapeHtml` applied to **every** attacker-controlled field; a plaintext alternate | None needed if escaped; if not, treat as a phishing vector against staff |
| R-56 | Whether `payload.sendEmail()` throws or resolves on transport failure is **[UNDOCUMENTED]** — if it swallows, the retry count is decorative and `hasError` never becomes true | TECH | M | H | `totalTried: 1`, `hasError: false`, and no email | A handler that works under either semantic — `try/catch` **and** a truthiness check on the provider result; verify empirically against the installed version | Call the provider SDK directly from the task if Payload's wrapper proves to swallow |
| R-57 | **Next.js version incompatibility** — supported `15.2.9–15.2.x`, `15.3.9–15.3.x`, `15.4.11–15.4.x`, `16.2.6+`; the published `@payloadcms/next` peer range is tighter (`>=16.3.3 <17`). **svfrontend's 15.5.25 is outside every range** | VENDOR | M | H | npm peer-dependency warnings at install; admin-panel runtime errors with no obvious cause | Pin `next` exactly (no `^`) to `16.3.3`; a CI check asserting the installed version is in the supported set; record that merging into svfrontend is blocked until svfrontend upgrades | Downgrade/upgrade `next` in the backend only — the two apps share no `node_modules` |
| R-58 | **Node version doc-vs-reality** — the roadmap says "Node 20 LTS" three times; the machine runs 24.11.0; Payload supports it (`^18.20.2 \|\| >=20.9.0`, official Dockerfile `node:24-alpine`) | TECH | M | M | `npm install` failing in svbackend on an `engines` check | `"engines": { "node": ">=20.9.0" }` in svbackend — **do not copy svfrontend's `<23`**; a per-app `.nvmrc`; amend the roadmap wording | Install Node 20 via nvm only if something genuinely requires it |
| R-59 | **Package manager** — yarn 1.22.22 is explicitly unsupported; pnpm absent; every doc command is `pnpm payload …` and the npm equivalents are **[UNDOCUMENTED]** | TECH | M | L | `yarn install` in svbackend | Standardise on npm; commit `package-lock.json`; translate every `pnpm payload …` command once, in writing | Install pnpm via corepack if npm proves problematic |
| R-60 | **Dependency skew** — all `payload` and `@payloadcms/*` must be on exactly the same version and installed once; a second copy of React produces cryptic admin errors | TECH | M | M | `TypeError: Cannot destructure property 'config' of…`; `useUploadHandlers must be used within UploadHandlersProvider` | Exact-pin `payload`, every `@payloadcms/*`, `react`, `react-dom`; keep svbackend as its own dependency tree | `npm ls react` to find the duplicate; dedupe |
| R-61 | **Stale import map** — it never regenerates at runtime or after a production build | TECH | M | M | An admin component that renders in dev and 500s in production | `generate:importmap` as a **build step**, before `next build`, never a manual step | Rebuild |
| R-62 | **sharp in production** — required for `imageSizes`/crop/focal point; native-binary, musl-vs-glibc and cross-arch caveats are **entirely undocumented by Payload** | TECH | M | M | Build green, first image upload throws | Validate the Docker build on the target architecture; **upload a test image in a staging/production container as part of the deploy smoke test** — the only reliable detector | Rebuild the image on the correct platform |
| R-63 | **Payload 4 upgrade** — canary only today, removes `jobs.depth`/`jobs.runHooks`/`addParentToTaskLog`, replaces `processing` with a lease model, requires Node ≥24.15.0 (machine: 24.11.0), Next ≥16.2.6, TS ≥6.0.3 | VENDOR | M | M | 3.x moving to maintenance | Pin 3.x; keep the jobs config free of the options v4 removes where avoidable; keep the config small | A planned upgrade window including the Node/Next/TS bumps |
| R-64 | **Payload documents no health check and no backup/restore procedure** — while shipping `migrate:fresh` one typo from a deploy script | TECH | H | H | Nobody able to answer "when did we last test a restore?" | **A restore must actually be performed** — it is the single most valuable control in this register. Nightly `pg_dump -Fc` or managed PITR; S3 bucket versioning; a mandatory backup before every migration; a root-level `/healthz` Route Handler with `dynamic = 'force-dynamic'` doing a trivial `select 1`. `psql` is not on PATH — use `docker run postgres:15 pg_dump` | §28.4.13 |
| R-65 | **No official testing documentation exists** — no Testing page; Vitest and Playwright unnamed; no documented teardown or `destroy()` API, so test processes can hang in CI | SCHED | H | M | A plan that says "follow Payload's official testing guide" | Own the harness explicitly as an ADR; boot via `getPayload({ config })`; disposable per-job Docker databases; ESM throughout; `fileParallelism: false` | Force-exit the runner if the missing teardown hangs CI |
| R-66 | **The frontend has no `images.remotePatterns`** — six `next/image` call sites will throw *"Invalid src prop … hostname is not configured"* the instant image URLs become remote | TECH | H | H | That exact error on the first remote image | This must be an explicit, named Phase-9 deliverable: `remotePatterns` for the CDN host, the bucket host, and the Payload host if media is proxied; keep `pathname` tight. **Do not let Phase 6 "finish" believing the frontend can consume the media it now serves** | **None available before Phase 9 approval** — which is exactly why it must be scheduled, not discovered |
| R-67 | **D-012 is PROPOSED yet already a hard deliverable**, and Phase 9 depends entirely on it | SCHED | M | H | An admin publishing and seeing no change on the site | Promote D-012 to ACCEPTED or add a sign-off entry criterion to Phase 7. Implement the webhook fire-and-forget with retry; a revalidation failure must not fail the save; surface *"Saved. The website may take a few minutes to update."* | A manual revalidation endpoint an admin can trigger, plus a documented "rebuild the site" runbook step |
| R-68 | Enforcing 10-digit phones before Phase 9 aligns the frontend creates a **silent lead-loss regression inside the phase whose purpose is to stop lead loss** | DATA | M | H | A drop in lead volume after Phase 5 ships | Accept ≥8 digits server-side until Phase 9 aligns the frontend; put the tightening on Phase 9's checklist | Relax the rule immediately and re-contact anyone whose submission 422'd — **only possible if the rejection was logged**, so log rejected submissions without storing them as leads |
| R-69 | **Env-var naming drift** — Payload's docs use `DATABASE_URL` everywhere (`DATABASE_URI` appears **zero** times); neither project env list contains `PAYLOAD_SECRET` at all | TECH | M | M | A config reading a variable the deployment does not set | Pick `DATABASE_URL`; add `PAYLOAD_SECRET` to the canonical list; validate every required variable at boot | A one-line rename plus a redeploy |
| R-70 | `create-payload-app` may refuse to scaffold into the non-empty `svbackend/` — **[UNDOCUMENTED]** | TECH | M | L | The scaffolder refusing to run | Scaffold into a temp directory and move `docs/` in afterwards | Manual installation, which Payload documents as a supported five-step path |
| R-71 | **No effort or date estimates exist anywhere** — only a directional T-shirt table explicitly labelled "not a quote" | SCHED | M | M | A date appearing in a status update | **Do not cite a schedule as if one were documented.** If the owner needs dates, produce them deliberately after the Phase-1 gate | Re-baseline after the gate |
| R-72 | **Provider risk** — both storage and email providers are undecided, so two vendor relationships, two credential sets, two DPDP sub-processors and two failure modes are unowned | VENDOR | M | M | OQ-7 still open when Phase 6 starts | Build provider-agnostic (S3-compatible API + SMTP), keep provider details in env vars, and name both providers in the privacy policy's sub-processor list | Switching providers is a credential change plus a media re-upload — cheap at this volume if the abstraction held |

### 28.3 The top risks, in detail

Only the risks whose failure mode is **silent, legal, or unrecoverable** are expanded. Everything else is adequately covered by its row above.

**R-10 + R-12 together are the highest-severity pair in the stack.** They are separate defects with one combined consequence. `overrideAccess` defaults to `true` in the Local API, so a bare `req.payload.find({ collection: 'leads' })` inside a public handler returns everything, with field-level access stripping also disabled. Independently, a never-published document lives in the **main** table with `_status: 'draft'` and **is returned by a plain `find()`** — `draft` is not an authorization mechanism. Either defect alone leaks; together they leak silently and unlogged. For SV Developers the leaked content is **uncleared DTCP/RERA approval claims and land-title assertions**, so the severity is legal, not merely technical. The mitigation is three independent layers on every public read — collection `access.read` returning the published-only constraint, `overrideAccess: false` **and** `user: undefined` on every Local API call, and a hard-coded `where: { _status: { equals: 'published' } }` the caller cannot override — all enforced by one `publicFind()` wrapper, with a lint rule that fails the build if `payload.find` or `payload.findByID` appears under `src/app/(public)/**` without going through it. Any one layer suffices; all three are required, because the cost of a fourth line of defence is nil and the cost of a leak is a legal escalation.

**R-9 — over-exposure via auto-generated endpoints — is upgraded to near-certain** because **there is no documented way to disable Payload's REST API**, per collection or globally. The collection `endpoints` option is described only as *"Add custom routes to the REST API. Set to `false` to disable routes"* and its scope is unstated and unverified. This means config alone cannot close `/api/leads`. The mitigation is layered and the last layer is infrastructure: `graphQL: { disable: true }` at the root; an explicit `access` block on **100 %** of collections and globals (the only documented lever over the generated surface); a reverse-proxy rule blocking `/api/<collection-slug>` paths that are not ours; and a mandatory negative test suite that curls every generated route anonymously. The test is the backstop, not the control.

**R-14 + R-15 — the audit trail is not what the documents claim.** Two independent findings converge. First, **Payload versions store `parent`, `autosave`, `version`, `createdAt`, `updatedAt` — no actor, no IP, no action type, no auth events** — and `maxPerDoc` prunes, so they are not append-only. Second, **the admin UI publishes through its own button and never touches our custom endpoints**, so audit logic placed in endpoint code would miss every real publish. The consequence is that `IMPLEMENTATION-DECISION.md` §7/§10's "Hooks + Payload versions" rating overstates the contribution, and that rating is the actual hazard — it is what a future session will read and trust. Audit **must** be a dedicated append-only `audit-log` collection with `create`/`update`/`delete` access all `() => false` (hooks write it), fed by shared `afterChange`/`afterDelete` collection hooks capturing actor, IP, action, entity and a before/after diff for the sensitive fields — `approvals`, `area`, `proximity` and anything title-related. There is no contingency: an audit log that cannot say *who* changed an approval number is not an audit log.

**R-33 — Payload 3 ships no HTTP rate limiting at all.** v2's `rateLimit` config is gone with Express; the dedicated anti-abuse page has no rate-limiting section and recommends no replacement; the only occurrence of "rate limit" in the entire docs corpus is an example of throwing your own `APIError`. Five project documents assume it exists or is free. Every documented limit — `/leads` 5/min/IP and 3/hour/phone, admin login 5/15min/IP, a public-GET ceiling — is reverse-proxy, CDN or WAF configuration and is a **tracked infrastructure deliverable**. Two consequences that are easy to miss: each limit must return `429` **with `Retry-After`**, and the build egress IP must be **exempted**, because under ISR all public GETs originate from one build machine and a naive per-IP ceiling would throttle a full site rebuild.

**R-52 + R-53 + R-56 — the lead notification can report success while sending nothing.** Three independent silent-failure modes stack. With no email adapter configured, Payload *logs a warning* rather than throwing, so a task can resolve and report `emailSent: true` having sent nothing. Whether `payload.sendEmail()` throws or resolves on transport failure is undocumented, so `retries: 3` may be decorative and `hasError` may never become true. And if the worker container dies, `jobs.queue()` still succeeds, the lead still saves, the API still returns `201`, and zero notifications go out with no error anywhere in the request path. For a lead-generation product this is **the only truly unacceptable failure mode**, because the business consequence is revenue loss that nobody observes. Three controls, all mandatory: a **boot-time assertion** that refuses to start in production without SMTP configuration; a handler that works under either `sendEmail` semantic (`try/catch` **and** a truthiness check on the provider result); and a **watchdog** querying for failed and stuck jobs, alerting on a **second channel** — because the failure being detected may be that email is broken.

**R-66 — the frontend cannot consume remote media today.** `svfrontend/next.config.mjs` configures `formats`, `qualities`, `dangerouslyAllowSVG`, `contentDispositionType` and `contentSecurityPolicy` — and nothing else. There is **no `images.remotePatterns`**, so six `next/image` call sites throw *"Invalid src prop … hostname is not configured"* the instant image URLs become remote. Fixing it requires editing `svfrontend/`, which is forbidden until Phase 9 is explicitly approved. **There is no contingency available before that approval** — which is precisely why `images.remotePatterns` is a named Phase-9 deliverable (T-176) rather than something discovered at integration time, and why Phase 6 must not be declared finished on the belief that the frontend can render what it now serves.

**R-64 — no backup, no restore, no health check, and `migrate:fresh` one keystroke away.** Payload documents none of these; the only two occurrences of "backup" in the entire docs corpus are pre-flight warnings on the Lexical migration. Meanwhile `migrate:fresh` (*"Drops all entities from the database"*) and `migrate:reset` sit adjacent to the harmless `migrate:status`. The controls are entirely ours: nightly `pg_dump -Fc` or managed PITR, S3 bucket versioning for the second store, a mandatory backup immediately before every migration, a root-level `/healthz` Route Handler, and a house rule that the two destructive commands appear in **no** npm script, CI job or runbook. **NFR-10 is not satisfied by having backups; it is satisfied by having restored one** — that is a Phase-10 exit criterion and it is the single highest-value control in this document.

### 28.4 Disaster and failure recovery

Fourteen named scenarios. Each: **DETECTION · IMMEDIATE RESPONSE · RECOVERY PATH · PREVENTIVE CONTROL.**

#### 28.4.1 Migration failure — development

**Detection.** `npm run payload migrate` errors locally; or the subtler case — Payload's own warning that `push` and migrations *"are not meant to be used interchangeably"*; or a migration that "works on my machine" and fails in CI.

**Immediate response.** Stop. Do **not** attempt a second `migrate`. Do **not** reach for `migrate:fresh` or `migrate:reset`. Capture the full error and the output of `migrate:status`.

**Recovery path.** The local database is, by house rule, a disposable sandbox: `scripts/resetSandbox.sh` (`docker compose down -v && docker compose up -d`), then either let dev `push` re-sync from the config or run the migration chain from empty. If the failure was in a *generated* migration, delete it, fix the config and regenerate — never hand-patch a generated migration that has not been committed. If it was an env-conditional divergence, make the config environment-invariant in shape and regenerate.

**Preventive control.** One written house rule in `svbackend/README.md`: *local dev DB is a disposable sandbox on `push`; every other environment is migrations-only; `migrate` is never run against the local dev database.* A documented reset script so nobody reaches for `migrate:fresh`. Review every generated migration before committing — Payload's own docs advise exactly this.

#### 28.4.2 Migration failure — production

**Detection.** The CI `payload migrate && next build` step fails and correctly rejects the deployment. Or, if `prodMigrations` is used, the container fails to complete initialisation and the health check never goes green.

**Immediate response.** The deployment is already blocked — that is the designed behaviour and the safe one. Do not retry blindly. Run `migrate:status` against production to see exactly which migrations ran. Because **each migration runs in its own transaction** and is aborted on error, the database should be at a clean boundary — **verify that rather than assume it**.

**Recovery path.** Clean boundary: fix the migration, regenerate, redeploy. The previous release is still serving traffic, so there is no outage. Not a clean boundary (a non-transactional operation, or a data migration that partially wrote): restore from the pre-migration backup (§28.4.13) and redeploy the previous release.

**Preventive control.** `payload migrate` **before** `next build` in CI, so a failure rejects the deploy rather than crash-looping a container. A **mandatory backup immediately before the migrate step**. `migrate:status` as a read-only pre-deploy gate. Serialised deploys so two never migrate at once. Expand-contract discipline for any column rename or drop, since Payload auto-generates destructive DDL and rolling deploys are entirely our problem.

#### 28.4.3 Bad seed

**Detection.** Gate criterion #7 (*"seeded projects match `projects.ts` byte-faithfully"*) fails; or duplicate projects appear after a second seed run; or the seed fails on the five placeholder SVGs.

**Immediate response.** Do **not** re-run the seed hoping it self-corrects — a non-idempotent seed run twice is how duplicates are created. In a non-production environment, reset and reseed. **In production, never re-run a seed** — fix the specific records.

**Recovery path.** Delete the seeded records by slug and re-run an idempotent seed. If the seed ever ran through `onInit`, disable the `PAYLOAD_SEED` gate first — `onInit`'s execution count under multiple instances is **[UNDOCUMENTED]**, so it may fire more than once.

**Preventive control.** The seed is a standalone script run with `npm run seed` → `payload run src/seed/index.ts`, **not** `onInit`, because `payload run` loads environment variables the way Next.js does and initialises tsx. Every entity is a **slug-based upsert**, never a blind create. The SVG question is decided **before** the seed is written, not when it fails.

#### 28.4.4 Malformed project data

**Detection.** The contract test fails; or `tsc --noEmit` on the frontend fails against the public DTO; or a detail page renders a section that should have been dropped. **The dangerous variant is an invalid `icon` value, which renders nothing — a silently broken page, invisible to the admin who caused it.**

**Immediate response.** Unpublish the affected project (`_status: 'draft'`), which removes it from the public API, then trigger revalidation so the live site drops it. Unpublished must return **404, not 403**.

**Recovery path.** Correct the record in the admin, republish, revalidate. If the cause was a serialiser bug rather than bad data, patch `src/serializers/toPublicProject.ts` — one control point — and redeploy; every project is corrected at once.

**Preventive control.** The icon enum closed at **both** layers — field validation *and* a real Postgres enum via `enumName`. Field validation for every rule in `VALIDATION-RULES.md`. Contract tests against the real `Project` type in CI. Placeholder-aware validation so bracketed values are visible. And the standing rule that **absent beats invented**: a missing field drops a section by design; it is not an error to be filled with filler.

#### 28.4.5 Failed media upload

**Detection.** A 413 (size), 415 (type or magic-byte mismatch), a 4xx from the custom validation hook, or an S3 error surfaced by the adapter.

**Immediate response.** Distinguish three causes, because they need different answers: **(a) rejected by policy** — correct behaviour; tell the editor what to change. **(b) rejected by a limit that is wrong** — e.g. the default ceiling silently rejecting a legitimate 25 MB brochure. **(c) infrastructure failure** — S3 credentials, endpoint, bucket policy.

**Recovery path.** (a) none needed. (b) correct `upload.limits` / the hook threshold and redeploy. (c) fix credentials or endpoint config; uploads are idempotent from the editor's point of view, so a retry is safe.

**Preventive control.** `useTempFiles: true` with a writable `tempFileDir` so large files are not buffered in RAM. `abortOnLimit: true` so oversize returns a real 413. `responseOnLimit` set to a message that **never echoes paths or bucket names**. A deploy smoke test that uploads one real image — also the only reliable detector for the sharp native-binary failure.

#### 28.4.6 Media deleted while in use

**Detection.** A 404 image on a live project page; or, if the guard works, a **409 at deletion time with a usage list — which is the success case**.

**Immediate response.** If the object is already gone from storage: restore it from **S3 bucket versioning** and re-attach it to the project. Revalidate the affected paths.

**Recovery path.** If bucket versioning is off and the object is gone, the asset is unrecoverable and must be re-uploaded from the original source. The *reference* is recoverable from the project document's version history; **the bytes are not.**

**Preventive control.** A `beforeDelete` guard on `media` counting inbound references via `join` fields and throwing 409 with the usage list unless an explicit force flag is passed. Soft delete plus a grace-period sweeper so the storage object outlives the database row. `disableBulkDelete` on `media` — bulk delete is the realistic way this happens. S3 bucket versioning. And note that **`?force=true` must explicitly remove the attachment rows, which can strip a published project's required cover** — no rule currently says whether a published project may end up coverless, and that gap must be closed with a hook rather than left to chance.

#### 28.4.7 Failed email

**Detection.** `payload-jobs` rows with `hasError: true` and a populated `error`; a rising oldest-pending-job age. **The dangerous variant is no detection at all** — with no adapter configured Payload logs a warning and the send appears to succeed, and whether `sendEmail` throws on transport failure is undocumented.

**Immediate response.** **The lead is already safe** — persistence happens first, enqueueing second, and the `afterChange` enqueue is wrapped in `try/catch` precisely so a queue failure cannot fail the public request. Read the lead from the admin and contact the customer manually. That is the whole point of persisting first.

**Recovery path.** Fix the provider or configuration, then re-queue: `payload.jobs.runByID({ id })` for a specific job, or a manual re-send action for the affected leads. Because job retention is on, the failed jobs are still there to re-run.

**Preventive control.** A **boot-time assertion** refusing to start in production without email configuration. A defensive handler that asserts the provider returned a result rather than assuming. `retries: 3`. A **watchdog** alerting through a second channel, because Payload has no dead-letter queue and no alerting. `notifiedAt` on the lead so a retry cannot double-send. `escapeHtml` on every lead field in the body.

#### 28.4.8 Job failure and poison messages

**Detection.** A job whose `totalTried` climbs while `hasError` stays true; or the documented triage signals — `processing: true` but stuck (worker crashed), `hasError: true` (check `log`), `completedAt: null` (not run yet).

**Immediate response.** Distinguish **transient** (provider outage — will succeed later) from **poison** (malformed input, missing recipient — will never succeed). A poison message must not consume retries forever; a transient failure must not be discarded.

**Recovery path.** Transient: re-queue with `waitUntil` set to a back-off time — hand-rolled, because Payload documents no backoff. Poison: throw `JobCancelledError` from the handler so the job stops retrying immediately, record it, fix the input. Stuck in `processing`: restart the worker; investigate whether the handler can hang — **no documented lease or timeout exists in 3.x** (the lease model is a v4 feature).

**Preventive control.** Idempotent task handlers — the docs warn explicitly that *"retries might cause the task to run more than once"*. `JobCancelledError` for permanently-invalid input. A watchdog plus alerting, since "it's in the database" is not monitoring. Read-only admin visibility of `payload-jobs` via `jobsCollectionOverrides`, remembering the docs' warning that opening raw access *"can expose job data and execution-control fields"*.

#### 28.4.9 Unauthorized access / suspected credential compromise

**Detection.** Audit-log entries with an unexpected actor, IP or time; repeated lockouts; a content change nobody claims; a public endpoint returning data it should not.

**Immediate response — in this order:**
1. **Terminate the suspect's sessions.** With `useSessions: true` (the default) the documented primitives are: an admin **updating the user's password ends all of that user's sessions**; `resetPassword` *"ends all existing sessions"*; and the user's own `logout` with `allSessions: true`.
2. **Deactivate rather than delete the account** — admin users are deactivated, never deleted, so audit attribution survives.
3. **Regenerate any API keys** for that user — an API key *"is independent of the user's password. Changing or resetting a password does not disable an existing API key."* **This is the step most likely to be forgotten.**
4. **Preserve the audit log.** It is append-only by design; do not prune it during an incident.

**Recovery path.** Review every mutation by that actor in the audit log, with before/after values for the sensitive fields. Revert incorrect content via version history and republish. **If lead data may have been read, treat it as a personal-data breach under the DPDP Act** and follow whatever notification obligation the privacy policy and Indian law impose. Rotate `PAYLOAD_SECRET` **only** if the secret itself is suspected — and read §28.4.14 first.

**Preventive control.** Two admin accounts minimum, one per real person. `maxLoginAttempts` + `lockTime`. Deny-by-default access control written **explicitly** on every collection and global — Payload's actual default is *allow any authenticated user full CRUD*, and `readVersions` is the easy one to forget because it is a seventh, non-obvious function. Audit hooks on the **collections**, not the endpoints. Edge rate limiting on the admin login route. A tight `csrf` allow-list and the backend on a subdomain so `SameSite=Lax` still applies.

#### 28.4.10 Broken public API response shape

**Detection.** The contract test fails in CI; a key-set snapshot fails; or — worst case — a frontend build fails after a deploy because the DTO changed.

**Immediate response.** **Because the frontend is ISR, the last good build keeps serving.** That is the single most valuable property of D-012 and it buys the time to fix this properly. Do not force a rebuild until the shape is corrected.

**Recovery path.** Fix `toPublicProject()` — one function, one control point — and redeploy the backend, then revalidate. If the break came from a Payload upgrade changing a populated shape, pin the previous version while fixing.

**Preventive control.** Include-mode `select` only, never exclude-mode (which is a deny-list). **Ban `...doc` spread in the public-API module** — it is the mechanism by which `_status`, `pagingCounter`, row ids and `null` pages leak. One `put()` primitive with a single documented emptiness rule. Contract tests for a fully-populated **and** a minimally-populated document, in CI. A CI check that regenerating `payload-types.ts` produces no diff.

#### 28.4.11 Frontend receives incompatible data

**Detection.** `tsc --noEmit` failure; a page rendering an empty shell where a section should have been dropped; `next/image` throwing *"Invalid src prop … hostname is not configured"* — the single most likely concrete instance.

**Immediate response.** ISR means the previous build is still live. Stop the rebuild. Identify whether the incompatibility is **shape** (serialiser) or **host configuration** (`remotePatterns`).

**Recovery path.** Shape: fix the serialiser, redeploy the backend, revalidate. Host configuration: this requires a **frontend** change, **forbidden until Phase 9 is approved** — which is precisely why `images.remotePatterns` must be a named Phase-9 deliverable rather than a surprise. Until then the frontend cannot consume remote media at all.

**Preventive control.** Compile the frontend against the public DTO types so drift is a compile-time failure — the decisive criterion on which Payload was selected. `generateStaticParams` sourced from the API with a build that fails loudly rather than silently prerendering an empty list. The two carried-over rules: the form shows success **only** on a real `201`, and `[BRACKETED]` values still render inert.

#### 28.4.12 Deployment failure and rollback — code **and** schema

**Detection.** Build failure; migrate failure (§28.4.2); health check not going green; error rate spiking after a release.

**Immediate response.** If the migrate step failed, the deploy was already rejected and the previous release is still serving — triage only. If the new release is running and misbehaving, roll back the **code** first: redeploy the previous image.

**Recovery path — the hard case is rolling code back *past* a migration.**
- **Additive migrations** (new nullable column, new table) are safe to leave in place; old code ignores them. **Roll back the code and leave the schema forward.** This is the normal case and should be the design target. ~2 minutes.
- **Destructive migrations** (dropped or renamed column, narrowed type) are **not** safely reversible by code rollback. `migrate:down` rolls back a **batch**, not one migration, and an auto-generated `down` restores *structure, not data* — a rollback after a column drop loses the data regardless. The choice is: restore from the pre-migration backup and accept losing every write since, **or fix forward** with a new migration and a new release.
- **Default posture: fix forward.** Restoring is for data loss, not for a bad release.

**Preventive control.** **Expand-contract on every schema change** — add the new shape, dual-write, migrate readers, drop the old shape only in a *later* release — so at every point the previous code version still works against the current schema. One migration per logical change so batches stay small. A mandatory pre-migration backup. `migrate:fresh`/`migrate:reset` in no script, ever. Serialised deploys. And write the additive-vs-destructive distinction into the runbook verbatim — it is the difference between a two-minute rollback and a restore.

#### 28.4.13 Database loss / restore from backup

**Detection.** Corruption, an accidental `migrate:fresh`/`migrate:reset`, host failure, or a destructive data migration.

**Immediate response.** **Stop all writes** — take the backend out of the load balancer so the application cannot compound the damage. Identify the most recent good backup **and, critically, the corresponding state of the media bucket** — there are *two* independent stores and a restore must reason about both.

**Recovery path.** Restore Postgres from the most recent dump or PITR target. Then reconcile media: objects uploaded after the restore point exist in S3 with no database row (**orphans** — harmless, cleanable); objects deleted after the restore point have a row but no object (**broken images** — recoverable from bucket versioning if enabled). Run `migrate:status` to confirm the restored schema matches the deployed code; if it does not, deploy the matching release. **Re-seed nothing.** Verify: an admin can log in, a project renders, and a synthetic lead flows end to end including the notification.

**Preventive control — the highest-value control in this document.**
- **A restore must actually be performed, not planned.** It is a Phase-10 exit criterion and appears again in the pre-production checklist. Payload documents **no** backup or restore procedure at all.
- Nightly `pg_dump -Fc` or managed PITR; encryption at rest; offsite copies. **Backups contain PII and inherit the same access controls and retention as live data.**
- S3 bucket versioning plus lifecycle rules for the media half.
- A mandatory backup immediately before every migration.
- Least-privilege database role: the running app role has **no DDL**; `payload migrate` runs as a separate pre-deploy job under a DDL-capable role. Under D-015 Payload runs migrations from the app process, so this needs explicit handling rather than being assumed.
- **`psql` is not on PATH on this machine** — all client tooling goes through `docker run postgres:15 …`.

#### 28.4.14 `PAYLOAD_SECRET` rotation or loss

**What the secret actually does.** It is not just a JWT key. Payload *"processes your secret using SHA-256 hash and takes the first 32 characters"*, and that derived value signs JWTs. It is documented as used for *"any encryption workflows — for example, password salt / hashing"*, and, stated outright, **API keys are encrypted with it**: *"If you change your `PAYLOAD_SECRET`, you will need to regenerate your API keys."*

**Detection.** Rotation is deliberate, so detection applies to *loss*: the container fails to boot, or — far worse — boots with an **empty** secret because of the `|| ''` pattern in the official example, in which case every token is signed with a deterministic, empty-derived key: a silent and total authentication compromise.

**Immediate response on suspected compromise of the secret.**
1. Rotate `PAYLOAD_SECRET` in the platform secret store and restart. Expect **every** issued admin cookie to stop verifying — all admins are logged out. That is the intended effect.
2. **Regenerate every API key.** Documented, and the step most likely to be missed; existing keys become permanently invalid, not merely rejected.
3. Force a password reset for every admin, which independently terminates all sessions.
4. Audit for use of the old secret.

**Immediate response on loss (secret unknown, no backup of it).** Do not guess or generate a replacement casually. Generate a new long random secret, deploy it, accept that all sessions and API keys are dead, and reset all admin passwords. Verify empirically whether stored password hashes survive: the documented hash format carries a per-user salt (`pbkdf2-sha256-v1:<derived-key>`), which implies passwords are unaffected — **but the docs never state this as a rotation guarantee, so it must be tested in staging before it is relied on in production.**

**Recovery path.** Re-issue API keys to whatever consumes them — **nothing does today**, since the public API is unauthenticated reads plus one unauthenticated write, which is exactly why rotating now is far cheaper than rotating later. Communicate the forced logout to admins **before** doing it, not after.

**Preventive control.**
- **Never ship `process.env.PAYLOAD_SECRET || ''`.** Fail fast at boot if the secret is absent or under 32 characters.
- Store it only in the platform secret store; distinct per environment; never committed, never logged, never returned in an error, never echoed by a debug route.
- **Write and rehearse a rotation runbook now, in staging, while nothing depends on API keys.** Payload documents the *consequences* of rotation but publishes **no procedure**. A rotation runbook that has never been executed is not a control.
- Do **not** design revocation around secret rotation. The supported primitives are sessions: `logout({ allSessions: true })`, admin-initiated password update, and `resetPassword`. **Secret rotation is break-glass.**

---

## 29. Exact Implementation Order

**This is the literal sequence the MASTER IMPLEMENTATION PROMPT follows.** Numbering is continuous from 1 to 233 across all phases. Every step names the artefacts it produces at real paths, the command that verifies it, and the condition that makes it pass. No step requires re-deriving a decision made earlier.

**Two ordering notes that differ from the phase numbers.** (1) **Phase 8 (Tier-2) executes before Phase 7 (Public API)** in this linear order, because four of Phase 7's six read endpoints serialise Tier-2 collections that must exist first. The phase *numbers* are unchanged; only their position in a single-threaded execution is. With two or more developers they run concurrently (§25). (2) **Infrastructure (Phase 11 steps 213–216) may be pulled forward and run during Phase 1**; T-130 and T-196 require it, and it needs no application code.

**Gate markers.** 🔶 = a business decision is required before the step can complete · 🛑 = an explicit human approval gate · ⛔ = a stop-and-reassess point that can void D-015.

Paths are relative to `c:/progromming/SV DEVELOPERS/`. All commands are run from `svbackend/` unless stated.

### PHASE 0 — Decisions & Environment Lock (steps 1–22)

*No code. Nothing else may start. All of it is written down; none of it is left in someone's head.*

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 1 | `git init` `svbackend/` **before anything is scaffolded** — 18 specification documents (~3 495 lines) are currently unversioned | `svbackend/.git/`, `svbackend/.gitignore` (blocks `.env*`, `.next`, `node_modules`, `/media`) | `git -C svbackend status` | Clean tree; `docs/` is tracked; `.env*` is ignored |
| 2 | Record the measured toolchain (T-016) | `svbackend/docs/DECISIONS.md` new entry | `node -v && npm -v && docker -v && git --version` | Node 24.11.0, npm 11.6.1, Docker 29.3.1 recorded; note recorded that **`psql` is absent** and all Postgres client tooling goes through Docker |
| 3 | Decide the package manager: **npm** (OQ-36). yarn 1.22.22 is explicitly unsupported; pnpm is absent | `DECISIONS.md`; `svbackend/README.md` translation note for every `pnpm payload …` doc command | review | A written decision exists; `package-lock.json` will be committed |
| 4 | Decide the exact version pins (OQ-35 / T-004): `next@16.3.3`, `react@19.2.6`, `react-dom@19.2.6`, `payload@3.90.x` with every `@payloadcms/*` identical. No `^`, no `~`. `engines.node ">=20.9.0"` — **never svfrontend's `<23`** | `DECISIONS.md` | review | The pins are written down and the reason (svfrontend's 15.5.25 is outside every supported range) is recorded |
| 5 | Decide `idType: 'uuid'` (OQ-27 / T-002). Only `'serial'` and `'uuid'` exist; ULID is not an option | `DECISIONS.md` | review | Decision recorded with the note that it is adapter-global and effectively irreversible after migration 001 |
| 6 | Decide the reserved-name renames (OQ-28 / T-001): `Project.status` → `projectStatus`, `Lead.status` → `leadStatus`; the serialiser aliases `projectStatus` back to the public key `status` | `DECISIONS.md`; amendments noted for `DATABASE-SCHEMA.md`, `VALIDATION-RULES.md`, `API-CONTRACT.md`, `CONTENT-MANAGEMENT-MATRIX.md` | review | Recorded, with the quoted reason: *"using reserved field names will result in your field being sanitized from the config"* |
| 7 | Decide **unnamed** `tabs` everywhere (OQ-30) so the stored shape stays flat | `DECISIONS.md` | review | Recorded |
| 8 | 🔶 Decide **not** to enable `localization` (OQ-25), and record the deferral *and its cost* | `DECISIONS.md`; a comment planned for `payload.config.ts` | review | Recorded explicitly, so its absence is never read as an oversight. Admin `i18n` narrowed to `{ en }` |
| 9 | Decide the public URL layout (OQ-34 / T-014): **Next.js Route Handlers** under `src/app/(public)/api/v1/**`; `/healthz` outside `/api`; `src/endpoints/` stays empty | `DECISIONS.md` | review | Recorded, with the reason that Payload `config.endpoints` are always mounted under `routes.api` and that mixing mechanisms is the failure mode |
| 10 | 🔶 Decide deployment origins (T-015): `www.<domain>`, `cms.<domain>`, `media.<domain>` — the CMS on a **subdomain of the public registrable domain** | `DECISIONS.md` | review | Recorded. Owner supplies the domain; engineering supplies the shape |
| 11 | Decide the REST-surface fork (OQ-31): option **(A)** — `access.read` returns a published-only `Where` for anonymous — plus an infrastructure block on `/api/<collection-slug>` | `DECISIONS.md` | review | Recorded, with the note that **no documented REST kill switch exists** |
| 12 | Decide to delete `notification_jobs` (OQ-32) in favour of `payload-jobs`, and record the one-to-one field mapping | `DECISIONS.md`; `DATABASE-SCHEMA.md` §15 marked for deletion | review | Mapping recorded: `status`→`completedAt`+`hasError`+`processing`, `attempts`→`totalTried`, `last_error`→`error`, `scheduled_for`→`waitUntil`, `payload`→`input` |
| 13 | 🔶 Close OQ-7 to the shape needed now (T-008): `@payloadcms/storage-s3` + `nodemailerAdapter` over SMTP. **Provider, region, account and credential ownership remain the owner's** | `DECISIONS.md` | review | The *shape* is decided; the provider is explicitly recorded as still open and reduced to five env vars |
| 14 | 🔶 Owner sign-off on OQ-1 (leads destination), OQ-2 (literal recipient address and channel), OQ-3 (is the status pipeline real) (T-009) | `OPEN-QUESTIONS.md` updated; `DECISIONS.md` | review | Either owner answers are recorded, **or** the documented interim behaviour is formally adopted *as interim* |
| 15 | 🔶 Write the OQ-19 two-release transition plan (T-010), naming the release in which the frontend tightens | `DECISIONS.md` | review | Server accepts ≥8 digits; the tightening to 10 is scheduled in the same release as the `ContactForm` edit; rejected submissions will be logged |
| 16 | Resolve the SVG seeding paradox (T-011): rasterise to PNG before seeding (recommended) or define a validated seed bypass | `MEDIA-MANAGEMENT.md` §11 amended | review | One resolution is chosen and written down **before** any seed is authored |
| 17 | Amend D-004 to Payload's session model and close OQ-26 / R-3 (T-005) | `DECISIONS.md` D-004 status ≠ PROPOSED | grep `DECISIONS.md` for `PROPOSED` on D-004 | D-004 names the mechanism: httpOnly JWT cookie + `useSessions: true`, revocation via password change / `resetPassword` / `logout?allSessions=true` |
| 18 | Amend FR-AUTH-04, `SECURITY.md` §1 and `TRACEABILITY.md` §5: replace `argon2id` with a vendor-neutral statement (T-006) | amended docs | `grep -ri argon2 svbackend/docs/` | **Zero hits** |
| 19 | 🔶 Promote **D-012** (ISR + on-demand revalidation) to ACCEPTED, or add an explicit sign-off entry criterion to Phase 7 (T-007) | `DECISIONS.md` | review | D-012 is no longer PROPOSED while simultaneously being a hard deliverable |
| 20 | Amend `AI-CONTEXT.md` "15 core tables / do not add tables" → "15 logical entities; Payload-generated `_rels`/`_v`/`_locales`/array tables are exempt" (T-012) | amended doc | review | The physical table count (~40–60) will not be read as a violation |
| 21 | Correct `TRACEABILITY.md` pre-D-015 residue (T-013): literal admin paths, physical table/column names, `admin_sessions`, `argon2id`, CHECK-constraint cells | amended doc | `grep -i "admin_sessions\|argon2" svbackend/docs/TRACEABILITY.md` | Zero hits |
| 22 | Record that the **ordering mechanism (T-003 / OQ-29) is deferred to step 32**, after the generated schema is measured, with both options costed | `DECISIONS.md` | review | The deferral is explicit and has a named closing step |

**Phase 0 exits when:** every row above is written down. **Nothing else may start.**

### PHASE 1 — The Validation Gate, a throwaway spike (steps 23–49)

*Run by exactly one person. Deleted at step 49. If it fails, nothing of value is lost — that is the point.*

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 23 | Create the spike outside both project directories | a temp directory, e.g. `%TEMP%/sv-spike/` | `ls` | Exists; it is **not** under `svbackend/` or `svfrontend/` |
| 24 | Scaffold (T-020) | `sv-spike/` app | `npx create-payload-app -t blank --use-npm` | The app scaffolds and `npm run dev` serves `/admin` |
| 25 | Pin every version exactly per step 4 | `sv-spike/package.json` | `npm ls next react react-dom payload` | No `^`/`~`; exactly one copy of `react` and `react-dom`; every `@payloadcms/*` on the identical version |
| 26 | Start Postgres 15 in Docker as a **disposable sandbox** | `sv-spike/docker-compose.yml` | `docker compose up -d && docker compose ps` | Container healthy on 5432 |
| 27 | Wire the adapter (T-021): `postgresAdapter({ pool: { connectionString: process.env.DATABASE_URL }, idType: 'uuid', migrationDir: './src/migrations', disableCreateDatabase: false })`; dev `push` left at its default | `sv-spike/src/payload.config.ts` | `npm run dev` | Boots; tables appear |
| 28 | **Media skeleton first** (T-023): `upload: true`, `alt` required, explicit `width`/`height`, `pasteURL: false`, raster-only `mimeTypes` | `sv-spike/src/collections/Media.ts` | `npm run dev` | Collection renders in the admin |
| 29 | The **full** Project collection (T-022), no shortcuts: `description` = `text` + `hasMany: true` + `minRows: 1`; the 4 feature arrays + `stats` + `proximity` as `array` with **explicit `dbName`**; `cta`/`seo` as **named groups**; `icon` as `select` with **explicit `enumName`**; `category`/`projectStatus` as selects; `featured` checkbox; the 5 upload roles; `versions: { drafts: true }` | `sv-spike/src/collections/Projects.ts` | `npm run dev` | 25 fields present in the editor |
| 30 | Generate types and **read them for silent omissions** | `sv-spike/src/payload-types.ts` | `npx payload generate:types` | Every declared field appears. **A missing field means it was sanitized — investigate before proceeding** |
| 31 | ★ **THE MOST IMPORTANT STEP** (T-024) — generate the Drizzle schema and **read the emitted file**, recording: every table and column name produced · how `hasMany` text is stored (child table / `text[]` / JSON) · whether array rows carry `id` and an `_order` column · whether groups flatten into prefixed columns · **the name of the field `orderable: true` creates** · the `createdAt`/`updatedAt` column type · any identifier near Postgres' 63-byte cap | `sv-spike/src/payload-generated.schema.ts`; a written **measured-facts record** | `npx payload generate:db-schema` | The file exists **and the facts are written down**. "It seemed to work" is not a pass |
| 32 | Close T-003 / OQ-29 using the measurements from step 31 | `DECISIONS.md` | review | The ordering mechanism is decided **with the real field name recorded**, and `sort_order` is scheduled for removal from the three documents that name it |
| 33 | Create migration 001 | `sv-spike/src/migrations/*.ts` | `npx payload migrate:create` | A named migration with `up` and `down`, reviewed line by line |
| 34 | Apply it to a **clean** database | — | `npx payload migrate` | Succeeds |
| 35 | Roll it back | — | `npx payload migrate:down` | Succeeds |
| 36 | Re-apply | — | `npx payload migrate` | Succeeds. **Reversibility is proven now, not assumed later** |
| 37 | Prepare seed assets per step 16 (rasterise, or the validated bypass) | `sv-spike/src/seed/assets/*.png` | `ls` | Raster assets exist, or the bypass is implemented and documented |
| 38 | Seed the 5 projects **verbatim**, `[BRACKETED]` values byte-for-byte (T-026) | `sv-spike/src/seed/index.ts` | `npx payload run src/seed/index.ts` | 5 projects exist |
| 39 | Write `put()` and `toPublicProject()` v0 (T-027 / T-052): allow-list, built key-by-key, **never spread the doc**; omit `null`/`""`/`[]`; strip `_status`, `id`, `createdAt`, `updatedAt` and array-row ids; alias `projectStatus` → `status` | `sv-spike/src/serializers/put.ts`, `toPublicProject.ts` | `npm test` | Unit tests pass; **one** documented emptiness rule exists |
| 40 | Expose the endpoint (T-028) with **all three guards**: `overrideAccess: false` **and** a published-only `where` **and** an include-mode `select`, plus `headersWithCors` | `sv-spike/src/app/(public)/api/v1/projects/[slug]/route.ts` | `curl` | 200 for a published slug |
| 41 | Vendor `svfrontend/src/types/content.ts` into the spike and write the contract harness (T-029) | `sv-spike/src/types/frontend-contract.ts`, `sv-spike/tests/contract/` | `npm test` | The harness runs |
| 42 | **GATE #2** — `description` round-trips as `string[]` (T-030) | `tests/contract/description.test.ts` | `npm test -- description` | `Array.isArray` true and every element a `string` at the **Local API** layer; `toEqual(['First paragraph.','Second paragraph.'])` and `not.toHaveProperty('value')` at the **HTTP** layer |
| 43 | **GATE #3** — absent optionals are absent (T-031) | `tests/contract/keyset.test.ts` | `npm test -- keyset` | For a thin project, `k in data === false` (using `in`, not `=== undefined`) for `status, developer, tagline, stats, amenities, approvals, locationHighlights, proximity, area, roadDetails, gallery, layoutImage, locationMap, cta, seo`; exact `Object.keys().sort()` snapshot matches for thin **and** full |
| 44 | **GATE #4** — the response satisfies the real `Project` type | `tests/contract/project.test.ts` | `npm test -- project` | Type assertion and runtime key-set both pass under the frontend's `strict: true`. **No `null` where the type says `T \| undefined`** |
| 45 | **GATE #5** — invalid icon rejected (T-032) | `tests/integration/icon.test.ts` | `npm test -- icon` | `icon: 'notAnIcon'` rejected at the API **and** by a direct SQL insert against the generated Postgres enum type |
| 46 | **GATE #6** — admin editor usable with zero custom components (T-033) | a screenshot, stored with the gate report | manual | 25 fields, 6 repeatable lists and 5 media pickers are all usable. Row labels reading "Item 01" are cosmetic, not a failure |
| 47 | **GATE #7** — seeded records diff clean (T-034) | `tests/contract/seed-fidelity.test.ts` | `npm test -- seed-fidelity` | Field-for-field match against `content/projects.ts`, brackets preserved byte-for-byte |
| 48 | ⛔ **WRITE THE GATE REPORT** (T-035): pass/fail per criterion 1–8, the measured schema facts from step 31, the decisions forced, and an explicit verdict line | `svbackend/docs/PHASE-1-GATE-REPORT.md` | review | The report ends with **"D-015 CONFIRMED"** or **"DIRECTUS FALLBACK TRIGGERED"**. Failure of gate **#1, #2 or #4** voids D-015. Gate #3 failing means the serialiser is wrong — fix it, do not switch stacks. A time-box overrun is recorded as soft evidence, not a trigger |
| 49 | Delete the spike | — | `rm -rf` the temp directory | Gone. **It was a decision artefact, not a codebase** |

### PHASE 2 — Foundation (steps 50–71)

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 50 | Scaffold the real app into a temp directory, then move `docs/` in and commit (T-040) — `create-payload-app`'s behaviour in a non-empty directory is **[UNDOCUMENTED]** | `svbackend/src/`, `svbackend/package.json`, `docs/` preserved | `git -C svbackend log --stat` | The scaffold is one reviewable commit; `docs/` is untouched |
| 51 | `package.json`: exact pins, `engines.node ">=20.9.0"`, and the scripts `dev`, `build`, `start`, `payload` (`cross-env NODE_OPTIONS=--no-deprecation PAYLOAD_CONFIG_PATH=src/payload.config.ts payload`), `generate:types`, `generate:importmap`, `generate:db-schema`, `migrate`, `migrate:status`, `migrate:create`, `migrate:down`, `seed`, `test`, `ci` (T-004 / T-044) | `svbackend/package.json`, `package-lock.json` | `npm ci && npm ls react` | Install clean; exactly one `react`; **`migrate:fresh` and `migrate:reset` appear nowhere** |
| 52 | `next.config.mjs` (ESM) with `withPayload(...)`, `output: 'standalone'`, and a `headers()` block for the security headers (T-043 / T-069) | `svbackend/next.config.mjs` | `npm run build` | `.next/standalone/server.js` is produced |
| 53 | `tsconfig.json` strict, with `paths: { "@payload-config": ["./src/payload.config.ts"] }` | `svbackend/tsconfig.json` | `npx tsc --noEmit` | Clean |
| 54 | Local sandbox and test databases | `svbackend/docker-compose.yml` (Postgres + MinIO), `docker-compose.test.yml` (Postgres on **5433**) | `docker compose up -d && docker compose ps` | Both healthy |
| 55 | The fail-fast env module (T-042) — Zod-parsed, throwing at boot. **Never `process.env.PAYLOAD_SECRET \|\| ''`** | `svbackend/src/schemas/env.ts`, `svbackend/.env.example` | `PAYLOAD_SECRET= npm run dev` | **A named error and the process exits.** Also fails for a secret under 32 characters |
| 56 | `payload.config.ts` baseline (T-041): `db`, `secret: env.PAYLOAD_SECRET`, `serverURL`, `cookiePrefix: 'sv'`, `telemetry: false`, `debug: env.NODE_ENV !== 'production'`, `graphQL: { disable: true }`, `maxDepth: 3`, `defaultDepth: 1`, `defaultMaxTextLength: 20000`, `cors`, `csrf`, `upload` limits, `sharp`, `typescript.outputFile`, `admin.user`, `admin.importMap.baseDir` | `svbackend/src/payload.config.ts` | `npm run dev` | `/admin` serves; `/api/graphql` 404s |
| 57 | Structured logging (T-046): a **pre-instantiated** pino instance passed as `logger`. **Never Pino `transport`** — documented to fail under ESM/bundling | `svbackend/src/lib/logger.ts` | `npm run dev` | JSON lines to stdout in production mode; `pino-pretty` in dev; no "unable to determine transport target" |
| 58 | The error envelope (T-047): the 9 top-level codes, the `details[].code` vocabulary, `requestId`, and a mandatory `try/catch` contract for every public handler | `svbackend/src/lib/errors.ts` | `npm test -- errors` | A deliberately-thrown internal error returns the envelope with a `requestId` and **no** stack trace, SQL, file path or driver string |
| 59 | The `put()` / `omitEmpty()` primitive with **one** documented emptiness rule (T-052) | `svbackend/src/serializers/put.ts` | `npm test -- put` | Unit tests cover `0`, `false`, `""`, `[]`, `null`, `undefined` explicitly |
| 60 | `publicFind()` (T-048), forcing `overrideAccess: false`, `user: undefined`, a published-only `where` and an include-mode `select` | `svbackend/src/lib/publicFind.ts` | `npm test -- publicFind` | All four are applied and **cannot be overridden by the caller** |
| 61 | Cache helpers (T-146 groundwork): `public, max-age=60, stale-while-revalidate=600` + `ETag` | `svbackend/src/lib/cache.ts` | `npm test -- cache` | An identical body yields an identical `ETag` |
| 62 | `definePublicEndpoint()` (T-049), attaching `headersWithCors({ headers: new Headers(), req })`, the cache headers and the error envelope | `svbackend/src/lib/definePublicEndpoint.ts` | `npm test` | Every wrapped handler emits CORS and cache headers |
| 63 | The lint/CI guard-rail rule | `svbackend/.eslintrc` or a CI grep step | `npm run lint` | The build **fails** if `payload.find` or `payload.findByID` appears under `src/app/(public)/**` or `src/endpoints/**` without `publicFind()` |
| 64 | Health and liveness (T-145) — root Route Handlers, **outside `/api`**, `export const dynamic = 'force-dynamic'`; the readiness probe does a trivial `select 1` | `svbackend/src/app/healthz/route.ts`, `src/app/livez/route.ts` | `curl -s localhost:3001/healthz` | `{"status":"ok"}`; `503` with the database stopped; **no version, hostname or database name in the body** |
| 65 | The test harness (T-051): Vitest, a memoised `getPayload({ config })`, `fileParallelism: false`, `pool: 'forks'`, `testTimeout: 30_000` | `svbackend/vitest.config.mts`, `tests/setup.ts` | `npm test` | One trivial assertion passes **and the process exits** — there is no documented `destroy()`, so a hang is a real failure mode |
| 66 | Commit `payload-types.ts` and add the CI drift check (T-045) | `svbackend/src/payload-types.ts`; a CI step | `npm run generate:types && git diff --exit-code src/payload-types.ts` | **No diff** |
| 67 | Migration discipline (T-050): explicit `migrationDir`, the sandbox reset script, and the house rules in the README | `svbackend/scripts/resetSandbox.sh`, `svbackend/README.md` | `grep -r "migrate:fresh\|migrate:reset" svbackend/package.json .github/` | **Zero hits.** The README states: *local dev DB is a disposable sandbox on `push`; every other environment is migrations-only* |
| 68 | A "hello world" public endpoint, fetched **from a browser** on the frontend origin | a temporary route under `src/app/(public)/api/v1/` | browser devtools | Correct `Access-Control-Allow-Origin`, `Cache-Control` and `ETag`. **curl passing is not sufficient** — this is the failure mode that only appears in a browser |
| 69 | The CI composite | — | `npm run ci` (= `payload migrate && npm run build`) | Succeeds against a clean database |
| 70 | Full test run from cold | — | `docker compose -f docker-compose.test.yml up -d && DATABASE_URL=postgres://postgres:test@localhost:5433/sv_test npm test` | Passes and exits |
| 71 | Commit and tag | `git tag phase-2-foundation` | `git -C svbackend tag` | Tag exists |

### PHASE 3 — Security Spine (steps 72–88)

*Until this phase closes, every collection added is a publicly-addressable endpoint.*

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 72 | The four access primitives (T-062) — and **no RBAC scaffolding** | `svbackend/src/access/isAdmin.ts`, `anyone.ts`, `nobody.ts`, `publishedOrAuthenticated.ts` | `npm test -- access` | `publishedOrAuthenticated` returns `true` for a user and `{ _status: { equals: 'published' } }` for anonymous. **Do not use the docs' legacy `_status: { exists: false }` OR-branch** |
| 73 | `Users` collection (T-060) with every `auth` option explicit: `useSessions: true`, `tokenExpiration: 7200`, `maxLoginAttempts: 5`, `lockTime: 900000`, `cookies: { secure: env.NODE_ENV === 'production', sameSite: 'Lax' }`, `forgotPassword.minRequestInterval` | `svbackend/src/collections/Users.ts` | `npm test -- auth` | No option is left implicit — **no documented defaults exist for `tokenExpiration`, `maxLoginAttempts` or `lockTime`** |
| 74 | Password policy ≥12 characters + a breach-list check, by redefining the injected `password` field (T-061) | `svbackend/src/collections/Users.ts` | `npm test -- password` | An 11-character password → 422; a top-1000 breached password → 422. ⚠️ **Attaching `validate` to the injected password field is not shown in the docs — this test is what proves it attaches** |
| 75 | An **explicit `access` block on every collection and every global** (T-063), including `readVersions` on every versioned collection and `admin`/`unlock` on `Users` | every file in `src/collections/`, `src/globals/` | `npm test -- config-access` | A config test enumerates collections and globals and **fails on any missing key**. Payload's default is `Boolean(user)` — *any authenticated user, full CRUD* |
| 76 | Verify GraphQL is off | — | `curl -s -o /dev/null -w "%{http_code}" localhost:3001/api/graphql` and `/api/graphql-playground` | **404** on both |
| 77 | Disable bulk edit, bulk delete and duplicate where not needed; make `payload-jobs` read-only via `jobsCollectionOverrides` (T-066) | `src/payload.config.ts`, collection configs | `npm test -- config-lockdown` | Config assertions pass; `admin.autoLogin` is set in **no** non-dev environment |
| 78 | Specify the reverse-proxy rule blocking `/api/<collection-slug>` paths that are not ours (T-066) — applied at step 214 | `svbackend/docs/RUNBOOK.md` draft; proxy config in the infra repo | review | The rule is written. **There is no documented config kill switch for the generated REST API**, so this layer is load-bearing |
| 79 | `cors` and `csrf` allow-lists from env; register an `options` method on the public routes and test preflight (T-067) | `src/payload.config.ts`, `src/lib/definePublicEndpoint.ts` | browser preflight against an unlisted origin | Unlisted origin receives **no** `Access-Control-Allow-Origin`; preflight behaves (it is **[UNDOCUMENTED]** for custom endpoints, hence the test) |
| 80 | First-admin bootstrap via a **seed script using the Local API** (T-064), never `/create-first-user` | `svbackend/src/seed/index.ts` | on a completely fresh database: `PAYLOAD_SEED=true npm run seed` | An admin exists **with `access.create` already locked down.** The interaction between denied `create` and `/create-first-user` is [UNDOCUMENTED] — this path avoids it entirely |
| 81 | Create **two** admin accounts in every environment (T-208 groundwork) | seed data | `npm test -- two-admins` | ≥2 active admin users. Lockout is per **account**; a sole admin is a trivial self-inflicted DoS |
| 82 | Verify session revocation end to end and record the closure of OQ-26 / R-3 (T-071) | `tests/auth/revocation.test.ts`; `DECISIONS.md` | `npm test -- revocation` | Log in twice; change the password from session A; **session B's cookie is rejected**. `logout?allSessions=true` works. ⚠️ Pass the `user` returned by `payload.auth` — *"a Local API update that runs without an authenticated user … ends all of the user's sessions"* |
| 83 | Lockout behaviour | `tests/auth/lockout.test.ts` | `npm test -- lockout` | 5 failures lock; the account unlocks after `lockTime`; **the failure message is identical** for an unknown email, a wrong password and a locked account |
| 84 | Specify edge rate limits (T-068) with the **build-origin exemption** — applied at step 214 | `svbackend/docs/RUNBOOK.md`; proxy config | review | Limits specified: `/api/v1/leads` 5/min/IP and 3/hour/phone; admin login 5/15min/IP; a public-GET ceiling. Each returns `429` **with `Retry-After`**. The build egress IP is exempt |
| 85 | Security headers in the Next layer (T-069) | `svbackend/next.config.mjs` `headers()` | `curl -I localhost:3001/admin` | HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` on `/admin`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal `Permissions-Policy`, and a CSP on the admin origin |
| 86 | Verify production error verbosity (T-070) | `tests/integration/error-verbosity.test.ts` | `NODE_ENV=production npm test -- error-verbosity` | No stack trace, SQL, file path, driver message or library version in any 5xx body |
| 87 | Authz matrix v1 (T-191 first pass) | `tests/access/matrix.test.ts` | `npm test -- matrix` | Every `/admin/**` route and every generated `/api/<slug>` route returns 401/403 unauthenticated |
| 88 | Commit and tag | `git tag phase-3-security-spine` | `git tag` | Tag exists |

### PHASE 4 — Projects Domain + Media Core (steps 89–124)

*The largest phase. Media first, because Project's upload relations need a target.*

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 89 | `media` collection (T-100) — images only | `svbackend/src/collections/Media.ts` | `npm run dev` | Renders; `mimeTypes` is a raster-only allow-list (**never the docs' `image/*` example**), `allowRestrictedFileTypes: false` |
| 90 | `documents` collection (T-100) — PDF only, a **second** collection because one cannot express two `mimeTypes` allow-lists | `svbackend/src/collections/Documents.ts` | `npm run dev` | Renders |
| 91 | `pasteURL: false` on **both** (T-101) | both collection files | `npm test -- config-upload` | Config test asserts `pasteURL === false`. It is **enabled by default** |
| 92 | Magic-byte sniffing | `svbackend/src/media/sniff.ts` | `npm test -- sniff` | Correctly identifies JPEG, PNG, WebP, AVIF, PDF, SVG and an ELF/PE binary |
| 93 | Dimension extraction | `svbackend/src/media/dimensions.ts` | `npm test -- dimensions` | Returns width/height from `sharp(...).metadata()` on `req.file.data` |
| 94 | The upload guard (T-102), in this exact order: sniff → declared-vs-actual MIME mismatch → **hard SVG rejection** → dimension cap → EXIF-stripping re-encode | `svbackend/src/hooks/uploadGuard.ts` | `npm test -- upload` | Each stage rejects with the right status. SVG is rejected **even though Payload does not restrict it** |
| 95 | UUID storage keys (T-103): rewrite `req.file.name` in `beforeOperation` on **both `create` and `update`**; derive the extension from the **sniffed** type; persist `originalFilename` | `src/hooks/uploadGuard.ts` | `npm test -- upload-rename` | `filename` matches `/^[0-9a-f-]{36}\.jpg$/`; `originalFilename` preserved; a replace does **not** revert to the user-supplied name |
| 96 | Own `width`/`height`/`originalFilename` as explicit fields with field-level `access: { create: () => false, update: () => false }` (T-104) | `src/collections/Media.ts` | `npm test -- media-fields` | Server-populated and not client-settable. **`admin.readOnly` alone is spoofable over the API** |
| 97 | `alt` required, and "required before public attachment" enforced in the serialiser/validate layer (T-105) | `src/collections/Media.ts`, `src/serializers/toImageRef.ts` | `npm test -- alt` | An asset without `alt` cannot be attached to a published project |
| 98 | Exactly one `thumbnail` `imageSize` with `withoutEnlargement: true`, for `adminThumbnail` only (T-106) | `src/collections/Media.ts` | upload a small logo | A thumbnail exists and is **not `null`** — the documented default returns `null` for sources smaller than the target in both dimensions |
| 99 | The upload security suite (T-192 first pass) | `tests/upload/*.test.ts`, `tests/fixtures/{placeholder.svg,svg-renamed.png,exe-renamed.jpg,10001px.png,real-photo.jpg}` | `npm test -- upload` | SVG → 415; SVG renamed `.png` → 415 by magic bytes; `.jpg`-renamed executable → 415; 10 001 px → rejected; EXIF stripped |
| 100 | Port the Project collection from the gate report (T-080) with final `dbName`s, `enumName`s and indexes (`slug` unique, `category`, `featured`, `_status`) | `svbackend/src/collections/Projects.ts` | `npm run generate:db-schema` | No generated identifier is near Postgres' 63-byte cap |
| 101 | The icon single source of truth (T-081) + CI drift check | `svbackend/src/lib/icons.ts`, `src/scripts/checkIconDrift.ts` | `npx tsx src/scripts/checkIconDrift.ts` | **41 camelCase values, zero hyphens**, byte-identical to `svfrontend/src/components/ui/Icon.tsx` |
| 102 | Hand-rolled slug field (T-082) — `text` + `beforeValidate` normaliser + `unique` + `index` + `beforeDuplicate`. **Not** Payload's `slugField()` helper, which is documented as *"experimental and may change, or even be removed"* | `svbackend/src/fields/slugField.ts` | `npm test -- slug` | Normalises to kebab-case; duplicates rejected |
| 103 | Post-publish slug lock (T-083): a `beforeValidate` **collection** hook plus field-level `access.update` | `svbackend/src/hooks/slugLock.ts` | `npm test -- slug-lock` | Changing a published slug is blocked **via the API**, not merely greyed out in the UI |
| 104 | Map a duplicate slug to `409 CONFLICT` with the contract message (T-084) | `src/lib/errors.ts` | `npm test -- slug-conflict` | A friendly `409`, not a raw unique-index error |
| 105 | Versions and drafts (T-085): `versions: { maxPerDoc: 20, drafts: { autosave: false, validate: true, schedulePublish: false } }` | `src/collections/Projects.ts` | `npm test -- versions` | `maxPerDoc` is explicit — the default is **100 per document** |
| 106 | `publishedAt` field + `beforeChange` hook on the `_status` transition (T-086) | `svbackend/src/hooks/publishedAt.ts` | `npm test -- publishedAt` | Set on draft → published; cleared on unpublish. **Payload gives `_status`, not a publish date** |
| 107 | Ordering (T-087) per the step-32 decision, including the reorder shim if `orderable: true` | `src/collections/Projects.ts`, reorder handler | `npm test -- ordering` | The admin can drag-reorder and the public list respects the order |
| 108 | `featured` checkbox and the published-and-featured read path (T-088) | `src/collections/Projects.ts` | `npm test -- featured` | Returns only published featured projects |
| 109 | Trash / archive (T-089): `trash: true`, access filters, `admin.baseFilter` (**`baseFilter`, not `baseListFilter`**) | `src/collections/Projects.ts` | `npm test -- trash` | Archived rows hidden by default; excluded from every public query |
| 110 | Field validation (T-090): all length caps, `description` ≥1 paragraph, **≤50 items per list**, `cta` both-or-neither, `seo` 70/160, control-character rejection, NFC normalisation; gate any DB-touching `validate` on `event === 'submit'` | `src/collections/Projects.ts`, `src/fields/*` | `npm test -- validation` | Every rule in `VALIDATION-RULES.md` has a passing test |
| 111 | `audit-log` collection (T-091) — `create`/`update`/`delete` access all `() => false`; hooks are the only writer | `svbackend/src/collections/AuditLog.ts` | `npm test -- audit-access` | No API path can write to it |
| 112 | The audit hooks and sensitive-field differ (T-091) — on **collections, not endpoints** | `svbackend/src/hooks/audit.ts` | `npm test -- audit` | Every mutation writes a row with actor, IP, action and entity, plus before/after for `approvals`, `area`, `proximity` and title-related fields. **Verified by publishing from the Admin UI, not from an endpoint** |
| 113 | Auth-event hooks → `audit-log` (T-065): `afterLogin`, `afterLogout`, failed login, lockout, password change | `svbackend/src/hooks/authEvents.ts` | `npm test -- auth-audit` | Each event produces a row. **Versions capture none of these** |
| 114 | Admin list and editor config (T-092): `useAsTitle`, `defaultColumns`, `listSearchableFields`, `group`, `pagination`, and `RowLabel` client components for the 6 repeatable lists | `src/collections/Projects.ts`, `src/components/admin/RowLabel*.tsx` | `npm run generate:importmap && npm run dev` | Rows read as titles, not "Item 03". **`generate:importmap` must be in the build** |
| 115 | **MERGE POINT** — the five media roles as upload fields (T-109): `cover` (required, single), `gallery` (`hasMany`, ordered), `layout`, `locationMap`, `brochure` → `documents` (`hasMany`). One reviewed commit, co-owned by the Projects and Media streams | `src/collections/Projects.ts` | `npm test -- media-roles` | Single-valued roles are enforced **by the field type**, not by a partial unique index |
| 116 | `toImageRef()` (T-114) with `depth` **pinned explicitly** on every public query | `svbackend/src/serializers/toImageRef.ts` | `npm test -- imageref` | Emits exactly `{ src, alt, width, height }`. Without a pinned `depth` an upload field returns a bare id string and the serialiser emits a broken image |
| 117 | Production seed data and rasterised assets (T-093) | `svbackend/src/seed/data/projects.ts`, `src/seed/assets/*.png`, `src/seed/rasterise.ts` | `PAYLOAD_SEED=true npm run seed` | 5 projects, `[BRACKETED]` values byte-for-byte |
| 118 | Seed idempotency | `tests/integration/seed.test.ts` | run the seed **twice** | **5 projects, not 10.** Every entity is a slug-based upsert |
| 119 | Create the domain migration (T-094) | `svbackend/src/migrations/*.ts` | `npm run payload migrate:create` | Reviewed line by line before committing |
| 120 | Reversibility in CI | CI job | `npm run payload migrate && npm run payload migrate:down && npm run payload migrate` | All three succeed on a fresh database |
| 121 | Admin workflow test through the Local API | `tests/integration/workflow.test.ts` | `npm test -- workflow` | create → edit → save draft → publish → reorder → unpublish → archive → restore, all pass |
| 122 | The draft-leak test (the highest-severity assertion in the suite) | `tests/access/draft-leak.test.ts` | `npm test -- draft-leak` | A never-published project 404s (**not 403**); it is absent from the list; `?draft=true` cannot surface it; `?where[_status][equals]=draft` returns nothing |
| 123 | Icon enum at the database layer | `tests/database/enum.test.ts` | `npm test -- enum` | The Postgres enum type exists and a direct SQL insert of an invalid value fails |
| 124 | Commit and tag | `git tag phase-4-projects-media` | `git tag` | Tag exists |

### PHASE 5 — Leads & Notifications (steps 125–146)

*Parallel with Phase 4. Start it first if the deadline is tight — it is the only work closing an active, ongoing loss.*

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 125 | `leads` collection (T-120): `name`, `phone`, `phoneNormalised`, `projectSlug` (**soft reference, not an FK**), `message`, `source` (server-assigned), `sourcePath`, `leadStatus` (nullable, control hidden unless OQ-3 confirmed), `consentGiven`, `isRead`, `ipAddress`, `userAgent`. `trash: true`, **no versions** (PII multiplication) | `svbackend/src/collections/Leads.ts` | `npm test -- leads-config` | Every server-assigned field carries field-level `access: { create: () => false, update: () => false }` |
| 126 | Normalisation hooks (T-121) in `beforeValidate` so the validator sees clean values | `svbackend/src/hooks/leadNormalise.ts` | `npm test -- lead-normalise` | Trim + NFC; phone → digits → E.164 `+91`; HTML stripped from `message`; control characters rejected |
| 127 | Validation (T-122) | `src/collections/Leads.ts` | `npm test -- lead-validation` | `name` 1–120; phone **≥8 digits** per step 15, ≤15; junk numbers (`0000000000`, all-same-digit) rejected; `message` ≤2000; unknown `projectSlug` → 422 `UNKNOWN_PROJECT` |
| 128 | Windowed dedupe (T-125) on `(phoneNormalised, projectSlug)` + a supporting **non-unique** compound index. Postgres cannot express a time-windowed partial unique index | `svbackend/src/hooks/leadDedupe.ts` | `npm test -- dedupe` | The window is a **constant in the hook, not an env var** — widening it rejects real enquiries and narrowing it admits spam, so it belongs in a reviewed commit |
| 129 | The request schema (T-123) | `svbackend/src/schemas/lead.ts` | `npm test -- lead-schema` | Unknown properties rejected, with the honeypot field named in the carve-out list; `Content-Type` allow-listed; UTF-8 enforced |
| 130 | `POST /api/v1/leads` (T-123) | `svbackend/src/app/(public)/api/v1/leads/route.ts` | `curl -X POST` | `201` with `{ id, createdAt, message }` and `Cache-Control: no-store`; a client-supplied `source`, `id` or timestamp is ignored |
| 131 | The honeypot | `tests/integration/honeypot.test.ts` | `npm test -- honeypot` | A filled honeypot returns a response **byte-identical** to a success — a `201`, not the `200` one document suggests, because the difference is exactly what a bot uses to detect a honeypot |
| 132 | The `422` field-name contract | `tests/contract/lead-422.test.ts` | `npm test -- lead-422` | `details[].field ∈ { name, phone, project, message }`, matching `ContactForm.tsx`'s `Errors` map **exactly**, so the inline error slots need no redesign |
| 133 | Rate-limit configuration for the lead endpoint (T-124) — applied at the edge in step 214 | proxy config | staged verification | 5/min/IP and 3/hour/phone, each `429` with `Retry-After` |
| 134 | The notification task (T-126): `retries: 3`, input `{ leadId }` **only**, idempotent via a `notifiedAt` marker, `JobCancelledError` for permanently-invalid input | `svbackend/src/jobs/sendLeadNotification.ts` | `npm test -- notification` | Running the same job twice sends **one** email |
| 135 | The enqueue hook (T-127) | `svbackend/src/hooks/enqueueLeadNotification.ts` | `npm test -- enqueue` | `afterChange(create)` enqueues inside `try/catch`. **Never awaits the send; never passes `req`** — an unawaited call carrying `req.transactionID` can return a 201 for a rolled-back write |
| 136 | The email adapter (T-128): `nodemailerAdapter` + SMTP in production; **no-arg (ethereal.email)** in dev/staging | `src/payload.config.ts`, `svbackend/src/email/` | `npm run dev` | Dev prints ethereal preview credentials to the console. This is also the documented satisfier of *"staging must not send real notifications"* |
| 137 | The boot guard (T-128) — refuse to start in production without SMTP configuration **and** `SALES_NOTIFICATION_EMAIL` | `svbackend/src/schemas/env.ts` | `NODE_ENV=production SMTP_HOST= npm run start` | **The process exits with a named error.** Without this, Payload logs a warning and the task reports success having sent nothing |
| 138 | Templates and escaping (T-129) | `svbackend/src/email/renderLeadEmail.ts`, `renderBrandedEmail.ts`, `escapeHtml.ts` | `npm test -- escape` | HTML **and** plaintext alternates; every attacker-controlled field escaped. Payload ships no templating engine and no escaping |
| 139 | The XSS assertion | `tests/jobs/email-escaping.test.ts` | `npm test -- email-escaping` | A lead whose `name` is `<script>alert(1)</script>` renders **escaped** in the admin and in the email |
| 140 | Worker containers (T-130) — `worker-default` (`--cron "* * * * *" --queue default --limit 25`) and `worker-maintenance` (`--cron "*/15 * * * *" --queue maintenance --handle-schedules`), both `restart: unless-stopped`, both **exactly one replica** | `svbackend/docker-compose.yml`, production compose | `docker compose ps` | `--handle-schedules` appears on **one** container only — multiple schedulers queue duplicate jobs |
| 141 | The failed/stuck-job watchdog (T-131) | `svbackend/src/jobs/watchdogFailedJobs.ts` | `npm test -- watchdog` | Detects `hasError: true`, stuck `processing: true`, and aged `completedAt: null`; alerts on a **second channel**; a manual re-queue action exists. **There is no DLQ and no documented backoff** |
| 142 | The provider-outage assertion | `tests/jobs/outage.test.ts` | point SMTP at a black hole and submit a lead | **`201` returned** and a `payload-jobs` row with `hasError: true`. A notification failure must never fail the request |
| 143 | Admin lead screens (T-133) | `src/collections/Leads.ts` admin config | `npm run dev` | Columns, filters, `defaultSort: '-createdAt'`, click-to-call and WhatsApp deep links, **no hard delete**; the `leadStatus` control is **hidden** unless OQ-3 confirmed it |
| 144 | PII retention job (T-134) | `svbackend/src/jobs/purgeLeadPii.ts` | `npm test -- purge` | A 91-day-old lead has `ipAddress` and `userAgent` null. 🔶 **The lead record's own lifetime is undefined in every source document and must be decided by the owner before go-live** |
| 145 | **The lead-leak test** (T-135) | `tests/access/lead-leak.test.ts` | `npm test -- lead-leak` | No public route returns lead data in any shape — all six read endpoints stringified contain neither the canary name nor the canary phone — **including Payload's generated `/api/leads`** |
| 146 | Delete `notification_jobs` from `DATABASE-SCHEMA.md` §15 (T-132); commit and tag | amended doc; `git tag phase-5-leads` | `grep -n notification_jobs svbackend/docs/DATABASE-SCHEMA.md` | Zero hits; tag exists |

### PHASE 6 — Media Hardening (steps 147–156)

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 147 | 🔶 Confirm OQ-18 (public vs gated brochures) **before writing the storage config** — the two answers are mutually exclusive settings on the same collection | `DECISIONS.md` | review | Recorded. Interim: brochures stay public, matching current live behaviour, recorded as *preserving observed behaviour*, not as a business decision |
| 148 | S3 wiring (T-107): `s3Storage({ enabled: Boolean(env.S3_BUCKET), collections: { media: {...}, documents: {...} }, bucket: env.S3_BUCKET, config: { region, credentials, endpoint, forcePathStyle } })`, with `prefix` and `disablePayloadAccessControl: true` for public media. **The plugin is always registered, never conditionally included** | `svbackend/src/media/storage.ts` | `npm run dev` with MinIO | Uploads land in the bucket under the prefix with UUID keys. ⚠️ `endpoint` and `forcePathStyle` are **AWS-SDK pass-throughs Payload's docs never name** |
| 149 | `generateFileURL` rewriting to `CDN_BASE_URL` | `src/media/storage.ts` | `npm test -- file-url` | `ImageRef.src` resolves through the CDN host. ⚠️ The exact `generateFileURL` signature is **not published** — verify against the generated `.d.ts` before relying on destructured argument names |
| 150 | Bucket and CDN policy (T-108) — **not settable from `s3Storage()`** | infra config; `SECURITY.md` amendment recording the split | `curl -I <cdn>/media/<uuid>.jpg` | public-read; `Cache-Control: public, max-age=31536000, immutable`; `X-Content-Type-Options: nosniff`; `Content-Disposition: attachment` for PDFs; served from a **separate origin** |
| 151 | `join` fields per referencing role, for reference counting | `src/collections/Media.ts` | `npm test -- joins` | Each media document exposes its inbound references |
| 152 | The in-use delete guard (T-110) | `svbackend/src/hooks/mediaDeleteGuard.ts` | `npm test -- delete-guard` | Deleting an in-use asset returns **409 listing what uses it**; `disableBulkDelete` is on for `media` |
| 153 | `?force=true` detach semantics, **with an explicit rule on whether a published project may end up coverless** | `src/hooks/mediaDeleteGuard.ts` | `npm test -- force-detach` | Attachment rows are removed, then the asset is deleted; the coverless rule is enforced by a hook, not left to chance |
| 154 | Soft delete + the 30-day sweeper (T-111); retain the **old key** on replace; **never** set `overwriteExistingFiles: true` | `svbackend/src/jobs/sweepDeletedMedia.ts` | `npm test -- sweeper` | A soft-deleted asset disappears from the library immediately and its storage object survives the grace period; a replace writes a **new** key and the document id is unchanged |
| 155 | Orphan detection (T-112) — **DEFERRED** by §27.2; implement the query only if requested. **Never auto-delete** | `src/collections/Media.ts` "unused only" filter | `npm test -- orphans` | If built: returns exactly the assets with no inbound reference |
| 156 | Asset migration (T-113): rasterise and upload the 5 project covers, `master-plan.svg`, `plot-sizes.svg`, `location-thumb.svg` and the deduplicated logo, then attach. **Do not migrate `hero.svg` / `hero-portrait.svg` — the files do not exist.** Commit and tag | `src/seed/assets/`, uploaded media; `git tag phase-6-media` | `npm run dev` and inspect | Every page that referenced a placeholder now resolves to a real raster asset |

### PHASE 8 — Tier-2 Content (steps 157–166)

*Executed before Phase 7 in this linear order, because four read endpoints serialise these collections.*

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 157 | `testimonials` collection with `consented` defaulting to `false` and a `beforeValidate` hook blocking publish without consent (T-160) | `svbackend/src/collections/Testimonials.ts` | `npm test -- consent` | Publishing an unconsented testimonial → `422` with `details[].code = CONSENT_REQUIRED` (**not** a tenth top-level code — the vocabulary stays closed at nine) |
| 158 | The consent **DB CHECK constraint** via a custom migration — one of exactly two CHECKs that survive D-015 | `svbackend/src/migrations/*_testimonial_consent_check.ts` | direct SQL insert of a published unconsented row | **The database rejects it.** A disabled button is not the control |
| 159 | `faqs` collection (T-161) — ordered, published | `svbackend/src/collections/Faqs.ts` | `npm test -- faqs` | Ordering persists |
| 160 | `statistics` collection (T-162) — `label` and `value` both **TEXT** | `svbackend/src/collections/Statistics.ts` | `npm test -- statistics` | Values are authored text; **nothing in the codebase derives them from row counts** |
| 161 | `site-settings` **global** (T-163): brand / contact / social / legal / content; `address` as `text hasMany`; logo upload; `versions: { max: 50, drafts: false }` (note **`max`, not `maxPerDoc`**); and **`access.read: () => true`** | `svbackend/src/globals/SiteSettings.ts` | `npm test -- site-settings` | Every access key is explicit |
| 162 | The unauthenticated-read assertion | `tests/access/site-settings-public.test.ts` | `npm test -- site-settings-public` | Readable **from a logged-out client**. A forgotten access block 403s the public site while looking fine to a logged-in developer |
| 163 | Placeholder-tolerant field (T-164): a value matching `^\[.*\]$` bypasses format checks (URL/email/phone) but still obeys length limits | `svbackend/src/fields/placeholderText.ts` | `npm test -- placeholder` | A `[BRACKETED]` value saves and is returned **verbatim** — never trimmed, nulled or omitted |
| 164 | WhatsApp field: digits only (`^\d{10,15}$`), a live `wa.me` preview, and the "this changes hero behaviour" warning | `src/globals/SiteSettings.ts` | `npm test -- whatsapp` | Rejects `+`, spaces and dashes; preview renders |
| 165 | Icon validation inside `social[]` (T-167) | `src/globals/SiteSettings.ts` | `npm test -- social-icons` | Every `icon` validates against the 41-value enum |
| 166 | Commit and tag | `git tag phase-8-tier2` | `git tag` | Tag exists |

### PHASE 7 — Public API Surface & Revalidation (steps 167–180)

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 167 | `GET /api/v1/projects` (T-140) — card fields only, published, in admin order, `category?` and `featured?` filters, **no pagination/search/sort** | `svbackend/src/app/(public)/api/v1/projects/route.ts`, `src/serializers/toPublicProjectCard.ts` | `curl` | Only published projects, in admin order |
| 168 | `GET /api/v1/projects/{slug}` — the production version of the spiked endpoint | `.../projects/[slug]/route.ts`, `src/serializers/toPublicProject.ts` | `curl` | Full record; unpublished or archived → **404, not 403** |
| 169 | `GET /api/v1/site-settings` (T-141) + `toPublicSiteSettings()` computing `copyrightText` | `.../site-settings/route.ts`, `src/serializers/toPublicSiteSettings.ts` | `npm test -- site-settings-endpoint` | Never emits `updatedBy` or any internal id; `[YEAR]` is **computed, not stored mid-string** |
| 170 | `GET /api/v1/testimonials` (T-142) | `.../testimonials/route.ts` | `npm test -- testimonials-endpoint` | Returns **published AND consented** records only |
| 171 | `GET /api/v1/faqs` (T-143) | `.../faqs/route.ts` | `curl` | Ordered, published |
| 172 | `GET /api/v1/statistics` (T-144) | `.../statistics/route.ts` | `curl` | Ordered; text values |
| 173 | Cache semantics (T-146) | `src/lib/cache.ts` applied via `definePublicEndpoint` | `curl -I` then re-request with `If-None-Match` | `public, max-age=60, stale-while-revalidate=600` + a working `ETag`; a **304** on re-request; `no-store` on `POST /leads` |
| 174 | The 404-not-403 assertion | `tests/access/not-found.test.ts` | `npm test -- not-found` | Unpublished and archived content returns the `NOT_FOUND` envelope with 404 — *"a 403 confirms it exists"* |
| 175 | The revalidation hook (T-147) — `afterChange`/`afterDelete` **collection hooks**, never endpoint logic | `svbackend/src/hooks/revalidate.ts` | `npm test -- revalidate` | Naming `/`, `/projects`, `/projects/{slug}`, `/sitemap.xml` on a project change, and a **revalidate-all path** on a `site-settings` change. **Fire-and-forget: a revalidation failure must never fail the admin's save** — the admin sees *"Saved. The website may take a few minutes to update."* |
| 176 | The retry job behind the hook | `svbackend/src/jobs/revalidatePaths.ts` | `npm test -- revalidate-job` | Enqueued on a direct-fetch failure |
| 177 | Contract tests for **all 6 read endpoints** in CI (T-148) | `svbackend/tests/contract/*.test.ts`; `src/types/frontend-contract.ts`; `src/scripts/checkContractDrift.ts` | `npm run test:contract` and `npx tsx src/scripts/checkContractDrift.ts` | Every response satisfies `types/content.ts` field-for-field; the vendored copy is byte-identical to the frontend file |
| 178 | Key-set snapshots per endpoint, thin and full (T-149) | `tests/contract/keyset.*.test.ts` | `npm run test:contract` | A newly-added internal field causes a **test failure**, not a silent leak. **This, not the type test, is what defends D-008 over time** |
| 179 | The public-surface leak assertions | `tests/contract/no-internal-fields.test.ts` | `npm test -- no-internal-fields` | No admin field, no lead data, no `_status`, no `createdBy`/`updatedBy`, no `publishedAt`, no `deletedAt`, no array-row id, no order key, no `hasPlaceholders`, and no Payload `{docs, totalDocs, …}` envelope appears in any public response |
| 180 | Commit and tag | `git tag phase-7-public-api` | `git tag` | Tag exists |

### PHASE 9 — Frontend Integration (steps 181–200) 🛑

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 181 | 🛑 **HUMAN APPROVAL GATE (T-170).** **Current instructions forbid creating, editing or deleting any file under `svfrontend/`.** No step from 182 onward may run until an explicit human approval is recorded. Phase 7 must also be **complete and stable** | a recorded approval in `DECISIONS.md` | review | **Explicit approval exists.** Without it, stop here — the backend is complete and usable, and the frontend continues to serve its current static build |
| 182 | Branch `svfrontend` and add its first-ever environment file | `svfrontend/.env.local` with `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, `REVALIDATE_SECRET`, `NEXT_PUBLIC_ALLOW_INDEXING` | `git -C svfrontend status` | A branch exists; the repo previously had **zero** env vars |
| 183 | Create the data layer returning **the existing static arrays**, typed exactly as today (§19.6 step 1) | `svfrontend/src/lib/api/projects.ts`, `site.ts`, `content.ts` | `npm run build` | Byte-identical output. Pure refactor, zero behaviour change |
| 184 | Convert consumers to `await`; convert the 7 `export const metadata` constants to `export async function generateMetadata()`; make `sitemap`, `generateStaticParams` and the pages `async` | the 7 static pages, `app/sitemap.ts`, `app/projects/[slug]/page.tsx` | `npx tsc --noEmit && npm run build` | All routes still prerender |
| 185 | Lift `ContactForm`'s `projects` import to a **prop** from `app/contact/page.tsx` — a `'use client'` module cannot import server-fetched data | `svfrontend/src/components/sections/ContactForm.tsx`, `src/app/contact/page.tsx` | `npm run build` | Identical output; the client-boundary violation is gone |
| 186 | **Bugfix:** add `mailHref()` — `` `mailto:${site.email}` `` puts the bracket *inside* the string, so `isPlaceholder()` returns false and **a live `mailto:[EMAIL@DOMAIN]` ships on every page today** | `svfrontend/src/lib/href.ts`; `Footer.tsx`, `contact/page.tsx` | `npm test` / assertion | The inert-link guard now covers `mailto:` |
| 187 | **Bugfix:** `/contact`'s WhatsApp `href` is the **raw digit string**, inert only by accident; the moment it holds a real number it becomes a relative link to `/919XXXXXXXXX` → 404. Fix to `` `https://wa.me/${site.whatsapp}` `` | `svfrontend/src/app/contact/page.tsx` | assertion | Absolute `wa.me` URL, matching the correct construction already in `EnquiryPill.tsx` |
| 188 | 🔴 Add `images.remotePatterns` for the CDN host, the bucket host, and the Payload host if media is proxied; keep `pathname` tight. Extend `qualities` if a CMS image needs a third value (T-176) | `svfrontend/next.config.mjs` | `npm run build` with a remote image | **No `Invalid src prop … hostname is not configured`.** Without this, six `next/image` call sites throw the instant URLs become remote |
| 189 | The revalidate route — the repo has **no `route.ts` anywhere** today (T-175) | `svfrontend/src/app/api/revalidate/route.ts` | `curl -X POST` with and without the secret | Verifies `REVALIDATE_SECRET` and calls `revalidateTag`/`revalidatePath`; a wrong secret → 401 |
| 190 | Add a root error boundary. **`loading.tsx` is deliberately not added** — pages are static, and a loading skeleton on a prerendered page is a visual regression | `svfrontend/src/app/error.tsx` | manual | A thrown error renders the boundary |
| 191 | **The one risky step:** swap the data-layer source from static arrays to `fetch` against the public API, with `next: { revalidate: 3600, tags: [...] }` (T-171) | `svfrontend/src/lib/api/*` | `npm run build && npx tsc --noEmit` | Types, call sites and rendered output unchanged. **Rollback is `git revert` of this one commit** |
| 192 | `generateStaticParams()` sourced from `GET /projects`; `dynamicParams` left at its default `true` (T-172) | `svfrontend/src/app/projects/[slug]/page.tsx` | `npm run build` | The prerender manifest lists every published slug |
| 193 | Derive nav and footer project children from published projects (T-173) — today they are **5 hardcoded slugs** at `site.ts:41-49` and `:78-86`, and `README.md:42`'s claim that they are automatic is factually wrong | `svfrontend/src/content/site.ts` | add a 6th project in the CMS and rebuild | It appears in the nav dropdown and the footer column with **no hand-edited slug list anywhere** |
| 194 | `sitemap.ts` becomes `async` and adds `lastModified` from `publishedAt` | `svfrontend/src/app/sitemap.ts` | `curl /sitemap.xml` | Every published project has a `lastmod` |
| 195 | Env-gate **both** indexing blocks — `robots.ts`'s `disallow: '/'` **and** `layout.tsx:53`'s `robots: { index: false }` | `svfrontend/src/app/robots.ts`, `src/app/layout.tsx` | toggle `NEXT_PUBLIC_ALLOW_INDEXING` | Both lift together. **Lifting only one leaves the site unindexed with a non-obvious cause** |
| 196 | Wire `ContactForm` to `POST /api/v1/leads` (T-174): pending state, double-submit guard, and the `Errors` type widened from `'name' \| 'phone'` to include `'project' \| 'message'` | `svfrontend/src/components/sections/ContactForm.tsx` | manual + assertion | Success **only** on a real `201`; a `422` renders inline in the **existing** slots with no redesign; a `500` shows a failure state and a request id |
| 197 | 🔶 Tighten the phone rule to 10 digits **in this same release** as the backend (T-178 / T-010) | `ContactForm.tsx`, backend validation | `npm test` both repos | Both sides enforce the same threshold in one release. Shipping them apart is the silent lead-loss regression |
| 198 | Fix the three count-coupled strings — "Five layouts." ×2 and "Aler · Bhongir · Genome Valley" (T-177) | `app/page.tsx:66`, `app/projects/page.tsx:19-21`, `Hero.tsx:105` | grep | No hardcoded project count remains. Publishing a sixth project can no longer make the site lie |
| 199 | Prune dead content keys (T-181): `media.hero`, `media.heroPortrait`, `home.benefits`, `home.hero.lead/primaryCta/secondaryCta`, `location.intro.title/.lead` — all zero-consumer, and the first two point at files that do not exist | `svfrontend/src/content/pages.ts` | `npx tsc --noEmit && npm run build` | Clean. **`src/types/content.ts` is untouched — it is the contract** |
| 200 | **The acceptance gate (T-182).** Measure, do not assume | measurements recorded in `svbackend/docs/` | `npm run build`, Lighthouse, manual 320–1920 px sweep | All routes still prerender (`.next/prerender-manifest.json` lists the same set plus any new project) · **LCP < 2.5 s** · **CLS < 0.05** · First Load JS within **102–114 kB** · `tsc --noEmit` clean under TS 5.9 strict · **no horizontal overflow at any width from 320 px to 1920 px** · publishing an edit appears without a redeploy · `[BRACKETED]` values still render inert |

### PHASE 10 — Hardening & Verification (steps 201–212)

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 201 | The full authz matrix (T-191) | `svbackend/tests/access/*.test.ts` | `npm test -- access` | Every admin route unauthenticated → 401; anonymous cannot read leads; anonymous cannot retrieve any project with `_status !== 'published'`; **`?draft=true` cannot surface a draft**; `?where[_status][equals]=draft` returns nothing; `readVersions` is covered |
| 202 | The upload security suite, complete (T-192) | `svbackend/tests/upload/*.test.ts` | `npm test -- upload` | SVG rejected; `.jpg`-renamed executable rejected by magic bytes; oversize → 413; a 10 001 px decompression bomb rejected; EXIF stripped; UUID keys |
| 203 | Rate-limit verification against staging (T-193) — not unit-testable; it is proxy configuration | evidence recorded in `svbackend/docs/` | manual against staging | 6 lead submissions in one minute from one IP → the 6th is `429` **with `Retry-After`**; 4 from one phone in an hour → the 4th `429`; 6 failed logins in 15 minutes → `429`; **a full `next build` of svfrontend completes with zero `429`s** |
| 204 | Load test (T-194) | k6 or autocannon scenario | run against staging | `POST /api/v1/leads` **< 500 ms p95** (NFR-01) |
| 205 | Dependency audit (T-195) | — | `npm ls react && npm audit --audit-level=high` | Exactly one copy of `react`/`react-dom`; every `payload` and `@payloadcms/*` version identical and exact; no high-severity advisories |
| 206 | Measure `versions.maxPerDoc` pruning behaviour (T-197) — the mechanism (sync / batched / background) is **[UNDOCUMENTED]** | a recorded measurement | `npm test -- version-growth` | Pruning behaviour is measured and recorded, and the database is sized accordingly |
| 207 | Configure backups (T-196): nightly `pg_dump -Fc` or managed PITR, S3 bucket versioning + lifecycle, and a **mandatory pre-migration backup step** | infra config; `RUNBOOK.md` | `docker run --rm postgres:15 pg_dump -Fc ...` | A dump is produced (`psql` is not on PATH — all client tooling goes through Docker) |
| 208 | **PERFORM A RESTORE** into a scratch environment and bring the site up from it (T-196) | a recorded restore log | restore, then `curl /healthz` and load a project page | **NFR-10 is not satisfied by having backups; it is satisfied by having restored one.** Media reconciliation is reasoned about explicitly: post-restore-point uploads are harmless orphans; post-restore-point deletions are broken images recoverable from bucket versioning |
| 209 | Re-verify production error verbosity on the real build | — | `NODE_ENV=production` smoke of a 5xx | No stack trace, SQL, file path, driver string or library version |
| 210 | Execute the **22-item pre-production security checklist** (§15.3) with **evidence recorded per item** (T-190) | `svbackend/docs/SECURITY-CHECKLIST-EVIDENCE.md` | review | Every item has evidence. **A tick is not evidence** |
| 211 | 🔶 **Publish and link the privacy policy** (T-198 / OQ-24) — the largest compliance gap in the project | a live privacy page; the URL configured in `site-settings` | `curl <privacy-url>` | The page resolves, names every sub-processor (email provider, storage provider), and is linked from `formNote`. **`POST /api/v1/leads` must not be reachable in production until this is true** |
| 212 | Commit and tag | `git tag phase-10-hardened` | `git tag` | Tag exists |

### PHASE 11 — Production Deployment & Go-Live (steps 213–233)

*Steps 213–216 may be pulled forward and executed during Phase 1; T-130 and T-196 require them.*

| # | Action | Artefacts | Verify | Pass |
|---|---|---|---|---|
| 213 | 🔶 Provision: container host and region (audience is Indian — keep app and database in the same region), managed Postgres 15+ with TLS and PITR, an S3-compatible bucket, a CDN, DNS for `www` / `cms` / `media`, TLS certificates (T-200) | infra | `dig`, `curl -I` | All three hostnames resolve over TLS. **`cms` is a subdomain of the public registrable domain** so `SameSite=Lax` holds |
| 214 | Reverse proxy: TLS termination, HTTP→HTTPS redirect, HSTS, the security headers, the rate limits from step 84 **with the build-origin exemption**, and the `/api/<collection-slug>` block rule from step 78 | proxy config | `curl -I http://cms.<domain>` | 301 to HTTPS; `Strict-Transport-Security` present; `curl https://cms.<domain>/api/leads` from the public internet is blocked |
| 215 | Secrets into the platform store (T-201), **distinct per environment**; `PAYLOAD_SECRET` ≥32 bytes generated with `openssl rand -hex 32` | platform secret store | `git log -p -- '*.env*'` | Nothing returned. No `.env` is committed in either repo |
| 216 | Database roles: the running app role has **no DDL**; a separate migrate role **has DDL**. `disableCreateDatabase: true` | database grants | attempt `DROP TABLE` as the app role | **Denied.** The migrate job succeeds |
| 217 | Baseline `pg_dump` of the empty database — it proves the tooling works before it is needed | a dump artefact | `docker run --rm postgres:15 pg_dump -Fc "$DATABASE_URL" > baseline.dump` | A non-empty dump file |
| 218 | Migrations as a **separate pre-deploy job**, never inside N replicas' start-up | CI pipeline | `npm run payload migrate:status` then `npm run payload migrate` | `migrate:status` is the read-only gate; `migrate` succeeds. A failure **rejects the deploy** |
| 219 | Build and push the image; `generate:importmap` runs **inside** the build, before `next build` (T-202) | container image | CI log | The import map is regenerated in the build — *"it never regenerates during normal runtime or after production builds"*, so a stale map is a **production-only** crash |
| 220 | Deploy the `cms` container | running container | `curl -s https://cms.<domain>/healthz` | `{"status":"ok"}` |
| 221 | Run the one-time production seed | seeded data | `PAYLOAD_SEED=true npm run seed` | 2 admins, `site-settings`, 5 projects and the migrated media assets exist. **Then unset `PAYLOAD_SEED`** — its absence *is* the guard |
| 222 | Rotate the seeded admin passwords (T-208) | — | attempt login with the seeded credentials | **Fails.** Two admin accounts exist, one per real person; no default credentials remain |
| 223 | Deploy `worker-default` and `worker-maintenance`, each **one replica**, `restart: unless-stopped` (T-130) | running containers | `docker compose ps` | Both up; `--handle-schedules` on **one** only. **Both must be restarted after every deploy** so they run the new code |
| 224 | Upload one real image **in the production container** (T-207) | a media document | manual upload | Succeeds. **This is the only reliable detector for the sharp native-binary failure** — build green and first upload throwing is the classic containerised failure, and Payload documents nothing about it |
| 225 | Point `svfrontend` at `NEXT_PUBLIC_API_BASE_URL`; build and deploy the frontend | frontend deploy | `npm run build` in `svfrontend` | Build succeeds and every route prerenders with real CMS data |
| 226 | Verify revalidation end to end | — | publish a change in the admin, then reload the public page | The change appears **without a redeploy**. A revalidation failure produces a warning toast, **not** a failed save |
| 227 | Monitoring and alerts (T-204) — error rate, lead-submission failure rate, queue depth, oldest-pending-job age, **worker liveness**, health probe, DB connections, disk. **Three day-one alarms**, each corresponding to an otherwise-silent failure | alerting config | trigger each | (1) the worker is dead; (2) a `sendLeadNotification` job has `hasError: true`; (3) `/healthz` has been 503 for more than one interval. **Anything email-related alerts on a second channel** — the failure being detected may be that email is broken |
| 228 | Publish the runbook (T-205): deploy, rollback (additive vs destructive), restore from backup, revoke a session, re-send a failed notification, rotate secrets, reset the sandbox | `svbackend/docs/RUNBOOK.md` | review | Every procedure is written, including the verbatim additive-vs-destructive migration distinction |
| 229 | **Write and rehearse the `PAYLOAD_SECRET` rotation runbook in staging**, while nothing depends on API keys (T-201) | `RUNBOOK.md` section | execute it once in staging | It names **"regenerate all API keys"** as a mandatory step and **has been executed**. A rotation runbook that has never been executed is not a control |
| 230 | 🔶 **Owner deliverables land in `site-settings`:** the company name (OQ-6), every `[BRACKETED]` value (OQ-22), and real consented testimonials or the section's deletion (OQ-23) | admin edits | `grep` the public API responses for `\[` and for `example.com` | No unresolved bracketed value and **no `example.com`** remains in any public response. `site.url` is the one *unbracketed* placeholder and evades the inert-link guard entirely — it must be caught explicitly |
| 231 | Lift **both** indexing blocks — `robots.ts`'s `disallow: '/'` **and** `layout.tsx`'s `robots: { index: false }` | `NEXT_PUBLIC_ALLOW_INDEXING=true`, redeploy | `curl https://www.<domain>/robots.txt` and view source | Neither block remains. **This is the single most consequential launch action and it appears on no inherited checklist** |
| 232 | **GO-LIVE SMOKE (T-206)** | recorded evidence | execute | A **synthetic lead flows end to end including the notification landing in the sales inbox** · an admin logs in, edits a project, publishes, and the change is visible on the public site · alerts fire on a simulated failure: **kill the worker, break SMTP, stop the database** — each produces an alert |
| 233 | Post-go-live: confirm the backup schedule is running, the PII purge job is scheduled, and the restore runbook has been executed at least once | monitoring dashboards | review | All three green. **The project is not finished until §31's overall Definition of Done is fully checked** |

---

## 30. Acceptance Criteria

Every criterion is a **command**, a **named test**, or an **observable behaviour**. None is "it works".

### 30.1 Public API contract

| # | Criterion | How it is verified |
|---|---|---|
| A-1 | All 8 public routes exist at the agreed paths, with `/healthz` **outside** `/api/v1` | `curl` each of `/api/v1/projects`, `/api/v1/projects/{slug}`, `/api/v1/site-settings`, `/api/v1/testimonials`, `/api/v1/faqs`, `/api/v1/statistics`, `POST /api/v1/leads`, `GET /healthz` |
| A-2 | Every read response satisfies `svfrontend/src/types/content.ts` field-for-field | `npm run test:contract` — 6 endpoints × 2 shapes, **in CI** |
| A-3 | `description` is a flat `string[]` at both the Local-API and HTTP layers | `npm test -- description` |
| A-4 | Absent optional fields are **absent** — not `null`, not `""`, not `[]` | `npm test -- keyset`; assertions use `k in data === false`, never `=== undefined` |
| A-5 | A newly-added internal field causes a **test failure**, not a silent leak | add a field, run `npm run test:contract` → the key-set snapshot fails |
| A-6 | No admin field, no lead data, no `_status`, no `createdBy`/`updatedBy`, no `publishedAt`, no `deletedAt`, no array-row id, no order key, no `hasPlaceholders`, no Payload envelope in any public response | `npm test -- no-internal-fields` |
| A-7 | An unpublished or archived project returns **404, not 403** | `npm test -- not-found` |
| A-8 | `?draft=true` cannot surface a draft; `?where[_status][equals]=draft` returns nothing | `npm test -- draft-leak` |
| A-9 | `/testimonials` returns only published **and consented** records | `npm test -- testimonials-endpoint` |
| A-10 | Public GETs carry `public, max-age=60, stale-while-revalidate=600` and a working `ETag` | `curl -I`, then re-request with `If-None-Match` → **304** |
| A-11 | `POST /api/v1/leads` carries `Cache-Control: no-store` | `curl -i -X POST` |
| A-12 | `[BRACKETED]` values round-trip **byte-for-byte** and are never trimmed, nulled or omitted | `npm test -- placeholder` |
| A-13 | `statistics` values are authored TEXT and nothing derives them from row counts | `npm test -- statistics` + grep for any `count()` feeding them |
| A-14 | `/healthz` returns `{"status":"ok"}` when the database is up and 503 when it is down, and leaks no version, hostname or database name | `curl -s /healthz`; stop the database and re-curl |
| A-15 | CORS works **from a browser** on the frontend origin, not only in curl | browser devtools against `https://www.<domain>` |
| A-16 | A deliberately-thrown internal error returns the documented envelope with a `requestId` and no stack trace, SQL, file path or driver string | `npm test -- error-verbosity` |

### 30.2 Admin CMS

| # | Criterion | How it is verified |
|---|---|---|
| B-1 | The project editor renders 25 fields, 6 repeatable lists and 5 media pickers usably with **zero custom components** | manual, screenshotted at the Phase-1 gate and re-checked in Phase 4 |
| B-2 | create → edit → save draft → publish → reorder → unpublish → archive → restore works end to end | `npm test -- workflow` (Local API — the same access control and hooks the UI calls) plus one manual pass |
| B-3 | A duplicate slug returns `409` with the contract message | `npm test -- slug-conflict` |
| B-4 | Changing a published slug is blocked **via the API**, not merely greyed out | `npm test -- slug-lock` |
| B-5 | `publishedAt` is set on draft → published and cleared on unpublish | `npm test -- publishedAt` |
| B-6 | Ordering persists and the public list respects it | `npm test -- ordering` + a manual drag in the admin |
| B-7 | Archived rows are hidden by default in the admin list | manual; `admin.baseFilter` is set |
| B-8 | An unconsented testimonial cannot be published — via the UI, via the API, **and at the database** | `npm test -- consent` plus a direct SQL insert that the CHECK constraint rejects |
| B-9 | `site-settings` is readable unauthenticated | `npm test -- site-settings-public` — from a logged-out client, because this failure is invisible to a logged-in developer |
| B-10 | A `[BRACKETED]` value saves successfully with format validation bypassed and length limits still enforced | `npm test -- placeholder` |
| B-11 | The WhatsApp field rejects `+`, spaces and dashes and shows a live `wa.me` preview | `npm test -- whatsapp` + manual |
| B-12 | Every `icon` inside `social[]` validates against the 41-value enum | `npm test -- social-icons` |
| B-13 | The `leadStatus` control ships **hidden** unless OQ-3 confirmed it | config review + `npm test -- leads-config` |
| B-14 | The admin panel never exposes a hard delete on `leads` | config test; `disableBulkDelete` and trash-only deletion |
| B-15 | Publishing an edit from the admin makes it appear on the public site without a redeploy | manual, at step 226 |

### 30.3 Authentication and security

| # | Criterion | How it is verified |
|---|---|---|
| C-1 | No `/admin/**` route and no generated `/api/<slug>` route is reachable unauthenticated | `npm test -- matrix` |
| C-2 | `GET /api/graphql` and `/api/graphql-playground` return **404** | `curl -o /dev/null -w "%{http_code}"` |
| C-3 | An **explicit `access` block exists on 100 %** of collections and globals, including `readVersions` | `npm test -- config-access` — a config test that enumerates them and fails on any missing key |
| C-4 | Login lockout triggers after 5 failures and expires after `lockTime`, with an **identical failure message** for an unknown email, a wrong password and a locked account | `npm test -- lockout` |
| C-5 | A password change invalidates the user's other sessions, and `logout?allSessions=true` works | `npm test -- revocation` — this is the formal closure of OQ-26 / R-3 |
| C-6 | An 11-character password and a top-1000 breached password are both rejected | `npm test -- password` |
| C-7 | Booting with `PAYLOAD_SECRET` unset, empty or under 32 characters **fails fast with a named error** | `PAYLOAD_SECRET= npm run dev` |
| C-8 | Rate limits fire and return `429` with `Retry-After` on `/api/v1/leads` and the admin login route | manual against staging, evidence recorded |
| C-9 | A full `next build` of `svfrontend` completes with **zero `429`s** | run the build from the build origin |
| C-10 | Security headers are present on a real response from both the admin origin and the media origin | `curl -I https://cms.<domain>/admin` and `curl -I https://media.<domain>/…` |
| C-11 | Production `Set-Cookie` shows `HttpOnly; Secure; SameSite=Lax; Path=/` | `curl -i` a login response in production |
| C-12 | A request from an unlisted origin receives no `Access-Control-Allow-Origin` | browser fetch from an unlisted origin |
| C-13 | Every server-assigned field carries field-level `access.create/update: () => false`, not merely `admin.readOnly` | `npm test -- field-access`; POST a lead with `"source":"whatsapp"` → the stored value is `contact_form` |
| C-14 | `curl /api/leads` anonymously returns 401/403/empty **and** the proxy blocks it from the public internet | `npm test -- lead-leak` plus a curl from outside |
| C-15 | The 22-item pre-production checklist passes **with evidence per item** | `svbackend/docs/SECURITY-CHECKLIST-EVIDENCE.md` |
| C-16 | Two active admin accounts exist in every environment and no seeded credentials remain | `npm test -- two-admins`; attempt a seeded login → fails |
| C-17 | The `PAYLOAD_SECRET` rotation runbook exists, names "regenerate all API keys", and **has been executed once in staging** | the runbook plus a recorded execution |

### 30.4 Media

| # | Criterion | How it is verified |
|---|---|---|
| D-1 | SVG is rejected; an SVG renamed `.png` is rejected by magic bytes; a `.jpg`-renamed executable is rejected | `npm test -- upload` |
| D-2 | A 10 001 px image is rejected; a 26 MB PDF returns `413`; an oversize image returns a 4xx with a size message | `npm test -- upload` (the image case is documented as a 4xx, not a 413 — `limits.fileSize` is a single application-wide value) |
| D-3 | Uploaded files carry **UUID storage keys** and a preserved `originalFilename`, and EXIF is stripped | `npm test -- upload-rename`; `filename` matches `/^[0-9a-f-]{36}\.jpg$/` |
| D-4 | `width` and `height` are server-extracted and not client-settable | `npm test -- media-fields` |
| D-5 | `pasteURL === false` on **both** upload collections | `npm test -- config-upload` |
| D-6 | `toPublicProject()` emits a valid `ImageRef` (`src`, `alt`, `width`, `height`) with `depth` pinned | `npm test -- imageref` |
| D-7 | Deleting an in-use asset returns **409 listing what uses it**; `?force=true` detaches then deletes and enforces the coverless rule | `npm test -- delete-guard`, `npm test -- force-detach` |
| D-8 | A soft-deleted asset disappears from the library immediately and its storage object survives the grace period | `npm test -- sweeper` |
| D-9 | Replacing a file writes a **new** key, the document id is unchanged, every attachment still resolves, and the old key is retained | `npm test -- sweeper` |
| D-10 | Media responses carry `Cache-Control: public, max-age=31536000, immutable` and `nosniff`; PDFs carry `Content-Disposition: attachment` | `curl -I <cdn>/media/<uuid>.jpg` |
| D-11 | A real image upload succeeds **in the production container** | manual, step 224 — the only reliable sharp native-binary check |
| D-12 | `next/image` renders an uploaded asset with no `Invalid src prop` error | `npm run build` in `svfrontend` after `remotePatterns` is added |

### 30.5 Leads

| # | Criterion | How it is verified |
|---|---|---|
| E-1 | `POST /api/v1/leads` returns `201` with `{ id, createdAt, message }` | `curl -i -X POST` |
| E-2 | A `422` carries `details[].field ∈ { name, phone, project, message }`, matching `ContactForm.tsx`'s `Errors` map exactly | `npm test -- lead-422` |
| E-3 | An unknown `projectSlug` is rejected; a client-supplied `source`, `id` or timestamp is ignored | `npm test -- lead-validation` |
| E-4 | A filled honeypot returns a response **byte-identical** to a success | `npm test -- honeypot` |
| E-5 | Rate limits trigger at 5/min/IP and 3/hour/phone | manual against staging |
| E-6 | A notification-provider outage does **not** fail the request | point SMTP at a black hole → `201` plus a `payload-jobs` row with `hasError: true` |
| E-7 | The application **refuses to boot in production** with no email adapter or no `SALES_NOTIFICATION_EMAIL` | `NODE_ENV=production SMTP_HOST= npm run start` → named error, process exits |
| E-8 | The notification job is idempotent — running it twice sends **one** email | `npm test -- notification` |
| E-9 | A lead `name` or `message` containing `<script>` renders **escaped** in the admin and in the email | `npm test -- email-escaping` |
| E-10 | **No public route returns lead data in any shape**, including Payload's generated `/api/leads` | `npm test -- lead-leak` |
| E-11 | The worker runs as a separate process with a restart policy, and killing it raises an alert within the monitoring interval | kill the container, watch the alarm |
| E-12 | `ipAddress` and `userAgent` are purged on schedule | `npm test -- purge`; a 91-day-old lead has both null |
| E-13 | `POST /api/v1/leads` is **< 500 ms p95** under load | k6 / autocannon against staging (NFR-01) |
| E-14 | A synthetic lead flows end to end **including the notification landing in the sales inbox** | manual, step 232 |

### 30.6 Data integrity

| # | Criterion | How it is verified |
|---|---|---|
| F-1 | Migrations apply and roll back cleanly on a fresh database | `npm run payload migrate && npm run payload migrate:down && npm run payload migrate` in CI |
| F-2 | `npm run generate:types` produces **no diff** against the committed `payload-types.ts` | `git diff --exit-code src/payload-types.ts` in CI |
| F-3 | The seed is idempotent — running it twice produces **5 projects, not 10** | run it twice, count |
| F-4 | Seeded records match `content/projects.ts` field-for-field with brackets preserved | `npm test -- seed-fidelity` |
| F-5 | An invalid `icon` is rejected at the API **and** by the Postgres enum | `npm test -- icon` plus a direct SQL insert |
| F-6 | Every mutation writes an audit row with actor, IP, action, entity, and before/after for `approvals`, `area`, `proximity` and title-related fields | `npm test -- audit`, **verified by publishing from the Admin UI, not from an endpoint** |
| F-7 | Auth events — login, logout, failed login, lockout, password change — each produce an audit row | `npm test -- auth-audit` |
| F-8 | The `audit-log` collection cannot be written through any API path | `npm test -- audit-access` |
| F-9 | `migrate:fresh` and `migrate:reset` appear in **no** script, CI job or runbook | `grep -r "migrate:fresh\|migrate:reset" svbackend/` → zero hits |
| F-10 | The icon enum in `src/lib/icons.ts` is byte-identical to the frontend's `IconName` union (41 values) | `npx tsx src/scripts/checkIconDrift.ts` in CI |
| F-11 | The vendored `src/types/frontend-contract.ts` is byte-identical to `svfrontend/src/types/content.ts` | `npx tsx src/scripts/checkContractDrift.ts` in CI |
| F-12 | `versions.maxPerDoc` pruning behaviour is **measured** and recorded | the recorded measurement from step 206 |
| F-13 | A backup **has been restored** into a scratch environment and the site brought up from it | the recorded restore log from step 208 |

### 30.7 Frontend integration

| # | Criterion | How it is verified |
|---|---|---|
| G-1 | Explicit human approval to modify `svfrontend/` is recorded **before any frontend file changes** | the approval record; `git -C svfrontend log` shows no commit before it |
| G-2 | All routes still prerender | `.next/prerender-manifest.json` lists the same set plus any new project |
| G-3 | **LCP < 2.5 s** and **CLS < 0.05**; First Load JS within **102–114 kB** | Lighthouse and the build output |
| G-4 | `tsc --noEmit` passes under TS 5.9 strict with `noUncheckedIndexedAccess` | `npx tsc --noEmit` |
| G-5 | No horizontal overflow at any width from **320 px to 1920 px** | manual sweep |
| G-6 | The contact form shows success **only** on a real `201`; a `422` renders inline in the existing slots with no redesign; a `500` shows a failure state and a request id | manual, all three paths |
| G-7 | Adding a 6th project through the CMS makes it appear in the catalogue, the nav dropdown, the footer column, the sitemap **and** `generateStaticParams` — with **no hand-edited slug list anywhere** | add one, rebuild, check all five |
| G-8 | `[BRACKETED]` values still render inert | manual |
| G-9 | The live `mailto:[EMAIL@DOMAIN]` bug and the raw-digit WhatsApp href are fixed and covered by an assertion | grep plus the assertion |
| G-10 | No hardcoded project count remains in JSX | grep for "Five layouts" → zero hits |
| G-11 | `images.remotePatterns` covers every host that can appear in an `ImageRef.src` | build with a real remote image → no `Invalid src prop` |
| G-12 | `src/types/content.ts` is **unchanged** | `git -C svfrontend diff --exit-code src/types/content.ts` |
| G-13 | Publishing an edit makes it appear without a redeploy | manual |

### 30.8 Production

| # | Criterion | How it is verified |
|---|---|---|
| H-1 | `/healthz` is green; TLS and HSTS are enforced; the admin is on its own subdomain of the public registrable domain | `curl -I https://cms.<domain>` |
| H-2 | Migrations ran through CI before the build, and a deploy **would have been rejected** on a migration failure | prove it with a deliberate failure in a scratch environment |
| H-3 | Secrets come from the platform store; no `.env` is committed in either repo | `git log -p -- '*.env*'` → nothing |
| H-4 | A synthetic lead flows end to end including the notification | step 232 |
| H-5 | An admin logs in, edits, publishes, and the change is visible on the public site | step 232 |
| H-6 | **Alerts fire on a simulated failure** — kill the worker, break SMTP, stop the database; each produces an alert | step 232 |
| H-7 | The backup schedule is verified running and the restore runbook has been executed at least once | monitoring plus the restore log |
| H-8 | Two admin accounts exist and no seeded or default credentials remain | attempt a seeded login → fails |
| H-9 | A first image upload succeeds in the production container | step 224 |
| H-10 | The privacy policy is published, linked, and names every sub-processor | `curl` the URL; read it |
| H-11 | **Both** indexing blocks are lifted | `curl /robots.txt` and view the page source for `robots: { index: false }` |
| H-12 | No unresolved `[BRACKETED]` value and **no `example.com`** appears in any public response | grep the six read endpoints' responses |
| H-13 | Exactly one copy of `react`/`react-dom`; every `payload` and `@payloadcms/*` version identical and exact | `npm ls react` and a CI version check |

---

## 31. Complete Definition of Done

### 31.1 Per-phase Definition of Done

A phase is done when **every** line is true and evidenced. A tick without evidence is not a pass.

#### Phase 0 — Decisions & Environment Lock

1. A written decision record exists for each of: the `projectStatus`/`leadStatus` rename, `idType: 'uuid'`, the ordering mechanism (or "deferred to step 32 with both options costed"), the exact pinned versions of `payload`/`@payloadcms/*`/`next`/`react`/`react-dom`, the public API URL layout, and the backend origin.
2. `DECISIONS.md` D-004 is no longer `PROPOSED`; OQ-26 is moved to `DECISIONS.md` with the revocation mechanism named.
3. `SECURITY.md` and FR-AUTH-04 no longer assert `argon2id` — `grep -ri argon2 svbackend/docs/` returns **zero hits**.
4. D-012 is `ACCEPTED`, or Phase 7 carries an explicit sign-off entry criterion.
5. OQ-1, OQ-2 and OQ-3 have owner answers recorded, **or** the documented defaults are formally adopted *as interim*.
6. OQ-19 has a **two-release transition plan** written down, naming the release in which the frontend tightens.
7. The SVG seeding paradox has a chosen resolution written into `MEDIA-MANAGEMENT.md`.
8. `node -v`, `npm -v` and `docker -v` are recorded; npm is recorded as the package manager; Node 24.11.0 is recorded as acceptable for `svbackend`; `psql`'s absence is recorded.
9. `svbackend/` is a git repository and the 18 existing specification documents are committed.

#### Phase 1 — The Validation Gate

1. Every `Project` field is expressible in Payload's Postgres adapter — **demonstrated by a generated `payload-generated.schema.ts` that is read and recorded**, not by "it seemed to work".
2. `description` round-trips as `string[]` — asserted at both the Local-API and HTTP layers.
3. Absent optional fields are **absent** — asserted by an exact key-set snapshot of a thin project and a full project.
4. The contract test passes against the real `Project` type from `svfrontend/src/types/content.ts`.
5. An invalid `icon` is rejected at the API **and** by the Postgres enum.
6. The generated admin project editor renders 25 fields, 6 repeatable lists and 5 media pickers usably with **zero custom components**.
7. Seeded projects diff clean against `content/projects.ts` with `[BRACKETED]` values preserved byte-for-byte.
8. **`migrate` and `migrate:down` both succeed on a clean database.**
9. **The gate report exists**, records the measured schema facts, and states explicitly *"D-015 CONFIRMED"* or *"DIRECTUS FALLBACK TRIGGERED"*.
10. The spike directory is deleted.

⛔ **Stop-and-reassess:** failure of criteria **1, 2 or 4** voids D-015 and triggers the Directus fallback. Criterion 3 failing means the serialiser is wrong — fix it; do not switch stacks.

#### Phase 2 — Foundation

1. `svbackend` is a git repo with the real app scaffolded and `docs/` preserved; `npm run dev` serves `/admin`.
2. Booting with `PAYLOAD_SECRET` unset, empty or under length **fails fast with a named error** — proven by a test.
3. `npm run generate:types` produces **no diff** against the committed `payload-types.ts`, CI-enforced.
4. A deliberately-thrown internal error returns the documented envelope with a `requestId` and **no** stack trace, SQL, file path or driver string.
5. A grep/lint rule **fails the build** if `payload.find` or `payload.findByID` appears under `src/app/(public)/**` or `src/endpoints/**` without going through `publicFind()`.
6. A "hello world" public endpoint returns correct `Access-Control-Allow-Origin`, `Cache-Control` and `ETag` headers **from a browser**, not just from curl.
7. `npm run ci` (`payload migrate && npm run build`) succeeds against a clean database.
8. `npm test` boots Payload against a disposable Postgres container, runs one trivial assertion, and **the process exits** — no hanging pool.
9. `/healthz` and `/livez` exist as root Route Handlers outside `/api`.
10. `migrate:fresh` and `migrate:reset` appear in no script; `scripts/resetSandbox.sh` exists and the push-vs-migrate house rule is in the README.

#### Phase 3 — Security Spine

1. **No admin route is reachable without a session** — an automated matrix hits every `/admin/**` and every generated `/api/<slug>` route unauthenticated and asserts 401/403.
2. `GET /api/graphql` and `/api/graphql-playground` return **404**.
3. An **explicit `access` block exists on 100 %** of collections and globals — verified by a config test that fails on any missing key, **including `readVersions`**.
4. Login lockout triggers after 5 failures and expires after `lockTime`; the failure message is **identical** for an unknown email, a wrong password and a locked account.
5. Rate limits are **specified with the build-origin exemption**, and proven active on the login route and a representative public GET once the proxy exists.
6. Security headers (HSTS, `nosniff`, `X-Frame-Options: DENY` on admin, `Referrer-Policy`, `Permissions-Policy`, CSP on the admin origin) are present on a real response.
7. **D-004 is amended and OQ-26 is closed with evidence** — a test proves a password change invalidates other sessions and that `logout?allSessions=true` works.
8. A first admin can be created on a completely fresh database **by the seed script alone**, with `access.create` already locked down.
9. **Two admin accounts exist in every environment.**
10. Production error verbosity is verified to leak nothing.

#### Phase 4 — Projects Domain + Media Core

1. **create → edit → save draft → publish → reorder → unpublish → archive → restore** works end to end, performed by hand and recorded.
2. A duplicate slug returns `409` with the contract message; changing a published slug is blocked **via the API**, not merely greyed out.
3. An invalid `icon` is rejected at the API **and** by the Postgres enum, re-verified on the real repository.
4. Unpublished and archived projects are **invisible** to every public endpoint and to Payload's generated endpoints — asserted using `?draft=true` and `?where[_status][equals]=draft`.
5. `publishedAt` is set on the draft → published transition and cleared on unpublish.
6. **Every mutation writes an audit row** carrying actor, IP, action, entity and — for `approvals`, `area`, `proximity` and title-related fields — before/after values. **Verified by publishing from the Admin UI and finding the row.**
7. Uploading a JPEG produces a document with server-extracted `width`/`height`, a UUID storage key, stripped EXIF and a preserved `originalFilename`.
8. **SVG is rejected. A `.jpg`-renamed executable is rejected by magic bytes. A 10 001 px image is rejected.**
9. `pasteURL` is `false` on both upload collections, asserted by a config test.
10. `toPublicProject()` emits a valid `ImageRef` for the cover, with `depth` pinned so the upload is populated rather than a bare id string.
11. Migrations for the whole domain apply and roll back cleanly on a fresh database.
12. The seed reproduces the 5 projects and is **idempotent** — running it twice produces 5 projects, not 10.

#### Phase 5 — Leads & Notifications

1. `POST /api/v1/leads` returns `201` with `{ id, createdAt, message }` and `Cache-Control: no-store`.
2. A `422` carries `details[].field ∈ { name, phone, project, message }`, verified against `ContactForm.tsx`'s `Errors` map.
3. An unknown `projectSlug` is rejected; a client-supplied `source` is ignored; `id` and timestamps in the body are ignored.
4. A filled honeypot returns a response **byte-identical** to a successful submission.
5. Rate limits trigger at 5/min/IP and 3/hour/phone.
6. **A notification-provider outage does not fail the request** — proven by pointing SMTP at a black hole and confirming a `201` plus a `hasError: true` job row.
7. **The application refuses to boot in production with no email adapter configured** — proven by a test.
8. The job is idempotent: running it twice sends **one** email.
9. Lead `name` and `message` containing `<script>` render escaped in the notification email and in the admin.
10. **No public route returns lead data in any shape** — the explicit test passes, including against Payload's generated `/api/leads`.
11. The `leadStatus` control ships **hidden** unless OQ-3 confirmed it.
12. The worker runs as a separate process with a restart policy, and killing it raises an alert within the monitoring interval.
13. `ipAddress`/`userAgent` purge on schedule, and a lead-record lifetime is documented.

#### Phase 6 — Media Hardening

1. Uploaded files land in S3 under the configured prefix with UUID keys, and their public URLs resolve through the CDN host.
2. `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff` are present on a media response; PDFs carry `Content-Disposition: attachment`.
3. Deleting an in-use asset returns **409 listing what uses it**; `?force=true` detaches then deletes, and the documented rule about coverless published projects is enforced.
4. A soft-deleted asset disappears from the library immediately and its storage object survives the grace period.
5. Replacing a file writes a **new** key; the document id is unchanged; every attachment still resolves; the old key is retained for the grace period.
6. The 5 project covers, the logo and the 3 site images exist as real raster assets and every page that referenced a placeholder renders a real file.
7. `hero.svg` and `hero-portrait.svg` were **not** migrated — the files do not exist.
8. OQ-18 is recorded as answered or as interim before the storage config was written.

#### Phase 7 — Public API Surface & Revalidation

1. All 8 documented endpoints exist at the agreed paths, with `/healthz` **outside** `/api/v1`.
2. An unpublished or archived project returns **404, not 403**.
3. **Every response matches `types/content.ts` field-for-field** — the contract suite covers all 6 read endpoints and runs **in CI**.
4. Key-set snapshots exist for a thin and a full document per endpoint, and a newly-added internal field causes a **test failure**, not a silent leak.
5. **No admin field, no lead data, no `_status`, no `createdBy`/`updatedBy` and no audit data appears in any public response** — asserted, not assumed.
6. `/testimonials` returns only published **and consented** records.
7. Public GETs carry `public, max-age=60, stale-while-revalidate=600` and a working `ETag` (304 on re-request).
8. **Publishing a project from the admin UI triggers revalidation**, naming `/`, `/projects`, `/projects/{slug}` and `/sitemap.xml` — and a revalidation failure produces a warning toast, **not** a failed save.
9. `/healthz` returns `{"status":"ok"}` when the database is up and 503 when it is down, and does not consume a pool connection per second under the orchestrator's probe interval.

#### Phase 8 — Tier-2 Content

1. An unconsented testimonial **cannot be published** — via the admin UI **and** via the API **and** at the database layer (a `422` with `details[].code = CONSENT_REQUIRED`, plus a CHECK constraint that rejects the row).
2. Ordering works and persists for testimonials, FAQs and statistics.
3. `site-settings` is readable **unauthenticated**, verified from a logged-out client.
4. A `[BRACKETED]` value saves successfully and is returned verbatim — format validation bypassed, length limits still enforced.
5. The WhatsApp field rejects `+`, spaces and dashes, shows a live `wa.me` preview, and warns that setting a real value changes hero behaviour.
6. Every `icon` inside `social[]` validates against the 41-value enum.
7. Statistics values are stored and returned as **text**, and nothing in the codebase derives them from row counts.

#### Phase 9 — Frontend Integration

1. **Explicit human approval is recorded before any file under `svfrontend/` changed.**
2. All routes still prerender — the manifest lists the same set plus any new project.
3. **LCP < 2.5 s and CLS < 0.05 still hold**; First Load JS stays within 102–114 kB.
4. `tsc --noEmit` passes under TS 5.9 strict.
5. No horizontal overflow at any width from 320 px to 1920 px.
6. Publishing an edit in the admin makes it appear on the site **without a redeploy**.
7. The contact form shows success **only** on a real `201`; a server `422` renders inline in the existing error slots with no redesign; a `500` shows a failure state and a request id.
8. Adding a 6th project through the CMS makes it appear in the catalogue, the nav dropdown, the footer column, the sitemap **and** `generateStaticParams` — with **no hand-edited slug list anywhere**.
9. `[BRACKETED]` values still render inert.
10. The live `mailto:` and WhatsApp `href` bugs are fixed and covered by an assertion.
11. The three count-coupled strings no longer hardcode a project count.
12. `src/types/content.ts` is **unchanged**.
13. `dangerouslyAllowSVG` is removed once real raster art has replaced every placeholder (deferred if it has not).

#### Phase 10 — Hardening & Verification

1. The full 22-item pre-production security checklist passes, **with evidence recorded per item** — not a tick.
2. **A backup has been restored into a scratch environment and the site brought up from it.** A statement that backups exist is not sufficient.
3. Payload's production error verbosity is verified to leak nothing.
4. The authz matrix passes, including the `?draft=true` case.
5. Upload security tests pass — SVG, magic bytes, size, dimension bomb, EXIF.
6. `POST /api/v1/leads` meets **< 500 ms p95** under load.
7. `npm ls` confirms a single copy of `react`/`react-dom` and identical exact versions across `payload` and every `@payloadcms/*`.
8. `versions.maxPerDoc` pruning behaviour is **measured** and recorded, and the database is sized accordingly.
9. **The privacy policy is published and linked**, naming every sub-processor.

#### Phase 11 — Production Deployment & Go-Live

1. Health check green; TLS and HSTS enforced; the admin on its own subdomain of the public registrable domain.
2. Migrations ran through CI (`migrate` before `build`) and the deploy **would have been rejected** on a migration failure — proven by a deliberate failure in a scratch environment.
3. Secrets come from the platform store; no `.env` is committed; a rotation runbook exists, names "regenerate all API keys", and has been executed once in staging.
4. **A synthetic lead flows end to end, including the notification landing in the sales inbox.**
5. An admin logs in, edits a project, publishes, and the change is visible on the public site.
6. **Alerts fire on a simulated failure** — kill the worker, break SMTP, stop the database: each produces an alert.
7. The backup schedule is verified running and the restore runbook has been executed at least once.
8. Two admin accounts exist; no seeded or default credentials remain.
9. A first image upload succeeds in the production container.
10. **Both** indexing blocks are lifted.
11. No unresolved `[BRACKETED]` value and no `example.com` remains in any public response.

### 31.2 The overall project Definition of Done

**This is the checklist that must be fully true before the project is called finished.** Anything unchecked is either an open item or an explicitly signed-off deferral — there is no third category.

#### Code

- [ ] `svbackend/` is a git repository containing the full application **and** the preserved `docs/`; every commit is reviewable.
- [ ] Every collection in §21.1 exists with an **explicit** `access` block covering `create`, `read`, `update`, `delete`, plus `readVersions` where versioned and `admin`/`unlock` on `Users`.
- [ ] The four guard-rail files — `src/lib/publicFind.ts`, `src/lib/definePublicEndpoint.ts`, `src/lib/errors.ts`, `src/serializers/put.ts` — exist, are enforced by lint/CI, and no public handler bypasses them.
- [ ] `src/serializers/` contains **no `...doc` spread**, verified by review rule and by the key-set snapshot suite.
- [ ] No `richText` or `lexicalEditor` appears on any content field — `grep` returns zero hits.
- [ ] No `localization` is enabled, and the deferral is recorded as a decision with its cost.
- [ ] `src/endpoints/` is empty, with a README line explaining the Route-Handler decision so it is not silently re-litigated.
- [ ] `payload`, every `@payloadcms/*`, `next`, `react` and `react-dom` are pinned **exactly** (no `^`, no `~`) and `npm ls react` shows exactly one copy.
- [ ] `engines.node` is `">=20.9.0"` — **not** svfrontend's `<23` — and an `.nvmrc` exists per app.
- [ ] `migrate:fresh` and `migrate:reset` appear in no script, CI job or runbook.

#### Tests

- [ ] Unit, integration, contract, database, auth, access-control, upload, public-API, admin-workflow, lead-flow and job/email layers all exist and pass.
- [ ] The six must-have cases pass: **leads are not public** · **unpublished projects do not leak** (including `?draft=true`) · **omit, don't empty** · **`description` is `string[]`** · **SVG and type-spoofing rejection** · **rate limits fire with `Retry-After`**.
- [ ] Key-set snapshots exist per endpoint for a thin and a full document.
- [ ] `npm run generate:types` produces no diff, checked in CI.
- [ ] The icon-drift and contract-drift scripts run in CI and pass.
- [ ] `npm test` completes **and the process exits** — no hanging pg pool.
- [ ] Load test: `POST /api/v1/leads` < 500 ms p95.
- [ ] Admin E2E browser tests are **explicitly deferred** with the reason recorded, and a manual release smoke checklist exists in their place.

#### Migrations and data

- [ ] Every migration is named, reviewed before commit, and one migration per logical change.
- [ ] `migrate` → `migrate:down` → `migrate` succeeds on a fresh database, in CI.
- [ ] The production seed is idempotent by slug and gated on `PAYLOAD_SEED`, which is **unset** in production.
- [ ] Seeded content matches `content/projects.ts` byte-faithfully, brackets preserved.
- [ ] The two surviving DB-level constraints exist: the icon Postgres enum (via `enumName`) and the testimonial consent CHECK (via custom migration).
- [ ] `DATABASE-SCHEMA.md` Table 15 (`notification_jobs`) is deleted and the mapping to `payload-jobs` is recorded.

#### Security verification

- [ ] The 22-item pre-production checklist passes **with evidence per item**.
- [ ] The authz matrix passes, including `readVersions` and the generated `/api/<slug>` surface.
- [ ] Boot fails on a missing, empty or short `PAYLOAD_SECRET`.
- [ ] Session revocation is proven on the installed version; **OQ-26 / R-3 is formally closed** and D-004 is amended.
- [ ] Rate limits are active at the edge with the **build-origin exemption**, and each returns `429` with `Retry-After`.
- [ ] Security headers verified on the admin origin **and** the media origin.
- [ ] A reverse-proxy rule blocks `/api/<collection-slug>` paths that are not ours.
- [ ] No 5xx body leaks a stack trace, SQL, file path, driver string or library version.
- [ ] Two admin accounts exist per environment; no default or seeded credentials remain.
- [ ] The `PAYLOAD_SECRET` rotation runbook exists **and has been executed once in staging**.
- [ ] A restore has been **performed**, not merely configured.

#### Documentation

- [ ] The Phase-1 gate report exists with its verdict line and the measured schema facts.
- [ ] `DECISIONS.md` records every decision from §26 and §29, including the ones formally adopted as *interim*.
- [ ] Every C2 "verified correction" has been applied to `svbackend/docs/`; every C2 "needs owner ruling" is recorded as a **question**, never as fact.
- [ ] `grep -ri argon2 svbackend/docs/` → zero hits; `grep -i admin_sessions` → zero hits; `grep DATABASE_URI` → zero hits.
- [ ] `AI-CONTEXT.md`'s table-count claim is corrected and the separate-app decision records **R-57 as the reason**.
- [ ] `RUNBOOK.md` covers deploy, rollback (with the verbatim additive-vs-destructive distinction), restore, session revocation, re-sending a failed notification, secret rotation and sandbox reset.
- [ ] `.env.example` exists in both repos and is the **only** env file in version control.
- [ ] The interim truths are documented where users will meet them: that publishing a sixth project requires a frontend copy change (until Phase 9), and that a new project does not appear in the nav until the derivation ships.

#### Deployment

- [ ] `www.<domain>`, `cms.<domain>` and `media.<domain>` resolve over TLS, with `cms` a subdomain of the public registrable domain.
- [ ] CI runs `npm ci` → `migrate:status` → **backup** → `migrate` → `generate:importmap && next build` → image → deploy, and a migration failure rejects the deploy.
- [ ] One CMS replica plus exactly one `worker-default` and one `worker-maintenance`, with `--handle-schedules` on a single container.
- [ ] Both workers are restarted after every deploy.
- [ ] Monitoring covers error rate, lead-submission failure rate, queue depth, oldest-pending-job age, worker liveness, the health probe, database connections and disk.
- [ ] The three day-one alarms exist and have been **proven to fire**: worker dead · `sendLeadNotification` `hasError: true` · `/healthz` 503 beyond one interval. Email-related alarms use a **second channel**.
- [ ] Backups run nightly with S3 bucket versioning for the second store, and a backup is taken before every migration.
- [ ] A real image upload has succeeded in the production container.

#### Launch gates — owner deliverables

- [ ] **OQ-6** — the company's legal and display name is decided and set in `site-settings`.
- [ ] **OQ-22** — every `[BRACKETED]` value is replaced, including the approval numbers and RERA registration that carry legal weight.
- [ ] **OQ-23** — real consented testimonials exist, or the section ships empty.
- [ ] **OQ-24** — the privacy policy is published, linked, names every sub-processor, and states retention and erasure. **`POST /api/v1/leads` was not reachable in production before this was true.**
- [ ] The lead record's retention lifetime is decided and enforced by a scheduled job.
- [ ] `site.url`'s `https://www.example.com` placeholder is gone — it is the one **unbracketed** placeholder and it evades the inert-link guard entirely.
- [ ] **Both** indexing blocks are lifted.

#### Handover

- [ ] The go-live smoke test has been executed and its evidence recorded: a synthetic lead end to end including the notification · an admin publish visible on the site · alerts firing on three simulated failures.
- [ ] Two named people hold admin accounts and know the lockout and recovery paths.
- [ ] The runbook has been walked through with whoever will operate the system.
- [ ] Every DEFERRED and OPTIONAL item in §27 is listed with its trigger, so a later session reads them as decisions rather than omissions.
- [ ] Every remaining open question in §26 is recorded with its classification, its interim behaviour and its true deadline — **and none of them is recorded as answered when it is not.**
## 32. Official Documentation Evidence

Every Payload decision in this plan was verified against the current official documentation at **https://payloadcms.com/docs/**. Nothing here rests on memory of Payload 2, on blog posts, on `payloadcms.com/community-help/*` threads (which still carry the v2 Express handler signature `(req, res, next)` and would silently produce broken code), or on tutorials. Where the official documentation is silent, the item is written as **NOT VERIFIED IN OFFICIAL DOCS** and carried into §32.52 with a named Phase-1 experiment that resolves it empirically — it is never papered over with a plausible-sounding assumption. The raw official corpus was captured during the investigation and is on disk at `scratchpad/payload-llms-full.txt` (1.9 MB, header line: *"Payload 3.x Documentation — Complete official documentation for Payload 3.x. Do not mix APIs or examples from another major version."*), together with `scratchpad/v3docs/` and `scratchpad/v3all/`; every verbatim quotation below was re-checked against that bundle, and three research-internal disagreements were resolved against it rather than against the research files (see §32.53, rows R-a/R-b/R-c).

**Version context, measured 2026-09-20.** npm dist-tag `latest` for `payload` = **3.90.1**; the public releases index at https://payloadcms.com/posts/releases lists **v3.88.0 (11 Aug 2026)** as its newest entry — the releases page lags npm. `canary` = `4.0.0-canary.35`: **Payload 4 is not stable and must not be adopted.** All statements below are Payload 3.x.

---

### 32.1 Scaffolding and `create-payload-app`
- **Official documentation topic:** Getting Started → Installation
- **Source:** https://payloadcms.com/docs/getting-started/installation · https://payloadcms.com/docs/v3/getting-started/installation.md
- **What it confirms:** The scaffold command is `npx create-payload-app`. The two required packages are `payload` and `@payloadcms/next`; optional are `@payloadcms/richtext-lexical`, `sharp`, `graphql`; exactly one database adapter is required — for us `@payloadcms/db-postgres`. A first-party **`with-postgres`** template exists on branch `3.x` and its `payload.config.ts` is the closest published starting point to D-015: `postgresAdapter({ pool: { connectionString: process.env.DATABASE_URL || '' } })`, `admin: { user: Users.slug, importMap: { baseDir: path.resolve(dirname) } }`, `typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') }`, `sharp`, `editor: lexicalEditor()`.
- **How this project uses it:** `svbackend` is scaffolded as a new standalone app into a temp directory, then `svbackend/docs/` (18 existing specification documents) is moved in and the result committed — `git init` **before** scaffolding, so the scaffold is a reviewable diff (§21.1). Package manager is **npm 11.6.1** (§20.4). The generated config is then replaced field-for-field by the config specified in §15.2 and §16.1.
- **Limitation:** *"pnpm is preferred, yarn 1.x is not supported"* — this machine has yarn 1.22.22 and no pnpm, so npm is the only supported manager present. *"If you are using npm, you might need to install using legacy peer deps: `npm i --legacy-peer-deps`."* Whether `create-payload-app` refuses a **non-empty** target directory is **NOT VERIFIED IN OFFICIAL DOCS** — hence the temp-directory procedure.
- **Verification status:** VERIFIED

### 32.2 Next.js integration — `withPayload` and the `(payload)` route group
- **Official documentation topic:** Getting Started → Installation; Admin → Overview (Project Structure)
- **Source:** https://payloadcms.com/docs/getting-started/installation · https://payloadcms.com/docs/admin/overview
- **What it confirms:** The Next config must be wrapped: `import { withPayload } from '@payloadcms/next/withPayload'` … `export default withPayload(nextConfig)`. Payload's reason, verbatim: *"Payload has a Next.js plugin that it uses to ensure compatibility with some of the packages Payload relies on, like `mongodb` or `drizzle-kit`."* Payload installs **inside** `/app` in a route group named `(payload)` containing `admin/[[...segments]]/page.tsx`, `admin/importMap.js`, `api/[...slug]/route.ts`, `api/graphql/route.ts`, `api/graphql-playground/route.ts`, `custom.scss` and a root `layout.tsx`. Verbatim: *"The files that Payload needs to have in your `/app` folder do not regenerate, and will never change… They are not meant to be edited."* The REST catch-all is `export const GET = REST_GET(config)` etc., imported from `@payloadcms/next/routes`.
- **How this project uses it:** `svbackend/next.config.mjs` = `withPayload({ output: 'standalone', headers: [...] })`. `src/app/(payload)/**` is vendor code: never edited, never linted, never reviewed (§21.1). Our own surface lives in a sibling group `src/app/(public)/api/v1/**` plus root-level `src/app/healthz/route.ts` and `src/app/livez/route.ts`.
- **Limitation:** Verbatim: *"Payload is a fully ESM project, and that means the `withPayload` function is an ECMAScript module."* — hence `.mjs`, and every `require`/`module.exports` in the Next config must be `import`/`export`. `admin/importMap.js` regenerates on startup and on HMR but *"never regenerates during normal runtime or after production builds"*, so `payload generate:importmap` must run in CI before `next build` if any custom admin component exists. Cache-components caveat: *"While Next.js `cacheComponents` can be enabled alongside Payload without causing errors in the admin panel, full compatibility is not guaranteed."*
- **Verification status:** VERIFIED

### 32.3 Generated TypeScript types
- **Official documentation topic:** TypeScript → Generating Types; TypeScript → Overview
- **Source:** https://payloadcms.com/docs/typescript/generating-types · https://payloadcms.com/docs/typescript/overview
- **What it confirms:** Command `payload generate:types` emits `payload-types.ts` with an interface per collection and global. `config.typescript` accepts `autoGenerate` (on by default), `declare` (on by default), `outputFile`, `schema`, `strictDraftTypes`. Helper types exported from `payload`: `CollectionSlug`, `DataFromCollectionSlug`, `RequiredDataFromCollectionSlug`, `GlobalSlug`, `TypedUser`, `TypedCollection`, `TypedGlobal`, `DefaultDocumentIDType`. Verbatim: *"Local API calls will automatically infer your generated types."*
- **How this project uses it:** `typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') }`; `payload-types.ts` is committed and CI asserts that regenerating produces **no diff** (§18.3). `toPublicProject()` is typed `(doc: Project) => PublicProject` from the generated `Project` interface, and its output is checked against the vendored copy of the frontend contract at `src/types/frontend-contract.ts`.
- **Limitation:** Generated types describe the **raw Payload document**, not our public DTO — Payload will not generate `PublicProject`. There is **no built-in mechanism for sharing types between two separate Payload/Next apps** (NOT VERIFIED IN OFFICIAL DOCS that one exists), which is exactly why §21.1 vendors `types/content.ts` and CI-diffs it. Verbatim: *"Payload needs to be able to find your config to generate your types"* — hence `PAYLOAD_CONFIG_PATH=src/payload.config.ts` in the npm script.
- **Verification status:** VERIFIED

### 32.4 Supported Node / Next.js / React versions
- **Official documentation topic:** Getting Started → Installation (Software Requirements)
- **Source:** https://payloadcms.com/docs/getting-started/installation · https://raw.githubusercontent.com/payloadcms/payload/3.x/packages/next/package.json · https://registry.npmjs.org/payload/latest
- **What it confirms:** Verbatim: *"Node.js version 20.9.0+"* — **no upper bound stated**. Next.js supported ranges, verbatim: **`15.2.9`-`15.2.x`, `15.3.9`-`15.3.x`, `15.4.11`-`15.4.x`, `16.2.6`+**, with the callout *"Not all Next.js 15/16 releases are compatible."* `@payloadcms/next@3.90.1` `peerDependencies.next` is tighter still: `">=15.2.9 <15.3.0 || >=15.3.9 <15.4.0 || >=15.4.11 <15.5.0 || >=16.3.3 <17.0.0"`. `payload@3.90.1` `engines.node`: `"^18.20.2 || >=20.9.0"`. The official `3.x` blank template pins `next: 16.3.3`, `react: 19.2.6`, `react-dom: 19.2.6`. The documented production Dockerfile starts **`FROM node:24-alpine AS base`**.
- **How this project uses it:** `svbackend` pins `next` **exactly** (no `^`/`~`) at a supported version — `16.3.3`, matching the official template — plus `react`/`react-dom` at `19.2.6`. `engines.node` is `">=20.9.0"`; the measured Node **24.11.0** is fine. `.nvmrc` is per-app.
- **Limitation:** **`svfrontend` runs Next 15.5.25, which is outside every supported range.** The backend must never inherit the frontend's Next version, and merging Payload into `svfrontend` is blocked until that app is upgraded. **No React version is stated in the v3 Software Requirements and React is not a declared peer dependency of `@payloadcms/next`** — the 19.2.6 pin is inferred from the official template, so React support is PARTIALLY VERIFIED. Payload 4 (canary only) will require Node ≥24.15.0 / Next ≥16.2.6 / TS ≥6.0.3 — the measured 24.11.0 is *below* 24.15.0.
- **Verification status:** VERIFIED for Node and Next; PARTIALLY VERIFIED for React.

### 32.5 PostgreSQL adapter *(depth)*
- **Official documentation topic:** Database → Postgres; Database → Overview
- **Source:** https://payloadcms.com/docs/database/postgres · https://payloadcms.com/docs/v3/database/postgres.md · https://payloadcms.com/docs/database/overview
- **What it confirms:** Package `@payloadcms/db-postgres`, factory `postgresAdapter`, assigned to `db`. Verbatim: *"It leverages Drizzle ORM and `node-postgres` to interact with a Postgres database that you provide."* The **complete** documented option set: `pool` (required — *"Pool connection options that will be passed to Drizzle and `node-postgres`"*), `push`, `migrationDir`, `schemaName` *(experimental)*, `idType` (*"A string of 'serial', or 'uuid'"*), `transactionOptions`, `disableCreateDatabase` (*"Defaults to `false`"*), `localesSuffix` (`_locales`), `relationshipsSuffix` (`_rels`), `versionsSuffix` (`_v`), `beforeSchemaInit`, `afterSchemaInit`, `generateSchemaOutputFile` (default `{CWD}/src/payload-generated.schema.ts`), `allowIDOnCreate`, `readReplicas`, `readReplicasAfterWriteInterval` (default `2000`), `blocksAsJSON`. `prodMigrations` is documented on the Migrations page and shown passed to `postgresAdapter`. Drizzle is exposed at `payload.db.drizzle`, `payload.db.tables`, `payload.db.enums`, `payload.db.relations`, with operators re-exported from `@payloadcms/db-postgres/drizzle` and builders from `@payloadcms/db-postgres/drizzle/pg-core`. Escape hatches: `beforeSchemaInit` (*"extend your database structure with tables that won't be managed by Payload"*), `afterSchemaInit` (*"modify the schema with features that aren't supported by Payload"*, with an `extendTable` utility), and `adapter.rawTables` with `.columns` / `.indexes`.
- **How this project uses it:** Exactly the block in §16.1 — `pool` with `max: 10`, `idleTimeoutMillis: 30_000` and conditional `ssl: { rejectUnauthorized: true }`; `idType: 'uuid'`; `migrationDir: './src/migrations'`; `disableCreateDatabase: env.NODE_ENV === 'production'`; `generateSchemaOutputFile: './src/payload-generated.schema.ts'`; `afterSchemaInit: [addUnexpressibleConstraints]` for the constraints Payload cannot express (§16.5). `schemaName`, `transactionOptions`, `blocksAsJSON`, `readReplicas` are all deliberately **not set**, each for a stated reason.
- **Limitation:** `schemaName` is marked *"(experimental)"* — stay on `public`. `disableCreateDatabase` **defaults to `false`**, so on a managed Postgres where the app role lacks `CREATE DATABASE` Payload throws at boot. Verbatim on schema hooks: *"Columns and tables, added in schema hooks won't be added to the generated via `payload generate:db-schema` Drizzle schema"* — a later regeneration silently loses our custom indexes from the typed file (not from the database), so §16.5 makes that a written convention. **Payload publishes no connection-pool sizing guidance at all** (delegated to node-postgres/Drizzle) and **no minimum supported PostgreSQL version** — both NOT VERIFIED IN OFFICIAL DOCS. Payload's own Database Overview steers array/blocks/`hasMany`-select-heavy models toward MongoDB: *"You should prefer MongoDB if: … You leverage a lot of Arrays, Blocks, or `hasMany` Select fields."* Our `Project` is exactly that shape; D-015 accepts the trade-off deliberately.
- **Verification status:** VERIFIED for the option surface; NOT VERIFIED for pool sizing and minimum PG version.

### 32.6 Field-to-table mapping
- **Official documentation topic:** Database → Postgres; Fields → Array / Blocks / Select / Group / Relationship
- **Source:** https://payloadcms.com/docs/database/postgres · https://payloadcms.com/docs/fields/array · https://payloadcms.com/docs/fields/blocks · https://payloadcms.com/docs/fields/select · https://payloadcms.com/docs/fields/group
- **What it confirms:** Arrays get their own table — Array `dbName`: *"Custom table name for the field when using SQL Database Adapter (Postgres). **Auto-generated from name if not defined.**"* Blocks get one table per block type — Blocks `dbName`: *"Auto-generated from **slug** if not defined."* `hasMany` select gets both a Postgres **enum** (`enumName`) and a child table (`dbName`, *"if `hasMany` set to `true`"*). Relationships live in `<slug>_rels`; localized fields in `<slug>_locales`; versions in `<slug>_v`. `blocksAsJSON` is the only official acknowledgement that blocks otherwise use *"the relational structure"*.
- **How this project uses it:** Every array field (`highlights`, `stats`, `amenities`, `approvals`, `locationHighlights`, `proximity`, `gallery`, `brochureImages`, `social`, `legalLinks`) carries an **explicit short `dbName`**, and every `select` carries an explicit `enumName` (e.g. `enumName: 'enum_icon_name'`), so table and type names are deliberately chosen rather than derived and possibly truncated. `npx payload generate:db-schema` is run and **read** before migration 001 (§16.3).
- **Limitation:** The docs do **not** state that **group** fields flatten into prefixed columns (the Group field exposes no `dbName`, which is strong circumstantial evidence but not a statement). They do **not** document array/block **row `id` columns**, an **`_order` column**, a `_parent_id` column, or any **63-byte identifier truncation** behaviour. All NOT VERIFIED IN OFFICIAL DOCS.
- **Verification status:** PARTIALLY VERIFIED — the existence of per-field tables and suffixes is documented; the physical column layout is not.

### 32.7 Migrations *(depth)*
- **Official documentation topic:** Database → Migrations
- **Source:** https://payloadcms.com/docs/database/migrations · https://payloadcms.com/docs/v3/database/migrations.md
- **What it confirms:** The complete CLI, with the docs' own descriptions: `payload migrate` (*"run any migrations that have not yet been run"*), `payload migrate:create optional-name-here`, `payload migrate:status`, `payload migrate:down` (*"Roll back the **last batch** of migrations"*), `payload migrate:refresh`, `payload migrate:reset`, `payload migrate:fresh` (*"Drops all entities from the database and re-runs all migrations from scratch"*). Flags on `migrate:create`: `--skip-empty`, `--force-accept-warning`. The required npm tie-in, verbatim: `"payload": "cross-env PAYLOAD_CONFIG_PATH=src/payload.config.ts payload"`, with the note *"you need to run Payload migrations through the package manager that you are using, because Payload should not be globally installed."* File format is two exports, `up({ payload, req })` and `down({ payload, req })`, fully TypeScript; raw SQL is `import { type MigrateUpArgs, sql } from '@payloadcms/db-postgres'` then `await db.execute(sql\`…\`)`. Default directory `./src/migrations`; Payload also **generates an `index.ts` in that folder exporting a `migrations` array**. Each migration runs **in its own transaction** (see §32.9). Production ordering, verbatim: *"Generally, you want to run migrations before you build Payload for production… `"ci": "payload migrate && pnpm build"` … If it fails, the deployment will be rejected."* Alternative for long-running servers: `postgresAdapter({ prodMigrations: migrations })`, which runs *"in production only"*.
- **How this project uses it:** `migrationDir: './src/migrations'` set explicitly (never the "best effort" search). Every migration is **named**, generated by a human, and reviewed before commit. The pipeline is `npm run payload migrate:status` (read-only gate) → `npm run payload migrate` as a **separate pre-deploy job with a DDL-capable role** → build → deploy (§16.6, §20.13). CI passes `DATABASE_URL` explicitly on the command line rather than trusting file loading, because env loading is documented only for `payload run` (§22.1 rule 2).
- **Limitation:** `migrate:down` rolls back a **batch**, not one migration. Auto-generated `down` restores structure, not data. Docs tip, verbatim: *"before you check in the created migration it's a good idea to always double-check the contents of the migration files."* Environment-conditional config generates divergent migrations — verbatim: *"If you generate migrations without considering the environment, it can lead to discrepancies and issues"* — which is why §22.2 registers the S3 plugin **always** and switches behaviour by env var inside it. **There is no documented migration locking / advisory lock**, so two concurrent deploys both running `payload migrate` is NOT VERIFIED IN OFFICIAL DOCS as safe. **"Predefined migrations" and a `--file` flag do not exist** on the current Migrations page — confirmed absent; do not plan around them.
- **Verification status:** VERIFIED for the CLI and ordering; NOT VERIFIED for concurrency safety.

### 32.8 `push` versus `migrate` *(depth)*
- **Official documentation topic:** Database → Postgres (Prototyping in development mode); Database → Migrations (When to run migrations)
- **Source:** https://payloadcms.com/docs/database/postgres#prototyping-in-development-mode · https://payloadcms.com/docs/database/migrations#when-to-run-migrations
- **What it confirms:** Verbatim: *"Drizzle exposes two ways to work locally in development mode. The first is `db push`… **This only works in development mode, and should not be mixed with manually running `migrate` commands.**"* And: *"Push is enabled by default, but you can opt out."* And: *"we suggest that you leave `push` as its default setting and **treat your local dev database as a sandbox** … **you do not need to run migrations against your development database**."* And the explicit warning: **"do not mix 'push' and migrations with your local development database. If you use 'push' locally, and then try to migrate, Payload will throw a warning, telling you that these two methods are not meant to be used interchangeably."** Turning it off — `postgresAdapter({ push: false })` — carries its own documented cost: *"if you do disable it, you may see frequent errors while running development mode."*
- **How this project uses it:** `push` is left at its **default** (dev-only, enabled). The local dev database is a disposable Docker sandbox reset with `scripts/resetSandbox.sh` (`docker compose down -v && up -d`) so that nobody reaches for `migrate:fresh`. `migrate` is **never** run against the local dev database. Staging and production are migrations-only — `push` is dev-mode-only and therefore already off there. This rule is the first line of `svbackend/README.md` (§21.1).
- **Limitation:** The docs describe a **warning**, not a hard abort, when the two are mixed — so discipline, not the framework, is the control. Postgres specifically demands the discipline: *"Postgres users of Payload should become familiar with the entire migration workflow from top to bottom."*
- **Verification status:** VERIFIED

### 32.9 Transactions *(depth)*
- **Official documentation topic:** Database → Transactions
- **Source:** https://payloadcms.com/docs/database/transactions · https://payloadcms.com/docs/v3/database/transactions.md
- **What it confirms:** Verbatim: *"By default, Payload will use transactions for all data changing operations, as long as it is supported by the configured database."* Postgres supports them, so **transactions are on by default for us with zero configuration** (contrast: SQLite needs `transactionOptions: {}`; MongoDB needs a replica set). *"The initial request made to Payload will begin a new transaction and attach it to the `req.transactionID`. If you have a `hook` that interacts with the database, you can opt in to using the same transaction by passing the `req` in the arguments."* Direct control: `payload.db.beginTransaction()`, `payload.db.commitTransaction(id)`, `payload.db.rollbackTransaction(id)`, and the synthetic-`req` pattern `req: { transactionID }`. Opt-outs: adapter-wide `transactionOptions: false`, or per-call `disableTransaction: true`. Migrations: *"each migration is performed in a new transaction for you… If the migration errors at any point or fails to commit, it is caught and the transaction gets aborted."* And the footgun, verbatim: *"Since Payload hooks can be async and be written to not await the result, it is possible to have an incorrect success response returned on a request that is rolled back. If you have a hook where you do not `await` the result, then you should **not** pass the `req.transactionID`."*
- **How this project uses it:** The lead write is the transaction boundary. `hooks/enqueueLeadNotification.ts` calls `req.payload.jobs.queue(...)` inside a `try/catch` so an enqueue failure logs and does **not** fail the public request (FR-LEAD-06). Anything that must be atomic with the lead — the audit row — **does** receive `req`. Seeds use `disableTransaction` only where a long-running bulk write demands it.
- **Limitation:** `transactionOptions` accepts a `PgTransactionConfig` but the docs delegate its contents entirely to Drizzle — **isolation levels are NOT VERIFIED IN OFFICIAL PAYLOAD DOCS**. There is **no documented "commit succeeded" hook**, so an outbox pattern must be built on the Jobs Queue rather than on a commit callback. **Whether `req` inside a custom `endpoints` handler carries a `transactionID` is NOT VERIFIED IN OFFICIAL DOCS** — moot for us, because §21.2 puts the public surface in Next.js Route Handlers, which receive a plain `Request` and open their own transaction on `POST /leads`.
- **Verification status:** VERIFIED for default behaviour and the async-hook warning; NOT VERIFIED for isolation levels and custom-endpoint transaction propagation.

### 32.10 Local API
- **Official documentation topic:** Local API → Overview; Local API → Outside Next.js
- **Source:** https://payloadcms.com/docs/local-api/overview · https://payloadcms.com/docs/local-api/outside-nextjs
- **What it confirms:** Access the instance either from `req.payload` in hooks/access/validation, or by import: `import { getPayload } from 'payload'; import config from '@payload-config'; const payload = await getPayload({ config })`. Collection methods: `create`, `find`, `findByID`, `count`, `findDistinct`, `update` (by id or `where`), `delete` (by id or `where`). Globals: `findGlobal`, `updateGlobal`. Auth: `auth`, `login`, `forgotPassword`, `resetPassword`, `unlock`, `verifyEmail`. Documented defaults that matter: `limit` **10**, `depth` falls back to `defaultDepth` (**2** if unset), `fallbackLocale` `false`, `showHiddenFields` `false`, `disableErrors` `false`, **`overrideAccess` `true`**, `overrideLock` `true`. Verbatim on transactions: *"When your database uses transactions you need to thread `req` through to all local operations."* Verbatim on typing: *"Local API calls will automatically infer your generated types."*
- **How this project uses it:** Every public read goes through the single wrapper `src/lib/publicFind.ts`, which **forces** `overrideAccess: false`, `user: undefined`, an un-overridable `where: { _status: { equals: 'published' } }` and an include-mode `select`. Bare `payload.find` is banned in the public-API directory by review rule and lint (§21.3).
- **Limitation:** **`overrideAccess` defaulting to `true` is the single most dangerous default in this stack for a public API** — see §32.18. `draft`, `trash`, `joins` and `context` are documented as REST query params / config flags but do **not** appear in the Local API `find()` example; their availability as Local API options is NOT VERIFIED IN OFFICIAL DOCS. `/docs/queries/joins` returns 404. ESM-only: *"make sure you are writing your scripts in ESM format or dynamically importing the Payload Config."*
- **Verification status:** VERIFIED

### 32.11 Custom endpoints *(depth)*
- **Official documentation topic:** REST API → Overview (Custom Endpoints)
- **Source:** https://payloadcms.com/docs/rest-api/overview · https://payloadcms.com/docs/configuration/overview · https://payloadcms.com/docs/configuration/collections
- **What it confirms:** `endpoints` may be declared on the root config, on collections and on globals. Each entry takes `path`, `method` (**lowercase**: `'get' | 'head' | 'post' | 'put' | 'delete' | 'connect' | 'options'`), `handler` and `custom`. The handler signature is **one argument**: `async (req: PayloadRequest) => Response`, returning a Web `Response` (`Response.json(body, { status })`). Path params are `req.routeParams.<name>`, typed `unknown` in the docs' own example. Body: *"Data is not automatically appended to the request. You can read the body data by calling `await req.json()."* Helpers exported from `'payload'`: `addDataAndFileToRequest`, `addLocalesToRequestFromData`, `headersWithCors`. Auth, verbatim: **"Custom endpoints are not authenticated by default. You are responsible for securing your own endpoints."** Mounting, verbatim: *"Custom endpoints defined in your Payload Config are **always** mounted under your configured `routes.api` path (default: `/api`)."* And the documented escape: *"To define a route that is not prefixed by this path, add a Next.js Route Handler at the desired location in your app directory."*
- **How this project uses it:** **We use none.** `src/endpoints/` is kept deliberately empty with a README line (§21.2). All seven public routes plus `/healthz` and `/livez` are Next.js Route Handlers, because our contract fixes `/api/v1/**` and puts `/healthz` outside `/api` — neither is expressible as a Payload endpoint without relocating Payload's own REST surface, and config endpoints and Payload's REST routes **travel together** under `routes.api`.
- **Limitation:** **`root: true` does not exist in the Payload 3 documentation** — verified absent from the full docs bundle (a `grep` for it returns nothing). B05 asserted it; that assertion failed verification. Do not design around it. There is no documented middleware chain, no per-route rate limiting, and **custom endpoints get no CORS for free** (§32.41). The v2 Express signature `(req, res, next)` with `res.status().send()` is **wrong for v3** and appears only in community-help pages.
- **Verification status:** VERIFIED (including the verified **absence** of `root: true`).

### 32.12 Disabling the generated REST and GraphQL APIs *(depth)*
- **Official documentation topic:** GraphQL → Overview; Configuration → Collections / Globals; Access Control → Overview
- **Source:** https://payloadcms.com/docs/graphql/overview · https://payloadcms.com/docs/configuration/collections · https://payloadcms.com/docs/configuration/globals · https://payloadcms.com/docs/access-control/overview
- **What it confirms:** **GraphQL can be switched off completely.** Root: `graphQL.disable` — *"A boolean that if true will disable the GraphQL entirely, defaults to false."* Per collection/global: `graphQL: false`. `graphQL.disablePlaygroundInProduction` defaults to `true`. `graphQL.maxComplexity` rejects expensive queries. Collection switches that narrow the REST surface: `disableBulkEdit` and `disableBulkDelete` (both documented as affecting *"the admin panel **and the REST API**"*), `disableDuplicate` (*"prevents `duplicate` from all APIs"*). Access Control is documented as the mechanism that *"secure[s] your APIs"*.
- **How this project uses it:** `graphQL: { disable: true }` at the root — we hand-write REST, so GraphQL is pure attack surface (§15.2). Every collection and global carries an explicit `access` block (§32.18). A reverse-proxy rule blocks `/api/<collection-slug>` paths that are not ours (§15.3 item 18), and the pre-production checklist asserts `GET /api/graphql` and `/api/graphql-playground` return **404** (§15.3 item 14).
- **Limitation:** **There is no documented REST equivalent of `graphQL.disable`.** No `disableREST`, no per-operation switch. The collection option `endpoints` is described only as *"Add custom routes to the REST API. Set to `false` to disable routes"* — whose scope (custom routes only, or all REST routes for that collection) is **not stated**. Both NOT VERIFIED IN OFFICIAL DOCS. Therefore the generated `/api/<slug>` surface **cannot be turned off by configuration**; access control plus an infrastructure block is the whole mitigation, and `endpoints: false` must be empirically tested before any security claim rests on it. `admin.hidden` is *"navigation and admin routing"* only and hides nothing from the API.
- **Verification status:** VERIFIED for GraphQL; NOT VERIFIED IN OFFICIAL DOCS for any REST kill switch.

### 32.13 Authentication *(depth)*
- **Official documentation topic:** Authentication → Overview / Operations
- **Source:** https://payloadcms.com/docs/authentication/overview · https://payloadcms.com/docs/authentication/operations · https://payloadcms.com/docs/v3/authentication/overview.md
- **What it confirms:** Auth is enabled per collection with `auth: true` or an options object. Auth collections are *"automatically injected with the `hash`, `salt`, and `email` fields"*, and *"All find operations are sanitized, and specifically `hash` and `salt` are removed from the document."* The options table has exactly **13** rows: `cookies`, `depth` (default `0`), `disableLocalStrategy`, `forgotPassword`, `lockTime`, `loginWithUsername`, `maxLoginAttempts`, `removeTokenFromResponses`, `strategies`, `tokenExpiration`, `useAPIKey`, `useSessions` (**true by default**), `verify`. Sub-options: `forgotPassword.expiration`, `forgotPassword.minRequestInterval` (default `15000` ms), `forgotPassword.generateEmailHTML` / `generateEmailSubject`, and the same pair under `verify`. Operations: `GET /api/[slug]/me`, `POST /api/[slug]/login`, `POST /api/[slug]/logout?allSessions=`, `POST /api/[slug]/refresh-token`, `POST /api/[slug]/unlock`, `POST /api/[slug]/forgot-password`, `POST /api/[slug]/reset-password`. The admin panel is bound to exactly one auth collection via `admin.user`: *"The Admin Panel can only be used by a single auth-enabled Collection."* A dedicated `createFirstUser` route exists at `/create-first-user`.
- **How this project uses it:** One `users` collection, `admin: { user: 'users' }`, email+password, `useSessions` left at its default `true`, `tokenExpiration: 7200`, `maxLoginAttempts: 5`, `lockTime: 15 * 60 * 1000`, `depth: 0`, branded `forgotPassword.generateEmailHTML`/`generateEmailSubject` pointing at Payload's **built-in** reset page `${serverURL}/admin/reset/${token}` (§14.4). No public registration: `access.create` is admin-only. The first admin is created by the seed script through the Local API, not by the web screen.
- **Limitation:** **No documented default values exist for `tokenExpiration`, `maxLoginAttempts` or `lockTime`** — set all three explicitly and assert them in a config test. **The interaction between `access.create: () => false` and the `/create-first-user` screen is NOT VERIFIED IN OFFICIAL DOCS** — this is the single most likely bootstrap footgun, and it is why the first admin is seeded rather than clicked. There is **no core SSO/OIDC and no core MFA/TOTP** documented.
- **Verification status:** VERIFIED for the option surface; NOT VERIFIED for defaults and for first-user bootstrap under a locked `create`.

### 32.14 Cookies and sessions *(depth)*
- **Official documentation topic:** Authentication → Cookies; Authentication → Token Data; Fields → Default Fields
- **Source:** https://payloadcms.com/docs/authentication/cookies · https://payloadcms.com/docs/authentication/token-data · https://payloadcms.com/docs/fields/default-fields · https://payloadcms.com/docs/configuration/overview
- **What it confirms:** The auth transport is an **HTTP-only cookie**: *"They are totally protected from common XSS attacks and cannot be read by JavaScript in the browser, unlike JWT's."* `auth.cookies` documents exactly three settable keys: `secure`, `sameSite`, `domain`. Global `cookiePrefix` — *"A string that will be prefixed to all cookies that Payload sets."* JWT reserved keys are `id`, `collection`, `email`, **`sid`**, `iat`, `exp`, and Payload signs an `authVersion: 1` marker in the protected header. A **`sessions` field is auto-added to the user document** when `auth.useSessions` is enabled (Default Fields table). Cross-domain, two documented strategies: **(1) subdomains** — *"Cookies can cross subdomains without being considered third party cookies, for example if your API is at api.example.com then you can authenticate from example.com"*; **(2)** `sameSite: 'None'` + `secure: true`, with `credentials: 'include'` on the browser fetch.
- **How this project uses it:** `cookiePrefix: 'sv'`; `cookies.secure` is environment-conditional; the CMS is deployed on a **subdomain of the public registrable domain** (`cms.<domain>` beside `www.<domain>`), which is the documented happy path and lets us keep `sameSite: 'Lax'`. The public frontend makes only **unauthenticated** calls, so it never needs to send credentials at all.
- **Limitation:** *"Setting up `secure: true` will not work if you're developing on `http://localhost`."* The **literal default cookie name** (what `cookiePrefix` concatenates with) is NOT VERIFIED IN OFFICIAL DOCS. Whether **`httpOnly` is settable** under `auth.cookies` is NOT VERIFIED — it is listed only as descriptive prose, so treat it as always-on (which is what we want). The **shape of the `sessions` field** (its sub-fields, expiry, Postgres storage) is NOT VERIFIED IN OFFICIAL DOCS — do not build a session-inventory UI on it. The meaning of the reserved JWT key `sid` is listed but never explained.
- **Verification status:** PARTIALLY VERIFIED — the mechanism is documented; the session record's shape is not.

### 32.15 Session revocation *(depth)*
- **Official documentation topic:** Authentication → Overview (`useSessions`); Authentication → Operations (Logout); Local API → Server Functions
- **Source:** https://payloadcms.com/docs/authentication/overview · https://payloadcms.com/docs/authentication/operations · https://payloadcms.com/docs/local-api/server-functions
- **What it confirms:** `useSessions` — *"True by default. Set to `false` to use stateless JWTs… **Stateless JWTs cannot be revoked, so they stay valid until `tokenExpiration` even after a password change.**"* Logout — *"By default, logging out will only end the session pertaining to the JWT that was used to log out with. However, you can pass `allSessions: true` to the logout operation in order to end all sessions for the user logging out."* REST `POST /api/users/logout?allSessions=true`; GraphQL `logoutUser(allSessions: true)`; server function `logout({ allSessions: true, config })` from `@payloadcms/next/auth`. **Password-change revocation is documented explicitly:** *"With sessions enabled, changing a user's password ends that user's other sessions, so tokens that were issued before the change stop working."* · *"Updating the password of the user making the request … keeps the session that the request was made with and ends the rest."* · *"**Updating a user's password on their behalf, such as an admin updating another user, ends all of that user's sessions.**"* · *"The `resetPassword` operation ends all existing sessions and returns a token for the new session that it creates."*
- **How this project uses it:** This closes OQ-26 and promotes D-004 from PROPOSED to ACCEPTED-as-amended: Payload's httpOnly JWT cookie with `useSessions: true` satisfies **both** of D-004's rationales — XSS (not script-readable) and revocation (self-service `allSessions`, password change, admin-initiated password change, `resetPassword`). FR-AUTH-06 (*"invalidates all other sessions and says so"*) maps directly onto the documented behaviour. Hard rule recorded in §15: **never set `useSessions: false`.**
- **Limitation:** There is **no documented API for an admin to revoke another user's sessions directly**, and no documented session-listing API — the supported admin path is an admin-initiated password change, which is documented to end all of that user's sessions. One documented gotcha must be in the implementation notes verbatim: *"A Local API update that runs without an authenticated user has no session to keep, so it ends all of the user's sessions. Pass the `user` returned by `payload.auth` when the user making the request should stay logged in."* Rotating `PAYLOAD_SECRET` is **not** a revocation mechanism (§32.44).
- **Verification status:** VERIFIED

### 32.16 Password hashing *(depth)*
- **Official documentation topic:** Authentication → Overview; Configuration → Overview (`secret`)
- **Source:** https://payloadcms.com/docs/authentication/overview · https://payloadcms.com/docs/configuration/overview · https://payloadcms.com/llms-full.txt
- **What it confirms:** Verbatim from the docs bundle: *"The `hash` field stores a **PBKDF2-SHA256** derived key prefixed with the scheme it was created with, for example `pbkdf2-sha256-v1:<derived-key>`."* Payload stores a per-user `salt` and `hash`, and strips both from every find operation. `secret` is *"A secure, unguessable string that Payload will use for any encryption workflows - for example, password salt / hashing"*, and *"This property should be impossible to guess and extremely difficult for brute-force attacks to crack."*
- **How this project uses it:** We accept Payload's built-in hashing. `SECURITY.md` §1, `REQUIREMENTS.md` FR-AUTH-04 and `TRACEABILITY.md` §5 are amended to a vendor-accurate statement: *"Passwords are never stored in reversible form. The CMS stores a per-user salt and a PBKDF2-SHA256 derived key and strips `salt`/`hash` from every read. Never MD5/SHA-1/plaintext."* We compensate with the controls we do own: a ≥12-character minimum enforced by a `validate` on the `password` field, `maxLoginAttempts` + `lockTime`, admin-only account creation, and edge rate limiting.
- **Limitation:** **There is no configuration hook for the hashing algorithm.** The `auth` options table has 13 rows and none of them concerns hashing; there is no `minPasswordLength`/`maxPasswordLength` option either. The only escape is `auth.disableLocalStrategy: true` plus a fully hand-written strategy, which the docs gate with *"Only use this property if you have replaced Payload's auth mechanisms with your own"* — forfeiting login, forgot-password, reset-password, unlock, `maxLoginAttempts`/`lockTime`, the admin login UI **and the session machinery §32.15 depends on**. **`argon2id` is therefore not deliverable under D-015.** Separately: whether a documented example exists for attaching `validate` to the *injected* `password` field is NOT VERIFIED IN OFFICIAL DOCS — the *ability* to redefine `email`/`username`/`password` is documented; the specific pattern must be proven in the Phase-1 spike.
- **Verification status:** VERIFIED for the algorithm; NOT VERIFIED for the password-field `validate` pattern.

### 32.17 Login lockout
- **Official documentation topic:** Authentication → Overview; Production → Preventing API Abuse
- **Source:** https://payloadcms.com/docs/authentication/overview · https://payloadcms.com/docs/production/preventing-abuse · https://payloadcms.com/docs/access-control/collections
- **What it confirms:** `maxLoginAttempts` — *"Only allow a user to attempt logging in X amount of times. Automatically locks out a user… Set to `0` to disable."* `lockTime` — *"Set the time (in milliseconds) that a user should be locked out."* The anti-abuse page has a dedicated **"Limit Failed Login Attempts"** section prescribing exactly this. Unlocking is a first-class operation (`POST /api/[slug]/unlock`, `payload.unlock({ collection })`), gated by the collection access function `unlock` — *"Determines which users can unlock other users who may be blocked from authenticating."*
- **How this project uses it:** `maxLoginAttempts: 5`, `lockTime: 900000`, `access.unlock: isAdmin`. **Two admin accounts exist from day one** (§15.3 item 1) so that a targeted attacker cannot lock the sole administrator out of their own CMS.
- **Limitation:** The lock is **per user account, not per IP** — it does nothing against credential stuffing across many usernames and nothing at all for unauthenticated read endpoints. The docs do **not** state whether the failed-attempt counter resets on success, whether the lock auto-expires after `lockTime` without an explicit unlock, the field names used, or the HTTP status a locked account receives. All NOT VERIFIED IN OFFICIAL DOCS — confirm by test in Phase 2.
- **Verification status:** PARTIALLY VERIFIED

### 32.18 Access control *(depth)*
- **Official documentation topic:** Access Control → Overview / Collections / Globals; Local API → Access Control
- **Source:** https://payloadcms.com/docs/access-control/overview · https://payloadcms.com/docs/access-control/collections · https://payloadcms.com/docs/access-control/globals · https://payloadcms.com/docs/local-api/access-control
- **What it confirms:** Access functions are scoped to the operation and run *"before any changes are made and before any operations are completed."* Collection functions, exactly seven: `create`, `read`, `update`, `delete`, plus `admin` and `unlock` (auth-enabled only) and `readVersions` (versions-enabled only). Globals have three: `read`, `update`, `readVersions`. Return a boolean **or** a `Where` query constraint — the documented pattern is `({ req: { user } }) => user ? true : { isPublic: { equals: true } }`. TypeScript: `import type { Access } from 'payload'`. **The default when `access` is omitted, verbatim:** *"Payload sets a default function that simply checks if a user is present on the request"* → `({ req: { user } }) => Boolean(user)`. **The Local API default, stated three independent times:** *"In the Local API, all Access Control is **skipped** by default"* · `overrideAccess` — *"Skip access control. By default, this property is set to `true` within all Local API operations"* · *"local API operations **override access control by default**."* Re-enable with `overrideAccess: false` **and** an explicit `user`.
- **How this project uses it:** The entire authorisation model is four functions in `src/access/` — `isAdmin`, `anyone`, `nobody`, `publishedOrAuthenticated` (`user ? true : { _status: { equals: 'published' } }`). **Every** collection and global declares an explicit `access` block including `readVersions`, proven by a config test (§15.3 item 15). Every public read passes through `publicFind()` with three independent layers: `overrideAccess: false`, `user: undefined`, and an un-overridable published-only `where`.
- **Limitation:** **Payload's default is allow-any-authenticated-user-full-CRUD, which is the opposite of deny-by-default.** Benign under one role today; a hole the moment a second auth-enabled collection exists. Collection-level functions are **not** documented to receive `doc` or `siblingData`. Whether an access `Where` is combined with a caller-supplied `?where=` by boolean **AND** is **NOT VERIFIED IN OFFICIAL DOCS** — the only merge language anywhere is the Drafts page's *"Payload appends this constraint to the update query"*. Verbatim caveat: *"When your access control functions are executed via the Access Operation… `Where` queries returned from access control functions will not be run - we'll assume the user does not have access instead."* There is **no global switch to flip the Local API `overrideAccess` default** — it is per call.
- **Verification status:** VERIFIED for the function set and defaults; NOT VERIFIED for `Where` merge semantics.

### 32.19 Field-level access control
- **Official documentation topic:** Access Control → Fields
- **Source:** https://payloadcms.com/docs/access-control/fields
- **What it confirms:** Exactly **three** functions — `create`, `read`, `update`. There is no field-level `delete`. Read denial, verbatim: *"If `false`, **the entire property is omitted from the resulting document.**"* Create denial: *"any passed values will be discarded."* Update denial, verbatim: *"the operation will **not** throw an error however the field will be omitted from the update operation and the value will remain unchanged."* Hard limitation, verbatim banner: *"Field Access Control does not support returning Query constraints like Collection Access Control does."* Arguments vary by operation and include `req`, `collection`, `global`, `id`, `data`, `doc`, `siblingData`, `blockData`.
- **How this project uses it:** Field-level `read: isAdmin` on lead PII (`email`, `phone`, `message`, `ipAddress`, `userAgent`) as defence in depth. And the cross-cutting rule from §32.21: **every server-assigned field carries `access: { create: () => false, update: () => false }`**, never `admin.readOnly` alone — applied to `source`, `sourcePath`, `phoneNormalised`, `consentGiven`, `ipAddress`, `userAgent`, `width`, `height`, `originalFilename`, `uploadedBy`, `publishedAt` and the post-publish slug lock.
- **Limitation:** Update denial is **silent** — a client cannot distinguish "saved" from "ignored"; if a 403 is wanted, a `beforeValidate`/`beforeChange` hook must throw. Field access **does not run at all when `overrideAccess` is `true`**, which is the Local API default — so a bare `payload.find({ collection: 'leads' })` returns PII with field stripping bypassed.
- **Verification status:** VERIFIED

### 32.20 `readVersions`
- **Official documentation topic:** Access Control → Collections; Versions → Overview
- **Source:** https://payloadcms.com/docs/access-control/collections · https://payloadcms.com/docs/versions/overview
- **What it confirms:** `readVersions` — *"Used to control who can read versions, and who can't. Will automatically restrict the Admin UI version viewing access."* It receives `{ req }`. Returning a query *"will apply the constraint to the `versions` collection, not the original Collection."* Version history is reachable over the generated REST surface at `GET /api/{collection}/versions` and `GET /api/{collection}/versions/{id}`, and restore is `POST /api/{collection}/versions/{id}`.
- **How this project uses it:** `readVersions: isAdmin` on **every** versioned collection and on the `site-settings` global, stated explicitly. This matters because version rows are a **second copy of every DTCP/RERA approval number and land-title claim ever entered** — the Content-Management Matrix marks those "legally sensitive".
- **Limitation:** **The default value of `readVersions` when omitted is not documented.** The framework-wide default is `Boolean(user)`, so assume permissive until proven otherwise. It is a seventh, non-obvious access function that is easy to forget — which is why the Phase-2 config test asserts its presence.
- **Verification status:** PARTIALLY VERIFIED — the function is documented; its omitted default is not.

### 32.21 Collections, field types and admin-only field options
- **Official documentation topic:** Fields → Overview; Configuration → Collections
- **Source:** https://payloadcms.com/docs/fields/overview · https://payloadcms.com/docs/configuration/collections
- **What it confirms:** Data fields (require `name`, store data): `array`, `blocks`, `checkbox`, `code`, `date`, `email`, `group`, `json`, `number`, `point`, `radio`, `relationship`, `richText`, `select`, named `tabs`, `text`, `textarea`, `upload`. Presentational (store nothing): `collapsible`, `row`, unnamed `tabs`, unnamed `group`, `ui`. Virtual: `join`, plus any field with `virtual: true`. **Reserved field names, verbatim:** `__v`, `salt`, `hash`, `file`, and **`status` — "specifically when using the Postgres Adapter with drafts enabled"** — with the consequence *"Using reserved field names will result in your field being sanitized from the config."* Naming caveat, verbatim: *"Avoid field names that start with a digit… or contain hyphens… GraphQL identifiers do not allow hyphens."* Field `admin` options include `condition`, `description`, `position` (`'sidebar' | 'main'`), `width`, `readOnly` — *"Disables editability in Admin Panel **without affecting the API**"* — and `disabled` (*"Completely omits field from Admin Panel"*). Field-level `hidden` *"Restrict[s] visibility from APIs and Admin Panel"* and interacts with the Local API `showHiddenFields` option, which callers may set to `true`.
- **How this project uses it:** `Project.status` is renamed in Payload (drafts are enabled on `projects`, so the literal name `status` would be **silently stripped**) and mapped back to the public key `status` inside `toPublicProject()` — the frontend contract keeps `status`. `leads` carries no versions, so its status field is unaffected, but it is named explicitly rather than by accident. Unnamed `tabs`, `row` and `collapsible` give the large Project editor its layout with **zero** schema impact — named tabs would change the stored shape and the serialiser, so that choice is locked before migration 001. `admin.readOnly` is never load-bearing; §32.19's field `access` pair is.
- **Limitation:** `admin.readOnly`, `admin.condition` and `admin.disabled` are Admin-Panel concerns and bind nothing at the API. Field `hidden` is explicitly overridable by the caller via `showHiddenFields: true`, so it is not a security control either. The precise relationship between field `hidden` and `showHiddenFields` is NOT VERIFIED IN OFFICIAL DOCS.
- **Verification status:** VERIFIED

### 32.22 `text` with `hasMany: true` — the `string[]` contract *(depth)*
- **Official documentation topic:** Fields → Text; Database → Overview
- **Source:** https://payloadcms.com/docs/fields/text · https://payloadcms.com/docs/v3/fields/text.md · https://payloadcms.com/docs/database/overview
- **What it confirms:** Verbatim: **`hasMany` — "Makes this field an ordered array of text instead of just a single text."** Companions `minRows` (*"Minimum number of texts in the array, if `hasMany` is set to true"*) and `maxRows`. Adapter support is confirmed by exclusion: *"nearly every Payload feature is available in all of our officially supported Database Adapters… The only thing that is not supported in SQLite yet is the Point Field."* By contrast the Array field *"stores an array of **objects** containing fields that you define"* — i.e. `Array<{...}>`, not `string[]`.
- **How this project uses it:** `Project.description` is `{ name: 'description', type: 'text', hasMany: true, required: true, minRows: 1, maxLength: 2000 }`. `toPublicProject()` then passes `doc.description` straight through — identity, no `.map(r => r.value)`, no row-`id` stripping. This is **the Phase-1 D-015 gate**: `description` must round-trip as `string[]`, not `[{id,text}]`.
- **Limitation:** The docs describe the value only as *"an ordered array of text"*; the literal TypeScript `string[]` and the literal JSON `["a","b"]` are **NOT VERIFIED IN OFFICIAL DOCS** (no sample payload is printed). **How a `hasMany` text field is physically stored on Postgres — child table vs native `text[]` vs JSON — is NOT VERIFIED IN OFFICIAL DOCS**, and unlike Select the Text field exposes **no `dbName`**, so the table name (if there is one) is not controllable. Whether `minLength`/`maxLength` apply per entry or to the joined array is also NOT VERIFIED.
- **Verification status:** PARTIALLY VERIFIED — the API shape is documented, the storage shape is not. **The gate cannot hard-fail:** if the spike shows `hasMany` text behaves badly, the fallback is an array field with a single `text` sub-field plus one mapping line in the serialiser, which still yields `string[]`.

### 32.23 `select` fields and Postgres enums
- **Official documentation topic:** Fields → Select
- **Source:** https://payloadcms.com/docs/fields/select
- **What it confirms:** `options` is *"an array of strings, or an array of objects containing a `label` string and a `value` string."* `enumName` — *"Custom enum name for this field when using SQL Database Adapter (Postgres). Auto-generated from name if not defined."* `dbName` — *"Custom table name (**if `hasMany` set to `true`**)."* `admin.isClearable` and `admin.isSortable` (the latter only with `hasMany`). **Critical caveat, verbatim:** *"Option values should be strings that do not contain hyphens or special characters due to GraphQL enumeration naming constraints. Underscores are allowed."*
- **How this project uses it:** The 41-value `IconName` enum and the 4-value project category become `select` fields with **explicit `enumName`** (`enum_icon_name`, etc.). This is the only mechanism that closes the enum at **both** the API and the database — the Postgres enum type *is* the constraint, which removes the hand-written CHECK-constraint migration that D-011/R-4 had planned. `src/lib/icons.ts` holds the 41 values as the single source of truth and `scripts/checkIconDrift.ts` fails CI if it diverges from the frontend's `Icon.tsx`.
- **Limitation:** The hyphen prohibition is a **checkable blocker-in-waiting**: if any `IconName` value is kebab-case (`map-pin`), it cannot be used verbatim as a select value and the serialiser must translate — verify the 41 values against this rule before writing the field. **What happens to an existing Postgres enum when `options` are added, removed or renamed is NOT VERIFIED IN OFFICIAL DOCS** — neither the Select page nor the Migrations page documents `ALTER TYPE` behaviour. Spike one `migrate:create` after adding and after removing an option before committing.
- **Verification status:** PARTIALLY VERIFIED

### 32.24 Arrays, blocks and groups
- **Official documentation topic:** Fields → Array / Blocks / Group
- **Source:** https://payloadcms.com/docs/fields/array · https://payloadcms.com/docs/fields/blocks · https://payloadcms.com/docs/fields/group
- **What it confirms:** Array — *"a set of 'repeating' Fields. It stores an array of objects containing fields that you define."* Options `fields`, `minRows`, `maxRows`, `labels`, `interfaceName`, `dbName`, `admin.isSortable` (**sortable is the default**; set `false` to disable), `admin.initCollapsed`, `admin.components.RowLabel` with the official `useRowLabel` client component. Blocks — *"Unlike a simple array (where every item looks the same), blocks let you mix and match different content types in any order"*; each row carries `blockType`, optional `blockName`, and `id`. Named group — *"Groups field data into an object"*; **unnamed** group — *"not defining a `name` will render just the grouped fields (no nested object is created)."*
- **How this project uses it:** **Arrays** for every repeating list (`highlights`, `stats`, `proximity`, `amenities`, `approvals`, `locationHighlights`, `gallery`, `brochureImages`, `social`, `legalLinks`) — every row has the same shape, which is exactly what arrays are for, and drag-reorder inside a row set is free. **Named groups** for `cta {}` and `seo {}`, which reproduces `types/content.ts` exactly. **Unnamed groups / `row` / `collapsible`** for editor layout only. **Blocks: not used** — there is no page builder in the frontend, and blocks would inject `blockType`/`blockName`/`id` noise for the serialiser to strip. `blocksAsJSON`: **not enabled**.
- **Limitation:** `minRows`/`maxRows` are enforced *"during validation when a value is present"* — they are **not** a substitute for `required`; an absent array is not caught. **Array row `id` injection is NOT VERIFIED IN OFFICIAL DOCS** (it is confirmed for blocks, not stated for arrays) — the serialiser strips row ids defensively either way. `blocksAsJSON` is described in a single sentence with **no documented caveats and no migration path**; the absence of stated caveats is itself a reason to avoid it.
- **Verification status:** VERIFIED for behaviour; PARTIALLY VERIFIED for the stored row shape.

### 32.25 Globals
- **Official documentation topic:** Configuration → Globals; Hooks → Globals
- **Source:** https://payloadcms.com/docs/configuration/globals · https://payloadcms.com/docs/hooks/globals · https://payloadcms.com/docs/access-control/globals
- **What it confirms:** *"Globals correspond to a single Document stored in the database"* and generate Local, REST and GraphQL APIs. Documented options: `slug`, `fields`, `label`, `description`, `admin`, `hooks`, `access`, `versions`, `endpoints`, `graphQL`, `typescript`, `dbName`, `custom`, `lockDocuments`, `forceSelect`. Global hooks are a **shorter** set than collections: `beforeOperation`, `beforeValidate`, `beforeChange`, `afterChange`, `beforeRead`, `afterRead` — **no `afterOperation`, no delete hooks**, because globals cannot be deleted. `afterChange`'s documented purpose is verbatim our use case: *"Use this hook to purge caches of your applications, sync site data to CRMs, and more."* Design rule, verbatim: *"If you have more than one Global that share the same structure, consider using a Collection instead."* Versions on globals use **`max`**, not `maxPerDoc`, and restore is `payload.restoreGlobalVersion()`.
- **How this project uses it:** Exactly one global, `site-settings`, with `access: { read: () => true, update: isAdmin }`, `versions: { max: 50, drafts: false }` (rollback without a publish gate — a site-wide phone number should take effect immediately), and an `afterChange` revalidation hook that triggers a full-site revalidation rather than a per-project one.
- **Limitation:** **How globals are physically stored on Postgres is NOT VERIFIED IN OFFICIAL DOCS** — only `dbName` (*"auto-generated from slug"*) is exposed. The **default value of the global `max` option is not stated** — set it explicitly. Writing `maxPerDoc` on a global is a silent no-op. Globals default to `Boolean(user)` access, so a public global left at the default **403s every real visitor while working perfectly for the logged-in developer** — hence the integration test that hits every public global unauthenticated.
- **Verification status:** VERIFIED for the API surface; NOT VERIFIED for physical storage and the `max` default.

### 32.26 Hooks *(depth)*
- **Official documentation topic:** Hooks → Overview / Collections / Fields / Context
- **Source:** https://payloadcms.com/docs/hooks/overview · https://payloadcms.com/docs/hooks/collections · https://payloadcms.com/docs/hooks/fields · https://payloadcms.com/docs/hooks/context
- **What it confirms:** All hooks are **arrays** of sync or async functions. Collection hooks, complete: `beforeOperation`, `beforeValidate`, `beforeChange`, `afterChange`, `beforeRead`, `afterRead`, `beforeDelete`, `afterDelete`, `afterOperation`, `afterError`, plus the auth hooks `beforeLogin`, `afterLogin`, `afterLogout`, `afterMe`, `afterRefresh`, `afterForgotPassword`, `refresh`, `me`. Field hooks: `beforeValidate`, `beforeChange`, `afterChange`, `afterRead`, `beforeDuplicate`; *"These functions can optionally modify the return value of the field"* — a returned value **replaces** the field value. Blocking semantics, verbatim: *"If your hook returns a Promise (for example, if it's declared async), Payload will wait for it to resolve before continuing that lifecycle step"* and *"**Declaring a function with `async` does not make it 'synchronous.'**"* Data-shape warning, verbatim: *"On update operations, `data` contains only the fields being changed. It may omit `id` and any unchanged fields."* Performance guidance warns specifically against expensive logic in `beforeRead`, and Hook Context is the documented loop guard. `beforeDelete` and `afterForgotPassword` discard return values. Typed exports: `CollectionAfterChangeHook`, `FieldHook<DocumentType, ValueType, SiblingDataType>`, etc. `APIError` is imported from **`'payload'`** (not `'payload/errors'`, which is the v2 path).
- **How this project uses it:** Hooks are the **seam that replaces the service layer** — because the Payload Admin UI writes directly through the Local API and never touches our endpoints, audit (`hooks/audit.ts`), auth-event logging (`hooks/authEvents.ts`) and ISR revalidation (`hooks/revalidate.ts`) **must** be collection hooks, not endpoint logic (§12.7, §15). Also: `uploadGuard` (`beforeOperation`), `mediaDeleteGuard` (`beforeDelete`), `slugLock` and `leadNormalise`/`leadDedupe` (`beforeValidate`), `publishedAt` (`beforeChange`), `enqueueLeadNotification` (`afterChange`). Field-level `beforeValidate` normalisers run **before** server-side validation so the validator sees clean values.
- **Limitation:** **Which collection hooks run for drafts, versions and autosave is NOT VERIFIED IN OFFICIAL DOCS**, and **the hook-argument property that identifies an autosave write is not documented either** — both must be established empirically before autosave is ever enabled (§32.33). Field hooks must **never change the returned type**: *"Due to GraphQL's typed nature, changing the type of data that you return from a field will produce errors in the GraphQL API."* There are no field-level delete hooks. `beforeDuplicate` fires before both change hooks — relevant because duplicating a project with a unique slug collides unless handled.
- **Verification status:** VERIFIED for the hook inventory; NOT VERIFIED for draft/autosave hook behaviour.

### 32.27 Uploads *(depth)*
- **Official documentation topic:** Upload → Overview
- **Source:** https://payloadcms.com/docs/upload/overview
- **What it confirms:** `upload: true` or an options object on a collection. Enabling it does four documented things, including: *"`filename`, `mimeType`, and `filesize` fields will be automatically added"*, and the Default Fields table adds the rest — **`filename`, `mimeType`, `filesize`, `width`, `height`, `url`, `thumbnailURL` — "Added when: Uploads are enabled."** The complete collection option set includes `adminThumbnail`, `bulkUpload`, `cacheTags`, `constructorOptions`, `crop`, `disableLocalStorage`, `displayPreview`, `externalFileHeaderFilter`, `filesRequiredOnCreate`, `filenameCompoundIndex`, `focalPoint`, `formatOptions`, `handlers`, `imageSizes`, `mimeTypes`, **`pasteURL` ("Enabled by default")**, `resizeOptions`, `skipSafeFetch`, `allowRestrictedFileTypes` (default `false`), `staticDir`, `trimOptions`, `withMetadata`, `hideFileInputOnCreate`, `hideRemoveFile`, `modifyResponseHeaders`. Size limits live on the **root** config, not per collection: `buildConfig({ upload: { requestSizeLimit, limits: { fileSize }, abortOnLimit, useTempFiles, tempFileDir, safeFileNames, preserveExtension, responseOnLimit, uploadTimeout } })`, with documented defaults `requestSizeLimit: 50 MiB`, `limits.fileSize: 20 MiB`, `limits.files: 3`, `limits.fields: 20`, `limits.fieldSize: 1 MiB`, and **"File size limits reject by default"** with HTTP **413**. The documented way to control the stored filename is a `beforeOperation` hook setting `req.file.name`, and *"The filename from here will also be threaded to image sizes if they're enabled."*
- **How this project uses it:** **Two** upload collections, because one cannot express two `mimeTypes` allow-lists: `media` (images, `imageSizes`, crop/focal on) and `documents` (PDF only, `crop: false`, `focalPoint: false`, no `imageSizes`). Both set **`pasteURL: false`** explicitly. Root `upload` uses the higher 25 MiB ceiling with `abortOnLimit: true`, `useTempFiles: true`, `tempFileDir: '/tmp/payload-uploads'`, `responseOnLimit: 'That file is too large.'` (never echoing paths or bucket names); the tighter 10 MB image ceiling is enforced in `uploadGuard`. Storage keys are **UUIDs** written by `beforeOperation` on both `create` and `update`, with the original filename preserved in a separate read-only field.
- **Limitation:** **`pasteURL` is enabled by default** — left alone, an editor can pull arbitrary remote URLs into the media library, which contradicts the media security policy. A **per-collection `fileSize` limit is not documented** (`limits` is absent from the collection table), so the 10 MB/25 MB split is hook-enforced and the image case surfaces as a 400-class error rather than a true 413. **Payload's filename-generation algorithm and collision behaviour are NOT VERIFIED IN OFFICIAL DOCS** beyond the `overwriteExistingFiles` hint that the default is *"generating a new filename"*. **Whether `req.file.name` may contain `/` path separators is NOT VERIFIED** — so the key layout is a flat UUID under an adapter `prefix`, not a `yyyy/mm/` partition. **What happens to the old stored object after a replace is NOT VERIFIED IN OFFICIAL DOCS.**
- **Verification status:** VERIFIED for the option surface and auto-added fields; NOT VERIFIED for filename generation, path separators and replace semantics.

### 32.28 `mimeTypes` and file validation *(depth)*
- **Official documentation topic:** Upload → Overview (mimeTypes; Restricted File Types)
- **Source:** https://payloadcms.com/docs/upload/overview
- **What it confirms:** `mimeTypes` — *"Restrict mimeTypes **in the file picker**. This accepts an array of strings, which can be any valid mimetype or mimetype wildcards."* Payload also ships a restricted-file-type deny list (executables, scripts, `text/html`, `application/x-httpd-php`, `text/javascript`, `.ps1`, `.vbs`, `.hta`, `.reg`, and ~30 more), with the crucial conditional, verbatim: *"If your Collection has defined `mimeTypes` or has set `allowRestrictedFileTypes` to `true`, **restricted file verification will be skipped**."* **`image/svg+xml` is NOT on that deny list**, and Payload's own example is `mimeTypes: ['image/*']`, which **includes SVG**.
- **How this project uses it:** `mimeTypes: ['image/jpeg','image/png','image/webp','image/avif']` on `media` (SVG deliberately absent) and `['application/pdf']` on `documents`, with `allowRestrictedFileTypes: false`. Everything else is ours, in `hooks/uploadGuard.ts` via `beforeOperation`: magic-byte sniff (`src/media/sniff.ts`), declared-vs-actual MIME mismatch → **415**, hard SVG rejection as belt-and-braces, `sharp().metadata()` dimension read with a 10 000 px decompression-bomb guard, EXIF strip by re-encode, then the UUID rename. Because defining `mimeTypes` **disables** Payload's own restricted-type check, the allow-list is deliberately narrower than Payload's deny-list and widening it requires review.
- **Limitation:** The documented semantics are *"in the file picker"* — the docs **never state that `mimeTypes` is enforced server-side on a raw `multipart/form-data` POST**, so server-side enforcement is unproven. **There is no documented magic-byte sniffing, EXIF handling, dimension guard or re-encode facility anywhere in Payload.** The docs put the onus on us explicitly: *"Ensure that files match the specified mimeTypes or sizes defined in the collection's `formatOptions` or custom `hooks`."* Any claim that "Payload blocks dangerous file types for us" is **wrong for SVG**.
- **Verification status:** VERIFIED for the deny list and the skip conditional; NOT VERIFIED for server-side `mimeTypes` enforcement.

### 32.29 S3 storage adapter *(depth)*
- **Official documentation topic:** Upload → Storage Adapters
- **Source:** https://payloadcms.com/docs/upload/storage-adapters
- **What it confirms:** Package **`@payloadcms/storage-s3`**, export **`s3Storage()`**, registered in `plugins`. Top-level options: `enabled` (default `true`), `collections`, `bucket`, `config` (*"`S3ClientConfig` object passed to the AWS SDK client"*), `acl` (*"e.g. `'public-read'`"*), `clientUploads`, `signedDownloads`, `useCompositePrefixes`. Per-collection options: `adapter`, `disableLocalStorage`, `disablePayloadAccessControl`, `generateFileURL`, `prefix`. Verbatim: *"When enabled, this package will automatically set `disableLocalStorage` to `true` for each collection."* And the pass-through behaviour that governs URLs, verbatim: *"by default, this plugin **keeps all file URLs exactly the same**… all uploads will still be reached from the default `/collectionSlug/staticURL/filename` path. This plugin will 'pass through' all files… with the added benefit of keeping your existing Access Control in place."* Setting `disablePayloadAccessControl: true` *"will update your file URLs to point directly to your cloud host."* The documented conditional-enable mechanism, verbatim: *"The proper way to conditionally enable/disable this plugin is to use the `enabled` property."* Other official adapters: `@payloadcms/storage-vercel-blob`, `-azure`, `-gcs`, `-uploadthing`, `-r2`, plus `@payloadcms/plugin-cloud-storage` for custom adapters.
- **How this project uses it:** `src/media/storage.ts`:
  ```ts
  s3Storage({
    enabled: Boolean(env.S3_BUCKET),          // absent locally -> plugin inert -> local disk
    collections: {
      media:     { prefix: 'media',     disablePayloadAccessControl: true, generateFileURL },
      documents: { prefix: 'documents', disablePayloadAccessControl: true },
    },
    bucket: env.S3_BUCKET,
    acl: 'public-read',
    config: {
      region: env.S3_REGION,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      endpoint: env.S3_ENDPOINT,              // AWS-SDK pass-through, see Limitation
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  })
  ```
  The plugin is **always registered** and switched by `enabled`, never conditionally included — a config whose *shape* varies by environment generates divergent migrations between machines (§32.7). For Cloudflare R2 on a self-hosted Node server we use `storage-s3` with a custom `endpoint`, **not** `storage-r2`, which the docs scope to *"(Cloudflare Workers environment)"*.
- **Limitation:** **`endpoint` and `forcePathStyle` are never named in Payload's own documentation** — they are valid only by virtue of the `S3ClientConfig` pass-through, and are therefore NOT VERIFIED IN OFFICIAL PAYLOAD DOCS. The **exact signature of `generateFileURL` is not published** (only the type name and a one-line description) — verify against the generated `.d.ts` before relying on destructured argument names. `s3Storage()` exposes **no way to set `Cache-Control`** on the uploaded object and no `expiresIn` for signed URLs; with `disablePayloadAccessControl: true` Payload is out of the serving path, so `Cache-Control`, `X-Content-Type-Options: nosniff` and `Content-Disposition` must come from the bucket policy or CDN — `upload.modifyResponseHeaders` only covers the Payload-served path. **Making a bucket public, CDN setup and S3 CORS are not documented at all.**
- **Verification status:** VERIFIED for the Payload-documented options; NOT VERIFIED for `endpoint`/`forcePathStyle`/`generateFileURL`'s signature.

### 32.30 `imageSizes` and `sharp`
- **Official documentation topic:** Upload → Overview (Image Sizes); Configuration → Overview (`sharp`)
- **Source:** https://payloadcms.com/docs/upload/overview#image-sizes · https://payloadcms.com/docs/configuration/overview
- **What it confirms:** *"If you specify an array of `imageSizes`… Payload will automatically crop and resize your uploads."* And: *"**Note that for image resizing to work, `sharp` must be specified in your Payload Config.**"* `sharp` is a top-level config option and must be **imported and passed**, not merely installed. `withoutEnlargement`, verbatim: *"1. `undefined` [default]: uploading images with smaller width AND height than the image size **will return null**; 2. `false`: always enlarge; 3. `true`: if the image is smaller… return the original image."* Per-size `generateImageName`, and per-size `admin.disableListColumn` / `disableListFilter` / `disableGroupBy`. Resized buffers are exposed in hooks at `req.payloadUploadSizes`. Crop ordering, verbatim: *"Image cropping occurs before any resizing, the resized images will therefore be generated from the cropped image (not the original image)."*
- **How this project uses it:** `import sharp from 'sharp'` and `sharp` passed to `buildConfig`. Exactly **one** `imageSizes` entry — `thumbnail` (400×300, `position: 'centre'`, **`withoutEnlargement: true`**) — purely to feed `adminThumbnail`. Responsive variants are `next/image`'s job at the edge; generating card/tablet/hero sizes would duplicate that work and multiply S3 objects and orphan-cleanup surface fourfold. `sharp().metadata()` is used directly in `src/media/dimensions.ts` for our own dimension capture.
- **Limitation:** The default `withoutEnlargement: undefined` means **a size silently becomes `null`** for any image smaller than the target in both dimensions — set `true` on every size or small logos produce broken admin thumbnails with no error. **The JSON shape of the generated `sizes` object is not published** — no example exists; read it off the generated types. **`fit`/`position` allowed values are sharp's, not enumerated by Payload.** **Sharp's native-binary / Alpine-musl / cross-architecture deployment caveats are NOT VERIFIED IN OFFICIAL DOCS** — sharp is the most common native-dependency failure in containerised Node builds, so the deploy smoke test must include a real image upload.
- **Verification status:** VERIFIED for the option surface; NOT VERIFIED for the `sizes` response shape and native-build caveats.

### 32.31 Drafts and versions *(depth)*
- **Official documentation topic:** Versions → Overview / Drafts
- **Source:** https://payloadcms.com/docs/versions/overview · https://payloadcms.com/docs/versions/drafts · https://payloadcms.com/docs/v3/versions/drafts.md
- **What it confirms:** `versions: true` or an object. Collection option **`maxPerDoc`** — *"control how many versions to keep on a document by document basis"*, **default `100`**, *"use `0` to save all versions"*; global option is **`max`**. `drafts` sub-options: `autosave` (default `false`), `validate` (*"Set `validate` to `true` to validate draft documents when saved. **Default is `false`**"*), `schedulePublish`, `localizeStatus` (**Beta**). Payload injects **`_status`** with values `'draft' | 'published'`; the Admin UI derives three display states (Draft / Published / Changed). The `draft` parameter, verbatim: *"1. **Validation**: When `draft: true`, required fields are not enforced… 2. **Write location**: Determines whether the main collection document is updated."* And two statements that must be read together: *"When you fetch the document with a standard `find` or `findByID` operation, the published document from the main collection is returned"* **and** *"When you first create a document, it's always written to the main collection"* (with `_status: 'draft'`), **and** the explicit warning: *"the `draft` argument on its own will not restrict documents with `_status: 'draft'` from being returned from the API. You need to use Access Control to prevent documents with `_status: 'draft'` from being viewed by unauthenticated users."* Version documents have exactly `_id`, `parent` (collections only), `autosave`, `version`, `createdAt`, `updatedAt`.
- **How this project uses it:** `versions: { maxPerDoc: 20, drafts: { autosave: false, validate: true, schedulePublish: false } }` on `projects` and the Tier-2 content collections; **no versions on `leads`, `audit-log`, `users` or `media`** (versioning a PII table multiplies PII copies). `site-settings` uses `versions: { max: 50, drafts: false }`. `_status` is stripped from every public response by `toPublicProject()`.
- **Limitation:** **A normal `find()` returns never-published and unpublished documents**, because their *main row* carries `_status: 'draft'`. Drafts alone are not a public filter — hence the three-layer rule in §32.18. **What mechanism prunes versions when `maxPerDoc` is exceeded (synchronous, batched, background) is NOT VERIFIED IN OFFICIAL DOCS** — neither is whether `_status` is indexed, nor the default of the global `max`, nor whether enabling versions on an already-populated collection needs a bespoke data migration. **Version documents store no acting user, no IP and no action type** — see §32.53 row CONF-14, which is why the audit log is a separate collection fed by hooks. Do **not** copy the documented `_status: { exists: false }` OR-branch (it exists for collections that pre-date drafts); enabling drafts from migration 001 means no `_status`-less rows ever exist.
- **Verification status:** VERIFIED for the mechanism; NOT VERIFIED for pruning, `_status` indexing and the global `max` default.

### 32.32 Publish / unpublish
- **Official documentation topic:** Versions → Drafts; Configuration → Globals (component slots)
- **Source:** https://payloadcms.com/docs/versions/drafts · https://payloadcms.com/docs/configuration/globals
- **What it confirms:** Publishing is `data: { _status: 'published' }` on a create or update. In the Admin UI *"the typical Save button is replaced with new actions which allow you to either save a draft, or publish your changes."* **Unpublish is documented** — it *"reverts a document to draft by setting `_status: 'draft'`"* — and when a published document has newer drafts, a *"revert to published"* action rejects the draft changes while keeping the drafts saved. The UI is componentised: `SaveButton`, `SaveDraftButton`, `PublishButton`, `UnpublishButton`, `PreviewButton`, `Status`.
- **How this project uses it:** Payload's native `_status` is the publish mechanism. If the admin publish/unpublish endpoints documented in `API-CONTRACT.md` are retained at all, they are thin shims that call `payload.update({ data: { _status: 'published' }, overrideAccess: false, user: req.user })` — **and the audit entry and the revalidation call live in the collection's `afterChange` hook, never in the endpoint**, because the Admin UI publishes through its own button and never touches our endpoints. There is no publish timestamp: a separate `publishedAt` date field is stamped by `hooks/publishedAt.ts` on the draft → published transition.
- **Limitation:** **Multi-step approval workflows are Enterprise-only** (https://payloadcms.com/enterprise/publishing-workflows) — *"multi-step approval processes"* and *"Specify approval stages down to the field level"* are not in open-source Payload. Our requirements do not ask for one, but it must not be assumed available. Payload produces **no publish date** of its own.
- **Verification status:** VERIFIED

### 32.33 Autosave
- **Official documentation topic:** Versions → Autosave
- **Source:** https://payloadcms.com/docs/versions/autosave
- **What it confirms:** `versions.drafts.autosave` accepts `true` or `{ interval, showSaveDraftButton }`; **`interval` defaults to `800` ms**. *"Autosave relies on Versions and Drafts being enabled."* On table growth, verbatim: *"Instead of creating a new version each time a document is autosaved, Payload smartly only creates **one** autosave version, and then updates that specific version with each autosave performed."*
- **How this project uses it:** **`autosave: false`, deliberately, with the reason recorded** (§12.3). Every autosave is a real database write that fires the collection's `afterChange` hooks — and §12.7 puts the audit log and the ISR revalidation webhook in exactly those hooks. With autosave on at the default interval, an editor typing a paragraph into `description` would produce an audit row and a revalidation call roughly once a second.
- **Limitation:** The docs give **no performance or write-load warning at all**. **Whether a new autosave version is created after each publish (i.e. whether the single-version reuse resets per publish cycle) is NOT VERIFIED IN OFFICIAL DOCS**, and **the hook-argument property that identifies an autosave write is not documented** — so "make the audit hook skip autosaves" is an empirical task, not a config change. Autosave combined with the default `validate: false` would let an editor autosave a half-finished, legally-sensitive record into the versions table.
- **Verification status:** VERIFIED for the option; NOT VERIFIED for the autosave lifecycle and the hook-side signal.

### 32.34 Scheduled publish
- **Official documentation topic:** Versions → Drafts (`schedulePublish`); Jobs Queue → Schedules
- **Source:** https://payloadcms.com/docs/versions/drafts · https://payloadcms.com/docs/jobs-queue/schedules
- **What it confirms:** `versions.drafts.schedulePublish: true` on collections and globals. *"This feature works by creating a Job in the background, which will be picked up after the job becomes available."* The documented warning, verbatim: *"if you are going to enable scheduled publish / unpublish, you need to make sure your Payload app is set up to process Jobs… **If you do not have any mechanism in place to run jobs, your scheduled publish / unpublish jobs will never be executed.**"*
- **How this project uses it:** **`schedulePublish: false`.** No requirement in `REQUIREMENTS.md` asks for scheduled publishing; enabling it would be scope creep with a hard runtime dependency. If it is ever requested, the minimum wiring is the bin-script worker already specified in §13.5 plus `--handle-schedules` on exactly one process.
- **Limitation:** The dependency fails **silently**: the UI accepts a schedule that never fires, and there is no documented safety net. Running both the `handle-schedules` bin script **and** `autoRun` for the same queue is a documented footgun that duplicates queued jobs.
- **Verification status:** VERIFIED

### 32.35 Trash (soft delete)
- **Official documentation topic:** Trash → Overview; Configuration → Collections; Fields → Default Fields
- **Source:** https://payloadcms.com/docs/trash/overview · https://payloadcms.com/docs/configuration/collections · https://payloadcms.com/docs/fields/default-fields
- **What it confirms:** Soft delete is **native**. Collection option `trash` — *"A boolean to enable soft deletes for this collection. **Defaults to `false`**."* Verbatim: *"Trash (also known as soft delete) allows documents to be marked as deleted without being permanently removed. When enabled on a collection, deleted documents will receive a **`deletedAt`** timestamp, making it possible to restore them later, view them in a dedicated Trash view, or permanently delete them."* Payload *"automatically injects a `deletedAt` field"*, sets it on soft delete and clears it on restore. A `Trash` admin view lists documents carrying the timestamp, with Restore and permanent-Delete actions. `trash: true` plus a `where` on `deletedAt` existence returns only soft-deleted rows. The collection `delete` access function receives `data` — *"For Trash-enabled collections, check `data.deletedAt` to differentiate between soft delete and permanent delete operations."*
- **How this project uses it:** `trash: true` on `projects`, `leads`, `media`, `documents`, `testimonials`, `faqs` and `statistics`; explicitly **`trash: false`** on `users` (deactivate, never delete, so audit attribution survives) and on `audit-log`. This satisfies D-006's intent natively and removes a hand-rolled duplicate. The admin list hides trashed rows via `admin.baseFilter`.
- **Limitation:** It **defaults to `false`**, so silence means hard delete — every collection must state it explicitly. The option for a default list filter is **`baseFilter`**, *not* `baseListFilter`; any project document using the latter spelling is out of date. Documented interaction with versions: a trashed document *"can no longer have a version **restored** until it is first restored from trash"* — the restore UI copy and `API-CONTRACT.md`'s `POST /admin/projects/{id}/restore` must say so. Trash does **not** give referential integrity: it makes an `ON DELETE RESTRICT` guard inert, because a soft delete is an update.
- **Verification status:** VERIFIED

### 32.36 Document ordering — `orderable` and fractional indexing
- **Official documentation topic:** Configuration → Collections (Orderable, Fractional indexing); Queries → Sort
- **Source:** https://payloadcms.com/docs/configuration/collections · https://payloadcms.com/docs/queries/sort · https://payloadcms.com/docs/fields/join
- **What it confirms:** Collection option `orderable` — *"If true, enables custom ordering for the collection, and documents can be reordered via drag and drop."* And verbatim: *"When `orderable` is enabled, Payload uses **fractional indexing** to efficiently manage document order. When enabled on collections, this allows you to manually drag and drop documents in the Admin Panel to reorder them, as well as programmatically set the order of documents via the Local API, REST API, or GraphQL API."* Key generators are exported: `import { generateKeyBetween, generateNKeysBetween } from 'payload/shared'`. `orderable` is also available on the `join` field. Separately, `defaultSort` — *"Pass a top-level field to sort by default in the Collection List View. Prefix the name of the field with a minus symbol ('-') to sort in descending order"* — and query-time `sort: ['priority', '-createdAt']` / `sort=priority,-createdAt`.
- **How this project uses it:** `orderable: true` on `projects`. This is the capability that got a competing CMS rejected and that D-005 makes a first-class requirement, so we take the native mechanism rather than re-hand-rolling it. The integer `sort_order` / `sortOrder` is **deleted** from the schema, the validation rules and the API contract; the fractional key is an internal ordering device and is **never** emitted publicly (`types/content.ts` has no such field). If the documented `PATCH /admin/projects/order` path is retained, it is a shim converting positional integers to fractional keys with `generateNKeysBetween`.
- **Limitation:** **The name of the field/column that `orderable` creates is NOT VERIFIED IN OFFICIAL DOCS** — the page describes fractional indexing and exposes the key generators but never names the property; a `grep` for `_order` across the full docs bundle returns **nothing**. Since the public projects endpoint must return catalogue order, that name is needed for `sort` — resolve it by enabling `orderable: true` in the Phase-1 spike and reading `npx payload generate:db-schema` output. Fractional keys are **strings, not integers**. `defaultSort` takes **top-level** fields only, and sorting cannot use virtual fields unless relationship-linked.
- **Verification status:** PARTIALLY VERIFIED — the capability is documented, the order field's name is not.

### 32.37 Indexes and unique constraints
- **Official documentation topic:** Database → Indexes
- **Source:** https://payloadcms.com/docs/database/indexes · https://payloadcms.com/docs/configuration/collections
- **What it confirms:** Field-level `index: true`. Verbatim: *"The `id`, `createdAt`, and `updatedAt` fields are indexed by default."* Compound indexes are a collection option: `indexes: [{ fields: ['title', 'createdAt'], unique: true }]` — *"either to speed up querying/sorting by 2 or more fields at the same time or to ensure uniqueness between several fields."* `unique: true` *"creates a **collection-wide** database unique index on that field's path."* And the nested warning, verbatim: *"Using `unique` on fields nested inside `array` or `blocks` creates a collection-wide unique index on the dotted path (e.g. `items.key`). This is **not** the same as enforcing uniqueness within a single document's array rows… If you need to enforce uniqueness _within_ a document's array rows, use a custom `validate` function on the array field instead."*
- **How this project uses it:** `projects.slug` → `unique: true, index: true`. `leads.phoneNormalised` → `index: true` but **explicitly not unique** (one buyer may enquire on several projects). The time-windowed lead dedupe is a compound **non-unique** index `[{ fields: ['phoneNormalised', 'projectSlug'] }]` plus application logic in `hooks/leadDedupe.ts` — a windowed uniqueness constraint is not expressible as a Postgres partial unique index because the predicate is non-immutable. `featured`, `category`, `leadStatus`, `source` get `index: true`. Anything beyond "these columns, optionally unique" goes through `afterSchemaInit` + `extendTable` or raw SQL in a migration (§16.5).
- **Limitation:** **No partial, conditional or expression indexes are expressible** through `index`/`indexes`. **Payload's index-naming scheme is not documented**, which matters when hand-writing a `down` that drops an index — NOT VERIFIED IN OFFICIAL DOCS. **Whether the compound-index `fields` array accepts dotted paths into groups/arrays is NOT VERIFIED.** A well-meaning `unique: true` on a nested array field (e.g. `proximity.place`) would silently make that value unique across **all** projects — forbid nested `unique` in the review checklist.
- **Verification status:** VERIFIED for the mechanism; NOT VERIFIED for index naming and dotted-path compound indexes.

### 32.38 Query shaping — `select`, `populate`, `depth`, pagination, and the omit-don't-empty gap
- **Official documentation topic:** Queries → Select / Depth / Pagination / Sort
- **Source:** https://payloadcms.com/docs/queries/select · https://payloadcms.com/docs/queries/depth · https://payloadcms.com/docs/queries/pagination
- **What it confirms:** `select` has include mode (`{ text: true, group: { number: true } }`) and exclude mode; *"the `id` field is **always** included in the result, regardless of your select query"*; an empty `select: {}` returns only the id. Collection options `defaultPopulate` (*"Specify which fields to select when this Collection is populated from another document"*) and `forceSelect` (*"which fields should be selected always, regardless of the `select` query"*). Query-time `populate` is keyed by **collection slug** and overrides `defaultPopulate`. Upload caveat, verbatim: when selecting `url` you must *"specify `filename: true` as well"*, *"otherwise Payload will not be able to construct the correct file URL, instead returning `url: null`."* Hook caveat, verbatim: *"your `beforeRead` and `afterRead` hooks may not receive the full doc"* because *"Payload implements your select query on the database level."* Pagination returns exactly ten keys: `docs`, `totalDocs`, `limit`, `totalPages`, `page`, `pagingCounter`, `hasPrevPage`, `hasNextPage`, `prevPage` (`number | null`), `nextPage` (`number | null`); default `limit` is **10**; `pagination: false` and `limit: 0` skip the counting work. `maxDepth` is the application-wide ceiling and *"defaults to `10`"*.
- **How this project uses it:** **Include mode only** — exclude mode is a deny-list and would silently leak every field added in future. `defaultPopulate` on `media` keeps populated upload payloads minimal, and `filename: true` is always selected alongside `url`. `maxDepth: 3`, `defaultDepth: 1`. `toPublicMeta()` renames Payload's pagination keys, never spreads them, and **omits** `next_page`/`prev_page` rather than emitting `null`.
- **Limitation:** **This is the evidence for D-008. `select` controls which fields are *queried*, not which keys are *emitted*: a selected-but-empty field still returns as `null`, and `id` can never be excluded.** Payload offers **no** mechanism anywhere — not `select`, not `populate`, not `forceSelect`, not field `hidden`, not `depth`, not `afterRead` — that omits a key because its value is empty. Payload's own pagination shape emits `prevPage: null` / `nextPage: null`, which violates our contract directly. Therefore the omit-don't-empty rule is **100 % hand-written** in `serializers/put.ts` + `toPublicProject()`, built key by key, with `...doc` spread banned in that directory and a key-set snapshot test on the thin record `siri-vanam-gummadavelli`. **`select` on `create`/`update` is NOT VERIFIED IN OFFICIAL DOCS**, and **the exact response shape when `pagination: false` / `limit: 0` is NOT VERIFIED.**
- **Verification status:** VERIFIED — including the verified **absence** of any omit-empty-keys facility.

### 32.39 Jobs queue *(depth)*
- **Official documentation topic:** Jobs Queue → Overview / Tasks / Workflows / Jobs / Queues / Schedules
- **Source:** https://payloadcms.com/docs/jobs-queue/overview · https://payloadcms.com/docs/jobs-queue/tasks · https://payloadcms.com/docs/jobs-queue/jobs · https://payloadcms.com/docs/jobs-queue/queues · https://payloadcms.com/docs/jobs-queue/quick-start-example
- **What it confirms:** A top-level `jobs` key on `buildConfig`. Documented members: `tasks`, `workflows`, `autoRun` (`{ cron, queue, limit, disableScheduling }`), `shouldAutoRun`, `access.queue` / `access.run` / `access.cancel` (*"These functions receive the current `req` and return a boolean. By default, they allow authenticated users"*), `processingOrder`, `jobsCollectionOverrides`, `enableConcurrencyControl` (v3-only), `addParentToTaskLog`. Task config: `slug`, `handler`, `inputSchema`, `outputSchema`, `interfaceName`, `label`, `onFail`, `onSuccess`, `retries`, `concurrency`, `schedule`. Handler receives `{ input, job, req, tasks, inlineTask }` and *"should return an object with an `output` key."* Typed via `TaskConfig<'slug'>` / `TaskHandler<'slug'>`. Queue with `payload.jobs.queue({ task, input, queue, waitUntil, req })`. Jobs live in the **`payload-jobs`** collection with fields `taskSlug`, `input`, `completedAt`, `hasError`, `error`, `totalTried`, `processing`, `waitUntil`, `queue`, `taskStatus`, `log`, `processingErrors`. The docs answer our exact design question by name, verbatim: *"Why not just send the email directly in the `afterChange` hook? — **Non-blocking**… **Resilience**… **Scalability**… **Monitoring**: All jobs are tracked in the database, so you can see if emails failed and why."* And the Hooks page: *"If your hooks perform any long-running tasks that don't directly affect the request lifecycle, consider offloading them to the jobs queue."* Idempotency warning, verbatim: *"Tasks should be idempotent when possible… because retries might cause the task to run more than once."*
- **How this project uses it:** Payload's Jobs Queue **replaces** the hand-designed `notification_jobs` table entirely — same concept, already built, typed, with retries and an admin surface. One task, `sendLeadNotification`, with `inputSchema` of `{ leadId }` only (the docs' own advice: *"Pass just the ID… Task fetches what it needs"*), `retries: 3`, and idempotency via a `notifiedAt` short-circuit on the lead. Enqueued from `Leads.afterChange` inside a `try/catch` so an enqueue failure logs and never fails the public request. `jobs.access.run` requires either `req.user` or `Authorization: Bearer ${CRON_SECRET}`. `jobsCollectionOverrides` re-opens **read-only** admin visibility so the sales team can see a failed notification.
- **Limitation:** **There is no single consolidated "Jobs Config" options table anywhere** — the options are scattered across five pages and several appear only inside code comments; `jobs` does not appear at all on the Configuration Overview page. **`jobs.deleteJobOnComplete`, `jobs.depth` and `jobs.runHooks` are NOT VERIFIED IN OFFICIAL DOCS** — the retention *behaviour* is described (*"you can decide to keep a running list of all jobs, or configure Payload to delete the job when it has been successfully executed"*) but the config key is never named, so the default (keep vs delete) cannot be stated. `onFail` / `onSuccess` are listed with **no signature, no arguments and no example**. The `payload-jobs` collection *"is hidden from the Admin Panel and denies generic access by default"*, and the docs warn against generic CRUD on it: *"Calling generic Local API, REST, or GraphQL CRUD directly on `payload-jobs` is not recommended because it bypasses the job operations."*
- **Verification status:** VERIFIED for the documented surface; NOT VERIFIED for retention configuration and the `onFail`/`onSuccess` contracts.

### 32.40 Job retries, runners and monitoring
- **Official documentation topic:** Jobs Queue → Tasks (Retries); Jobs Queue → Queues (Running jobs)
- **Source:** https://payloadcms.com/docs/jobs-queue/tasks · https://payloadcms.com/docs/jobs-queue/queues · https://payloadcms.com/docs/jobs-queue/schedules
- **What it confirms:** `retries` is a number or an object whose **only** documented property is `shouldRestore`. Semantics, verbatim: *"If this is undefined, the task will either inherit the retries from the workflow or have no retries. If this is `0`, the task will not be retried."* Failure is signalled by **throwing**; the documented sequence ends *"After all retries are exhausted, the task and job fail"*, leaving `hasError: true`, an `error` field and log entries with `state === 'failed'`. A handler may abort retrying entirely with `throw new JobCancelledError('…')`. Four documented execution methods with an explicit decision table: **bin script** (*"Dedicated servers (Recommended)"*, *"Runs completely independently from your Next.js server"*), **`autoRun`** (*"**Never use `autoRun` on serverless platforms**"*), **HTTP endpoint** `GET /api/payload-jobs/run?queue=&limit=&allQueues=` (default `limit` **10**, always checks `jobs.access.run`), and **Local API** `payload.jobs.run() / runByID() / handleSchedules() / cancel() / cancelByID()`. Official compose snippet: `command: pnpm payload jobs:run --cron "*/5 * * * *" --queue default`. Documented footguns: *"Using both the `handle-schedules` bin script AND `autoRun` for the same queue, causing duplicate jobs to be queued"* and *"If multiple servers are handling schedules, they might each queue jobs. Solution: Only enable schedule handling on one server."* Dev-mode note, verbatim: *"Hot Module Reload (HMR) in Next.js disrupts cron schedules… Restart your dev server."*
- **How this project uses it:** Self-hosted, long-running containers, so the docs' top recommendation applies: **two supervised worker containers** — `worker-default` (`npx payload jobs:run --cron "* * * * *" --queue default --limit 25`) and `worker-maintenance` (`--cron "*/15 * * * *" --queue maintenance --handle-schedules`), schedule handling enabled on **exactly one**. In tests, never wall-clock cron: queue then `payload.jobs.runByID({ id })`. The `autoRun` fallback exists but is gated by `shouldAutoRun: async () => env.ENABLE_JOB_WORKERS === 'true'` so only one instance ever runs jobs.
- **Limitation:** **There is no documented backoff of any kind** — no `retries.attempts`, no `retries.backoff`, no `retries.delay`, no `maxRetries`; the word "backoff" appears in the v3 corpus zero times. **There is no dead-letter queue**: an exhausted job simply sits with `hasError: true` and nothing notifies anybody. **Retry re-eligibility timing is undocumented.** **There is no jobs dashboard, no failure widget, no alerting and no admin retry button.** And https://payloadcms.com/docs/production/deployment contains **no mention of jobs, workers or cron at all**. These gaps are why §13.6 makes three things named deliverables rather than assumptions: a watchdog task that queries for failed `sendLeadNotification` jobs and alerts through a second channel, worker liveness monitoring, and queue-depth / oldest-pending-job alarms. Every CLI example in the docs is `pnpm payload …`; **the npm/npx equivalents are NOT VERIFIED IN OFFICIAL DOCS** and must be proven once, in Phase 2, and written down.
- **Verification status:** VERIFIED for retries-as-a-count and the runner options; NOT VERIFIED for backoff, DLQ, retry timing and npm CLI equivalence.

### 32.41 Email adapters
- **Official documentation topic:** Email → Overview; Authentication → Email
- **Source:** https://payloadcms.com/docs/email/overview · https://payloadcms.com/docs/authentication/email
- **What it confirms:** Two official adapters: **`@payloadcms/email-nodemailer`** exporting `nodemailerAdapter` (*"Use any Nodemailer transport, including SMTP, Resend, SendGrid, and more… This is the easiest migration path"*) and **`@payloadcms/email-resend`** exporting `resendAdapter` (*"preferred for serverless platforms such as Vercel"*). Both **require** `defaultFromName` and `defaultFromAddress`. Nodemailer takes `transport` or `transportOptions`. Sending is `payload.sendEmail({ to, subject, html | text })`. Dev convenience, verbatim: *"During development, if you pass nothing to `nodemailerAdapter`, it will use the ethereal.email service."* Templating, verbatim: *"**Payload doesn't ship with an HTML templating engine, so you are free to choose your own.**"* Auth emails are customisable via `auth.forgotPassword.generateEmailHTML` / `generateEmailSubject` (and the same pair under `auth.verify`), with a **built-in reset page** at `${serverURL}/admin/reset/${token}`.
- **How this project uses it:** `nodemailerAdapter` with SMTP, because we are self-hosted and SMTP makes the provider an env-var decision rather than a blocking open question — SES, Postmark, SendGrid and Resend all speak SMTP. Local and staging pass **no** transport options, so ethereal.email is used and *"staging must not send real notifications"* is satisfied by the documented mechanism. `src/email/renderBrandedEmail.ts` is the one shared layout function the docs recommend (*"a reusable function that standardizes all email sent from Payload"*), and `src/email/escapeHtml.ts` is a single reviewed, unit-tested helper.
- **Limitation:** **With no adapter configured, Payload logs a warning rather than throwing** — verbatim: *"Payload will log a warning on startup notifying that email is not configured. A warning message will also be logged on any attempt to send an email."* For a lead-generation product that is the only unacceptable failure mode, so §14.5 adds a **boot-time assertion** that refuses to start in production without `SMTP_HOST` and `SALES_NOTIFICATION_EMAIL`, and the task asserts a provider result before reporting success. **Whether `payload.sendEmail()` throws or resolves on a transport failure, and what it returns on success, is NOT VERIFIED IN OFFICIAL DOCS** — verify empirically in Phase 1. The full `sendEmail` argument list (CC/BCC/replyTo/headers) is not enumerated. Payload supports *"a single transporter of email"* — one From identity, no transactional/marketing split. **Payload provides zero HTML escaping**, and lead `name`/`message` are attacker-controlled free text going into an HTML email read by staff.
- **Verification status:** VERIFIED for the adapters; NOT VERIFIED for `sendEmail` failure semantics.

### 32.42 CORS and CSRF
- **Official documentation topic:** Configuration → Overview (`cors`, `csrf`); Authentication → Cookies; REST API → Overview
- **Source:** https://payloadcms.com/docs/configuration/overview · https://payloadcms.com/docs/authentication/cookies · https://payloadcms.com/docs/rest-api/overview · https://payloadcms.com/docs/production/preventing-abuse
- **What it confirms:** `cors` accepts three shapes — `'*'`, an array of origins, or `{ origins, headers }`. `csrf` is a **flat array of origin strings**: *"A whitelist array of URLs to allow Payload to accept cookies from"*, and *"`config.serverURL` is added by default if defined."* Why it matters, verbatim: browsers *"automatically will include cookies when sending requests to your domain - **no matter what page created the request**."* Cross-origin browser calls need `fetch(url, { credentials: 'include' })`. And the statement that governs our whole public surface, verbatim: **"By default, custom endpoints don't handle CORS headers in responses. The `headersWithCors` function checks the Payload config and sets the appropriate CORS headers in the response accordingly."** Usage: `import { headersWithCors } from 'payload'` then `return Response.json(body, { headers: headersWithCors({ headers: new Headers(), req }) })`.
- **How this project uses it:** `cors: { origins: env.CORS_ORIGINS, headers: [] }` and `csrf: env.CSRF_ORIGINS`, both env-driven comma-separated lists, **never `'*'`**. Because every public route is our own handler, CORS on the public surface is **code, not configuration**: the single `definePublicEndpoint()` wrapper applies the CORS headers so they cannot be forgotten, and the Phase-10 test asserts that `POST /api/v1/leads` succeeds from the public site origin **in a real browser context** and fails from an unlisted one — a curl test passes either way and proves nothing.
- **Limitation:** `csrf` is **origin/referer allow-list based**, not a synchroniser-token or double-submit scheme; the docs never mention CSRF tokens. Whether `csrf` supports wildcards, and what status a rejected origin receives, are **NOT VERIFIED IN OFFICIAL DOCS**. **Preflight (`OPTIONS`) behaviour for custom routes is not documented** — the endpoint `method` enum does include `'options'`, so we may have to register it ourselves; test it, do not assume. `cors: '*'` is incompatible with credentialed cross-origin requests. Adopting `sameSite: 'None'` removes the browser's own SameSite defence and makes the `csrf` list solely load-bearing — which is why the subdomain deployment in §32.14 is mandated instead.
- **Verification status:** VERIFIED for `cors`/`csrf`/`headersWithCors`; NOT VERIFIED for preflight behaviour and wildcard matching.

### 32.43 Rate limiting — stated plainly
- **Official documentation topic:** Production → Preventing API Abuse; Configuration → Overview
- **Source:** https://payloadcms.com/docs/production/preventing-abuse · https://payloadcms.com/docs/v3/production/preventing-abuse.md · https://payloadcms.com/docs/configuration/overview
- **What it confirms:** **Payload 3 ships no HTTP rate limiting of any kind.** This was verified three independent ways. (1) The full Payload Config options list contains **no `rateLimit`** — the v2 Express-era `rateLimit: { window, max, trustProxy, skip }` is gone along with Express. (2) The dedicated anti-abuse page's section headings are exactly *Introduction · Limit Failed Login Attempts · Max Depth · Cross-Site Request Forgery (CSRF) · Cross Origin Resource Sharing (CORS) · Limiting GraphQL Complexity · Malicious File Uploads* — **there is no rate-limiting section and no recommended replacement.** (3) A full-text search of the official docs bundle for "rate limit" returns exactly one hit: an example in the Hooks docs of throwing *your own* error — `if (rateLimitExceeded) { throw new APIError('You have sent too many requests', 429) }`. What Payload *does* provide is: `auth.maxLoginAttempts` + `auth.lockTime` (**per account, not per IP**), `auth.forgotPassword.minRequestInterval` (default `15000` ms), `maxDepth` (default `10`), `defaultMaxTextLength`, `graphQL.maxComplexity`, `graphQL.disable`, and the upload limits of §32.27.
- **How this project uses it:** Every documented limit in `SECURITY.md` §11 — 5/min/IP and 3/hour/phone on `POST /api/v1/leads`, 5/15min/IP on admin login, a per-IP ceiling on public GETs — is **reverse-proxy / CDN / WAF configuration and a tracked infrastructure deliverable**, not an application setting. Payload-side hardening still applies: `maxDepth: 3`, `defaultDepth: 1`, `defaultMaxTextLength: 20000`, `graphQL: { disable: true }`, plus `maxLoginAttempts`/`lockTime`. Under the ISR model public GETs originate from one build machine, so the public-GET ceiling needs an explicit build-origin exemption. A Phase-10 test proves the limits actually fire.
- **Limitation:** **There is no Next.js Middleware guidance anywhere in the Payload 3 docs** — zero references to `middleware.ts`. A middleware-based limiter is possible but is entirely our own code, unvalidated by any Payload documentation. The `llms.txt` blurb for the anti-abuse page still mentions *"limiting login attempts and IP requests"*; **the page body contains no IP-request-limiting content** — treat the blurb as stale and the page as authoritative. Whether `rateLimit` was formally *removed* in v3 or merely never documented is NOT VERIFIED (no official v2→v3 breaking-changes page was located); what **is** verified is that it does not exist in the current v3 configuration.
- **Verification status:** VERIFIED — verified **absent**. Any project document implying the CMS rate-limits requests is wrong.

### 32.44 Production deployment *(depth)*
- **Official documentation topic:** Production → Deployment; Production → Building Without a DB Connection; Troubleshooting
- **Source:** https://payloadcms.com/docs/production/deployment · https://payloadcms.com/docs/production/building-without-a-db-connection · https://payloadcms.com/docs/troubleshooting/troubleshooting
- **What it confirms:** Verbatim: *"Payload can be deployed **anywhere that Next.js can run** - including Vercel, Netlify, SST, DigitalOcean, AWS, and more. Because it's open source, you can self-host it."* The page's own checklist order is *Basics · Security · Your database · Permanent File Storage · Docker*. Build is `next build`; start is `next start` (or `node server.js` under standalone). **Docker is first-class**: `output: 'standalone'` is a stated requirement, and a complete multi-stage Dockerfile is published, base image **`node:24-alpine`**, with an `npm ci` branch when `package-lock.json` is present, a non-root `nextjs` user (uid 1001), `EXPOSE 3000`, and `CMD HOSTNAME="0.0.0.0" node server.js`. Env vars to set on deploy, verbatim: *"`PAYLOAD_SECRET`, `PAYLOAD_CONFIG_PATH`, and `DATABASE_URL` if needed."* Storage, verbatim: *"If you rely on Payload's Upload functionality, make sure you either use a host with a persistent filesystem or have an integration with a third-party file host like Amazon S3."* Building without a DB is documented (`next build --experimental-build-mode compile`, or `export const dynamic = 'force-dynamic'`, with the caveat *"it will disable static optimization and your site will be slower"*). Dependency discipline, verbatim from Troubleshooting: *"All `payload` and `@payloadcms/*` packages must be on exactly the same version and installed only once"* → *"In package.json remove `^` or `~` from all versions of: `payload`, `@payloadcms/*`, `react`, `react-dom`."*
- **How this project uses it:** D-015's shape — self-hosted, Docker, long-running containers, Postgres, S3-compatible storage — is squarely the **best-documented** path and avoids every serverless caveat (the 4.5 MB Vercel upload cap, cold-start migrations, the `autoRun` prohibition, `waitUntil`). The official Dockerfile is the baseline verbatim; `package-lock.json` is committed so the `npm ci` branch fires. Deployment order is fixed in §20.13: backup → `migrate:status` → `migrate` as a separate pre-deploy job → build image → deploy app → deploy workers → smoke tests. `svbackend` keeps its **own dependency tree** — never merged into a monorepo with `svfrontend` without deliberate version alignment, because a second copy of React produces the cryptic errors the Troubleshooting page documents.
- **Limitation:** **The published `docker-compose.yml` is development-oriented and Mongo-first** — it is not production guidance. The Deployment page itself contains **no mention of migrations** (that guidance lives only on the Migrations page), **no mention of jobs, workers or cron**, **no health-check guidance**, and **no backup/restore procedure** (see §32.47). `--experimental-build-mode` is experimental by name, and under `compile` *"environment variables prefixed with `NEXT_PUBLIC` will not be inlined and will be `undefined` on the client."* There is **no zero-downtime / expand-contract guidance**: Payload auto-generates destructive DDL and rolling deploys where old and new code run simultaneously are entirely our problem.
- **Verification status:** VERIFIED for the documented path; NOT VERIFIED for zero-downtime strategy, worker deployment and health checks.

### 32.45 Environment configuration and `PAYLOAD_SECRET`
- **Official documentation topic:** Configuration → Environment Vars; Configuration → Overview (`secret`); Authentication → JWT / API Keys
- **Source:** https://payloadcms.com/docs/configuration/environment-vars · https://payloadcms.com/docs/configuration/overview · https://payloadcms.com/docs/authentication/jwt · https://payloadcms.com/docs/authentication/api-keys
- **What it confirms:** Loading, verbatim: *"**Next.js Applications** — If you are using Next.js, no additional setup is required other than creating your `.env` file"*, and for the CLI: *"The `payload run` command… loads the environment variables the same way Next.js loads them… **The usage of `dotenv` is not recommended, as Next.js loads environment variables differently.**"* Client exposure: *"the Admin Panel does **not** include Environment Variables in its client-side bundle by default"*; prefix with `NEXT_PUBLIC_` to expose, with the warning *"Only ever include keys that are safe for the public to read in plain text."* The names Payload itself uses are **`PAYLOAD_SECRET`**, **`DATABASE_URL`** (13 occurrences; `POSTGRES_URL` only for the Vercel adapter), `PAYLOAD_CONFIG_PATH` (*"can be either an absolute path, or path relative to your current working directory"*), and `DISABLE_LOGGING`. `serverURL` is *"protocol, domain and (optionally) port"* — *"No paths allowed."* The JWT signing key derivation is published exactly: `crypto.createHash('sha256').update(process.env.PAYLOAD_SECRET).digest('hex').slice(0, 32)`, with the note *"Payload processes your secret using SHA-256 hash and takes the first 32 characters."* And the rotation consequence, verbatim: *"**If you change your `PAYLOAD_SECRET`, you will need to regenerate your API keys.**"*
- **How this project uses it:** **No `dotenv`.** `PAYLOAD_CONFIG_PATH` lives in the npm script, not in `.env`. The canonical variable list is §22.2; `DATABASE_URI` is retired in favour of `DATABASE_URL`, and `SESSION_SECRET` is retired entirely because there is no session table to hold a second secret. Exactly one `NEXT_PUBLIC_` variable exists in `svbackend` (`NEXT_PUBLIC_SERVER_URL`); `REVALIDATE_SECRET` never carries the prefix. Secret rotation is a **break-glass** control with a written runbook whose first step is "regenerate every API key" — it is **not** an operational revocation mechanism; §32.15's session primitives are.
- **Limitation:** **Payload performs no environment validation whatsoever**, and its own documented example is `secret: process.env.PAYLOAD_SECRET || ''` — a pattern that **silently accepts an empty secret** and yields a deterministic, empty-derived JWT signing key. That single line justifies the Zod-parsed fail-fast env module in §22.4. Env loading is documented explicitly **only for `payload run`**; the docs do not say the same for `payload migrate`, so CI passes `DATABASE_URL` on the command line. **`NEXT_PUBLIC_SERVER_URL` is a convention shown once in a Payload example, not a Payload-defined variable.** Whether rotating the secret invalidates **existing session cookies** is NOT VERIFIED IN OFFICIAL DOCS as a direct statement — it follows from the documented SHA-256 derivation, but the docs never say it, and no rotation procedure is published.
- **Verification status:** VERIFIED for names and loading; NOT VERIFIED for rotation's effect on live sessions.

### 32.46 Logging
- **Official documentation topic:** Configuration → Overview (`logger`, `loggingLevels`)
- **Source:** https://payloadcms.com/docs/configuration/overview#logger
- **What it confirms:** Verbatim: *"Payload uses **Pino** as its logger. By default, Payload logs pretty-printed output to stdout."* Three accepted forms: (1) `logger: { options: { level: 'debug' }, destination? }`; (2) a **pre-instantiated** Pino instance — *"This is the recommended approach when you need custom transports, formatters, or `pino-pretty` in development"*; (3) disabled entirely via `DISABLE_LOGGING='true'`. Plus `loggingLevels` — *"An object to override the level to use in the logger for Payload's errors."* The logger is reachable in code as `payload.logger.info(...)`. And a documented compatibility note, verbatim: *"The `transport` property of Pino's `LoggerOptions` may fail with `'unable to determine transport target'` in some environments. Pino transports spawn a worker thread with their own module resolution, which can break when modules are bundled or the project uses ESM. **If you encounter this error, use a pre-instantiated logger instead.**"*
- **How this project uses it:** A **pre-instantiated** Pino logger in `src/lib/logger.ts` — JSON to stdout in production at `LOG_LEVEL`, `pino-pretty` in development — passed as `logger`. Docker's log driver collects stdout, which is already structured logging. `DISABLE_LOGGING` must stay unset in production, because §20.14's worker-death alarm reads the log stream.
- **Limitation:** **Pino `transport` must not be used** — Payload is fully ESM and the docs document the exact failure. Writing to a file path is documented but is an anti-pattern in the container, where the official Dockerfile's `USER nextjs` (uid 1001) cannot write `/var/log` anyway. **The exact key set accepted by `loggingLevels` is NOT VERIFIED IN OFFICIAL DOCS** — one-line description, no example, no enumeration of Payload's error names. Request-ID correlation, PII redaction, log shipping and retention are entirely ours.
- **Verification status:** VERIFIED for `logger`; NOT VERIFIED for `loggingLevels` keys.

### 32.47 Health checks, backup and restore — verified absent
- **Official documentation topic:** (none — searched and absent)
- **Source:** https://payloadcms.com/docs/production/deployment · https://payloadcms.com/docs/rest-api/overview · https://payloadcms.com/docs/database/postgres#access-to-drizzle · https://payloadcms.com/docs/rich-text/migration
- **What it confirms:** **Payload exposes no health-check endpoint and publishes no backup or restore documentation.** A full-text search of the 3.x corpus for "health" returns one hit, in unrelated prose about the rich-text editor — there is no `/api/health`, no `/healthz`, no readiness/liveness guidance and no `payload.db` ping helper. Searching for "backup" returns exactly two hits, both pre-flight warnings on the Lexical rich-text migration: *"Create a complete backup of your database before proceeding. If anything goes wrong without a backup, data recovery may not be possible."* What **is** documented and usable: root-level Next.js Route Handlers for paths outside `routes.api`; `getPayload({ config })`; and Drizzle access at `payload.db.drizzle` with `sql` imported from `@payloadcms/db-postgres/drizzle`.
- **How this project uses it:** `src/app/healthz/route.ts` — a **root** Route Handler (a Payload `endpoints` entry is always mounted under `routes.api`, so `/healthz` could not live there), with `export const dynamic = 'force-dynamic'` or it may be statically generated at build. It runs a trivial `select 1` through `payload.db.drizzle` and returns `{ status: 'ok' }` or 503 and **nothing else** — no version, no hostname, no database name. `src/app/livez/route.ts` is a separate DB-free liveness probe. Backup is 100 % our design: nightly `pg_dump -Fc` (or managed-Postgres PITR) **plus** S3 bucket versioning for media — two stores, both in the plan, with a stated consistency story — executed through `docker run postgres:<v> pg_dump` because `psql` is not on PATH on this machine.
- **Limitation:** A DB-touching probe consumes a pool connection on every call — keep the query trivial and the interval sane. Payload simultaneously documents **no** backup guidance and ships `migrate:fresh` (*"Drops all entities from the database"*) and `migrate:reset`, either of which is one typo from a deploy script; §15.3 item 20 therefore forbids them from ever appearing in `package.json`, CI or the runbook. `migrate:down` rolls back a batch and Payload-generated `down` functions are best-effort — **they are not a substitute for a backup**.
- **Verification status:** NOT VERIFIED IN OFFICIAL DOCS — verified **absent**. Both capabilities are entirely our own.

### 32.48 Seeding
- **Official documentation topic:** Local API → Outside Next.js; Plugins → Build Your Own; Configuration → Overview (`onInit`)
- **Source:** https://payloadcms.com/docs/local-api/outside-nextjs · https://payloadcms.com/docs/plugins/build-your-own · https://payloadcms.com/docs/configuration/overview
- **What it confirms:** The clearest official pattern is a standalone script executed with **`payload run src/seed.ts`**, using `getPayload({ config })` and `payload.create(...)`. Why that command matters, verbatim: *"The `payload run` command does two things for you: 1) It loads the environment variables the same way Next.js loads them… 2) It initializes tsx, allowing direct execution of TypeScript files."* Troubleshooting flags: `--use-swc` (needs `@swc-node/register`) and `--disable-transpile`. The second documented pattern is `onInit` — *"A function that is called immediately following startup that receives the Payload instance as its only argument"* — with the env-gated invocation `if (process.env.PAYLOAD_SEED === 'true') { await seed(payload) }`. Uploads through the Local API accept `filePath` or `file`, and *"all custom hooks attached to the `media` collection will still trigger."*
- **How this project uses it:** `"seed": "cross-env NODE_OPTIONS=--no-deprecation payload run src/seed/index.ts"`, ESM, with a hard `PAYLOAD_SEED === 'true'` gate inside the script and **slug-based upserts** for idempotency (`find` by slug, then create or update). The five projects are seeded **verbatim** from `src/seed/data/projects.ts`, which the contract tests import as their fixture. Phase 1's seed stores the existing image **path strings** and uploads nothing, so the byte-faithful seed is achievable without touching the upload pipeline; the placeholder assets are **rasterised to PNG** and committed under `src/seed/assets/` for the later media migration, because the upload guard rejects SVG.
- **Limitation:** **There is no seed framework, no fixtures API and no "reset then seed" command** — `migrate:fresh && payload run src/seed/index.ts` is composed by us. **Idempotency guidance is NOT VERIFIED IN OFFICIAL DOCS** — nothing official describes re-runnable seeds or upsert semantics beyond the env gate. **`onInit`'s execution semantics are NOT VERIFIED**: the docs do not say how many times it runs across instances, whether it runs during `next build`, whether it runs on every HMR reload, or whether a throw aborts startup — so `onInit` is reserved at most for an idempotent, env-gated admin bootstrap and is **never** used for content seeding. The website template's `/next/seed` endpoint is a template artefact, not documented behaviour.
- **Verification status:** VERIFIED for the mechanism; NOT VERIFIED for idempotency guidance and `onInit` execution semantics.

### 32.49 Testing
- **Official documentation topic:** (none — searched and absent)
- **Source:** https://payloadcms.com/llms.txt · https://payloadcms.com/docs/plugins/build-your-own · https://payloadcms.com/docs/local-api/overview
- **What it confirms:** **There is no Testing page in the official Payload 3 documentation.** The complete docs index at `llms.txt` lists no Testing section, and `/docs/testing/overview`, `/docs/local-api/testing` and `/docs/production/testing` all return **HTTP 404**. The only test guidance anywhere is inside the plugin-authoring page, and it names **Jest only**: *"Payload typically uses Jest; a popular testing framework."* Its example declares `let payload: Payload` but **never shows how that variable is initialised**. What *is* documented and is all we actually need: `getPayload({ config })` works in any server context, the Local API is fully typed, `payload.jobs.runByID({ id })` makes job execution deterministic, and `migrate:fresh` *"Drops all entities from the database and re-runs all migrations from scratch."*
- **How this project uses it:** The runner is an **explicitly self-owned decision, recorded as ours and not attributed to Payload**: **Vitest**, because Payload is strictly ESM and Jest would need extra ESM configuration against an all-ESM package graph. `vitest.config.mts` with `fileParallelism: false`; `tests/setup.ts` memoises one `getPayload({ config })` singleton; a disposable Postgres container on port 5433 via `docker-compose.test.yml`; `DATABASE_URL=… npm run payload migrate` against it. Layers: unit / integration / contract / access / upload / auth / jobs / database (§18.2).
- **Limitation:** **There is no documented teardown, no `payload.destroy()` and no connection-close API** — NOT VERIFIED IN OFFICIAL DOCS — so test processes can hang open in CI; mitigate with explicit runner teardown and disposable CI databases. **Vitest and Playwright are named nowhere in the docs**; `int.spec.ts` / `e2e.spec.ts` conventions are repo artefacts, not documentation. **No E2E/browser-testing guidance for the Admin Panel exists at all**, and no stability contract is offered for admin DOM/CSS selectors — so admin E2E is deliberately **out of scope**, and the risk is covered instead by Local-API integration tests (which exercise the same access control and hooks the admin UI uses) plus a manual release smoke checklist. Any plan that says "follow Payload's official testing guide" is planning against a document that does not exist.
- **Verification status:** NOT VERIFIED IN OFFICIAL DOCS — the harness is our engineering decision, recorded as such.

### 32.50 CLI commands
- **Official documentation topic:** scattered across Migrations, TypeScript, Custom Components, Postgres, Jobs Queue, Local API
- **Source:** https://payloadcms.com/docs/database/migrations · https://payloadcms.com/docs/typescript/generating-types · https://payloadcms.com/docs/custom-components/overview · https://payloadcms.com/docs/database/postgres · https://payloadcms.com/docs/jobs-queue/queues · https://payloadcms.com/docs/local-api/outside-nextjs
- **What it confirms:** The verified command set: `npx create-payload-app`; `payload migrate`, `migrate:create [name]` (`--skip-empty`, `--force-accept-warning`), `migrate:status`, `migrate:down`, `migrate:refresh`, `migrate:reset`, `migrate:fresh`; `payload generate:types`; `payload generate:importmap`; `npx payload generate:db-schema`; `payload jobs:run` (`--queue`, `--limit`, `--cron`, `--all-queues`, `--handle-schedules`) and `payload jobs:handle-schedules`; `payload run <script.ts>` (`--use-swc`, `--disable-transpile`). The documented npm tie-in uses **`cross-env`**: `"payload": "cross-env NODE_OPTIONS=--no-deprecation PAYLOAD_CONFIG_PATH=src/payload.config.ts payload"`.
- **How this project uses it:** `package.json` wires `payload`, `generate:types`, `generate:importmap`, `seed`, `jobs:run`, `jobs:loop`, `test:db` and `ci`. `generate:types` runs in CI with a no-diff assertion; `generate:importmap` runs before `next build` whenever custom admin components exist.
- **Limitation:** **There is no single CLI reference page** — the commands are scattered across six pages, which is itself a discovery hazard. **Every example is written `pnpm payload …`; the npm/npx equivalents are NOT VERIFIED IN OFFICIAL DOCS** and must be proven once and written down (this machine has no pnpm). `cross-env` is an implied extra dependency. `migrate:fresh` and `migrate:reset` are destructive and are forbidden from any script. There is **no documented `--file` flag and no "predefined migrations"** in current v3.
- **Verification status:** VERIFIED for the commands; NOT VERIFIED for npm/npx invocation equivalence.

### 32.51 Admin panel customisation
- **Official documentation topic:** Admin → Overview / Metadata; Custom Components → Overview / Root Components / List View / Edit View / Dashboard; Configuration → i18n; Plugins → Import/Export
- **Source:** https://payloadcms.com/docs/admin/overview · https://payloadcms.com/docs/admin/metadata · https://payloadcms.com/docs/custom-components/overview · https://payloadcms.com/docs/custom-components/root-components · https://payloadcms.com/docs/custom-components/dashboard · https://payloadcms.com/docs/configuration/i18n · https://payloadcms.com/docs/plugins/import-export
- **What it confirms:** Custom components are registered by **file-path string**, not by import — `'/components/Logout'`, `'/components/Logout#MyComponent'`, or `{ path, exportName }` — resolved against `admin.importMap.baseDir`. *"All custom components are React Server Components by default"*; add `'use client'` for client components; the Payload Config is non-serializable and cannot cross to a client component (use `useConfig`). **Never pass `req.user` to a Client Component.** Documented root slots: `actions`, `beforeDashboard`, `afterDashboard`, `beforeLogin`, `afterLogin`, `beforeNavLinks`, `afterNavLinks`, `graphics.Icon`, `graphics.Logo`, `header`, `logout.Button`, `Nav`, `settingsMenu`, `providers`, `views`. Collection list slots: `beforeList`, `beforeListTable`, `afterListTable`, `afterList`, `listMenuItems`. `admin.meta.titleSuffix` **defaults to `"- Payload"`**; `admin.meta.robots` *"defaults to preventing indexing"*. Collection admin options include `useAsTitle`, `defaultColumns`, `listSearchableFields`, `group`, `description`, `pagination`, `preview`, **`baseFilter`**, and `groupBy` (**Beta**). Array `admin.components.RowLabel` with the official `useRowLabel` hook. i18n: `supportedLanguages` / `fallbackLanguage`, with the guidance *"It's best to only support the languages that you need so that the bundled JavaScript is kept to a minimum."* An official **`@payloadcms/plugin-import-export`** plugin provides CSV/JSON export drawers per collection.
- **How this project uses it:** Minimal, deliberate customisation: `admin: { user: 'users', meta: { titleSuffix: ' - SV Developers', icons: [...] }, dateFormat: 'dd MMM yyyy', components: { graphics: { Logo, Icon }, beforeLogin: [...] } }`; `i18n: { supportedLanguages: { en }, fallbackLanguage: 'en' }`; `RowLabel` components so repeatable rows read as titles rather than "Item 03"; `useAsTitle`, `defaultColumns`, `listSearchableFields`, `group` and `baseFilter` per collection to reproduce the admin screens from configuration alone. `generate:importmap` runs in the build.
- **Limitation:** **A stale import map is a production-only failure** — it *"never regenerates during normal runtime or after production builds"*. **`admin.dashboard.widgets` is documented as *"an experimental feature and may change in future releases"*** — use the stable `beforeDashboard` / `afterDashboard` slots instead. **`admin.disable` / `admin.enabled` do not exist** in the Admin Options table — there is no documented way to switch the Admin Panel off by config; NOT VERIFIED. `theme`'s accepted values beyond the default `all` are not enumerated. `admin.autoLogin` has one line of description, no example and no security warning — never enable it outside dev. The Import/Export plugin carries an explicit PII hazard, verbatim: *"Users who have read access to the upload collection may be able to download data that is normally not readable due to access control"* — so if it is used for lead export, `overrideExportCollection` must lock the exports collection to admins.
- **Verification status:** VERIFIED for the documented slots; NOT VERIFIED for disabling the panel and for `theme` values.

---

### 32.52 Unverified Items

Every row below is a place where the official documentation is silent or ambiguous. **None of them blocks D-015.** Each has a named Phase-1 (or early-phase) experiment that settles it empirically, and each is written into the plan as an assumption rather than as a fact.

| Item | What we assumed | Why it could not be verified | Risk | How the Phase-1 spike resolves it empirically |
|---|---|---|---|---|
| Postgres storage of `text` + `hasMany` | `description` round-trips as `string[]` | The docs say *"an ordered array of text"* and print no sample payload; the Text field exposes no `dbName`, so even the table name is uncontrollable | **HIGH** — this is the D-015 gate | Scaffold `Projects` in a throwaway sandbox, run `npx payload generate:db-schema`, read the emitted Drizzle schema, then round-trip a document through the Local API and assert `Array.isArray(d.description) && d.description.every(x => typeof x === 'string')`. Fallback (array field + one `.map()`) is pre-written, so the gate cannot hard-fail |
| The field/column name created by `orderable: true` | There is a sortable order key we can pass to `sort` | Documented as "fractional indexing" with exported key generators, but the property is **never named**; `grep _order` over the full bundle returns nothing | **HIGH** — the public catalogue must return admin order | Enable `orderable: true`, read `payload-generated.schema.ts`, and assert a `find({ sort: '<key>' })` returns drag-set order |
| Array/block row `id` and `_order` columns; group flattening | Rows carry an `id` we must strip; groups flatten to prefixed columns | Never stated on the Array, Blocks, Group or Default-Fields pages | MEDIUM | Read `generate:db-schema`; assert the serialiser's key-set snapshot contains no row `id` |
| `createdAt`/`updatedAt` Postgres column type | `timestamptz` | The docs never state `timestamptz` vs `timestamp` | MEDIUM — §12's UTC guarantee depends on it | Read `generate:db-schema`; if it is `timestamp`, fix it in migration 001 |
| `idType: 'uuid'` details | Native `uuid` column, v4 | Only *"a string of 'serial', or 'uuid'"* is documented — no version, no column type | MEDIUM — uuid-as-text degrades joins | Read `generate:db-schema`; insert one row and inspect the value |
| Postgres enum evolution when `select` `options` change | `migrate:create` emits a sane `ALTER TYPE` | Neither the Select page nor the Migrations page documents it | MEDIUM — renaming one of 41 icons later | Add an option, run `migrate:create`, read the file; repeat for a removal |
| Postgres identifier truncation (63 bytes) | Explicit short `dbName` everywhere avoids it | No truncation behaviour is documented | MEDIUM | Assert every generated table/enum name is ≤63 bytes in the database test suite |
| `endpoints: false` semantics on a collection | Disables custom routes only, not generated CRUD | Doc wording is *"Set to `false` to disable routes"* with no scope | **HIGH** if a security claim rests on it | Set it, then curl `/api/<slug>`; record the result. Until then, security rests on access control + the proxy block, never on this flag |
| `?draft=true` vs a `_status: published` read constraint | A draft cannot be surfaced to an anonymous caller | The docs describe each separately and never their interaction | **HIGH** — unpublished legal claims | Negative test: anonymous `GET /api/projects?draft=true` and `?where[_status][equals]=draft` must return zero rows |
| Access-control `Where` merged with a caller `?where=` | Boolean `AND` | Only *"Payload appends this constraint"* (Drafts page) exists | MEDIUM | Assert that an anonymous query for a draft slug returns nothing even when the caller supplies a contradicting `where` |
| `maxPerDoc` pruning mechanism | Old versions are discarded on write | The docs state the cap, never the mechanism (sync/batched/background) | MEDIUM — sizing and unbounded growth | Create 25 versions with `maxPerDoc: 20`; count rows in `<slug>_v` |
| `readVersions` default when omitted | Permissive (`Boolean(user)`) | Not documented | MEDIUM | Config test asserts every versioned collection declares it; an integration test proves a non-admin cannot read versions |
| Which hooks fire on draft saves / autosave, and the autosave signal | `afterChange` fires on draft saves; autosave is distinguishable | Neither is documented | **HIGH** — audit log correctness | Save a draft and publish one project; assert **exactly one** audit row per admin mutation. Autosave stays `false` until this is proven |
| `create-payload-app` in a non-empty directory | It may refuse | Not documented | LOW | Scaffold into a temp directory and move `docs/` in — the risk is designed out |
| `payload.sendEmail()` failure semantics | May resolve even on failure | The docs never state whether it throws or what it returns | **HIGH severity, low likelihood** — silent success on the one business-critical email | Send with a deliberately broken transport; assert the task throws. Boot guard closes the no-adapter case regardless |
| Jobs retention (`deleteJobOnComplete` or equivalent) | Completed jobs are retained | The behaviour is described; the config key is never named | LOW–MEDIUM | Complete one job; query `payload-jobs`; if rows vanish, add our own retention task |
| Retry re-eligibility timing and any backoff | Retries are bounded below by the runner's cron tick | No backoff is documented anywhere in v3 | **HIGH** — a 20-minute SMTP outage can burn 3 retries | Fail a job deliberately and time its re-pickup; implement `waitUntil` re-queue if the interval is too tight |
| `req.transactionID` inside custom endpoints | Not relied upon | Not documented | LOW — we use Route Handlers, which open their own transaction | Not applicable by design; recorded so nobody reintroduces the dependency |
| `generateFileURL` signature | `({ filename, prefix })` | Only the type name and a one-line description are published | MEDIUM — every image URL | Read the generated `.d.ts`; assert one real upload's `src` against the CDN base |
| Server-side enforcement of `mimeTypes` | Not relied upon | Documented only as *"in the file picker"* | **HIGH** if relied upon | POST a raw multipart request with a disallowed type; our own `uploadGuard` must reject it regardless of the answer |
| What happens to the previous S3 object on replace | Unknown; assume it may be deleted | Not documented | MEDIUM — breaks the 30-day recovery promise | Replace a file; list the bucket prefix before and after |
| Preflight (`OPTIONS`) handling for our routes | Must be handled by us | Not documented | MEDIUM — browser-only failure | Browser-context CORS test, not curl |
| `csrf` wildcard support and rejection status | Exact-string origins only; unknown status | Not documented | LOW | Send a request from an unlisted origin and record the status |
| Pool sizing, minimum PostgreSQL version | `max: 10`; PG 15+ | Delegated to node-postgres/Drizzle; no minimum stated | MEDIUM | Load-test with the chosen `max`; confirm `pool.max × replicas < max_connections` |
| Migration locking under concurrent deploys | Not safe; serialise deploys | Not documented | MEDIUM | Deploy runbook serialises the migrate job; no concurrent `payload migrate` is ever issued |
| Rotating `PAYLOAD_SECRET` and live sessions | Existing cookies stop verifying | Only API-key invalidation is stated outright | MEDIUM | Rotate in staging, confirm sessions drop, and confirm API keys must be regenerated — §15.3 item 22 requires this to be executed once |
| npm/npx equivalents of every `pnpm payload …` command | `npm run payload …` / `npx payload …` work | Every doc example is pnpm-only | LOW | Run each command once in Phase 2 and write the verified table into `README.md` |
| Payload teardown in tests (`destroy()`) | None exists; force-exit | Not documented | MEDIUM — CI hangs | Explicit Vitest teardown plus disposable per-job databases |
| Sharp native binaries on `node:24-alpine` / cross-arch | The official Dockerfile's `libc6-compat` suffices | No sharp deployment caveats are documented | MEDIUM — first upload fails at runtime | Upload one real image in a staging container as part of the deploy smoke test |
| Cross-app type sharing between `svbackend` and `svfrontend` | None exists | No mechanism is documented | LOW | Vendor `types/content.ts` and CI-diff it (`scripts/checkContractDrift.ts`) |

### 32.53 Documented Conflicts Between Official Payload Behaviour and Project Documentation

This is the honest record the investigation brief demands. Every row is a place where an existing SV Developers specification document asserts behaviour that Payload does not have, or asserts a mechanism Payload implements differently. The **Official Payload reality** column is quoted or paraphrased from the source in the next column. None of these is softened, and none is a matter of taste.

**Three research-internal contradictions, resolved against the docs bundle before this table was written** — recorded because two of them changed the plan and one *removed* an escalated risk:

| # | The disagreement | Resolution, verified against `payload-llms-full.txt` |
|---|---|---|
| R-a | B04: the hashing algorithm is *"NOT NAMED ANYWHERE IN THE OFFICIAL DOCS"*. B10: it is `pbkdf2-sha256-v1:<derived-key>` | **B10 is right.** The docs name **PBKDF2-SHA256** explicitly. Not argon2id, not bcrypt |
| R-b | B04: revocation-on-password-change is unverified. B10: it is documented | **B10 is right.** Three verbatim statements confirm it — OQ-26 is answerable today |
| R-c | B06: *"`deletedAt` soft-delete is NOT a Payload feature"*. B02: it is native via Trash | **B02 is right.** `trash` is a documented collection option and `deletedAt` is injected automatically |
| — | B05 asserts an endpoint property `root: true` | **Failed verification — absent from the v3 corpus.** Do not design around it. B03 was right to flag it |
| — | B07 escalates *"`width`/`height`/`url` are undocumented upload fields"* to HIGH/blocking | **Failed verification — they ARE documented.** This **removes** an escalated risk rather than adding one |

**The conflicts themselves:**

| # | Project document claim | Official Payload reality | Source URL | Resolution | Doc to update |
|---|---|---|---|---|---|
| CONF-01 | Phase 1 says *"Payload 3 scaffolded on Next.js, TypeScript strict, Node 20 LTS"* — **no Next.js version anywhere** | Supported ranges are `15.2.9`-`15.2.x`, `15.3.9`-`15.3.x`, `15.4.11`-`15.4.x`, `16.2.6`+; the published peer range is tighter (`>=16.3.3 <17`). **`svfrontend`'s 15.5.25 is outside every range** | https://payloadcms.com/docs/getting-started/installation | Pin `svbackend` to an exact supported version (`16.3.3`, matching the official template). Never match the frontend. Merging Payload into `svfrontend` is blocked until that app is upgraded | `BACKEND-ROADMAP.md` Ph1, `IMPLEMENTATION-DECISION.md` §11/§17, `DECISIONS.md`, `AI-CONTEXT.md` |
| CONF-02 | `Project.status` and `Lead.status` are modelled as ordinary enum fields | **`status` is a reserved field name "with Postgres Adapter and when drafts are enabled"**, and *"Using reserved field names will result in your field being sanitized from the config"* | https://payloadcms.com/docs/fields/overview | Rename the Payload field (e.g. `projectStatus`) and map back to the public key `status` in `toPublicProject()`. Decide before migration 001 | `DATABASE-SCHEMA.md` §3/§9, `CONTENT-MANAGEMENT-MATRIX.md` §1, `VALIDATION-RULES.md` §3, `API-CONTRACT.md` |
| CONF-03 | FR-AUTH-04 / `SECURITY.md` §1 / `TRACEABILITY.md` §5 mandate **argon2id** | The `hash` field stores a **PBKDF2-SHA256** derived key; the 13-row `auth` options table contains **no hashing option**. The only escape forfeits login, reset, unlock, lockout and sessions | https://payloadcms.com/docs/authentication/overview | Restate vendor-neutrally: never reversible, per-user salt, PBKDF2-SHA256, `salt`/`hash` stripped from every read. Compensate with ≥12-char minimum, lockout, admin-only creation, edge rate limiting | `SECURITY.md` §1, `REQUIREMENTS.md` FR-AUTH-04, `TRACEABILITY.md` §5, `DECISIONS.md` |
| CONF-04 | Five documents specify rate limits as if the CMS enforced them; `ARCHITECTURE.md` §3 puts *"rate limit"* in a `middleware/` layer and §7 lists `RATE_LIMIT_*` env vars | **Payload 3 ships no HTTP rate limiting.** No `rateLimit` option; the anti-abuse page has no rate-limiting section and recommends nothing | https://payloadcms.com/docs/production/preventing-abuse | The *requirement* stands; the *assumption* is wrong. All limits become reverse-proxy/CDN/WAF work, a tracked deliverable, with a build-origin exemption for public GETs and a Phase-10 test that they fire. Delete `RATE_LIMIT_*` from the app | `SECURITY.md` §11/§18, `ARCHITECTURE.md` §3/§7, `API-CONTRACT.md`, `INTEGRATIONS.md` §9, `BACKEND-ROADMAP.md` Ph7/10/11 |
| CONF-05 | `ARCHITECTURE.md` §1: *"The `/admin` path prefix is the security boundary. One middleware guards everything beneath it."* | Two independent leak paths: *"In the Local API, all Access Control is **skipped** by default"*, and *"the `draft` argument on its own will not restrict documents with `_status: 'draft'` from being returned"* — a never-published document's main row is returned by an ordinary `find()` | https://payloadcms.com/docs/local-api/access-control · https://payloadcms.com/docs/versions/drafts | Three mandatory layers on every public read: collection `access.read` returning the published constraint; `overrideAccess: false` + `user: undefined`; an un-overridable `where`. One `publicFind()` helper; no bare `payload.find` in public files; a negative test per surface | `ARCHITECTURE.md` §1/§3, `SECURITY.md` §3/§4, `API-CONTRACT.md`, `BACKEND-ROADMAP.md` Ph6/10 |
| CONF-06 | Risk R-9: *"disable or lock down every generated endpoint"* | `graphQL.disable: true` exists. **There is no documented REST equivalent**, no per-operation switch, and `endpoints: false`'s scope is unstated | https://payloadcms.com/docs/graphql/overview · https://payloadcms.com/docs/configuration/collections | Replace R-9's mitigation with what is achievable: GraphQL off; explicit `access` on 100 % of collections/globals; a reverse-proxy block on `/api/<slug>` paths that are not ours; a Phase-10 test. Record `endpoints: false` as unverified | `IMPLEMENTATION-DECISION.md` §15, `API-CONTRACT.md`, `BACKEND-ROADMAP.md` Ph2/10, `SECURITY.md` §3 |
| CONF-07 | `sort_order int` in `DATABASE-SCHEMA.md`, `sortOrder ≥0` in `VALIDATION-RULES.md`, integer `sortOrder` in `PATCH /admin/projects/order` | `orderable: true` uses **fractional indexing — string keys**, with `generateKeyBetween`/`generateNKeysBetween` exported from `payload/shared` | https://payloadcms.com/docs/configuration/collections | Adopt `orderable: true`; delete the integer `sortOrder` from schema, validation and contract; keep the reorder path only as a shim. Never emit the fractional key publicly | `DATABASE-SCHEMA.md` §3, `VALIDATION-RULES.md` §3, `API-CONTRACT.md` §2.6.2, `DECISIONS.md` D-005 |
| CONF-08 | *"Node 20 LTS"* mandated in three documents | *"Node.js version 20.9.0+"* with **no upper bound**; `engines` `"^18.20.2 \|\| >=20.9.0"`; the documented production Dockerfile uses **`node:24-alpine`** | https://payloadcms.com/docs/getting-started/installation · https://payloadcms.com/docs/production/deployment | Correct to *"Node ≥20.9.0; Node 24.x is supported"*. `svbackend` `engines.node` = `">=20.9.0"` — **never copy the frontend's `<23`** | `BACKEND-ROADMAP.md` Ph1, `IMPLEMENTATION-DECISION.md` §11/§17, `ARCHITECTURE.md` §2, `AI-CONTEXT.md` |
| CONF-11 | `published_at timestamptz — NULL = draft`, and `IMPLEMENTATION-DECISION.md` §7 maps it *"✅ Native draft/publish"* | Drafts inject **`_status` (`'draft' \| 'published'`)**. **Payload produces no publish date** | https://payloadcms.com/docs/versions/drafts | Downgrade the ✅ and state the mechanism. If a publish date is needed, add an explicit `publishedAt` field stamped by a `beforeChange` hook — custom work, not free. Strip both from public output | `IMPLEMENTATION-DECISION.md` §7, `DATABASE-SCHEMA.md` §3, `DECISIONS.md` D-005, `API-CONTRACT.md` §2.6.2 |
| CONF-12 | `admin_sessions` is modelled as a real table with `expires_at`, `last_seen_at`, `ip_address inet`, sweep indexes | Payload issues **httpOnly JWT cookies** and adds a **`sessions` field on the user document** when `useSessions` is enabled. There is no sessions table we own and no documented shape for that field | https://payloadcms.com/docs/authentication/cookies · https://payloadcms.com/docs/fields/default-fields | Delete `admin_sessions`. Amend D-004 to describe **intent** (httpOnly, not script-readable, server-revocable). Replace sliding-expiry design with `tokenExpiration` + `admin.autoRefresh` + `refresh-token`. Drop per-session IP/UA review | `DATABASE-SCHEMA.md` §2, `ARCHITECTURE.md` §6, `TRACEABILITY.md` §5, `DECISIONS.md` D-004 |
| CONF-14 | `IMPLEMENTATION-DECISION.md`: *"`audit_log` — 🟡 Hooks write entries; **Payload's version history covers part of it**"* | A version document has exactly `_id`, `parent`, `autosave`, `version`, `createdAt`, `updatedAt`. **No actor, no IP, no action type, no auth events**, and `maxPerDoc` discards old versions while `restoreVersion` mutates — both break append-only | https://payloadcms.com/docs/versions/overview | Downgrade to 🟠 and state it: versions contribute **before/after reconstruction only**. The audit log is a dedicated collection with all writes denied, fed by shared collection hooks plus auth hooks | `IMPLEMENTATION-DECISION.md` §7/§10, `DATABASE-SCHEMA.md` §14, `SECURITY.md` §13 |
| CONF-15 | `ARCHITECTURE.md` §3: *"a route handler never talks to the ORM directly… keeps authorization and audit in one place"*; `API-CONTRACT.md` makes `POST /admin/projects/{id}/publish` *the* publish path | The Admin UI publishes through its own `PublishButton` → an ordinary Local API update. It **never touches our endpoints**, so realistically 100 % of publishes bypass endpoint logic | https://payloadcms.com/docs/versions/drafts · https://payloadcms.com/docs/hooks/collections | Replace the layering with Payload's actual seams: **authorization in access functions; audit, revalidation and business rules in hooks; route handlers only for the public surface.** Keep the admin endpoints as an optional shim that delegates to the same hooks | `ARCHITECTURE.md` §2/§3, `API-CONTRACT.md` §2.6.2, `DECISIONS.md` (strike P-01) |
| CONF-16 | `MEDIA-MANAGEMENT.md` §11 requires uploading five project **SVGs**; §6, `VALIDATION-RULES.md` §4 and `SECURITY.md` §10 forbid SVG absolutely | **SVG is not on Payload's restricted-file-type list**, and *"If your Collection has defined `mimeTypes`… restricted file verification will be skipped"* — Payload's own example `mimeTypes: ['image/*']` **admits SVG** | https://payloadcms.com/docs/upload/overview | Phase 1's seed stores path strings and uploads nothing. §11 rasterises the placeholders to PNG before upload. No "allow SVG for the seeded five" exception. All sniffing/EXIF/dimension guards are ours | `MEDIA-MANAGEMENT.md` §6/§11, `SECURITY.md` §10, `BACKEND-ROADMAP.md` Ph1/5 |
| CONF-24 | `API-CONTRACT.md` §2.5.8: *"Path is `/healthz` — NOT under `/api/v1`"* | *"Custom endpoints defined in your Payload Config are **always** mounted under your configured `routes.api` path"*, and **Payload ships no health check at all**. `root: true` does not exist in v3 | https://payloadcms.com/docs/rest-api/overview | `/healthz` is a root **Next.js Route Handler** with `dynamic = 'force-dynamic'`, DB probe via `payload.db.drizzle`. A separate DB-free `/livez`. 100 % of health checking is ours | `API-CONTRACT.md` §2.5.8, `ARCHITECTURE.md` §8, `BACKEND-ROADMAP.md` Ph6/11 |
| CONF-28 | `DATABASE-SCHEMA.md` Table 15 specifies a hand-built `notification_jobs` queue | Payload's **Jobs Queue** already is that table (`payload-jobs`), with `totalTried`, `error`, `waitUntil`, `hasError`, retries, cron and an admin surface — a one-to-one field mapping | https://payloadcms.com/docs/jobs-queue/overview | Delete Table 15; record the field mapping so intent survives. Then add the three controls the **silent** failure modes require: a boot-time email/recipient assertion, a supervised runner with liveness monitoring, and a failed-job watchdog alerting on a second channel | `DATABASE-SCHEMA.md` §15, `ARCHITECTURE.md` §9, `INTEGRATIONS.md` §2, `BACKEND-ROADMAP.md` Ph7/11 |
| CONF-29 | Server-assigned fields (`source`, `phoneNormalised`, `width`, `height`, …) are protected by `admin.readOnly` | `admin.readOnly` *"disables editability **without affecting the API**"* | https://payloadcms.com/docs/fields/overview | Cross-cutting rule: `admin.readOnly` is **never used alone**; always paired with field-level `access: { create: () => false, update: () => false }`. Same for the post-publish slug lock, which also needs a `beforeValidate` hook | `VALIDATION-RULES.md` §8, `SECURITY.md` §7, `ADMIN-CMS-SPEC.md` §4-A |
| CONF-32 | Soft delete is specified as a hand-rolled `deleted_at` column plus partial indexes | **Trash is native**: `trash` collection option (*"Defaults to `false`"*), automatic `deletedAt`, a Trash view, Restore, and `data.deletedAt` in the `delete` access function | https://payloadcms.com/docs/trash/overview | Use `trash: true` on the content and lead collections; `trash: false` on `users` and `audit-log`. State it on **every** collection — silence means hard delete. Use `baseFilter` (not `baseListFilter`). Surface the *"restore from trash before restoring a version"* caveat | `DATABASE-SCHEMA.md` §3.21/§13, `DECISIONS.md` D-006, `API-CONTRACT.md` §2.6.2 |
| CONF-33 | B07 escalated *"`width`/`height`/`url` are not documented upload fields"* as HIGH/blocking | **They are documented**: *"`filename`, `mimeType`, `filesize`, `width`, `height`, `url`, `thumbnailURL` — Added when: Uploads are enabled."* | https://payloadcms.com/docs/fields/default-fields | **Downgrade R-45 from blocking to a design choice.** Keep the single `toImageRef()` mapping and the contract test asserting four keys with numeric `width`/`height`; keep the `sharp().metadata()` fallback only if the spike shows a gap. Note `url`'s composition is still undocumented, so compose `src` deterministically from the CDN base | `MEDIA-MANAGEMENT.md` §3, `DATABASE-SCHEMA.md` §7, `IMPLEMENTATION-DECISION.md` §9, risk R-45 |
| CONF-34 | No document states that Payload system fields must be stripped, while `SECURITY.md` §4 forbids *"draft flags"* in public responses | A plain `find()` returns `id`, `createdAt`, `updatedAt`, `_status` (drafts), `deletedAt` (trash) and a row `id` per array row. `select` controls which fields are **queried**, not which keys are **emitted**, and *"the `id` field is always included"* | https://payloadcms.com/docs/queries/select | Write the exhaustive strip-list into D-008: `_status`, `id`, `createdAt`, `updatedAt`, `publishedAt`, `deletedAt`, the order key, `createdBy`/`updatedBy`, every array-row `id`, and everything on `ImageRef` except `{src, alt, width, height}`. Ban `...doc` spread; snapshot the exact key set | `API-CONTRACT.md`, `DECISIONS.md` D-008, `SECURITY.md` §4 |
| CONF-35 | `BACKEND-ROADMAP.md` Phase 2: *"deny-by-default access control on every collection"* | The documented default is `({ req: { user } }) => Boolean(user)` — **allow any authenticated user, full CRUD**, which is the opposite of deny-by-default | https://payloadcms.com/docs/access-control/overview | Restate the default accurately and require an explicit `access` block on **every** collection and global including `readVersions`, proven by a config test. Benign under one role today; a hole the moment a second auth collection exists | `SECURITY.md` §3, `BACKEND-ROADMAP.md` Ph2, `IMPLEMENTATION-DECISION.md` §10 |
| CONF-36 | No project document mentions `readVersions` | It is a seventh collection access function that *"will automatically restrict the Admin UI version viewing access"*, and `GET /api/{collection}/versions` is on the generated REST surface | https://payloadcms.com/docs/access-control/collections | Add `readVersions: isAdmin` to every versioned collection. Record that version rows are a second copy of every approval/RERA/title claim, so CONF-06's lockdown must cover the versions routes | `SECURITY.md` §3, `BACKEND-ROADMAP.md` Ph2 |
| CONF-50 | `DATABASE-SCHEMA.md` §3.1: PK is *"UUID v7/ULID"*; `API-CONTRACT.md` shows ULID-shaped ids | `idType` accepts **only `'serial'` or `'uuid'`**; custom IDs may only be `Number` or `Text`; the setting is **adapter-global** and changing it after migration 001 is a rebuild | https://payloadcms.com/docs/database/postgres · https://payloadcms.com/docs/fields/default-fields | Decide and record `idType: 'uuid'` before migration 001 and delete "ULID". The API's `requestId` is a different generator and may stay a ULID. Add a config test asserting `idType` | `DATABASE-SCHEMA.md` §3.1, `API-CONTRACT.md` §2.2, `DECISIONS.md` |
| CONF-51 | `citext` for admin email, `inet` for IPs, `text[]` for `description`, `bigint` for file size, `timestamptz` everywhere | **None of `citext`, `inet` or `bigint` is a Payload field type**; `text[]` is not what `hasMany` text is documented to produce; the `createdAt`/`updatedAt` column type is undocumented | https://payloadcms.com/docs/fields/overview · https://payloadcms.com/docs/database/postgres | Rewrite §3.1 as **logical** types with their Payload realisation. `citext` → a lowercase/trim `beforeValidate` hook plus the unique index (without it, `unique` is case-sensitive and one human can hold two accounts); `inet` → validated `text` with a 90-day purge; `bigint` → Payload's own `filesize`; `timestamptz` → verify via `generate:db-schema` | `DATABASE-SCHEMA.md` §3.1/§3.3/§3.5/§3.9/§3.11/§3.12 |
| CONF-52 | `ARCHITECTURE.md` §3 places CORS in a framework `middleware/` layer; `IMPLEMENTATION-DECISION.md` §10 rates it *"✅ Configurable"* | Root `cors` governs **Payload's own** routes. *"By default, custom endpoints don't handle CORS headers in responses"* — `headersWithCors` must be attached by hand | https://payloadcms.com/docs/rest-api/overview | CORS on the public surface is **code in a shared wrapper**, not configuration. Downgrade the ✅ to 🟡. Test from a real browser context — curl proves nothing | `ARCHITECTURE.md` §3/§8, `SECURITY.md` §5, `IMPLEMENTATION-DECISION.md` §10 |
| CONF-54 | `AI-CONTEXT.md`: *"**15 core tables**… Do not add tables without a traceable requirement"* | Under the relational adapter, `projects` alone expands to ~18–20 physical tables, plus `payload-migrations`, `payload-preferences`, `payload-locked-documents`, `payload-jobs` and one enum type per `select` — **40–60 total** | https://payloadcms.com/docs/database/postgres | Amend to *"15 core **logical entities**. Payload-generated `_rels`, `_v`, array-child, locale and `payload-*` tables are exempt and are expected to number 40–60."* Remove `admin_sessions`, `notification_jobs` and `project_media` from the entity list | `AI-CONTEXT.md`, `DATABASE-SCHEMA.md` §3.2/§3.19 |
| CONF-57 | No project document mentions autosave, while Phase 4 requires *"audit on every mutation"* and `SECURITY.md` §13 requires append-only logging | Autosave's **default interval is 800 ms**; every autosave is a real write that fires `afterChange`. The hook-side autosave signal is undocumented | https://payloadcms.com/docs/versions/autosave | Ship with `autosave: false`, deliberately and with the reason recorded. Set `maxPerDoc` explicitly and low (10–20) — the default is 100 and the pruning mechanism is undocumented. Phase-4 exit: *"exactly one audit row per admin mutation"* | `DATABASE-SCHEMA.md` §14, `SECURITY.md` §13, `BACKEND-ROADMAP.md` Ph4 |
| CONF-67 | `ARCHITECTURE.md` §7 and `INTEGRATIONS.md` §9 list `SESSION_SECRET`, `STORAGE_*`, `EMAIL_API_KEY`, `RATE_LIMIT_*` — and **not one Payload-required variable**. `DATABASE_URI` appears in project docs | Payload's own names are **`PAYLOAD_SECRET`**, **`DATABASE_URL`** (13 occurrences), `PAYLOAD_CONFIG_PATH`, `DISABLE_LOGGING`. **`DATABASE_URI` has zero occurrences in the entire v3 corpus** | https://payloadcms.com/docs/configuration/environment-vars | Adopt §22.2 as canonical: add `PAYLOAD_SECRET` and `PAYLOAD_CONFIG_PATH`, keep `DATABASE_URL`, retire `SESSION_SECRET` and `RATE_LIMIT_*`, rename `STORAGE_*` to `S3_*`. Add a fail-fast boot assertion — Payload's own `\|\| ''` example silently accepts an empty secret | `ARCHITECTURE.md` §7, `INTEGRATIONS.md` §9, `SECURITY.md` §12 |
| CONF-69 | `API-CONTRACT.md` §2.1 fixes the base path at `/api/v1`; `ARCHITECTURE.md` §1 calls `/admin` *"the security boundary"* | Config endpoints are *always* under `routes.api` (default `/api`), and **six of our public paths are collection slugs** (`projects`, `testimonials`, `faqs`, `statistics`, `leads`, `media`) — so Payload's generated surface sits one segment away, returning the raw document shape | https://payloadcms.com/docs/rest-api/overview · https://payloadcms.com/docs/configuration/overview | Decide the URL layout **before the first endpoint**: keep `routes.admin: '/admin'` and Payload's REST at its default, implement the entire public contract as **Next.js Route Handlers** at `/api/v1/**`, and close the generated surface with explicit `access` plus a reverse-proxy block. Correct §1: there is no `/admin` path-prefix guard | `ARCHITECTURE.md` §1/§3/§8, `API-CONTRACT.md` §2.1, `DECISIONS.md`, `SECURITY.md` §3/§4 |
| CONF-72 | D-007 states the icon enum is *"enforced at API and database"* unconditionally | A `select` field yields a **Postgres enum type** (named via `enumName`) — which *is* the DB constraint — but the hand-written CHECK constraints the decision assumed do not survive; exactly two DB CHECKs remain | https://payloadcms.com/docs/fields/select | Keep the claim but state the mechanism: the enum type is the constraint, `enumName` is set explicitly, and enum evolution is an `ALTER TYPE` migration whose behaviour is unverified | `DECISIONS.md` D-007, `DATABASE-SCHEMA.md` |
| CONF-30 | `OPEN-QUESTIONS.md` classes multilingual (OQ-25) as *"⚪ informational / deferred"* | The Postgres adapter puts localized fields in a separate **`_locales` table per collection** — enabling `localization` after data exists is a physical schema change across every localized field, on a model already producing ~12 child tables for `Project` | https://payloadcms.com/docs/database/postgres | Re-classify as *blocking, answer required before migration 001*, and record the answer now: **do not enable `localization`**, with the cost stated so its absence is never read as an oversight. Distinguish it from admin `i18n`, which is free and reversible and is narrowed to `{ en }` | `OPEN-QUESTIONS.md` OQ-25, `DATABASE-SCHEMA.md` §3.20, `DECISIONS.md` |
| CONF-13 | OQ-26 asks whether Payload revokes sessions on password change; D-004's banner says its revocation rationale is unmet | Documented explicitly and repeatedly: password change ends the user's other sessions; an admin changing another user's password ends **all** of them; `resetPassword` ends all existing sessions; `logout?allSessions=true` ends all | https://payloadcms.com/docs/authentication/overview · https://payloadcms.com/docs/authentication/operations | **Close OQ-26 and downgrade risk R-3.** Promote D-004 to ACCEPTED-as-amended. Record the one documented gotcha verbatim (a Local API update with no authenticated user ends all sessions — pass the `user` from `payload.auth`), and the hard rule **never set `useSessions: false`** | `OPEN-QUESTIONS.md` OQ-26, `DECISIONS.md` D-004, `IMPLEMENTATION-DECISION.md` §15, `SECURITY.md` §2 |

**Summary.** Ten of these are BLOCKER-severity and every one of them is a **project document asserting behaviour Payload does not have** — not a Payload defect and not a reason to reopen D-015. Two rows (CONF-13, CONF-33) resolve *in our favour* and remove work the plan had budgeted. **No hard blocker to D-015 was found anywhere in the official Payload 3 documentation.** The items that come closest are decisions that must be made before migration 001 — the `status` rename (CONF-02), `idType` (CONF-50), the ordering mechanism (CONF-07), the URL layout (CONF-69) and the localization deferral (CONF-30) — none of which is a technical impossibility, and all of which become expensive rather than impossible if deferred.
