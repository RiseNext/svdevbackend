# REQUIREMENTS.md

> ### ⚠️ D-015 reconciliation banner — 20 Sep 2026
>
> **Every FR/NFR id below remains binding.** Three name mechanisms that changed:
>
> | Requirement | Corrected |
> |---|---|
> | **argon2id** password hashing (NFR) | ❌ **Not achievable.** Payload never names its KDF and exposes no option to change it; reaching argon2id means discarding Payload's auth stack entirely. **Accepted documented deviation** — compensating controls in plan §10 |
> | Built-in **rate limiting** | ❌ **Payload 3 ships none.** All HTTP throttling is edge/proxy configuration (D-030) |
> | **FR-MEDIA-10** (master-plan PDF) | Satisfied by the new **`documents`** upload collection (D-032) |
>
> Requirement **status** labels (CONFIRMED / INFERRED / FUTURE / OPEN) are unchanged — in particular the lead status pipeline is still **INFERRED** (OQ-3), and nothing in this freeze promoted it.
>
> **Authoritative for execution:** [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) · Correction detail: [`DOCUMENTATION-CORRECTIONS.md`](./DOCUMENTATION-CORRECTIONS.md)

---

Numbered, traceable requirements. Every backend capability must map to an ID here; every ID maps to frontend evidence or an explicit business statement in `TRACEABILITY.md`.

**Status:** `CONFIRMED` · `INFERRED` · `FUTURE` · `OPEN`
**Priority:** `P0` must-have · `P1` should-have · `P2` nice-to-have · `P3` deferred

---

## AUTH — Admin authentication

| ID | Requirement | Status | Pri | Evidence |
|---|---|---|---|---|
| FR-AUTH-01 | Admin logs in with email + password, receives an authenticated session | CONFIRMED | P0 | Business brief: "only authorized administrators" |
| FR-AUTH-02 | Admin logs out; session is invalidated server-side | CONFIRMED | P0 | Corollary of 01 |
| FR-AUTH-03 | All `/api/v1/admin/**` routes reject unauthenticated requests with 401 | CONFIRMED | P0 | Business brief |
| FR-AUTH-04 | **AMENDED 20 Sep 2026 (D-118), and VERIFIED IN THE BUILT SYSTEM.** Passwords are never stored in reversible form. The CMS stores a per-user salt and a **PBKDF2-SHA256** derived key (prefixed `pbkdf2-sha256-v1:`), and strips `salt` and `hash` from every read operation. Never MD5, SHA-1 or plaintext. The original wording mandated argon2id; that is unreachable without discarding Payload's entire auth stack, and a client-facing document must not state a falsehood. Compensating controls: a 12-character minimum with a breach-list check, `maxLoginAttempts: 5` + `lockTime: 15min`, admin-only account creation, edge rate limiting on the login path, two admin accounts per environment, and full auth-event auditing. Per NIST SP 800-63B there is deliberately no forced rotation and no composition rule. | CONFIRMED (amended) | P0 | `SECURITY.md` |
| FR-AUTH-05 | Session expires; refresh without re-entering credentials | INFERRED | P0 | Standard practice |
| FR-AUTH-06 | Admin changes their own password (requires current password) | CONFIRMED | P1 | Business brief: "account management if justified" |
| FR-AUTH-07 | `GET /admin/auth/me` returns the current admin identity | INFERRED | P1 | Admin UI needs it |
| FR-AUTH-08 | Login is rate-limited and lockout-protected after repeated failures | CONFIRMED | P0 | `SECURITY.md` |
| FR-AUTH-09 | Admin accounts are seeded/invited — **no self-registration endpoint** | CONFIRMED | P0 | Brief: "Do NOT introduce a public user registration system" |
| FR-AUTH-10 | Password reset via email | OPEN | P2 | Needs email + a decision — OQ-8 |
| FR-AUTH-11 | Multiple admin roles with distinct permissions | OPEN | P3 | OQ-4. **Default: single role** |

## PROJ — Project management

| ID | Requirement | Status | Pri | Evidence |
|---|---|---|---|---|
| FR-PROJ-01 | Admin creates a project with all fields from `types/content.ts` | CONFIRMED | P0 | `src/types/content.ts:57-105` |
| FR-PROJ-02 | Admin edits any field of an existing project | CONFIRMED | P0 | Brief |
| FR-PROJ-03 | Admin lists all projects including unpublished | CONFIRMED | P0 | Brief |
| FR-PROJ-04 | Admin views one project in full | CONFIRMED | P0 | Brief |
| FR-PROJ-05 | Admin publishes / unpublishes a project | CONFIRMED | P0 | Brief: "publish/unpublish". **New — no equivalent today** |
| FR-PROJ-06 | Admin archives (soft-deletes) a project; it leaves the public site but is recoverable | INFERRED | P1 | Brief: "delete/archive if justified". Hard delete would orphan live URLs |
| FR-PROJ-07 | Admin controls display order | CONFIRMED | P0 | Brief: "control project ordering". Today implicit in array order |
| FR-PROJ-08 | Admin marks a project `featured` for the homepage strip | CONFIRMED | P0 | `projects.ts:343-345` — falls back to first 3 |
| FR-PROJ-09 | `slug` is unique; validated kebab-case | CONFIRMED | P0 | Drives `/projects/[slug]` |
| FR-PROJ-10 | `category` restricted to the 4-value enum | CONFIRMED | P0 | `types/content.ts:40-44` |
| FR-PROJ-11 | `status` optional, restricted to the 4-value enum | CONFIRMED | P1 | `types/content.ts:36`. **Set on no project today** |
| FR-PROJ-12 | Admin manages ordered `stats[]` | CONFIRMED | P1 | `types/content.ts:73` |
| FR-PROJ-13 | Admin manages 4 ordered feature lists (highlights, amenities, approvals, locationHighlights) | CONFIRMED | P0 | `types/content.ts:74-80` |
| FR-PROJ-14 | Admin manages ordered `proximity[]` (`measure` + `place`) | CONFIRMED | P1 | `types/content.ts:84` |
| FR-PROJ-15 | Every `icon` validated against the 41-name `IconName` union | CONFIRMED | P0 | `ui/Icon.tsx:7-48`. Invalid name breaks the UI |
| FR-PROJ-16 | Admin sets per-project CTA and SEO overrides | CONFIRMED | P2 | `types/content.ts:99-102` |
| FR-PROJ-17 | Omitted optional fields cause the frontend section to disappear — API omits rather than returns empty | CONFIRMED | P0 | `ProjectDetail.tsx` guards + `projects.ts:46-55` |
| FR-PROJ-18 | Changing a published slug is blocked or warned (breaks live URLs + sitemap) | INFERRED | P1 | OQ-9 |

## MEDIA — Media management

| ID | Requirement | Status | Pri | Evidence |
|---|---|---|---|---|
| FR-MEDIA-01 | Admin uploads image files | CONFIRMED | P0 | Brief: "Media/images… uploaded and managed" |
| FR-MEDIA-02 | Uploads validated for MIME type, extension, magic bytes and size | CONFIRMED | P0 | `SECURITY.md` |
| FR-MEDIA-03 | Stored assets record `width`, `height`, `alt`, `mimeType`, `sizeBytes` | CONFIRMED | P0 | `ImageRef` mandates w/h/alt; CLS budget |
| FR-MEDIA-04 | `alt` text required before an asset may be attached to public content | CONFIRMED | P0 | `types/content.ts:29-34`; a11y |
| FR-MEDIA-05 | Admin attaches media to a project by role: cover, gallery, layout, location_map, brochure | CONFIRMED | P0 | `types/content.ts:90-98` |
| FR-MEDIA-06 | Gallery and brochure collections are ordered | CONFIRMED | P1 | Rendered in order |
| FR-MEDIA-07 | Admin replaces an asset, keeping attachments intact | INFERRED | P1 | Brief: "replacement" |
| FR-MEDIA-08 | Admin deletes an asset; deletion blocked or warned while in use | CONFIRMED | P0 | Brief: "deletion… orphaned media" |
| FR-MEDIA-09 | Assets served over stable public URLs suitable for `next/image` | CONFIRMED | P0 | Frontend uses `next/image` |
| FR-MEDIA-10 | Admin uploads documents (master-plan PDF, brochures) | CONFIRMED | P1 | `pages.ts:254`; `Lightbox` download |
| FR-MEDIA-11 | Orphaned assets are detectable and reportable | INFERRED | P2 | Brief: "orphaned media" |
| FR-MEDIA-12 | **No public upload endpoint** | CONFIRMED | P0 | No frontend upload UI exists |
| FR-MEDIA-13 | Admin replaces the site logo | INFERRED | P2 | Currently a duplicated opaque JPEG |

## CONTENT — CMS content (Tier 2)

| ID | Requirement | Status | Pri | Evidence |
|---|---|---|---|---|
| FR-CONT-01 | Admin manages site settings (brand, contact, social, legal links) | CONFIRMED | P0 | `site.ts` — all bracketed today |
| FR-CONT-02 | WhatsApp number stored digits-only, country code first | CONFIRMED | P0 | `site.ts:22-23`; `EnquiryPill.tsx:39` |
| FR-CONT-03 | Admin manages testimonials | CONFIRMED | P1 | `pages.ts:310-332` |
| FR-CONT-04 | Testimonials carry a `consented` flag; unconsented cannot be published | INFERRED | P1 | Repo: "publishing invented reviews… is a fabricated record" |
| FR-CONT-05 | Admin manages ordered FAQs | CONFIRMED | P1 | `pages.ts:344-365`; used on `/` and `/contact` |
| FR-CONT-06 | Admin manages the 4 homepage statistics | CONFIRMED | P1 | `pages.ts:66-71`. **Static strings, not computed** |
| FR-CONT-07 | Admin manages hero ticker claims | INFERRED | P2 | `pages.ts:59-65` |
| FR-CONT-08 | Admin manages site-wide amenity specifications | INFERRED | P2 | `pages.ts:199-235` |
| FR-CONT-09 | Admin manages site-wide proximity list | INFERRED | P2 | `pages.ts:283-295` — all placeholders |
| FR-CONT-10 | Admin edits the shared CTA banner | INFERRED | P2 | `pages.ts:370-375` |
| FR-CONT-11 | Nav/footer project links derived from published projects, not stored | CONFIRMED | P1 | `site.ts:41-49` duplicates `projects.ts` — **will drift** |
| FR-CONT-12 | Section headings remain frontend code | CONFIRMED | P0 | ~17 hardcoded in JSX — `CONTENT-MANAGEMENT-MATRIX.md` §4 |
| FR-CONT-13 | Editable headings preserve the `title` + `titleAccent` split | CONFIRMED | P0 | The `<em>` is structural |

## LEAD — Lead capture and management

| ID | Requirement | Status | Pri | Evidence |
|---|---|---|---|---|
| FR-LEAD-01 | Public submits a lead: `name`, `phone`, optional `projectSlug`, optional `message` | CONFIRMED | P0 | `ContactForm.tsx:27-30, 102-122` |
| FR-LEAD-02 | Server validates independently of the client | CONFIRMED | P0 | Form uses `noValidate` |
| FR-LEAD-03 | `projectSlug` validated against known slugs; never trusted | CONFIRMED | P0 | `ContactForm.tsx:104` |
| FR-LEAD-04 | Lead persisted with server-assigned `source` and timestamps | CONFIRMED | P0 | Attribution |
| FR-LEAD-05 | Sales notified on new lead | CONFIRMED | P0 | Business purpose. Channel = OQ-2 |
| FR-LEAD-06 | Notification failure must not fail the request | CONFIRMED | P0 | Persist first, queue the send |
| FR-LEAD-07 | Endpoint rate-limited per IP and per phone | CONFIRMED | P0 | Public unauthenticated write |
| FR-LEAD-08 | Spam protection (honeypot and/or CAPTCHA) | CONFIRMED | P0 | Same |
| FR-LEAD-09 | Idempotency support so a double-submit creates one lead | INFERRED | P1 | Mid-range Android on patchy networks |
| FR-LEAD-10 | Admin lists leads with pagination, filter, sort | CONFIRMED | P0 | Brief: "manage incoming contact/lead submissions" |
| FR-LEAD-11 | Admin views one lead | CONFIRMED | P0 | Brief |
| FR-LEAD-12 | Admin updates lead status | INFERRED | P1 | **Pipeline not confirmed — OQ-3** |
| FR-LEAD-13 | Admin marks a lead read/unread | INFERRED | P2 | Brief mentions it; no evidence it is wanted |
| FR-LEAD-14 | Admin soft-deletes/archives a lead | INFERRED | P1 | Commercial record — never hard delete |
| FR-LEAD-15 | Leads are never exposed on any public endpoint | CONFIRMED | P0 | Contains PII |
| FR-LEAD-16 | Lead PII retention policy enforced (`ip`, `userAgent` expire early) | CONFIRMED | P1 | DPDP Act |
| FR-LEAD-17 | WhatsApp hand-off logged so Flow B leads are not invisible | INFERRED | P2 | `EnquiryPill.tsx:37-43` |
| FR-LEAD-18 | Export leads to CSV | INFERRED | P2 | Common need; no evidence yet |

## PUB — Public API

| ID | Requirement | Status | Pri | Evidence |
|---|---|---|---|---|
| FR-PUB-01 | `GET /projects` returns published projects in admin order | CONFIRMED | P0 | `/projects`, homepage strip |
| FR-PUB-02 | `GET /projects/{slug}` returns one published project in full | CONFIRMED | P0 | `/projects/[slug]` |
| FR-PUB-03 | Unpublished/archived projects are invisible publicly (404, not 403) | CONFIRMED | P0 | Must not leak drafts |
| FR-PUB-04 | `GET /site-settings` returns public brand/contact/social/legal | CONFIRMED | P0 | Layout, nav, footer, contact |
| FR-PUB-05 | `GET /testimonials` returns published, consented testimonials | CONFIRMED | P1 | Homepage |
| FR-PUB-06 | `GET /faqs` returns ordered published FAQs | CONFIRMED | P1 | `/` and `/contact` |
| FR-PUB-07 | `GET /statistics` returns ordered homepage statistics | CONFIRMED | P1 | `/` and `/about` |
| FR-PUB-08 | Public responses never include admin-only fields | CONFIRMED | P0 | No internal notes, no lead data, no audit |
| FR-PUB-09 | Public reads are cacheable with clear cache semantics | CONFIRMED | P0 | Preserves static performance |
| FR-PUB-10 | Publishing triggers frontend revalidation | INFERRED | P1 | Otherwise edits never appear |
| FR-PUB-11 | `GET /healthz` liveness | INFERRED | P1 | Ops |
| FR-PUB-12 | **No public pagination/search/sort** unless a consumer appears | CONFIRMED | P0 | Catalogue filters 5 records client-side |

## AUDIT

| ID | Requirement | Status | Pri | Evidence |
|---|---|---|---|---|
| FR-AUDIT-01 | Every admin mutation logged: actor, action, entity, timestamp | CONFIRMED | P1 | Admin changes legally-regulated claims |
| FR-AUDIT-02 | Log records before/after for approval/title fields | INFERRED | P2 | RERA/DTCP claims |
| FR-AUDIT-03 | Audit log readable by admin, never writable | INFERRED | P2 | Integrity |

## Non-functional

| ID | Requirement | Status | Pri |
|---|---|---|---|
| NFR-01 | `POST /leads` < 500 ms p95 | INFERRED | P0 |
| NFR-02 | Backend downtime does not take the public site down | CONFIRMED | P0 |
| NFR-03 | Public pages keep LCP < 2.5 s, CLS < 0.05 | CONFIRMED | P0 |
| NFR-04 | Image dimensions always returned | CONFIRMED | P0 |
| NFR-05 | Only image quality 75 and 90 | CONFIRMED | P1 |
| NFR-06 | All admin traffic over HTTPS/HSTS | CONFIRMED | P0 |
| NFR-07 | Secrets from environment only, never committed | CONFIRMED | P0 |
| NFR-08 | Errors never leak stack traces or SQL | CONFIRMED | P0 |
| NFR-09 | Versioned, reversible migrations | CONFIRMED | P0 |
| NFR-10 | Daily backups with tested restore | CONFIRMED | P0 |
| NFR-11 | Validation rules shared between API and admin UI | INFERRED | P1 |
| NFR-12 | API response shape matches `types/content.ts` | CONFIRMED | P0 |

---

## Explicitly out of scope

| Not building | Why |
|---|---|
| Public user accounts / registration / login | Zero frontend evidence; brief forbids |
| Payments, checkout, pricing transactions | No pricing anywhere in the frontend |
| Online booking / scheduling | Site visits arranged by phone |
| `Service` entity | Brief mentions "services"; frontend has none — OQ-13 |
| Blog / `Article` entity | Route documented but does not exist — OQ-14 |
| Plot inventory, per-plot pricing, floor plans | No evidence; repo records none were supplied |
| Analytics | Frontend PRD defers to phase 2 |
| Multilingual | Phase 2; major schema impact |
| Microservices, GraphQL, realtime, search | No requirement |
