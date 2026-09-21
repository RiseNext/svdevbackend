# DEPLOYMENT-CHECKLIST.md — go-live, in order

Written 21 September 2026, at the production-readiness pass.

> **This is the short list.** [`RUNBOOK.md`](./RUNBOOK.md) is the detailed
> sequence and the incident procedures; [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md)
> holds the reasoning behind each value. This file is what you tick off.
>
> 🔴 **Nothing here is a blocker because a generic checklist expects it.** Every
> item below either breaks something a visitor sees, or is a legal obligation the
> site incurs by collecting a name and a phone number.

---

## 1. What you are deploying

Four services from **one image**. Three run continuously; one runs and exits.

| Service | Command | Replicas |
|---|---|---|
| **backend / API + Admin** | `node server.js` (the image default) | 1 |
| **migrate** (pre-deploy job) | `npm run migrate` | runs once per deploy |
| **svdev-worker-default** | `npx payload jobs:run --cron "* * * * *" --queue default --limit 25` | **exactly 1** |
| **svdev-worker-maintenance** | `npx payload jobs:run --cron "*/15 * * * *" --queue maintenance --handle-schedules` | **exactly 1** |

🔴 **`--handle-schedules` appears on ONE service only.** Two of them and every
scheduled task is queued twice a night.

⚠️ **Neither worker is in the enquiry path.** An enquiry is written to Postgres
synchronously by the API service. If both workers were down for a week, no
enquiry would be lost.

---

## 2. Secrets — **USER INPUT REQUIRED**

Set these in the platform secret store. **There are no mail credentials.**

```bash
# Generate: openssl rand -hex 32
PAYLOAD_SECRET=

# Neon — POOLED endpoint for the app, DIRECT endpoint for the migrate job
DATABASE_URL=postgres://<user>:<pw>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=require
MIGRATE_DATABASE_URL=postgres://<user>:<pw>@<endpoint>.<region>.aws.neon.tech/<db>?sslmode=require
DATABASE_SSL=true

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# The final domain
NEXT_PUBLIC_SERVER_URL=https://cms.<domain>
CORS_ORIGINS=https://www.<domain>
CSRF_ORIGINS=https://cms.<domain>

# Revalidation — the secret must be BYTE-IDENTICAL to svfrontend's
REVALIDATE_WEBHOOK_URL=https://www.<domain>/api/revalidate
REVALIDATE_SECRET=
```

**Do NOT set**, and delete if present from an earlier attempt:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
`EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `SALES_NOTIFICATION_EMAIL`,
`PRIVACY_POLICY_URL`. Nothing reads them, and a leftover value makes the next
person assume mail works.

`CRON_SECRET` is **optional**. Leave it unset unless you intend to trigger job
runs over HTTP — `jobs.access.run` fails closed without it, which is safer.

---

## 3. Deploy sequence

> ### 🟢 STEPS 1, 5 AND 6 ARE ALREADY DONE — 21 September 2026
>
> The **real Neon production database exists and is fully migrated.** This was
> performed against the live database, not a rehearsal copy, and Railway must be
> pointed at **this same database** — do **not** create a second one.
>
> Verified on it directly:
>
> | Check | Result |
> |---|---|
> | Migrations applied | **4 of 4**, all batch 1 |
> | Tables | **51** |
> | Enum types / indexes | 17 / 244 |
> | Primary keys / foreign keys | 51 / 60 |
> | `leads.notified_at` (migration 004) | **absent** ✅ |
> | Schema drift | none |
> | Business data | **none** — 0 projects, 0 leads, 0 media, 0 users |
>
> ⚠️ The database was **empty before migrating** (0 tables), so nothing was
> overwritten. Migrations ran over the **direct** (non-pooled) Neon endpoint;
> the app runs over the **pooled** one.
>
> 🔴 **Step 10 no longer applies and step 9 is now a choice already made:** no
> admin account was seeded, so there are **no seeded passwords to rotate**. The
> first administrator is created by the owner through Payload's own
> `/admin/create-first-user` screen, with their own address and password. That
> screen is reachable precisely because `users` is empty, and Payload's
> `registerFirstUser` runs with `overrideAccess: true` — the `create: isAdmin`
> rule does **not** block it.

- [x] **1.** ✅ **DONE 21 Sep 2026.** Neon project created and reachable over TLS
- [x] **2.** ✅ **DONE 21 Sep 2026 — credentials present and TESTED, not assumed.**
      Verified directly against the account with the real key: `api.ping` → `ok`,
      plan **Free**, a PNG uploaded, fetched back over its `secure_url` (HTTP 200,
      `content-type: image/png`) and deleted. The probe asset was removed; nothing
      was left in the account.

> ### 🔴 **2a. CLOUDINARY WILL NOT DELIVER PDFs ON THIS ACCOUNT — USER ACTION REQUIRED**
>
> **Measured on the real account, 21 Sep 2026.** A PDF *uploads* perfectly well
> (`resource_type=image`, `format=pdf`), so the Admin Panel gives no hint of a
> problem — and then **fetching its delivery URL returns HTTP 401**.
>
> This is a Cloudinary **account setting**, not a bug in this codebase and not
> something any environment variable can change. It is off by default on Free
> plans.
>
> **Consequence if shipped as-is:** every brochure uploaded through Admin →
> Documents appears to work for the administrator and **401s for every visitor**
> who clicks it. It is invisible from inside the CMS, which is exactly why it is
> called out here rather than left to step 12.
>
> **Fix (owner, 30 seconds):** Cloudinary Console → **Settings → Security** →
> enable **"PDF and ZIP files delivery"**. Then re-run step 12 and confirm the
> PDF opens in a browser.
>
> ✅ **Images are unaffected** and were verified end to end.
- [ ] **3.** DNS: `www` and `cms`. 🔴 `cms` **must** be a subdomain of the site's
      registrable domain — an unrelated host forces `SameSite=None` and removes
      the browser's own CSRF defence
- [ ] **4.** Secrets in the platform store (§2)
- [x] **5.** ⚠️ **STILL OUTSTANDING as a DRILL.** The database was migrated from
      empty, so there was no data to dump. The `pg_dump`/restore rehearsal in
      RUNBOOK §2 is **not yet done** and remains a launch task — it proves the
      tooling works *before* anyone needs it
- [x] **6.** ✅ **DONE 21 Sep 2026.** `migrate:status` gate run first (4 pending,
      0 applied, database empty), then `npm run migrate` → **4 migrations
      applied, 51 tables**. Re-verified against the live schema
- [ ] **7.** Build and push the image; deploy the backend service
- [ ] **8.** `curl https://cms.<domain>/healthz` → `{"status":"ok"}`
- [x] **9.** ✅ **DECIDED — THE SEED WAS DELIBERATELY NOT RUN.** `npm run seed`
      creates two admin accounts on an invented `@svdevelopers.local` domain,
      writes bracketed-placeholder site settings and upserts **five placeholder
      projects with stand-in images**. None of that is SV Developers' real
      content, and a production database is the wrong place to put content that
      has to be deleted later. Real content is entered through Payload Admin.
      **Open `https://cms.<domain>/admin` and create the first administrator
      there**, using a real address and a password of at least 12 characters
      that is not in a breach list
- [ ] **10.** ~~Rotate the seeded admin passwords~~ — **N/A.** Nothing was
      seeded, so no credential this project created exists anywhere
- [ ] **11.** Deploy both workers, **one replica each**
- [ ] **12.** 🔴 Upload one real image **and** one PDF in production, then open
      their delivery URLs. This single step is the only detector for three
      failures that are otherwise invisible until a customer hits them: the
      `sharp` native-binary failure, invalid Cloudinary credentials, and a
      delivery-host mismatch with the frontend
- [ ] **13.** Point svfrontend at `NEXT_PUBLIC_API_BASE_URL`; build and deploy
- [ ] **14.** Publish a change in the admin; watch it appear **without a
      redeploy**
- [ ] **15.** §4 and §5 below
- [ ] **16.** Restore drill (RUNBOOK §6) — **not yet rehearsed**
- [ ] **17.** 🔴 `NEXT_PUBLIC_ALLOW_INDEXING=true` on the frontend and redeploy.
      This lifts **both** indexing blocks together and is the single most
      consequential launch action in the project

---

## 4. Prove the enquiry form works — end to end, on production

The whole product is this path. Do not take it on trust.

- [ ] Submit the contact form on the live site as a visitor would
- [ ] The form shows **"Thanks — we have your enquiry"** (it shows this only on a
      real `201`)
- [ ] **Admin → Enquiries** lists it, with the right name, phone, selected
      project and message
- [ ] The timestamp is correct
- [ ] Submit it **six times in one minute** → the sixth is rejected with `429`
- [ ] Sign out and open `https://cms.<domain>/payload-api/leads` → **403**, no
      enquiry data

---

## 5. Privacy policy — **USER INPUT REQUIRED · legally required**

The site collects a name and a phone number, so a reachable privacy policy is a
genuine obligation. **It is content, not configuration** — there is no
environment variable and no deploy involved.

- [ ] **Publish the policy** at a stable URL. It must name the two
      sub-processors — **Neon** (the database, which holds the enquiries) and
      **Cloudinary** (media, which holds no enquiry data) — and state the
      **90-day** retention on `ipAddress` / `userAgent`
- [ ] **Admin → Site Settings → Legal → `legalLinks`** — add the label and URL.
      This is what the footer renders on every page
- [ ] **Admin → Site Settings → Content → `formNote`** — replace the literal
      `[LINK TO PRIVACY POLICY]`. This sentence sits beside the submit button and
      is the promise made at the point of collection

🔴 **The policy must not claim the site collects an email address.** The contact
form does not ask for one and the database does not store one. The complete field
list is in `PRODUCTION-CONFIG.md` §5.

---

## 6. Other owner content — **USER INPUT REQUIRED**

None of these block taking enquiries. All are edited in the Admin Panel.

- [ ] **Site Settings → Brand → `legalName`** — the registered entity name, if
      the company is registered as something other than "SV Developers". It is
      the only source of the footer copyright line
- [ ] **Site Settings → Brand → `url`** — currently `[SITE_URL]`
- [ ] **Site Settings → Contact** — phone, email, WhatsApp, address, map URL.
      All currently `[BRACKETED]` and rendered inert by the frontend guard
- [ ] ⚠️ **WhatsApp has three consequences** the moment a real value is set:
      the homepage hero stops routing to `/contact` and opens WhatsApp directly,
      **those enquiries are then recorded nowhere**, and the contact page link
      needs fixing. Decide deliberately
- [ ] **Testimonials** — none are seeded and none were invented. The database
      refuses to publish one without consent
- [ ] **Real photography** — placeholder title cards are in place

---

## 7. After launch

- [ ] Nightly `pg_dump` scheduled, stored **off-vendor** (RUNBOOK §5.1)
- [ ] 🔴 **Keep the original photography.** Cloudinary is the only copy of
      uploaded media and its backup add-on is paid. A folder of source images
      closes this gap for free — no code can do it for you (RUNBOOK §5.2)
- [ ] Alert: `/healthz` 503 for more than one interval
- [ ] Alert: a worker has not logged in over 30 minutes
- [ ] Record the restore drill in RUNBOOK §6's table
