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

# A readiness probe the orchestrator can use directly. /livez is deliberately
# DB-free: a degraded database must not cause a restart loop, because restarting
# the app does not fix Postgres.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/livez || exit 1

CMD ["node", "server.js"]
