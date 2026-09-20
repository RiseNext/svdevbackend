# BACKEND-ROADMAP.md

> ### ⚠️ SUPERSEDED ON PHASE STRUCTURE — 20 Sep 2026
>
> **[`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) §23–§25 is the authoritative phase plan.** The investigation restructured these phases against real dependencies. Follow the plan; use this document for the *intent* behind each phase.
>
> **What changed and why:**
>
> | Here | Restructured | Forcing dependency |
> |---|---|---|
> | Phase 1 bundles spike + foundation + Projects | **Split** into Phase 0 / 1 / 2 | Three decisions that are **irreversible after migration 001** (`idType`, the `status` rename, ordering) sat in no phase at all. See [`MIGRATION-001-DECISIONS.md`](./MIGRATION-001-DECISIONS.md) |
> | Phase 2 "auth and access control" | **Split**; lockdown becomes a **Security Spine** that precedes every content collection | Payload's `access` block lives on **each collection**, and its default is `Boolean(user)` — *any authenticated user, full CRUD*. Until the spine lands, every collection added is a new publicly-addressable endpoint |
> | Phase 5 Media after Phase 4 | **Media skeleton is a Phase-1 prerequisite** | `Project`'s five media roles are `upload` fields with `relationTo: 'media'` — the target collection must exist before the field can be declared. Projects-in-1/media-in-5 is **not late, it is impossible** |
> | Phase 6 Public APIs | `toPublicProject()` + `GET /projects/{slug}` + the contract test move **into the Phase-1 gate** | The serialiser **is** the gate. Payload provides no tooling for omit-don't-empty, so D-008 is 100% hand-written |
> | Phase 7 Leads, after 3 | **Promoted and parallelised** | It depends on nothing in the projects chain, and `@payloadcms/email-nodemailer` speaks any SMTP transport, so the email provider never blocked it. It is the only phase closing an **active, ongoing loss** |
> | Phase 10 terminal testing | Contract/authz/upload/leak tests **distributed to the task they cover** | A terminal testing phase lets the highest-severity defect class exist for the whole build, silently |
> | Phase 11 infrastructure at the end | Infrastructure becomes an **early parallel workstream** | The jobs worker runs as a separate container and the backup restore drill needs a real database |
>
> Two exit criteria here are **not satisfiable as written** and are corrected in the plan: Phase 5's *"uploaded URLs render through `next/image`"* (meeting it requires editing `svfrontend`, which Phase 5 forbids), and Phase 9's *"all 17 routes still prerender"* (**the frontend has 15**).

Phased implementation plan for the **selected architecture: Payload CMS 3, self-hosted, on PostgreSQL** (`IMPLEMENTATION-DECISION.md`, D-015).

**Nothing here is started.** A phase is done when its **exit criteria** pass, not when code exists.

> **Why this sequence changed.** The pre-decision roadmap assumed a custom backend, where auth, admin UI and media library were each large sequential builds. Under Payload those are largely configuration, so the critical path is no longer "build the API" — it is **"prove the schema and the response contract"**. Phase 1 is now a validation gate, and the old Phase 2 (auth) collapses into configuration.

---

## PHASE 0 — Architecture decision ✅ **COMPLETE**

**Delivered:** 18 backend documents; full evaluation of custom vs headless CMS against 40 criteria; **OQ-21 resolved**; stack selected; `DECISIONS.md` D-015 logged.

**Still open from Phase 0** — these do **not** block Phase 1, but do block later phases:

| OQ | Question | Blocks |
|---|---|---|
| OQ-1 | Leads → our DB, a CRM, or email only? | Phase 7 |
| OQ-2 | Who is notified, and how? | Phase 7 |
| OQ-3 | Is the lead status pipeline real? | Phase 7 |
| OQ-7 | Storage and email providers | Phases 5, 7 |
| OQ-5 | Who builds the remaining admin custom components? | Phase 8 |

---

## PHASE 1 — Backend foundation + **schema validation gate** ⬅ **NEXT**

**Entry:** D-015. **This phase decides whether the architecture holds.**

**Deliver:**
1. Payload 3 scaffolded on Next.js, TypeScript strict, Node 20 LTS
2. PostgreSQL connected via the Postgres adapter; migrations forward and back
3. **The complete `Project` collection** — all 25 fields, 4 repeatable feature arrays, stats, proximity, 5 media roles, the 41-value icon `select`, draft/publish, ordering, featured
4. **The 5 existing projects seeded verbatim from `content/projects.ts`, `[BRACKETED]` placeholders included**
5. `toPublicProject()` serialiser + `GET /api/v1/projects/{slug}`
6. **Contract test** asserting the response satisfies `Project` from `types/content.ts`
7. Env validation on boot, error envelope, structured logging with request ids

**Exit criteria — the gate:**
- ✅ Every `Project` field expressible in Payload's Postgres adapter *(closes R-2)*
- ✅ `description` round-trips as `string[]`, **not** `[{id, text}]`
- ✅ Absent optional fields are **absent** from JSON — not `null`, not `[]` *(D-008)*
- ✅ Contract test passes against the real `Project` type *(closes R-1 for projects)*
- ✅ Invalid icon rejected
- ✅ Admin UI renders the project editor usably with **no custom components**
- ✅ Seeded projects match `projects.ts` byte-faithfully

> 🛑 **Stop-and-reassess.** If the first three fail, **D-015 is void and Directus is the fallback.** Do not proceed on hope.

---

## PHASE 2 — Admin authentication and access control

**Entry:** Phase 1 passed. *Mostly configuration under Payload — this is why it is small now.*

**Deliver:** admin users collection; login/logout/session; **deny-by-default access control on every collection**; lockout + login rate limiting; password change; audit hooks on auth events; **lock down or disable every generated endpoint not required** (R-9).

**Exit:** no admin route reachable without a session · generated REST/GraphQL surface audited and closed · lockout triggers and expires · failure messages generic · **D-004 amended to match Payload's cookie model, or overridden deliberately**.

---

## PHASE 3 — Database foundation and remaining collections

**Entry:** Phase 2.

**Deliver:** remaining collections/globals — `leads`, `site_settings` (global), `testimonials`, `faqs`, `statistics`, `media`, `audit_log`; migrations; **custom-migration CHECK constraints for the two highest-value cases — the 41-value icon enum and testimonial consent** (D-011, mitigating R-4); seed script; backup configuration.

**Exit:** migrations reversible · seed reproduces settings + 5 projects · **a restore from backup has actually been performed** · both CHECK constraints reject invalid values at the database layer.

---

## PHASE 4 — Projects: full admin capability

**Entry:** Phase 3.

**Deliver:** publish/unpublish, ordering, featured, archive/restore, slug uniqueness + post-publish lock (FR-PROJ-18), audit on every mutation, admin list columns/filters/drag ordering.

**Exit:** create → edit → publish → reorder → archive works end to end in the admin UI · duplicate slug rejected · icon enum rejects invalid values at API **and** DB · unpublished projects invisible to public endpoints.

---

## PHASE 5 — Media management

**Entry:** Phase 4 + OQ-7 (storage provider).

**Deliver:** S3 adapter; upload validation — type, MIME, **magic bytes**, size and dimension caps, **SVG rejected**, EXIF stripped, UUID keys; server-side dimension extraction; the 5 project media roles with single-valued enforcement; **`beforeDelete` usage guard** (FR-MEDIA-08); orphan query.

**Exit:** SVG rejected · a `.jpg`-renamed executable rejected by magic bytes · dimensions extracted server-side · in-use delete returns 409 · single-valued roles enforce one per project · uploaded URLs render through `next/image`.

---

## PHASE 6 — Public APIs

**Entry:** Phases 4–5.

**Deliver:** the remaining 7 public endpoints as **custom endpoints** — `/projects`, `/site-settings`, `/testimonials`, `/faqs`, `/statistics`, `POST /leads` (Phase 7), `/healthz`; caching headers + ETags; published-only filtering; **explicit allow-list serialisers**; revalidation webhook (D-012).

**Exit:** unpublished → **404 not 403** · every response matches `types/content.ts` field-for-field · **no admin field or lead data appears in any public response** · publishing triggers revalidation · contract tests cover all 6 read endpoints.

---

## PHASE 7 — Leads and notifications

**Entry:** Phase 3 + **OQ-1, OQ-2, OQ-3 resolved**. Can run parallel with 4–6.

**Deliver:** `POST /api/v1/leads` — server validation, slug verification, honeypot, rate limiting, idempotency; queued notification via `afterChange` hook with retry and dead-letter; admin list/detail/archive/CSV; PII retention job.

**Exit:** `422` details map to the frontend's input names (`name`, `phone`, `project`, `message`) · rate limits trigger · **a notification-provider outage does not fail the request** · leads unreachable from every public endpoint · **`status` control ships hidden unless OQ-3 confirmed it**.

> **This phase closes the only gap that exists today** — every enquiry typed into the live form is currently discarded. Strong candidate to pull earlier if effort is constrained.

---

## PHASE 8 — Tier-2 CMS content

**Entry:** Phase 6. **Build only what Phase 0 confirmed.**

**Deliver:** testimonials with the **consent publish gate** (D-011), FAQs, statistics, plus approved Tier-2 (ticker, site-wide specs/proximity, CTA, logo, master-plan PDF) and their public endpoints. Optional: placeholder-awareness component (OQ-15).

**Exit:** an unconsented testimonial **cannot** be published (422) · ordering works · each has a public endpoint returning published records only.

> Under Payload each of these is largely config — the phase that most benefits from D-015.

---

## PHASE 9 — Frontend integration ⚠️ **requires explicit approval**

**Entry:** Phases 6 and 7 complete and stable.

**Deliver:** frontend fetches the public API at build/revalidate time; `generateStaticParams` sourced from the API; `ContactForm` wired to `POST /leads` with pending/success/error states; revalidation route; nav/footer project links derived from published projects (FR-CONT-11); fold in OQ-10 (count-coupled hardcoded strings).

**Exit:** all **15** routes still prerender *(corrected from “17” — an exit test that could not pass as written)* · **LCP < 2.5 s and CLS < 0.05 still hold** · `tsc --noEmit` passes · no horizontal overflow 320–1920 px · publishing an edit makes it appear.

> **The only phase that touches `svfrontend/`.** Needs its own approval — current instructions forbid frontend changes. Two rules carry over: the form shows success **only** on a real `201` (never fake it), and `[BRACKETED]` values still render inert.

---

## PHASE 10 — Testing and security hardening

**Entry:** Phases 1–8.

**Deliver:** unit tests on validation and hooks; integration tests per endpoint; **contract tests against `types/content.ts`**; authz tests (every admin route unauthenticated → 401); **an explicit test that no public route exposes lead or admin data** (R-9); upload security tests; rate-limit tests; the `SECURITY.md` §18 checklist; dependency audit; load test on `POST /leads`.

**Exit:** the full §18 checklist passes · backups restore · Payload's production error verbosity verified to leak nothing.

---

## PHASE 11 — Production deployment

**Entry:** Phase 10.

**Deliver:** production infrastructure, TLS/HSTS, platform secret store, migrations run, monitoring (error rate, lead-submission failures, queue depth), backup schedule verified, runbook, **admin UI on its own domain** (partially answering OQ-5).

**Exit:** health check green · a synthetic lead flows end to end **including notification** · an admin can log in and publish · alerts fire on a simulated failure.

---

## Dependency graph

```
0 ✅ ──► 1 (GATE) ──► 2 ──► 3 ──┬──► 4 ──► 5 ──► 6 ──► 8 ──┐
                                │                          ├──► 9* ──► 10 ──► 11
                                └──► 7 ─────────────────────┘
                                          * needs separate approval
```

## Priority if effort is constrained

1. **Phase 1** — non-negotiable; it validates the architecture
2. **Phase 7 (leads)** — the only phase addressing **active, ongoing loss**
3. **Phases 2–4 (projects CMS)** — the core business requirement
4. **Phase 5 (media)** — projects are not manageable without images
5. **Phases 6 + 9** — makes the CMS visible to the public
6. **Phase 8 (Tier-2)** — valuable, not urgent

## Out of scope for every phase

Public user accounts · payments · booking · `Service` entity · blog/`Article` · plot inventory or pricing · analytics · multilingual · search · microservices · rich-text fields. See `REQUIREMENTS.md` "Explicitly out of scope".
