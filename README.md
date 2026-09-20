# svbackend — SV Developers CMS and public API

Payload CMS 3 on PostgreSQL, in its own Next.js application. It is the source of
the content the public website displays, and it captures enquiries.

Specifications live in [`docs/`](./docs). Start with
[`docs/AI-CONTEXT.md`](./docs/AI-CONTEXT.md), then
[`docs/MASTER-IMPLEMENTATION-PLAN.md`](./docs/MASTER-IMPLEMENTATION-PLAN.md).
What was actually built, measured rather than assumed, is in
[`docs/PHASE-1-GATE-REPORT.md`](./docs/PHASE-1-GATE-REPORT.md).

**What must be set before go-live — and what is still waiting on the owner — is
in [`docs/PRODUCTION-CONFIG.md`](./docs/PRODUCTION-CONFIG.md).** Production runs
on **Neon PostgreSQL** and **Cloudinary**; the domain and the privacy-policy URL
are deliberately not chosen yet.

---

## The house rules

These are not style preferences. Each one exists because there is a concrete way
this system fails without it.

### 🔴 1. The local database is a disposable sandbox. Never migrate it.

Drizzle `push` keeps the local schema in sync automatically in development.

```bash
npm run sandbox:reset     # docker compose down -v && up -d
```

**`payload migrate` is NEVER run against the local dev database.** The docs are
explicit that `push` and migrations "are not meant to be used interchangeably";
mixing them produces a migration history that matches no real schema, which then
fails in CI — or worse, does the wrong thing there.

### 🔴 2. `migrate:fresh` and `migrate:reset` appear in no script, ever.

They sit one keystroke from the harmless `migrate:status` and would drop the
leads table. Reset the sandbox with `npm run sandbox:reset` instead.

### 🔴 3. `npm`, not `pnpm`.

Every command in the official Payload docs is written `pnpm payload …`. Here:

| Docs say | Run instead |
|---|---|
| `pnpm payload migrate` | `npm run migrate` |
| `pnpm payload generate:types` | `npm run generate:types` |
| `pnpm payload <anything>` | `npm run payload -- <anything>` |

`package-lock.json` is **committed** — the official Dockerfile's `npm ci` branch
needs it. yarn 1.x is explicitly unsupported by Payload; pnpm is not installed.

### 🔴 4. `payload.delete()` HARD DELETES. Archiving is an update.

Measured on `payload@3.90.1`, and it **contradicts the documentation**:

```
payload.delete({ collection, id })          -> the row is GONE
payload.update({ id, data: { deletedAt } }) -> soft delete, recoverable
```

The Trash docs' soft-delete promise is scoped to the **Admin List View** and says
so nowhere. `leads` and `projects` therefore carry `beforeDelete` guards that
refuse a hard delete outright — absolutely for leads, which are commercial
records. Use `archiveDocument()` / `restoreDocument()` from
`src/hooks/hardDeleteGuard.ts`.

### 🔴 5. No bare `payload.find` in a public file.

Every public read goes through `publicFind()`, which forces `overrideAccess:
false`, `user: undefined` and a hard-coded published-only `where`. The Local API
defaults `overrideAccess` to **true**, and a plain `find()` does **not** filter
out drafts. One omission in one handler returns unpublished DTCP/RERA approval
claims.

### 🔴 6. Never spread a document into a public response.

`src/serializers/` builds output **key by key**. `select` restricts what is
*queried*, not what is *emitted* — "a selected-but-empty field still returns as
`null`" — and `null` is not assignable to the frontend's `T | undefined` under
`strict`. Absent optionals are **omitted**, never `null`, never `[]`.

---

## First run

```bash
# 1. Dependencies (Node >= 20.9.0; 24.x is what this was built on)
npm ci

# 2. Environment
cp .env.example .env
#    Generate a secret:  openssl rand -hex 32
#    Boot FAILS if PAYLOAD_SECRET is absent or under 32 characters — deliberately.

# 3. Database. That is the ONLY local service — production media lives in
#    Cloudinary, which has no self-hostable equivalent. Leave the CLOUDINARY_*
#    variables empty and uploads fall back to local disk at ./media.
docker compose up -d

# 4. Start. Drizzle `push` syncs the schema on first boot.
npm run dev                            # http://localhost:3001

# 5. Seed: 2 admins, site settings, the 5 real projects, 9 media assets.
#    The generated admin passwords are printed ONCE to the console.
PAYLOAD_SEED=true npm run seed

# 6. Sign in
open http://localhost:3001/admin
```

The seed is **idempotent** — run it twice and you still have 5 projects, not 10.

## Tests

```bash
docker compose -f docker-compose.test.yml up -d        # Postgres on 5433
DATABASE_URL=postgres://postgres:test@localhost:5433/sv_test npm run migrate
npm test
```

The test database is **migrated, never pushed** — which makes the migration
chain itself a tested artefact, and removes the push/migrate mixing hazard
entirely.

```bash
npm test                 # everything
npm run test:unit        # pure functions, no database
npm run typecheck
npm run build            # needs production-shaped env — see .env.ci.example
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on 3001, schema auto-synced by `push` |
| `npm run seed` | Idempotent seed. Gated on `PAYLOAD_SEED=true` |
| `npm run seed:rasterise` | SVG → PNG for the placeholder art. Output is **committed** |
| `npm run migrate:status` | Read-only. **Always run this before `migrate`** |
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:down` | Roll back the last **batch** |
| `npm run migrate:create <name>` | Generate a migration. **Read it before committing** |
| `npm run generate:types` | Regenerate `payload-types.ts`. CI diff-checks it |
| `npm run generate:db-schema` | Emit the Drizzle schema. **Read it before writing a migration** |
| `npm run jobs:run` | Drain the default queue once |
| `npm run jobs:loop` | Run the default queue on a cron |
| `npm run check:drift` | Icon enum · public contract · `.env.example` — all three cross-file guards |
| `npm run check:cms` | Proves every collection and the global are reachable and editable by an admin, by **executing** the access functions rather than reading the config |
| `npm run sandbox:reset` | Destroy and recreate the local database |

## Layout

```
src/
  payload.config.ts     the single config
  collections/          users · media · documents · projects · leads
                        testimonials · faqs · statistics · audit-log
  globals/              site-settings — the only global
  access/               the ENTIRE authorisation model: four functions
  hooks/                audit · revalidate · uploadGuard · mediaGuards
                        hardDeleteGuard · slugLock · leadHooks · authEvents
  media/                storage (the plugin wiring) · cloudinary (the adapter)
                        mediaUrl (the ONE definition of a public media URL)
  serializers/          the public contract. `...doc` spread is BANNED here
  lib/                  publicFind · definePublicEndpoint · errors · env · icons
  app/(payload)/        VENDOR CODE — generated, never edited
  app/(public)/api/v1/  our public surface — 7 routes
  app/healthz|livez/    probes, deliberately OUTSIDE /api
  endpoints/            EMPTY BY DECISION — see below
```

**`src/endpoints/` is empty on purpose.** Payload config endpoints are *always*
mounted under `routes.api`, and our contract needs `/api/v1/**` plus `/healthz`
outside `/api`. Both mechanisms work; **mixing them is the failure mode**, so one
is chosen and enforced.

## The public API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/projects` | Cards, published, in admin order. No pagination — there are five |
| `GET` | `/api/v1/projects/{slug}` | Full record. Unpublished → **404, never 403** |
| `GET` | `/api/v1/site-settings` | `[BRACKETED]` values round-trip verbatim |
| `GET` | `/api/v1/testimonials` | Published **and consented** only |
| `GET` | `/api/v1/faqs` | Ordered |
| `GET` | `/api/v1/statistics` | Ordered. `value` is authored text |
| `POST` | `/api/v1/leads` | The only public write in the system |
| `GET` | `/healthz` · `/livez` | Readiness (touches the DB) · liveness (does not) |

Payload's own generated REST lives at `/payload-api/**` and is additionally
blocked at the edge. **GraphQL is disabled** and its route files are not present,
so the 404 is structural.

## Deployment

See [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) for the full sequence, rollback,
restore and the break-glass procedures.
