# ADMIN-CMS-SPEC.md

> ### Architecture note (D-015 — Payload CMS 3)
> **This document remains binding as a BEHAVIOURAL specification** — what each screen must do, which validation applies, which states exist, and what must be impossible. Its *layout* descriptions become guidance, because Payload generates the admin UI from config.
>
> **~80% is satisfied by configuration alone.** Verified against Payload in `IMPLEMENTATION-DECISION.md` §8. The remainder is small custom components, not screens:
> - §2 Dashboard — custom views for lead counts and the placeholder counter
> - §4 Icon field — a `select` over the 41 values satisfies FR-PROJ-15; a *visual* picker is a small custom field component
> - §8 Consent gate — **must be a `beforeValidate` hook, not merely a disabled button** (D-011)
> - §6 Media in-use delete guard — a `beforeDelete` hook (FR-MEDIA-08)
> - §11 Placeholder awareness — custom field component, still a recommendation (OQ-15)
>
> **OQ-5 is now partially answered:** the admin UI is served by the Payload/Next.js backend app on its own domain. Who builds the remaining custom components stays open.

Screen-by-screen specification of the admin system. This document specifies *behaviour*, which holds regardless of the host.

Design principle: **the admin mirrors the frontend's honesty rules.** The frontend refuses to fake a form success and renders unresolved placeholders inert. The admin must not undo that — it must make "I don't have this information" an easy, unalarming choice.

---

## 1. Login

**Purpose:** authenticate an administrator. The only unauthenticated admin screen.

| | |
|---|---|
| **Fields** | Email, Password |
| **Actions** | Log in |
| **API** | `POST /api/v1/admin/auth/login` |
| **Success** | Session cookie set → redirect to Dashboard |
| **Errors** | **Generic** "Incorrect email or password." — never reveal whether the email exists. `429` → "Too many attempts. Try again in N minutes." Locked → same generic message |
| **Validation** | Both required. Email format. No client-side password rules on *login* |

No "create account" link — accounts are seeded/invited (FR-AUTH-09). Password reset only if OQ-8 resolves yes.

## 2. Dashboard

**Purpose:** what needs attention today.

- **New leads** count + 5 most recent (name, phone, project, time) → lead detail
- **Projects**: published / draft / archived counts
- **Unresolved placeholders**: count of `[BRACKETED]` values still live *(strongly recommended — see §11)*
- **Media**: asset count, unused count

Actions: Add project · View all leads · Edit site settings.
API: `GET /admin/leads?perPage=5&isRead=false` · `GET /admin/projects?perPage=1` (counts).
Empty state: "No new leads." — never a fake number.

## 3. Projects — list

**Purpose:** find and manage every project, drafts included.

Columns: Cover thumb · Name · Category · Locality · Status badge (Published/Draft/Archived) · Featured · Order handle · Updated.
Actions: New · Edit · Publish/Unpublish · Feature toggle · Reorder (drag) · Archive · Restore.
Filters: status, category, text search. Default sort: `sortOrder`.
API: `GET /admin/projects` · `PATCH /admin/projects/order` · publish/unpublish · `DELETE`.

**Reorder writes immediately** with an optimistic UI and rollback on failure — order drives homepage and catalogue sequence.
**Archive confirms**, naming the consequence: *"This removes the project from the public website. Its page will 404. You can restore it later."*

## 4. Projects — create / edit

The richest screen. ~20 scalar fields + 4 repeatable lists + 5 media roles. **Group into sections; do not render one 40-field wall.**

### Section A — Identity (required)
| Field | Control | Validation |
|---|---|---|
| Name | text | required, ≤120 |
| Slug | text, auto from name | required, unique, kebab-case. **Locked once published** with an explicit override + warning (FR-PROJ-18) |
| Category | select (4) | required |
| Status | select + "Not stated" | optional. **Default "Not stated"** — no brochure states one |
| Locality | text | required |
| Developer | text | optional. Helper: *"Only if different from the site's company name."* |
| Tagline | text | optional, ≤200 |

### Section B — Narrative
| Field | Control | Validation |
|---|---|---|
| Summary | textarea | required. Helper: *"Rendered as the large heading on the detail page."* |
| Description | **repeatable paragraphs** | ≥1. **Must be discrete paragraphs, not one rich-text blob** — stored as `text[]` |
| Area | text | optional. Helper: *"Exactly as printed, e.g. 6 Acres 22.50 Guntas."* |
| Road details | text | optional |

### Section C — Repeatable lists
Four lists — **Highlights** (≥1), **Approvals**, **Amenities**, **Location highlights** — each row `{icon, title, body?}`; plus **Stats** `{label, value}` and **Proximity** `{icon, measure, place}`.

- **Icon is a visual picker over the 41 valid names — never a free-text field** (FR-PROJ-15).
- Rows drag-reorder; order is meaningful.
- Empty list helper: *"Leave empty and this section will not appear on the website."*
- Proximity helper: ⚠️ *"Only enter distances printed on the brochure. Unmeasured proximity claims are the most likely to be challenged."*
- Approvals helper: ⚠️ *"Legal claims — these are audited."*

### Section D — Media
| Role | Control | Notes |
|---|---|---|
| Cover image | single picker | **Required.** Card + hero |
| Gallery | multi, orderable | optional |
| Layout plan | single | optional. *"Shown contained and zoomable — never cropped."* |
| Location map | single | optional. Same |
| Brochure pages | multi, orderable | optional |

Each opens the Media library (§6) to choose or upload. **Alt text is required before attaching** (FR-MEDIA-04).

### Section E — Overrides (collapsed by default)
CTA title/body (both-or-neither) · SEO title/description. Helper: *"Leave blank to use the generated version."*

### Section F — Publishing
Featured toggle · Sort order · Save draft · Save & publish · Unpublish.

**States:** unsaved-changes guard on navigate · field-level `422` mapping · `409` → "That slug is already used by another project." · success toast naming what happened ("Saved and published — the website will update shortly.").

## 5. Leads — list and detail

**List.** Columns: unread dot · Name · Phone (click-to-call) · Project · Source · Received. Filters: read/unread, status, project, source, date range, search. Default sort: newest.
**Detail.** All fields + full message, source path, timestamps. Actions: mark read/unread, change status, archive. Phone and WhatsApp deep links for immediate follow-up.

API: `GET /admin/leads` · `GET|PATCH|DELETE /admin/leads/{id}`.

> **Status is INFERRED (OQ-3).** If the owner confirms no pipeline, **remove the control entirely** rather than shipping a field nobody maintains. Do not default to building it.

**Never** offer hard delete — a lead is a commercial record (FR-LEAD-14).

## 6. Media library

Grid of thumbnails; filter by type, search filename/alt, toggle "unused only".

**Upload:** drag-drop or picker. Client-side pre-check for type/size, **server-side is authoritative** (FR-MEDIA-02). Shows progress; on success prompts immediately for **alt text**.

**Detail:** preview, filename, dimensions, size, type, uploaded by/when, **"Used in" list**, editable alt text, Replace, Delete.

**Delete:** `409` while attached → *"This image is used by 2 projects. Remove it there first, or delete anyway."* Never silently break a live page.

**Alt text is required before public attachment** — the a11y contract and `ImageRef` both demand it.

## 7. Site settings

Tabbed, single form.

- **Brand** — name, legal name, tagline, description, URL, logo
- **Contact** — phone, email, **WhatsApp** (digits only, country code first; helper + live `wa.me` preview), address lines (ordered), map URL, office hours
- **Social** — Facebook, Instagram, YouTube (label + URL + icon)
- **Legal** — copyright, privacy URL, terms URL
- **Content** — form note, CTA title/body

API: `GET|PATCH /admin/site-settings`.

⚠️ **Warn on save:** *"These values appear on every page of the public website."*
⚠️ **WhatsApp specifically:** setting a real value **changes hero behaviour** — the capture pill switches from routing to `/contact` to opening WhatsApp directly. Say so on the field.

## 8. Content (Tier 2)

Same shape for **Testimonials**, **FAQs**, **Statistics**: list → reorder → create/edit → publish/unpublish.

- **Testimonials** — name, role, rating (1–5), body, **Consented** checkbox. **Publish is disabled until Consented is ticked**, with the reason shown: *"Publishing reviews that were not given by a real, consenting client is a fabricated record."* (FR-CONT-04)
- **FAQs** — question, answer, order. Note: *"Shown on both the homepage and the contact page."*
- **Statistics** — label, value (**text**, e.g. `"120+"`, `"Immediate"`), order. Note: *"Shown on the homepage and the about page. These are typed by you, not calculated."*

## 9. Account

Change own password (current + new + confirm). Invalidates all other sessions and says so. No user management until OQ-4 resolves.

## 10. Cross-cutting

**Permissions.** Single `admin` role (OQ-4). Every screen requires a session; `401` → login with return path; `403` → "You do not have permission" (unused under a single role, but the check exists).

**Validation.** Inline, field-level, on blur and on submit. Server `422` details map to the same fields — `details[].field` matches the input name. **Server rules are authoritative.**

**Errors.** Field errors inline; `409` as a specific, actionable message; `5xx` as "Something went wrong — nothing was saved" plus a request id. **Never claim success on failure** — the same rule the public contact form already follows.

**Unsaved changes.** Guard navigation on every edit form.

**Audit.** Every mutation writes to `audit_log` (FR-AUDIT-01), invisibly to the user except on the audit screen.

## 11. Recommended: placeholder awareness

The frontend renders `[BRACKETED]` values inert on purpose so a placeholder can never ship looking live. **The admin should surface the same signal:** flag any field whose value is still bracketed, and show a dashboard count of unresolved placeholders.

Without this, the CMS quietly becomes a way to publish placeholders — the exact failure the frontend was carefully built to prevent. *(Recommendation, not a confirmed requirement — see OQ-15.)*

## Deliberately NOT built

| Not building | Why |
|---|---|
| Public user management | No public accounts exist |
| Page builder / arbitrary section editing | Headings and layout are code (`CONTENT-MANAGEMENT-MATRIX.md` §4) |
| Rich-text/WYSIWYG for headings | Would destroy the `title` + `titleAccent` structural split |
| Theme/colour editor | Design tokens are code; contrast pairs are AA-validated |
| Navigation editor | Nav structure mirrors routes |
| Workflow/approvals | Single role, small team |
| Analytics dashboard | No analytics exist |
| Bulk import/export beyond lead CSV | No requirement |
