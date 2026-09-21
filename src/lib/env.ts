import { envSchema, type Env } from '../schemas/env'

/**
 * Parses `process.env` ONCE, at import time, and freezes the result.
 * This is the only module anything else imports.
 *
 * 🔴 RULE 1 — read every variable as a LITERAL `process.env.NAME`, never
 * `process.env[key]`. Next.js replaces literal occurrences at build time; a
 * dynamic lookup is not substituted and returns `undefined` in any bundled
 * context. A generic `Object.keys(shape).map(k => process.env[k])` loop looks
 * cleaner and SILENTLY BREAKS `NEXT_PUBLIC_SERVER_URL`.
 *
 * 🔴 RULE 2 — this import is the FIRST import of `payload.config.ts`, so
 * validation runs before the database adapter is constructed. Otherwise the
 * first error a developer sees is a connection failure rather than
 * "DATABASE_URL is malformed".
 *
 * 🔴 RULE 3 — report names, never values. A validation error that prints the
 * malformed DATABASE_URL puts the database password into the CI log.
 */
const parsed = envSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,

  PAYLOAD_SECRET: process.env.PAYLOAD_SECRET,
  NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
  CORS_ORIGINS: process.env.CORS_ORIGINS,
  CSRF_ORIGINS: process.env.CSRF_ORIGINS,

  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_SSL: process.env.DATABASE_SSL,

  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || undefined,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || undefined,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || undefined,
  CLOUDINARY_DELIVERY_BASE_URL: process.env.CLOUDINARY_DELIVERY_BASE_URL || undefined,

  CRON_SECRET: process.env.CRON_SECRET || undefined,
  ENABLE_JOB_WORKERS: process.env.ENABLE_JOB_WORKERS,
  REVALIDATE_WEBHOOK_URL: process.env.REVALIDATE_WEBHOOK_URL || undefined,
  REVALIDATE_SECRET: process.env.REVALIDATE_SECRET || undefined,

  LOG_LEVEL: process.env.LOG_LEVEL,
  DISABLE_LOGGING: process.env.DISABLE_LOGGING,
  PAYLOAD_SEED: process.env.PAYLOAD_SEED,
})

if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    // Names and messages only — NEVER echo a value.
    // eslint-disable-next-line no-console
    console.error(`[env] ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  throw new Error('Invalid environment. Refusing to boot.')
}

export const env: Readonly<Env> = Object.freeze(parsed.data)

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'

/**
 * 🔴 THE CSRF / ADMIN-WRITE TRIPWIRE.
 *
 * MEASURED, NOT ASSUMED. Payload's CSRF protection only honours a cookie-borne
 * session when the request's `Origin` appears in `config.csrf`. When it does
 * not, Payload does not reject the request outright — it DROPS `req.user`, so
 * every `access` function sees an anonymous caller. The observable result is a
 * `403 "You are not allowed to perform this action."` on SAVE while the form
 * still loads perfectly, because `site-settings.read` is `anyone`.
 *
 * Reproduced against this config: identical authenticated request, only the
 * `Origin` header varied — in `CSRF_ORIGINS` -> 200; absent or foreign -> 403.
 *
 * This is the single most expensive misconfiguration in the deployment because
 * it is SILENT and TOTAL: it blocks every admin write in the system (globals,
 * projects, media uploads), while login, navigation and every read look healthy,
 * and nothing in the server log explains it.
 * `docs/PRODUCTION-CONFIG.md` §4 row 3 already specifies the correct value —
 * `CSRF_ORIGINS` must contain the ADMIN PANEL's OWN origin, i.e. the backend's
 * public URL, NOT the public website's.
 *
 * Deliberately a WARNING and not a boot failure: refusing to boot would convert
 * a bad env var into a total outage of a CMS whose public site is statically
 * served and entirely unaffected. The warning is emitted via `console.warn`
 * rather than the pino logger because this module is imported BEFORE the logger
 * is constructed (RULE 2 above) and must not create an import cycle.
 */
{
  const serverOrigin = (() => {
    try {
      return new URL(env.NEXT_PUBLIC_SERVER_URL).origin
    } catch {
      return undefined
    }
  })()

  const allowed = env.CSRF_ORIGINS.map((o) => {
    try {
      return new URL(o).origin
    } catch {
      return o
    }
  })

  if (serverOrigin && !allowed.includes(serverOrigin)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[env] ⚠️  CSRF_ORIGINS does not contain the Admin Panel's own origin (${serverOrigin}). ` +
        'Payload silently drops the admin session on cookie-authenticated WRITES from an ' +
        'origin it does not recognise, so EVERY admin save will fail with ' +
        '"You are not allowed to perform this action." while reads keep working. ' +
        'See docs/PRODUCTION-CONFIG.md §4 row 3.',
    )
  }
}
