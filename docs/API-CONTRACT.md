# API-CONTRACT.md

> ### Architecture note (D-015 — Payload CMS 3)
> - **The PUBLIC API below is binding and unchanged.** It is implemented as **hand-written custom endpoints** with a `toPublicProject()` serialiser. **Do not serve public responses from Payload's generated routes** — their default output violates omit-don't-empty (D-008) and returns `description` as objects rather than `string[]`.
> - **The ADMIN API below is now DESCRIPTIVE, not prescriptive.** Payload generates the admin API and consumes it from its own admin UI. The listed operations must all exist and behave as described; their exact paths and payload envelopes are Payload's, not these. Treat the admin section as a **capability checklist**.
> - Generated endpoints not required by this contract must be **disabled or locked down** (risk R-9).

Base: `/api/v1`. JSON in/out, UTF-8. **`camelCase`** throughout, matching the TypeScript frontend. Timestamps ISO-8601 UTC.

**Two surfaces, one boundary:**

| Surface | Prefix | Auth | Can |
|---|---|---|---|
| **Public** | `/api/v1/**` | None | Read published content · create a lead |
| **Admin** | `/api/v1/admin/**` | **Required on every route** | Everything |

---

## Envelopes

**Success**
```jsonc
{ "data": { }, "meta": { } }   // meta only where pagination applies
```

**Error**
```jsonc
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "requestId": "req_01JBX…",
    "details": [
      { "field": "phone", "code": "TOO_SHORT", "message": "Enter a 10-digit mobile number." }
    ]
  }
}
```

> **`details[].field` must exactly match the frontend input `name`** (`name`, `phone`, `project`, `message`) so `ContactForm`'s existing `Errors` map renders server errors in the same inline slots with no redesign.

**Status codes:** `200` OK · `201` Created · `204` No Content · `400` malformed · `401` unauthenticated · `403` authenticated but not permitted · `404` not found *(also used to hide unpublished content)* · `409` conflict (duplicate slug) · `422` validation failed · `429` rate limited (+ `Retry-After`) · `500` internal (opaque message, `requestId` logged).

**Error codes:** `VALIDATION_ERROR` · `UNAUTHENTICATED` · `FORBIDDEN` · `NOT_FOUND` · `CONFLICT` · `RATE_LIMITED` · `PAYLOAD_TOO_LARGE` · `UNSUPPORTED_MEDIA_TYPE` · `INTERNAL_ERROR`.

---

# PUBLIC API

Every public response contains **only published, non-deleted** content. Unpublished → `404`, never `403` (a `403` confirms existence).

## `GET /api/v1/projects` — FR-PUB-01

Query: `category?` (one of the 4) · `featured?` (bool). **No pagination, search or sort** — 5 records, filtered client-side (FR-PUB-12).

```jsonc
{ "data": [ {
  "slug": "sri-city-aler-town",
  "name": "Sri City Aler Town",
  "category": "Premium Villa Plots",
  "status": null,
  "locality": "Aler, Warangal Highway",
  "developer": null,
  "tagline": "Premium villa plots on the Warangal highway",
  "summary": "A DTCP and RERA approved villa plot layout…",
  "featured": true,
  "image": { "src": "https://cdn…/cover.jpg",
             "alt": "Sri City Aler Town — premium villa plots…",
             "width": 1200, "height": 800 }
} ] }
```

List returns **card fields only** — the detail payload is materially larger and nothing renders it in a list.

## `GET /api/v1/projects/{slug}` — FR-PUB-02, 03

Full record. Shape matches `Project` in `types/content.ts` exactly.

```jsonc
{ "data": {
  "slug": "sri-city-aler-town",
  "name": "Sri City Aler Town",
  "category": "Premium Villa Plots",
  "status": null,
  "locality": "Aler, Warangal Highway",
  "tagline": "Premium villa plots on the Warangal highway",
  "summary": "…",
  "description": ["Sri City Aler Town is a premium…", "The layout is DTCP and RERA approved…"],
  "area": "6 Acres 22.50 Guntas",
  "roadDetails": "30 feet BT roads",
  "stats":      [ { "label": "Total area", "value": "6 Acres 22.50 Guntas" } ],
  "highlights": [ { "icon": "city", "title": "Premium residential villa plots" } ],
  "approvals":  [ { "icon": "shield", "title": "DTCP & RERA approved layout" } ],
  "amenities":  [ { "icon": "tree", "title": "Avenue plantation" } ],
  "locationHighlights": [ { "icon": "temple", "title": "Yadagirigutta" } ],
  "image": { "src": "…", "alt": "…", "width": 1200, "height": 800 },
  "featured": true
} }
```

> **Critical — FR-PROJ-17: omit, do not empty.** Absent optional fields must be **absent from the JSON** (or `null` for scalars), never `[]`. The frontend drops a whole section on falsy/empty, and the repo's design rule is that a thin brochure yields a shorter page, not an empty shell. Above, `developer`, `proximity`, `gallery`, `layoutImage`, `locationMap`, `brochureImages`, `cta` and `seo` are omitted because this project has none.

`404` when the slug is unknown, unpublished, or archived.

## `GET /api/v1/site-settings` — FR-PUB-04

```jsonc
{ "data": {
  "name": "SV Developers", "legalName": "SV Developers",
  "tagline": "Approved residential plots", "description": "…",
  "url": "https://…", "email": "…", "phone": "…", "whatsapp": "910000000000",
  "address": ["…","…","…"], "mapUrl": "…",
  "officeHours": "Site visits seven days a week, 9am – 7pm",
  "social":     [ { "label": "Facebook", "href": "…", "icon": "facebook" } ],
  "legalLinks": [ { "label": "Privacy policy", "href": "…" } ],
  "copyrightText": "…", "formNote": "…",
  "cta": { "title": "Come and walk the layout", "body": "…" },
  "logo": { "src": "…", "alt": "", "width": 160, "height": 160 }
} }
```

**Never** exposes `updatedBy`, internal ids, or any admin field (FR-PUB-08).

> `whatsapp` is digits-only with country code first — `EnquiryPill.tsx:39` builds `wa.me/<value>` directly.

## `GET /api/v1/testimonials` — FR-PUB-05

Published **and consented** only. `{ id, name, role, rating, body }`.

## `GET /api/v1/faqs` — FR-PUB-06 · `GET /api/v1/statistics` — FR-PUB-07

Ordered, published. `{ id, question, answer }` / `{ id, label, value }`.

## `POST /api/v1/leads` — FR-LEAD-01..09

**The only public write.** Unauthenticated. Rate limited (5/min/IP, 3/hour/phone). Honeypot field accepted and silently discarded. Optional `Idempotency-Key` header.

Request
```jsonc
{ "name": "Ramesh Kumar", "phone": "9876543210",
  "projectSlug": "sri-city-aler-town",
  "message": "Looking for a 200 sq yd plot, can visit this Sunday.",
  "source": "contact_form" }
```

`201`
```jsonc
{ "data": { "id": "01JBX…", "createdAt": "2026-09-18T09:30:00Z",
            "message": "Thanks — we will call you back." } }
```

`422` example
```jsonc
{ "error": { "code": "VALIDATION_ERROR", "message": "One or more fields are invalid.",
  "details": [ { "field": "phone", "code": "TOO_SHORT",
                 "message": "Enter a 10-digit mobile number." } ] } }
```

- `source` is **server-assigned**; a client value is advisory only (FR-LEAD-04).
- `projectSlug` must be absent, `""`/`null`, or a **known slug** — never trusted (FR-LEAD-03).
- Response never echoes stored PII beyond the id.

## `GET /healthz` — FR-PUB-11

`200 {"status":"ok","db":"ok"}`. No auth, no sensitive detail.

---

# ADMIN API

**Every route requires a valid session.** Missing/expired → `401 UNAUTHENTICATED`. Valid but not permitted → `403 FORBIDDEN`.

## Auth

| Method | Path | Purpose | Notes |
|---|---|---|---|
| `POST` | `/admin/auth/login` | Log in | `{email, password}` → sets httpOnly cookie. Rate limited + lockout (FR-AUTH-08). **Generic failure message** — never reveal whether the email exists |
| `POST` | `/admin/auth/logout` | Log out | Deletes the session row |
| `POST` | `/admin/auth/refresh` | Extend session | FR-AUTH-05 |
| `GET` | `/admin/auth/me` | Current identity | `{id, email, name, role}` |
| `POST` | `/admin/auth/password` | Change own password | Requires `currentPassword`. **Invalidates all other sessions** |

**There is no registration endpoint** (FR-AUTH-09).

## Projects — FR-PROJ-01..18

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/projects` | List **including drafts**. Query: `status`, `category`, `q`, `page`, `perPage`, `sort` |
| `GET` | `/admin/projects/{id}` | Full record incl. admin fields |
| `POST` | `/admin/projects` | Create → `201`. `409` on duplicate slug |
| `PATCH` | `/admin/projects/{id}` | Partial update |
| `POST` | `/admin/projects/{id}/publish` | Set `publishedAt` → triggers revalidation |
| `POST` | `/admin/projects/{id}/unpublish` | Clear `publishedAt` → triggers revalidation |
| `DELETE` | `/admin/projects/{id}` | **Archive** (soft). `204` |
| `POST` | `/admin/projects/{id}/restore` | Un-archive |
| `PATCH` | `/admin/projects/order` | Reorder: `{ "order": [{"id":"…","sortOrder":0}] }` |

Nested collections are replaced wholesale on `PATCH` (simpler than per-row CRUD at this volume):
```jsonc
{ "highlights": [ { "icon": "city", "title": "…", "body": null } ],
  "stats":      [ { "label": "Total area", "value": "6 Acres 22.50 Guntas" } ],
  "proximity":  [ { "icon": "route", "measure": "5 min", "place": "…" } ] }
```
Every `icon` validated against the 41-name union → `422` otherwise (FR-PROJ-15).

## Project media — FR-MEDIA-05, 06

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/admin/projects/{id}/media` | Attach: `{mediaAssetId, role, sortOrder?}`. `409` if a single-valued role is already taken |
| `DELETE` | `/admin/projects/{id}/media/{attachmentId}` | Detach (asset survives) |
| `PATCH` | `/admin/projects/{id}/media/order` | Reorder within a role |

Roles: `cover` · `gallery` · `layout` · `location_map` · `brochure`. `cover`, `layout`, `location_map` are single-valued.

## Media library — FR-MEDIA-01..13

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/media` | List. Query: `assetType`, `q`, `page`, `perPage`, `unused` |
| `POST` | `/admin/media` | **Upload** `multipart/form-data`. Validates type/size/magic bytes; extracts `width`/`height` server-side. `413`/`415` on violation |
| `GET` | `/admin/media/{id}` | Detail + usage list |
| `PATCH` | `/admin/media/{id}` | Update `altText` |
| `POST` | `/admin/media/{id}/replace` | Replace the file, keep attachments (FR-MEDIA-07) |
| `DELETE` | `/admin/media/{id}` | Soft delete. **`409` while attached** unless `?force=true` (FR-MEDIA-08) |

## Leads — FR-LEAD-10..18

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/leads` | List. Query: `status`, `projectSlug`, `source`, `isRead`, `from`, `to`, `q`, `page`, `perPage`, `sort` |
| `GET` | `/admin/leads/{id}` | Full detail. Marks read (or via explicit PATCH) |
| `PATCH` | `/admin/leads/{id}` | Update `status` and/or `isRead`. **`status` is INFERRED — OQ-3** |
| `DELETE` | `/admin/leads/{id}` | Soft delete |
| `GET` | `/admin/leads/export` | CSV (FR-LEAD-18) |

Paginated list meta:
```jsonc
{ "data": [ ], "meta": { "page": 1, "perPage": 25, "total": 137, "totalPages": 6 } }
```

## Content — FR-CONT-03..10

Uniform CRUD for `testimonials`, `faqs`, `statistics` (and Tier-2 `ticker-items`, `site-features`, `site-proximity`):

`GET /admin/{resource}` · `POST /admin/{resource}` · `GET|PATCH|DELETE /admin/{resource}/{id}` · `POST /admin/{resource}/{id}/publish|unpublish` · `PATCH /admin/{resource}/order`

**Testimonials additionally:** publish requires `consented === true` → `422 CONSENT_REQUIRED` otherwise (FR-CONT-04).

## Site settings — FR-CONT-01, 02

`GET /admin/site-settings` · `PATCH /admin/site-settings` (partial; singleton — no id).

## Audit log — FR-AUDIT-01..03

`GET /admin/audit-log` — read-only, paginated, filter by `entityType`, `entityId`, `adminUserId`, date range. **No write, update or delete route exists.**

---

## Cross-cutting

**Caching (FR-PUB-09).** Public `GET`s: `Cache-Control: public, max-age=60, stale-while-revalidate=600` + `ETag`. Admin routes: `Cache-Control: no-store`. `POST /leads`: `no-store`.

**Revalidation (FR-PUB-10).** Publish/unpublish/update on public-visible content calls the frontend revalidation webhook with a shared secret, naming affected paths (`/`, `/projects`, `/projects/{slug}`, `/sitemap.xml`).

**CORS.** Strict allow-list of exactly two origins — the public site (for `POST /leads` only) and the admin UI (credentialed). **Never `*`.**

**Rate limits.** `POST /leads` 5/min/IP + 3/hour/phone · `POST /admin/auth/login` 5/15min/IP + account lockout · other admin routes a generous per-session ceiling.

**Versioning.** `/api/v1` frozen once the frontend consumes it. Breaking changes → `/api/v2`.
