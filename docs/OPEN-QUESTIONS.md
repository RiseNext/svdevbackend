# OPEN-QUESTIONS.md

Unresolved decisions. **Do not guess — ask.** When resolved, move the answer to `DECISIONS.md` and update every affected document.

> ### ✅ Owner decision pass — 20 September 2026
>
> **CLOSED:** **OQ-6** (company name → "SV Developers", D-122) · **OQ-7a** (storage → Cloudinary, D-123).
> **ALSO DECIDED:** production database → **Neon PostgreSQL** (D-124).
>
> **STILL OPEN, confirmed by the owner rather than assumed:** the **final domain** (D-125 — deliberately not chosen; every place that needs it is enumerated in [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md) §4) · **OQ-24** (privacy policy) · **OQ-23** (testimonials — none invented, to be entered through Admin) · **OQ-22** (`[BRACKETED]` values) · and the **registered legal entity name** (see OQ-6 below).

> ### ✅ Production-readiness pass — 21 September 2026
>
> **CLOSED BY REMOVING THE FEATURE, not by answering the question:**
> **OQ-2** (who is notified of a new lead → **nobody; the administrator reads Admin → Enquiries**) ·
> **OQ-7b** (email provider → **there is none**).
>
> **RESCOPED:** **OQ-24** (privacy policy) is no longer a code gate.
> `PRIVACY_POLICY_URL` was removed — it was rendered nowhere and served to
> nobody, so it could be satisfied without a policy existing while its failure
> mode was switching the enquiry form off. The obligation is real and is
> discharged as **CMS content**: `site-settings.legalLinks` + `formNote`.
>
> **The ONLY remaining blockers are owner CONTENT and the domain.** Not one of
> them blocks a line of code. [`DEPLOYMENT-CHECKLIST.md`](./DEPLOYMENT-CHECKLIST.md)
> is the list.

**Impact:** 🔴 blocks implementation · 🟠 blocks launch · 🟡 shapes design · ⚪ informational

---

## Freeze classification — 20 September 2026

> Every still-open question, classified for implementation. **Nothing below has been decided by engineering.** Where a *safe technical default* exists it is named, and adopting it is recorded as *"engineering adopted the documented interim behaviour"* — **never** as the owner's answer.

| Class | Meaning | IDs |
|---|---|---|
| **BLOCKING MIGRATION** | Must be settled before migration 001 runs | **OQ-25** *(multilingual — safe default applied; see [`MIGRATION-001-DECISIONS.md`](./MIGRATION-001-DECISIONS.md) §5)* |
| **BLOCKING IMPLEMENTATION** | Blocks a specific phase's work, not the whole build | **OQ-18** *(brochure gating — a mutually-exclusive config fork)* · ~~OQ-7a~~ ✅ *closed 20 Sep 2026 → Cloudinary, D-123* · ~~OQ-1, OQ-2~~ ✅ *closed 21 Sep 2026 — enquiries persist in our database and are read in the Admin Panel; nobody is notified* |
| **BLOCKING LAUNCH** | Blocks go-live. **Blocks no line of code.** | **OQ-22** *(all `[BRACKETED]` placeholders)* · **OQ-23** *(testimonials)* · **OQ-24** *(privacy policy — **the only one with legal exposure**; now a CMS content task)* · **the final domain** *(D-125)* · **the registered legal entity name** *(the unclosed half of OQ-6)* · ~~OQ-6 company name~~ ✅ *closed 20 Sep 2026* · ~~OQ-7b email sending domain + SPF/DKIM/DMARC~~ ✅ *closed 21 Sep 2026 — no email* |
| **NON-BLOCKING** | Shapes design; a safe default exists and is applied | **OQ-3** *(lead pipeline — control **not built**)* · **OQ-4** *(single role)* · **OQ-8** *(password reset)* · **OQ-9** *(slug lock)* · **OQ-11** *(hero headline stays in code)* · **OQ-12** *(`noindex` stays in code)* · **OQ-15** *(placeholder awareness)* · **OQ-19** *(phone digits — **interim ≥8**, see below)* · **OQ-20** *(autoresponder — no)* |
| **DEFERRED** | Explicitly out of scope; recorded, not built | **OQ-5** *(who builds custom admin components — zero built through Phase 8)* · **OQ-10** *(count-coupled strings — folded into Phase 9)* · **OQ-13** *(no `Service` entity)* · **OQ-14** *(no blog/`Article`)* · **OQ-16** *(no backend image variants)* · **OQ-17** *(media retention — 30-day grace)* |
| **RESOLVED** | Moved to `DECISIONS.md` | **OQ-21** → D-015 · **OQ-26** → D-029 |

### 🔴 The ones that stop launch and that only the owner can answer

**OQ-22 · OQ-23 · OQ-24 · the final domain · the registered legal entity name.** *(OQ-6's company-name half closed on 20 Sep 2026.)* None blocks a line of code. **Most have no safe default at all** — engineering cannot invent a privacy policy, a real customer quote, a domain, or a registered company name. **OQ-24 carries actual legal exposure**: the contact form collects name + phone under India's DPDP Act while `[PRIVACY_URL]` is inert, which is why the lead endpoint refuses production submissions until it is set.

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

✅ **RESOLVED 21 Sep 2026: persist in our PostgreSQL database, and nothing else.** No CRM, no email. The `leads` table and the admin screens exist; the notification half of the old default was removed (see OQ-2). A CRM export remains additive later — the data is all there.

### ~~OQ-2 — Who is notified of a new lead, and how?~~ ✅ **CLOSED 21 Sep 2026 — NOBODY IS NOTIFIED**

**Resolution:** there is **no notification of any kind**. An enquiry is delivered by being **written to the database**, and the administrator reads it in **Admin → Enquiries**. No email, no WhatsApp, no SMS, no digest.

**Why that is the right answer rather than a descoping:** the notification design existed to move the enquiry from the server to a human, and it introduced a queue hop and a third-party mail provider to do it — with a failure mode where the enquiry saved, the visitor was told "we will call you back", and the business was told nothing, silently. Removing the hop removes that failure mode entirely. The administrator opening the CMS is a step a one-or-two-person business already takes.

**Removed with it:** the `sendLeadNotification` task, the `enqueueLeadNotification` hook, the `leads.notifiedAt` column (migration 004), `src/email/`, `@payloadcms/email-nodemailer`, and 8 environment variables.

**This also closes OQ-7b** (email provider) and removes the "email sending domain + SPF/DKIM/DMARC" launch item.

⚠️ **If a notification is ever genuinely wanted, it is a NEW decision** with its own justification — not this one being reopened by default. `tests/integration/accessControl.test.ts` fails if a nodemailer adapter reappears, so it cannot come back by accident.

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

#### ~~OQ-7a — Storage provider~~ ✅ **RESOLVED — 20 Sep 2026: Cloudinary**
**Resolution:** **Cloudinary**, an owner decision. Logged as `DECISIONS.md` **D-123**, superseding D-112's S3-shape interim. Configuration in [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md) §3.
**What it cost:** Payload publishes no Cloudinary adapter and Cloudinary has no S3-compatible endpoint, so `@payloadcms/storage-s3` was removed and a ~100-line adapter written against the documented `@payloadcms/plugin-cloud-storage` interface. **No migration** — the injected fields are identical.
**Still outstanding:** the Cloudinary account itself (AWAITING INFRA), and the `Content-Disposition: attachment` deviation recorded in D-123.

#### ~~OQ-7b — Email provider~~ ✅ **CLOSED 21 Sep 2026 — BY REMOVING THE QUESTION**

**Resolution: there is no email provider, because there is no email.** See OQ-2 above. No account, no sending domain, no SPF/DKIM/DMARC, no deliverability surface.

⚠️ **One thing this removal fixed that nobody had noticed.** The development default was `nodemailerAdapter()` with no arguments, which **provisions an ethereal.email test account over the network at boot** — on every `payload migrate`, every worker start and every test run. Booting depended on a third-party service unrelated to this product. Payload's own `consoleEmailAdapter` fallback, which is what you get by omitting the `email` key, does not.

**Consequence, recorded rather than discovered later:** the Admin Panel's "Forgot password?" link cannot deliver. Replaced by `npm run admin:reset-password` and by one administrator resetting another's password in Admin → Users — [`RUNBOOK.md`](./RUNBOOK.md) §7.

### ~~OQ-21 — Build this CMS, or adopt a headless CMS?~~ ✅ **RESOLVED — 18 Sep 2026**
**Resolution: adopt a headless CMS — Payload CMS 3, self-hosted, on PostgreSQL**, with hand-written custom endpoints for the public API.
**Decided in:** `IMPLEMENTATION-DECISION.md` · logged as `DECISIONS.md` **D-015**.
**Note:** the earlier default ("build custom") was **overturned**. It under-weighted admin-UI cost and wrongly assumed a CMS could not produce the exact documented API shape — Payload's custom endpoints remove that objection.
**⚠️ Provisional** until Phase 1's exit criteria pass; **Directus is the designated fallback**.

---

## 🟠 Blocking launch (not backend development)

### ~~OQ-6 — Company name~~ ✅ **RESOLVED — 20 Sep 2026: "SV Developers"**
**Resolution:** the public trading name is **SV Developers**, an owner decision, superseding the *SRR Developers Pvt. Ltd.* in the brief and on the live site. Logged as `DECISIONS.md` **D-122**; the consequent code changes are **D-127**.
**It is CMS data, not a constant:** `site-settings.name`, editable in the Admin Panel. Three places that still rendered it from a literal — three page metadata blocks, the logo component, and the lead-notification email — now read the CMS.

> 🔶 **ONE PART REMAINS OPEN.** `site-settings.legalName` is the **registered entity** name and a distinct field: it is the sole source of the footer copyright line. No registered name was supplied, so it mirrors the trading name. If the company is registered as "… Pvt. Ltd.", that exact string is an owner deliverable.

### OQ-22 — Replacement of all `[BRACKETED]` placeholders
Phone, email, WhatsApp, address, domain, approval numbers, RERA registration, statistics, all 11 drive times.
**Why it matters:** the site is `noindex` + `Disallow: /` **because of these**. No backend work removes them — they are facts only the client has. Several (approval numbers, title claims) carry legal weight.

### OQ-23 — Testimonials: real quotes or delete the section?
The three current quotes are **invented placeholders with bracketed names**. The repo is explicit: publishing invented reviews under real-sounding names is a fabricated record.
**Default:** ship with the section empty rather than with placeholders.

### OQ-24 — Privacy policy · **STILL OPEN · a CONTENT task, no longer a code gate**
`[PRIVACY_URL]` is inert, yet the contact form collects name + phone and promises *"We will only use your number to talk to you about this project."*
**Why it matters:** the site collects personal data, so a reachable privacy policy is a genuine obligation (DPDP Act).

**Status at 21 Sep 2026 — RESCOPED, and the rescope is evidence-based.**

🔴 **`PRIVACY_POLICY_URL` HAS BEEN REMOVED.** The entry below used to describe it as "the production safeguard, untouched". It was investigated and it was not a safeguard:

- it was read in **exactly one place** — a boolean that made `POST /api/v1/leads` return 503 in production;
- it was **never rendered, never served to the frontend, and never linked from anything a visitor could see**;
- therefore **setting it to any syntactically valid URL satisfied the gate without a policy existing**, and leaving it unset switched off the only feature the website is for.

A guard that can be satisfied without doing the thing, and whose failure mode is disabling the product, is not a guard. **The obligation is real; the mechanism was theatre.**

**Where the obligation is actually discharged — two places, both CMS content, neither needing a deploy:**

1. **Site Settings → Legal → `legalLinks`** — the footer link the frontend `Footer` renders on every page. Currently `[PRIVACY_URL]`, rendered inert by the placeholder guard, so no dead link ships meanwhile.
2. **Site Settings → Content → `formNote`** — the consent sentence beside the submit button, still reading `[LINK TO PRIVACY POLICY]`.

⚠️ **The sub-processor list SHRANK on 21 Sep 2026 and is now exactly two:** **Neon** (the database, which holds the enquiries) and **Cloudinary** (media, which holds no enquiry data). *The email provider left the list because there is no email provider* — OQ-7b is closed by removal.

🔴 **The policy must not claim the site collects an email address.** The contact form does not ask for one and the database does not store one. The complete collected-field list is in [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md) §5; the launch steps are in [`DEPLOYMENT-CHECKLIST.md`](./DEPLOYMENT-CHECKLIST.md) §5.

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
