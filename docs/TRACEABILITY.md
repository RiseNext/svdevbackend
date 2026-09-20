# TRACEABILITY.md

> ### ⚠️ D-015 reconciliation banner — 20 Sep 2026
>
> D-015 declared this document “unaffected”. **That was wrong** — it names physical artefacts Payload owns or never creates.
>
> | Cell type here | Reality |
> |---|---|
> | Physical tables (`media_assets`, `notification_jobs`, `failed_login_count`, `admin_sessions`) | **Not created.** `payload-jobs` replaces `notification_jobs`; lockout state is Payload-internal; sessions are Payload's (D-026, D-027, D-029, D-032) |
> | Literal `/api/v1/admin/**` paths | **Descriptive only.** Admin paths are Payload's; the admin surface is its native UI (D-015) |
> | DB `CHECK` / `FK` constraints | Mostly **app-layer** now — field validation and hooks, with custom-migration CHECKs retained only for the icon enum and testimonial consent |
> | `sort_order` integer | `orderable: true` fractional-index string (D-021) |
>
> **The traceability *chains* remain valid and valuable** — frontend evidence → requirement → capability. Only the physical right-hand columns are superseded.
>
> **Authoritative for execution:** [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) · Correction detail: [`DOCUMENTATION-CORRECTIONS.md`](./DOCUMENTATION-CORRECTIONS.md)

---

Every backend capability traced from **frontend evidence → requirement → API → database → UI → test**.

**Purpose: prevent unjustified functionality.** If a proposed feature cannot be traced to a row here, it is a **new requirement** — stop, flag it, and get it approved before writing code.

Legend — **Evidence:** `SRC` frontend source · `BRIEF` business brief · `INF` inferred · `NONE` no evidence.

---

## 1. Project management

| Frontend source | Business need | Req ID | API | DB | Admin UI | Public UI | Test | Ev |
|---|---|---|---|---|---|---|---|---|
| `content/projects.ts` (5 records) | Manage projects without a developer | FR-PROJ-01..04 | `POST/GET/PATCH /admin/projects` | `projects` | Projects list + editor | `/projects` | CRUD integration | BRIEF+SRC |
| `types/content.ts:57-105` | Field shape must match the frontend | FR-PROJ-01 | project payload | `projects` cols | Editor sections A–E | detail page | **Contract test vs `Project`** | SRC |
| *(no equivalent today)* | Draft before going live | FR-PROJ-05 | `POST /admin/projects/{id}/publish` | `published_at` | Publish button | invisible when draft | Unpublished → **404** | BRIEF |
| `projects.ts` array order | Control display sequence | FR-PROJ-07 | `PATCH /admin/projects/order` | `sort_order` | Drag reorder | catalogue order | Order persists | BRIEF |
| `projects.ts:343-345` | Choose homepage features | FR-PROJ-08 | `featured` field | `projects.featured` | Toggle | homepage strip | Filter returns featured | SRC |
| `types/content.ts:40-44` | Fixed categories | FR-PROJ-10 | enum validation | CHECK | Select | card badge | Invalid → 422 | SRC |
| `types/content.ts:36` | Optional sales status | FR-PROJ-11 | nullable enum | `status` NULL | Select + "Not stated" | status chip | NULL allowed | SRC |
| `types/content.ts:73-84` | Manage stats/features/proximity | FR-PROJ-12..14 | nested arrays | 3 child tables | Repeatable rows | detail sections | Order preserved | SRC |
| **`ui/Icon.tsx:7-48`** | Icons must render | **FR-PROJ-15** | enum validation | CHECK | **Icon picker** | every icon | **Invalid icon → 422** | SRC |
| `ProjectDetail.tsx` guards | Thin brochure ⇒ shorter page | **FR-PROJ-17** | **omit, don't empty** | NULL / no rows | "Leave empty" helper | section disappears | **Omitted ≠ `[]`** | SRC |
| `app/projects/[slug]` | Slug drives live URL | FR-PROJ-09, 18 | unique + lock | UNIQUE | Locked after publish | URL | Duplicate → 409 | SRC |

## 2. Media

| Frontend source | Business need | Req ID | API | DB | Admin UI | Public UI | Test | Ev |
|---|---|---|---|---|---|---|---|---|
| `public/images/**` (8 placeholders) | Upload real images | FR-MEDIA-01 | `POST /admin/media` | `media_assets` | Upload | all imagery | Upload succeeds | BRIEF+SRC |
| `types/content.ts:29-34` (`ImageRef`) | w/h/alt mandatory | FR-MEDIA-03, 04 | response fields | `width/height/alt_text` | Alt required | `next/image` | **Dimensions extracted server-side** | SRC |
| `types/content.ts:90-98` | 5 media roles | FR-MEDIA-05, 06 | `POST /admin/projects/{id}/media` | `project_media.role` | Per-role pickers | cover/gallery/plan/map | Single-valued → 409 | SRC |
| `pages.ts:254` `[MASTER_PLAN_PDF_URL]` | Host the PDF | FR-MEDIA-10 | document upload | `asset_type='document'` | Doc upload | Lightbox download | PDF accepted | SRC |
| `next.config.mjs:19-21` `dangerouslyAllowSVG` | Don't accept script-bearing vectors | FR-MEDIA-02 | reject SVG | CHECK mime | Rejected | — | **SVG → 415** | SRC+SEC |
| BRIEF "orphaned media" | Don't break live pages | FR-MEDIA-08, 11 | `DELETE` guarded | FK RESTRICT | "Used in" list | — | In-use delete → 409 | BRIEF |
| *(no upload UI exists)* | — | **FR-MEDIA-12** | **no public upload** | — | — | — | **No public route exists** | SRC |

## 3. Leads

| Frontend source | Business need | Req ID | API | DB | Admin UI | Public UI | Test | Ev |
|---|---|---|---|---|---|---|---|---|
| **`ContactForm.tsx:48-50`** | **Enquiries are lost today** | **FR-LEAD-01** | `POST /api/v1/leads` | `leads` | — | contact form | Creates lead | **SRC** |
| `ContactForm.tsx:32-34` | Validation | FR-LEAD-02 | Zod | NOT NULL | — | inline errors | `422` field-mapped | SRC |
| `ContactForm.tsx:102-109` | Project dropdown | FR-LEAD-03 | slug check | `project_slug` | filter | select | Unknown slug → 422 | SRC |
| `ContactForm.tsx:87` `?phone=` | Pill hand-off prefill | FR-LEAD-01 | `source` | `source` | Source column | prefilled field | Source recorded | SRC |
| Business purpose | Sales must know | FR-LEAD-05, 06 | queued notify | `notification_jobs` | — | — | **Provider outage ≠ request failure** | INF |
| Public unauth write | Spam risk | FR-LEAD-07, 08 | rate limit + honeypot | — | — | — | Limits trigger | SEC |
| BRIEF "manage submissions" | Work the leads | FR-LEAD-10, 11 | `GET /admin/leads` | indexes | List + detail | — | Pagination/filter | BRIEF |
| *(no UI evidence)* | Pipeline? | **FR-LEAD-12** | `PATCH status` | `status` NULL | **Hidden until OQ-3** | — | — | **INF — OQ-3** |
| PII | DPDP compliance | FR-LEAD-15, 16 | never public | `deleted_at`, purge | — | — | **No public route returns leads** | SEC |
| `EnquiryPill.tsx:37-43` | WhatsApp leads invisible | FR-LEAD-17 | log hand-off | `source='whatsapp'` | Source filter | — | Logged | INF |

## 4. Site settings and content

| Frontend source | Business need | Req ID | API | DB | Admin UI | Public UI | Ev |
|---|---|---|---|---|---|---|---|
| `site.ts:13-27` (all bracketed) | Change contact details | FR-CONT-01 | `PATCH /admin/site-settings` | `site_settings` | Settings tabs | nav, footer, contact | SRC+BRIEF |
| `site.ts:22-23` + `EnquiryPill:39` | WhatsApp digits-only | FR-CONT-02 | format validation | `whatsapp` | Helper + preview | hero pill | SRC |
| `site.ts:53-57` | Social links | FR-CONT-01 | settings | `social` jsonb | Social tab | footer | SRC |
| `site.ts:93-96` | **Privacy policy required** | FR-CONT-01 | settings | `legal_links` | Legal tab | footer + form note | SRC+LEGAL |
| `pages.ts:310-332` | Real testimonials | FR-CONT-03, 04 | testimonials CRUD | `testimonials` | Consent gate | homepage | SRC |
| `pages.ts:344-365` | Edit FAQs | FR-CONT-05 | faqs CRUD | `faqs` | Ordered list | `/` + `/contact` | SRC |
| `pages.ts:66-71` (`[00]+`) | Update stats | FR-CONT-06 | statistics CRUD | `statistics` | Label/value | `/` + `/about` | SRC |
| **`site.ts:41-49` vs `projects.ts`** | **Duplication will drift** | **FR-CONT-11** | derived | *(none)* | — | nav + footer | **SRC** |
| ~17 JSX headings | Stay in code | **FR-CONT-12** | **none** | **none** | **none** | headings | SRC |
| `title` + `titleAccent` | `<em>` is structural | **FR-CONT-13** | two fields if ever editable | — | Two inputs | headline line 2 | SRC |

## 5. Auth and audit

| Source | Need | Req ID | API | DB | Test | Ev |
|---|---|---|---|---|---|---|
| BRIEF "only authorized administrators" | Protect admin | FR-AUTH-01..03 | `/admin/auth/*` | `admin_users`, `admin_sessions` | **Every admin route unauth → 401** | BRIEF |
| Security | Password safety | FR-AUTH-04 | — | `password_hash` | argon2id, never plaintext | SEC |
| BRIEF "Do NOT introduce public registration" | No signup | **FR-AUTH-09** | **no endpoint** | — | **No registration route exists** | BRIEF |
| Brute force | Protect login | FR-AUTH-08 | rate limit | `failed_login_count` | Lockout triggers | SEC |
| Admin edits legal claims | Accountability | FR-AUDIT-01..03 | `GET /admin/audit-log` | `audit_log` | Mutation writes a row | INF+SEC |

## 6. Public API ← frontend consumer

**Every public endpoint must name its consumer.** No consumer ⇒ no endpoint.

| Endpoint | Consumed by | Req ID |
|---|---|---|
| `GET /projects` | `app/projects/page.tsx`, homepage strip, `generateStaticParams`, `sitemap.ts`, nav/footer links | FR-PUB-01 |
| `GET /projects/{slug}` | `app/projects/[slug]/page.tsx`, `projectMetadata()` | FR-PUB-02 |
| `GET /site-settings` | `layout.tsx`, `PillNav`, `Footer`, `/contact`, `EnquiryPill`, `robots.ts`, `sitemap.ts` | FR-PUB-04 |
| `GET /testimonials` | `Testimonials.tsx` (homepage) | FR-PUB-05 |
| `GET /faqs` | `app/page.tsx` **and** `app/contact/page.tsx` | FR-PUB-06 |
| `GET /statistics` | `PinnedProof` (homepage) **and** `app/about/page.tsx` | FR-PUB-07 |
| `POST /leads` | `ContactForm.tsx` | FR-LEAD-01 |
| `GET /healthz` | monitoring | FR-PUB-11 |

**No public endpoint for:** pagination, search, sorting, media listing, admin users, audit log, leads (read). **No frontend consumer exists** (FR-PUB-12).

---

## 7. Reverse trace — proposed features with NO evidence

Anything below is **out of scope**. Reaching for one means raising a new requirement first.

| Proposed | Evidence | Verdict |
|---|---|---|
| Public user accounts / registration / login | **NONE** | ❌ Brief explicitly forbids |
| Payments, checkout, pricing | **NONE** — no pricing UI anywhere | ❌ Do not build |
| Online booking / scheduling | **NONE** — visits arranged by phone | ❌ Do not build |
| `Service` entity | **NONE** — brief says "services"; frontend has none | ❌ OQ-13 |
| Blog / `Article` | **README + PRD only; route 404s** | ❌ OQ-14 |
| Plot inventory, per-plot pricing, floor plans | **NONE** — repo records none supplied | ❌ Do not build |
| Possession dates, structured RERA/DTCP fields | **NONE** — free-text `approvals` only | ❌ Do not build |
| Analytics | **NONE** | ❌ Phase 2 |
| Multilingual | PRD phase 2 only | ❌ OQ-25 |
| Public search / pagination / sort | **NONE** — 5 records, client-side | ❌ Do not build |
| Rich-text / WYSIWYG | **NONE** — would break `title`/`titleAccent` | ❌ Do not build |
| Roles/permissions tables | **NONE** — single admin | ❌ OQ-4 |
| Realtime / WebSockets | **NONE** | ❌ Do not build |

---

## 8. Coverage check

| Check | Result |
|---|---|
| Every Tier 1 CMS item has a requirement | ✅ |
| Every requirement has frontend or brief evidence | ✅ (INFERRED items marked and tied to an OQ) |
| Every public endpoint has a named consumer | ✅ §6 |
| Every admin endpoint has an admin use case | ✅ `ADMIN-CMS-SPEC.md` |
| Every DB table maps to a requirement | ✅ `DATABASE-SCHEMA.md` |
| Every media need documented | ✅ `MEDIA-MANAGEMENT.md` |
| Admin-only data never public | ✅ FR-PUB-08, FR-LEAD-15 |
| No speculative feature became mandatory | ✅ §7 |
