# RUNBOOK.md — operating the SV Developers backend

Written 20 September 2026 during the master implementation run.

> **A procedure that has never been executed is not a control.** Two entries
> below are marked **NOT YET REHEARSED** for that reason, and they are the two
> that matter most in an incident.
>
> **Updated 20 Sep 2026** for the owner's production decisions: the database is
> **Neon PostgreSQL** and media lives in **Cloudinary**. The values and the
> outstanding owner deliverables are in
> [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md); this document is the
> sequence.

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

 2. Reverse proxy: TLS termination, HTTP->HTTPS, HSTS, security headers,
    rate limits (§4 below), and the /payload-api/<slug> block rule.

 3. Secrets into the platform store, DISTINCT PER ENVIRONMENT.
    PAYLOAD_SECRET: openssl rand -hex 32

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
      EMAIL_FROM_ADDRESS="<from>" EMAIL_FROM_NAME="SV Developers" \
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
    Both are required as of migration 003: worker-maintenance owns the
    `maintenance` queue and is the only process that runs --handle-schedules,
    which is what queues purgeLeadPii, sweepDeletedMedia and
    watchdogFailedJobs. See §4b.

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

17. 🔶 Publish and link the privacy policy.  ← BLOCKS LAUNCH. STILL OPEN.
    POST /api/v1/leads REFUSES submissions in production until
    PRIVACY_POLICY_URL is set. That is deliberate and was not weakened.

    THREE separate places, all required — see PRODUCTION-CONFIG.md §5:
      a) PRIVACY_POLICY_URL in the backend environment  -> unlocks the endpoint
      b) Site Settings > Legal > Privacy policy link    -> puts it in the footer
      c) Site Settings > Content > formNote             -> the consent sentence
         beside the submit button, which still reads "[LINK TO PRIVACY POLICY]"

    The policy must name every sub-processor. That list GREW on 20 Sep 2026:
    it now includes Cloudinary (media) and Neon (database — where lead name and
    phone are stored), alongside the email provider.

18. 🔴 LIFT BOTH INDEXING BLOCKS TOGETHER by setting
    NEXT_PUBLIC_ALLOW_INDEXING=true and redeploying the frontend.
    They share one switch precisely so they cannot be half-lifted.

19. Go-live smoke: a synthetic lead flows end to end INCLUDING the notification
    landing in the sales inbox; an admin publishes and the change appears;
    alerts fire on a simulated failure (kill the worker, break SMTP, stop the DB).
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

## 4. Rate limits (reverse proxy — Payload ships NONE)

🔴 **Payload 3 provides no HTTP rate limiting.** v2's `rateLimit` died with
Express, and the official anti-abuse page offers no replacement. Every throttle
below is proxy configuration.

| Path | Limit | Response |
|---|---|---|
| `POST /api/v1/leads` | 5/min/IP | `429` + `Retry-After` |
| `POST /payload-api/users/login` | 5 failures/15 min/IP | `429` + `Retry-After` |
| `POST /payload-api/users/forgot-password` | 5/15 min/IP | `429` + `Retry-After` |
| public `GET /api/v1/**` | a generous per-IP ceiling | `429` + `Retry-After` |

🔴 **THE BUILD-ORIGIN EXEMPTION IS NOT OPTIONAL.** Under ISR, *all* public GETs
originate from ONE build machine, so a naive per-IP ceiling throttles a full site
rebuild. The build egress IP must be exempted, and the test is that a complete
`next build` of svfrontend finishes with **zero 429s**.

3/hour/phone is enforced in the application, not here — the edge cannot see the
request body.

Also block `/payload-api/<collection-slug>` from the public internet, allowing
only the admin origin. There is **no documented REST kill switch** in Payload, so
this layer is load-bearing rather than defence-in-depth.

---

## 4b. Scheduled maintenance — what runs, when, and on which worker

Added with **migration 003**. Before it, these three tasks were defined and
registered but **nothing ever ran them**: none declared a `schedule` and no hook
queued them, so `worker-maintenance` polled an empty queue indefinitely while
appearing healthy. Every test passed throughout. That is the failure this
section exists to prevent recurring.

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

## 5. Backups

100% ours — **Payload documents no backup or restore procedure at all**, while
simultaneously shipping `migrate:fresh` ("Drops all entities from the database").

| What | How | Cadence |
|---|---|---|
| PostgreSQL | **Neon PITR**, *and* `docker run --rm postgres:15 pg_dump -Fc` | nightly **and before every migration** |
| Media | Cloudinary's own durability + the 30-day supersession record | continuous |

**Both halves of the database row are required.** Neon's PITR is the fast path,
but it is a vendor feature nobody here has restored from; the `pg_dump` is the
copy that survives losing access to the vendor account entirely. `RUNBOOK.md` §6
restores the dump, not the PITR branch, for exactly that reason.

⚠️ **Media has no second copy, and that is a gap rather than a decision.**
The S3 plan had bucket versioning; Cloudinary's equivalent (backups / revision
history) is a paid add-on and is **not** assumed to be enabled. What does exist
is application-level: `supersededFilenames` records the previous key on every
replace, and `handleDelete` runs only when the Payload document is deleted —
which the delete guards refuse while an asset is in use. **If media durability
beyond Cloudinary's own is required, enabling Cloudinary backups is an owner
cost decision.**

**Consistency between database and media is documented, not automated:**
restoring Postgres to time T leaves assets uploaded after T as harmless orphans
in Cloudinary, and assets deleted after T as broken images that are *not*
recoverable unless Cloudinary backups are on.

---

## 6. Restore drill — ⚠️ NOT YET REHEARSED

**NFR-10 is not satisfied by having backups. It is satisfied by having restored
one.** This is the control everyone plans and nobody executes.

```bash
# 1. Scratch database
docker run -d --name sv-restore -e POSTGRES_PASSWORD=x -p 5434:5432 postgres:15

# 2. Restore
docker run --rm -v "$PWD:/b" --network host postgres:15 \
  pg_restore -d postgres://postgres:x@localhost:5434/postgres --clean --if-exists /b/latest.dump

# 3. Point a scratch app at it and bring the site up
DATABASE_URL=postgres://postgres:x@localhost:5434/postgres npm run start

# 4. PROVE IT: /healthz green, admin login works, a project page renders,
#    and the lead count matches expectations.
```

Record the date, the dump used, and the outcome. **An unrehearsed restore is a
hope, not a backup.**

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

### Re-send a failed lead notification

```bash
# Find it
docker compose exec cms npx payload jobs:run --queue default --limit 25
```
The task is **idempotent** via `notifiedAt`, so re-running cannot double-send.
The watchdog already re-queues failures twice with a 15-minute delay before
escalating.

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

## 8. Alerts — three that must exist on day one

Each corresponds to a failure that is otherwise **completely silent**.

| Alarm | Why it is silent without one |
|---|---|
| **A worker is dead** | `jobs.queue()` still succeeds, leads still save, the API still returns 201, and zero notifications go out with no error in the request path |
| **A `sendLeadNotification` job has `hasError: true`** | Payload ships no dead-letter queue and no alerting. "It's in the database" is not monitoring |
| **`/healthz` has been 503 for more than one interval** | The site keeps serving its last good build, so nobody notices the CMS is down until someone tries to publish |

Plus a standing check: **zero leads in 72 hours**. It is the only control that
catches a *completely* silent break, and it costs one scheduled query. The
watchdog already emits it.

🔴 **Anything email-related must alert on a SECOND CHANNEL** — the failure being
detected may be that email is broken.

---

## 9. Things that must never happen

- `migrate:fresh` or `migrate:reset` against any database that matters
- `payload migrate` against the local dev sandbox
- `admin.autoLogin` set in any non-dev environment
- `useSessions: false`
- Two instances with `ENABLE_JOB_WORKERS=true`, or two with `--handle-schedules`
  (duplicate lead notifications)
- `PAYLOAD_SEED` left set in a production environment
- A `SKIP_ENV_VALIDATION` escape hatch being added to the env schema
- Deploying with unresolved critical security failures
