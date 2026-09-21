// 🔴 THE ENV IMPORT IS THE FIRST IMPORT, BEFORE ANYTHING PAYLOAD.
// Validation must run before the database adapter is constructed, or the first
// error a developer sees is a connection failure rather than "DATABASE_URL is
// malformed". See src/lib/env.ts.
import { env, isProduction } from './lib/env'

import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { en } from '@payloadcms/translations/languages/en'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { AuditLog } from './collections/AuditLog'
import { Documents } from './collections/Documents'
import { Faqs } from './collections/Faqs'
import { Leads } from './collections/Leads'
import { Media } from './collections/Media'
import { Projects } from './collections/Projects'
import { Statistics } from './collections/Statistics'
import { Testimonials } from './collections/Testimonials'
import { Users } from './collections/Users'
import { SiteSettings } from './globals/SiteSettings'
import { tasks } from './jobs'
import { logger } from './lib/logger'
import { storagePlugin } from './media/storage'
import { DEFAULT_QUEUE, MAX_DOCUMENT_BYTES } from './lib/constants'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  // -------------------------------------------------------------------------
  // SECRET — never the docs' own `process.env.PAYLOAD_SECRET || ''` pattern.
  // That silently accepts an EMPTY secret and yields a deterministic,
  // empty-derived JWT signing key: an admin session could be forged. The env
  // module has already failed the boot if this is absent or under 32 chars.
  // -------------------------------------------------------------------------
  secret: env.PAYLOAD_SECRET,
  serverURL: env.NEXT_PUBLIC_SERVER_URL,
  cookiePrefix: 'sv',
  telemetry: false,
  // "Enable to expose more detailed error information." Never in production.
  debug: !isProduction,

  // -------------------------------------------------------------------------
  // ROUTES — moved off /api so Payload's generated REST cannot collide with our
  // hand-written contract. Six of our public paths ARE collection slugs
  // (projects, testimonials, faqs, statistics, leads, media), so at the default
  // `/api` the raw document shape would sit at the same URL as the contract.
  //
  // ⚠️ Changing root-level routes REQUIRES a matching change to the project
  // structure: the vendor handler lives at src/app/(payload)/payload-api/.
  // -------------------------------------------------------------------------
  routes: {
    admin: '/admin',
    api: '/payload-api',
  },

  // -------------------------------------------------------------------------
  // GRAPHQL — DISABLED. We hand-write REST; GraphQL is pure attack surface, a
  // second document shape to secure, and nothing consumes it. The vendor
  // graphql route files are NOT present in this repo either, so the 404 is
  // structural rather than dependent on Payload's internal behaviour.
  // -------------------------------------------------------------------------
  graphQL: { disable: true },

  // Bound the blast radius of a hostile or careless query.
  maxDepth: 3,
  defaultDepth: 1,
  defaultMaxTextLength: 20000,

  // Exactly two origins, never `*`. NOTE: this does NOT cover our custom
  // endpoints — "custom endpoints don't handle CORS headers in responses" — so
  // definePublicEndpoint() attaches them itself.
  cors: { origins: [...env.CORS_ORIGINS], headers: [] },
  csrf: [...env.CSRF_ORIGINS],

  // -------------------------------------------------------------------------
  upload: {
    // ⚠️ ONE APPLICATION-WIDE VALUE. The 10MB-image / 25MB-PDF split is NOT
    // expressible in config, so this is the HIGHER (PDF) ceiling and the tighter
    // image ceiling is enforced in the upload guard. A hook-thrown rejection
    // surfaces as a 4xx, not the 413 this config-level limit produces — that
    // difference is recorded rather than papered over.
    limits: { fileSize: MAX_DOCUMENT_BYTES },
    // Documented to return HTTP 413.
    abortOnLimit: true,
    useTempFiles: true,
    tempFileDir: path.resolve(dirname, '../.tmp/uploads'),
    // Never echoes a path or a bucket name.
    responseOnLimit: 'That file is too large.',
    // `safeFileNames` / `preserveExtension` deliberately NOT set: they are
    // sanitisers, not anonymisers, and still leak the original filename into the
    // public URL. UUID keys supersede them.
  },

  // REQUIRED in buildConfig for imageSizes, crop and focal point — and we use it
  // directly for dimension extraction, the decompression-bomb guard and EXIF
  // stripping.
  sharp,

  // Pre-instantiated pino. NEVER Pino `transport` — documented to fail with
  // "unable to determine transport target" under ESM/bundling, and Payload is
  // fully ESM.
  logger,

  // -------------------------------------------------------------------------
  admin: {
    // "The Admin Panel can only be used by a single auth-enabled Collection."
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: {
      titleSuffix: '— SV Developers',
      description: 'Manage the SV Developers website.',
    },
    // 🔴 `autoLogin` is set in NO environment, ever.
  },

  // Content localization is DELIBERATELY NOT ENABLED (D-107, OQ-25).
  // English only; Telugu deferred as settled project scope. The COST of the
  // deferral, recorded here so its absence is never read as an oversight:
  // enabling `localization` after data exists puts every localized field in a
  // SEPARATE `_locales` TABLE PER COLLECTION — a physical schema change across a
  // model that already produces ~18 tables for `projects` alone. It is not a
  // config flip; it is a data migration.
  //
  // This is CONTENT localization. Admin-panel i18n below is a different, free,
  // reversible thing — narrowed to English purely for bundle size.
  //
  // ⚠️ MEASURED, NOT ASSUMED: passing `supportedLanguages: {}` here does NOT
  // mean "English only" — it means NO languages, and `generate:types` then dies
  // with "Language undefined not supported". The language must be supplied
  // explicitly.
  i18n: { supportedLanguages: { en }, fallbackLanguage: 'en' },

  collections: [
    // Order matters for readability only; Payload resolves relations by slug.
    Users,
    Media,
    Documents,
    Projects,
    Leads,
    Testimonials,
    Faqs,
    Statistics,
    AuditLog,
  ],

  globals: [SiteSettings],

  // `src/endpoints/` stays EMPTY by decision. Payload config endpoints are
  // ALWAYS mounted under `routes.api`, and our contract specifies /api/v1/**
  // plus /healthz OUTSIDE /api. Mixing the two mechanisms is the failure mode.
  endpoints: [],

  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },

  // -------------------------------------------------------------------------
  db: postgresAdapter({
    pool: {
      connectionString: env.DATABASE_URL,
      // node-postgres options, NOT Payload options. Payload publishes NO
      // pool-sizing guidance at all, so `max x replicas` must be kept under the
      // server's max_connections by our own arithmetic.
      max: 10,
      idleTimeoutMillis: 30_000,
      ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
    },
    // Adapter-global and effectively irreversible after migration 001.
    idType: 'uuid',
    // Explicit; never rely on the undocumented "best effort" search.
    migrationDir: path.resolve(dirname, 'migrations'),
    // ⚠️ DEFAULTS TO FALSE, i.e. Payload attempts CREATE DATABASE at boot. On a
    // managed Postgres where the app role lacks that grant, it throws on startup.
    disableCreateDatabase: isProduction,
    generateSchemaOutputFile: path.resolve(dirname, 'payload-generated.schema.ts'),
    // `push` is left at its DEFAULT (enabled in development only).
    // 🔴 The local dev database is a disposable sandbox managed by push. Every
    // other environment is migrations-only. `payload migrate` is NEVER run
    // against the local dev database — mixing the two produces a migration
    // history that matches no real schema.
    // `schemaName` NOT set: it is marked "(experimental)". Stay on `public`.
    // `transactionOptions` NOT set: transactions are ON by default on Postgres
    //   and we want them — the audit row and the change it records must commit
    //   or roll back together.
  }),

  // -------------------------------------------------------------------------
  // EMAIL. `nodemailerAdapter` speaks any Nodemailer transport, which turns the
  // unresolved provider question (OQ-7b) into an ENVIRONMENT VARIABLE rather
  // than an architecture decision.
  //
  // In dev/staging it is called with NO ARGUMENTS: "if you pass nothing to
  // nodemailerAdapter, it will use the ethereal.email service … logs the
  // ethereal.email details to console on startup." Mail is captured, viewable at
  // a printed URL, and NEVER delivered to a real inbox — which is simultaneously
  // the documented satisfier of "staging must not send real notifications", at
  // zero custom code.
  // -------------------------------------------------------------------------
  email:
    isProduction && env.SMTP_HOST
      ? nodemailerAdapter({
          defaultFromAddress: env.EMAIL_FROM_ADDRESS,
          defaultFromName: env.EMAIL_FROM_NAME,
          transportOptions: {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            // The docs defer to Nodemailer on when this should and should not
            // be true, so it stays an env var rather than a hardcoded value.
            secure: env.SMTP_SECURE,
            ...(env.SMTP_USER && env.SMTP_PASS
              ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
              : {}),
          },
        })
      : nodemailerAdapter(),

  // -------------------------------------------------------------------------
  jobs: {
    tasks,
    // FIFO — the oldest lead is notified first.
    processingOrder: 'createdAt',
    access: {
      run: ({ req }) => {
        if (req.user) return true
        const secret = env.CRON_SECRET
        // Fail CLOSED. With no secret set, an HTTP-triggered run is refused.
        // The bin-script workers authenticate as local processes, not over HTTP,
        // so they keep running — which is what makes this safe to close.
        if (!secret) return false
        return req.headers.get('authorization') === `Bearer ${secret}`
      },
    },
    // The `autoRun` FALLBACK, for when a second container is refused on cost.
    // Gated so only ONE instance ever runs jobs: `true` on two instances
    // produces DUPLICATE lead notifications.
    // ⚠️ Not used in development: HMR disrupts cron schedules, and a developer
    // relying on autoRun sees notifications stop after the first file save.
    //
    // 🔶 SCOPE LIMIT, RECORDED RATHER THAN SILENTLY ACCEPTED. `autoRun` does
    // schedule `schedule`-bearing tasks by default — but only "given the queue
    // name is the same". This entry polls DEFAULT_QUEUE, while all three
    // maintenance schedules target MAINTENANCE_QUEUE, so THIS FALLBACK DOES NOT
    // RUN THEM. That is correct for the intended deployment, where
    // `worker-maintenance` owns that queue and `--handle-schedules`.
    // If this fallback is ever adopted INSTEAD of worker containers, add a
    // second entry for MAINTENANCE_QUEUE (or set `allQueues: true` on one entry
    // and delete the other) — otherwise the PII purge, the media sweep and the
    // dead-letter watchdog silently never run.
    ...(env.ENABLE_JOB_WORKERS
      ? {
          autoRun: [{ cron: '* * * * *', queue: DEFAULT_QUEUE, limit: 25 }],
          shouldAutoRun: async () => env.ENABLE_JOB_WORKERS,
        }
      : {}),
    jobsCollectionOverrides: ({ defaultJobsCollection }) => ({
      ...defaultJobsCollection,
      admin: {
        ...defaultJobsCollection.admin,
        hidden: false,
        group: 'System',
        defaultColumns: ['taskSlug', 'createdAt', 'completedAt', 'hasError', 'totalTried'],
      },
      access: {
        ...defaultJobsCollection.access,
        // READ-ONLY for trusted administrators, exactly as the docs advise:
        // "Enabling raw collection access can expose job data and
        // execution-control fields. Prefer read-only access."
        read: ({ req }) => Boolean(req.user),
        create: () => false,
        update: () => false,
        delete: () => false,
      },
    }),
    // ⚠️ MEASURED, AND IT CONTRADICTS THE PLAN'S ASSUMPTION:
    // completed job rows are DELETED BY DEFAULT. After running the worker, the
    // `payload_jobs` rows for successfully-completed `sendLeadNotification`
    // tasks were gone, while `leads.notifiedAt` was correctly stamped.
    //
    // The plan said to leave this unset "because we WANT retention — a
    // successfully sent lead notification is an operational record". Leaving it
    // unset produces the OPPOSITE. Set explicitly so the operational record
    // actually survives.
    //
    // The watchdog is unaffected either way: a FAILED job is not complete, so
    // `hasError: true` rows are retained regardless.
    deleteJobOnComplete: false,
    // `enableConcurrencyControl` is also unset: it is a v3-only flag that adds
    // an indexed column and may require a migration, for a workload of tens of
    // jobs per month.
  },

  plugins: [storagePlugin],
})
