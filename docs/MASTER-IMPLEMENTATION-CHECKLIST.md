# MASTER-IMPLEMENTATION-CHECKLIST.md

> ## 🔶 SUPERSEDED IN PART — owner decision pass, 20 September 2026
>
> Every **S3 / bucket / CDN / `media.<domain>`** item below is superseded:
> production media is **Cloudinary** (D-123) and production Postgres is **Neon**
> (D-124). The full mapping is in the banner at the top of
> [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md); what must
> actually be configured is in
> [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md).

> ## 🟢 IMPLEMENTATION STATUS — 20 September 2026
>
> **The backend is BUILT and the frontend is INTEGRATED.** This checklist was
> written before implementation; the boxes below are **NOT** retro-ticked,
> deliberately. *"Do not check boxes that were not actually verified"* is a
> binding rule, and mass-ticking 813 items from memory would destroy exactly the
> signal the checklist exists to carry.
>
> **What was actually verified, with evidence, is recorded in:**
>
> | Document | Contains |
> |---|---|
> | [`PHASE-1-GATE-REPORT.md`](./PHASE-1-GATE-REPORT.md) | The D-015 verdict (**PASSED**), every measured schema fact, and the four SILENT defects the gate caught |
> | [`DECISIONS.md`](./DECISIONS.md) D-100…D-121 | Every decision taken during the run, including three deviations from this plan and why |
> | [`RUNBOOK.md`](./RUNBOOK.md) | Deploy, rollback, restore drill, break-glass |
> | The final implementation report | Per-phase status, test counts, remaining owner decisions |
>
> **Summary of verified state:**
>
> - ✅ 9 collections + 1 global · **50 physical Postgres tables** (predicted 40–60)
> - ✅ Migrations 001 + 002, reversibility proven **up → down → up** on a clean database
> - ✅ **132 passing tests** (unit, config/access, domain integration, jobs/scheduling)
> - ✅ Production build passes; typecheck clean in **both** repositories
> - ✅ Public API: 7 routes + 2 probes, contract-verified against the thin and fat records
> - ✅ Security negatives proven: draft leak **404 not 403**, no public route returns lead
>   data in any shape, GraphQL 404s, source spoofing rejected, honeypot indistinguishable
> - ✅ Frontend integrated with **zero route regressions** and First Load JS unchanged-or-smaller
> - ❌ **NOT done:** production provisioning, the restore drill, the secret-rotation
>   rehearsal, edge rate limiting, and the four owner deliverables that block launch
>
> **Items below that remain genuinely unticked are the ones above marked ❌, plus
> everything in §26 of the plan that is an owner decision.** Treat the phase
> sections as the specification they were written as, not as a progress bar.

---

## How to use this

This is the **executable companion** to `MASTER-IMPLEMENTATION-PLAN.md`. The plan carries the reasoning, the config blocks and the evidence; this file carries the work.

- **Every box maps to a task ID** from the C3 task inventory (`T-NNN`) where one exists. Items without an ID are sub-steps of the item above them, or verification steps the plan introduced.
- **A box is checked only when its stated verification passes.** "It looks right" is not a verification. Where a box says *proven by a test*, a passing test is the only thing that checks it. Where it says *evidence recorded*, a screenshot, a log excerpt or a command transcript is pasted into the phase's evidence file.
- **Phases are the RESTRUCTURED phases from C3 §5**, which supersede `BACKEND-ROADMAP.md`'s Phases 0–11. Phases 5, 6, 8 and the infra half of 11 run in **parallel** after Phase 3; Phases 0 → 1 → 2 → 3 → 4 → 7 → 9 → 10 → 11 are the critical path.
- **Tags:** `[CRITICAL]` cannot be cut at any deadline · `[IMPORTANT]` cut only with a written, owner-signed acknowledgement · `[DEFERRED]` ship without it, add in v1.1 · `[OPTIONAL]` build only if explicitly requested.
- **Do not check a Definition-of-Done box until every box above it in that phase is checked or explicitly waived in writing.**
- **Naming note:** the renamed project field is **`projectStatus`**; the lead field is **`leadStatus`**. The serialiser aliases `projectStatus` back to the public key `status`. ✅ *Normalised across the plan at the 20 Sep 2026 freeze — the earlier working name `saleStatus` no longer appears anywhere. Canonical record: `DECISIONS.md` D-020.*
- **Before Phase 1, read [`MIGRATION-001-DECISIONS.md`](./MIGRATION-001-DECISIONS.md).** Six decisions become expensive-to-impossible to change once migration 001 has run. Five are resolved on technical grounds; **one (OQ-25, multilingual) is the owner's and is still open** — with a safe default already applied, so it blocks nothing.

---

## BLOCKING BUSINESS DECISIONS — FOR THE PROJECT OWNER

> These are **decisions, not engineering tasks.** No amount of implementation work closes them. Each names the exact question, what engineering will do in the meantime, and what it blocks. An interim behaviour is *not* the owner's answer and must never be recorded as one. Source: C4 Part 1, C2 list (b).

### Blocks implementation — needed before the phase named

- [ ] **(OQ-1) Where do leads ultimately go?** Persist in our PostgreSQL only · persist **and** email · push to a named CRM (which CRM, which account, whose API key). [CRITICAL] — blocks Phase 5.
  - [ ] Interim: build `leads` and persist; **no CRM integration is designed in**. A CRM is later an additive `payload-jobs` task on the same `afterChange` hook. [CRITICAL]
- [ ] **(OQ-2) Who is notified of a new lead, and how?** The literal recipient address(es) for `SALES_NOTIFICATION_EMAIL`; email only or also WhatsApp/SMS; instant or digest. [CRITICAL] — blocks Phase 5.
  - [ ] Interim: **one** channel = one Payload Task (`sendLeadNotification`), instant, email-only. Two or more channels forces a Workflow; do not build one speculatively. [CRITICAL]
- [ ] **(OQ-7a) Storage provider.** Which S3-compatible provider, which region, who owns the account and keys, is the bucket public-read behind a CDN. [CRITICAL] — blocks T-107 only (Phase 6), not the media collections.
  - [ ] Interim: build against `@payloadcms/storage-s3` with MinIO in Docker locally; the production provider is five env vars. [CRITICAL]
- [ ] **(OQ-25) Will the site ever be multilingual (Telugu)?** Enabling `localization` after data exists is a physical schema change across every localized field (`_locales` table per collection). **Must be answered before migration 001.** [CRITICAL]
  - [ ] Interim: `localization` is **not enabled**; record the deferral and its cost as a decision so its absence is never read as an oversight. Narrow admin `i18n` to `{ en }` (free, reversible). [CRITICAL]
- [ ] **(OQ-18) Are brochure PDFs public or gated behind a lead capture?** The two answers are **mutually exclusive settings on the same collection** (`disablePayloadAccessControl: true` + CDN vs. access control retained + `signedDownloads`). [IMPORTANT] — blocks the `documents` storage config.
  - [ ] Interim: preserve the status quo — brochures stay **public**, because the live Lightbox download button is unauthenticated today. `documents` is a separate collection so a later "gate them" touches one config. [IMPORTANT]
- [ ] **(OQ-19 / CONF-27) Phone validation: 8 or 10 digits, and does the frontend tighten in the same release?** A server enforcing 10 while the live form accepts 8 is a **silent lead-loss regression inside the anti-lead-loss phase**. [CRITICAL]
  - [ ] Interim: server accepts **≥8** digits from Phase 5; the normaliser is threshold-independent; tighten to 10 in the **same release** that edits `ContactForm.tsx:34`. Log rejected submissions. [CRITICAL]

### Blocks production / launch only — no code depends on them

- [ ] **(OQ-6 / CONF-78) Company name: "SV Developers" or "SRR Developers Pvt. Ltd."?** **No safe default exists.** Renders in every heading, SEO title, OG tag, footer wordmark. [CRITICAL]
  - [ ] Engineering mitigation only: `name` and `legalName` are **distinct fields with distinct uses** on `site-settings`, so answering does not silently change both; the change is one admin edit + one revalidation, never a deploy. **Do not pick one to unblock a demo.** [CRITICAL]
- [ ] **(OQ-22) Replace every `[BRACKETED]` placeholder** — phone, email, WhatsApp, address, domain, approval numbers, RERA registration, the 4 statistics, all 11 drive times. Several carry **legal weight**. **No safe default exists.** [CRITICAL]
  - [ ] Engineering mitigation only: seed the 5 projects and site-settings **verbatim including brackets** so the gap stays visible; `^\[.*\]$` bypasses format validation but still obeys length limits. [CRITICAL]
- [ ] **(OQ-23) Testimonials: supply real, consented quotes, or delete the section.** The three current quotes are invented placeholders with bracketed names; publishing them is a fabricated record. [CRITICAL]
  - [ ] Interim: **ship the section empty.** Nothing is seeded into `testimonials`. The consent gate makes publishing them structurally impossible, not merely discouraged. [CRITICAL]
- [ ] **(OQ-24) Privacy policy** — who writes it, where it lives, what it says about retention, sub-processors (email provider, storage provider, any CRM) and erasure requests. **The largest compliance gap in the project (DPDP Act). No safe default exists.** [CRITICAL]
  - [ ] Hard engineering gate: **`POST /api/v1/leads` must not be reachable in production until a reachable privacy URL is configured.** OQ-7's answers are inputs to this policy. [CRITICAL]
- [ ] **(CONF-47) The lead record's own retention lifetime.** `SECURITY.md` §17 says "define a lifetime" and never does. Must be stated in the privacy policy and enforced by a purge job. [CRITICAL]
  - [ ] Already decidable by engineering and not the owner's: `Idempotency-Key` TTL 24 h; dedupe window 10 min; `ipAddress`/`userAgent` purge at 90 days. [IMPORTANT]
- [ ] **(CONF-77) Who commissions project photography, and by when?** A stated launch blocker with no OQ, no FR, no phase and no owner. It gates removal of `dangerouslyAllowSVG` (T-183) and the real-art half of T-113. [IMPORTANT]
  - [ ] Engineering mitigation: write the asset specification (formats, minimum dimensions, per-project shot list including the homepage media deck) so commissioning is one step; state the interim placeholder status in `admin.description`. [IMPORTANT]

### Design-shaping — a reversible default exists, record the ruling anyway

- [ ] **(OQ-3 / CONF-71) Is the lead status pipeline real?** Will a human maintain `new → contacted → visit_scheduled → visited → won → lost`? [IMPORTANT]
  - [ ] Interim: `leadStatus` ships with the **admin control hidden** via `admin.condition`. `ADMIN-CMS-SPEC` §5: *"Do not default to building it."* [IMPORTANT]
- [ ] **(OQ-4) One admin role or several?** Decides whether access functions take a role argument. [IMPORTANT]
  - [ ] Interim: single role. `role` select with exactly one option `'admin'`; every access function is an explicit role check from day one, never `Boolean(user)`. [IMPORTANT]
- [ ] **(OQ-8) Keep Payload's built-in forgot-password flow?** The recorded default inverts: under Payload this is something we would have to **remove**, and keeping it mitigates sole-admin lockout (R-39). [IMPORTANT]
  - [ ] Interim: **keep it**, branded via `generateEmailSubject` / `generateEmailHTML`. Removal must be logged as a deliberate decision. [IMPORTANT]
- [ ] **(OQ-9 / CONF-85) Can a published project's slug change?** Three documents assert three answers. [IMPORTANT]
  - [ ] Interim: implement the strictest — `SLUG_LOCKED` after first publish — because it is the only one that cannot cause irreversible loss (indexed 404s, orphaned lead attribution) while the question is open. [CRITICAL]
- [ ] **(OQ-17) Grace period for deleted/replaced media.** Does it also apply to replaced originals? [IMPORTANT]
  - [ ] Interim: **30 days**, applied to both deletes and replaces, by capturing `previousDoc.filename` in `afterChange` and enqueueing the old key. [IMPORTANT]
- [ ] **(CONF-25 / T-007) Sign off D-012 (ISR + on-demand revalidation)** or add an explicit Phase-7 entry criterion reading "D-012 signed off". It is currently PROPOSED and is the entire premise of Phase 9. [CRITICAL]
- [ ] **(CONF-23) Is Phase 9 (frontend integration) approved, and when?** T-170 requires explicit human approval; current instructions forbid touching `svfrontend/`. [CRITICAL]
  - [ ] Interim truth to state in the admin UI: a newly published project appears at `/projects`, in the sitemap and at its own URL, but **not** in the navigation or footer until Phase 9 ships. [IMPORTANT]
- [ ] **(OQ-5) Who builds the small number of custom admin components**, and are they in scope? [OPTIONAL]
  - [ ] Interim: **zero** custom admin components through Phase 7. Phase 1 gate criterion 6 requires the editor to be usable without them. [OPTIONAL]
- [ ] **(CONF-40) Does FR-LEAD-17 (WhatsApp hand-off logging) ship?** There is a `source: 'whatsapp'` enum value with no writer. [DEFERRED]
  - [ ] Either define `POST /api/v1/leads/whatsapp` or record explicitly that FR-LEAD-17 will not be satisfied. **Do not leave an enum value with no writer.** [DEFERRED]
- [ ] **(CONF-86) Is read/unread on leads actually wanted?** FR-LEAD-13 is INFERRED/P2 annotated *"no evidence it is wanted"*, yet the dashboard is built on it. [DEFERRED]
  - [ ] Zero-cost alternative: define the dashboard's "new leads" as a **date-window query** (`createdAt` within 7 days) — no column, no write path, no audit entry, no migration. [DEFERRED]
- [ ] **(CONF-92) How much operational observability is in scope?** Analytics is deliberately deferred; server-side alerting is not the same thing and is currently absent. [IMPORTANT]
  - [ ] Minimum two alarms to name: *"a `sendLeadNotification` job has been pending > N minutes"* and *"zero leads in 72 hours"*. Confirm this does **not** reopen the analytics deferral. [IMPORTANT]
- [ ] **(OQ-20) Autoresponder to the buyer?** Default on record is **no** — it changes the DPDP purpose-limitation position against `formNote`'s promise. [OPTIONAL]
- [ ] **(OQ-11) Should the homepage hero headline be editable?** Default = status quo = zero backend work. If ever yes: **two adjacent `text` fields** (`heroTitle`, `heroTitleAccent`), never one, never `richText`. [OPTIONAL]
- [ ] **(OQ-12) Should `noindex` / `Disallow: /` be an admin toggle?** Default = keep in code; an accidental click de-indexing the site is slow to notice. [OPTIONAL]
- [ ] **(OQ-13 / OQ-14) "Services" and `/blog`** — D-013 position: no `Service` entity, no `Article` entity. Confirming either is a **new requirement** with its own traceability row. [DEFERRED]
  - [ ] If the blog returns, the "no rich text anywhere" decision must be reopened **deliberately**, not by reflex. [DEFERRED]

---

## PHASE 0 — Decisions & Environment Lock

> Six of these are irreversible or expensive to reverse after migration 001. None requires code. Entry: D-015 logged (done). Exit gates everything.

### 0.1 Environment prerequisites — resolve the measured gaps

- [ ] **(T-016)** Record the measured toolchain in `svbackend/docs/AI-CONTEXT.md`: `node -v` → **v24.11.0**, `npm -v` → **11.6.1**, `docker -v` → **29.3.1**, `git --version` → **2.47.1**, `yarn -v` → 1.22.22, **pnpm absent**, **`psql` absent from PATH**. [CRITICAL]
- [ ] **(T-016)** Record the Node resolution: **Node 24.11.0 is fine for Payload 3.** Payload's `engines` are `^18.20.2 || >=20.9.0` with **no upper bound**, and its own production Dockerfile is `FROM node:24-alpine`. [CRITICAL]
  - [ ] Set `svbackend/package.json` `engines.node` to **`">=20.9.0"`**. **Do NOT copy `svfrontend`'s `">=20.9.0 <23"`** — that pin is a frontend concern and would make the backend refuse to install on the machine it is being built on. [CRITICAL]
  - [ ] Create `svbackend/.nvmrc` so the two apps' Node expectations are explicit and independent. [IMPORTANT]
  - [ ] Record separately, as a *frontend* finding only: the installed Node 24.11.0 violates `svfrontend`'s own `engines.node "<23"`. Do not fix it in this project; note it. [IMPORTANT]
  - [ ] Record the forward-looking constraint: Payload 4 (canary only) will need Node ≥ 24.15.0 — the local 24.11.0 is **below** that. [OPTIONAL]
- [ ] **(T-004 / CONF-09 / OQ-36)** Decide and record the package manager: **npm 11.6.1**. yarn 1.22.22 is **explicitly unsupported by Payload**; pnpm is not installed. [CRITICAL]
  - [ ] Commit `package-lock.json` — the official Dockerfile's `npm ci` branch fires only when it is present. [CRITICAL]
  - [ ] Translate every documented `pnpm payload …` command to `npm run payload …` / `npx payload …` **once, in writing**, in `svbackend/README.md`. The npm equivalents are **UNVERIFIED** in the official docs and must be confirmed empirically in Phase 2. [CRITICAL]
  - [ ] Record that `cross-env` is a required dependency — the docs' own migration script uses it. [IMPORTANT]
  - [ ] Record the documented fallback if peer resolution fails: `npm i --legacy-peer-deps`. [IMPORTANT]
- [ ] **(T-040 precondition / CONF-10)** `git init` in `c:/progromming/SV DEVELOPERS/svbackend` **before any scaffolding**, so the 18 existing specification documents get history and the scaffold is a reviewable diff. [CRITICAL]
  - [ ] Commit `docs/` as commit 1, untouched, before a single line of code exists. [CRITICAL]
  - [ ] Add `.gitignore` blocking `.env*` (allow-listing `.env.example`), `.next`, `node_modules`, `/media`. [CRITICAL]
  - [ ] Record that **whether `create-payload-app` refuses a non-empty directory is UNVERIFIED** — plan the scaffold as: create in a temp directory → move `docs/` in → commit. [CRITICAL]
- [ ] **Postgres without `psql`:** author `svbackend/docker-compose.yml` with a `postgres:15` service on `5432` (database `sv_dev`) and a MinIO service on `9000`, and `docker-compose.test.yml` with a `postgres:15` service on **port 5433** (database `sv_test`). [CRITICAL]
  - [ ] Record the house rule: **all Postgres client tooling runs through Docker** — `docker run --rm postgres:15 pg_dump …`, never a local `psql`. [CRITICAL]
  - [ ] Author `src/scripts/resetSandbox.sh` = `docker compose down -v && docker compose up -d postgres`, **so nobody ever reaches for `migrate:fresh`**. [CRITICAL]
- [ ] **Port convention:** `svfrontend` keeps **3000**; `svbackend` runs on **3001** in development. Two Next.js apps cannot share one port. [CRITICAL]

### 0.2 Irreversible schema decisions — all before migration 001

- [ ] **(T-001 / CONF-02 / OQ-28)** Record the reserved-name rename: `Project.status` → **`projectStatus`**, `Lead.status` → **`leadStatus`**. `status` is a **reserved field name under the Postgres adapter when drafts are enabled** and a field named `status` is *"sanitized from the config"* — silently, with no error. [CRITICAL]
  - [ ] Record that `toPublicProject()` aliases `projectStatus` back to the public key **`status`**, so `svfrontend/src/types/content.ts` is unchanged. [CRITICAL]
- [ ] **(T-002 / CONF-50 / OQ-27)** Decide **`idType: 'uuid'`**. It is adapter-global and effectively irreversible after migration 001. Record that **ULID is not supported** — the only documented values are `'serial'` and `'uuid'`, and custom IDs may only be `Number` or `Text` fields. Strike "UUID/ULID" from `DATABASE-SCHEMA.md`. [CRITICAL]
- [ ] **(T-003 / CONF-07 / OQ-29)** Decide the ordering mechanism: **`orderable: true`** (native drag-drop, fractional-index **string** keys) and **delete integer `sortOrder`** from `DATABASE-SCHEMA.md`, `VALIDATION-RULES.md` and `API-CONTRACT.md`. [CRITICAL]
  - [ ] Record that the **name of the field `orderable: true` creates is UNVERIFIED** and is discovered in T-024, and that the public sort cannot be written until it is. [CRITICAL]
- [ ] **(OQ-30)** Decide **unnamed `tabs` everywhere** in the Project editor. Named tabs group data into an object in the database; unnamed are presentational only and keep the stored shape flat. Changing later is a data migration. [CRITICAL]
- [ ] **(OQ-31 / CONF-06)** Decide the REST-surface fork: **option (A)** — `access.read` returns a published-only `Where` for anonymous (keeps `overrideAccess: false` meaningful) **plus** an infrastructure block on `/api/<collection-slug>` at the reverse proxy. There is **no documented REST kill switch**; config alone cannot close it. [CRITICAL]
- [ ] **(T-014 / OQ-34 / CONF-69)** Decide the public URL layout: **Next.js Route Handlers** under `src/app/(public)/api/v1/**`, **not** Payload `config.endpoints`. Payload config endpoints are *always* mounted under `routes.api`, and `/healthz` must sit outside `/api`. **Mixing the two mechanisms is the failure mode.** [CRITICAL]
  - [ ] Record that **B05's claimed `root: true` endpoint property does not exist in the v3 docs** — do not design around it. [CRITICAL]
- [ ] **(T-004 / CONF-01 / OQ-35)** Pin the stack **exactly**, no `^`, no `~`: `next@16.3.3`, `react@19.2.x`, `react-dom@19.2.x`, `payload@3.90.x`, and **every** `@payloadcms/*` at the identical version. [CRITICAL]
  - [ ] Record the reason: Payload 3 supports `15.2.9–15.2.x`, `15.3.9–15.3.x`, `15.4.11–15.4.x`, `16.2.6+`; the published `@payloadcms/next` peer range is tighter (`>=16.3.3 <17`); **`svfrontend`'s 15.5.25 is outside every range**. Never match the frontend's version. [CRITICAL]
  - [ ] Record the consequence: merging Payload into `svfrontend` is **permanently foreclosed** until `svfrontend` upgrades off 15.5.x. D-015's separate-app choice is **forced**, not preferred. [CRITICAL]
- [ ] **(T-015)** Decide the deployment origins: `www.<domain>` (site), **`cms.<domain>`** (admin + API), `media.<domain>` (CDN). The backend must be a **subdomain of the public site's registrable domain** so admin cookies stay first-party and `sameSite: 'Lax'` holds. An unrelated host forces `SameSite=None` and makes the `csrf` allow-list load-bearing. [CRITICAL]
- [ ] **(T-011 / CONF-16)** Resolve the SVG seeding paradox and write the resolution into `MEDIA-MANAGEMENT.md` §11: **rasterise the 8 placeholder SVGs to PNG before seeding.** [CRITICAL]
  - [ ] Record the two rejected alternatives and why: *"allow SVG only for the seeded five"* (a permanent hole for a temporary problem) and *"a seed path that bypasses the upload hook"* (the flag exists forever and the next person will use it). [CRITICAL]
  - [ ] Record that the **Phase-1 spike seeds no media at all** — projects are created as drafts and `versions.drafts.validate` is `false`, so the required `image` is not enforced on a draft save. [CRITICAL]
- [ ] **(T-008 / OQ-7)** Close OQ-7 to the degree needed now: `@payloadcms/email-nodemailer` + SMTP (provider = env var) and `@payloadcms/storage-s3` (bucket/provider deferred to media go-live). Record that **neither blocks Phase 5 or Phase 6's collection work.** [IMPORTANT]

### 0.3 Governance corrections — write them before a later session reads them as truth

- [ ] **(T-005 / CONF-13)** Amend **D-004** from PROPOSED and close **OQ-26 / R-3**: httpOnly JWT cookie + server-side sessions (`useSessions: true`, the default), revocation via password change / `resetPassword` / `logout?allSessions=true`. **`admin_sessions` does not exist and `tokenVersion` is unnecessary.** [IMPORTANT]
- [ ] **(T-006 / CONF-03)** Amend **FR-AUTH-04**, `SECURITY.md` §1 and `TRACEABILITY.md` §5: remove **`argon2id`**. Replace with *"Passwords are never stored in reversible form. A per-user salt and a PBKDF2-SHA256 derived key are stored, and `salt`/`hash` are stripped from every read. Never MD5/SHA-1/plaintext."* [IMPORTANT]
  - [ ] Verification: `grep -ri argon2 svbackend/docs/` returns **zero hits**. [IMPORTANT]
  - [ ] Record that forcing argon2id requires `disableLocalStrategy: true` and forfeits login, forgot/reset password, unlock, lockout **and the session machinery D-004 depends on** — **rejected**. [IMPORTANT]
- [ ] **(T-007)** Promote **D-012** (ISR + on-demand revalidation) to ACCEPTED, or add an explicit Phase-7 entry sign-off gate. [CRITICAL]
- [ ] **(T-012 / CONF-54)** Amend `AI-CONTEXT.md` line 110: *"15 core tables … do not add tables without a requirement"* → **"15 core *logical entities*; Payload-generated `_rels`, `_v`, `_locales` and array tables are exempt."** Physical table count will be **40–60**. [IMPORTANT]
- [ ] **(T-013 / CONF-60)** Correct `TRACEABILITY.md` pre-D-015 residue: literal admin paths, physical table/column names, `admin_sessions`, `argon2id`, and the CHECK-constraint cells that D-015 moved to the app layer. [IMPORTANT]
- [ ] **(T-009)** Get owner sign-off on OQ-1, OQ-2, OQ-3 — or formally adopt the documented defaults (P-05/P-06) **as adopted defaults, not as the owner's answer**. [CRITICAL]
- [ ] **(T-010)** Write the **two-release OQ-19 transition plan**, naming the release in which `ContactForm.tsx:34` tightens to 10 digits. [CRITICAL]
- [ ] **(CONF-17)** Amend `API-CONTRACT.md`: delete *"(or `null` for scalars)"* and re-render both response examples **without** `"status": null` and `"developer": null`. Under `svfrontend`'s `strict: true`, `null` is **not assignable** to `string | undefined` — this is a compile-time contract, not a style preference. [CRITICAL]
- [ ] **(CONF-20)** Record that `CONSENT_REQUIRED` is emitted as a **field-level `details[].code` under `VALIDATION_ERROR`**, keeping the top-level vocabulary closed at nine. [IMPORTANT]

### Phase 0 — Definition of Done

- [ ] A written decision record exists for each of: the `projectStatus`/`leadStatus` rename, `idType: 'uuid'`, `orderable: true`, unnamed tabs, the REST-surface fork, the public URL layout, the exact pinned versions, the backend origin, npm as package manager, and Node ≥ 20.9.0 for `svbackend`. [CRITICAL]
- [ ] `DECISIONS.md` D-004 is no longer `PROPOSED`; OQ-26 is moved into `DECISIONS.md` with the revocation mechanism named. [IMPORTANT]
- [ ] `SECURITY.md` and FR-AUTH-04 no longer assert `argon2id` — proven by a zero-hit grep. [IMPORTANT]
- [ ] D-012 is `ACCEPTED`, or Phase 7 carries an explicit sign-off entry criterion. [CRITICAL]
- [ ] OQ-1, OQ-2, OQ-3 have owner answers recorded, or the documented defaults are formally adopted in writing. [CRITICAL]
- [ ] OQ-19 has a two-release transition plan naming the aligning release. [CRITICAL]
- [ ] The SVG seeding resolution is written into `MEDIA-MANAGEMENT.md`. [CRITICAL]
- [ ] `svbackend` is a git repository with `docs/` committed and `.gitignore` in place; `node -v`, `npm -v`, `docker -v` recorded. [CRITICAL]
- [ ] **Nothing in Phase 1 has been started.** [CRITICAL]

---

## PHASE 1 — THE D-015 VALIDATION GATE (throwaway spike)

> This phase exists to answer one question cheaply and to be **deleted afterwards**. It lives in a temp directory, **never** in `svbackend/`. Entry: Phase 0 DoD met. **Time-box it** — an overrun is itself gate-relevant evidence (soft evidence, not a trigger). Run steps strictly in order; **do not parallelise the spike**.

### 1.1 Scaffold and database

- [ ] **(T-020)** Scaffold a throwaway app in a temp directory: `npx create-payload-app@latest -t blank --use-npm`, then pin `next@16.3.3`, `react@19.2.x`, `react-dom@19.2.x`, `payload@3.90.x`, `@payloadcms/db-postgres@<same>`, `@payloadcms/next@<same>`. TypeScript `strict: true`, ESM everywhere. [CRITICAL]
  - [ ] Verify `npm ls react` shows **exactly one** copy and every `payload`/`@payloadcms/*` version is byte-identical. [CRITICAL]
- [ ] **(T-021)** Start Postgres 15 in Docker and wire the adapter: `postgresAdapter({ pool: { connectionString: process.env.DATABASE_URL }, idType: 'uuid', migrationDir: './src/migrations', generateSchemaOutputFile: './src/payload-generated.schema.ts' })`. [CRITICAL]
  - [ ] Leave dev `push` at its **default** (enabled in development). Treat the spike database as a disposable sandbox. **Never run `payload migrate` against it except in step 1.4's dedicated clean database.** [CRITICAL]
  - [ ] Confirm the npm/npx CLI translation works: `npx payload generate:types` succeeds. Record the exact working command form. [CRITICAL]

### 1.2 The models — Media FIRST, then Project

- [ ] **(T-023)** Model a **minimal `media` collection** — `upload: true`, `alt` text required, explicit `width`/`height` number fields, `pasteURL: false`, `mimeTypes: ['image/jpeg','image/png','image/webp','image/avif']`. **This must exist before the Project collection**, because Project's media roles are `upload` fields whose `relationTo` needs a target. [CRITICAL]
- [ ] **(T-022)** Model the **complete Project collection** — no shortcuts, all 25 fields: [CRITICAL]
  - [ ] Identity: `name` text req · `slug` text req unique index · `category` select req `enumName: 'enum_project_category'` · `projectStatus` select optional `enumName: 'enum_project_status'` · `locality` text req · `developer` text · `tagline` text. [CRITICAL]
  - [ ] Narrative: `summary` textarea req · **`description` `type: 'text'` + `hasMany: true` + `required: true` + `minRows: 1` + `maxRows: 12`** · `area` text · `roadDetails` text. [CRITICAL]
  - [ ] Six `array` fields, each with an **explicit `dbName`**: `stats` → `proj_stats`, `highlights` → `proj_highlights` (`minRows: 1`, required), `amenities` → `proj_amenities`, `approvals` → `proj_approvals`, `locationHighlights` → `proj_loc_hl`, `proximity` → `proj_proximity`. Each `maxRows: 50`. [CRITICAL]
  - [ ] `icon` as a `select` with all **41** camelCase `IconName` values and an explicit shared `enumName: 'enum_icon_name'`, used in `highlights`, `amenities`, `approvals`, `locationHighlights`, `proximity`. [CRITICAL]
  - [ ] `cta` and `seo` as **named `group`s** — `cta { title, description }`, `seo { title, description }`. Note they are asymmetric: `cta` members are both-or-neither; `seo` members are independently optional. [CRITICAL]
  - [ ] Media roles as upload fields named after the **frontend keys**: `image` (required, single), `gallery` (`hasMany: true`), `layoutImage` (single), `locationMap` (single). `brochureImages` is **not modelled** — zero render sites anywhere in `svfrontend/src/`. [CRITICAL]
  - [ ] `featured` checkbox `defaultValue: false` · `versions: { maxPerDoc: 20, drafts: { autosave: false } }` · `orderable: true` · unnamed `tabs`. [CRITICAL]

### 1.3 ★ THE MOST IMPORTANT STEP — read the generated schema

- [ ] **(T-024)** Run `npx payload generate:db-schema` and **read the emitted Drizzle file line by line.** Record every answer in the gate report: [CRITICAL]
  - [ ] Every table and column name actually produced. [CRITICAL]
  - [ ] How `hasMany` text is stored — child table, `text[]`, or JSON — and its table name (**not controllable**: Text exposes no `dbName`). [CRITICAL]
  - [ ] Whether array rows carry an **`id`** column and an **`_order`** column. Both are undocumented and both are load-bearing for the serialiser's strip-list. [CRITICAL]
  - [ ] Whether named groups flatten into prefixed columns on `projects`. [CRITICAL]
  - [ ] **The name of the field/column `orderable: true` creates** — and that `payload.find({ sort: '<name>' })` returns drag order. [CRITICAL]
  - [ ] Whether one shared `enumName` across six icon fields produces **one** Postgres enum type or **six**. [CRITICAL]
  - [ ] Whether `category`'s option values containing **spaces** (e.g. `Premium Villa Plots`) survive enum generation. If not: switch to underscored values + human labels and map back in the serialiser. [CRITICAL]
  - [ ] The `createdAt`/`updatedAt` Postgres column type — **`timestamptz` or `timestamp`?** If `timestamp`, fix it in migration 001. [CRITICAL]
  - [ ] Whether `_status` is indexed. If not, add `index: true` via a field override or a hand-written migration. [CRITICAL]
  - [ ] The generated `uuid` version (v4 vs v7) and whether the column is native Postgres `uuid` or `varchar`. [IMPORTANT]
  - [ ] Any identifier close to Postgres' **63-byte** cap (silent truncation collisions). [CRITICAL]
  - [ ] Whether Payload auto-provides `width`/`height`/`url` on uploads (the docs say it does; **verify on the installed version** and plan to own them regardless). [IMPORTANT]
  - [ ] Whether `hasMany` upload ordering (`gallery`) persists. Fallback: an `array` of `{ image: upload }` rows. [IMPORTANT]

### 1.4 Migration reversibility

- [ ] **(T-025)** On a **clean, separate database** (never the push-managed sandbox): `npm run payload migrate:create initial` → read the generated file → `migrate` → `migrate:down` → `migrate`. All four must succeed. [CRITICAL]
- [ ] **(T-003 close-out)** With T-024's measured order-field name in hand, finalise the ordering decision and record it in `DECISIONS.md`. [CRITICAL]

### 1.5 Seed, serialiser, endpoint, contract test

- [ ] **(T-026)** Seed the 5 projects **verbatim** from `svfrontend/src/content/projects.ts` via `npx payload run src/seed.ts`. **No media is uploaded**; projects are created as drafts. [CRITICAL]
- [ ] **(T-027)** Write `toPublicProject()` v0: an **allow-list built key-by-key**, never a spread. [CRITICAL]
  - [ ] Omit `null`, `""` and `[]`. Strip `_status`, `id`, `publishedAt`, `createdAt`, `updatedAt`, the fractional order key, and **every array-row `id`**. Alias `projectStatus` → `status`. [CRITICAL]
- [ ] **(T-028)** Expose `GET /api/v1/projects/{slug}` as a Next.js Route Handler with **all three guards, all required**: `overrideAccess: false` **and** `user: undefined` **and** an explicit `where: { _status: { equals: 'published' } }` **and** an include-mode `select`, wrapped with `headersWithCors({ headers, req })`. [CRITICAL]
- [ ] **(T-029)** Vendor `svfrontend/src/types/content.ts` into the spike and write the contract test asserting the response satisfies `Project`. Budget this as real work — **there is no built-in cross-app type sharing in Payload.** [CRITICAL]

### 1.6 The gate assertions — exact pass/fail

> **🛑 Failure of criterion 1, 2 or 4 voids D-015 and triggers the Directus fallback.** Criterion 3 tests *our* serialiser, which is identical work under Directus — if it fails, fix the serialiser, do not switch stacks.

- [ ] **GATE #1 (T-024)** — *Every `Project` field is expressible in the Postgres adapter.* **PASS =** a generated `payload-generated.schema.ts` exists, has been read, and every one of the 25 fields has a recorded physical artefact. **FAIL =** any field has no representation, or an identifier collides at 63 bytes with no `dbName` escape. [CRITICAL]
- [ ] **GATE #2 (T-030)** — *`description` round-trips as `string[]`.* **PASS =** at the **Local API** layer `Array.isArray(doc.description) && doc.description.every(d => typeof d === 'string')`, **and** at the **HTTP** layer `res.description` deep-equals `['First paragraph.','Second paragraph.']` and `res.description[0]` has **no** `value` property. **FAIL =** either layer returns `[{ id, value }]` **and** the documented `array`-of-one-`text` fallback plus a one-line `.map()` also fails. [CRITICAL]
- [ ] **GATE #3 (T-031)** — *Absent optionals are ABSENT.* **PASS =** for a thin project (`siri-vanam-gummadavelli`), `Object.keys(data).sort()` deep-equals exactly `['category','description','featured','highlights','image','locality','name','slug','summary']`, and for each of `status, developer, tagline, stats, amenities, approvals, locationHighlights, proximity, area, roadDetails, gallery, layoutImage, locationMap, cta, seo` the assertion `(k in data) === false` holds — **`in`, not `=== undefined`**. **PASS also requires** an exact key-set snapshot of a fully-populated project. **FAIL =** any `null`, `""` or `[]` appears for an absent optional. [CRITICAL]
- [ ] **GATE #4 (T-029)** — *The contract test passes against the real `Project` type.* **PASS =** `expectTypeOf(await getProject(slug)).toMatchTypeOf<Project>()` compiles under `strict: true` against the **vendored real** `types/content.ts`, not a hand-written stand-in. **FAIL =** any assignability error. [CRITICAL]
- [ ] **GATE #5 (T-032)** — *An invalid icon is rejected.* **PASS =** `payload.create` with `icon: 'notAnIcon'` throws at the API boundary, **and** a direct `INSERT` of `'notAnIcon'` into the icon column is rejected by the Postgres **enum type**. **FAIL =** the database accepts the value (the `select` + `enumName` did not produce a real enum). [CRITICAL]
- [ ] **GATE #6 (T-033)** — *The admin editor is usable with zero custom components.* **PASS =** all 25 fields, 6 repeatable lists and 4–5 media pickers render and save from `/admin`, screenshot recorded. Rows reading "Item 01" is **cosmetic**, not a failure. **FAIL =** any field cannot be entered or saved without a custom component. [CRITICAL]
- [ ] **GATE #7 (T-034)** — *Seeded projects diff clean.* **PASS =** a field-for-field diff of the 5 seeded records against `content/projects.ts` is empty for all scalar, `string[]` and array-of-object data; media is **explicitly out of scope for the spike** and recorded as such. **FAIL =** any data value differs. [CRITICAL]
- [ ] **GATE #8 (T-025)** — *Migrations round-trip.* **PASS =** `migrate` → `migrate:down` → `migrate` all succeed on a clean database. [CRITICAL]

### 1.7 The gate report

- [ ] **(T-035)** Write the **GATE REPORT** containing: pass/fail per criterion 1–8; every measured schema fact from T-024; the forced decisions (`projectStatus` rename, `idType`, ordering mechanism, enum dedup behaviour, `category` spaces, `timestamptz`); and an explicit final line reading **"D-015 CONFIRMED"** or **"DIRECTUS FALLBACK TRIGGERED"**. [CRITICAL]
- [ ] Record the time-box outcome. An overrun is **soft evidence for the owner**, not an automatic trigger. [IMPORTANT]
- [ ] **Delete the spike.** It is a decision artefact, not a codebase. [CRITICAL]

### Phase 1 — Definition of Done

- [ ] All eight gate assertions have a recorded PASS, or the Directus fallback has been formally triggered. [CRITICAL]
- [ ] The generated Drizzle schema has been **read and recorded**, not merely generated. [CRITICAL]
- [ ] `migrate` and `migrate:down` both succeed on a clean database. [CRITICAL]
- [ ] The gate report exists and carries an explicit verdict line. [CRITICAL]
- [ ] The spike directory has been deleted and nothing from it was copied into `svbackend/` except the recorded facts and decisions. [CRITICAL]
- [ ] **Nothing real has been built.** [CRITICAL]

---

## PHASE 2 — Foundation

> These are the wrappers every subsequent line of endpoint code passes through. Each omission is a **security defect**, not a bug. Entry: the gate report says D-015 CONFIRMED.

### 2.1 Repository and scaffold

- [ ] **(T-040)** Scaffold the real app into a temp directory, then move the existing `svbackend/docs/` into it, then commit into the already-initialised `svbackend` git repo. Preserve `docs/` untouched. [CRITICAL]
- [ ] **(T-040)** Create the root files from plan §21.1: `.env.example`, `.gitignore`, `.nvmrc`, `package.json`, `package-lock.json`, `next.config.mjs`, `tsconfig.json`, `vitest.config.mts`, `Dockerfile`, `docker-compose.yml`, `docker-compose.test.yml`, `README.md`. [CRITICAL]
- [ ] **(T-040)** Create the `src/` tree exactly as plan §21.1 specifies: `app/(payload)/`, `app/(public)/api/v1/`, `app/healthz/`, `app/livez/`, `collections/`, `globals/`, `fields/`, `access/`, `hooks/`, `endpoints/` (**deliberately empty, with a README line**), `serializers/`, `schemas/`, `lib/`, `jobs/`, `email/`, `media/`, `migrations/`, `seed/`, `scripts/`, `types/`, `components/admin/`; plus top-level `tests/`. [CRITICAL]
- [ ] **(T-040)** Write `svbackend/README.md` with the house rules, verbatim and unmissable: [CRITICAL]
  - [ ] *"The local dev database is a disposable sandbox managed by `push`. Every other environment is migrations-only. `payload migrate` is NEVER run against the local dev database."* [CRITICAL]
  - [ ] *"`migrate:fresh` and `migrate:reset` never appear in any npm script, CI job or runbook."* [CRITICAL]
  - [ ] *"npm, not pnpm."* + the translated CLI command table. [CRITICAL]
  - [ ] *"Two Next.js apps in one workspace is deliberate: `svfrontend` is on Next 15.5.25, which Payload 3 does not support."* [IMPORTANT]
- [ ] **(T-043)** `next.config.mjs` (ESM only): `withPayload(...)`, `output: 'standalone'`, and a `headers()` block for the security headers (§3.7). [CRITICAL]
- [ ] `tsconfig.json`: `strict: true`, plus `paths: { "@payload-config": ["./src/payload.config.ts"] }`. [CRITICAL]

### 2.2 `payload.config.ts` baseline

- [ ] **(T-041)** Create `src/payload.config.ts` with the env import as the **first line** (`import { env } from './lib/env'`), before anything Payload. [CRITICAL]
- [ ] **(T-041)** Set every root option explicitly — never inherit a default silently: [CRITICAL]
  - [ ] `secret: env.PAYLOAD_SECRET` — **never `process.env.PAYLOAD_SECRET || ''`**, the official example's pattern, which silently accepts an empty secret and yields a deterministic JWT signing key. [CRITICAL]
  - [ ] `serverURL: env.NEXT_PUBLIC_SERVER_URL` · `cookiePrefix: 'sv'` · `telemetry: false` · `debug: env.NODE_ENV !== 'production'`. [CRITICAL]
  - [ ] `graphQL: { disable: true }` — we hand-write REST; GraphQL is pure attack surface. [CRITICAL]
  - [ ] `maxDepth: 3` · `defaultDepth: 1` · `defaultMaxTextLength: 20000`. [CRITICAL]
  - [ ] `cors: { origins: env.CORS_ORIGINS, headers: [] }` · `csrf: env.CSRF_ORIGINS` — **never `*` with credentials**. [CRITICAL]
  - [ ] `upload: { limits: { fileSize: 25 * 1024 * 1024 }, abortOnLimit: true, useTempFiles: true, tempFileDir: '/tmp/payload-uploads', responseOnLimit: 'That file is too large.' }` — the **higher** (PDF) ceiling; the 10 MB image ceiling is hook-enforced because `limits.fileSize` is one application-wide value. [CRITICAL]
  - [ ] `sharp` imported and **passed to `buildConfig`** — required for `imageSizes`, crop and focal point. [CRITICAL]
  - [ ] `typescript: { outputFile: './src/payload-types.ts' }` · `admin: { user: 'users', meta: { titleSuffix: ' · SV Developers CMS' }, importMap: { baseDir: path.resolve(dirname) } }`. [CRITICAL]
  - [ ] `logger` — the pre-instantiated pino instance from `src/lib/logger.ts`. [IMPORTANT]
  - [ ] `i18n: { supportedLanguages: { en } }` — admin bundle size; free and reversible. [OPTIONAL]
  - [ ] **No `localization` key at all**, with a comment recording the OQ-25 deferral and its cost. [CRITICAL]
- [ ] **(T-041)** `db: postgresAdapter({ pool: { connectionString: env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}) }, idType: 'uuid', migrationDir: './src/migrations', disableCreateDatabase: env.NODE_ENV === 'production', generateSchemaOutputFile: './src/payload-generated.schema.ts', afterSchemaInit: [addUnexpressibleConstraints] })`. [CRITICAL]
  - [ ] Do **not** set `schemaName` (marked experimental), `transactionOptions` (transactions are on by default and wanted), `blocksAsJSON` (no Blocks fields), `readReplicas`, `versionsSuffix`, `relationshipsSuffix` or `localesSuffix`. [CRITICAL]
  - [ ] Record that `disableCreateDatabase` **defaults to `false`** — on a managed Postgres where the app role lacks `CREATE DATABASE`, Payload throws at boot. [CRITICAL]
  - [ ] Record that `pool` sizing is **entirely undocumented by Payload**; keep `pool.max × replicas` comfortably under the server's `max_connections` by our own arithmetic. [IMPORTANT]

### 2.3 Fail-fast environment validation

- [ ] **(T-042)** Create `src/schemas/env.ts` — the Zod schema and nothing else, importable by tests and drift-check scripts with no side effects. Keys exactly as plan §22.2. [CRITICAL]
  - [ ] `PAYLOAD_SECRET: z.string().min(32, 'PAYLOAD_SECRET must be at least 32 characters')`. [CRITICAL]
  - [ ] `NEXT_PUBLIC_SERVER_URL` — a URL **with no path component** (`refine` on `new URL(u).pathname`), because `serverURL` is documented as protocol + domain (+ port) only. [CRITICAL]
  - [ ] `CORS_ORIGINS` and `CSRF_ORIGINS` as comma-separated → array transforms. [CRITICAL]
  - [ ] `DATABASE_URL: z.string().url()` — **never `DATABASE_URI`**, a name with zero occurrences in the Payload docs. [CRITICAL]
  - [ ] Storage, email, jobs and ops keys all `.optional()` in the base schema. [CRITICAL]
  - [ ] A `superRefine` that, **only when `NODE_ENV === 'production'`**, requires `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `CDN_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SALES_NOTIFICATION_EMAIL`, `CRON_SECRET`, `REVALIDATE_WEBHOOK_URL`, `REVALIDATE_SECRET`; requires `DATABASE_SSL === true`; and **rejects `PAYLOAD_SEED` being set**. [CRITICAL]
- [ ] **(T-042)** Create `src/lib/env.ts` — parses `process.env` once, `Object.freeze`s the result, throws `'Invalid environment. Refusing to boot.'` on failure. [CRITICAL]
  - [ ] Read every variable as a **literal `process.env.NAME`**, one line each. **Never `process.env[key]` in a loop** — Next.js only substitutes literal occurrences, and a dynamic lookup silently returns `undefined` for `NEXT_PUBLIC_SERVER_URL`. [CRITICAL]
  - [ ] Report **names and messages only, never values** — a printed malformed `DATABASE_URL` puts the database password into the CI log. [CRITICAL]
  - [ ] **Never add a `SKIP_ENV_VALIDATION` escape hatch.** It will be set in production the first time a deploy is urgent. [CRITICAL]
- [ ] **(T-128 boot guard, lands here not in Phase 5)** In production, throw named errors if `SMTP_HOST` or `SALES_NOTIFICATION_EMAIL` is unset — *"refusing to boot without an email adapter"* / *"refusing to boot with nobody to notify"*. With no adapter Payload **logs a warning rather than throwing**, and the send task reports success having sent nothing. [CRITICAL]
- [ ] **(T-042)** Write `.env.example` exactly as plan §22.5, and `src/scripts/checkEnvDrift.ts` which fails CI when the schema gains a key `.env.example` lacks, or vice versa. [IMPORTANT]

### 2.4 npm scripts

- [ ] **(T-044)** Add exactly these scripts to `package.json`: [CRITICAL]
  - [ ] `"dev": "next dev -p 3001"` · `"build": "payload generate:importmap && next build"` · `"start": "next start -p 3001"`. [CRITICAL]
  - [ ] `"payload": "cross-env NODE_OPTIONS=--no-deprecation PAYLOAD_CONFIG_PATH=src/payload.config.ts payload"`. [CRITICAL]
  - [ ] `"generate:types": "npm run payload generate:types"` · `"generate:importmap": "npm run payload generate:importmap"` · `"generate:db-schema": "npm run payload generate:db-schema"`. [CRITICAL]
  - [ ] `"migrate": "npm run payload migrate"` · `"migrate:create": "npm run payload migrate:create"` · `"migrate:status": "npm run payload migrate:status"` · `"migrate:down": "npm run payload migrate:down"`. [CRITICAL]
  - [ ] `"ci": "payload migrate && npm run build"`. [CRITICAL]
  - [ ] `"seed": "cross-env NODE_OPTIONS=--no-deprecation payload run src/seed/index.ts"` · `"seed:rasterise": "cross-env NODE_OPTIONS=--no-deprecation payload run src/seed/rasterise.ts"`. [CRITICAL]
  - [ ] `"jobs:run": "cross-env NODE_OPTIONS=--no-deprecation payload jobs:run --queue default --limit 25"` · `"jobs:loop": "… payload jobs:run --cron \"* * * * *\" --queue default --limit 25"`. [IMPORTANT]
  - [ ] `"test": "vitest run"`, `"test:watch"`, `"test:unit"`, `"test:int"`, `"test:contract"`, `"test:db"`. [CRITICAL]
- [ ] **(T-050)** Verify by grep that **no** script, CI job or runbook contains `migrate:fresh` or `migrate:reset`. Add this grep to CI. [CRITICAL]
- [ ] **(T-050)** Add `src/scripts/resetSandbox.sh` as the **only sanctioned local reset**: `docker compose down -v && docker compose up -d postgres`. [CRITICAL]

### 2.5 Generated types, logging, migration discipline

- [ ] **(T-045)** Run `npm run generate:types`, commit `src/payload-types.ts`, and add a CI step asserting a re-run produces **no diff**. [IMPORTANT]
- [ ] **(T-046)** Create `src/lib/logger.ts` exporting a **pre-instantiated** pino instance. JSON to stdout in production (the container log driver *is* the structured-logging pipeline); `pino-pretty` in dev. [IMPORTANT]
  - [ ] **Never use Pino `transport`** — documented to fail with *"unable to determine transport target"* under ESM/bundling, and Payload is fully ESM. Never `pino.destination('/var/log/…')` — the official Dockerfile runs as `USER nextjs` (uid 1001). [CRITICAL]
  - [ ] Add request-id correlation and PII/secret redaction (phone numbers, `hash`, `salt`, cookie values, full lead records). [IMPORTANT]
  - [ ] Set `loggingLevels` from `LOG_LEVEL`; keep `DISABLE_LOGGING` **unset** in production. [IMPORTANT]
- [ ] **(T-050)** Write the migration discipline into `README.md`: explicit `migrationDir`; **name every migration** (`migrate:create add-lead-dedupe-index`, never a bare timestamp); **one migration per logical change**, committed separately, because `migrate:down` rolls back a **batch**; **read every generated file before committing**; **hand-write the `down` for any data migration** (an auto-generated `down` restores structure, not data); and the config must be **environment-invariant in shape** — always register every plugin and switch inside it. [CRITICAL]

### 2.6 The guard rails every endpoint passes through

- [ ] **(T-047)** Create `src/lib/errors.ts` implementing the error envelope: the **nine** top-level codes — `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INTERNAL_ERROR` — plus a `requestId`. [CRITICAL]
  - [ ] Implement the **twelve** `details[].code` values: `REQUIRED`, `TOO_SHORT`, `TOO_LONG`, `INVALID`, `INVALID_TYPE`, `INVALID_FORMAT`, `INVALID_ENUM`, `DUPLICATE`, `SLUG_LOCKED`, `UNKNOWN_PROJECT`, `EMPTY_ITEM`, `INCOMPLETE_PAIR` — plus `CONSENT_REQUIRED` as a `details[].code`, not a tenth top-level code. [CRITICAL]
  - [ ] Mandate a **`try/catch` in every public handler**. `afterError` is **not documented to fire for Local API calls** and cannot be relied on to reshape responses. **Never pass `error.message` through.** [CRITICAL]
- [ ] **(T-048)** Create `src/lib/publicFind.ts`, which **forces** on every call: `overrideAccess: false`, `user: undefined`, a hard-coded `where: { _status: { equals: 'published' } }` the caller cannot override, an **include-mode `select`**, and an explicitly pinned `depth`. [CRITICAL]
  - [ ] Never forward a user-supplied `draft` parameter into any query. [CRITICAL]
  - [ ] Add the lint/CI rule: **the build fails if `payload.find` or `payload.findByID` appears inside `src/app/(public)/**` without going through `publicFind()`.** [CRITICAL]
- [ ] **(T-049)** Create `src/lib/definePublicEndpoint.ts` wrapping every public handler with: `headers: headersWithCors({ headers: new Headers(), req })` (**custom endpoints get no CORS for free**), cache headers, `ETag`, and the error envelope. [CRITICAL]
- [ ] **(T-146)** Create `src/lib/cache.ts`: `Cache-Control: public, max-age=60, stale-while-revalidate=600` + a working `ETag` on public GETs; `Cache-Control: no-store` on admin routes and `POST /leads`. [CRITICAL]
- [ ] **(T-052)** Create `src/serializers/put.ts` — the `put()` / `omitEmpty()` primitive with **one documented emptiness rule**: decide once and write it down whether `0`, `false` and `""` are empty. (`featured` must survive as a real `false`.) [CRITICAL]
  - [ ] Ban object spread anywhere in `src/serializers/` and `src/app/(public)/`, enforced by review rule plus the key-set snapshot suite. [CRITICAL]

### 2.7 Test harness

- [ ] **(T-051)** Install and configure **Vitest** (ESM-native; Payload and all official packages are fully ESM — Jest needs extra configuration against an all-ESM graph). Record this as **our ADR, not Payload guidance**: there is no Testing page in the official Payload v3 docs. [CRITICAL]
- [ ] **(T-051)** Create `tests/setup.ts` with a **memoised `getPayload({ config })` singleton** booted once per process. [CRITICAL]
- [ ] **(T-051)** Create `vitest.config.mts`: `environment: 'node'`, `setupFiles: ['./tests/setup.ts']`, **`fileParallelism: false`**, `testTimeout: 30_000`, `teardownTimeout: 10_000`, `pool: 'forks'`. [CRITICAL]
  - [ ] Record that **there is no documented teardown, no `payload.destroy()`, no connection-close API** — test processes can hang in CI holding the pg pool open. Mitigate with `fileParallelism: false`, the single instance, and an explicit force-exit in the CI command. [CRITICAL]
- [ ] **(T-051)** Test database = a **disposable Postgres container per CI job, migrated, never pushed** (`docker-compose.test.yml`, port 5433, database `sv_test`). Running `payload migrate` against it makes the migration chain itself a tested artefact. [CRITICAL]
  - [ ] `DATABASE_URL` is set **on the command line before the config is imported** — a test runner does not get `payload run`'s Next-style env loading. [CRITICAL]
  - [ ] `disableCreateDatabase` stays `false` in test. Isolation between suites is `delete`-based in `afterEach`; there is **no documented transaction-rollback-per-test helper**. [IMPORTANT]
- [ ] **(T-029)** Vendor `svfrontend/src/types/content.ts` to `src/types/frontend-contract.ts` and add `src/scripts/checkContractDrift.ts` failing CI on any diff. **There is no built-in cross-app type sharing.** [CRITICAL]

### Phase 2 — Definition of Done

- [ ] `svbackend` is a git repo with the real app scaffolded and `docs/` preserved; `npm run dev` serves `/admin` on `http://localhost:3001`. [CRITICAL]
- [ ] Booting with `PAYLOAD_SECRET` **unset**, **empty**, or **31 characters** fails fast with a named error and a non-zero exit — **proven by a test**, not by inspection. [CRITICAL]
- [ ] `npm run generate:types` produces **no diff** against the committed `payload-types.ts` — CI-enforced. [IMPORTANT]
- [ ] A deliberately-thrown internal error returns the documented envelope with a `requestId`, and the body contains **no** stack trace, SQL, file path, driver string or library version. [CRITICAL]
- [ ] A grep/lint rule fails the build when `payload.find`/`payload.findByID` appears in `src/app/(public)/**` without `publicFind()`. [CRITICAL]
- [ ] A "hello world" public endpoint returns correct `Access-Control-Allow-Origin`, `Cache-Control` and `ETag` **from a browser on the frontend origin**, not just from curl. [CRITICAL]
- [ ] `npm run ci` (`payload migrate && npm run build`) succeeds against a clean database. [CRITICAL]
- [ ] `npm test` boots Payload against a disposable Postgres container, runs one trivial assertion, and **the process exits** (no hanging pool). [CRITICAL]
- [ ] `grep -r "migrate:fresh\|migrate:reset" package.json .github/` returns zero hits. [CRITICAL]

---

## PHASE 3 — Security Spine

> Payload's defaults are the opposite of what this project needs in three specific ways: access defaults to *any authenticated user, full CRUD*; the Local API skips access control; the generated REST API is publicly addressable with **no documented off switch**. Until this phase closes, **every collection added is a new public endpoint.** Entry: Phase 2 DoD met.

### 3.1 Users collection

- [ ] **(T-060)** Create `src/collections/Users.ts` with `auth` and **every option set explicitly** — no documented defaults exist for `tokenExpiration`, `maxLoginAttempts` or `lockTime`: [CRITICAL]
  - [ ] `useSessions: true` (the default — **never set it to `false`**; stateless JWTs cannot be revoked). [CRITICAL]
  - [ ] `tokenExpiration: 7200` · `maxLoginAttempts: 5` · `lockTime: 900000`. [CRITICAL]
  - [ ] `cookies: { secure: env.NODE_ENV === 'production', sameSite: 'Lax' }`; `httpOnly` is inherent. `secure: true` cannot work over `http://localhost`, hence the env-conditional. [CRITICAL]
  - [ ] `forgotPassword: { generateEmailSubject, generateEmailHTML }` branded, linking to Payload's built-in `${serverURL}/admin/reset/${token}`. Leave `minRequestInterval` at its 15 000 ms default. (Remove only if OQ-8 rules against it, and log the removal.) [IMPORTANT]
- [ ] **(T-060)** Fields: `name` text req ≤120 · `role` select req `options: ['admin']` `defaultValue: 'admin'` `enumName: 'enum_admin_role'` sidebar · `isActive` checkbox req `defaultValue: true` sidebar with `description: 'Disable instead of deleting — audit attribution must survive.'` [CRITICAL]
  - [ ] **No `tokenVersion` field.** OQ-26 is closed by Payload's documented session revocation; the token-version workaround is unnecessary. [CRITICAL]
  - [ ] `versions: false` (omit the key entirely) · **no `trash`** · `access.delete: () => false` — deactivate, never delete. [CRITICAL]
- [ ] **(T-061)** Enforce the ≥12-character password policy by **redefining the injected `password` field** with a `validate`, plus a breach-list check (NIST SP 800-63B: no forced rotation, no composition rules). [IMPORTANT]
  - [ ] ⚠️ **Verify the override actually attaches** — attaching `validate` to the injected `password` field is **not shown in the docs**. An 11-character password must produce a `422`, proven by a test. [IMPORTANT]

### 3.2 Access primitives — the entire authorisation model

- [ ] **(T-062)** Create exactly four files in `src/access/`: `isAdmin.ts`, `anyone.ts`, `nobody.ts`, `publishedOrAuthenticated.ts`. [CRITICAL]
  - [ ] `publishedOrAuthenticated = ({ req: { user } }) => user ? true : { _status: { equals: 'published' } }`. [CRITICAL]
  - [ ] **Do not** copy the docs' legacy `_status: { exists: false }` OR-branch — drafts are enabled from migration 001 so no `_status`-less rows ever exist. [CRITICAL]
  - [ ] **No `roles` field beyond the single-option `role`, no RBAC scaffolding.** Payload ships no RBAC primitive. [CRITICAL]
- [ ] **(T-063)** Write an **explicit `access` block on every collection and every global** — `create`, `read`, `update`, `delete`, plus `admin` and `unlock` on `users`, plus **`readVersions`** on every versioned collection. Payload's framework default is `({ req: { user } }) => Boolean(user)` — *any authenticated user, full CRUD*. [CRITICAL]

| Entity | `read` | `create` | `update` | `delete` | `readVersions` |
|---|---|---|---|---|---|
| `users` | `isAdmin` | **`() => false`** (seed only, FR-AUTH-09) | `isAdmin` | **`() => false`** | — |
| `media` | `publishedOrAuthenticated`→`anyone` for files | `isAdmin` | `isAdmin` | `isAdmin` | — |
| `documents` | as media (pending OQ-18) | `isAdmin` | `isAdmin` | `isAdmin` | — |
| `projects` | `publishedOrAuthenticated` | `isAdmin` | `isAdmin` | `isAdmin` | **`isAdmin`** |
| `leads` | **`isAdmin`** | **`() => false`** (endpoint uses `overrideAccess: true`) | `isAdmin` | `isAdmin` | — |
| `audit-log` | `isAdmin` | **`() => false`** | **`() => false`** | **`() => false`** | — |
| `testimonials` | `publishedOrAuthenticated` **+ consented** | `isAdmin` | `isAdmin` | `isAdmin` | **`isAdmin`** |
| `faqs` | `publishedOrAuthenticated` | `isAdmin` | `isAdmin` | `isAdmin` | **`isAdmin`** |
| `statistics` | `publishedOrAuthenticated` | `isAdmin` | `isAdmin` | `isAdmin` | **`isAdmin`** |
| `site-settings` (global) | **`() => true`** | — | `isAdmin` | — | `isAdmin` |
| `payload-jobs` | `Boolean(req.user)` via `jobsCollectionOverrides` | denied | denied | denied | — |

- [ ] **(T-063)** `site-settings.access.read` **must be `() => true`** — a forgotten access block 403s the public site while looking perfectly fine to a logged-in developer. [CRITICAL]
- [ ] **(T-063)** Write a **config test** that enumerates every collection and global and **fails on any missing access key**, including `readVersions` on versioned collections. [CRITICAL]
- [ ] **(T-064)** First-admin bootstrap via the **seed script using the Local API** (access control is skipped there), so `access.create: () => false` can never brick a fresh deploy. [CRITICAL]
  - [ ] ⚠️ The interaction between `access.create: () => false` and Payload's `/create-first-user` screen is **UNDOCUMENTED** — verify empirically on a completely fresh database and record the result. [CRITICAL]
- [ ] **(T-208)** Create **two** admin accounts in every environment from day one. Lockout is per **account**, not per IP — a sole admin is a trivial self-inflicted denial of service. `access.unlock: isAdmin` so one can release the other. [IMPORTANT]

### 3.3 Lock down the generated surface (R-9)

- [ ] **(T-066)** `graphQL: { disable: true }` at the root. Verify `GET /api/graphql` and `/api/graphql-playground` return **404**. [CRITICAL]
- [ ] **(T-066)** Set `disableBulkEdit`, `disableBulkDelete` and `disableDuplicate` on collections where they are not needed. [IMPORTANT]
- [ ] **(T-066)** `jobsCollectionOverrides` makes `payload-jobs` **read-only** in the admin: `read: ({ req }) => Boolean(req.user)`; create/update/delete stay denied. [IMPORTANT]
- [ ] **(T-066)** Add a **reverse-proxy / edge rule blocking `/api/<collection-slug>`** paths that are not ours, from the public internet. **There is no documented REST kill switch**; `endpoints: false`'s scope is unstated and **unverified** — no security claim may rest on it. [CRITICAL]
- [ ] **(T-066)** Record that `admin.hidden` is **navigation and admin routing only and is never a security control**, and that `admin.autoLogin` is **never** set in any non-dev environment. [CRITICAL]

### 3.4 Origins, rate limiting, headers, error verbosity

- [ ] **(T-067)** Drive `cors.origins` and `csrf` from env — **exactly two origins** (`https://www.<domain>`, `https://cms.<domain>`). Never `*` with credentials. [CRITICAL]
  - [ ] Register an `options` method on custom endpoints and **test preflight behaviour** — preflight/`OPTIONS` handling for custom endpoints is **UNVERIFIED**. [CRITICAL]
- [ ] **(T-068)** Implement **edge rate limiting** at the reverse proxy / CDN / WAF. **Payload 3 ships none** — v2's `rateLimit` config is gone with Express, and the anti-abuse docs page has no rate-limiting section and recommends no replacement. [CRITICAL]
  - [ ] `POST /api/v1/leads` — **5/min/IP** and **3/hour/phone**. [CRITICAL]
  - [ ] `POST /admin/auth/login` (and `/api/users/login`) — **5/15 min/IP**. [CRITICAL]
  - [ ] All public GET — a per-IP ceiling, **with a build-origin exemption**: under ISR all public GETs originate from one build machine, so a naive ceiling throttles a full site rebuild. [CRITICAL]
  - [ ] Every limit returns **`429` with `Retry-After`**. [CRITICAL]
  - [ ] Record what Payload *does* contribute: `auth.maxLoginAttempts` + `lockTime` (per **account**), `forgotPassword.minRequestInterval`, `maxDepth`, `defaultDepth`, `defaultMaxTextLength`. [IMPORTANT]
- [ ] **(T-069)** Set security headers in `next.config.mjs` `headers()` **and** at the reverse proxy — Payload exposes **no global security-header surface** (the only header API in 3.x is `upload.modifyResponseHeaders`, covering only the Payload-served media path): [CRITICAL]
  - [ ] `Strict-Transport-Security` with a long `max-age` · `X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` on `/admin` · `Referrer-Policy: strict-origin-when-cross-origin` · a minimal `Permissions-Policy` · a CSP on the admin origin. [CRITICAL]
  - [ ] HTTP → HTTPS redirect at the proxy; TLS 1.2+. [CRITICAL]
- [ ] **(T-070)** Verify production error verbosity leaks nothing: `debug: false` in production, and assert **no stack trace, SQL, file path, driver message or library version** appears in any 5xx body. [CRITICAL]
- [ ] **(T-071)** Verify and document session revocation end-to-end, then record it as the **formal closure of OQ-26 / R-3**: [CRITICAL]
  - [ ] Log in twice; change the password from session A; assert **session B's cookie is rejected**. [CRITICAL]
  - [ ] An **admin-initiated** password change on another user ends **all** of that user's sessions. [CRITICAL]
  - [ ] `logout({ allSessions: true })` works. [CRITICAL]
  - [ ] Record the documented gotcha: *"A Local API update that runs without an authenticated user … ends all of the user's sessions. Pass the `user` returned by `payload.auth`."* [CRITICAL]
  - [ ] Record: **do not design revocation around rotating `PAYLOAD_SECRET`** — rotation invalidates every API key and is break-glass only. [CRITICAL]

### Phase 3 — Definition of Done

- [ ] **No admin route is reachable without a session** — an automated matrix hits every `/admin/**` and every generated `/api/<slug>` route unauthenticated and asserts `401`/`403`. [CRITICAL]
- [ ] `GET /api/graphql` and `/api/graphql-playground` return **404**. [CRITICAL]
- [ ] An explicit `access` block exists on **100 %** of collections and globals, including `readVersions` — proven by the enumerating config test. [CRITICAL]
- [ ] Login lockout **triggers** after 5 failures and **expires** after `lockTime`; the failure message is **identical** for an unknown email, a wrong password and a locked account. [CRITICAL]
- [ ] Rate limits are active and **proven to fire** on the login route and a representative public GET, with the build-origin exemption in place. [CRITICAL]
- [ ] Security headers are present on a **real response** from the admin origin. [CRITICAL]
- [ ] **D-004 is amended and OQ-26 is closed with evidence** — the password-change and `allSessions` tests pass. [CRITICAL]
- [ ] A first admin can be created on a completely fresh database **by the seed script alone**, with `access.create` already locked down. [CRITICAL]
- [ ] **Two** admin accounts exist in every environment. [IMPORTANT]
- [ ] A 5xx body contains no stack trace, SQL, file path or driver string. [CRITICAL]

---

## PHASE 4 — Projects Domain + Media Core  *(critical path · XL · the largest single phase)*

> The Project entity cannot be completed without the Media collection — its media roles are upload relations. Audit hooks land **with** the collection, not later: the admin UI publishes directly, so any publish before the hooks exist is permanently unlogged, and approvals carry legal weight. Entry: Phase 3 DoD met.

### 4.1 The two upload collections

- [ ] **(T-100)** Create `src/collections/Media.ts` as an upload collection — **images only**: [CRITICAL]
  - [ ] `upload: { mimeTypes: ['image/jpeg','image/png','image/webp','image/avif'], allowRestrictedFileTypes: false, pasteURL: false, crop: true, focalPoint: true, withMetadata: false, adminThumbnail: 'thumbnail' }`. **`image/svg+xml` is deliberately absent.** [CRITICAL]
  - [ ] **(T-106)** `imageSizes: [{ name: 'thumbnail', width: 400, height: 300, position: 'centre', withoutEnlargement: true, admin: { disableGroupBy: true, disableListFilter: true } }]` — **exactly one size**, for `adminThumbnail` only. `next/image` does responsive variants (OQ-16). `withoutEnlargement` defaults to `undefined`, which silently returns `null` for images smaller than the target in both dimensions. [IMPORTANT]
  - [ ] Fields: `alt` text req ≤300 · `isDecorative` checkbox `defaultValue: false` (the `alt: ''` case — `pages.ts:20`, `Logo.tsx`, `PinnedProof.tsx:119-126` all deliberately pass `alt=""`) · `width` number · `height` number · `originalFilename` text · `uploadedBy` relationship→`users`. [CRITICAL]
  - [ ] `versions` omitted entirely · **`trash: true`** · `defaultSort: '-createdAt'`. [CRITICAL]
- [ ] **(T-100)** Create `src/collections/Documents.ts` as a **second** upload collection — **PDF only**. One collection cannot express two `mimeTypes` allow-lists, and `limits.fileSize` is root-config-only, so the 10 MB-image / 25 MB-PDF split cannot both be config. [IMPORTANT]
  - [ ] `upload: { mimeTypes: ['application/pdf'], allowRestrictedFileTypes: false, pasteURL: false, crop: false, focalPoint: false }`, no `imageSizes`, a static `adminThumbnail` function (sharp cannot thumbnail a PDF). Fields: `title` text req, `originalFilename` text readOnly. [IMPORTANT]
- [ ] **(T-101)** Set **`pasteURL: false` on both** collections. It is **enabled by default**, letting an authenticated editor make the server fetch an arbitrary remote URL — directly contrary to FR-MEDIA-12. **Assert it in a config test.** [CRITICAL]
- [ ] **(T-105)** `alt` is `required: true`; enforce *"required before public attachment"* in the serialiser/validate layer — it is not expressible in upload config. The serialiser emits `alt: isDecorative ? '' : alt`. [CRITICAL]

### 4.2 The upload guard — one `beforeOperation` hook, one exact order

- [ ] **(T-102)** Create `src/hooks/uploadGuard.ts` attached to `beforeOperation` on **`create` AND `update`** for both upload collections, executing in **exactly this order**: [CRITICAL]
  - [ ] 1. **Magic-byte sniff** (`src/media/sniff.ts`). Extension **and** declared MIME **and** sniffed type must all agree, else **`415`**. [CRITICAL]
  - [ ] 2. **Hard SVG rejection.** SVG is **not** on Payload's restricted-file-type list, and declaring `mimeTypes` **disables Payload's own restricted-type verification** entirely — our allow-list must be strictly narrower than Payload's deny-list and re-reviewed whenever widened. [CRITICAL]
  - [ ] 3. **Dimension read** via `sharp().metadata()` (`src/media/dimensions.ts`); reject **> 10 000 px** on a side (decompression bomb). [CRITICAL]
  - [ ] 4. **Re-encode with EXIF stripped.** [CRITICAL]
  - [ ] 5. **(T-103) Rename `req.file.name` to a UUID** — *after* sniffing, so the extension reflects the **sniffed** type, not the declared one. Flat UUID under `prefix: 'media'`; **do not** use a `yyyy/mm/` path partition (whether `req.file.name` may contain `/` is **UNVERIFIED**). [CRITICAL]
  - [ ] 6. **Capture `originalFilename`** for display only — never as a storage key. [CRITICAL]
  - [ ] 7. **(T-104) Write `width`/`height` ourselves** from `sharp().metadata()`, even though the docs list them as auto-added. `ImageRef` hard-requires them and the **CLS < 0.05** budget depends on them reaching `ProjectCard.tsx:19-22` and `Media.tsx:53-61`. [CRITICAL]
  - [ ] 8. Enforce the **per-collection size ceiling** (10 MB images, 25 MB PDFs). Record in `API-CONTRACT.md` that a hook-thrown rejection surfaces as a **4xx, not the `413`** the contract specifies; only the root `abortOnLimit` path yields a true `413`. [IMPORTANT]
  - [ ] 9. Warn (do not reject) on a cover image under **1200 px** wide. [IMPORTANT]
- [ ] Record that **Local API uploads still fire all hooks** — the seed script gets no free pass past this guard. [CRITICAL]
- [ ] **(T-104)** Pair `admin.readOnly` with **field-level `access: { create: () => false, update: () => false }`** on `width`, `height`, `originalFilename`, `uploadedBy`. `admin.readOnly` is *"without affecting the API"* and is trivially spoofable over REST. [CRITICAL]

### 4.3 The Projects collection

- [ ] **(T-080)** Create `src/collections/Projects.ts`, porting the spiked model with final `dbName`s, `enumName`s and indexes. Do **not** rewrite it from scratch. [CRITICAL]
  - [ ] Collection options: `slug: 'projects'`, `orderable: true`, `defaultSort: '<order field from T-024>'`, `trash: true`, `versions: { maxPerDoc: 20, drafts: { autosave: false, validate: false, schedulePublish: false } }`. [CRITICAL]
  - [ ] Indexes: `slug` **unique + index**, `category` index, `featured` index, `_status` index (via field override or hand-written migration — Payload indexing `_status` is **UNVERIFIED**), `publishedAt` index. [CRITICAL]
  - [ ] **Forbidden:** `unique: true` on any field **nested inside an array**. It creates a *collection-wide* unique index on the dotted path, so a second project could not mention the same landmark. Per-document uniqueness is a **custom `validate` on the array field**. [CRITICAL]
- [ ] **(T-081)** Create `src/lib/icons.ts` as the single source of truth for the **41** `IconName` values — `arrowRight bank bolt briefcase bus check chevronDown chevronRight city close compass document download drain droplet external facebook fence hospital instagram key lamp mail mapPin menu phone plane road route ruler school shield shop star temple train tree wall whatsapp youtube zoomIn`. All camelCase, **zero hyphens**, so they are legal `select` values. [CRITICAL]
  - [ ] Export `iconField()` returning a `select` with `required: true`, `options: ICON_OPTIONS`, **`enumName: 'enum_icon_name'` explicitly**, `admin: { isClearable: false, description: 'Closed list. New icons require a frontend release.' }`. [CRITICAL]
  - [ ] Add `src/scripts/checkIconDrift.ts` diffing `ICON_NAMES` against `svfrontend/src/components/ui/Icon.tsx`; **fail CI on drift**. [IMPORTANT]
  - [ ] Add a defensive serialiser fallback `ICON_NAMES.includes(v) ? v : 'check'`. An unknown icon renders as a **silent, invisible 24 px blank box** with no error and no log line. [IMPORTANT]
- [ ] **(T-082)** Create `src/fields/slugField.ts` **hand-rolled**: a `text` field, `unique: true`, `index: true`, regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1–100 chars, a `beforeValidate` normaliser slugifying from `name`, and a `beforeDuplicate` that suffixes to avoid a unique-index violation. [CRITICAL]
  - [ ] **Do not use Payload's built-in `slugField()` helper** — the docs mark it *"experimental and may change, or even be removed"*, and slugs are public URLs. [CRITICAL]
- [ ] **(T-083)** Create `src/hooks/slugLock.ts` — a **collection** `beforeValidate` hook rejecting a slug change when `_status === 'published'`, plus field-level `access.update`. `admin.readOnly` is Admin-Panel-only and does not affect the API. Error code **`SLUG_LOCKED`**. [CRITICAL]
- [ ] **(T-084)** Map a duplicate slug to a friendly **`409 CONFLICT`** with the contract message. A raw unique-index error is not the contract. [IMPORTANT]
- [ ] **(T-086)** Create `src/hooks/publishedAt.ts` — a `beforeChange` hook stamping `publishedAt` on the `draft → published` transition and clearing it on unpublish. **Payload gives `_status`, not a publish date**; the sitemap's `lastModified` needs one. Field is readOnly + field-level `access.create/update: () => false`. [CRITICAL]
- [ ] **(T-087)** Implement ordering: `orderable: true` plus the public query sorting on the **spike-discovered** order field. If a `PATCH /admin/projects/order` shim is kept, convert positional integers to fractional keys via `generateNKeysBetween` from `payload/shared`. **Do not build a derived integer mirror** — it drifts the moment anyone reorders through the API. [IMPORTANT]
- [ ] **(T-088)** `featured` checkbox with `description: 'The homepage strip is a 3-column grid. A fourth featured project leaves a ragged row.'` plus the published-and-featured read path. [IMPORTANT]
- [ ] **(T-089)** Archive/restore via Payload **Trash** (`trash: true` → native `deletedAt`), access filters, and **`admin.baseFilter`** (⚠️ `baseFilter`, **not** `baseListFilter`) so archived rows are hidden by default. Public queries exclude trashed. Surface in the restore UI copy that a trashed document *"can no longer have a version restored until it is first restored from trash"*. [CRITICAL]

### 4.4 Field validation (T-090)

- [ ] **(T-090)** Implement the `VALIDATION-RULES.md` caps: `name` 1–120 · `slug` 1–100 · `locality` 1–200 · `developer` ≤200 · `tagline` ≤200 · `summary` 1–600 · `area` ≤100 (**never coerce to a number**) · `roadDetails` ≤200 · feature `title` ≤200, `body` ≤1000 · `stats.label` ≤60, `stats.value` ≤120 (**text, never numeric**) · `proximity.measure` ≤40, `proximity.place` ≤200. [CRITICAL]
- [ ] **(T-090)** `description` validator: at least one paragraph (`EMPTY_ITEM` on any blank entry), each ≤5000 chars (`TOO_LONG`), **and all entries unique** — `ProjectDetail.tsx:101` uses `key={paragraph}`. Both `required: true` **and** `minRows: 1` are needed; `minRows` is enforced only *when a value is present*. [CRITICAL]
- [ ] **(T-090)** **≤50 items per repeatable list** (`maxRows: 50`). [CRITICAL]
- [ ] **(T-090)** `cta` group-level `validate` enforcing **both-or-neither** → `INCOMPLETE_PAIR`. `seo` members stay independently optional (the asymmetry is intentional). [CRITICAL]
- [ ] **(T-090)** `seo.title` ≤70, `seo.description` ≤160. **Do not add a generated SEO default** — `lib/seo.ts:36-39` guarantees the auto-description is facts-only because there is no field superlatives could come from. Preserve that. [CRITICAL]
- [ ] **(T-090)** Reject control characters; NFC-normalise on input. [CRITICAL]
- [ ] **(T-090)** Gate any DB-touching `validate` on `event === 'submit'`. [IMPORTANT]
- [ ] **(T-180 backend half)** Add uniqueness validators to `stats.label` and `proximity.place` within a document — both feed React keys. [DEFERRED]

### 4.5 Media roles and `ImageRef`

- [ ] **(T-109)** Add the media roles to `projects` as upload fields **named after the frontend keys**: `image` (required, single — `relationTo: 'media'`), `gallery` (`hasMany: true`), `layoutImage` (single), `locationMap` (single). Single-valued roles are enforced **by the field type**, not by a partial unique index. [CRITICAL]
  - [ ] `brochureImages` is **not created** — `types/content.ts:98` declares it but there are **zero render sites anywhere in `svfrontend/src/`** and 0/5 projects populate it. Record the conflict with the Matrix row 23 / FR-MEDIA-05 and that the code wins. [DEFERRED]
- [ ] **(T-114)** Create `src/serializers/toImageRef.ts` mapping a **populated** upload document → `{ src, alt, width, height }` and nothing else. [CRITICAL]
  - [ ] **Pin `depth` explicitly on every public query** (and/or set `defaultPopulate` on `media`) — if `depth` is too shallow an upload field returns a **bare id string** and the serialiser silently emits a broken image. [CRITICAL]
  - [ ] Compose `src` deterministically from `CDN_BASE_URL` + prefix + filename, or via `generateFileURL` with `disablePayloadAccessControl: true`. The `url` composition is not described by any doc page. [CRITICAL]

### 4.6 Audit log — must land WITH the collection

- [ ] **(T-091)** Create `src/collections/AuditLog.ts`, append-only by access control: `read: isAdmin`, `create/update/delete: () => false`, **no `versions`, no `trash`**. [CRITICAL]
  - [ ] Fields: `adminUser` relationship→`users` (nullable — system actions have no actor) · `action` select req `enumName: 'enum_audit_action'` with **eleven** values `create, update, publish, unpublish, delete, restore, login, logout, login_failed, lockout, password_change` (**not the documented seven**) · `entityType` text req index · `entityId` text req index · `changes` json · `ipAddress` text. [CRITICAL]
  - [ ] `admin: { group: 'System', defaultColumns: ['createdAt','action','entityType','entityId','adminUser'], defaultSort: '-createdAt' }`. [IMPORTANT]
- [ ] **(T-091)** Create `src/hooks/audit.ts` — `afterChange` and `afterDelete`, attached to **collections, never to custom endpoints**. The admin UI publishes through its own `PublishButton` → an ordinary `update` and **will never call a custom publish endpoint**; endpoint-based audit produces a log with a hole exactly where the legally sensitive edits are. [CRITICAL]
  - [ ] Write with `overrideAccess: true` and **pass `req`** so the audit row shares the mutation's transaction. [CRITICAL]
  - [ ] Honour `context.skipAudit` so the seed does not flood the log. [CRITICAL]
  - [ ] `diffSensitiveFields` is an **allow-list, not a whole-document diff**: `approvals[]`, `area`, `proximity[]`, `name`, `slug`, `category`, `projectStatus`, `locality`, `developer`. **It must never capture lead PII.** [CRITICAL]
  - [ ] Attach to `projects`, `testimonials`, `faqs`, `statistics`, `media`, `documents`, `leads` (**update/delete only** — creation is public and is its own record), `site-settings`. [CRITICAL]
  - [ ] Add the autosave guard comment: the hook-side autosave signal is **UNVERIFIED**; this is safe only because `autosave: false`. Establish the signal empirically before ever enabling autosave. [CRITICAL]
  - [ ] Establish empirically **which collection hooks fire for draft saves, version writes and restores** — it is UNVERIFIED, and the hook either double-fires (draft save + publish) or never fires. Record the result. [CRITICAL]
- [ ] **(T-065)** Create `src/hooks/authEvents.ts` — `afterLogin`, `afterLogout`, failed login, lockout and password change → `audit-log`. **Versions capture none of these.** Plus a wrapper around `restoreVersion` for the `restore` action. [IMPORTANT]
- [ ] Record the downgrade: `IMPLEMENTATION-DECISION.md` §7/§10's *"Payload's version history covers part of it"* is **the actual hazard** — versions store only `parent`, `autosave`, `version`, `createdAt`, `updatedAt`: no actor, no IP, no action type, no auth events, and `maxPerDoc` prunes so they are **not append-only**. [CRITICAL]

### 4.7 Admin surface, seed, migration

- [ ] **(T-092)** Admin config on `projects`: `useAsTitle: 'name'`, `defaultColumns: ['name','category','locality','featured','_status','updatedAt']`, `listSearchableFields: ['name','locality','slug']`, `group: 'Content'`, `preview: (doc) => \`${env.FRONTEND_URL}/projects/${doc.slug}\``, pagination. [IMPORTANT]
  - [ ] `RowLabel` client components for the **six** repeatable lists so rows read as their title, not "Item 03". Every custom component requires `payload generate:importmap` **in the build**. [IMPORTANT]
  - [ ] `admin.description` warnings: on `approvals` — *"Legal claims — these edits are audited. `approvals[0].title` feeds every project's meta description, so reordering silently changes SEO."*; on `proximity` — *"Only enter distances printed on the brochure."*; on `projectStatus` — *"Leave blank unless the brochure states one."*; on the collection — *"Publishing a sixth project requires a frontend copy change ('Five layouts.')."* [IMPORTANT]
- [ ] **(T-093)** Create `src/seed/data/projects.ts` holding the 5 records **verbatim**, and `src/seed/index.ts` gated on `PAYLOAD_SEED === 'true'` as a **hard refusal, not a skip**. [CRITICAL]
  - [ ] Upsert by natural key — `projects` by `slug`, `users` by `email`, `media` by `originalFilename`, `site-settings` via `updateGlobal`. **No blind `create` anywhere.** [CRITICAL]
  - [ ] Pass `context: { skipAudit: true }` and `overrideAccess: true` on every seed write. [CRITICAL]
  - [ ] **`onInit` is not used for anything.** How many times it runs across instances, whether it runs during `next build`, whether it runs on every HMR reload and whether a throw aborts startup are **all UNVERIFIED**. An `onInit` seed in a two-replica deployment is a race producing duplicate projects. [CRITICAL]
  - [ ] Run via `npm run seed` (`payload run`), **never bare `node`/`tsx`** — `payload run` loads env the way Next.js does and initialises tsx. **Do not install `dotenv`.** [CRITICAL]
- [ ] **(T-094)** Generate the projects-domain migration with `npm run payload migrate:create add-projects-and-media`, **read the file**, and add a CI reversibility test (`migrate` → `migrate:down` → `migrate` on a fresh database). [CRITICAL]
- [ ] **(T-197)** Empirically measure `versions.maxPerDoc` pruning behaviour — synchronous, batched or background — before sizing the database. It is **UNVERIFIED** and, combined with autosave, could grow unbounded. If it does not prune retroactively when `maxPerDoc` is lowered, add a scheduled pruning task. [IMPORTANT]

### Phase 4 — Definition of Done

- [ ] **create → edit → save draft → publish → reorder → unpublish → archive → restore** works end to end in the admin UI, performed by hand and recorded. [CRITICAL]
- [ ] A duplicate slug returns **`409`** with the contract message; changing a published slug is blocked **via the API**, not just greyed out in the UI. [CRITICAL]
- [ ] An invalid `icon` is rejected at the API **and** by the Postgres enum, re-verified on the real repo. [CRITICAL]
- [ ] Unpublished and archived projects are **invisible** to every public endpoint and to Payload's generated endpoints — asserted with `?draft=true` and `?where[_status][equals]=draft`. [CRITICAL]
- [ ] `publishedAt` is set on `draft → published` and cleared on unpublish. [CRITICAL]
- [ ] **Every mutation writes an audit row** with actor, IP, action, entity, and before/after for `approvals`, `area`, `proximity` and title-related fields — verified by publishing **from the admin UI** and finding the row. [CRITICAL]
- [ ] Uploading a JPEG produces a document with server-extracted `width`/`height`, a **UUID storage key**, stripped EXIF, and a preserved `originalFilename`. [CRITICAL]
- [ ] **SVG is rejected. An SVG renamed `.png` is rejected. A `.jpg`-renamed executable is rejected by magic bytes. A 10 001 px image is rejected.** [CRITICAL]
- [ ] `pasteURL === false` on both upload collections — asserted in a config test. [CRITICAL]
- [ ] `toPublicProject()` emits a valid `ImageRef` (`src`, `alt`, `width`, `height`) for the cover, with `depth` pinned so the upload is populated rather than a bare id. [CRITICAL]
- [ ] Migrations for the whole domain apply and roll back cleanly on a fresh database. [CRITICAL]
- [ ] The seed reproduces the 5 projects and is **idempotent** — running it twice produces **5 projects, not 10**. [CRITICAL]

---

## PHASE 5 — Leads & Notifications  *(PARALLEL — start first if time is short)*

> The only phase that closes an **active, ongoing loss**: every enquiry typed into the live form today is discarded. It depends on nothing in the projects chain. Its distinctive failure mode is that everything can appear to work — `201` returned, lead stored — while **zero notifications are sent**. Entry: Phase 3 DoD met; OQ-1, OQ-2, OQ-19 answered; Phase 11's infra available for the worker.

### 5.1 The Leads collection

- [ ] **(T-120)** Create `src/collections/Leads.ts` — PII, **no `versions` key at all** (versioning an operational/PII table multiplies PII copies), **`trash: true`**, `defaultSort: '-createdAt'`. [CRITICAL]
  - [ ] `name` text req — trim, NFC, 1–120, reject control characters, reject punctuation/digits-only. [CRITICAL]
  - [ ] `phone` text req — stored **as submitted, verbatim**. [CRITICAL]
  - [ ] `phoneNormalised` text req — `index: true`, **explicitly NOT `unique`** (one buyer may legitimately enquire about several projects). [CRITICAL]
  - [ ] `projectSlug` text optional, `index: true` — a **soft reference, not an FK**; absent/`""`/`null` allowed, otherwise must match a known slug. **Never trusted.** [CRITICAL]
  - [ ] `project` relationship→`projects`, resolved **server-side** from `projectSlug`. [IMPORTANT]
  - [ ] `projectNameSnapshot` text, server-set — so a historic lead survives a project rename or archive. [IMPORTANT]
  - [ ] `message` textarea optional — trim, ≤2000, **HTML stripped** in `beforeValidate`. [CRITICAL]
  - [ ] `source` select req — `['contact_form','hero_pill','whatsapp','phone']`, `defaultValue: 'contact_form'`, `enumName: 'enum_lead_source'`, **server-assigned**. [CRITICAL]
  - [ ] `sourcePath` text server-set · `isRead` checkbox `defaultValue: false` index · `consentGiven` checkbox `defaultValue: true` · `ipAddress` text · `userAgent` text · `notifiedAt` date (the job's idempotency marker). [CRITICAL]
  - [ ] `leadStatus` select — built but with the **admin control hidden** via `admin.condition` until OQ-3 confirms. `enumName` set so a later value is one `ALTER TYPE`. **Never named `status`.** [IMPORTANT]
  - [ ] Compound index `indexes: [{ fields: ['phoneNormalised','projectSlug'] }]`, **not unique** — it supports the dedupe query. [IMPORTANT]
- [ ] **(T-120)** Pair `admin.readOnly` with **field-level `access: { create: () => false, update: () => false }`** on `source`, `phoneNormalised`, `sourcePath`, `ipAddress`, `userAgent`, `projectNameSnapshot`, `notifiedAt`. `admin.readOnly` does not bind the API and is trivially spoofable over REST. [CRITICAL]
  - [ ] Verification: POST a lead with `"source":"whatsapp"` in the body → the stored value is **`contact_form`**. [CRITICAL]

### 5.2 Normalisation, validation, dedupe

- [ ] **(T-121)** Create `src/hooks/leadNormalise.ts` — a `beforeValidate` hook (so the validator sees the clean value): trim + NFC on `name`; strip non-digits from `phone` → E.164 assuming **`+91`** → `phoneNormalised`; strip HTML from `message`; reject control characters throughout. [CRITICAL]
- [ ] **(T-122)** Validation: `name` 1–120 (`REQUIRED`, `TOO_LONG`, `INVALID`) · phone **≥8 digits per the OQ-19 interim**, ≤15 (E.164 max) (`REQUIRED`, `TOO_SHORT`, `TOO_LONG`, `INVALID`) · reject junk numbers (`0000000000`, all-same-digit) · `message` ≤2000 (`TOO_LONG`) · `projectSlug` must match a known slug (`UNKNOWN_PROJECT`). [CRITICAL]
  - [ ] Write the threshold as a **single named constant** so the OQ-19 tightening to 10 is a one-line change. [CRITICAL]
- [ ] **(T-125)** Create `src/hooks/leadDedupe.ts` — a `beforeValidate` windowed dedupe on `(phoneNormalised, projectSlug)`. Postgres **cannot** express a time-windowed partial unique index (non-immutable predicate), so this is application logic. **Window = 10 minutes**, a **constant in the file, not an env var** — widening it rejects real enquiries and narrowing it admits spam; that belongs in a reviewed commit, not a platform console. [IMPORTANT]

### 5.3 The public write endpoint

- [ ] **(T-123)** Create `src/schemas/lead.ts` — a Zod schema for the `POST /api/v1/leads` body that **rejects unknown properties**, with a closed carve-out list for the honeypot field and `Idempotency-Key`. Cap the body size; enforce a `Content-Type` allow-list and UTF-8. [CRITICAL]
- [ ] **(T-123)** Create `src/app/(public)/api/v1/leads/route.ts` via `definePublicEndpoint()`: [CRITICAL]
  - [ ] Success → **`201`** with `{ data: { id, createdAt, message: 'Thanks — we will call you back.' } }`. **Never echoes stored PII beyond the id.** [CRITICAL]
  - [ ] `Cache-Control: no-store` and correct CORS headers. [CRITICAL]
  - [ ] Honeypot: accepted and **silently discarded**, returning a response **byte-identical** to a successful `201`. **Not the `200` `VALIDATION-RULES.md` suggests** — a different status or body is a signal a bot can use to fingerprint the honeypot. [CRITICAL]
  - [ ] `422` responses carry `details[].field ∈ { name, phone, project, message }` — **matching `ContactForm.tsx`'s input `name` attributes exactly**, so the existing inline error slots need no redesign. Note the body key is `projectSlug` but the **error field is `project`**. [CRITICAL]
  - [ ] Ignore client-supplied `id`, timestamps and `source`; assign `source`, `sourcePath`, `ipAddress`, `userAgent` server-side. [CRITICAL]
  - [ ] Call `payload.create({ collection: 'leads', overrideAccess: true })` — `access.create` is `() => false` so the generated REST route cannot create leads. [CRITICAL]
  - [ ] `Idempotency-Key` handling, TTL 24 h. [OPTIONAL]
- [ ] **(T-124)** Apply the edge rate limits from T-068 to this route specifically: **5/min/IP** and **3/hour/phone**, `429` + `Retry-After`. [CRITICAL]

### 5.4 The notification job

- [ ] **(T-126)** Create `src/jobs/sendLeadNotification.ts` as a `TaskConfig`: `slug: 'sendLeadNotification'`, `retries: 3`, `inputSchema: [{ name: 'leadId', type: 'text', required: true }]`, `outputSchema: [{ name: 'emailSent', type: 'checkbox', required: true }]`. [CRITICAL]
  - [ ] Input is **an id, never the object**. [CRITICAL]
  - [ ] **Idempotent**: short-circuit and return `{ emailSent: true }` if `lead.notifiedAt` is already set. Without it, three retries during a provider blip send the sales team three copies. [CRITICAL]
  - [ ] Throw **`JobCancelledError`** for permanently-invalid input — `SALES_NOTIFICATION_EMAIL` unset, or the lead no longer exists. Retrying cannot help, and burning three attempts hides the real failure behind `totalTried: 3`. [CRITICAL]
  - [ ] After a successful send, assert a truthy provider result (`if (!result) throw`) — **whether `sendEmail` throws or resolves on transport failure is UNVERIFIED**, and this covers the "resolved but did nothing" case. [CRITICAL]
  - [ ] Stamp `notifiedAt` with `overrideAccess: true` and `context: { skipAudit: true }`. [CRITICAL]
  - [ ] **Do not use `onFail` / `onSuccess`** — they appear in the options table with no signature, no arguments and no example anywhere. Failure handling lives in the watchdog. [CRITICAL]
- [ ] **(T-127)** Create `src/hooks/enqueueLeadNotification.ts` — an `afterChange` hook on `operation === 'create'` calling `req.payload.jobs.queue({ task: 'sendLeadNotification', input: { leadId: doc.id }, queue: 'default' })` **inside a `try/catch`** that logs and swallows. [CRITICAL]
  - [ ] The enqueue **is awaited and does carry `req`**, so it shares the mutation's transaction — deliberate. **Any non-awaited call must NOT receive `req`**: an unawaited call carrying `req.transactionID` can return a `201` for a rolled-back write. [CRITICAL]
  - [ ] **Never await the email send in the hook.** [CRITICAL]
- [ ] **(T-132)** Delete `notification_jobs` (DATABASE-SCHEMA Table 15) from the schema document. Record the field mapping: `status` → `completedAt` + `hasError` + `processing`; `attempts` → `totalTried`; `last_error` → `error`; `scheduled_for` → `waitUntil`; `payload` → `input`. [DEFERRED]

### 5.5 Email

- [ ] **(T-128)** Install `@payloadcms/email-nodemailer` at the **exact same version** as `payload`. [CRITICAL]
- [ ] **(T-128)** Wire `email: nodemailerAdapter(...)` in `payload.config.ts`: in production, `{ defaultFromAddress: env.EMAIL_FROM_ADDRESS, defaultFromName: env.EMAIL_FROM_NAME, transportOptions: { host, port, secure, auth: { user, pass } } }`; in dev/staging, **call it with no arguments** → ethereal.email, credentials printed to console, **nothing delivered to a real inbox** — which is also the documented satisfier of *"staging must not send real notifications"*. [CRITICAL]
  - [ ] `defaultFromAddress` and `defaultFromName` are the **two options the docs mark required on every adapter**. [CRITICAL]
  - [ ] `EMAIL_FROM_ADDRESS` must be on a domain whose **SPF, DKIM and DMARC the owner controls**. [CRITICAL]
- [ ] Confirm the **boot guard from Phase 2** is active: production with no `SMTP_HOST` or no `SALES_NOTIFICATION_EMAIL` **refuses to start** — proven by a test. [CRITICAL]
- [ ] **(T-129)** Create `src/email/escapeHtml.ts` — **one reviewed, unit-tested helper**, not an inline `.replace()` at the call site. Payload provides zero escaping. [CRITICAL]
- [ ] **(T-129)** Create `src/email/renderBrandedEmail.ts` (one hand-written table-based layout with inline styles — **no templating library**; Payload ships none and we have two bodies under twenty lines each) and `src/email/renderLeadEmail.ts`. [CRITICAL]
  - [ ] **Escape every attacker-controlled field**: `name`, `phone`, `projectNameSnapshot`, `message`, `source`, `sourcePath`. `name` and `message` are public free text going straight into an HTML email read by SV staff. [CRITICAL]
  - [ ] Emit a **plaintext alternate** alongside the HTML. [IMPORTANT]
  - [ ] Content is exactly: name, phone, project, message, timestamp, source. [IMPORTANT]
- [ ] **No autoresponder to the buyer** (OQ-20 default). Adding one later converts the single Task into a Workflow — mechanical, but a deliberate change. [OPTIONAL]

### 5.6 Queue, worker, watchdog

- [ ] **(T-126)** Configure `jobs` in `payload.config.ts`: `tasks: [sendLeadNotification, revalidatePaths, sweepDeletedMedia, purgeLeadPii, watchdogFailedJobs]`, `processingOrder: 'createdAt'` (FIFO — the oldest lead is notified first), and `access.run` accepting `req.user` **or** `Bearer ${CRON_SECRET}` (returning `false` when the secret is unset). [CRITICAL]
  - [ ] **Two queues, no more:** `default` (`sendLeadNotification`, `revalidatePaths`) and `maintenance` (`sweepDeletedMedia`, `purgeLeadPii`, `watchdogFailedJobs`). [IMPORTANT]
  - [ ] **Do not set `jobs.deleteJobOnComplete`, `jobs.depth` or `jobs.runHooks`** — all three appear nowhere in the live 3.x docs. Accept the defaults; we *want* retention. [CRITICAL]
  - [ ] **Do not set `jobs.enableConcurrencyControl`** — it adds an indexed `concurrencyKey` field and may require a migration, for one task at tens per month. [CRITICAL]
- [ ] **(T-130)** Run the worker as **separate containers**, both `restart: unless-stopped`, both scaled to **exactly one replica**: [CRITICAL]
  - [ ] `worker-default`: `npx payload jobs:run --cron "* * * * *" --queue default --limit 25`. [CRITICAL]
  - [ ] `worker-maintenance`: `npx payload jobs:run --cron "*/15 * * * *" --queue maintenance --handle-schedules`. [IMPORTANT]
  - [ ] **`--handle-schedules` appears on exactly one container.** Multiple schedulers queue duplicate jobs — the docs name this footgun explicitly. [CRITICAL]
  - [ ] **Do not use `autoRun` locally.** Documented dev-only failure: HMR disrupts cron schedules and jobs stop running after the first file save. Use `npm run jobs:run` on demand. [CRITICAL]
  - [ ] Fallback only if a second container is refused on cost: `jobs.autoRun` gated by `shouldAutoRun: async () => process.env.ENABLE_JOB_WORKERS === 'true'` on **exactly one** instance. Second choice — it puts job execution on the request-serving process. [OPTIONAL]
  - [ ] **Both workers must be restarted after every deploy** so they run the new code. [CRITICAL]
- [ ] **(T-131)** Create `src/jobs/watchdogFailedJobs.ts` — there is **no dead-letter queue and no documented backoff**: [IMPORTANT]
  - [ ] Query `payload-jobs` for `hasError: true`, `processing: true` **and stuck**, and `completedAt: null` **and aged**. [IMPORTANT]
  - [ ] Re-queue transient failures with `waitUntil = now + 15 min`, **at most twice**, then alert. [IMPORTANT]
  - [ ] **Alert on a second channel — not email**, because the failure being detected may be that email is broken. [CRITICAL]
  - [ ] Expose a manual re-queue: a small **authenticated** endpoint calling `payload.jobs.runByID({ id })`, surfaced as a `listMenuItems` action. Until it exists, re-queue from a shell. [IMPORTANT]
- [ ] In tests, **never wait on wall-clock cron** — use `payload.jobs.queue(...)` then `payload.jobs.runByID({ id })`, the docs' own deterministic pattern. [CRITICAL]

### 5.7 Admin screens and PII retention

- [ ] **(T-133)** Admin leads list/detail: `defaultColumns`, filters, `defaultSort: '-createdAt'`, click-to-call and WhatsApp deep links. **Never offer hard delete — a lead is a commercial record.** `leadStatus` control hidden unless OQ-3 confirmed. [IMPORTANT]
- [ ] **(T-134)** Create `src/jobs/purgeLeadPii.ts` — a daily `maintenance` task nulling `ipAddress` and `userAgent` on leads older than **90 days**. [IMPORTANT]
  - [ ] Define and document the **lead record's own lifetime** (currently undefined in every source document) — it is an owner decision and a DPDP requirement. [CRITICAL]
  - [ ] Implement erasure-on-request: Trash plus a purge path. [IMPORTANT]
- [ ] **(T-135)** Write the explicit test that **no public route returns lead data in any shape**, authenticated or not — including Payload's generated `/api/leads`. This closes the second half of R-9. [CRITICAL]

### Phase 5 — Definition of Done

- [ ] `POST /api/v1/leads` returns **`201`** with `{ id, createdAt, message }` and `Cache-Control: no-store`. [CRITICAL]
- [ ] A `422` carries `details[].field ∈ { name, phone, project, message }` — verified against `ContactForm.tsx`'s `Errors` map. [CRITICAL]
- [ ] An unknown `projectSlug` is rejected; a client-supplied `source` is ignored; `id`/timestamps in the body are ignored. [CRITICAL]
- [ ] A filled honeypot returns a response **byte-identical** to a successful submission. [CRITICAL]
- [ ] Rate limits trigger at 5/min/IP and 3/hour/phone with `Retry-After`. [CRITICAL]
- [ ] **A notification-provider outage does not fail the request** — proven by pointing SMTP at a black hole and confirming a `201` plus a `payload-jobs` row with `hasError: true`. [CRITICAL]
- [ ] **The application refuses to boot in production with no email adapter configured** — proven by a test. [CRITICAL]
- [ ] The job is idempotent: running the same job twice sends **one** email. [CRITICAL]
- [ ] A lead whose `name` or `message` contains `<script>alert(1)</script>` renders **escaped** in the admin and in the notification email. [CRITICAL]
- [ ] **No public route returns lead data in any shape** — the R-9 test passes, including against `/api/leads`. [CRITICAL]
- [ ] The `leadStatus` control ships **hidden** unless OQ-3 confirmed it. [IMPORTANT]
- [ ] The worker runs as a separate process with a restart policy, and **killing it raises an alert within the monitoring interval**. [CRITICAL]
- [ ] `ipAddress`/`userAgent` purge on schedule, and a lead-record lifetime is documented. [CRITICAL]

---

## PHASE 6 — Media Hardening  *(PARALLEL)*

> Everything here is either blocked on the storage provider or is bespoke policy Payload provides **none** of: referential integrity, soft delete, orphan detection and the grace-period sweeper. The media *library UI* is free; the *deletion policy* is not. Entry: Phase 4's media core; OQ-7a for T-107 only.

- [ ] **(T-107)** Install `@payloadcms/storage-s3` at the exact `payload` version and create `src/media/storage.ts`: [IMPORTANT]
  - [ ] `s3Storage({ enabled: Boolean(env.S3_BUCKET), collections: { media: { prefix: 'media', disablePayloadAccessControl: true, generateFileURL }, documents: { prefix: 'documents', disablePayloadAccessControl: true } }, bucket: env.S3_BUCKET, acl: 'public-read', config: { region: env.S3_REGION, credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }, endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE } })`. [IMPORTANT]
  - [ ] **The plugin is ALWAYS registered**, gated by `enabled`, **never conditionally included** — a config whose *shape* varies by environment generates divergent migrations between machines, a hazard Payload documents itself. [CRITICAL]
  - [ ] `generateFileURL` rewrites to `CDN_BASE_URL`. ⚠️ Its exact signature is **not published** — verify against the generated `.d.ts` before relying on destructured argument names. [IMPORTANT]
  - [ ] `endpoint` and `forcePathStyle` are **AWS-SDK pass-throughs Payload's own docs never name** — valid, but unverified by Payload. Required by MinIO and most non-AWS providers. [IMPORTANT]
  - [ ] **Never set `overwriteExistingFiles: true`** — it breaks the immutable-cache design. A replace must write a **new key**. [CRITICAL]
  - [ ] Run MinIO in Docker locally so the provider choice is five env vars at deploy time. [IMPORTANT]
- [ ] **(T-108)** Configure bucket/CDN policy — **`s3Storage()` cannot set any of these**; they are bucket/CDN configuration and must be written into `SECURITY.md` or they will be forgotten: [IMPORTANT]
  - [ ] Public-read · `Cache-Control: public, max-age=31536000, immutable` · `X-Content-Type-Options: nosniff` · `Content-Disposition: attachment` for PDFs · served from a **separate origin** (`media.<domain>`), never the app origin. [IMPORTANT]
- [ ] **(T-110)** Add `join` fields on `media` — `usedAsCover` (`on: 'image'`), `usedInGallery` (`on: 'gallery'`), `usedAsLayout` (`on: 'layoutImage'`), `usedAsLocationMap` (`on: 'locationMap'`) — all virtual, no storage, surfaced in a "Used in" tab. [IMPORTANT]
  - [ ] The `site-settings.logo` reference is a **Global**, and the Join Field documents only `collection` — count it with an explicit query in the hook, not a join field. [IMPORTANT]
  - [ ] Create `src/hooks/mediaDeleteGuard.ts` — a `beforeDelete` hook summing `totalDocs` across the joins and throwing **`409`** listing exactly what uses the asset. [CRITICAL]
  - [ ] `?force=true` detaches first, then deletes. **Write down the explicit rule** on whether a published project may end up coverless — `?force=true` can strip a published project's required cover. [CRITICAL]
  - [ ] Record that `ON DELETE RESTRICT` is **not replicated** — Payload documents no referential-integrity or cascade behaviour for relationship/upload fields (**UNVERIFIED**), and media delete is soft so the FK never fired anyway. Amend `DATABASE-SCHEMA.md` §9 rather than mandating a constraint Payload will not create. [IMPORTANT]
- [ ] **(T-111)** Create `src/jobs/sweepDeletedMedia.ts` — a daily `maintenance` task deleting S3 objects for `media`/`documents` with `deletedAt < now − 30 days`, **re-checking attachment via the join fields immediately before removal**. [IMPORTANT]
  - [ ] On replace, capture `previousDoc.filename` in `afterChange` and enqueue the **old key** for the same grace period — **what happens to the old S3 object after a replace is UNVERIFIED**, and without this the "an accidental replace is recoverable for 30 days" promise is silently false. [IMPORTANT]
- [ ] **(T-112)** Orphan detection: an "unused only" admin filter driven by the join counts. **Never auto-delete.** [DEFERRED]
- [ ] **(T-113)** Migrate the existing assets per the T-011 resolution: [IMPORTANT]
  - [ ] Run `npm run seed:rasterise` — sharp converts the 8 SVGs to PNG at 1600 px wide; **the output is committed** to `src/seed/assets/`, not generated at seed time. [IMPORTANT]
  - [ ] Rasterise and upload: the **5 project covers**, `master-plan.svg`, `plot-sizes.svg`, `location-thumb.svg`, and the (deduplicated) logo. Attach each to its role. [IMPORTANT]
  - [ ] **Do NOT migrate `hero.svg` / `hero-portrait.svg`** — the files do not exist on disk and nothing renders them. [CRITICAL]
  - [ ] Record plainly: the seeded covers are **rasterised placeholders, not photographs**. `dangerouslyAllowSVG` can only be removed once **real raster art** replaces them — a content deliverable (CONF-77), not an engineering one. [IMPORTANT]
- [ ] **(T-115)** Per-session upload rate limiting at the edge. [DEFERRED]

### Phase 6 — Definition of Done

- [ ] Uploaded files land in S3 under the configured prefix with **UUID keys**, and their public URLs resolve through the CDN host. [IMPORTANT]
- [ ] `curl -I <cdn>/media/<uuid>.jpg` shows `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`; PDFs carry `Content-Disposition: attachment`. [IMPORTANT]
- [ ] Deleting an in-use asset returns **`409` listing what uses it**; `?force=true` detaches then deletes, and the coverless-published-project rule is enforced as written. [CRITICAL]
- [ ] A soft-deleted asset disappears from the library immediately and its storage object **survives the grace period**. [IMPORTANT]
- [ ] Replacing a file writes a **new key**; the document id is unchanged; every attachment still resolves; the old key is retained for the grace period. [IMPORTANT]
- [ ] The "unused only" filter returns exactly the assets with no inbound reference, and **nothing is auto-deleted**. [DEFERRED]
- [ ] The 5 project covers, the logo and the 3 site images exist as real raster assets, and every page that referenced a placeholder now renders a real file. [IMPORTANT]

---

## PHASE 7 — Public API Surface & Revalidation  *(critical path)*

> The public contract is a single artefact with a single control point: **eight** public routes = 6 reads + `POST /leads` (Phase 5) + `/healthz`, one cache policy, one revalidation mechanism, and **one contract test suite** that is the entire defence against contract drift for the life of the product. Entry: Phase 4 complete; the collections backing each endpoint exist; D-012 signed off.

### 7.1 The read endpoints — all through `publicFind()` + `definePublicEndpoint()`

- [ ] **(T-140)** `src/app/(public)/api/v1/projects/route.ts` — **card fields only** (`slug`, `name`, `category`, `locality`, `tagline?`, `summary`, `featured`, `image`, plus `status?`/`developer?` only when set), published only, **in admin order** (sorting on the T-024 order field), with `category?` and `featured?` filters. **No pagination, no search, no sort parameters.** [CRITICAL]
  - [ ] Create `src/serializers/toPublicProjectCard.ts` — the thinner list shape, built key-by-key. [CRITICAL]
  - [ ] **Never expose the fractional order key** — it is not in `types/content.ts`. [CRITICAL]
- [ ] **(T-028 → production)** `src/app/(public)/api/v1/projects/[slug]/route.ts` — the full record, keys exactly as `types/content.ts`. Unpublished or archived → **`404`, never `403`** (*"a 403 confirms it exists"*). [CRITICAL]
- [ ] **(T-141)** `src/app/(public)/api/v1/site-settings/route.ts` + `src/serializers/toPublicSiteSettings.ts` — never emits `updatedBy` or internal ids; **computes `copyrightText`** as `` `© ${new Date().getFullYear()} ${legalName}. All rights reserved.` `` rather than storing it (the stored value contains `[YEAR]` mid-string, which `isPlaceholder()` cannot catch). [CRITICAL]
- [ ] **(T-142)** `src/app/(public)/api/v1/testimonials/route.ts` — **published AND consented only**. [CRITICAL]
- [ ] **(T-143)** `src/app/(public)/api/v1/faqs/route.ts` — ordered, published. [IMPORTANT]
- [ ] **(T-144)** `src/app/(public)/api/v1/statistics/route.ts` — ordered, published; values are **authored TEXT**, never derived from row counts. [IMPORTANT]
- [ ] **(T-145)** `src/app/healthz/route.ts` — a **root Next.js Route Handler** (a Payload `endpoints` entry is *always* under `routes.api`), `export const dynamic = 'force-dynamic'`, a trivial `select 1` probe via `payload.db.drizzle` with `sql` from `@payloadcms/db-postgres/drizzle`. Body: `{ status: 'ok' }` or `503`, **and nothing else** — no version, no hostname, no database name. [CRITICAL]
  - [ ] `src/app/livez/route.ts` — a separate, **DB-free** liveness route, so a degraded database does not cause the orchestrator to kill a healthy process. [CRITICAL]
  - [ ] Keep the probe interval sane: **every probe consumes a pool connection.** [IMPORTANT]
- [ ] **(T-146)** Verify cache semantics on every public GET: `public, max-age=60, stale-while-revalidate=600` + a working `ETag` (a re-request returns **304**). `no-store` on admin routes and `POST /leads`. [CRITICAL]

### 7.2 The strip-list — enforced in `src/serializers/`

- [ ] **(T-052 / T-149)** Every serialiser strips, on the way out: Payload's `{ docs, totalDocs, … }` envelope · `id` · `_status` · `publishedAt` · `deletedAt` · `createdAt` · `updatedAt` · `createdBy` · `updatedBy` · **every array-row `id`** · `_order` · `hasPlaceholders` (admin-side only) · the fractional order key · everything on an upload document except the four `ImageRef` keys. [CRITICAL]
- [ ] **(T-052)** For `projects/{slug}`, **always present**: `slug`, `name`, `category`, `locality`, `summary`, `description`, `highlights`, `image`, `featured` (a real boolean). **Omitted entirely when absent**: `status`, `developer`, `tagline`, `stats`, `amenities`, `approvals`, `locationHighlights`, `proximity`, `area`, `roadDetails`, `gallery`, `layoutImage`, `locationMap`, `cta`, `seo`. [CRITICAL]
- [ ] **(CONF-66)** Bracketed placeholders round-trip **verbatim** — never trimmed, nulled, "cleaned" or omitted. If the serialiser helpfully strips them, `lib/href.ts` stops rendering them inert and **dead links ship looking live**. [CRITICAL]
- [ ] Serialiser output must be **JSON-serialisable** — no `Date` objects, no class instances. `ProjectCatalogue.tsx` receives `Project` objects across the RSC boundary. [CRITICAL]

### 7.3 Revalidation (D-012)

- [ ] **(T-147)** Create `src/hooks/revalidate.ts` as `afterChange` / `afterDelete` **collection hooks** — **never endpoint logic**, because the admin UI publishes directly and never touches our endpoints. Attach to `projects`, `site-settings` and the tier-2 collections. [CRITICAL]
  - [ ] Direct `fetch` to `REVALIDATE_WEBHOOK_URL` with `REVALIDATE_SECRET` first (immediacy); on failure, enqueue the `revalidatePaths` job (`retries: 5`). The bin-script runner's floor is one cron tick (~60 s), which is why the first attempt is not a job. [CRITICAL]
  - [ ] Paths named on a **project** change: `/`, `/projects`, `/projects/{slug}`, `/sitemap.xml`. [CRITICAL]
  - [ ] On a **`site-settings`** change: **revalidate everything** — it feeds `layout.tsx`, `PillNav`, `Footer` and `robots.txt`. This is a distinct path from the per-project case. [CRITICAL]
  - [ ] **A revalidation failure must never fail the admin's save.** Surface *"Saved. The website may take a few minutes to update."* as a warning toast, not an error. [CRITICAL]
- [ ] **(T-147)** Create `src/jobs/revalidatePaths.ts` — `inputSchema: [{ name: 'paths', type: 'text', hasMany: true }]`, POST with the secret, non-2xx → throw. [CRITICAL]

### 7.4 Contract and snapshot tests

- [ ] **(T-148)** Contract tests for **all 6 read endpoints** against the vendored `types/content.ts`, running **in CI**. [CRITICAL]
- [ ] **(T-149)** **Key-set snapshot tests per endpoint** for a thin document and a fully-populated one. This — not the type test — is what catches a new internal field leaking into a public response six months from now. [CRITICAL]

### Phase 7 — Definition of Done

- [ ] All 8 documented routes exist at the agreed paths, with `/healthz` **outside** `/api/v1`. [CRITICAL]
- [ ] An unpublished or archived project returns **`404`, not `403`**. [CRITICAL]
- [ ] Every response matches `types/content.ts` field-for-field — the contract suite covers all 6 read endpoints and **runs in CI**. [CRITICAL]
- [ ] Key-set snapshots exist per endpoint for a thin and a full document, and a newly-added internal field causes a **test failure**, not a silent leak. [CRITICAL]
- [ ] **No admin field, no lead data, no `_status`, no `createdBy`/`updatedBy`, no audit data appears in any public response** — asserted, not assumed. [CRITICAL]
- [ ] `/testimonials` returns only published **and consented** records. [CRITICAL]
- [ ] Public GETs carry `public, max-age=60, stale-while-revalidate=600` and a working `ETag` (304 on re-request). [CRITICAL]
- [ ] **Publishing a project from the admin UI triggers revalidation**, naming `/`, `/projects`, `/projects/{slug}`, `/sitemap.xml` — and a revalidation failure produces a warning toast, **not** a failed save. [CRITICAL]
- [ ] `/healthz` returns `{ status: 'ok' }` when the DB is up and `503` when it is down, leaks no build/host/schema information, and does not exhaust the pool under the orchestrator's probe interval. [CRITICAL]

---

## PHASE 8 — Tier-2 Content  *(PARALLEL)*

> Near-pure configuration with exactly one piece of real logic: the consent gate, which must be **structurally impossible** to bypass. No dependency on projects, media or leads. Entry: Phase 3 DoD met.

- [ ] **(T-160)** Create `src/collections/Testimonials.ts`: `name` text req ≤120 · `role` text ≤120 · `body` textarea req ≤2000 · **`consented` checkbox `defaultValue: false`** · `rating` number **optional** `min: 1, max: 5` with `admin.description: 'Not currently displayed on the website.'` · `avatar` upload→media (**deferred, not modelled in Tier 1** pending CONF-44). `orderable: true`, `versions: { maxPerDoc: 10, drafts: { autosave: false } }`, `trash: true`. [CRITICAL]
  - [ ] Public JSON: `{ id, name, role, rating, body }` — **published AND consented only**. [CRITICAL]
- [ ] **(T-160)** The consent gate, in **two independent layers**: [CRITICAL]
  - [ ] A `beforeValidate` **hook** throwing when `_status === 'published' && !consented`, surfaced as `VALIDATION_ERROR` with `details[].code = CONSENT_REQUIRED` (**not** a tenth top-level code). [CRITICAL]
  - [ ] A real **DB CHECK constraint via a custom migration** — one of only **two** CHECKs retained under D-015 (the other being the icon enum, which a `select` + `enumName` already provides for free). *"A disabled button is not the control."* [CRITICAL]
  - [ ] Verification: an unconsented testimonial cannot be published **via the admin UI**, **via the API**, **and at the database layer**. [CRITICAL]
  - [ ] **Seed nothing into `testimonials`.** The three existing quotes are invented placeholders with bracketed names; seeding them creates the exact artefact this gate exists to make impossible. [CRITICAL]
- [ ] **(T-161)** Create `src/collections/Faqs.ts`: `question` text req ≤300 (**unique within the set** — `Accordion.tsx:28` uses `key={item.q}`) · `answer` textarea req ≤2000. `orderable: true`, drafts on `maxPerDoc: 10`, `trash: true`. Public JSON `{ id, question, answer }`. [IMPORTANT]
- [ ] **(T-162)** Create `src/collections/Statistics.ts`: `label` text req ≤60 · `value` **text** req ≤60. `orderable: true`, drafts on `maxPerDoc: 10`, `trash: true`. Public JSON `{ id, label, value }`. [IMPORTANT]
  - [ ] **`value` is authored TEXT, never computed.** Real values are `[00]+`, `[000]+`, `[0]`, `Immediate`. *"'Plots handed over' is not something this database knows."* Add a review rule: nothing in the codebase derives statistics from row counts. [CRITICAL]
  - [ ] `admin.description: 'Rendered in a 4-column grid on / and /about — exactly 4 or the grid goes ragged.'` [IMPORTANT]
- [ ] **(T-163)** Create `src/globals/SiteSettings.ts` — the **only** global — with tabs Brand / Contact / Social / Legal / Content: [CRITICAL]
  - [ ] Brand: `name` text req ≤120 · `legalName` text req ≤120 (**distinct fields with distinct uses** — CONF-78) · `tagline` text ≤200 · `description` textarea ≤400 · `url` text req (absolute `https://`, **no trailing slash**, and a **publish-blocking `example.com` validator** — `site.url` is the one *unbracketed* placeholder and it evades the inert-link guard) · `logo` upload→media. [CRITICAL]
  - [ ] Contact: `email` text req (valid email **or** `^\[.*\]$`) · `phone` text req · **`whatsapp` text req matching `^\d{10,15}$`** or bracketed — **must not contain `+`, spaces or dashes** · `address` **`text` + `hasMany: true`**, `minRows: 1, maxRows: 5`, each ≤120 (**not a textarea** — it is an ordered 3-line array) · `mapUrl` text · `officeHours` text ≤200. [CRITICAL]
  - [ ] `whatsapp` `admin.description` must say: *"Setting a real value changes the hero: the capture pill stops routing to /contact and opens WhatsApp directly."* Add a live `wa.me/<value>` preview. [IMPORTANT]
  - [ ] Social: `social` array of `{ label, href, iconField() }`. Legal: `legalLinks` array of `{ label, href }` — **a privacy policy link is legally required once PII is collected**. [IMPORTANT]
  - [ ] Content: `formNote` textarea ≤400 (*"must stay truthful to actual data use"*) · `cta` named group `{ title ≤120, body ≤400 }` — **note the shape differs from `Project.cta`** (`{ title, description }`); keep them distinct. [IMPORTANT]
  - [ ] `versions: { max: 50, drafts: false }` — ⚠️ the key is **`max` on globals** and `maxPerDoc` on collections; writing the wrong one is **silently ignored**. Drafts are off deliberately: a draft/published split on site settings creates a *"why isn't my new phone number live?"* failure mode. [CRITICAL]
  - [ ] **`access.read: () => true`.** A forgotten access block 403s the public site while looking fine to a logged-in developer. [CRITICAL]
  - [ ] **Not fields:** `legal.disclaimer` (static — *"changing it is a lawyer's job"*) · `legal.copyright` (**computed**, not stored) · `nav[]` / `footerNav[]` structure (route structure is code) · the **project children** inside nav and footer (**derived** from published projects — FR-CONT-11). [CRITICAL]
- [ ] **(T-164)** Create `src/fields/placeholderText.ts` — a text field where a value matching `^\[.*\]$` **bypasses format checks** (URL/email/phone) but still obeys length limits. Without it the admin **cannot save a partially-known record**, which is the repo's core workflow. [IMPORTANT]
- [ ] **(T-167)** Validate `icon` inside every `social[]` entry against the 41-value enum. `Hero.tsx:83` writes `item.icon as IconName` — a **type assertion**, so the DB enum is the only real protection. [IMPORTANT]
- [ ] **(T-165)** Approved Tier-2 extras and their public endpoints: `heroTicker` (an **array field on the global**, not a `ticker_items` collection — 5 rows, one consumer, no lifecycle), site-wide specifications, site-wide proximity, shared CTA, master-plan PDF. [DEFERRED]
- [ ] **(T-166)** Placeholder-awareness field component + a dashboard counter (OQ-15). Implement the **validation half** (a `validate` that warns on `[...]`) — it is free. Defer the **custom component half**, which R-5 explicitly permits dropping; mitigate with a release checklist. [OPTIONAL]
- [ ] Do **not** build: `site_features`, `site_proximity`, `steps`, `page_content`, `home.benefits`, `media.hero`/`media.heroPortrait`, a `Service` entity, an `Article`/blog entity, a `roles`/`permissions` table, or a `categories` collection. Each has a recorded evidential reason. [CRITICAL]

### Phase 8 — Definition of Done

- [ ] An unconsented testimonial **cannot be published** via the admin UI, via the API, **and** at the database layer (`422` with `details[].code = CONSENT_REQUIRED` + a CHECK constraint that rejects the row). [CRITICAL]
- [ ] Ordering works and persists for testimonials, FAQs and statistics. [IMPORTANT]
- [ ] `site-settings` is readable **unauthenticated** — verified from a logged-out client, because this failure is invisible to a logged-in developer. [CRITICAL]
- [ ] A `[BRACKETED]` value saves successfully and is returned **verbatim** (format validation bypassed, length limits still enforced). [CRITICAL]
- [ ] The WhatsApp field rejects `+`, spaces and dashes, shows a live `wa.me` preview, and warns that a real value changes hero behaviour. [IMPORTANT]
- [ ] Every `icon` inside `social[]` validates against the 41-value enum. [IMPORTANT]
- [ ] Statistics values are stored and returned as **text**, and nothing in the codebase derives them from row counts. [CRITICAL]
- [ ] `site.url` cannot be published as `https://www.example.com`. [IMPORTANT]

---

## PHASE 9 — Frontend Integration  ⚠️ REQUIRES EXPLICIT APPROVAL  *(critical path)*

> The **only** phase that touches `svfrontend/`. Current instructions forbid it. It carries a hard, measurable performance contract that can fail. **NO REDESIGN:** structure, headings, design tokens, Tailwind classes, GSAP/Lenis animation, component hierarchy, `Reveal`, the pill nav and the scroll-scrub sequences **do not change.** The only thing that changes is *where the data comes from*.

- [ ] **(T-170)** **Obtain explicit written human approval to modify `svfrontend/`.** Nothing below may start before this box is checked. [CRITICAL]
- [ ] Entry check: Phase 7 is complete and **stable**; Phase 5's lead endpoint is live. [CRITICAL]

### 9.1 Step 1 — the adapter layer lands first, returning the same static data

- [ ] **(T-171)** Create `svfrontend/src/lib/api/projects.ts`, `site.ts`, `content.ts`. **In step 1 these return the existing static arrays**, typed exactly as today. Pure refactor, zero behaviour change. [CRITICAL]
  - [ ] Functions: `getProjects`, `getProject`, `getFeaturedProjects`, `usedCategories`, `getSiteSettings`, `getFaqs`, `getStatistics`, `getTestimonials`. Every one returns the **existing types from `src/types/content.ts`, unchanged**. [CRITICAL]
- [ ] Convert every consumer to `await` them: `app/page.tsx`, `about`, `contact`, `location`, `master-plan`, `amenities`, `projects`. `app/projects/page.tsx` calls `usedCategories()` **inline in JSX** today and must become `async`. [CRITICAL]
- [ ] Convert the **seven** static `export const metadata` constants to `export async function generateMetadata()` — a module-level constant cannot `await`. `/projects/[slug]` already uses `generateMetadata`. [CRITICAL]
- [ ] **(T-172)** Make `generateStaticParams()` in `src/app/projects/[slug]/page.tsx` `async` and source slugs from `getProjects()`. Leave `dynamicParams` at its default `true` — that is the natural ISR hook for a project created after the last build. [CRITICAL]
- [ ] **(T-171)** Make `src/app/sitemap.ts` `async`, source projects from the data layer, and **add `lastModified` from `publishedAt`** (there is no timestamp in the content model today to derive one from). [IMPORTANT]

### 9.2 Step 2 — the client-boundary fix

- [ ] **(T-174 prerequisite)** `ContactForm.tsx:8` imports `content/projects` directly **into a `'use client'` module**. A client module cannot import server-fetched data. **Lift the project list to a prop** passed down from `src/app/contact/page.tsx`. [CRITICAL]

### 9.3 Step 3 — the two live href bugs (pure bugfixes, shippable alone)

- [ ] **(T-179)** Add `mailHref()` to `src/lib/href.ts`, mirroring the existing `telHref()`. `Footer.tsx:51` and `contact/page.tsx:22` build `` `mailto:${site.email}` `` — the bracket ends up *inside* the string, `isPlaceholder()` returns false, and **a live `mailto:[EMAIL@DOMAIN]` ships on every page today.** [CRITICAL]
- [ ] **(T-179)** Fix `contact/page.tsx:21` — `href: site.whatsapp` is the **raw digit string**, inert today only by accident. The moment it holds `919XXXXXXXXX` it becomes a **relative link to `/919XXXXXXXXX`** → 404. Use `` `https://wa.me/${site.whatsapp}` ``, the construction already correct at `EnquiryPill.tsx:39`. [CRITICAL]
- [ ] Cover both with an assertion so they cannot regress. [CRITICAL]

### 9.4 Step 4 — inert config

- [ ] **(T-176)** Add `images.remotePatterns` to `svfrontend/next.config.mjs` for the CDN host, the bucket host and the Payload host if media is ever proxied. Keep `pathname` tight. 🔴 **Without this, six `next/image` call sites throw `Invalid src prop … hostname is not configured` the instant URLs become remote** — the single highest-probability breakage in this phase. [CRITICAL]
- [ ] Extend `images.qualities` if any CMS image needs a third value — `Logo.tsx:28` is the only non-default today and **Next rejects unlisted quality values**. [IMPORTANT]
- [ ] Create `svfrontend/.env.local` with `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, `REVALIDATE_SECRET`, `NEXT_PUBLIC_ALLOW_INDEXING`. **The repo has zero environment variables today.** [CRITICAL]
  - [ ] `NEXT_PUBLIC_SITE_URL` replaces the hardcoded `site.url = 'https://www.example.com'`, which today makes **every canonical URL, every OG url and every sitemap entry wrong**. [CRITICAL]
  - [ ] `REVALIDATE_SECRET` is **server-only — never `NEXT_PUBLIC_`-prefixed** — and must be **byte-identical** to the backend's. [CRITICAL]

### 9.5 Step 5 — the revalidate route

- [ ] **(T-175)** Create `svfrontend/src/app/api/revalidate/route.ts` — verify the shared secret, then `revalidateTag` / `revalidatePath`. **The repo has no `route.ts` anywhere today.** Still inert at this step. [CRITICAL]

### 9.6 Step 6 — swap the source (the only risky step, and it is one module)

- [ ] **(T-171)** Change the data-layer functions to `fetch` the public API. **The types, the call sites and the rendered output are unchanged.** [CRITICAL]
  - [ ] Cache directives: `next: { revalidate: 3600, tags: ['projects'] }` on `getProjects`; `['projects', \`project:${slug}\`]` on `getProject`; `['site-settings']` on `getSiteSettings`; tagged per resource for faqs/statistics/testimonials. [CRITICAL]
  - [ ] **Everything except the lead POST is server-side.** Visitors never wait on the backend; backend downtime leaves the site serving the last good build. [CRITICAL]
  - [ ] Rollback for this step is a `git revert` of one commit, restoring the static arrays. [CRITICAL]
- [ ] Rewrite `src/content/projects.ts` — the literal array is deleted; `getProject`, `usedCategories`, `featuredProjects` move to the data layer and become `async`. **`categoryOrder` stays in code** — structural display order, a 4-value closed set, changing it needs a deploy regardless. [CRITICAL]
- [ ] Rewrite `src/content/site.ts` — the literal object is deleted and replaced by `getSiteSettings()`. `nav`/`footerNav` **structure** stays in code. [CRITICAL]
- [ ] **(T-181)** Prune `src/content/pages.ts` — delete `home.benefits`, `home.hero.lead`, `home.hero.primaryCta`, `home.hero.secondaryCta`, `location.intro.title`, `location.intro.lead`, `media.hero`, `media.heroPortrait`. All have **zero consumers**, and the last two point at files that **do not exist on disk**. [DEFERRED]
- [ ] **`src/types/content.ts` is UNCHANGED.** It is the contract every serialiser, every contract test and every field name in the Payload config exists to match. **Do not touch it.** [CRITICAL]

### 9.7 Step 7 — derived navigation

- [ ] **(T-173)** Derive the nav (`site.ts:41-49`) and footer (`site.ts:78-86`) **project children** from the published projects. 🔴 `README.md:42` is factually wrong: those are **hardcoded lists of five slugs**, so a CMS-added project is invisible in navigation (FR-CONT-11). [CRITICAL]

### 9.8 Step 8 — the contact form

- [ ] **(T-174)** Replace the deliberate dead end at `ContactForm.tsx:45-50` with a real `fetch` to `POST /api/v1/leads`. [CRITICAL]
  - [ ] **Success only on a real `201`.** [CRITICAL]
  - [ ] Map server `422` `details[].field` into the **existing** `Errors` map — the server's field names (`name`, `phone`, `project`, `message`) match the input `name` attributes exactly, so **the inline error slots need no redesign**. Widen the `Errors` type from `'name' | 'phone'` to include `'project' | 'message'`. [CRITICAL]
  - [ ] Add a pending state and a double-submit guard — **neither exists today**. [CRITICAL]
  - [ ] A `500` shows a failure state **and a request id**. [CRITICAL]
- [ ] **(T-178)** OQ-19 alignment: tighten `ContactForm.tsx:34` to 10 digits **in the same release** the backend tightens (T-010). [CRITICAL]

### 9.9 Step 9 and 10 — copy, error states, cleanup

- [ ] **(T-177)** Fix the three count-coupled hardcoded strings — **"Five layouts."** at `app/page.tsx:66` and `app/projects/page.tsx:19-21`, and "Aler · Bhongir · Genome Valley" at `Hero.tsx:105`. Derive or reword so a sixth project cannot silently make the site lie (OQ-10). [IMPORTANT]
- [ ] Add `src/app/error.tsx` at the root and `not-found` handling for a slug that 404s from the API. **The repo has no `error.tsx` today.** [IMPORTANT]
  - [ ] **Do NOT add `loading.tsx`.** Pages are static; a loading skeleton on a prerendered page is a visual regression, not an improvement. [CRITICAL]
- [ ] `robots.ts` and `layout.tsx:53` carry **two independent indexing blocks** (`disallow: '/'` and `robots: { index: false }`). Make both env-gated on `NEXT_PUBLIC_ALLOW_INDEXING`. Lifting only one leaves the site unindexed with a non-obvious cause. [CRITICAL]
- [ ] **(T-180)** React keys derived from content strings (`key={paragraph}`, `{item.title}`, `{item.place}`, `{stat.label}`, `{image.src}`, `{tile.src}`). Backend uniqueness validators cover `description`; `key={tile.src}` on `PinnedProof` collides **today** if two projects share an image. Switch those to index/id keys, or accept the backend guard. [DEFERRED]
- [ ] **(T-183)** Delete `dangerouslyAllowSVG`, `contentDispositionType` and `contentSecurityPolicy` (3 lines) from `next.config.mjs` — **only after** real raster art replaces every placeholder. Its stated justification (*"the files are first-party"*) evaporates the moment a CMS can upload. [DEFERRED]
- [ ] **No change** to `ProjectCatalogue.tsx` (already prop-driven), `ProjectDetail.tsx`, `ProjectCard.tsx`, `FeatureList.tsx`, `Media.tsx`, `Lightbox.tsx`. [CRITICAL]
- [ ] **What svfrontend does NOT gain:** no UI library, no state manager, no data-fetching library, no analytics, no CSS modules, no new animation dependency. The README's own standard — *"7 direct, 24 total"* — holds through integration. [CRITICAL]

### Phase 9 — Definition of Done  *(the acceptance of the whole product — T-182)*

- [ ] **All routes still prerender** — `.next/prerender-manifest.json` lists the same set, plus any new project. [CRITICAL]
- [ ] **LCP < 2.5 s** and **CLS < 0.05** still hold; First Load JS stays within **102–114 kB**. [CRITICAL]
  - [ ] CLS is the metric most directly threatened: `Plate` and `ProjectCard` use the intrinsic `width`/`height` from `ImageRef`, so wrong or missing dimensions regress it past budget. [CRITICAL]
- [ ] `tsc --noEmit` passes under TS 5.9 strict with `noUncheckedIndexedAccess`. [CRITICAL]
- [ ] **No horizontal overflow at any width from 320 px to 1920 px.** [CRITICAL]
- [ ] Publishing an edit in the admin makes it appear on the site **without a redeploy**. [CRITICAL]
- [ ] The contact form shows success **only** on a real `201`; a `422` renders inline in the existing slots **with no redesign**; a `500` shows a failure state and a request id. [CRITICAL]
- [ ] **Adding a 6th project through the CMS makes it appear in the catalogue, the nav dropdown, the footer column, the sitemap AND `generateStaticParams` — with no hand-edited slug list anywhere.** [CRITICAL]
- [ ] `[BRACKETED]` values still render inert. [CRITICAL]
- [ ] The live `mailto:` and WhatsApp href bugs are fixed and covered by an assertion. [CRITICAL]
- [ ] The three count-coupled strings no longer hardcode a project count. [IMPORTANT]
- [ ] `dangerouslyAllowSVG` is removed (once real raster art has landed). [DEFERRED]

---

## PHASE 10 — Hardening & Verification

> Only the genuinely terminal items remain: executing the formal checklist, the load test, the dependency audit, and — the one nobody remembers — **actually restoring a backup**. Every other test ships with the code it covers. Entry: Phases 4–9 complete.

### 10.1 Test categories, with the named cases

- [ ] **UNIT** (~45 cases, Vitest, no Payload boot): `toPublicProject`, `toPublicProjectCard`, `toPublicSiteSettings`, `toImageRef`, `put()`/`omitEmpty()`, `escapeHtml`, phone normalisation, slugify, `deriveAction`, `diffSensitiveFields`, the Zod schemas. [CRITICAL]
- [ ] **INTEGRATION** (~40, Local API + disposable Postgres): hooks fire, validation rejects, defaults apply, relations populate. [CRITICAL]
- [ ] **CONTRACT** (6 endpoints × 2 shapes ≈ 12): every public response satisfies the real types from `types/content.ts`, plus runtime key-set snapshots. [CRITICAL]
- [ ] **DATABASE** (~8): migrations apply and roll back on a clean database; `generate:types` produces no diff; identifier lengths; enum types exist. [CRITICAL]
- [ ] **AUTH** (~12): login, lockout at 5, unlock after `lockTime`, password policy ≥12, session revocation on password change, `logout?allSessions=true`. [CRITICAL]
- [ ] **ACCESS CONTROL** (~35): the authz matrix — anonymous vs authenticated × every collection × every operation, plus `readVersions`. [CRITICAL]
- [ ] **UPLOAD** (~12, real fixture files in `tests/fixtures/`, local-disk storage via `s3Storage({ enabled: false })`). [CRITICAL]
- [ ] **PUBLIC API** (~20): status codes, cache headers, `ETag`, CORS headers, the error envelope. [CRITICAL]
- [ ] **ADMIN WORKFLOW** (~10, through the **Local API**, which uses the same access control and hooks the admin UI does): create → draft → publish → reorder → unpublish → archive → restore. [CRITICAL]
- [ ] **LEAD FLOW** (~18): validation, honeypot, dedupe, provenance, `422` field names, `no-store`. [CRITICAL]
- [ ] **JOB / EMAIL** (~10, via `payload.jobs.runByID()` + a stub transport): idempotency, `JobCancelledError` on poison input, escaping, the no-adapter boot guard. [CRITICAL]
- [ ] **(T-193) RATE LIMIT** (~4, shell/HTTP against a staging proxy — **not unit-testable; it is proxy configuration**). [IMPORTANT]
- [ ] **(T-194) LOAD** (1 scenario, k6 or autocannon against staging). [IMPORTANT]
- [ ] **E2E browser tests against the admin panel: DO NOT BUILD.** Zero official guidance; Playwright/Cypress/Selenium/Puppeteer appear nowhere in the docs; any suite couples to Payload's internal admin DOM and CSS class names, which are never guaranteed stable, against a project shipping minors roughly weekly. Cover it with the ADMIN WORKFLOW layer plus a one-page manual smoke checklist at release. [DEFERRED]

### 10.2 The six must-have cases — each defends a failure that is SILENT in production

- [ ] **Case 1 — Leads are not public (FR-LEAD-15, R-9).** Create a lead named `Canary` with phone `9876543210`; for each of `/api/v1/projects`, `/api/v1/projects/sri-city-aler-town`, `/api/v1/site-settings`, `/api/v1/testimonials`, `/api/v1/faqs`, `/api/v1/statistics`, assert `JSON.stringify(response)` contains **neither** string. Then assert `payload.find({ collection: 'leads', overrideAccess: false, user: undefined })` rejects or returns **0 docs**. [CRITICAL]
- [ ] **Case 2 — Unpublished projects do not leak (R-12, the highest-severity finding).** Create `slug: 'unapproved-rera'` with `_status: 'draft'`. Assert: `/api/v1/projects/unapproved-rera` → **404**; the list response's slugs do **not** contain it; `?draft=true` → **404**; `?where[_status][equals]=draft` returns nothing. **404, never 403.** [CRITICAL]
  - [ ] Rationale to keep in the test file: a never-published document sits in the **main** table with `_status: 'draft'` and **is returned by a plain `find()`**. For SV Developers the leaked content is uncleared DTCP/RERA claims — the severity is legal, not technical. [CRITICAL]
- [ ] **Case 3 — Omit, don't empty (D-008 + P3).** For the thin project, assert `(k in data) === false` — **`in`, not `=== undefined`** — for all fifteen optional keys, and that `Object.keys(data).sort()` deep-equals `['category','description','featured','highlights','image','locality','name','slug','summary']`. [CRITICAL]
- [ ] **Case 4 — `description` round-trips as `string[]`.** Assert at the **Local API** layer and again at the **HTTP** layer; assert `res.description[0]` has no `value` property; assert `new Set(res.description).size === res.description.length` (the React-key guard). [CRITICAL]
- [ ] **(T-192) Case 5 — Upload security.** Assert rejection of: `placeholder.svg` as `image/svg+xml`; an SVG renamed `.png`; a `.jpg`-renamed executable; a 10 001 px image. Assert a real JPEG yields `filename` matching `/^[0-9a-f-]{36}\.jpg$/`, `originalFilename === 'real-photo.jpg'`, and **stripped EXIF**. [CRITICAL]
- [ ] **(T-193) Case 6 — Rate limiting**, verified against staging with evidence recorded: the **6th** lead submission in one minute from one IP → `429` **with `Retry-After`**; the **4th** submission from one phone in one hour → `429`; the **6th** failed login in 15 minutes → `429`; **and a full `next build` of svfrontend completes with zero `429`s** (the build-origin exemption). [CRITICAL]
- [ ] **Supporting case A — key-set snapshot per endpoint** for a thin and a fully-populated document. [CRITICAL]
- [ ] **Supporting case B — `generate:types` produces no diff** against the committed `payload-types.ts`, run in CI. [IMPORTANT]

### 10.3 Security verification — `SECURITY.md` §18, corrected for D-015

- [ ] **(T-190)** Execute all 22 items **with evidence recorded per item**. A tick is not evidence. [CRITICAL]
  - [ ] 1. No default or seeded credentials remain; **two** admin accounts exist, one per real person. [CRITICAL]
  - [ ] 2. `PAYLOAD_SECRET` is unique per environment, ≥32 bytes, and **boot fails without it** — proven by a test. [CRITICAL]
  - [ ] 3. `cors` and `csrf` are two-origin allow-lists, not `*`, proven **from a browser**. [CRITICAL]
  - [ ] 4. Rate limits are active and **proven to fire** on `/api/v1/leads` and the admin login route, with the build-origin exemption in place. [CRITICAL]
  - [ ] 5. Uploads reject SVG, enforce magic-byte checks, cap size and dimensions, strip EXIF, and use UUID storage keys. [CRITICAL]
  - [ ] 6. Error responses leak nothing — no stack trace, SQL, file path, driver string or library version in any 5xx body. [CRITICAL]
  - [ ] 7. Audit logging verified on every mutation **by publishing from the Admin UI** (not an endpoint) and finding the row. [CRITICAL]
  - [ ] 8. Backups tested **by an actual restore** into a scratch environment. [CRITICAL]
  - [ ] 9. HTTPS + HSTS enforced; the admin is on its own subdomain of the public registrable domain. [CRITICAL]
  - [ ] 10. Privacy policy published and linked, **naming every sub-processor**. [CRITICAL]
  - [ ] 11. PII retention job scheduled and **observed to run**. [CRITICAL]
  - [ ] 12. Public endpoints expose **no** lead data and **no** admin fields — asserted by the key-set snapshot suite. [CRITICAL]
  - [ ] 13. Unpublished and archived content **404s**, including via `?draft=true` and `?where[_status][equals]=draft`. [CRITICAL]
  - [ ] 14. `GET /api/graphql` and `/api/graphql-playground` return **404**. [CRITICAL]
  - [ ] 15. An explicit `access` block on **100 %** of collections and globals, including `readVersions` — proven by a config test. [CRITICAL]
  - [ ] 16. Every server-assigned field carries field-level `access.create/update: () => false`, not merely `admin.readOnly`. [CRITICAL]
  - [ ] 17. `pasteURL: false` on both upload collections — proven by a config test. [CRITICAL]
  - [ ] 18. A reverse-proxy rule blocks `/api/<collection-slug>` paths that are not ours. [CRITICAL]
  - [ ] 19. `npm ls react` shows exactly one copy; all `payload` / `@payloadcms/*` versions identical and exact. [IMPORTANT]
  - [ ] 20. No `migrate:fresh` or `migrate:reset` anywhere in `package.json`, CI, or the runbook. [CRITICAL]
  - [ ] 21. Security headers present on a real response from **both** the admin origin and the media origin. [CRITICAL]
  - [ ] 22. The `PAYLOAD_SECRET` rotation runbook exists **and has been executed once in staging**. [IMPORTANT]
- [ ] **(T-191)** The authz matrix passes in CI: every admin route unauthenticated → `401`; anonymous cannot read leads; anonymous cannot retrieve any project with `_status !== 'published'`; **`?draft=true` cannot surface a draft** (the interaction with a `_status` read constraint is **UNDOCUMENTED** and must be proven, not assumed). [CRITICAL]
- [ ] **(T-070)** Verify production error verbosity leaks nothing. [CRITICAL]

### 10.4 Operations verification

- [ ] **(T-196)** Backups — **Payload documents none of this**: [CRITICAL]
  - [ ] Nightly `docker run --rm postgres:15 pg_dump -Fc …` **or** managed-Postgres PITR. (`psql` is not on PATH; all client tooling goes through Docker.) [CRITICAL]
  - [ ] **S3 bucket versioning + lifecycle rules** — there are **two stores** and both must be in the plan with a stated consistency story. [CRITICAL]
  - [ ] A **mandatory pre-migration backup step** in the deploy runbook. [CRITICAL]
  - [ ] Write down the consistency story: restoring Postgres to T leaves objects uploaded after T as harmless orphans, and objects deleted after T as broken images recoverable from bucket versioning. [IMPORTANT]
  - [ ] 🔴 **Perform an actual restore into a scratch environment and bring the site up from it.** NFR-10 is not satisfied by having backups; it is satisfied by having restored one. [CRITICAL]
  - [ ] Record that backups **contain PII** and inherit the same access controls, retention and encryption as live data; review and record the backup storage ACL. [CRITICAL]
- [ ] **(T-194)** Load-test `POST /api/v1/leads` against NFR-01: **< 500 ms p95**. [IMPORTANT]
- [ ] **(T-195)** Dependency audit: `npm ls react` shows exactly one copy; every `payload`/`@payloadcms/*` version identical and exact; `next`, `react`, `react-dom` pinned with no `^`/`~`; `npm audit --audit-level=high` clean in CI; a CI check asserts the installed `next` is inside Payload's supported set. [IMPORTANT]
- [ ] **(T-197)** `versions.maxPerDoc` pruning behaviour is **measured** and recorded, and the database is sized accordingly. [IMPORTANT]
- [ ] **(T-198)** 🔴 **The privacy policy is published and linked.** This blocks launch, not development. Collecting PII without a reachable privacy policy is the largest compliance gap in the project (DPDP Act). [CRITICAL]

### Phase 10 — Definition of Done

- [ ] The full 22-item security checklist passes, **with evidence recorded per item**. [CRITICAL]
- [ ] **A backup has been restored into a scratch environment and the site brought up from it.** [CRITICAL]
- [ ] Payload's production error verbosity is verified to leak nothing. [CRITICAL]
- [ ] The authz matrix passes, including the `?draft=true` case. [CRITICAL]
- [ ] Upload security tests pass (SVG, magic bytes, size, dimension bomb, EXIF, UUID rename). [CRITICAL]
- [ ] `POST /leads` meets **< 500 ms p95** under load. [IMPORTANT]
- [ ] `npm ls` confirms a single copy of `react`/`react-dom` and identical exact versions across `payload` and every `@payloadcms/*`. [IMPORTANT]
- [ ] `versions.maxPerDoc` pruning behaviour is measured and recorded. [IMPORTANT]
- [ ] **The privacy policy is published and linked.** [CRITICAL]

---

## PHASE 11 — Production Deployment & Go-Live

> The infrastructure work has been running in parallel since Phase 2. What remains is the cut-over and a single end-to-end proof. Entry: Phase 10 DoD met. **Steps are ordered; each gates the next.**

### 11.1 Infrastructure (may run in parallel from Phase 2 onward)

- [ ] **(T-200)** Provision the container host. **Shape is decided: a long-running container host, not serverless.** Recommendation: a single small VPS (2 vCPU / 4 GB) running Docker Compose + managed PostgreSQL + an S3-compatible bucket behind a CDN. [CRITICAL]
  - [ ] **Vercel is explicitly ruled out for the backend** — it forces the 4.5 MB upload cap + `clientUploads`, forbids `autoRun`, penalises `prodMigrations` on cold start, and would still need a separate worker. [CRITICAL]
  - [ ] Decide against the recorded criteria: region (app **and** database in the same region, audience is Indian) · managed Postgres **with PITR** · persistent vs ephemeral filesystem (`useTempFiles` needs a writable `/tmp`) · **can it run a second long-lived process?** · subdomain control · media egress cost · who holds the credentials (storage and email become **DPDP sub-processors** named in the privacy policy). [CRITICAL]
- [ ] **(T-200)** Managed PostgreSQL **15+**, TLS enforced, encryption at rest, never publicly reachable, `disableCreateDatabase: true`. ⚠️ Payload's **minimum supported Postgres version is UNVERIFIED** — 15+ is our floor. [CRITICAL]
  - [ ] **Two database roles:** an app role **without DDL**, and a migrate role **with DDL**. [CRITICAL]
- [ ] **(T-200)** S3-compatible bucket + CDN on a **separate origin** (`media.<domain>`), with bucket versioning enabled. [CRITICAL]
- [ ] **(T-200 / T-203)** Reverse proxy: TLS 1.2+, HTTP→HTTPS redirect, HSTS long `max-age`, the security headers, the rate limits **with the build-origin exemption**, and the `/api/<collection-slug>` block rule. [CRITICAL]
- [ ] **(T-203)** DNS: `www.<domain>`, **`cms.<domain>`** (a subdomain of the **same registrable domain**, so admin cookies stay first-party and `SameSite=Lax` holds), `media.<domain>`. TLS certificates with auto-renewal. [CRITICAL]
- [ ] **(T-201)** Platform secret store; **distinct secrets per environment**; `PAYLOAD_SECRET` ≥32 bytes generated with `openssl rand -hex 32`; no `.env` committed. [CRITICAL]
  - [ ] Write the rotation runbook. It **must** name *"regenerate all API keys"* as a mandatory step — the docs state rotation invalidates them. Rotation is **break-glass only**, never the revocation mechanism. [IMPORTANT]
- [ ] **(T-202)** CI/CD pipeline, in exactly this order: `npm ci` → `npm run payload migrate:status` (**read-only gate**) → `pg_dump -Fc` (**mandatory pre-migration backup**) → `npm run payload migrate` (**a separate pre-deploy job under the DDL-capable role**) → `payload generate:importmap && next build` → build + push image → deploy the CMS container → `/healthz` green → restart both workers → smoke. [CRITICAL]
  - [ ] **`generate:importmap` runs inside the build**, before `next build` — the import map never regenerates at runtime, so a stale map is a **production-only** component-not-found crash. [CRITICAL]
  - [ ] **`migrate:fresh` / `migrate:reset` appear in no script, ever.** [CRITICAL]
  - [ ] **Serialise deploys.** Concurrent-deploy migration races are **UNVERIFIED** — no migration locking or advisory-lock behaviour is documented. [CRITICAL]
  - [ ] `prodMigrations` is the **fallback, not the primary path** — a failed boot-time migration crash-loops the container instead of cleanly rejecting the deployment. Use it only if CI genuinely cannot reach the production database. [IMPORTANT]
- [ ] **(T-204)** Monitoring and alerts — all ours: error rate, **lead-submission failure rate**, **job queue depth and oldest-pending-job age**, **worker liveness**, health-check probe, database connection count, disk. [CRITICAL]
  - [ ] **Three alarms that must exist on day one**, because each corresponds to an otherwise **silent** failure: the worker is dead · a `sendLeadNotification` job has `hasError: true` · `/healthz` has been 503 for more than one interval. [CRITICAL]
  - [ ] Anything email-related alerts on a **second channel**. [CRITICAL]
- [ ] **(T-205)** Write the runbook: deploy · rollback · restore from backup · revoke a session · re-send a failed notification · rotate secrets · reset the local sandbox. [IMPORTANT]
  - [ ] Rollback rules, verbatim: (1) migrate step failed → the deploy was already rejected, the previous release is still serving; triage, do not retry blindly. (2) New release misbehaving, last migration **additive** → redeploy the previous image and **leave the schema forward**; ~2 minutes. (3) Last migration **destructive** → a code rollback is **not** safe; choose restore-from-backup or fix forward. **Default posture: fix forward.** (4) The frontend deploys and rolls back independently. [CRITICAL]
  - [ ] Record the discipline that makes (2) the normal case: **expand-contract on every schema change** — add the new shape, dual-write, migrate readers, drop the old shape in a *later* release. [IMPORTANT]

### 11.2 First-time go-live — execute in this exact order

- [ ] 1. Provisioning complete: host, region, Postgres, bucket + CDN, DNS for www/cms/media, TLS certificates. [CRITICAL]
- [ ] 2. Reverse proxy live: TLS, HSTS, security headers, rate limits (+ build-origin exemption), the `/api/<collection-slug>` block rule. [CRITICAL]
- [ ] 3. Secrets loaded into the platform store; `PAYLOAD_SECRET` ≥32 bytes, **unique to production**. [CRITICAL]
- [ ] 4. Database created; **app role WITHOUT DDL, migrate role WITH DDL**. [CRITICAL]
- [ ] 5. `pg_dump` baseline of the empty database — **it proves the tooling works**. [CRITICAL]
- [ ] 6. `npm run payload migrate:status` → `npm run payload migrate`. [CRITICAL]
- [ ] 7. Build and push the image (`generate:importmap` runs inside the build). [CRITICAL]
- [ ] 8. Deploy the `cms` container; **`/healthz` green**. [CRITICAL]
- [ ] 9. `PAYLOAD_SEED=true npm run seed` → 2 admins, `site-settings`, 5 projects, 9 media assets. [CRITICAL]
- [ ] 10. **Rotate the seeded admin passwords**; confirm no default credentials remain. [CRITICAL]
- [ ] 11. Deploy `worker-default` and `worker-maintenance`. [CRITICAL]
- [ ] 12. **(T-207) Upload one real image in production.** This is the **only reliable check** for the sharp native binary — musl vs glibc, cross-arch prebuilds, `npm ci --omit=optional`. The classic failure is a green build and a first upload that throws at runtime, and Payload documents none of it. [CRITICAL]
- [ ] 13. Point `svfrontend` at `NEXT_PUBLIC_API_BASE_URL`; build and deploy the frontend. [CRITICAL]
- [ ] 14. Verify revalidation end to end: publish a change and watch it appear **without a redeploy**. [CRITICAL]
- [ ] 15. Execute the §10.3 security checklist with evidence per item. [CRITICAL]
- [ ] 16. Perform the restore drill into a scratch environment (NFR-10). [CRITICAL]
- [ ] 17. 🔴 **Publish and link the privacy policy. THIS BLOCKS LAUNCH** (OQ-24). [CRITICAL]
- [ ] 18. Lift **both** indexing blocks — `robots.ts`'s `disallow: '/'` **and** `layout.tsx:53`'s `robots: { index: false }`. Lifting only one leaves the site unindexed with a non-obvious cause. [CRITICAL]
- [ ] 19. **(T-206)** Go-live smoke test. [CRITICAL]
- [ ] **Steady-state deploy** is steps 6–8 plus 11, serialised, with step 5's backup first. [CRITICAL]

### 11.3 Post-deployment verification

- [ ] **(T-206)** **A synthetic lead flows end to end, including the notification landing in the real sales inbox.** [CRITICAL]
- [ ] **(T-206)** An admin logs in, edits a project, publishes, and the change is **visible on the public site** without a redeploy. [CRITICAL]
- [ ] **(T-206) Alerts fire on a simulated failure** — kill the worker, break SMTP, stop the database: **each must produce an alert**. [CRITICAL]
- [ ] Health check green; `curl -I http://cms.<domain>` → 301; the HTTPS response carries `Strict-Transport-Security`. [CRITICAL]
- [ ] Production `Set-Cookie` shows `HttpOnly; Secure; SameSite=Lax; Path=/`, and **admin login succeeds in a real browser**, not only in curl. [CRITICAL]
- [ ] `curl -I <cdn>/media/<uuid>.jpg` shows `nosniff` and `Cache-Control: public, max-age=31536000, immutable`. [CRITICAL]
- [ ] A deliberate migration failure in a scratch environment **rejects the deployment** — proven, not assumed. [CRITICAL]
- [ ] Backup schedule verified running; the restore runbook has been executed at least once. [CRITICAL]
- [ ] `PAYLOAD_SEED` is **unset** in the production environment after step 9. [CRITICAL]
- [ ] `DISABLE_LOGGING` is unset/false; `LOG_LEVEL=info`; `NODE_ENV=production`; `debug: false`. [CRITICAL]
- [ ] Grep a production log sample for phone numbers, `hash`, `salt` and cookie values → **nothing**. [CRITICAL]
- [ ] `git log -p -- .env*` returns nothing. [CRITICAL]
- [ ] Two admin accounts exist; no seeded or default credentials remain. [CRITICAL]

### Phase 11 — Definition of Done

- [ ] Health check green; TLS + HSTS enforced; admin on its own subdomain of the public registrable domain. [CRITICAL]
- [ ] Migrations ran through CI (`migrate` before `build`) and a deliberate failure **rejected** the deployment in a scratch environment. [CRITICAL]
- [ ] Secrets come from the platform store; no `.env` is committed; a rotation runbook exists and names *"regenerate all API keys"*. [CRITICAL]
- [ ] **A synthetic lead flowed end to end, including the notification landing in the sales inbox.** [CRITICAL]
- [ ] An admin logged in, edited a project, published, and the change appeared on the public site. [CRITICAL]
- [ ] **Alerts fired on all three simulated failures.** [CRITICAL]
- [ ] Backup schedule verified running; the restore runbook has been executed at least once. [CRITICAL]
- [ ] Two admin accounts exist; no seeded or default credentials remain. [CRITICAL]
- [ ] A first image upload succeeded in the production container (the sharp native-binary check). [CRITICAL]
- [ ] The privacy policy is live and linked; both indexing blocks are lifted. [CRITICAL]

---

## DOCUMENTATION UPDATES TO MAKE

> Every item below is a **verified correction**: the statement currently in `svbackend/docs/` is false and the replacement is not in doubt. Apply them in Phase 0 unless noted. Nothing in the "BLOCKING BUSINESS DECISIONS" section above may be written into the docs as fact.

### Blockers — apply before any Phase-1 code exists

- [ ] **(CONF-01)** `BACKEND-ROADMAP.md` Phase 1, `IMPLEMENTATION-DECISION.md` §11 + §17, `AI-CONTEXT.md`: Next 15.5.x is **outside every supported range**; record the exact pin (`16.3.3`) and the rule *"never match the frontend's version"*. [CRITICAL]
- [ ] **(CONF-02)** `DATABASE-SCHEMA.md` §3 + §9, `CONTENT-MANAGEMENT-MATRIX.md` §1, `VALIDATION-RULES.md` §3, `API-CONTRACT.md`: `status` is reserved on Postgres + drafts; the Payload fields are `projectStatus` / `leadStatus`, aliased back by the serialiser. [CRITICAL]
- [ ] **(CONF-03)** `SECURITY.md` §1, `REQUIREMENTS.md` FR-AUTH-04, `TRACEABILITY.md` §5: remove `argon2id`; state PBKDF2-SHA256 vendor-neutrally. [CRITICAL]
- [ ] **(CONF-04)** `SECURITY.md` §11 + §18, `ARCHITECTURE.md` §3 + §7, `API-CONTRACT.md` cross-cutting, `REQUIREMENTS.md` FR-AUTH-08 / FR-LEAD-07, `INTEGRATIONS.md` §9: **all HTTP rate limiting is our own edge/WAF work**, not a Payload feature. Delete `RATE_LIMIT_*` from the env lists. [CRITICAL]
- [ ] **(CONF-05)** `ARCHITECTURE.md` §1 + §3 (the *"one middleware guards everything beneath `/admin`"* claim is **false** under Payload), `SECURITY.md` §3 + §4, `API-CONTRACT.md` D-015 banner: mandate the three independent layers on every public read. [CRITICAL]
- [ ] **(CONF-06)** `IMPLEMENTATION-DECISION.md` §15 (R-9), `API-CONTRACT.md` banner, `SECURITY.md` §3: there is **no documented REST kill switch**; record the four achievable steps and that `endpoints: false` is **unverified**. [CRITICAL]
- [ ] **(CONF-07)** `DATABASE-SCHEMA.md` §3, `VALIDATION-RULES.md` §3, `API-CONTRACT.md` §2.6.2, `DECISIONS.md` D-005: delete integer `sort_order`/`sortOrder`; adopt `orderable: true` with fractional-index string keys. [CRITICAL]
- [ ] **(CONF-08)** `BACKEND-ROADMAP.md` Phase 1, `IMPLEMENTATION-DECISION.md` §11 + §17, `ARCHITECTURE.md` §2, `AI-CONTEXT.md`: *"Node ≥20.9.0 (Node 24.x is supported and is what Payload's own Dockerfile uses)"*; do not copy the frontend's `<23`. [CRITICAL]
- [ ] **(CONF-16)** `MEDIA-MANAGEMENT.md` §6 + §11, `SECURITY.md` §10, `BACKEND-ROADMAP.md`: Phase 1 seeds **no media**; the migration **rasterises** before upload; Payload gives us **nothing** here and declaring `mimeTypes` *disables* its own restricted-type check. [CRITICAL]
- [ ] **(CONF-24)** `API-CONTRACT.md` §2.5.8, `ARCHITECTURE.md` §8: `/healthz` must be a **Next.js Route Handler**; config endpoints are always under `routes.api`; Payload ships no health check; `root: true` does not exist. [CRITICAL]

### Mechanism and schema corrections

- [ ] **(CONF-11)** `IMPLEMENTATION-DECISION.md` §7 (✅ → 🟡), `DATABASE-SCHEMA.md` §3, `DECISIONS.md` D-005, Matrix row 27: publish state is **`_status`**, not a date; `publishedAt` is a custom field populated by a hook. [IMPORTANT]
- [ ] **(CONF-12)** Delete `admin_sessions` from `DATABASE-SCHEMA.md` §2 and `ARCHITECTURE.md` §6; Payload puts a `sessions` field on the user document. Retire `SESSION_SECRET`. [IMPORTANT]
- [ ] **(CONF-14 / F-7)** `IMPLEMENTATION-DECISION.md` lines 240/331: **downgrade** *"Payload's version history covers part of it"*. Versions contribute no actor, no IP, no action type, no auth events, and `maxPerDoc` breaks append-only. [CRITICAL]
- [ ] **(CONF-26 / F-2)** `BACKEND-ROADMAP.md`: the Media collection is **upstream** of Project. The old Phase 1 / Phase 5 boundary is **technically impossible**. [CRITICAL]
- [ ] **(CONF-28 / T-132)** Delete `notification_jobs` (Table 15) from `DATABASE-SCHEMA.md`; record the `payload-jobs` field mapping and that **a runner is a hard dependency** — with none, jobs *"will never be executed"* and the UI gives no warning. [IMPORTANT]
- [ ] **(CONF-29)** Record everywhere it applies: `admin.readOnly` is *"without affecting the API"* — pair it with field-level `access` on **every** server-assigned field. [CRITICAL]
- [ ] **(CONF-33)** Record that `width`/`height`/`url`/`thumbnailURL` **are** documented auto-added upload fields (this **removes** risk R-45) — and that we own `width`/`height` anyway, as the stable contract surface. [IMPORTANT]
- [ ] **(CONF-35 / CONF-36)** Record that Payload's default access is `Boolean(user)` (**allow-any-authenticated**, the opposite of deny-by-default) and that **`readVersions` is a seventh access function no project document mentions**. [CRITICAL]
- [ ] **(CONF-50)** `DATABASE-SCHEMA.md`: strike "ULID"; `idType` accepts only `'serial'` or `'uuid'` and is adapter-global. [CRITICAL]
- [ ] **(CONF-51)** `DATABASE-SCHEMA.md`: `citext`, `inet`, `bigint` and `text[]` will not be produced as specified; the **`citext` loss is a real uniqueness weakening** — replace with `afterSchemaInit` + `extendTable` or a lowercasing `beforeValidate` hook. [IMPORTANT]
- [ ] **(CONF-54 / T-012)** `AI-CONTEXT.md` line 110: *"15 core tables"* → *"15 core **logical entities**; Payload-generated `_rels`, `_v`, `_locales` and array tables are exempt."* [IMPORTANT]
- [ ] **(CONF-72)** `DATABASE-SCHEMA.md`: exactly **two** DB CHECKs survive D-015 (the testimonial consent gate; the icon enum, which `select` + `enumName` provides **for free** as a real Postgres enum). Set `enumName` explicitly everywhere. [IMPORTANT]
- [ ] **(CONF-75)** `DATABASE-SCHEMA.md` §9: soft delete makes `ON DELETE RESTRICT` inert and Payload will not create it; record that the guard is 100 % application-level, and that `?force=true` can strip a published project's required cover. [IMPORTANT]

### Contract and API corrections

- [ ] **(CONF-17)** `API-CONTRACT.md`: delete *"(or `null` for scalars)"*; re-render both examples **without** `"status": null` / `"developer": null`. [CRITICAL]
- [ ] **(CONF-18)** `API-CONTRACT.md`: `PATCH /admin/projects/order` collides with `{id}` on seven routes — resolve or drop the route. [IMPORTANT]
- [ ] **(CONF-19)** Fix defect D-8: the partial unique index as written forbids a project having both a cover and a layout. Replaced by schema cardinality. [IMPORTANT]
- [ ] **(CONF-21)** `MEDIA-MANAGEMENT.md`: split the **five project-scoped** roles from the **two site-scoped** roles and give the site-scoped `document` a home (the `documents` collection). [IMPORTANT]
- [ ] **(CONF-31)** `VALIDATION-RULES.md`: the honeypot returns an **indistinguishable `201`**, not `200`. [CRITICAL]
- [ ] **(CONF-34)** `API-CONTRACT.md`: publish the full strip-list. [CRITICAL]
- [ ] **(CONF-38)** The audit `action` enum needs **eleven** values, not seven. [IMPORTANT]
- [ ] **(CONF-39)** Record the **two distinct `cta` shapes** (`Project.cta {title, description}` vs `site.cta {title, body}`); `statistics` gets the same soft delete as its siblings. [IMPORTANT]
- [ ] **(CONF-43)** `hasPlaceholders` is **admin-surface-only** and must never be emitted publicly. [IMPORTANT]
- [ ] **(CONF-48 / CONF-76)** `POST /leads`: name the honeypot field, give "reject unknown properties" its closed carve-out list, and restore the `Content-Type` allow-list and UTF-8 enforcement. [IMPORTANT]
- [ ] **(CONF-53)** Make the Phase-1 exit criteria falsifiable with an **exact key-set assertion** on the thin record `siri-vanam-gummadavelli`. [CRITICAL]
- [ ] **(CONF-64)** State the denominators once: **8 public routes = 6 reads + `POST /leads` + `/healthz`**. [IMPORTANT]
- [ ] **(CONF-66)** Record placeholder fidelity: bracketed values are emitted **verbatim**, never trimmed, nulled or omitted. [CRITICAL]
- [ ] **(CONF-73)** `IMPLEMENTATION-DECISION.md` §16/§19, `DECISIONS.md` D-015, `BACKEND-ROADMAP.md`: the Directus fallback trigger must cover exit criterion **#4**, not only 1–3. [IMPORTANT]
- [ ] **(CONF-79)** The icon enum is **41** values (A5's 40 is a counting error) — and stop maintaining the number by hand; generate it. [IMPORTANT]
- [ ] **(CONF-82)** Add a uniqueness validator note to **every** repeatable list that supplies a React key. [IMPORTANT]

### Frontend-source corrections (record them; the fixes ship in Phase 9)

- [ ] **(CONF-22)** `site.url` is the one **unbracketed** placeholder — it evades the inert-link guard and ships in every canonical, OG url and sitemap entry. Add a publish-blocking `example.com` validator. [CRITICAL]
- [ ] **(CONF-42)** `ContactForm` imports `content/projects` into a `'use client'` module — the read-side refactor is in **no** plan today. [CRITICAL]
- [ ] **(CONF-45)** `next.config.mjs` has **no `images.remotePatterns`**; the old Phase-5 exit criterion is structurally unsatisfiable without a Phase-9 edit. [CRITICAL]
- [ ] **(CONF-56)** `media.hero` / `media.heroPortrait` are dead keys whose files do not exist, and `heroPortrait` is not even an `ImageRef`. [IMPORTANT]
- [ ] **(CONF-58)** The reproducible route count is **15**, not 17 or 18; `/blog` does not exist. [IMPORTANT]
- [ ] **(CONF-59)** `brochureImages` and `Testimonial.rating` are declared and rendered nowhere — **label them, do not silently delete them** from `types/content.ts`. [IMPORTANT]
- [ ] **(CONF-62)** `legal.copyright` embeds `[YEAR]` mid-string and renders literally — **compute it, do not store it**. [IMPORTANT]
- [ ] **(CONF-80 / CONF-81)** Record the two live href bugs (`mailto:[EMAIL@DOMAIN]`; the raw WhatsApp digit href). [CRITICAL]
- [ ] **(CONF-83 / CONF-84)** Record the eight unenforced cardinality assumptions (3-col featured strip, 4-col stats, `projects[0..2]`, `slice(0,4)`, "Five layouts."), that `approvals[0]` silently feeds every project's meta description, and that **eleven proximity items are modelled while `Corridor.tsx:26` renders eight**. [IMPORTANT]

### Governance and bookkeeping

- [ ] **(CONF-10)** `DECISIONS.md` D-014 + `AI-CONTEXT.md`: record that `svbackend` is now a git repo and how the scaffold was merged. [IMPORTANT]
- [ ] **(CONF-15)** `ARCHITECTURE.md` §3: the layering is structurally impossible under Payload; audit and revalidation are **collection hooks**, not endpoint logic. [CRITICAL]
- [ ] **(CONF-37 / CONF-41 / CONF-63 / CONF-68)** Strike P-01 as P-13 is struck; complete D-001's supersession list and fix its provenance date; annotate `~50/14` and state the entity count **once**; record that `DECISIONS.md` is append-only, is not in importance order, and that **no schedule exists anywhere**. [IMPORTANT]
- [ ] **(CONF-49)** Add the D-015 banner to `ARCHITECTURE.md` and `SECURITY.md` §2 and rewrite the §2 stack table. [IMPORTANT]
- [ ] **(CONF-55)** Add *"remove `noindex` and `Disallow: /` — BOTH blocks"* to the pre-production checklist. It is on none today. [CRITICAL]
- [ ] **(CONF-60)** Record that `TRACEABILITY.md` is **not** unaffected by D-015. [IMPORTANT]
- [ ] **(CONF-61)** `SECURITY.md` §16 + §18, `ARCHITECTURE.md` §8: **backup and restore are 100 % our design**; `psql` is absent so all client tooling goes through Docker; never wire `migrate:fresh` into a script. [CRITICAL]
- [ ] **(CONF-65)** Fix the open-questions register: it under-counts by one, classifies OQ-5 twice, and points OQ-1 at the wrong phase (it is Leads, not Tier-2). [IMPORTANT]
- [ ] **(CONF-67)** `ARCHITECTURE.md` §7 + `INTEGRATIONS.md` §9: add `PAYLOAD_SECRET`; keep `DATABASE_URL` (**never `DATABASE_URI`**); add `PAYLOAD_CONFIG_PATH`; add the frontend API base URL; retire `SESSION_SECRET`, `STORAGE_*`, `EMAIL_API_KEY`/`EMAIL_FROM`, `ADMIN_ORIGIN`/`PUBLIC_SITE_ORIGIN` and `RATE_LIMIT_*`; either add `MAPS_API_KEY` to §9 or delete the §5 reference. [CRITICAL]
- [ ] **(CONF-70)** `INTEGRATIONS.md` §7 still reopens the settled OQ-21 and calls a headless CMS "not applicable" — mark it stale. [IMPORTANT]
- [ ] **(CONF-74)** `TRACEABILITY.md`: add the ~20 missing rows and §4's Test column; **derive** the coverage table rather than asserting it. [IMPORTANT]
- [ ] **(CONF-87 / CONF-89 / CONF-90 / CONF-91)** Fix "four media collections" vs five and "4 repeatable lists" vs **six**; state that **Tier is build order and Priority is obligation — they are orthogonal**; the Matrix's counts do not match its rows (**the rows win**); split OQ-12, which is one id doing two jobs. [IMPORTANT]
- [ ] **(CONF-88)** Record that audit **storage** is P1 while the audit **screen** is P2 and is free from Payload's default list view. [IMPORTANT]

### New documents to write

- [ ] Write `svbackend/README.md` with the house rules (push-vs-migrate, never `migrate:fresh`, npm not pnpm, the translated CLI command table, why two Next.js apps exist). [CRITICAL]
- [ ] Write the **Phase-1 GATE REPORT** as a permanent artefact in `svbackend/docs/`. [CRITICAL]
- [ ] Write the **operations runbook** (T-205). [IMPORTANT]
- [ ] Write the **`PAYLOAD_SECRET` rotation runbook**, naming *"regenerate all API keys"*. [IMPORTANT]
- [ ] Write the **photography asset specification** (formats, minimum dimensions, per-project shot list including the homepage media deck) so commissioning is one step (CONF-77). [IMPORTANT]
- [ ] Write the **release manual smoke checklist** that stands in for admin E2E tests. [IMPORTANT]
- [ ] Write the note next to `afterSchemaInit`: *"Columns and tables added in schema hooks are NOT added to the generated `payload generate:db-schema` Drizzle schema"* — a later developer regenerating that file silently loses our custom indexes from the typed file. [IMPORTANT]
