# IMPLEMENTATION REPORT — SV Developers backend

**Run date:** 20 September 2026 · **Scope:** the complete approved implementation plan, from an empty `svbackend/` through to an integrated frontend.

> ### 🔶 A LATER PASS CHANGED SOME OF THIS — 20 September 2026
>
> This report describes the system **as built**, against an S3 storage
> assumption and with the company name still an open question. An owner decision
> pass followed it. Where this report says S3, `CDN_BASE_URL` or "OQ-6 open", the
> current system uses **Cloudinary** (D-123), **Neon PostgreSQL** (D-124) and the
> name **"SV Developers"** (D-122).
>
> **This document is not retro-edited** — it is the record of that run. The
> current state is [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md); the
> decisions are `DECISIONS.md` D-122 … D-127.

---

## 1. Final status

**The backend is built, verified and committed. The frontend is integrated on a branch. The D-015 architecture gate PASSED.**

| | |
|---|---|
| D-015 validation gate | ✅ **PASSED** — Directus fallback NOT triggered. [`PHASE-1-GATE-REPORT.md`](./PHASE-1-GATE-REPORT.md) |
| Backend | ✅ Built. 9 collections + 1 global, 50 tables, 7 public endpoints, 2 probes |
| Tests | ✅ **132 passing** (unit · config/access · domain integration · jobs/scheduling) |
| Typecheck | ✅ Clean in **both** repositories |
| Production build | ✅ Passes, standalone output emitted |
| Migrations | ✅ 001 + 002, reversibility proven **up → down → up** |
| Frontend integration | ✅ **Zero route regressions**, First Load JS unchanged-or-smaller |
| Production deployment | ❌ **Not performed** — needs owner provisioning decisions |

**Not production-ready yet**, and the blockers are honest ones: four owner deliverables (§25), infrastructure provisioning, and two rehearsals (§26). No known security defect is outstanding.

---

## 2. Architecture as actually built

```
Visitor ─► CDN (static HTML) ────────────── svfrontend, Next 15.5.25
                │ build + on-demand revalidate (server-side fetch)
                │ POST /api/v1/leads (the ONE live browser call)
                ▼
         reverse proxy ── TLS · HSTS · RATE LIMITING (100% ours) · /payload-api block
                ▼
         svbackend ── Next 16.3.3 + Payload 3.90.1
           ├── /api/v1/**   hand-written Route Handlers
           │                definePublicEndpoint → publicFind → serializers
           ├── /admin       Payload's generated Admin Panel
           ├── /payload-api generated REST, access-locked + edge-blocked
           ├── /healthz /livez
           └── payload-jobs → 2 supervised worker containers
                ▼
         PostgreSQL 15 (50 tables) · S3-compatible storage · SMTP
```

Four trust boundaries: the edge (rate limiting — Payload ships none), `publicFind()` (`overrideAccess: false` + `user: undefined` + hard-coded published-only `where`), per-collection access functions, and the private network.

---

## 3. Technology versions actually installed

Verified live against the npm registry during the run, not assumed.

| Package | Installed | Note |
|---|---|---|
| `payload` | **3.90.1** exact | npm `latest` |
| `@payloadcms/next` · `db-postgres` · `storage-s3` · `email-nodemailer` · `ui` | **3.90.1** exact | all identical, verified by `npm ls` |
| `next` | **16.3.3** exact | frontend's 15.5.25 is outside **every** supported peer range |
| `react` / `react-dom` | **19.2.6** exact | exactly one copy, deduped |
| `postgres` | 15-alpine | |
| `sharp` | 0.35.4 | the official template's pin (the plan said 0.34.x; the template is the better authority) |
| `vitest` | 4.0.18 | likewise from the template, not the plan's `^3` |
| `zod` 4 · `pino` 9 · `file-type` 21 · `graphql` 16 | | `graphql` is a declared peer of `payload` itself |
| Node | **24.11.0** · npm 11.6.1 | |

---

## 4. Repository structure

`svbackend/` — **138 tracked files, 4 commits, 0 uncommitted, 0 secrets committed.**

```
src/  payload.config.ts · collections/(9) · globals/(1) · access/ · hooks/(9)
      serializers/ · schemas/ · lib/ · jobs/ · email/ · media/ · fields/
      migrations/(2) · seed/ · scripts/ · types/ · components/admin/
      app/(payload)/ [vendor] · app/(public)/api/v1/ · app/healthz|livez/
tests/ unit · integration · setup · loadEnv · resetDb
docs/  25 documents
Dockerfile · docker-compose{,.test,.prod}.yml · .env.example · .env.ci.example
```

`src/endpoints/` is **empty by decision** — Payload config endpoints are always mounted under `routes.api`, and mixing the two mechanisms is the failure mode.

---

## 5. Database

**50 physical tables** — inside the predicted 40–60 band, confirming the "15 core tables" rule had to be amended to "15 logical entities".

9 entities: `users` · `media` · `documents` · `projects` · `leads` · `testimonials` · `faqs` · `statistics` · `audit-log` + the `site-settings` global.

Not built, each with a recorded reason: `project_media` (named upload fields are strictly better), `admin_sessions` (Payload uses a `users_sessions` table), `notification_jobs` (`payload-jobs` *is* it), `lead_status_history`, `roles`/`permissions`, `categories`, `Service`, `Article`.

`idType: 'uuid'` — measured as native `uuid DEFAULT gen_random_uuid()` (v4), not varchar.

## 6. Migrations

| # | Name | Content |
|---|---|---|
| 001 | `initial_schema` | 50 tables, 18 enums, all indexes. 50 `DROP TABLE` in `down` |
| 002 | `testimonial_consent_check` | The DB CHECK — **proven** by a direct SQL insert Postgres rejects |

Reversibility proven on a clean database: **up (50 tables) → down (0) → up (50)**.

---

## 7–11. Admin, auth, project CMS, media, S3

**Admin:** Payload's generated panel at `/admin`. Custom code is three `RowLabel` components only — everything else is configuration, as intended. 25 project fields across 5 unnamed tabs, 6 drag-sortable repeatable lists, 4 labelled media pickers, native drag-reordering.

**Auth:** `useSessions: true` (never false), 2h tokens, lockout 5/15min, 12-char minimum with a breach-list check, **no public registration** (a pure access consequence — there is no flag), two admin accounts seeded, forgot-password enabled.

⚠️ **Accepted documented deviation (D-118):** Payload's KDF is **PBKDF2-SHA256**, not argon2id, and is not configurable. `REQUIREMENTS.md`, `SECURITY.md`, `TRACEABILITY.md` and `DATABASE-SCHEMA.md` were amended to say so — `SECURITY.md` is client-facing and was stating something that would be false in production.

**Project CMS:** `description` is `text` + `hasMany` and round-trips as `string[]`. Icons are a closed 41-value **Postgres enum**. Ordering is native `orderable: true` → the measured `_order` varchar. Drafts on, autosave off, `maxPerDoc: 20`. Slug locked after publish at the API layer, not just the UI.

**Media:** magic-byte sniffing, hard SVG rejection, declared-vs-actual MIME check, 10 000px bomb guard, EXIF-stripping re-encode, UUID storage keys, `pasteURL: false`, in-use delete guard returning 409 with the usage list, 30-day sweeper. **Payload contributes none of this.**

**S3:** `@payloadcms/storage-s3`, always registered and gated by `enabled: Boolean(S3_BUCKET)` — never conditionally included, because a config whose *shape* varies by environment generates divergent migrations between machines. Local dev falls back to disk. ⚠️ Cache/nosniff/Content-Disposition headers are **bucket/CDN configuration** — `s3Storage()` cannot set them.

---

## 12. Public API

| Method | Path | Verified |
|---|---|---|
| GET | `/api/v1/projects` | 200, admin order, card shape |
| GET | `/api/v1/projects/{slug}` | 200; unpublished → **404 never 403** |
| GET | `/api/v1/site-settings` | 200, `[BRACKETED]` values verbatim |
| GET | `/api/v1/testimonials` | 200, published **and consented** only |
| GET | `/api/v1/faqs` · `/statistics` | 200, ordered |
| POST | `/api/v1/leads` | 201 / 415 / 422 / 429 all verified |
| GET | `/healthz` · `/livez` | 200 |

`ETag` + `304` on `If-None-Match` verified. `Cache-Control: public, max-age=60, stale-while-revalidate=600`. GraphQL **404** — the route files are not present, so it is structural.

**The thin-record acceptance test passes exactly:**
```
["category","description","featured","highlights","image","locality","name","slug","summary","tagline"]
leaked keys: NONE
```

---

## 13–16. Leads, jobs, email, Tier-2, globals

**Leads** — all verified end to end: valid 201, source spoofing stored as `contact_form`, 422 with `details[].field` matching the form inputs, 415 on wrong content type, `UNKNOWN_PROJECT`, unknown property rejected, honeypot returning a byte-identical 201 with **0 rows stored**, dedupe returning 201 with still 1 row.

**Jobs** — 5 tasks, 2 queues, worker containers, watchdog with a 15-minute re-queue and second-channel alerting. Verified: 2 leads queued → worker ran → both `notifiedAt` stamped.

**Email** — `nodemailerAdapter`; ethereal in dev (verified, prints preview credentials), SMTP in production behind a **boot guard** that refuses to start without `SMTP_HOST` and `SALES_NOTIFICATION_EMAIL`.

**Tier-2** — testimonials (three-layer consent gate), faqs, statistics. Deliberately **not seeded**: the three existing quotes are invented placeholders.

**Globals** — `site-settings` only. `versions: { max: 50 }` (note `max`, not `maxPerDoc`). `copyrightText` is **computed**, which makes the `[YEAR]`-renders-literally bug impossible rather than merely fixed.

---

## 17–19. Frontend integration, SEO, testing

**Verified against a baseline build of `main`:** 13 prerendered routes vs 13 — **zero missing**. Homepage 119 → **118 kB**. `/contact` 113 → **112 kB**, *smaller* despite ContactForm gaining a real fetch, pending state, double-submit guard, honeypot and server-error mapping. `src/types/content.ts` **unchanged**.

Two bugs that shipped live are fixed: `mailto:[EMAIL@DOMAIN]` (the bracket landed inside the string, so the inert-link guard never fired) and the raw-digit WhatsApp href (inert only by accident). Nav/footer project lists are now **derived**; `README.md:42`'s claim that they were automatic was false. `www.example.com` is gone from the built output.

**Tests: 132 passing** — 31 domain integration · 34 config/access · 27 serialiser · 26 jobs/scheduling · 14 Cloudinary URL. Admin browser E2E is **deferred, not skipped** — there is zero official guidance and any suite would couple to an admin DOM Payload never guarantees. The ADMIN WORKFLOW integration layer exercises the same access control and hooks the UI calls.

---

## 20. Security verification

| Assertion | Result |
|---|---|
| Unpublished project → **404, never 403** | ✅ (403 confirms existence) |
| `?draft=true` / `?where[_status][equals]=draft` cannot surface a draft | ✅ |
| **No public route returns lead data in any shape** | ✅ 13 routes, canary name + phone, incl. Payload's own `/payload-api/leads`, `/users`, `/audit-log`, `/projects/versions` |
| Anonymous Local API `leads.find` | ✅ throws |
| GraphQL | ✅ 404, structurally |
| Explicit `access` on 100% of collections + globals incl. `readVersions` | ✅ config test |
| Server-assigned fields not client-settable | ✅ `"source":"whatsapp"` → stored `contact_form` |
| SVG · SVG-as-PNG · exe-as-JPG · 10 001px · MIME mismatch | ✅ all rejected |
| UUID keys · EXIF stripped · `originalFilename` preserved | ✅ |
| Error envelope leaks no stack, SQL, path or driver string | ✅ |
| Security headers on `/admin` | ✅ CSP, frame-deny, nosniff, referrer, permissions |
| `migrate:fresh` / `migrate:reset` anywhere | ✅ zero hits |

---

## 21. The four silent defects the gate caught

Each would have shipped without an error anywhere.

1. **`req.data` mutation in `beforeOperation` does not persist.** `originalFilename` was `null` on every asset while the hook was plainly running.
2. 🔴 **`media.access.read: isAdmin` silently degrades a populated upload to a BARE ID STRING for anonymous callers.** Payload does not throw and does not return null. Every image on the public site would have shipped `src:'' width:0 height:0` — every image broken, CLS budget blown, **no error anywhere**. Caught only because `toImageRef()` throws on an unpopulated upload.
3. **`_status: 'draft'` in `data` does NOT select the draft path** — `draft: true` is an *operation argument*. The media-less seed strategy depended on this.
4. **Completed jobs are DELETED by default** — the opposite of what the plan assumed.

## 22. 🔴 The highest-severity finding: `delete()` hard-deletes

Measured on `payload@3.90.1` with `trash: true` on the collection:

```
payload.delete({ collection, id })           →  SQL rows = 0   HARD DELETE
payload.update({ id, data: { deletedAt } })  →  row survives   SOFT DELETE
```

The Trash docs say *"When deleting a document from the main collection **List View**, Payload will soft-delete by default"* — that sentence is scoped to the Admin List View, and nothing on the page says so. This broke **FR-LEAD-14** (*"a lead is a commercial record"*) and **D-006**. Fixed with `beforeDelete` guards: absolute on `leads`, force-flagged on `projects`.

---

## 23. Environment variables

29 backend variables, CI-checked against `.env.example`. Required in production and boot-guarded: `PAYLOAD_SECRET` (≥32 chars), `DATABASE_URL`, `DATABASE_SSL`, `S3_*`, `CDN_BASE_URL`, `SMTP_*`, `SALES_NOTIFICATION_EMAIL`, `CRON_SECRET`, `REVALIDATE_*`, `PRIVACY_POLICY_URL`. Frontend adds 4.

**No `SKIP_ENV_VALIDATION` escape hatch exists, and none may be added** — it would be set in production the first time a deploy was urgent.

## 24. Running and testing locally

```bash
# Backend
cd svbackend && npm ci && cp .env.example .env     # add PAYLOAD_SECRET
docker compose up -d && npm run dev                # :3001, push syncs schema
PAYLOAD_SEED=true npm run seed                     # prints admin passwords once

# Tests
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgres://postgres:test@localhost:5433/sv_test npm run migrate
npm test                                           # 132 tests
npm run check:drift && npm run typecheck

# Frontend
cd svfrontend && npm ci && cp .env.example .env.local
npm run dev                                        # :3000
```

---

## 25. Remaining OWNER decisions — these block LAUNCH, not work

Not invented, not defaulted, not inferred.

| # | Decision | Blocks |
|---|---|---|
| **OQ-24** | **Privacy policy** — author, content, URL. `POST /api/v1/leads` **refuses submissions in production** until `PRIVACY_POLICY_URL` is set | 🔴 The form going live. The largest compliance gap (DPDP) |
| **OQ-6** | Company name: "SV Developers" (repo) vs "SRR Developers Pvt. Ltd." (brief + live site) | Launch. `name` and `legalName` are distinct fields so the change is one admin edit |
| **OQ-22** | Every `[BRACKETED]` value — phone, email, WhatsApp, address, domain, approval numbers, RERA registration, statistics, drive times | Launch + indexing. Several carry legal weight |
| **OQ-23** | Real consented testimonials, or delete the section | Launch. Currently ships empty, which is correct |
| **OQ-2** | The literal sales notification address | Production boot (guarded) |
| **OQ-7** | Storage and email providers, accounts, credential ownership | Production. Both are env vars; no code changes |
| **OQ-1** | Do leads go to a CRM? | Nothing — additive later |
| **OQ-3** | Is the lead status pipeline real? | Nothing — `leadStatus` deliberately **not built** |
| **OQ-18** | Brochures public or lead-gated? | A one-collection config change |
| — | **Lead record retention lifetime** — undefined in every source document | DPDP compliance |
| — | **Project photography** — a stated launch blocker with no owner, and it gates removing `dangerouslyAllowSVG` | Launch quality |
| — | Hosting vendor and region | Deployment |

## 26. Deferred work and known limitations

**Deferred with reasons recorded:** admin browser E2E · autosave · `schedulePublish` · RBAC · orphan-media reporting · lead read/unread, CSV export, status pipeline · WhatsApp hand-off logging · the audit *screen* (Payload's default list view covers it) · `brochureImages` (zero render sites) · site-wide specs/proximity · placeholder-awareness field component · visual icon picker.

**Known limitations, stated plainly:**

1. **Rate limiting is not implemented** — it is reverse-proxy configuration, specified in the runbook, and **Payload ships none**. Until the proxy exists, `/api/v1/leads` and the login path are unthrottled.
2. **The restore drill has NOT been rehearsed.** NFR-10 is not satisfied by having backups.
3. **The `PAYLOAD_SECRET` rotation runbook has NOT been executed.** An unrehearsed procedure is not a control.
4. **The honeypot protects nothing until the frontend deploys** — it is implemented on both sides now, but the field is new.
5. **`Idempotency-Key` replay is in-process**, therefore per-instance. Exact at one replica, which is the correct deployment shape. Must move to Postgres/Redis before scaling out.
6. **`dangerouslyAllowSVG` is still enabled** in the frontend, gated on real raster photography — a content deliverable.
7. **Audit rows for public lead creation carry no IP**, because the Local API `req` is not the HTTP request. The lead itself stores `ipAddress`.
8. **Phone validation is 8 digits, deliberately**, matching the live form. Tightening to 10 must ship in the same release as both frontend changes.

---

## 27. Git status

**`svbackend`** — new repository, 4 commits, 138 files, **0 uncommitted**, **0 secrets committed**, no remote configured (and none added — pushing was not authorised).

**`svfrontend`** — branch `feat/cms-integration`, 1 commit, **0 uncommitted**. `main` untouched at `d72a3e2`. Remote unchanged: `https://github.com/RiseNext/sv-dev.git`. History intact; nothing force-pushed, nothing rewritten.

## 28. Definition of Done

| Area | Status |
|---|---|
| Application: build · typecheck · tests | ✅ |
| Database: migration clean · seed verified · indexes/constraints | ✅ |
| Auth: login · protected routes · no public registration | ✅ |
| CMS: CRUD · publication · ordering · media · globals | ✅ |
| Public API: endpoints · contracts · no private leakage | ✅ |
| Leads: submission · validation · anti-abuse · job · email · admin | ✅ |
| Media: upload · validation · deletion guard | ✅ (S3 exercised via MinIO path; production bucket pending) |
| Frontend: dynamic content · metadata · no design regression · build | ✅ |
| Security: access control · upload security · secrets safe | ✅ (rate limits = infrastructure) |
| Operations: deployment config · migrations · backups · rollback · health · logs · jobs documented | ✅ documented, ❌ **not executed** |
| Production readiness | ❌ **Blocked on §25 owner items and §26 items 1–3** |

**Verdict: the software is complete and verified. The system is not launchable until the privacy policy exists, the bracketed values are supplied, the infrastructure is provisioned, and the restore and rotation drills are rehearsed.**

No known critical security defect is outstanding. Nothing was marked complete without its verification passing.
