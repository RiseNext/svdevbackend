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
