# RUNBOOK.md — operating the SV Developers backend

Written 20 September 2026 during the master implementation run.

> **A procedure that has never been executed is not a control.** Two entries
> below are marked **NOT YET REHEARSED** for that reason, and they are the two
> that matter most in an incident.

---

## 1. First-time go-live

Each step gates the next. Do not skip ahead.

```
 1. Provision: container host + region (audience is Indian — keep app and
    database in the SAME region), managed PostgreSQL 15+ with TLS and PITR,
    an S3-compatible bucket, a CDN, DNS for www / cms / media, TLS certs.

    🔴 `cms` MUST be a subdomain of the public site's registrable domain.
       An unrelated host forces SameSite=None, which removes the browser's own
       CSRF defence and makes the csrf allow-list load-bearing on its own.

 2. Reverse proxy: TLS termination, HTTP->HTTPS, HSTS, security headers,
    rate limits (§4 below), and the /payload-api/<slug> block rule.

 3. Secrets into the platform store, DISTINCT PER ENVIRONMENT.
    PAYLOAD_SECRET: openssl rand -hex 32

 4. Database roles: the running app role has NO DDL; a separate migrate role
    HAS DDL. Set disableCreateDatabase (automatic when NODE_ENV=production).

 5. pg_dump a baseline of the EMPTY database — it proves the tooling works
    before anyone needs it.
       docker run --rm postgres:15 pg_dump -Fc "$DATABASE_URL" > baseline.dump
    (`psql` is not on PATH on the build machine; all client tooling goes
     through Docker.)

 6. npm run migrate:status      <- READ-ONLY GATE. Read what would run.
    npm run migrate             <- as the SEPARATE pre-deploy job

 7. Build and push the image. `generate:importmap` runs INSIDE the build.

 8. Deploy the cms container.  curl https://cms.<domain>/healthz  -> {"status":"ok"}

 9. PAYLOAD_SEED=true npm run seed
    -> 2 admins, site-settings, 5 projects, 9 media assets.
    THEN UNSET PAYLOAD_SEED. Its absence IS the guard.

10. Rotate the seeded admin passwords. Confirm no default credentials remain.

11. Deploy worker-default and worker-maintenance, ONE REPLICA EACH.

12. 🔴 UPLOAD ONE REAL IMAGE IN PRODUCTION.
    This is the ONLY reliable detector for the sharp native-binary failure:
    build green, first upload throws. Payload documents nothing about it.

13. Point svfrontend at NEXT_PUBLIC_API_BASE_URL; build and deploy it.

14. Verify revalidation end to end: publish a change, watch it appear WITHOUT
    a redeploy.

15. Execute the security checklist with EVIDENCE PER ITEM. A tick is not
    evidence.

16. Perform a RESTORE DRILL (§6). NFR-10 is not satisfied by having backups.

17. 🔶 Publish and link the privacy policy.  ← BLOCKS LAUNCH.
    POST /api/v1/leads REFUSES submissions in production until
    PRIVACY_POLICY_URL is set. That is deliberate.

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

## 5. Backups

100% ours — **Payload documents no backup or restore procedure at all**, while
simultaneously shipping `migrate:fresh` ("Drops all entities from the database").

| What | How | Cadence |
|---|---|---|
| PostgreSQL | managed PITR, or `docker run --rm postgres:15 pg_dump -Fc` | nightly **and before every migration** |
| Media | S3 bucket versioning + lifecycle rules | continuous |

**Consistency between the two is documented, not automated:** restoring Postgres
to time T leaves objects uploaded after T as harmless orphans, and objects
deleted after T as broken images recoverable from bucket versioning.

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
