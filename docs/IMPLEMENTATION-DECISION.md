# Implementation Decision

**Date:** 18 September 2026 · **Status:** DECIDED · **Logged as:** `DECISIONS.md` D-015
**Scope:** how to build the backend. **No code written.**

---

## 1. Executive Summary

**Decision: Option B — a headless CMS. Specifically Payload CMS 3, self-hosted, on PostgreSQL.**

The reasoning is not "a CMS is faster". It is that this project's cost is concentrated in the parts a CMS gives away, and its risk is concentrated in the parts Payload specifically lets you keep.

Three findings drove it:

1. **The admin UI is the largest single deliverable, and it is invisible in the API design.** `ADMIN-CMS-SPEC.md` specifies nine screens, including a project editor with ~20 scalar fields, four repeatable icon-bearing lists, five media roles, and a drag-reorderable list view — plus a full media library with upload, replace, usage-tracking and orphan detection. Hand-building that is plausibly more work than all ~60 API endpoints combined. A custom backend delivers **none** of it.

2. **The API response shape is a hard contract, not a preference.** `src/types/content.ts` defines `Project` with **17 of 25 fields optional**, and `ProjectDetail.tsx` drops an entire page section when one is falsy. A generic CMS's default serialisation (wrapper envelopes, `[]` for empty collections, injected `id`/`createdAt`/`publishedAt`) violates this. **This is the single strongest argument against a CMS — and the specific reason the chosen CMS is Payload**, which supports fully custom endpoints as ordinary TypeScript.

3. **The project is TypeScript end to end, and the frontend type is the contract.** The highest-value correctness guarantee available is "the API response matches `Project`". In TypeScript that is a compile-time check. In any other language it is a test somebody has to remember to write.

Payload uniquely resolves the tension: **generated admin UI and media library for free, plus hand-written public endpoints that return exactly the documented shape.** It is better understood as *a TypeScript backend framework that ships an admin UI* than as a CMS you are locked inside.

**FastAPI/Python was evaluated and rejected** — not on quality, but because it would force a hand-maintained second copy of the type contract in a second language, while still leaving the admin UI to build from scratch.

---

## 2. Actual Project Requirements

From the documentation and verified against frontend source.

| Dimension | Reality |
|---|---|
| Content volume | **5 projects.** Single-digit for the foreseeable future |
| Lead volume | Tens per month (inferred) |
| Admin users | **One role**, few people (OQ-4) |
| Public traffic | Marketing site, mid-range Android audience |
| Public API | **8 endpoints**, 6 of them read-only |
| Admin API | **~52 endpoints** |
| Database | 15 core tables |
| Admin screens | **9**, one of them very complex |
| Write path from public | **Exactly one** — `POST /leads` |

**What this is:** a small-data, high-structure CMS with one public write and an unusually prescriptive response contract.

**What this is not:** a high-throughput system, a multi-tenant platform, or a domain with complex business logic. There are no transactions, no pricing, no workflow engine, no calculations. The `statistics` values are **typed strings, not aggregates** (D-009).

That profile matters: **effort here is dominated by CRUD surface and admin UI, not by algorithms.** Any evaluation that ignores admin UI cost will reach the wrong answer.

### The requirements that actually stress the choice

| Requirement | Source | Why it is hard |
|---|---|---|
| **Omit-don't-empty** | D-008, `ProjectDetail.tsx` | 17/25 optional fields; `[]` vs absent changes the rendered page |
| **`description: readonly string[]`** | `types/content.ts:72` | Bare ordered string array, not objects, not rich text |
| **41-value `icon` enum** | `ui/Icon.tsx:7-48` | Invalid value renders nothing — silent breakage |
| **5 media roles, 3 single-valued** | `types/content.ts:90-98` | cover/layout/location_map are 0..1; gallery/brochure are ordered n |
| **Media delete guarded by usage** | FR-MEDIA-08 | Deleting an in-use asset must 409, not break a live page |
| **Consent gate on testimonials** | D-011 | Publish must be *impossible* without `consented = true` |
| **Admin-only leads** | FR-LEAD-15 | PII must never appear on a public route |
| **Lead pipeline** | FR-LEAD-05..09 | Rate limit, honeypot, idempotency, queued notification |
| **`title` + `titleAccent`** | D-010 | Two fields, never one rich-text blob |
| **Publish / order / featured / archive** | D-005, D-006 | New capabilities with no frontend equivalent today |

---

## 3. Option A — Custom Backend

A hand-written API service (FastAPI/Python or Fastify/TypeScript) plus a hand-written admin SPA.

### Advantages

- **Total control of response shape.** Omit-don't-empty is trivial — you write the serialiser.
- **No framework impedance.** Every documented rule implemented exactly as written.
- **Full database ownership.** `DATABASE-SCHEMA.md` becomes literal DDL: partial unique indexes, CHECK constraints, `text[]` columns, all exactly as specified.
- **No third-party lock-in** beyond ordinary libraries.
- **Custom flows are native.** Lead capture, rate limiting, honeypot, idempotency and queued notification are just code.
- **Straightforward testing.** Plain functions and routes.
- **No upgrade treadmill** imposed by a CMS's release cycle.

### Disadvantages

- **The admin UI must be built from scratch.** Nine screens (`ADMIN-CMS-SPEC.md`), including a project editor with four repeatable lists, an icon picker over 41 values, five media pickers, drag reordering, unsaved-change guards and field-level server-error mapping. **This is the dominant cost of Option A and it is easy to underestimate.**
- **The media library must be built from scratch** — upload with progress, grid, search, alt-text editing, replace, usage tracking, orphan detection, delete guards.
- **Auth from scratch** — hashing, sessions, lockout, CSRF, password change.
- **~52 admin endpoints hand-written**, most of them mechanical CRUD.
- **Slowest path to a usable admin.** Nothing is demonstrable until a large amount of UI exists.
- **Every future content type repeats the whole cycle** — table, endpoints, screens.

### Project Fit

Technically perfect and economically poor. It nails a contract problem that is genuinely important, then spends the majority of its budget rebuilding an admin UI and media library that are commodity solved problems. For **5 projects and one admin role**, that trade is bad.

It would be the right answer if the domain had real business logic, or if the API contract could not be satisfied any other way. **Neither holds** — and Payload satisfies the contract via custom endpoints.

---

## 4. Option B — Headless CMS

A CMS providing schema modelling, an auto-generated admin UI, media library, auth and RBAC.

### Advantages

- **Admin UI generated from schema** — the single largest cost of Option A, eliminated.
- **Media library included** — upload, browse, replace, delete, metadata.
- **Auth and RBAC included** — FR-AUTH-01..09 largely satisfied out of the box.
- **Draft/publish built in** — directly serves D-005.
- **Dramatically faster to a working admin.** Demonstrable in days, not weeks.
- **New content types are cheap** — Tier-2 (testimonials, FAQs, statistics, ticker) becomes near-free, where in Option A each costs a table + endpoints + screens.
- **Maintained by others** — security patches on auth and upload handling.

### Disadvantages

- **Default response shape fights the contract.** Envelopes, `[]` for empty collections, injected system fields — all violate D-008.
- **Schema is expressed in the CMS's vocabulary**, so `DATABASE-SCHEMA.md` becomes a logical spec rather than literal DDL.
- **Hard DB constraints are awkward.** Partial unique indexes and CHECK constraints usually become hooks or custom migrations.
- **Custom flows sit inside framework conventions** you must learn.
- **Framework upgrade cycle** you do not control.
- **Some lock-in** — variable by product.
- **Risk of the "80% trap"**: fast to most of the way, then friction on the last stretch.

### Project Fit

Strong — **provided the chosen CMS can express custom endpoints and custom access control as ordinary code.** If it cannot, the response-shape and lead-pipeline requirements become sustained friction and the advantage erodes.

That single criterion is what narrows the field to Payload.

---

## 5. Requirement-by-Requirement Comparison

Scored against the 40 criteria. ✅ strong · 🟡 workable with effort · ❌ poor.

| # | Requirement | Custom Backend | Headless CMS (Payload) | Project Impact |
|---|---|---|---|---|
| 1 | Admin authentication | 🟡 Build from scratch | ✅ Built in | CMS saves real work; auth is easy to get subtly wrong |
| 2 | Admin authorization | ✅ Full control | ✅ Access-control functions in TS | Equal. Single role (OQ-4) makes it easy either way |
| 3 | Project CRUD | 🟡 ~9 endpoints + UI | ✅ Generated | **Largest single saving** |
| 4 | Project publishing | 🟡 Hand-built | ✅ Native drafts | D-005 satisfied natively |
| 5 | Project ordering | 🟡 Hand-built drag UI | ✅ Native ordered list | D-005; drag UI is fiddly to hand-build |
| 6 | Featured projects | ✅ Boolean | ✅ Checkbox | Equal |
| 7 | Archive behaviour | ✅ Exact `deleted_at` | 🟡 Via soft-delete/trash or a hook | D-006; needs verification, not hard |
| 8 | Nested/repeatable content | ✅ Exact | ✅ `array` fields, genuinely ordered | 4 lists + stats + proximity |
| 9 | Custom project fields | ✅ Anything | ✅ Rich field types | 25 fields, 17 optional |
| 10 | Media management | ❌ **Build a whole library** | ✅ Included | **Second-largest saving** |
| 11 | Project media roles | ✅ Exact constraints | ✅ Single vs multi upload fields | 3 single-valued, 2 ordered |
| 12 | Media replace/delete | 🟡 Build it | 🟡 Built in; **usage guard needs a hook** | FR-MEDIA-08 not free anywhere |
| 13 | Media validation | ✅ Exact | ✅ Hooks + config | SVG rejection, magic bytes — custom in both |
| 14 | Site settings | 🟡 Singleton + UI | ✅ Native "global" | Clean fit |
| 15 | Lead management | ✅ Exact | ✅ Collection + admin UI free | Admin lead screens free |
| 16 | Lead status | ✅ Exact | ✅ Select field | **Stays hidden until OQ-3** either way |
| 17 | Lead notifications | ✅ Native | ✅ `afterChange` hook | Equal |
| 18 | **Public API shape** | ✅ **Exact** | 🟡 **Custom endpoints required** | **The decisive risk — see §6** |
| 19 | Admin API | 🟡 ~52 endpoints | ✅ Generated | Huge saving |
| 20 | **Exact response shapes** | ✅ Exact | 🟡 Custom endpoints + serialiser | **See §6** |
| 21 | Validation rules | ✅ Zod | ✅ Field validation + hooks | Equal |
| 22 | **Omit-don't-empty** | ✅ Native | 🟡 **Serialiser required** | **17/25 optional fields. §6** |
| 23 | Custom enums (41 icons) | ✅ Enum + CHECK | ✅ `select` options | Generate from `IconName` either way |
| 24 | Public/private separation | ✅ Path prefix | ✅ Access control + custom routes | Must be verified by test either way |
| 25 | Security | 🟡 All yours | ✅ Maintained core, custom edges | CMS reduces the chance of a self-inflicted auth bug |
| 26 | Rate limiting | ✅ Middleware | ✅ Custom endpoint middleware | Equal |
| 27 | File storage | 🟡 Build adapter | ✅ S3 adapter available | Saving |
| 28 | Email integration | ✅ Native | ✅ Hook | Equal |
| 29 | **Database control** | ✅ **Literal DDL** | 🟡 **CMS owns physical schema** | **Main compatibility caveat — §7** |
| 30 | Frontend integration | ✅ Direct | ✅ Direct (ISR unchanged) | D-012 holds either way |
| 31 | Testing | ✅ Plain | 🟡 Framework-aware | Contract tests matter most, possible in both |
| 32 | Deployment | ✅ Any Node host | 🟡 Next.js-hosted app | Payload 3 runs inside Next.js — see §11 |
| 33 | Maintenance | 🟡 All yours | 🟡 Upgrades not yours | Trade, not a win |
| 34 | **Development speed** | ❌ Slowest | ✅ **Substantially faster** | **Dominant practical factor** |
| 35 | Long-term flexibility | ✅ Unlimited | ✅ High (custom endpoints, code config) | Payload is unusually strong here |
| 36 | Cost | 🟡 Engineering time | ✅ Less time; self-hosted = no licence | Payload is MIT |
| 37 | Vendor lock-in | ✅ None | 🟡 **Low** — MIT, self-hosted, own Postgres | §14 |
| 38 | Customization | ✅ Total | ✅ High | Payload's key differentiator |
| 39 | Scalability | ✅ Fine | ✅ Fine | **Irrelevant at 5 projects** |
| 40 | Complexity vs project | ❌ **Over-engineered** | ✅ **Proportionate** | Decisive |

**Tally:** Custom wins outright on 18, 20, 22, 29 — all shape/schema control. CMS wins outright on 1, 3, 4, 5, 10, 19, 27, 34 — all delivery cost. **Every custom win is addressable with custom endpoints; no CMS win is addressable in a custom build without paying full price.** That asymmetry is the decision.

---

## 6. API Compatibility

The most important section, because this is where a CMS most plausibly fails.

### What `API-CONTRACT.md` demands

```jsonc
{ "data": {
  "slug": "sri-city-aler-town",
  "description": ["Sri City Aler Town is a premium…", "The layout is DTCP…"],
  "highlights": [ { "icon": "city", "title": "Premium residential villa plots" } ]
  // developer, proximity, gallery, layoutImage, locationMap,
  // brochureImages, cta, seo — ABSENT, not null, not []
} }
```

### What a CMS returns by default

Generic CMS output carries a wrapper, injected system fields (`id`, `createdAt`, `updatedAt`, `publishedAt`), `[]` for empty collections, and — critically — **array fields as arrays of objects**, so `description` becomes `[{id: "…", text: "…"}]` rather than `["…"]`.

**Three of these violate D-008 directly**, and the `description` shape violates `types/content.ts:72`.

### Why this does not sink the decision

Payload supports **custom endpoints** written as ordinary TypeScript handlers. The eight public endpoints are hand-written against Payload's local API:

```
GET /api/v1/projects/{slug}
  → payload.find({ collection: 'projects', where: { slug, _status: 'published' } })
  → toPublicProject(doc)     // strips system fields, flattens arrays, omits empties
  → { data: … }
```

`toPublicProject` is a **single, testable, ~80-line serialiser** — the same function a custom backend would need. It is written once, contract-tested against the `Project` type, and reused by all public endpoints.

**The admin API needs no such work** — Payload's generated REST/local API serves the admin UI directly, and the admin UI is the only consumer. `API-CONTRACT.md`'s ~52 admin endpoints become a *description of available operations* rather than 52 things to hand-write.

### Verdict

✅ **`API-CONTRACT.md` remains valid unchanged for the public API**, implemented via custom endpoints.
🟡 **The admin API section becomes descriptive rather than prescriptive** — the operations exist; their exact paths are Payload's. `API-CONTRACT.md` needs a note to that effect (see §Consistency below).

> This is the crux. A CMS **without** first-class custom endpoints would have failed here, and the requirement would have forced Option A.

---

## 7. Database Compatibility

Payload generates and owns the physical schema from its TypeScript config, using Drizzle under the hood on PostgreSQL.

| `DATABASE-SCHEMA.md` element | Fit |
|---|---|
| Core entities (15 tables) | ✅ Express as collections/globals; Payload creates equivalent tables |
| `projects` scalar fields | ✅ Direct |
| `description` as `text[]` | 🟡 Becomes a child table (array field). **Flattened by the serialiser** — public shape preserved |
| `project_features` with `kind` | ✅ Four array fields, or one with a `kind` select |
| `project_media` roles | ✅ Upload relations; single vs multi enforced by field type |
| `leads` | ✅ Collection with admin-only access |
| `site_settings` singleton | ✅ Native global — cleaner than a `CHECK (id = 1)` |
| `audit_log` | 🟡 Hooks write entries; Payload's version history covers part of it |
| `published_at` | ✅ Native draft/publish |
| `deleted_at` soft delete | 🟡 Field + access filter, or Payload trash |
| `sort_order` | ✅ Native ordering |
| **Partial unique indexes** | 🟡 Custom migration or hook |
| **CHECK constraints (icon, rating, enums)** | 🟡 Field-level validation; DB-level needs custom migration |
| Timestamps | ✅ Automatic |

### Consequence — stated plainly

**`DATABASE-SCHEMA.md` changes status from literal DDL to a logical specification of intent.** Field meanings, relationships, cardinality, ordering and deletion semantics all remain binding. Physical table and column names become Payload's.

**This weakens D-007's "enforced at API *and* database" and parts of `SECURITY.md`'s defence-in-depth.** Mitigation: enforce in field validation and hooks (always), and add DB CHECK constraints via custom migration **for the two that matter most** — the 41-value `icon` enum (invalid value = silently broken page) and testimonial consent (D-011). Those two are cheap and high-value; the rest can live at the application layer.

This is the **real cost** of the decision and should not be glossed over.

---

## 8. Admin CMS Compatibility

Against `ADMIN-CMS-SPEC.md`, screen by screen.

| Screen | Payload | Notes |
|---|---|---|
| Login | ✅ Free | Generic failure message, lockout configurable |
| Dashboard | 🟡 Default + custom components | Lead counts / placeholder counter need small custom views |
| Projects list | ✅ Free | Columns, filters, drag ordering native |
| **Project editor** | ✅ **Generated** | **The single biggest win.** ~20 fields, 4 repeatable arrays, 5 media pickers, all from config |
| Icon picker | 🟡 `select` free; visual picker is a small custom field component | FR-PROJ-15 satisfied by the select alone |
| Leads list/detail | ✅ Free | Read-mostly collection; status control hidden until OQ-3 |
| Media library | ✅ **Free** | Second biggest win |
| Site settings | ✅ Free | Native global |
| Tier-2 content | ✅ **Nearly free** | Testimonials, FAQs, statistics, ticker = config, not screens |
| Account | ✅ Free | |
| Consent gate (D-011) | 🟡 `beforeValidate` hook | Must be a hook, not just UI |
| Placeholder awareness (OQ-15) | 🟡 Custom field component | Recommended, still optional |
| Unsaved-changes guard | ✅ Free | |
| Field-level error mapping | ✅ Free | |

**~80% of the admin specification is satisfied by configuration.** The remainder is small custom components, not screens.

> `ADMIN-CMS-SPEC.md` stays valid as the **behavioural specification** — what each screen must do, which validation applies, which states exist. Its layout descriptions become guidance rather than build instructions.

---

## 9. Media Management

Against `MEDIA-MANAGEMENT.md`:

| Requirement | Payload |
|---|---|
| Upload (FR-MEDIA-01) | ✅ Free |
| Type/MIME validation (FR-MEDIA-02) | ✅ `mimeTypes` config |
| **Magic-byte sniffing** | 🟡 `beforeChange` hook — **custom in both options** |
| **SVG rejection** | ✅ Exclude from allow-list |
| Dimensions server-side (FR-MEDIA-03) | ✅ Automatic — satisfies the CLS requirement |
| Alt text required (FR-MEDIA-04) | ✅ Required field |
| 5 roles (FR-MEDIA-05, 06) | ✅ Upload fields, ordered arrays |
| Replace (FR-MEDIA-07) | ✅ Free |
| **Usage-guarded delete (FR-MEDIA-08)** | 🟡 **`beforeDelete` hook** — not free, but ~20 lines |
| Stable URLs (FR-MEDIA-09) | ✅ S3 adapter |
| Documents/PDF (FR-MEDIA-10) | ✅ Separate collection |
| Orphan detection (FR-MEDIA-11) | 🟡 Custom query |
| **No public upload (FR-MEDIA-12)** | ✅ Access control |
| EXIF strip, UUID keys | 🟡 Hook + adapter config |

**Net: the largest UI cost disappears; the security-critical validation remains custom in either option.** That is acceptable — those checks are ~50 lines, and writing them yourself is preferable to trusting a default.

S3-compatible storage (P-02) is unaffected — Payload has an S3 adapter. **OQ-7 remains open and unaffected by this decision.**

---

## 10. Security

`SECURITY.md` reviewed against Payload:

| Control | Impact |
|---|---|
| Password hashing | ✅ Maintained by Payload — **better than a hand-rolled first attempt** |
| Sessions (D-004) | 🟡 Payload uses httpOnly JWT cookies by default. **Close to D-004's intent but not identical** — see §15 risk R-3 |
| Admin route protection | ✅ Access control on every collection, deny by default |
| **Leads never public (FR-LEAD-15)** | ✅ Access control + no public read endpoint. **Must be verified by explicit test** |
| Unpublished → 404 not 403 | ✅ Custom endpoints control this |
| CORS | ✅ Configurable |
| CSRF | ✅ Built-in protections |
| Rate limiting | ✅ Middleware on custom endpoints |
| Input validation | ✅ Field validation + hooks |
| SQL injection | ✅ Drizzle parameterises |
| XSS | ✅ **No rich-text field is being added** (D-010) — keeps the surface small |
| Upload security | 🟡 Custom hooks (§9) |
| Secrets | ✅ Env |
| Audit log | 🟡 Hooks + Payload versions |
| Error disclosure | 🟡 Must verify Payload's default error verbosity in production |

**Net security posture: improved.** The highest-risk components to hand-write — password hashing, session handling, upload processing — are maintained upstream. The custom surface shrinks to access rules and a few hooks, which is a smaller thing to get wrong.

---

## 11. Deployment

**Payload 3 runs inside a Next.js application.** The backend is therefore a Next.js app — *separate from `svfrontend`*, deployed independently.

| Aspect | Impact |
|---|---|
| Runtime | Node 20 LTS — same constraint the frontend already documents |
| Hosting | Any Node host or container; Vercel-compatible |
| Database | Managed PostgreSQL |
| Storage | S3-compatible (OQ-7) |
| Admin UI | Served by the same app — **no separate SPA to deploy** |
| Migrations | Payload/Drizzle migrations, versioned |

**This partially answers OQ-5** (where the admin UI lives): it is served by the backend app, at its own domain. It does **not** resolve who builds the remaining custom components, which stays open.

Two Next.js apps in one workspace is a mild conceptual oddity worth naming — but they are genuinely separate deployments with separate dependencies, and the alternative (a hand-built SPA) is strictly more infrastructure.

---

## 12. Maintenance

| | Custom | Payload |
|---|---|---|
| Framework upgrades | Library churn only | **Payload majors — real work** |
| Security patches | All yours | Mostly upstream |
| Admin UI maintenance | **All yours** | Upstream |
| Adding a content type | Table + endpoints + screens | **Config only** |
| Onboarding | Read your code | Learn Payload + read config |
| Bus factor | Bespoke knowledge | Documented public framework |

**Honest assessment: this is a trade, not a win.** Payload removes far more maintenance than it adds, but it adds a category you do not control — major upgrades. Given Tier-2 content is explicitly planned (testimonials, FAQs, statistics, ticker, specs, proximity), the "config only" row is worth a great deal here.

---

## 13. Cost and Operational Complexity

**Licence:** Payload is MIT, self-hosted. **No licence cost.** (Payload Cloud exists and is not required.)

**Infrastructure:** identical either way — Node host + PostgreSQL + S3 + email.

**Engineering time** — the dominant cost. Directional, not a quote:

| Component | Custom | Payload |
|---|---|---|
| Auth | Moderate | ~Free |
| Project CRUD API | Large | ~Free |
| **Admin UI (9 screens)** | **Very large** | **~Free** |
| **Media library** | **Large** | **~Free** |
| Public endpoints + serialiser | Moderate | **Moderate (same work)** |
| Lead pipeline | Moderate | Moderate |
| Custom hooks/validation | Included | Small |
| Tier-2 content | Large | **Small** |

**The two largest line items collapse to near zero, and the one irreducible item — the public serialiser — is identical in both.** That is the economic case in a sentence.

---

## 14. Long-Term Flexibility

The usual CMS objection is lost flexibility. Payload's design substantially blunts it:

- **Config is TypeScript in your repo** — reviewable, diffable, version-controlled. Not clicked into a UI.
- **Custom endpoints are first-class** — you are never limited to generated routes.
- **Access control is code** — testable functions, not a permissions matrix.
- **Hooks at every lifecycle point** — business rules live where you put them.
- **Your own PostgreSQL** — the data is queryable without Payload. **Exit is a migration, not a rescue.**
- **MIT licensed, self-hosted** — no vendor can revoke, reprice, or sunset it.

**Lock-in assessment: low.** Higher than custom (non-zero), materially lower than a hosted SaaS CMS. If Payload were abandoned, the data is in a schema you can read and the public API contract — the part the frontend depends on — is your own code.

**Genuine limits:** if the domain later grows real transactional business logic (pricing, booking, payments), Payload stops being the natural home. Given the documented scope explicitly excludes all three, that is a distant concern — and the escape hatch is a separate service alongside, not a rewrite.

---

## 15. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| **R-1** | **Response shape drifts from `Project`** | **High** | The serialiser is the single point of control. **Contract-test it against `types/content.ts` in CI** (Phase 6 exit criterion). This risk exists identically in Option A |
| **R-2** | Payload 3's **PostgreSQL adapter is younger** than its Mongo lineage | Medium | Prototype the full `Project` schema in Phase 1 **before** committing. Fall back to Directus or custom if it cannot express the model |
| **R-3** | Payload's **cookie/JWT session model differs from D-004** | Medium | D-004 is PROPOSED, not accepted. Payload's httpOnly cookie satisfies the *intent* (not XSS-readable). **Verify revocation-on-password-change** before accepting; amend D-004 to match reality |
| **R-4** | **DB-level constraints weaken** (§7) | Medium | Field validation + hooks always; custom migrations for the two highest-value CHECKs (icon enum, consent) |
| **R-5** | **Admin UI customisation hits a wall** | Medium | The heavily-custom items (icon picker, placeholder counter) are *recommended*, not required. Degrade to a plain select and drop the counter if needed |
| **R-6** | Major-version upgrade cost | Medium | Pin versions; budget upgrade time; config-as-code makes diffs reviewable |
| **R-7** | **Team unfamiliarity with Payload** | Medium | Real cost. Offset: the team already knows TypeScript and Next.js, which is most of Payload's surface |
| **R-8** | Two Next.js apps confuses contributors | Low | Document clearly in `AI-CONTEXT.md` |
| **R-9** | **Over-exposure via generated endpoints** | **High** | Payload generates REST/GraphQL routes. **Disable or lock down anything not required, and add an explicit test that no public route returns lead data** |

**R-2 and R-9 are the two to act on first.** R-2 is validated by a Phase 1 spike; R-9 by a Phase 10 test that must exist regardless.

---

## 16. Final Architecture Decision

> ## **Option B — Headless CMS: Payload CMS 3, self-hosted, on PostgreSQL.**

```
svfrontend (Next.js, static/ISR)
        │  build + revalidate
        ▼
Custom public endpoints  ──► toPublicProject() serialiser
        │                     (exact documented shape)
        ▼
Payload CMS 3  ──────────────► auto-generated admin UI + media library
        │
        ├──► PostgreSQL       (Payload-managed schema)
        ├──► S3-compatible storage
        └──► Email (queued lead notifications)
```

**Public API:** hand-written custom endpoints returning exactly `API-CONTRACT.md`'s shapes.
**Admin API + UI:** generated by Payload, configured in TypeScript.
**Business rules:** hooks and access-control functions.
**Frontend integration:** unchanged — ISR + on-demand revalidation (D-012).

### Why not Strapi or Directus

Both were evaluated seriously.

**Strapi** — largest community, strong admin UI, draft/publish built in. Rejected because: its API shape is the furthest from the contract (v4's `data.attributes` nesting; v5 improves but does not eliminate the mismatch); **collection ordering is not natively drag-and-drop**, and D-005 makes ordering a first-class requirement; customisation means learning Strapi's plugin conventions rather than writing plain TypeScript; and it generates no types aligned with the frontend contract.

**Directus** — genuinely strong, and the closest competitor. Database-first, so it would wrap `DATABASE-SCHEMA.md` **exactly as written** — which directly solves §7, the main weakness of this decision. Mature, excellent built-in sorting and RBAC, good media library. Rejected because: the schema lives in the database rather than in reviewable code; its API is its own (`/items/...`), so public endpoints need custom extensions regardless; extension DX is less pleasant than plain TypeScript handlers; and **it does not generate TypeScript types matching the frontend's `Project` type.**

**Payload won on one decisive criterion: contract-drift resistance.** With 25 fields, 17 optional, ordered arrays and omit semantics, the top long-term risk is the backend and frontend silently disagreeing. Payload's TypeScript config plus generated types make that a **compile-time** concern; the alternatives make it a runtime one.

> **If R-2 (Postgres adapter maturity) fails the Phase 1 spike, Directus is the designated fallback** — it accepts the documented schema literally, at the cost of type-level safety.

---

## 17. Exact Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Frontend is TS strict; the contract *is* a TS type |
| Runtime | **Node.js 20 LTS** | Matches the frontend's documented `>=20.9.0 <23` |
| CMS / framework | **Payload CMS 3** (MIT, self-hosted) | Config-as-code, custom endpoints, generated admin UI |
| Host app | **Next.js** (separate from `svfrontend`) | Payload 3's required host |
| Database | **PostgreSQL 15+** via Payload's Postgres adapter (Drizzle) | Documented choice; relational model fits |
| Migrations | **Payload/Drizzle migrations** | Versioned, reversible (NFR-09) |
| Storage | **S3-compatible** via Payload S3 adapter | P-02; provider still OQ-7 |
| Email | **Transactional provider** via hook | P-03; provider still OQ-7 |
| Validation | **Payload field validation + hooks**; **Zod** for custom endpoints | NFR-11 |
| Public serialiser | **Hand-written `toPublicProject()`** | D-008 — the contract's single control point |
| Testing | **Vitest** + Supertest; **contract tests against `types/content.ts`** | R-1 |

### Why not FastAPI / Python

Evaluated as instructed, and rejected on evidence — **not on quality.** FastAPI is excellent, and Pydantic's validation model would serve `VALIDATION-RULES.md` well.

It does not fit **this** project:

1. **The contract is a TypeScript type.** `Project` lives in `types/content.ts` with 17 optional fields. In TypeScript that contract can be *checked by the compiler*. In Python it becomes a hand-maintained Pydantic translation that must be kept in sync by discipline — and the failure mode is silent: a renamed field or a changed optionality ships green and breaks a page.
2. **It solves the wrong half.** FastAPI gives an excellent API and **no admin UI** — leaving the largest deliverable (§13) entirely unbuilt.
3. **It introduces a second language** into a project that has none, for a 15-table CMS. Two toolchains, two dependency ecosystems, two sets of conventions — with no offsetting benefit, since there is no Python-specific need here (no ML, no data science, no scientific computing).
4. **No performance argument.** 5 projects, tens of leads/month.

FastAPI would be the right call for a compute-heavy or Python-native service. This is a small CRUD-and-admin-UI problem in a TypeScript codebase.

---

## 18. Why This Decision Fits THIS Project

Evidence, not preference:

1. **5 projects.** `content/projects.ts` holds five records, and the business builds plot layouts slowly. Hand-building a bespoke CMS for five records is disproportionate (criterion 40).

2. **17 of 25 `Project` fields are optional**, and `ProjectDetail.tsx` drops a whole section per falsy field. This is why a *generic* CMS response would fail — and why the chosen CMS is one with custom endpoints. The serialiser is the same work either way.

3. **`ADMIN-CMS-SPEC.md` specifies nine screens**, including a project editor with four repeatable icon-bearing lists and five media pickers, plus a full media library. Payload generates essentially all of it. **This is the bulk of the saving.**

4. **Tier-2 content is already planned** — testimonials, FAQs, statistics, ticker, site-wide specs and proximity. In a custom build each costs a table, endpoints and screens. In Payload each is config. The documentation anticipates six such types.

5. **One admin role** (OQ-4). Payload's access control covers it without a permissions matrix.

6. **No transactional business logic anywhere.** No pricing, payments, booking, or calculations — `REQUIREMENTS.md` excludes all of them explicitly, and `statistics` are authored strings, not aggregates (D-009). The classic reason to reject a CMS does not apply.

7. **The team is already in TypeScript and Next.js.** Payload's config, hooks and access control are plain TypeScript; its host is Next.js. The learning curve runs along existing knowledge (R-7).

8. **Security surface shrinks.** Password hashing, session handling and upload processing — the things most dangerous to hand-roll — come maintained.

9. **`types/content.ts` is the real contract, and Payload generates types.** The dominant long-term risk on a 25-field structure is silent drift; this is the only evaluated option that makes it a compile-time failure.

10. **Lock-in is genuinely low.** MIT, self-hosted, your PostgreSQL, config in your repo, public API in your own code.

---

## 19. What We Will Build First

**Phase 1 — Backend foundation and schema spike.** Entry: this decision. The single most important thing to establish before committing further is **R-2**.

Deliverables:
1. Payload 3 project scaffolded on Next.js, TypeScript strict, Node 20.
2. PostgreSQL connected via the Postgres adapter; migrations working forward and back.
3. **The complete `Project` collection modelled** — all 25 fields, 4 repeatable feature arrays, stats, proximity, 5 media roles, the 41-value icon `select`, draft/publish, ordering, featured.
4. **The 5 existing projects seeded verbatim from `content/projects.ts`, placeholders included.**
5. `toPublicProject()` serialiser + `GET /api/v1/projects/{slug}`.
6. **A contract test asserting the response satisfies `Project` from `types/content.ts`.**
7. Config/env validation on boot; error envelope; structured logging.

**Exit criteria — these decide whether the architecture holds:**
- ✅ Every `Project` field expressible in Payload's Postgres adapter *(closes R-2)*
- ✅ `description` round-trips as `string[]` in the public response, not `[{id, text}]`
- ✅ Absent optional fields are **absent** from the JSON — not `null`, not `[]` *(D-008)*
- ✅ Contract test passes against the real `Project` type *(closes R-1 for projects)*
- ✅ Invalid icon rejected
- ✅ Admin UI renders the project editor usably with no custom components
- ✅ Seeded projects match `projects.ts` byte-faithfully

> **Stop-and-reassess:** if exit criteria 1–3 fail, this decision is void and **Directus becomes the fallback** (§16). Everything after Phase 1 assumes these pass.

**Explicitly NOT in Phase 1:** leads, media upload, Tier-2 content, frontend integration, production deployment. **No frontend file is touched.**
