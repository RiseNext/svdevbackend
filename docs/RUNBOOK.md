# RUNBOOK.md — operating the SV Developers backend

Written 20 September 2026 during the master implementation run.

> **A procedure that has never been executed is not a control.** Entries below
> marked **NOT YET REHEARSED** are exactly that, and they are the ones that
> matter most in an incident.
>
> **Updated 20 Sep 2026** for the owner's production decisions: the database is
> **Neon PostgreSQL** and media lives in **Cloudinary**.
>
> **Updated 21 Sep 2026 — the production-readiness pass.** Three things in this
> document changed materially, and each removed an instruction that was either
> impossible to follow or protecting nothing:
>
> 1. **There is no email anywhere in this product.** SMTP setup, the sales
>    notification inbox, the "break SMTP" smoke test and the dead-letter story
>    built around a mail outage are all gone. An enquiry is delivered by being
>    written to Postgres and read in **Admin → Enquiries**. §7 carries the
>    replacement for the one capability that genuinely depended on mail —
>    administrator password recovery.
> 2. **Rate limits moved from the reverse proxy into the application.** §4 used
>    to be a table of nginx rules. The deployment target is Railway, which has no
>    reverse proxy to write them in, so "configure it at the edge" was an
>    instruction nobody could carry out. §4 now documents what the code enforces.
> 3. **The privacy-policy launch blocker is a content task, not an environment
>    variable.** `PRIVACY_POLICY_URL` was removed; see step 17 and
>    [`DEPLOYMENT-CHECKLIST.md`](./DEPLOYMENT-CHECKLIST.md).
>
> [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md) holds the values and the
> outstanding owner deliverables; this document is the sequence.

---

## 1. First-time go-live

Each step gates the next. Do not skip ahead.

```
 1. Provision: container host + region (audience is Indian — keep app and
    database in the SAME region), a NEON PostgreSQL project, a CLOUDINARY
    product environment, DNS for www / cms, TLS certs.

    🔴 `cms` MUST be a subdomain of the public site's registrable domain.
       An unrelated host forces SameSite=None, which removes the browser's own
       CSRF defence and makes the csrf allow-list load-bearing on its own.

    ⚠️ There is NO `media` DNS record any more. Media is delivered from
       Cloudinary's own host, which is a different registrable domain — a
       stronger origin separation than the planned `media.<domain>`, at the
       cost of a branded URL. See PRODUCTION-CONFIG.md §3 and D-125.

    🔶 THE DOMAIN ITSELF IS STILL AN OWNER DELIVERABLE. Every place that
       needs it is enumerated in PRODUCTION-CONFIG.md §4 — eleven of them.

 2. TLS + HTTPS redirect. On Railway this is the platform's own edge and there
    is NOTHING TO CONFIGURE — which is also why the rate limits and the
    /payload-api access control live in the application instead (§4).

 3. Secrets into the platform store, DISTINCT PER ENVIRONMENT.
    PAYLOAD_SECRET: openssl rand -hex 32
    There are NO mail credentials to store.

 4. Database roles: the running app role has NO DDL; a separate migrate role
    HAS DDL. Set disableCreateDatabase (automatic when NODE_ENV=production).

    🔴 NEON: the app uses the POOLED endpoint, the migrate job uses the DIRECT
       one. Neon's pooler is PgBouncer in transaction mode, and Payload runs
       migrations in a transaction with DDL. The two endpoints map onto the two
       roles that already exist, so this adds no new variable.

 5. pg_dump a baseline of the EMPTY database — it proves the tooling works
    before anyone needs it.
       docker run --rm postgres:15 pg_dump -Fc "$DATABASE_URL" > baseline.dump
    (`psql` is not on PATH on the build machine; all client tooling goes
     through Docker.)

 6. npm run migrate:status      <- READ-ONLY GATE. Read what would run.
    npm run migrate             <- as the SEPARATE pre-deploy job

 7. Build and push the image. `generate:importmap` runs INSIDE the build.

 8. Deploy the cms container.  curl https://cms.<domain>/healthz  -> {"status":"ok"}

 9. SEED — 🔴 FROM YOUR WORKSTATION, NOT FROM THE PRODUCTION CONTAINER.

    This step previously read `PAYLOAD_SEED=true npm run seed` as though it ran
    inside the deployed container. IT CANNOT, and the reason is a guard working
    exactly as designed:
      · the env schema FAILS BOOT when NODE_ENV=production and PAYLOAD_SEED is
        set ("its absence IS the guard against seeding over live edits");
      · `next build` bakes NODE_ENV=production INTO the image, so a runtime
        `-e NODE_ENV=development` has no effect (measured, not assumed);
      · so the seed refuses before its own PAYLOAD_SEED check is even reached.

    Run it from a workstation checkout instead, pointed at the Neon DIRECT
    endpoint. NODE_ENV is not production there, so the guard does not fire —
    and the production boot guard stays fully intact.

      cd svbackend
      PAYLOAD_SEED=true \
      DATABASE_URL="<NEON_DIRECT_URL>" DATABASE_SSL=true \
      PAYLOAD_SECRET="<PAYLOAD_SECRET>" \
      NEXT_PUBLIC_SERVER_URL="https://cms.<domain>" \
      CORS_ORIGINS="https://www.<domain>" CSRF_ORIGINS="https://cms.<domain>" \
      CLOUDINARY_CLOUD_NAME="<name>" CLOUDINARY_API_KEY="<key>" \
      CLOUDINARY_API_SECRET="<secret>" \
        npm run seed

    -> 2 admins, site-settings, 5 projects, 9 media assets.

    🔴 The CLOUDINARY_* values are NOT optional here. Omit them and the nine
    seeded assets land on the workstation's local disk instead of Cloudinary,
    and production shows broken images with no error anywhere.

    The seed is an UPSERT on natural keys: running it twice produces 5
    projects, not 10. It prints the two generated admin passwords ONCE.

    ALTERNATIVE: skip the seed entirely and let Payload's first-user screen
    create the initial admin, then enter content through the Admin Panel.

10. Rotate the seeded admin passwords. Confirm no default credentials remain.

11. Deploy worker-default and worker-maintenance, ONE REPLICA EACH.
    worker-maintenance owns the `maintenance` queue and is the ONLY process
    that runs --handle-schedules, which is what queues purgeLeadPii,
    sweepDeletedMedia and watchdogFailedJobs. See §4b.

    ⚠️ NEITHER WORKER IS IN THE ENQUIRY PATH. An enquiry is written to Postgres
       synchronously by the API container and read in Admin -> Enquiries. If
       both workers were down for a week, not one enquiry would be lost —
       revalidation retries would stop and the nightly maintenance would not
       run. Deploy them, alert on them, but do not treat them as a launch
       blocker for taking enquiries.

12. 🔴 UPLOAD ONE REAL IMAGE IN PRODUCTION, THEN OPEN ITS DELIVERY URL.
    This one step is the ONLY detector for THREE failures that are all invisible
    until it runs:
      a) the sharp native-binary failure — build green, first upload throws;
      b) invalid Cloudinary credentials — NOT checked at boot, deliberately, so
         that a Cloudinary outage cannot stop the CMS from starting;
      c) a delivery-host mismatch between CLOUDINARY_DELIVERY_BASE_URL and
         svfrontend's NEXT_PUBLIC_MEDIA_BASE_URL, which throws at every
         next/image call site rather than degrading.
    Upload a PDF too: it takes the Cloudinary `raw` path, which is separate code.

13. Point svfrontend at NEXT_PUBLIC_API_BASE_URL; build and deploy it.

14. Verify revalidation end to end: publish a change, watch it appear WITHOUT
    a redeploy.

15. Execute the security checklist with EVIDENCE PER ITEM. A tick is not
    evidence.

16. Perform a RESTORE DRILL (§6). NFR-10 is not satisfied by having backups.

17. 🔶 Publish and link the privacy policy.  ← A CONTENT TASK, NOT A CODE GATE.

    ⚠️ CHANGED 21 Sep 2026, AND THE CHANGE IS EVIDENCE-BASED. This step used to
    say "POST /api/v1/leads REFUSES submissions in production until
    PRIVACY_POLICY_URL is set". That environment variable has been REMOVED. It
    was read in exactly one place — a boolean that returned 503 — and it was
    never rendered, never served to the frontend and never linked from anything
    a visitor could see. Setting it proved nothing about whether a policy
    existed; leaving it unset switched off the only feature this site is for.

    The website DOES collect a name and a phone number, so a reachable privacy
    policy is a genuine obligation. It is discharged in TWO places, both CMS
    content, both editable without a redeploy:

      a) Site Settings > Legal > legalLinks  -> the footer link every page shows
      b) Site Settings > Content > formNote  -> the consent sentence beside the
         submit button, which today still reads "[LINK TO PRIVACY POLICY]"

    The policy must name every sub-processor. As of 21 Sep 2026 that list is
    exactly TWO: Cloudinary (media) and Neon (the database, where the enquiry
    name and phone are stored). The email provider left the list because there
    is no email provider.

    Tracked as a launch item in DEPLOYMENT-CHECKLIST.md §5.

18. 🔴 LIFT BOTH INDEXING BLOCKS TOGETHER by setting
    NEXT_PUBLIC_ALLOW_INDEXING=true and redeploying the frontend.
    They share one switch precisely so they cannot be half-lifted.

19. Go-live smoke, on the real production site:
      a) submit the contact form as a visitor would
      b) confirm the enquiry appears in Admin -> Enquiries with the right
         name, phone, selected project and message
      c) publish a change in the admin and watch it appear on the site
      d) stop worker-maintenance and confirm the liveness alert fires
      e) submit the form six times in a minute and confirm the sixth is 429
```

**Steady-state deploy** is steps 6–8 plus 11, serialised, with a backup first.

---

## 2. Deploy

```bash
docker run --rm postgres:15 pg_dump -Fc "$DATABASE_URL" > pre-deploy-$(date +%F).dump
npm run migrate:status          # read-only gate
npm run migrate                 # separate job, DDL role
# build + push image, deploy cms
curl -fsS https://cms.<domain>/healthz
# 🔴 RESTART BOTH WORKERS, or they keep running the old code
docker compose -f docker-compose.prod.yml up -d --force-recreate worker-default worker-maintenance
```

⚠️ **Serialise deploys.** Concurrent-deploy migration races are undocumented —
no migration locking or advisory-lock behaviour is published anywhere.

---

## 3. Rollback

The distinction that governs everything here is **additive vs destructive**.

| Situation | Action |
|---|---|
| **The migrate step failed** | The deploy was already rejected and the previous release is still serving. Triage; do not retry blindly. |
| **New release misbehaving, last migration was ADDITIVE** (new nullable column, new table) | Redeploy the previous image and **leave the schema forward**. Old code ignores new nullable columns. ~2 minutes. This is the normal case and should be the design target. |
| **Last migration was DESTRUCTIVE** (dropped/renamed column, narrowed type) | A code rollback is **NOT safe**. `migrate:down` rolls back a *batch*, and an auto-generated `down` restores **structure, not data**. Choose: restore from the pre-migration backup and accept losing writes since, **or fix forward**. |

**Default posture: FIX FORWARD.** Restoring from backup is for data loss, not
for a bad release.

Use expand-contract on every schema change — add the new shape, dual-write,
migrate readers, drop the old shape in a *later* release — so at every point the
previous code version still works against the current schema.

---

## 4. Abuse limits and public exposure — **in the application**

> ⚠️ **REWRITTEN 21 Sep 2026.** This section used to be a table of reverse-proxy
> rules. **The deployment target is Railway, which gives you no reverse proxy to
> write them in** — it terminates TLS and routes straight to the container.
> "Configure it at the edge" was therefore an instruction nobody could follow,
> and the public enquiry form was the endpoint left unprotected by it. The
> controls below are now code in this repository, and they are tested.

### 4.1 What the code enforces

🔴 **Payload 3 provides no HTTP rate limiting.** v2's `rateLimit` died with
Express and the official anti-abuse page offers no replacement — so this is ours.
`src/lib/rateLimit.ts` is a fixed-window counter over a `Map`, about forty lines.

| Control | Limit | Where | Response |
|---|---|---|---|
| `POST /api/v1/leads` per IP | **5 / minute** | `src/lib/rateLimit.ts`, charged first thing in the handler | `429` + `Retry-After` |
| `POST /api/v1/leads` per phone | **3 / hour** | same, keyed on the **E.164-normalised** number | `429` + `Retry-After` |
| Admin login | **5 failures → 15 min lock** | Payload `auth.maxLoginAttempts` / `lockTime` | account lock |
| Forgot-password | **1 / 15 s** | Payload `auth.forgotPassword.minRequestInterval` | throttled |
| Enquiry body size | **64 KB** | `readJsonBody()` | `413` |
| Upload size | **25 MB** | `upload.limits.fileSize` | `413` |

**Why two layers on the enquiry form.** The per-IP limit stops a script hammering
from one host. It cannot see a residential proxy pool handing an attacker a fresh
address per request — but that pool does not hand them a fresh phone number, so
the per-phone limit is the one that actually bounds sustained abuse. The runbook
always said "3/hour/phone must be enforced in the application, the edge cannot
see the request body"; it now is.

🔴 **The rate-limit key is the RIGHTMOST `X-Forwarded-For` hop, not the
leftmost.** The leftmost entry is the conventional "original client" position and
is what gets stored on the lead — but a client can prepend to that header, so
keying a limit on it would let an attacker rotate the value for an unlimited
budget while the limiter still looked present in the code. The rightmost entry is
appended by the proxy directly in front and cannot be forged. There is a test for
exactly this bypass.

⚠️ **This assumes ONE trusted hop in front of the app** — true of Railway.
**If a CDN is ever put in front, revisit `rateLimitKey()` in the leads route**, or
every visitor will share the CDN's egress IP and be throttled as one client.

⚠️ **The counters are in-process, therefore per-instance.** Exact for the
documented deployment of **one API replica**. A second replica doubles the
effective ceiling — it degrades, it does not fail open. The `Idempotency-Key`
cache in the same route has the identical constraint; **if a second replica is
ever added, move both to Postgres together.**

### 4.2 `/payload-api/*` — why there is no kill switch

The previous report flagged that unauthenticated `/payload-api/*` access returns
403 but "there is no REST kill switch". **A kill switch was investigated and
deliberately not built.** Three findings, all asserted in
`tests/integration/accessControl.test.ts`:

1. **It would break the Admin Panel.** Payload's admin UI is a client-side app
   that talks to `routes.api` — the exact prefix a switch would disable. It would
   need an authenticated carve-out, which is what the access functions already
   are.
2. **The private collections are already closed** — `leads`, `users`,
   `audit-log` and `payload-jobs` all return **nothing** to an anonymous caller,
   by `access.read`, in the application. A canary enquiry is planted and the
   assertion is that it does not come back.
3. **What remains readable is public on purpose.** `projects`, `testimonials`,
   `faqs` and `statistics` return only `_status: published` rows to an anonymous
   caller, because the access function returns a `Where` that Payload ANDs into
   every query — including `?where[_status][equals]=draft`. `media` and
   `site-settings` are public because the website renders them on every page.
   The exposure is **a second shape of already-public content, not a data leak**.

🔴 **What was removed rather than left as a comforting comment:** the `leads`
collection used to claim a fourth guarantee — "the edge blocks
`/payload-api/leads` from the public internet". That was never true of Railway.
It is gone, and the three real guarantees are now tested.

---

## 4b. Scheduled maintenance — what runs, when, and on which worker

Added with **migration 003**. Before it, these three tasks were defined and
registered but **nothing ever ran them**: none declared a `schedule` and no hook
queued them, so `worker-maintenance` polled an empty queue indefinitely while
appearing healthy. Every test passed throughout. That is the failure this
section exists to prevent recurring.

> **There are FOUR tasks, not five.** `sendLeadNotification` was removed with
> the email subsystem on 21 Sep 2026. `revalidatePaths` is the only task on the
> `default` queue, and it is queued by a hook **only when a direct revalidation
> call has already failed** — so on a healthy system `worker-default` is
> genuinely idle most of the time. That is expected, not a symptom.

| Task | Cron | Cadence | Why that cadence |
|---|---|---|---|
| `purgeLeadPii` | `45 21 * * *` | Daily, 21:45 UTC (03:15 IST) | Retention is **90 days**, so the deadline moves once a day. Finer buys nothing; coarser leaves records past the window |
| `sweepDeletedMedia` | `15 22 * * *` | Daily, 22:15 UTC (03:45 IST) | Grace period is **30 days** — same reasoning. Deliberately **30 min after** the purge: both run on one worker and this one issues real Cloudinary deletes |
| `watchdogFailedJobs` | `*/15 * * * *` | Every 15 min | Its handler re-queues failed jobs with `waitUntil = +15 min`. A longer cadence leaves them sitting past their own wait; a shorter one re-examines jobs still deliberately waiting |

All three are scheduled onto the **`maintenance`** queue. Nothing is scheduled
onto `default` — that would let `worker-default` and the schedule handler fight
over the same job.

**🔴 Timezone.** Payload builds the cron with croner and passes **no timezone**,
so it resolves in the **process's local time**. The Dockerfile pins `ENV TZ=UTC`
so the times above mean what they say; a test asserts that pin.

**🔴 Only ONE process may run `--handle-schedules`.** The docs are explicit that
multiple servers handling schedules each queue their own copy. That process is
`worker-maintenance`, at exactly one replica. Payload's own
`defaultBeforeSchedule` refuses to schedule a task already running or already
scheduled in future — proven by test, which is what makes a worker restart safe.

**⚠️ The `autoRun` fallback does NOT cover these.** `autoRun` schedules only for
a matching queue name, and its single entry polls `default`. If worker
containers are ever dropped in favour of `autoRun`, add a `maintenance` entry or
set `allQueues: true`, or the PII purge, media sweep and dead-letter watchdog
silently stop.

**Verifying it works after deploy:**

```bash
# In the worker-maintenance logs, within 15 minutes of start:
#   expect watchdogFailedJobs to run
# In the database:
docker run --rm postgres:15 psql "$DATABASE_URL" -c \
  "select task_slug, queue, completed_at, has_error
     from payload_jobs where queue='maintenance' order by created_at desc limit 10;"

# lastScheduledRun bookkeeping (empty until the first scheduled run):
docker run --rm postgres:15 psql "$DATABASE_URL" -c \
  "select stats from payload_jobs_stats;"
```

---

## 5. Backups — what is protected, and what genuinely is not

100% ours — **Payload documents no backup or restore procedure at all**, while
simultaneously shipping `migrate:fresh` ("Drops all entities from the database").

**Scale check before anything else.** The thing that must survive is the `leads`
table: a few thousand rows of name, phone, project and message, growing by tens a
month. Everything else in the database (projects, settings, testimonials) is
content an administrator can retype from the live site in an afternoon. That is
why what follows is two commands and a drill, not a disaster-recovery
architecture.

### 5.1 The database

| Layer | How | Cadence | What it protects against |
|---|---|---|---|
| **Neon PITR** | on by default on the Neon plan; no setup in this repo | continuous | fat-fingered delete, bad migration — restore to a timestamp |
| **`pg_dump` to a file you hold** | command below | **nightly, and before every migration** | losing access to the Neon account itself |

```bash
# The nightly dump. -Fc is the custom format pg_restore needs.
# psql/pg_dump are NOT on PATH on the build machine; all client tooling is Docker.
docker run --rm postgres:15 pg_dump -Fc "$DATABASE_URL" > sv-$(date +%F).dump
```

**Both rows are required, and they cover different failures.** PITR is the fast
path but it is a vendor feature inside the vendor's account. The dump is the copy
that survives losing that account. §6 restores **the dump**, not a PITR branch,
for exactly that reason.

**Keep the dumps somewhere that is not the same vendor** — a company Google Drive
folder is entirely adequate at this scale. Keep 30 daily and 6 monthly. A dump
nobody can find is not a backup.

### 5.2 Uploaded media — **Cloudinary is the only copy**

🔴 **STATED PLAINLY BECAUSE IT IS THE REAL GAP: there is no second copy of the
images and PDFs.** Cloudinary stores them durably — that is a storage-durability
guarantee, and it is not the same thing as a backup. It does not protect against
*somebody deleting the wrong asset*, and Cloudinary's revision-history / backup
feature is a **paid add-on that is not assumed to be enabled**.

What does exist, and what it is worth:

- `supersededFilenames` records the previous Cloudinary key on every **replace**,
  and the sweep only removes it after **30 days** — so a wrong replace is
  recoverable for a month.
- The delete guards refuse to remove an asset that is still attached to a
  project, and a soft delete waits **30 days** before the object is really gone.

So the honest position is: **a wrong delete or a wrong replace is recoverable for
30 days; a Cloudinary account loss is not.**

**The owner decision, stated once so it can actually be made:** enabling
Cloudinary's backup add-on is a cost decision. If it is not enabled, the
practical mitigation at this scale is to **keep the original photography**. It
already exists — every image on this site came from somewhere before it was
uploaded. A folder of source images in the same Drive as the dumps closes this
gap for free, and no code can do it for you.

### 5.3 Database ↔ media consistency

**Documented, not automated.** Restoring Postgres to time T leaves:

- assets uploaded after T → harmless orphans in Cloudinary, invisible to the site
- assets deleted after T → **broken images**, recoverable only within the 30-day
  window above

At this scale the fix is to look at the site after a restore and re-upload
anything blank. There is no reconciliation script and building one would cost
more than it saves.

---

## 6. Restore drill — ⚠️ NOT YET REHEARSED

**Having backups is not the control. Having restored one is.** This is the step
everyone plans and nobody executes — run it once, now, while nothing is wrong.

🔴 **Restore into a SCRATCH database. Never into production.** Every command
below points at `localhost:5434`, a throwaway container. `pg_restore --clean`
drops objects before recreating them; pointed at the wrong URL it is
unrecoverable.

```bash
# 1. A scratch Postgres, on a port nothing else uses.
docker run -d --name sv-restore -e POSTGRES_PASSWORD=x -p 5434:5432 postgres:15

# 2. Restore the most recent dump into it.
docker run --rm -v "$PWD:/b" --network host postgres:15 \
  pg_restore -d postgres://postgres:x@localhost:5434/postgres \
  --clean --if-exists /b/sv-YYYY-MM-DD.dump

# 3. Count what matters, directly. This alone is most of the value.
docker run --rm --network host postgres:15 \
  psql postgres://postgres:x@localhost:5434/postgres -c \
  "select count(*) as enquiries, max(created_at) as newest from leads;"

# 4. Point a local app at it and look at the CMS with your own eyes.
DATABASE_URL=postgres://postgres:x@localhost:5434/postgres \
DATABASE_SSL=false npm run dev
#    -> /healthz is green
#    -> you can sign in at /admin
#    -> Admin -> Enquiries lists the enquiries from step 3
#    -> a project page renders

# 5. Tear the scratch database down.
docker rm -f sv-restore
```

**Record the date, which dump was used, and the outcome** — in this file, below
this line. An unrehearsed restore is a hope, not a backup.

| Date | Dump restored | Enquiry count | Outcome |
|---|---|---|---|
| _not yet run_ | — | — | — |

---

## 7. Break-glass

### Revoke a user's sessions

```
Set isActive: false  AND  change that user's password as an admin.
```

**Both steps.** `isActive` closes the authorisation door on the next request
(every access function routes through `isAdmin`), but it does **not** end an
existing session, because `isActive` is our field and not Payload's. Changing the
password as an admin *is* documented to end **all** of that user's sessions.

⚠️ Any script or hook that updates a user must **thread the acting user** — "a
Local API update that runs without an authenticated user has no session to keep,
so it ends all of the user's sessions." Otherwise it silently logs that person
out of everything.

### An administrator is locked out — password recovery

🔴 **The "Forgot password?" link in the Admin Panel cannot deliver anything.**
This product sends no email, so there is no mailbox for a reset token to reach.
Payload exposes no flag to hide the link, so it is still there and still does
nothing. That is a known, accepted trade — and this is its replacement.

**Preferred: another administrator resets it.** Admin → Users → the account →
set a new password. Takes ten seconds. This is why the seed creates **two**
accounts.

**If nobody can sign in at all**, from a workstation checkout:

```bash
cd svbackend
DATABASE_URL="<NEON_DIRECT_URL>" DATABASE_SSL=true \
PAYLOAD_SECRET="<PAYLOAD_SECRET>" \
NEXT_PUBLIC_SERVER_URL="https://cms.<domain>" \
CORS_ORIGINS="https://www.<domain>" CSRF_ORIGINS="https://cms.<domain>" \
  npm run admin:reset-password -- someone@example.com
```

It prints a strong generated password **once**. Sign in and change it.

⚠️ **Changing a password ENDS ALL OF THAT USER'S SESSIONS** — which is exactly
what break-glass recovery should do. The script refuses to create an account: a
typo'd email fails loudly and lists the accounts that do exist, rather than
silently minting a new administrator.

### A publish did not appear on the website

The direct revalidation call failed and a `revalidatePaths` retry was queued.

```bash
# Is anything stuck?
docker run --rm postgres:15 psql "$DATABASE_URL" -c \
  "select task_slug, has_error, total_tried, wait_until from payload_jobs
     where queue='default' order by created_at desc limit 10;"

# Drain it by hand.
docker compose exec cms npx payload jobs:run --queue default --limit 25
```

A `401`/`403` in the job error means **`REVALIDATE_SECRET` does not match the
frontend's** — the one failure that is otherwise invisible, because content
appears to publish and the site silently never updates. The task cancels itself
rather than retrying, precisely so this shows up as a stopped job rather than as
noise. Fix the secret on both sides and redeploy.

Worst case, the frontend's own `revalidate: 3600` floor means the change appears
within an hour regardless.

### `PAYLOAD_SECRET` rotation — ⚠️ NOT YET REHEARSED

🔴 **BREAK-GLASS ONLY. This is never the session-revocation mechanism** — use
the password change above.

Payload documents the *consequences* of rotation but publishes **no procedure**.

```
1. Announce: every admin will be signed out.
2. Replace PAYLOAD_SECRET in the platform store.
3. Redeploy cms AND both workers.
4. 🔴 REGENERATE ALL API KEYS — documented verbatim: "If you change your
   PAYLOAD_SECRET, you will need to regenerate your API keys."
   (No API keys exist today — `useAPIKey` is not enabled — which is exactly
   why this should be rehearsed NOW, while the step is free.)
5. Verify: an admin can sign in; a lead submits end to end.
```

**Rehearse this in staging before it is ever needed in production.**

---

## 8. Alerts — two that must exist on day one, and one standing check

> **This list SHRANK on 21 Sep 2026, and the reason is structural rather than a
> lowering of standards.** Two of the three original alarms existed because an
> enquiry travelled through a queue and a mail provider on its way to the
> business, so a dead worker or a broken SMTP host meant **lost leads with
> nothing in the request path to report it**. An enquiry is now stored
> synchronously and read from the database, so that failure mode has nowhere
> left to occur. The alarms that remain are the ones that still map to something
> a visitor or the owner would notice.

| Alarm | Severity | Why it is silent without one |
|---|---|---|
| **`/healthz` has been 503 for more than one interval** | 🔴 the site still serves its last good build, so nobody notices the CMS is down until someone tries to publish — or until an enquiry fails | the visitor sees the form fail |
| **A worker has not logged in > 30 min** | 🔶 `worker-maintenance` polls every 15 min; silence past that means the PII purge and media sweep have stopped, which accrues quietly for weeks | nothing breaks today |

**Standing check — zero enquiries in 72 hours.** The only control that catches a
*completely* silent break in the form-to-database path (a CORS misconfiguration,
a frontend deploy pointing at the wrong API base URL). It costs one query and the
watchdog already emits it as a `warn` line. On a site with real traffic, three
quiet days is worth a human submitting the form once to check.

🔴 **Every alert channel here is LOG-BASED, deliberately.** The watchdog escalates
to a `fatal` log line rather than notifying anyone directly. Adding an email or
webhook notifier purely so the system can alert about itself would reintroduce
the notification subsystem this project removed — and it is the platform's job
(Railway log drains, or whatever replaces it) to turn a `fatal` line into a page.

---

## 9. Things that must never happen

- `migrate:fresh` or `migrate:reset` against any database that matters
- `payload migrate` against the local dev sandbox
- `admin.autoLogin` set in any non-dev environment
- `useSessions: false`
- Two instances with `ENABLE_JOB_WORKERS=true`, or two with `--handle-schedules`
  (every scheduled task runs twice)
- `PAYLOAD_SEED` left set in a production environment
- A `SKIP_ENV_VALIDATION` escape hatch being added to the env schema
- Deploying with unresolved critical security failures
- Running `pg_restore --clean` against anything but a scratch database
- Reintroducing an email dependency without deciding to. If a notification is
  ever genuinely wanted, it is a new feature with its own decision — not a
  template default. `tests/integration/accessControl.test.ts` fails if a
  nodemailer adapter reappears, so the choice has to be deliberate.
