# PRODUCTION-CONFIG.md — what must be set before go-live

Written 20 September 2026, at the owner-decision pass that followed implementation.

> **Status vocabulary, used strictly throughout this document.**
>
> | Term | Means |
> |---|---|
> | **IMPLEMENTED** | Code exists and is tested. Nothing further is required of engineering |
> | **CONFIGURED** | A value is set and working in at least one environment |
> | **AWAITING OWNER** | A business decision or a deliverable only the owner can supply |
> | **AWAITING INFRA** | Provisioning, an account, or a vendor setting — not a code change |
>
> A row is never marked IMPLEMENTED because it *should* work. Every claim here
> corresponds to something that was run.

---

## 1. Decisions taken on 20 September 2026

| # | Decision | Recorded as |
|---|---|---|
| 1 | Public company name is **SV Developers** | `DECISIONS.md` D-122 — closes OQ-6 |
| 2 | Production media storage is **Cloudinary** | D-123 — closes OQ-7a, supersedes D-112 |
| 3 | Production database is **Neon PostgreSQL** | D-124 |
| 4 | The final **domain is deliberately not chosen yet** | D-125 — D-109 stays INTERIM |
| 5 | The **privacy-policy URL is still unknown** and the lead-capture safeguard stays | Unchanged — OQ-24 remains open |
| 6 | **No testimonials are seeded or invented** | Unchanged — OQ-23 remains open |

---

## 2. Neon PostgreSQL — **AWAITING INFRA**

Nothing in the application changes for Neon. It is standard PostgreSQL 15+ over
TLS, which is what `@payloadcms/db-postgres` already speaks.

```bash
# The running application — POOLED endpoint, no DDL grant.
DATABASE_URL=postgres://<user>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=require
DATABASE_SSL=true

# The migrate job ONLY — DIRECT endpoint, DDL grant.
MIGRATE_DATABASE_URL=postgres://<migrate_user>:<password>@<endpoint>.<region>.aws.neon.tech/<db>?sslmode=require
```

### The three things that are specific to Neon

**1. 🔴 Use the DIRECT endpoint for migrations, the POOLED endpoint for the app.**
Neon's pooler is PgBouncer in transaction mode. Payload runs migrations inside a
transaction and issues DDL; session-level state and some DDL do not survive
transaction pooling. `docker-compose.prod.yml` already separates these into two
variables for an unrelated reason — the migrate role has DDL and the app role
does not — so this costs nothing extra. The two reasons reinforce each other.

**2. 🔴 `DATABASE_SSL=true` is mandatory and the env schema enforces it.**
Boot fails in production without it, with the message *"credentials and lead PII
would otherwise cross the network in plaintext"*. Neon requires TLS anyway, so
this can only be got wrong by pointing production at something that is not Neon.

**3. ⚠️ Scale-to-zero cold starts are real.** Neon suspends an idle compute and
resumes on the next connection, which takes a few hundred milliseconds to a few
seconds. That is invisible to the public website — it is static/ISR and does not
touch the database per visitor — but it will show up as a slow first `/healthz`
after a quiet period, and as a slow first admin page load. **Set the health-check
`start_period` and any uptime-monitor timeout with that in mind**, or the monitor
will page on a cold start. Consider disabling auto-suspend on the production
branch if the alerting noise is not worth the saving.

**4. Pool sizing.** `payload.config.ts` sets `max: 10` per instance. Neon imposes
its own connection ceiling per compute size, and the pooled endpoint raises it
substantially. `max × (cms replicas + 2 workers)` must stay under whatever the
chosen compute allows — arithmetic that is ours, because Payload publishes no
pool-sizing guidance at all.

### What does NOT change

`idType: 'uuid'`, `disableCreateDatabase` (already automatic in production — Neon
does not grant `CREATE DATABASE` to an ordinary role), the migration chain, and
the backup procedure. Neon has its own PITR; `RUNBOOK.md` §5 still requires a
`pg_dump` before every migration, because a vendor feature you have never
restored from is not a backup (§6).

---

## 3. Cloudinary — **IMPLEMENTED (code) · AWAITING INFRA (account)**

### What was built

Payload ships **no Cloudinary adapter** — the official set is Vercel Blob, S3,
Azure, GCS, Uploadthing and R2 — and Cloudinary exposes no S3-compatible
endpoint, so `@payloadcms/storage-s3` could not be repointed. The documented
route for any other provider is `@payloadcms/plugin-cloud-storage` plus an
adapter, and that is what `src/media/cloudinary.ts` is.

### Environment variables

```bash
CLOUDINARY_CLOUD_NAME=<cloud name>        # also the enable switch
CLOUDINARY_API_KEY=<key>
CLOUDINARY_API_SECRET=<secret>            # platform secret store, never the repo
CLOUDINARY_DELIVERY_BASE_URL=             # OPTIONAL — see below
```

- **Setting none of them** is the local-development path: the storage plugin goes
  inert and Payload writes to local disk.
- **Setting some but not all** now fails boot, deliberately. A cloud name without
  a secret enables the plugin and fails on the *first upload*; keys without a
  cloud name silently fall back to local disk and lose every file on redeploy.
  Both are invisible failures, so they are refused at startup instead.
- `CLOUDINARY_DELIVERY_BASE_URL` is only for a Cloudinary **private CDN
  distribution** (`https://<cloud_name>-res.cloudinary.com`) or a **custom
  delivery hostname**, both of which are "available only for Cloudinary's
  Advanced plan and higher". Leave it empty otherwise.

### How assets are stored

| | Images (`media`) | PDFs (`documents`) |
|---|---|---|
| Cloudinary resource type | `image` | `raw` |
| `public_id` | `media/<uuid>` — **no extension** | `documents/<uuid>.pdf` — **with extension** |
| Delivery URL | `<base>/image/upload/media/<uuid>.<ext>` | `<base>/raw/upload/documents/<uuid>.pdf` |

The extension rule is not a style choice. Cloudinary's upload reference states it
verbatim: *"The public ID value for images and videos shouldn't include a file
extension. Include the file extension for `raw` files only."* Inverting it makes
the stored id and the delivery URL disagree, which surfaces as a 404 on every
asset.

PDFs use `raw` for a second, independent reason: under the `image` type
Cloudinary rasterises PDFs, and PDF delivery there is subject to an account-level
restriction that is **disabled by default**. `raw` returns the exact bytes and is
not subject to it — so there is no Cloudinary account setting to remember.

**No version component appears in any URL.** Cloudinary's docs make the version
optional and required only "when you overwrite an existing asset". This system
never overwrites: every key is a fresh UUID and a replace writes a *new* key. The
adapter passes `overwrite: false` so Cloudinary enforces that rather than us
merely intending it.

### 🔴 Every media-security control is unchanged

They all run in Payload hooks **before** storage is reached, so the provider swap
could not weaken them, and none was touched:

magic-byte sniffing · hard SVG rejection (four layers) · declared-vs-actual MIME
mismatch · 10 MB image / 25 MB PDF ceilings · the >10 000 px decompression-bomb
guard · EXIF stripping via a sharp re-encode · UUID storage keys · the in-use
delete guard · the 30-day supersession record · no public upload endpoint.

### ⚠️ One control that genuinely changed — recorded, not glossed

`MEDIA-MANAGEMENT.md` §10 requires `Content-Disposition: attachment` on PDFs.
That was an S3 **bucket-policy** line. Cloudinary sets its own delivery headers
for `raw` assets and they are not configurable per object from here.

**What the control was for is still satisfied:** uploaded content is served from
an origin that is not the application origin, so it cannot script against it —
and `res.cloudinary.com` is a *different registrable domain*, which is a stronger
separation than the `media.<domain>` subdomain originally planned. The
disposition header itself is **not claimed as satisfied**.

### Account setup — AWAITING INFRA

1. Create the Cloudinary product environment. Note the cloud name.
2. Generate an API key/secret pair. Store both in the platform secret store.
3. **Use a separate cloud (or at minimum separate keys) per environment.** A
   staging upload landing in the production media library is indistinguishable
   from an admin mistake.
4. Confirm the delivery host and put it in svfrontend's
   `NEXT_PUBLIC_MEDIA_BASE_URL` (see §4).
5. Run the go-live upload check — `RUNBOOK.md` §1 step 12. **Credential validity
   is never checked at boot**, deliberately: an `api.ping()` there would turn a
   Cloudinary outage into "the CMS will not start", locking admins out of a
   system whose public site is static and entirely unaffected.

---

## 4. The domain — **AWAITING OWNER**

**No domain has been chosen, and none has been invented.** Every place that will
need it is listed here so that choosing it is a configuration exercise rather
than a search.

`D-109` still stands on shape: **`cms` must be a subdomain of the public site's
registrable domain.** An unrelated host forces `SameSite=None` on admin cookies,
which removes the browser's own CSRF defence and makes the `csrf` allow-list
load-bearing on its own. That is an architecture requirement, not a preference.

### Every place the final domain is needed

| # | Where | Value | Consequence if wrong |
|---|---|---|---|
| 1 | svbackend env `NEXT_PUBLIC_SERVER_URL` | `https://cms.<domain>` | Password-reset links point at the wrong host |
| 2 | svbackend env `CORS_ORIGINS` | `https://www.<domain>` | Browser requests from the site are refused |
| 3 | svbackend env `CSRF_ORIGINS` | `https://cms.<domain>` | Admin writes are rejected |
| 4 | svbackend env `REVALIDATE_WEBHOOK_URL` | `https://www.<domain>/api/revalidate` | Publishing appears to do nothing |
| 5 | svfrontend env `NEXT_PUBLIC_SITE_URL` | `https://www.<domain>` | **Every canonical, OG url and all 12 sitemap entries are wrong** |
| 6 | svfrontend env `NEXT_PUBLIC_API_BASE_URL` | `https://cms.<domain>/api/v1` | The site cannot build |
| 7 | svfrontend env `NEXT_PUBLIC_MEDIA_BASE_URL` | Cloudinary delivery host — **not** a subdomain of `<domain>` unless a custom hostname is bought | Every `next/image` call site throws "hostname is not configured" |
| 8 | **CMS → Site Settings → Brand → `url`** | `https://www.<domain>` | Currently `[SITE_URL]`. **This is admin-editable, not an env var** |
| 9 | DNS | `www`, `cms` records + TLS certificates | — |
| 10 | Reverse proxy | server names, HSTS, the `/payload-api/<slug>` block | — |
| 11 | Email sending domain | SPF/DKIM/DMARC for `EMAIL_FROM_ADDRESS` (OQ-7b) | Lead notifications land in spam |

> Row 8 is the one that is **not** an environment variable. `site-settings.url`
> is CMS data an administrator edits in the Admin Panel. It feeds the public
> `site-settings` API response. Rows 1–7 are deployment configuration.
>
> ⚠️ Row 7 is a change from the original plan: `media.<domain>` is replaced by
> Cloudinary's own delivery host. See D-125.

---

## 5. Privacy policy — **AWAITING OWNER · BLOCKS LAUNCH**

**The final URL is not known and has not been invented.** No placeholder that
could pass for a real URL has been introduced anywhere.

### The safeguard, which is unchanged and was not weakened

```ts
// src/lib/env.ts
export const leadCaptureAllowed = !isProduction || Boolean(env.PRIVACY_POLICY_URL)
```

`POST /api/v1/leads` **refuses submissions in production** while
`PRIVACY_POLICY_URL` is unset. In development the gate is open so the endpoint
can be built and tested. This is deliberate and is the only thing standing
between the site and collecting name + phone with no privacy notice, which is a
DPDP Act exposure.

### The exact remaining requirement

1. **Publish a privacy policy** at a stable, reachable URL.
2. It must name **every sub-processor**. As of this pass that is, at minimum:
   the email/SMTP provider (OQ-7b, still open), **Cloudinary** (media), and
   **Neon** (database — where lead name and phone are stored).
   *Both of the last two are new as of today and did not exist when OQ-24 was
   first written.*
3. Set `PRIVACY_POLICY_URL` in the backend environment.
4. Set the matching **CMS → Site Settings → Legal → Privacy policy** link, which
   is currently `[PRIVACY_URL]` and rendered inert by the frontend's placeholder
   guard.
5. Update **CMS → Site Settings → Content → `formNote`**, which still contains
   the literal token `[LINK TO PRIVACY POLICY]` and is the consent artefact
   rendered next to the submit button.

Steps 3, 4 and 5 are three different places and all three are required: the env
var unlocks the endpoint, the legal link puts the policy in the footer, and the
form note is the promise made at the point of collection.

---

## 6. Status of everything else

| Area | Status | Note |
|---|---|---|
| Company name in the CMS | **CONFIGURED** | `site-settings.name` = "SV Developers", editable in Admin |
| Registered legal entity name | **AWAITING OWNER** | `site-settings.legalName` mirrors the trading name because none was supplied. It is the only source of the footer copyright line |
| Logo | **IMPLEMENTED** | `site-settings.logo` now actually renders. Until one is uploaded the committed emblem is used |
| Testimonials | **AWAITING OWNER** | None seeded, none invented. Entered through Admin. The DB CHECK constraint refuses to publish one without consent |
| `[BRACKETED]` values | **AWAITING OWNER** | OQ-22. Phone, email, WhatsApp, address, map URL, social links, site URL |
| Rate limiting | **AWAITING INFRA** | Payload 3 ships none. Reverse-proxy configuration — `RUNBOOK.md` §4 |
| Restore drill | **AWAITING INFRA** | Documented, **never rehearsed**. `RUNBOOK.md` §6 |
| `PAYLOAD_SECRET` rotation | **AWAITING INFRA** | Documented, **never rehearsed**. `RUNBOOK.md` §7 |
| Indexing block | **IMPLEMENTED** | Two blocks, one switch — `NEXT_PUBLIC_ALLOW_INDEXING`. Lift at launch |
| Real photography | **AWAITING OWNER** | Placeholder SVG title cards. Blocks removing `dangerouslyAllowSVG` from svfrontend |
| Hosting | **AWAITING INFRA** | `Dockerfile` + `docker-compose.prod.yml` ready; nothing provisioned |
