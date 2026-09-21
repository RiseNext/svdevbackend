# =============================================================================
# svbackend — Payload CMS 3 + Next.js 16
#
# Based on Payload's own documented production Dockerfile, with four deliberate
# changes, each noted where it appears:
#   1. node:24-alpine, not 22 — Payload's deployment docs use node:24-alpine and
#      payload@3.90.1 declares engines.node "^18.20.2 || >=20.9.0". Node 24 is
#      the measured local runtime too, so build and run agree.
#   2. Port 3001, because svfrontend owns 3000.
#   3. /tmp/payload-uploads is created and owned by the runtime user — uploads
#      use temp files and the container runs as uid 1001, which cannot write to
#      a root-owned directory.
#   4. `npm ci --omit=dev` is NOT used for the builder stage: the build needs
#      devDependencies (typescript, @types/*), and sharp must keep its optional
#      platform binaries or the FIRST UPLOAD throws at runtime while the build
#      stays green — the classic containerised sharp failure, which Payload
#      documents nowhere.
#
# REQUIRES `output: 'standalone'` in next.config.mjs, which is set.
# =============================================================================

FROM node:24-alpine AS base

# ---------------------------------------------------------------- deps -----
FROM base AS deps
# libc6-compat: Alpine is musl, and some native modules expect glibc symbols.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
# `npm ci` requires the committed lockfile — which is why package-lock.json is
# committed, and why the package manager decision (npm) keeps the documented
# deployment path working without rewriting it.
RUN npm ci

# --------------------------------------------------------------- build -----
FROM base AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The env schema is strict in production, and `next build` sets
# NODE_ENV=production. A build stage with no real secrets must therefore supply
# syntactically valid dummies — see .env.ci.example. NEVER weaken the schema and
# NEVER add a SKIP_ENV_VALIDATION escape hatch: it would be set in production the
# first time a deploy was urgent, and the empty-secret failure mode it guards
# against would ship silently.
ARG BUILD_ENV_FILE=.env.ci
COPY ${BUILD_ENV_FILE}* ./.env

# `generate:importmap` runs INSIDE the build, before `next build` — the import
# map never regenerates at runtime or after a production build, so a stale map
# is a PRODUCTION-ONLY component-not-found crash.
RUN npm run build

# --------------------------------------------------------------- runner ----
FROM base AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
# 🔴 TZ IS LOAD-BEARING FOR THE JOB SCHEDULES — pin it, do not inherit it.
#
# Payload evaluates a task's `schedule.cron` with `new Cron(cron, {...})` and
# passes NO timezone, so croner uses the PROCESS'S LOCAL TIME. `ScheduleConfig`
# exposes no timezone option, so the container's TZ is the only lever there is.
#
# Alpine already defaults to UTC, so this changes nothing today — it stops a
# future base-image or platform change from silently moving the nightly PII
# purge and media sweep to a different hour. A test asserts the same assumption
# (tests/integration/jobs.test.ts).
#
#   45 21 * * *  -> 21:45 UTC = 03:15 IST   purgeLeadPii
#   15 22 * * *  -> 22:15 UTC = 03:45 IST   sweepDeletedMedia
# ---------------------------------------------------------------------------
ENV TZ=UTC

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Uploads use temp files (upload.useTempFiles). The runtime user must own this
# directory or every upload fails with EACCES.
RUN mkdir -p /tmp/payload-uploads && chown -R nextjs:nodejs /tmp/payload-uploads

RUN mkdir .next && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# ---------------------------------------------------------------------------
# 🔴 THE WHOLE `src` TREE, NOT JUST `src/migrations` — AND `tsconfig.json`.
#
# `node server.js` needs none of this: `next build` compiles the config into
# .next/standalone. But THREE other things run from this same image and they all
# go through the PAYLOAD CLI, which loads the TypeScript config from source:
#
#   · the pre-deploy migrate job   -> npm run migrate  (sets
#     PAYLOAD_CONFIG_PATH=src/payload.config.ts)
#   · worker-default               -> npx payload jobs:run --queue default
#   · worker-maintenance           -> npx payload jobs:run --handle-schedules
#   · and RUNBOOK.md §1 step 9     -> npm run seed  (needs src/seed + its assets)
#
# `.next/standalone` contains ONLY node_modules, package.json and server.js —
# verified, not assumed — so copying `src/migrations` alone left the image with
# no `src/payload.config.ts`. Every CLI invocation above then fails with a
# config-not-found error, which is invisible until the migrate job or a worker
# actually starts.
#
# `tsconfig.json` is required too: the config resolves `@/*` -> `./src/*` and
# `@payload-config` -> `./src/payload.config.ts` through its `paths` map.
# ---------------------------------------------------------------------------
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs

EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# READINESS, and it MUST be /healthz rather than /livez.
#
# 🔴 THIS USED TO PROBE /livez, AND THAT MADE THE HEALTH CHECK REPORT GREEN ON A
# CONTAINER THAT COULD NOT SERVE A SINGLE REQUEST. Measured, not theorised:
# built this image, ran it with NODE_ENV=production and no Cloudinary keys, and
# the container sat at "Up (healthy)" for five minutes while /healthz,
# /api/v1/projects and /api/v1/site-settings ALL returned 500.
#
# The cause is that env validation is not a boot step. `src/lib/env.ts` throws
# "Invalid environment. Refusing to boot." — but it is reached through the
# import graph of `payload.config.ts`, which Next loads LAZILY on the first
# request that needs it. /livez imports none of that by design, so it answers
# 200 forever no matter how badly the application is configured.
#
# The consequence on a platform that gates traffic on this signal is the worst
# available one: a misconfigured deploy goes green, is handed live traffic, and
# 500s every visitor — including every enquiry, which is the one thing this
# system exists to capture. Silent and total.
#
# ⚠️ THE ORIGINAL /livez ARGUMENT IS STILL CORRECT, AND IS NOT BEING DISCARDED:
# a degraded database must not cause a restart loop, because restarting the app
# does not fix Postgres. That argument is about LIVENESS. `/livez` remains
# exactly that and is still the right probe for a restart policy — see
# src/app/livez/route.ts, which says so itself. Docker's HEALTHCHECK is the
# READINESS signal, it does not restart anything on its own, and readiness is
# precisely the thing that SHOULD go red when the process cannot serve.
#
# /healthz fails for both causes that matter: a config that cannot load (500)
# and a database that cannot be reached (503).
#
# 🔶 RAILWAY DOES NOT READ THIS DIRECTIVE. Set the service's health check path
# to `/healthz` in the Railway dashboard as well — see docs/DEPLOYMENT-CHECKLIST.md.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1

CMD ["node", "server.js"]
