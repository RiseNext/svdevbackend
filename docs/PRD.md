# PRD.md — SV Developers: Public Website + Private Admin CMS

> ### ⚠️ D-015 reconciliation banner — 20 Sep 2026
>
> Product vision, users and scope are **unchanged**. Two details are corrected:
>
> - **“Four media collections” → five media roles** (`cover`, `gallery`, `layout`, `location_map`, `brochure`), plus a separate **`documents`** collection for the master-plan PDF (D-032).
> - The admin CMS is **Payload's native admin UI**, served by the backend app — not a separately built SPA (D-015; OQ-5 partially answered).
>
> 🔴 The product decisions this document could not make remain **unmade**: company name (OQ-6), privacy policy (OQ-24), testimonial truth (OQ-23), and all `[BRACKETED]` placeholders (OQ-22). **All four block launch.**
>
> **Authoritative for execution:** [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) · Correction detail: [`DOCUMENTATION-CORRECTIONS.md`](./DOCUMENTATION-CORRECTIONS.md)

---

**Status:** Specification · No implementation · 18 September 2026
**Supersedes:** the backend scope in `../../BACKEND-REQUIREMENTS.md` (see `DECISIONS.md` D-001)

Every statement is tagged **[CONFIRMED]** (evidenced in frontend source or stated by the owner), **[INFERRED]** (reasonable deduction, needs confirmation), **[FUTURE]** (deferred), or **[OPEN]** (blocking decision).

---

## 1. Product vision

One system, two faces: a **public real-estate marketing website** that persuades plot buyers to visit a site, and a **private admin CMS** that lets the business run that website — add projects, update content, manage media, and work the leads it generates — **without a developer**.

## 2. Problem

**[CONFIRMED]** The website exists and works, but every word and picture is compiled into the frontend bundle. `src/content/projects.ts` carries all 5 projects; `site.ts` and `pages.ts` carry brand, contact and page copy. Changing a phone number, adding a project, or publishing a real testimonial currently requires a developer, a commit and a deploy.

**[CONFIRMED]** The contact form is a dead end. `ContactForm.tsx:48-50` validates input and then states plainly that nothing was sent — deliberately, because telling a visitor "we'll call you back" when no message was transmitted is worse than showing no form. **Every enquiry typed into that form today is lost.**

**[CONFIRMED]** Most factual content is unresolved. Phone, email, WhatsApp, address, domain, approval numbers, statistics and all 11 drive times are `[BRACKETED]` placeholders. The site is `noindex` + `Disallow: /` because of it.

## 3. Target users

| User | Access | Needs | Evidence |
|---|---|---|---|
| **Public visitor** (plot buyer) | No account, ever | Browse projects, check approvals and location, enquire by form / phone / WhatsApp | **[CONFIRMED]** — the whole public site |
| **Administrator** (owner / sales / marketing staff) | Authenticated | Manage projects, content, media, leads, settings | **[CONFIRMED]** by the business brief |

**[CONFIRMED] There is no third user type.** No public registration, no buyer accounts, no customer portal. Nothing in the frontend implies one, and none is to be built.

**[OPEN]** Are there distinct admin roles (e.g. sales sees only leads, marketing only content), or one administrator role? See OQ-4. **Default: one role.**

## 4. Public visitor experience — [CONFIRMED]

10 route patterns, **15** prerendered pages *(corrected from “17”, 20 Sep 2026 — the enumeration below sums to 15)*: `/` · `/about` · `/projects` · `/projects/[slug]` (×5) · `/amenities` · `/master-plan` · `/location` · `/contact` · 404 · `robots.txt` + `sitemap.xml`.

Journey: land → browse the catalogue (client-side category filter over 5 records) → open a project → read summary, highlights, approvals, amenities, layout plan, location, gallery → hit a CTA → enquire.

Three conversion routes, all present today:
1. **Contact form** at `/contact` — name, phone, optional project, optional message. **Currently broken by design.**
2. **Hero phone-capture pill** — if `site.whatsapp` is real it opens a `wa.me` deep link; while bracketed it routes to `/contact?phone=…` and prefills the form.
3. **Direct `tel:` / `mailto:` / WhatsApp** links in the nav, footer and project pages.

**What changes:** the page content is served from the backend instead of the bundle, and the form actually submits. **Nothing about the visual design, layout or interaction changes.**

## 5. Admin experience — [CONFIRMED as a requirement; screens INFERRED]

Login → dashboard → work. Full detail in `ADMIN-CMS-SPEC.md`.

- **Dashboard** — recent leads, project counts, unpublished drafts.
- **Projects** — list, create, edit, publish/unpublish, reorder, feature, archive. The richest screen: ~20 fields plus four media collections.
- **Media library** — upload, browse, replace, delete; alt text and dimensions.
- **Leads** — list with filters, detail view, status update.
- **Site settings** — brand, contact channels, social, legal links.
- **Content** (T2) — testimonials, FAQs, statistics, ticker.
- **Account** — change own password.

## 6. Real-estate project management — [CONFIRMED]

The `Project` entity is the heart of the CMS. Its shape is already fully specified by `src/types/content.ts` — the backend must match it exactly or the frontend breaks.

Required: `slug`, `name`, `category` (4-value enum), `locality`, `summary`, `description[]`, `highlights[]`, cover `image`.
Optional: `status`, `developer`, `tagline`, `stats[]`, `amenities[]`, `approvals[]`, `locationHighlights[]`, `proximity[]`, `area`, `roadDetails`, `gallery[]`, `layoutImage`, `locationMap`, `brochureImages[]`, `cta{}`, `seo{}`, `featured`.
New backend capabilities: **publish state** and **explicit ordering** (today: presence in the array, and file order).

**[CONFIRMED] Design constraint — absence is meaningful.** Optional fields drop their entire section rather than render an empty shell. The admin UI must make "leave blank" an easy, unalarming choice; the API must omit empty collections, not return `[]`.

**[CONFIRMED] `icon` fields are a closed enum** of 41 names in `ui/Icon.tsx`. The admin must pick from a list; an unknown name breaks rendering.

## 7. Content management — [scope in `CONTENT-MANAGEMENT-MATRIX.md`]

The principle: **content becomes editable; structure does not.** Projects, contact details, testimonials, FAQs and statistics are business facts the owner must control. Section headings, the design system, navigation structure and animation are code.

**[CONFIRMED]** ~17 headings are hardcoded in JSX rather than in `content/`, so they are not editable without refactoring — and should not be.

**[CONFIRMED]** Headings use a **two-field structural split** (`title` + `titleAccent`), where the `<em>` is the headline's second line, not emphasis. Any editable heading must preserve both fields. A single rich-text field would destroy the type system.

## 8. Lead management — [CONFIRMED need; pipeline INFERRED]

Public submit → validate → persist → notify sales. Admin lists, filters, opens and updates leads.

Fields confirmed from the form: `name`, `phone`, `projectSlug?`, `message?`. Server adds `source`, timestamps, soft-delete.

**[INFERRED]** The status pipeline (`new → contacted → visit_scheduled → visited → won → lost`) is deduced from the sales process the site describes, **not** from any UI. **If nobody manages leads in a tool, drop the field.** OQ-3.

**[CONFIRMED] Gap:** the WhatsApp branch and all `tel:`/`mailto:` clicks bypass the system entirely. Those leads are invisible. Logging the WhatsApp hand-off is the cheapest partial fix.

## 9. Media management — [CONFIRMED]

Projects need a cover image (required), gallery, layout plan, location map and brochure scans. The master-plan PDF needs hosting. The logo should be replaceable.

**[CONFIRMED] Constraints from the frontend:** every image must carry explicit `width`/`height` (CLS budget < 0.05); AVIF/WebP output; **quality values limited to exactly 75 and 90** (`next.config.mjs:14`); alt text is required — `ImageRef` mandates it.

**[CONFIRMED]** Today all 8 project/site images are placeholder SVGs, `dangerouslyAllowSVG` is on to render them, and that flag must be removed once real raster art lands.

**[CONFIRMED] No public upload exists or should exist.** Uploads are admin-only.

## 10. Functional requirements

Numbered and traceable in `REQUIREMENTS.md`. Summary:

**Public** — list/get published projects · get site settings · get testimonials, FAQs, statistics · submit a lead · health check.
**Admin** — authenticate · manage projects (CRUD, publish, order, feature, archive) · manage project media · manage the media library · manage testimonials, FAQs, statistics · manage site settings · manage leads · view audit log · change own password.

## 11. Non-functional requirements

| Area | Requirement | Source |
|---|---|---|
| Performance | Public reads served from cache/ISR. **The site must stay statically fast** — no backend on the render path | Frontend budgets: LCP < 2.5 s, First Load JS 102–114 kB |
| Availability | Backend downtime must not take the public site down | Static-first integration |
| Lead latency | POST `/leads` < 500 ms p95 | The only user-facing write |
| Correctness | Server validation independent of the client | `noValidate` — all client rules are JS |
| Security | Admin mutates legally-regulated public claims | `SECURITY.md` |
| Auditability | Every admin mutation logged with actor + before/after | Approval numbers, title claims |
| Accessibility | Backend must not break existing AA compliance — alt text required, dimensions always present | Frontend a11y work |
| Data protection | Name + phone under India's DPDP Act | `formNote` promise |

## 12. Future scope — [FUTURE]

Analytics · blog/articles (if OQ-14 resolves that way) · Telugu multilingual (PRD phase 2 — significant schema impact) · WhatsApp Business API for server-sent messages · CRM integration · embedded map on `/location` · site-visit scheduling · per-plot inventory and pricing.

**None of these are in scope. Do not build them.**

## 13. Assumptions

1. **[INFERRED]** One administrator role suffices initially. (OQ-4)
2. **[INFERRED]** Admin accounts are created by seeding/invite, not self-registration. No signup endpoint.
3. **[INFERRED]** Content volume stays small — single-digit projects, tens of leads/month. This justifies a single service and no caching tier beyond ISR.
4. **[INFERRED]** English only at launch.
5. **[CONFIRMED]** The frontend keeps its static-first rendering; the backend feeds it at build/revalidate time, not per request.
6. **[INFERRED]** The admin UI is a separate authenticated app, not part of the public Next.js site. (OQ-5)

## 14. Open questions

Full list with impact in `OPEN-QUESTIONS.md`. The five that block implementation:

1. **OQ-1** Where do leads ultimately go — our DB, a CRM, or email only?
2. **OQ-2** Who is notified of a new lead, by which channel?
3. **OQ-3** Is the lead status pipeline real, or is `status` dead weight?
4. **OQ-5** Where does the admin UI live, and who builds it?
5. **OQ-7** Which storage provider for media?

And two that block **launch** but not backend development: **OQ-6** the company-name conflict (SV Developers vs SRR Developers Pvt. Ltd.), and the wholesale replacement of `[BRACKETED]` placeholders — neither of which any amount of backend work fixes.
