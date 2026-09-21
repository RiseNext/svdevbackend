import { z } from 'zod'

/**
 * The environment schema. This file contains the schema and NOTHING ELSE, so it
 * is importable by tests and by the drift-check script with no side effects.
 * `src/lib/env.ts` is the module that parses `process.env` and is what everything
 * else imports.
 *
 * WHY THIS EXISTS AT ALL: Payload performs no environment validation, and its own
 * documented example is `secret: process.env.PAYLOAD_SECRET || ''` — a pattern
 * that silently accepts an EMPTY secret and produces a deterministic,
 * empty-derived JWT signing key. An admin session could then be forged.
 * That single line justifies this whole module.
 *
 * MASTER-IMPLEMENTATION-PLAN.md §22.4, §15 row 29.
 */

const csv = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )

const bool = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
  .transform((v) => v === 'true' || v === '1')

/** An absolute URL with protocol + host (+ port) only — no path, no trailing slash. */
const originUrl = z
  .string()
  .url()
  .refine((u) => {
    const { pathname, search, hash } = new URL(u)
    return pathname.replace(/\/$/, '') === '' && search === '' && hash === ''
  }, 'must be protocol + domain (+ port) only — no path, no query, no fragment')

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // ---- Payload core ------------------------------------------------------
    PAYLOAD_SECRET: z.string().min(32, 'PAYLOAD_SECRET must be at least 32 characters'),
    // `serverURL` is documented as "protocol, domain and (optionally) port", so a
    // trailing path silently breaks the password-reset link ${serverURL}/admin/reset/${token}.
    NEXT_PUBLIC_SERVER_URL: originUrl,
    CORS_ORIGINS: csv,
    CSRF_ORIGINS: csv,

    // ---- Database ----------------------------------------------------------
    // NOT `DATABASE_URI` — that name has zero occurrences in the Payload 3.x docs.
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_SSL: bool.default(false),

    // ---- Storage: Cloudinary ------------------------------------------------
    // All optional here; CLOUDINARY_CLOUD_NAME is the enable switch and the
    // production superRefine below makes the set mandatory where it matters.
    // Leaving them empty is the LOCAL DEVELOPMENT path: the storage plugin goes
    // inert and Payload writes to local disk.
    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().min(1).optional(),
    // Optional override for a private CDN distribution or a custom delivery
    // hostname. Defaults to https://res.cloudinary.com/<cloud name>.
    // An ORIGIN, not a URL with a path: a trailing path segment would be
    // silently concatenated into every asset URL and 404 the entire media
    // library, which is why this is the stricter check.
    CLOUDINARY_DELIVERY_BASE_URL: originUrl.optional(),

    // ---- Email — DELIBERATELY ABSENT ---------------------------------------
    // 🔴 THE PRODUCT SENDS NO EMAIL. An enquiry is stored in Postgres and read
    // by the administrator in the Admin Panel; that IS the delivery mechanism.
    // There is no SMTP host, no from-address, no sales inbox and no notification
    // task, so there are no variables here and production needs no mail
    // credentials. Payload falls back to its own `consoleEmailAdapter` (it logs
    // and resolves), which is why removing the `email` key from the config is
    // safe rather than a crash waiting to happen.
    //
    // CONSEQUENCE, RECORDED RATHER THAN DISCOVERED LATER: the Admin Panel's
    // "Forgot password?" link cannot deliver anything. Recovery is
    // `npm run admin:reset-password` or another administrator editing the user
    // in Admin → Users. See RUNBOOK.md §7.

    // ---- Jobs + revalidation ----------------------------------------------
    // OPTIONAL EVERYWHERE, INCLUDING PRODUCTION. It only guards HTTP-triggered
    // job runs, and `jobs.access.run` FAILS CLOSED when it is unset: with no
    // secret, an HTTP run is refused outright. The deployed workers authenticate
    // as local processes, not over HTTP, so leaving this empty is the SAFER
    // configuration — requiring it would force the owner to mint a secret whose
    // only effect is to open a door nothing uses.
    CRON_SECRET: z.string().min(32).optional(),
    ENABLE_JOB_WORKERS: bool.default(false),
    REVALIDATE_WEBHOOK_URL: z.string().url().optional(),
    REVALIDATE_SECRET: z.string().min(16).optional(),

    // ---- Ops ---------------------------------------------------------------
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DISABLE_LOGGING: bool.default(false),
    PAYLOAD_SEED: bool.default(false),

    // ---- Privacy policy — NOT AN ENVIRONMENT VARIABLE ----------------------
    // 🔴 `PRIVACY_POLICY_URL` WAS REMOVED, and the removal is evidence-based
    // rather than a relaxation of a control.
    //
    // It was read in exactly one place — a boolean that made POST /api/v1/leads
    // answer 503 in production. It was NEVER rendered, NEVER served to the
    // frontend and NEVER linked from anything a visitor could see, so setting it
    // proved nothing about whether a policy existed and leaving it unset
    // disabled the one feature the site is for.
    //
    // The link a visitor actually follows is CMS DATA:
    // `site-settings.legalLinks`, rendered by svfrontend's Footer. That is the
    // real mechanism, it is editable without a redeploy, and it is a content
    // task for the owner — not a backend environment variable and not a boot
    // guard. DEPLOYMENT-CHECKLIST.md carries it as a launch item.
  })
  .superRefine((v, ctx) => {
    // ---- ALL ENVIRONMENTS ---------------------------------------------------
    // 🔴 PARTIAL STORAGE CONFIGURATION IS WORSE THAN NONE, and this is the only
    // check that catches it. `cloudinaryEnabled` keys off the cloud name alone;
    // a cloud name with a missing API secret would therefore enable the plugin
    // and fail on the FIRST UPLOAD rather than at boot. A missing cloud name
    // with the keys present is the mirror image: storage silently falls back to
    // local disk, uploads appear to work, and every file is lost on redeploy.
    const cloudinaryKeys = [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ] as const
    const cloudinarySet = cloudinaryKeys.filter((k) => v[k])
    if (cloudinarySet.length > 0 && cloudinarySet.length < cloudinaryKeys.length) {
      for (const key of cloudinaryKeys) {
        if (!v[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required once any CLOUDINARY_* variable is set — a partially configured media store fails on the first upload, not at boot`,
          })
        }
      }
    }

    // ---- PRODUCTION ONLY ----------------------------------------------------
    // These live HERE, not in the base schema. A base-schema `required` on the
    // Cloudinary keys would make local disk storage impossible; `.optional()`
    // everywhere would leave production unguarded. The split is the point.
    if (v.NODE_ENV !== 'production') return

    // 🔴 FIVE KEYS, AND EVERY ONE OF THEM BREAKS A USER-VISIBLE FEATURE IF
    // ABSENT. Nothing is required here to satisfy a checklist.
    const requiredInProd = [
      // Media MUST be in Cloudinary in production. Local disk on a container
      // host means every uploaded asset is destroyed by the next deploy.
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
      // Without these, publishing in the Admin Panel appears to work and the
      // website silently never updates until the next ISR window. The mismatch
      // case is worse than the missing case: a wrong secret is rejected with a
      // 401 that only the job log sees.
      'REVALIDATE_WEBHOOK_URL',
      'REVALIDATE_SECRET',
    ] as const

    for (const key of requiredInProd) {
      if (!v[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` })
      }
    }

    if (!v.DATABASE_SSL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_SSL'],
        message:
          'DATABASE_SSL must be true in production — credentials and lead PII would otherwise cross the network in plaintext',
      })
    }

    if (v.PAYLOAD_SEED) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYLOAD_SEED'],
        message:
          'PAYLOAD_SEED must not be set in a production environment — its absence IS the guard against an accidental seed over live edits',
      })
    }
  })

export type Env = z.infer<typeof envSchema>

/**
 * Every key the schema declares, as literals. Used by `checkEnvDrift` to diff
 * against `.env.example`, and by the env module's error reporting.
 * Kept in sync by a test.
 */
export const ENV_KEYS = [
  'NODE_ENV',
  'PAYLOAD_SECRET',
  'NEXT_PUBLIC_SERVER_URL',
  'CORS_ORIGINS',
  'CSRF_ORIGINS',
  'DATABASE_URL',
  'DATABASE_SSL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLOUDINARY_DELIVERY_BASE_URL',
  'CRON_SECRET',
  'ENABLE_JOB_WORKERS',
  'REVALIDATE_WEBHOOK_URL',
  'REVALIDATE_SECRET',
  'LOG_LEVEL',
  'DISABLE_LOGGING',
  'PAYLOAD_SEED',
] as const
