# OPEN-QUESTIONS.md

Unresolved decisions. **Do not guess — ask.** When resolved, move the answer to `DECISIONS.md` and update every affected document.

**Impact:** 🔴 blocks implementation · 🟠 blocks launch · 🟡 shapes design · ⚪ informational

---

## Freeze classification — 20 September 2026

> Every still-open question, classified for implementation. **Nothing below has been decided by engineering.** Where a *safe technical default* exists it is named, and adopting it is recorded as *"engineering adopted the documented interim behaviour"* — **never** as the owner's answer.

| Class | Meaning | IDs |
|---|---|---|
| **BLOCKING MIGRATION** | Must be settled before migration 001 runs | **OQ-25** *(multilingual — safe default applied; see [`MIGRATION-001-DECISIONS.md`](./MIGRATION-001-DECISIONS.md) §5)* |
| **BLOCKING IMPLEMENTATION** | Blocks a specific phase's work, not the whole build | **OQ-1**, **OQ-2** *(Phase 5 — leads destination + a literal recipient address)* · **OQ-7a** *(storage provider — Phase 6, the S3 adapter task only)* · **OQ-18** *(brochure gating — a mutually-exclusive config fork, before the storage task is written)* |
| **BLOCKING LAUNCH** | Blocks go-live. **Blocks no line of code.** | **OQ-6** *(company name)* · **OQ-22** *(all `[BRACKETED]` placeholders)* · **OQ-23** *(testimonials)* · **OQ-24** *(privacy policy — **the only one with legal exposure**)* · **OQ-7b** *(email sending domain + SPF/DKIM/DMARC)* |
| **NON-BLOCKING** | Shapes design; a safe default exists and is applied | **OQ-3** *(lead pipeline — control **not built**)* · **OQ-4** *(single role)* · **OQ-8** *(password reset)* · **OQ-9** *(slug lock)* · **OQ-11** *(hero headline stays in code)* · **OQ-12** *(`noindex` stays in code)* · **OQ-15** *(placeholder awareness)* · **OQ-19** *(phone digits — **interim ≥8**, see below)* · **OQ-20** *(autoresponder — no)* |
| **DEFERRED** | Explicitly out of scope; recorded, not built | **OQ-5** *(who builds custom admin components — zero built through Phase 8)* · **OQ-10** *(count-coupled strings — folded into Phase 9)* · **OQ-13** *(no `Service` entity)* · **OQ-14** *(no blog/`Article`)* · **OQ-16** *(no backend image variants)* · **OQ-17** *(media retention — 30-day grace)* |
| **RESOLVED** | Moved to `DECISIONS.md` | **OQ-21** → D-015 · **OQ-26** → D-029 |

### 🔴 The four that stop launch and that only the owner can answer

**OQ-6 · OQ-22 · OQ-23 · OQ-24.** None blocks a line of code. **Three have no safe default at all** — engineering cannot invent a company name, a privacy policy, or a real customer quote. **OQ-24 carries actual legal exposure**: the contact form collects name + phone under India's DPDP Act while `[PRIVACY_URL]` is inert.

### ⚠️ OQ-19 — the one place an interim default has a visible cost

The live form accepts **≥ 8** digits; `VALIDATION-RULES.md` and `API-CONTRACT.md` say **10**. A backend enforcing 10 against the current frontend **silently rejects real enquiries inside the very phase whose purpose is to stop losing them**.

**Interim applied:** one shared constant `MIN_PHONE_DIGITS = 8`, and error copy that matches the frontend's existing wording. Raising it to 10 is a one-line change that **must ship in the same release as the frontend alignment** (plan §9.6). *This is not the owner's answer to OQ-19 — it is the only setting that cannot lose a lead while the question is open.*

### Questions this register does NOT contain

The investigation created ten **technical** decisions (OQ-27 … OQ-36) — `idType`, the reserved-name rename, ordering, tabs, the REST-surface fork, the jobs table, soft delete, endpoint mechanism, the Next pin, the package manager. They are **not business questions** and are recorded as **`DECISIONS.md` D-016 … D-038** and in plan §26.3. Six of them block migration 001; see [`MIGRATION-001-DECISIONS.md`](./MIGRATION-001-DECISIONS.md).

---

---

## 🔴 Blocking backend implementation

### OQ-1 — Where do leads ultimately go?
**Question:** Persist in our PostgreSQL database, push straight to a CRM, or email only?
**Why it matters:** determines whether the `leads` table, the admin lead screens and FR-LEAD-10..18 exist at all. The frontend PRD raised this (open question 4) and never resolved it.
**Default if unanswered:** persist in our DB **and** notify by email. Lowest regret — data is kept and a CRM can be added later.
**Affects:** `DATABASE-SCHEMA.md` §9, `API-CONTRACT.md`, `ADMIN-CMS-SPEC.md` §5, `BACKEND-ROADMAP.md` Phase 8.

### OQ-2 — Who is notified of a new lead, and how?
**Question:** Which address(es)? Email only, or also WhatsApp/SMS? Instant or digest?
**Why it matters:** determines the integration set and the notification module's shape.
**Default:** instant email to one configured sales address.
**Affects:** `INTEGRATIONS.md` §2, FR-LEAD-05.

### OQ-3 — Is the lead status pipeline real?
**Question:** Will anyone actually move leads through `new → contacted → visit_scheduled → visited → won → lost`?
**Why it matters:** the previous audit flagged this and it remains **INFERRED from the documented sales process, not from any UI**. A status field nobody maintains is worse than none — it looks like data and is not.
**Default:** include the column (nullable) but **hide the control** until confirmed. Cheap to enable, honest if unused.
**Affects:** `DATABASE-SCHEMA.md` §9, FR-LEAD-12, `ADMIN-CMS-SPEC.md` §5.

### OQ-5 — Where does the admin UI live, and who builds it?
**Question:** Separate React app? A `/admin` area inside the existing Next.js site? Server-rendered from the backend? And is building it in scope for this team?
**Why it matters:** changes CORS, session cookie domain, CSRF strategy, and deployment. **This specification covers the backend API; the admin UI is a substantial separate build.**
**Default:** separate authenticated SPA on its own subdomain, consuming the admin API.
**Affects:** `ARCHITECTURE.md` §1/§6, `SECURITY.md` §5/§6, `ADMIN-CMS-SPEC.md` (entirely).

### OQ-7 — Which providers for storage and email? — **SPLIT 20 Sep 2026 into OQ-7a / OQ-7b**

> The original question bundled two decisions with **different blocking behaviour**, which is why the roadmap listed it as blocking two phases at once. They are now separate.

#### OQ-7a — Storage provider · **BLOCKING IMPLEMENTATION (Phase 6 only)**
**Question:** S3 / R2 / Spaces / Cloudinary?
**Why it matters:** needed for the S3 adapter task. ⚠️ **It does not block the `media` collection** — uploads work against local disk until the adapter is enabled (`s3Storage({ enabled })`), so all media modelling, validation and admin work proceeds without it.
**Default:** any S3-compatible provider. `@payloadcms/storage-s3` handles non-AWS providers via `config.endpoint` + `forcePathStyle: true`.
**Affects:** `MEDIA-MANAGEMENT.md` §5, plan §8, §20.

#### OQ-7b — Email provider · **NOT blocking implementation · BLOCKING LAUNCH**
**Question:** Which account, which sending domain, and who configures SPF/DKIM/DMARC?
**Why it matters:** `@payloadcms/email-nodemailer` speaks **any** SMTP transport, so the provider is an **env-var decision, not an architectural one** — it never blocked Phase 5. But **deliverability is entirely outside Payload**, and a notification in a spam folder is indistinguishable from a lost lead.
**Default for development:** `nodemailerAdapter()` with **no arguments** uses ethereal.email and prints credentials to the console — which also satisfies *"staging must not send real notifications"* at zero cost.
**Affects:** `INTEGRATIONS.md` §2/§3, plan §14.

### ~~OQ-21 — Build this CMS, or adopt a headless CMS?~~ ✅ **RESOLVED — 18 Sep 2026**
**Resolution: adopt a headless CMS — Payload CMS 3, self-hosted, on PostgreSQL**, with hand-written custom endpoints for the public API.
**Decided in:** `IMPLEMENTATION-DECISION.md` · logged as `DECISIONS.md` **D-015**.
**Note:** the earlier default ("build custom") was **overturned**. It under-weighted admin-UI cost and wrongly assumed a CMS could not produce the exact documented API shape — Payload's custom endpoints remove that objection.
**⚠️ Provisional** until Phase 1's exit criteria pass; **Directus is the designated fallback**.

---

## 🟠 Blocking launch (not backend development)

### OQ-6 — Company name: "SV Developers" or "SRR Developers Pvt. Ltd."?
`content/site.ts` says *SV Developers*; the brief and live site say *SRR Developers Pvt. Ltd.* The repo deliberately refused to reconcile these by guesswork. Every heading and SEO title renders from `site.name`.
**Impact:** brand identity across the entire site. One-line fix once decided — but nobody can decide it except the owner.

### OQ-22 — Replacement of all `[BRACKETED]` placeholders
Phone, email, WhatsApp, address, domain, approval numbers, RERA registration, statistics, all 11 drive times.
**Why it matters:** the site is `noindex` + `Disallow: /` **because of these**. No backend work removes them — they are facts only the client has. Several (approval numbers, title claims) carry legal weight.

### OQ-23 — Testimonials: real quotes or delete the section?
The three current quotes are **invented placeholders with bracketed names**. The repo is explicit: publishing invented reviews under real-sounding names is a fabricated record.
**Default:** ship with the section empty rather than with placeholders.

### OQ-24 — Privacy policy
`[PRIVACY_URL]` is inert, yet the contact form collects name + phone and promises *"We will only use your number to talk to you about this project."*
**Why it matters:** **collecting PII without a reachable privacy policy is the largest compliance gap in the project** (DPDP Act). Must exist before the form goes live.

---

## 🟡 Shaping design

### OQ-4 — One admin role, or several?
Does sales see only leads while marketing sees only content?
**Default:** single `admin` role. The `role` column exists so adding more is a policy change, not a migration.

### OQ-8 — Password reset by email?
**Default:** no, initially. With a handful of admins, an owner-triggered reset is simpler and removes an attack surface. Revisit as the team grows.

### OQ-9 — Can a published project's slug change?
Changing it breaks live URLs, the sitemap and any shared link.
**Default:** lock after publish; allow an explicit override with a warning. Consider storing old slugs for redirects if this happens often.

### OQ-10 — Fix the count-coupled hardcoded strings?
"Five layouts." appears in JSX on `/` and `/projects`; "Aler · Bhongir · Genome Valley" in the hero. **Adding a 6th project silently makes the site lie.**
**Recommendation:** during frontend integration, derive these from data or reword them. Small change, real correctness win. Requires touching the frontend — out of scope until that phase is approved.

### OQ-11 — Should the homepage hero headline be editable?
**Default:** no — keep in code. If yes, it **must** remain two fields (`title` + `titleAccent`); the `<em>` is the headline's second line, not emphasis.

### OQ-12 — Should `noindex` / `Disallow: /` be an admin toggle?
**Tension:** launch is a one-time event, and an accidental admin click de-indexing the site is a serious, slow-to-notice failure.
**Default:** keep in code. Revisit only if the owner needs staging/production toggling.

### OQ-15 — Should the admin surface unresolved `[BRACKETED]` placeholders?
**Recommendation: yes.** Without it the CMS becomes a way to publish placeholders — the exact failure the frontend was built to prevent.

### OQ-19 — Phone validation: 8 or 10 digits?
The contact form accepts **8+**; the hero pill demands **10**. They disagree today.
**Default:** standardise on **10**. ⚠️ Note that a backend enforcing 10 will reject submissions the current form accepts — the frontend must be aligned in the same release.

### OQ-20 — Autoresponder to the buyer?
**Default:** no initially. It is a marketing message to someone who gave a phone number, and it changes the compliance picture.

---

## ⚪ Informational / deferred

### OQ-13 — What are "services"?
The business brief mentions services; **the frontend has none.** The closest things are infrastructure *specifications* (`amenities.specifications`) and *benefits* (`home.benefits`).
**Position:** **no `Service` entity is being created.** If the owner means something specific, it is a new requirement.

### OQ-14 — Is `/blog` dropped or pending?
`README.md` **and** `docs/PRD-redesign.md` both document a `/blog` route and a `blog.ts` content file. **Neither exists; the route 404s.** It was in the pre-rebuild site and did not survive.
**Position:** no `Article` entity. If the blog returns, it is a new requirement with its own entity, admin screens and public API.

### OQ-16 — Responsive image variants in the backend?
**Recommendation:** no — `next/image` already does this.

### OQ-17 — Retention for deleted/replaced media? **Default:** 30-day grace, then purge.

### OQ-18 — Should brochure PDFs be gated behind a lead capture?
Currently public via the Lightbox download button. Gating is a common real-estate pattern and would increase lead volume — **but it is a business decision, not a technical one.**

### OQ-25 — Multilingual (Telugu)?
Frontend PRD phase 2. **Significant schema impact** — every translatable field becomes a per-locale row. Decide before the schema is finalised, or accept a painful migration later.

---

## Summary

| Impact | Count | IDs |
|---|---|---|
| ✅ **Resolved** | **2** | **OQ-21** (→ D-015) · **OQ-26** (→ D-029, 20 Sep 2026) |
| 🔴 Blocks implementation | 4 | OQ-1, 2, 3, 7 |
| 🟡 Partially answered | 1 | OQ-5 — admin UI is served by the Payload app; *who builds the custom components* is still open |
| 🟠 Blocks launch | 4 | OQ-6, 22, 23, 24 |
| 🟡 Shapes design | 9 | OQ-4, 8, 9, 10, 11, 12, 15, 19, 20 |
| ⚪ Informational | 6 | OQ-13, 14, 16, 17, 18, 25 |
| | **26 total** | OQ-1 … OQ-26 |

> **Count corrected 20 Sep 2026.** This table previously summed to 25 and omitted **OQ-26 entirely**, because OQ-26 was appended below the table rather than into it. Anyone auditing from the table alone therefore missed the single most security-sensitive unresolved item. OQ-26 is now resolved; the row above is the record.
>
> **OQ-5 is classified twice in this file** — 🔴 *blocks implementation* in its own entry above, 🟡 *partially answered* in this table. The table is correct: D-015 answered "where does the admin UI live" (the Payload app serves it), leaving only "who builds the remaining custom components", which blocks no phase before Phase 8.

**OQ-21 is resolved** (`IMPLEMENTATION-DECISION.md`, D-015). **OQ-26 is resolved** by official Payload documentation (D-029). **None of the remaining open questions block Phase 1** — it is a schema and contract validation gate that depends on no business decision.

**Next to answer:** **OQ-7** (storage + email providers) blocks Phases 5 and 7. **OQ-1, 2, 3** block Phase 7 — and Phase 7 is the one that stops leads being lost, so answer them early.

> **Investigation note (20 Sep 2026).** The implementation investigation raised further questions that are *not* yet in this register — including the public URL layout, brochure gating, the phone-digit threshold's coordinated fix, and the literal `[YEAR]` in the copyright string. They are catalogued with classifications and safe defaults in [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) §26 and [`DOCUMENTATION-CORRECTIONS.md`](./DOCUMENTATION-CORRECTIONS.md). They are recorded there rather than added here, because adding questions is a change to this register that the owner should make deliberately.

**New question raised by D-015:**

### ~~OQ-26 — Does Payload's session model satisfy D-004?~~ ✅ **RESOLVED — 20 Sep 2026, by official documentation**

**Question was:** Payload uses httpOnly cookies rather than the server-side session records proposed in D-004. Does it revoke on password change and on account deactivation?

**Resolution: YES for password change, including admin-forced revocation.** Payload 3 defaults to `useSessions: true`, which stores **stateful, revocable sessions** — not the stateless JWTs D-004 assumed. The official documentation states verbatim:

> "With sessions enabled, changing a user's password ends that user's other sessions, so tokens that were issued before the change stop working."
> "Updating a user's password on their behalf, such as an admin updating another user, **ends all of that user's sessions**."
> `useSessions` — "True by default. Set to `false` to use stateless JWTs… Stateless JWTs cannot be revoked, so they stay valid until `tokenExpiration` even after a password change."

Source: `payloadcms.com/docs/authentication/overview`. Logout additionally accepts `allSessions: true`.

**Consequence:** D-004's revocation rationale **is satisfied**, by a different mechanism than it proposed. **No `tokenVersion` field is needed** — do not build one. D-004 is amended (not overturned): the mechanism becomes Payload's session store; the intent is unchanged. `admin_sessions` as a hand-built table is **not** created.

**Residual gap:** revocation on *account deactivation* (as distinct from password change) is **not documented**. Mitigation in `MASTER-IMPLEMENTATION-PLAN.md` §10.7 — deactivation forces a password reset, and `tokenExpiration` is kept short. Verify empirically in Phase 2.

**Moved to:** `DECISIONS.md` D-029.
