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

    // ---- Storage: all optional; S3_BUCKET is the enable switch -------------
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: bool.default(false),
    CDN_BASE_URL: z.string().url().optional(),

    // ---- Email -------------------------------------------------------------
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    EMAIL_FROM_ADDRESS: z.string().email(),
    EMAIL_FROM_NAME: z.string().min(1),
    SALES_NOTIFICATION_EMAIL: z.string().email().optional(),

    // ---- Jobs + revalidation ----------------------------------------------
    CRON_SECRET: z.string().min(32).optional(),
    ENABLE_JOB_WORKERS: bool.default(false),
    REVALIDATE_WEBHOOK_URL: z.string().url().optional(),
    REVALIDATE_SECRET: z.string().min(16).optional(),

    // ---- Ops ---------------------------------------------------------------
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DISABLE_LOGGING: bool.default(false),
    PAYLOAD_SEED: bool.default(false),

    // ---- Compliance gate ---------------------------------------------------
    // OQ-24: collecting PII without a reachable privacy policy is the largest
    // compliance gap in the project (DPDP Act). POST /api/v1/leads refuses to
    // accept submissions in production until this resolves to a real URL.
    PRIVACY_POLICY_URL: z.string().url().optional(),
  })
  .superRefine((v, ctx) => {
    // Production-only requirements live HERE, not in the base schema. A base-schema
    // `required` on S3_BUCKET would make local disk storage impossible; `.optional()`
    // everywhere would leave production unguarded. The split is the point.
    if (v.NODE_ENV !== 'production') return

    const requiredInProd = [
      'S3_BUCKET',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'CDN_BASE_URL',
      // The email boot guard. With no adapter configured, Payload logs a warning
      // and the send silently APPEARS TO SUCCEED. For a lead-generation product,
      // reporting success while sending nothing is the only truly unacceptable
      // failure mode. (Plan §14.5.)
      'SMTP_HOST',
      'SMTP_PORT',
      'SALES_NOTIFICATION_EMAIL',
      'CRON_SECRET',
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
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'S3_FORCE_PATH_STYLE',
  'CDN_BASE_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM_ADDRESS',
  'EMAIL_FROM_NAME',
  'SALES_NOTIFICATION_EMAIL',
  'CRON_SECRET',
  'ENABLE_JOB_WORKERS',
  'REVALIDATE_WEBHOOK_URL',
  'REVALIDATE_SECRET',
  'LOG_LEVEL',
  'DISABLE_LOGGING',
  'PAYLOAD_SEED',
  'PRIVACY_POLICY_URL',
] as const
