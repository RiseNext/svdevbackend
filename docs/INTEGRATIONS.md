# INTEGRATIONS.md

Every external service the system touches — what it is for, whether it is required, what secrets it needs, and whether webhooks are involved.

**Current reality: the frontend integrates with exactly one external service, and it is gated behind a placeholder.**

---

## 1. Summary

| Service | Status | Required for | Secrets | Webhook |
|---|---|---|---|---|
| **Transactional email** | ❌ **Must add** | Lead notification (FR-LEAD-05) | SMTP host/port/user/pass, from-address | Bounce/complaint (optional) |
| **Object storage — Cloudinary** | ✅ **Decided** (D-123); account AWAITING INFRA | Media (FR-MEDIA-01..13) | Cloud name, API key, API secret | No |
| **Database — Neon PostgreSQL** | ✅ **Decided** (D-124); project AWAITING INFRA | Everything, incl. **lead PII** | Connection strings (pooled + direct) | No |
| **WhatsApp deep link** | ✅ Exists (inert) | Hero pill, contact | **None** | No |
| WhatsApp Business API | ⬜ Optional | Server-sent alerts | Token, phone id | Delivery receipts |
| SMS | ⬜ Optional | Lead alerts | Provider creds | Delivery status |
| Google Maps | ⬜ Partial | "Open in Maps" link; future embed | Key **only if embedded** | No |
| Frontend revalidation | ❌ **Must add** | Publishing (FR-PUB-10) | Shared secret | Outbound to frontend |
| Analytics | ⬜ Not present | — | — | — |
| Payments | 🚫 **Not applicable** | — | — | — |
| Auth provider | 🚫 **Not applicable** | — | — | — |
| CRM | ❓ Unknown | Depends on OQ-1 | — | Possibly |

---

## 2. Transactional email — **required**

**Why:** a lead that nobody is told about is a lead that was not captured. This is the difference between storing data and running a business.

**Frontend usage:** none — the frontend never sends email. `mailto:` links in the footer and `/contact` open the visitor's own mail client and do not touch the backend.

**Backend requirement:**
- Notify sales on every new lead — must include name, phone, project, message, timestamp, source.
- Queued with retry and a dead-letter path. **A failed send must never fail the lead request** (FR-LEAD-06) — persist first, enqueue second.
- **HTML-escape every lead field** in the email body. Lead content is attacker-controlled free text (`SECURITY.md` §9).
- Optional: autoresponder to the buyer (OQ-20). Changes the sender-reputation and compliance picture — it is a marketing message to a person who gave a phone number, not an email.

**Options:** Resend (simple, good DX) · AWS SES (cheapest at volume, more setup) · Postmark (best deliverability for transactional) · SendGrid.
**Recommendation:** Resend or SES. Decide via OQ-7.

**Secrets:** `EMAIL_API_KEY`, `EMAIL_FROM`, `SALES_NOTIFICATION_EMAIL`.
**Webhooks:** bounce/complaint handling is optional at this volume but worth it if an autoresponder ships.

> ⚠️ **Staging must not send real notifications** (`PRD.md` §11). Use a sandbox address or a capture tool.

## 3. Object storage — ✅ **DECIDED: Cloudinary** (20 Sep 2026 · D-123)

**Why:** FR-MEDIA-01..13.

**Provider: Cloudinary**, an owner decision that closed OQ-7a and superseded the S3 recommendation. Implemented as a hand-written adapter on `@payloadcms/plugin-cloud-storage`, because **Payload publishes no Cloudinary adapter** and Cloudinary has no S3-compatible endpoint. Detail in `MEDIA-MANAGEMENT.md` §5 and [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md) §3.

**No transformations are used** — `next/image` already handles optimisation, so Cloudinary is storage and CDN only. That deliberately keeps the coupling to a key prefix and a hostname.

**Secrets:** `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (+ optional `CLOUDINARY_DELIVERY_BASE_URL`).
**Webhooks:** none.

## 3b. Database hosting — ✅ **DECIDED: Neon PostgreSQL** (20 Sep 2026 · D-124)

Not previously in this table, because the original list predates the decision to self-host Payload on managed Postgres. It belongs here: it is an external service that holds **lead PII**, which makes it a sub-processor the privacy policy must name (OQ-24).

**Secrets:** `DATABASE_URL` (pooled endpoint, app) and `MIGRATE_DATABASE_URL` (direct endpoint, DDL role).
**Webhooks:** none.

## 4. WhatsApp — **exists, currently inert**

**Why:** the primary reply channel in this market. The frontend PRD is explicit that phone beats email for plot enquiries here.

**Frontend usage — real code, read it carefully** (`EnquiryPill.tsx:23-47`):

```
whatsappReady = !isPlaceholder(site.whatsapp)

if (whatsappReady)  → window.open(`https://wa.me/${site.whatsapp}?text=…`)
else                → router.push(`/contact?phone=${digits}`)
```

**Consequences the backend must respect:**
1. `whatsapp` must be **digits only, country code first** (`910000000000`). A `+`, space or dash breaks the URL. Validated in `VALIDATION-RULES.md` §5.
2. **Setting a real value changes hero behaviour** — the pill stops routing to `/contact` and starts opening WhatsApp. The admin UI must warn about this (`ADMIN-CMS-SPEC.md` §7).
3. ⚠️ **In the WhatsApp branch the lead never reaches our system.** It goes straight from the visitor's phone to a WhatsApp inbox. **This is a lead-attribution hole.** FR-LEAD-17 proposes logging the hand-off; it is the cheapest partial fix.

**Backend requirement for the deep link: none.** It is a plain URL.

**WhatsApp Business API** would be needed only to *send* messages from the server (instant sales alerts, autoresponses). That is a significant undertaking — Meta business verification, template approval, per-message cost. **Not recommended initially.** Secrets if adopted: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Webhooks: delivery/read receipts.

## 5. Google Maps — partial

**Frontend usage:** `/contact` renders an "Open in Maps" link from `site.mapUrl`, currently `[GOOGLE_MAPS_URL]` and therefore inert.

**Backend requirement:** none — it is a stored URL, managed as a site setting. **No API key needed for a plain link.**

**Future:** the frontend PRD "before you go live" list item 11 wants an **embedded, lazy-loaded map** on `/location`, noting that third-party map embeds are the heaviest thing that can land on a page like this and the audience is on mid-range Android. If that ships, it needs `MAPS_API_KEY` and is a frontend concern, not a backend one.

## 6. Frontend revalidation — **required**

**Why:** with ISR (`ARCHITECTURE.md` §4), an admin edit does not appear until the affected pages rebuild. Without this, **publishing silently does nothing visible** — the single most confusing possible failure for an admin.

**Requirement:** on publish/unpublish/update of public-visible content, the backend calls the frontend's revalidation endpoint with a shared secret, naming affected paths (`/`, `/projects`, `/projects/{slug}`, `/sitemap.xml`).

**Secrets:** `REVALIDATE_WEBHOOK_URL`, `REVALIDATE_SECRET`.

> This is the one place the backend calls the frontend rather than the reverse. It must be **fire-and-forget with retry** — a revalidation failure must not fail the admin's save. Surface a warning instead: *"Saved. The website may take a few minutes to update."*

## 7. Not applicable — and why

| Service | Why not |
|---|---|
| **Payments** (Stripe, Razorpay) | **No pricing, cart, checkout or payment UI exists anywhere in the frontend.** Plots are sold offline. Do not add |
| **Auth provider** (Clerk, Auth0, Firebase, NextAuth) | No public accounts. Admin auth is **Payload's built-in auth collection** — an external provider is more moving parts, not fewer. *(Corrected 20 Sep 2026: this row previously said "against our own table". Payload owns the users collection, the hashing and the session store — D-015, D-029.)* |
| ~~**CMS SaaS** (Contentful, Sanity, Strapi)~~ | ✅ **RESOLVED — OQ-21 is closed (D-015, 18 Sep 2026).** A headless CMS **was adopted**: **Payload CMS 3, self-hosted**. Contentful/Sanity/Strapi remain rejected (Strapi was evaluated and rejected in `IMPLEMENTATION-DECISION.md`); Directus is the designated fallback. This row is retained struck-through because it recorded the position *before* the evaluation. |
| **Analytics** | Not present in the frontend. Frontend PRD defers to phase 2 |
| **Search** (Algolia, Elastic) | 5 projects, filtered client-side |
| **Redis** | ISR is the cache. Add only if measurement demands it |

## 8. Social platforms — links only

Facebook, Instagram and YouTube appear in the footer as plain URLs (`site.ts:53-57`), all bracketed and inert. **No API integration, no OAuth, no feed embedding.** They are strings in site settings. Each carries an `icon` that must validate against `IconName`.

## 9. Environment variables

> ⚠️ **SUPERSEDED — 20 Sep 2026.** This list predates D-015 and is **incomplete and partly wrong**. Most importantly it **omits `PAYLOAD_SECRET`**, which is mandatory and without which the app will not boot. It also names `SESSION_SECRET`, which **does not exist** under Payload — session signing uses `PAYLOAD_SECRET`.
>
> **The authoritative, complete list is [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) §22**, which gives every variable with its required/optional status, consumer, dev value, production source, and what breaks if it is wrong — plus a ready `.env.example`.

Key corrections to the list below, so the delta is visible without opening the plan:

| Was | Now |
|---|---|
| *(absent)* | **`PAYLOAD_SECRET`** — mandatory; signs tokens. Rotating it invalidates all sessions and API keys |
| `SESSION_SECRET` | **Does not exist.** Payload derives session/token signing from `PAYLOAD_SECRET` |
| `DATABASE_URL` | Correct — **not** `DATABASE_URI`, which appears in no official Payload doc |
| `EMAIL_API_KEY` | Replaced by SMTP settings for `@payloadcms/email-nodemailer` |
| `RATE_LIMIT_*` | **Not application config.** Payload 3 ships no rate limiting; throttling is edge/proxy configuration (D-030) |

<details>
<summary>Historical list (pre-D-015, incomplete — do not use)</summary>

```
DATABASE_URL · SESSION_SECRET · ADMIN_ORIGIN · PUBLIC_SITE_ORIGIN
STORAGE_ENDPOINT / STORAGE_BUCKET / STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY / STORAGE_PUBLIC_URL
EMAIL_API_KEY / EMAIL_FROM / SALES_NOTIFICATION_EMAIL
REVALIDATE_WEBHOOK_URL / REVALIDATE_SECRET
WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID / SMS_PROVIDER_KEY
NODE_ENV / LOG_LEVEL / RATE_LIMIT_*
```

</details>

**The frontend currently needs no environment variable at all.** Integration will add its first: the public API base URL and the revalidation secret.

## 10. Open questions

| ID | Question |
|---|---|
| OQ-1 | Do leads go to our DB, a CRM, or email only? Determines whether a CRM integration exists |
| OQ-2 | Notification channel — email, WhatsApp, SMS, or several? |
| ~~OQ-7a~~ | ~~Which **storage** provider?~~ ✅ **RESOLVED 20 Sep 2026 — Cloudinary (D-123)** |
| OQ-7b | Which **email** provider/sending domain? **Not blocking implementation** — `@payloadcms/email-nodemailer` speaks any SMTP transport, so this is an env-var choice. **Blocks launch** (deliverability, SPF/DKIM/DMARC) |
| OQ-20 | Autoresponder to the buyer? |
| ~~OQ-21~~ | ~~Build this CMS, or adopt a headless CMS SaaS?~~ ✅ **RESOLVED 18 Sep 2026 — D-015: adopt Payload CMS 3, self-hosted.** *(This row previously said "should be settled before Phase 1"; it was.)* |
