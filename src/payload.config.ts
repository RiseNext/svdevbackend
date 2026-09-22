// 🔴 THE ENV IMPORT IS THE FIRST IMPORT, BEFORE ANYTHING PAYLOAD.
// Validation must run before the database adapter is constructed, or the first
// error a developer sees is a connection failure rather than "DATABASE_URL is
// malformed". See src/lib/env.ts.
import { env, isProduction } from './lib/env'

import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
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
import { Videos } from './collections/Videos'
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
    // -----------------------------------------------------------------------
    // 🔴 ABSOLUTE, AND OUTSIDE THE APPLICATION DIRECTORY. NOT A TIDY-UP.
    //
    // This was `path.resolve(dirname, '../.tmp/uploads')`, which resolves INSIDE
    // the app directory — `/app/.tmp/uploads` in the container. Every production
    // upload then died with:
    //
    //   EACCES: permission denied, mkdir '/app/.tmp/uploads'
    //   POST /payload-api/media -> 500
    //
    // WHY IT CANNOT WORK THERE: the runtime image does `WORKDIR /app` and then
    // `USER nextjs` (uid 1001). Only `.next` and the COPYed trees are chowned to
    // that user — the `/app` DIRECTORY ITSELF is created by WORKDIR and stays
    // root-owned at mode 755, so an unprivileged process cannot create a new
    // subdirectory in it. Payload's multipart handler calls
    // `checkAndMakeDir({ createParentPath: true }, …)`
    // (uploads/fetchAPI-multipart/handlers.js), which `mkdirSync`s the parent of
    // the temp file — and that mkdir is what is denied. The browser preview
    // succeeds because it never touches the server.
    //
    // WHY `/tmp` IS THE RIGHT ANSWER ON RAILWAY: `/tmp` is a world-writable
    // (mode 1777) directory that exists in the image, so uid 1001 can always
    // write there without a volume, a mount or a chown at deploy time. It is
    // ephemeral, which is exactly correct — these files live for the duration of
    // one request.
    //
    // 🔴 THE VALUE IS LITERAL AND MUST STAY BYTE-IDENTICAL TO THE DOCKERFILE,
    // which already provisions precisely this path and whose comment predicted
    // this failure verbatim:
    //   RUN mkdir -p /tmp/payload-uploads && chown -R nextjs:nodejs /tmp/payload-uploads
    // A test asserts the two agree, because that drift is what caused the outage.
    // `os.tmpdir()` is deliberately NOT used: it honours `TMPDIR`, which would
    // silently point somewhere the Dockerfile never chowned.
    //
    // ⚠️ THIS IS NOT STORAGE. Permanent media lives in CLOUDINARY
    // (src/media/storage.ts). The storage plugin sets `disableLocalStorage` on
    // both upload collections, so nothing is ever persisted here and `staticDir`
    // is not a write target in production. A file passes through this directory
    // on its way to Cloudinary and is removed again.
    tempFileDir: '/tmp/payload-uploads',
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
    Videos,
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
  // 🔴 NO `email` KEY, DELIBERATELY. THIS PRODUCT SENDS NO EMAIL.
  //
  // The business flow is: visitor submits the enquiry form → the row is written
  // to Postgres → the administrator reads it in Admin → Enquiries. The database
  // IS the inbox. Nothing about that flow needs a mail transport, so SMTP is not
  // a dependency, not an environment variable and not a production blocker.
  //
  // ⚠️ MEASURED, NOT ASSUMED — this is why omitting the key is safe:
  // Payload falls back to `consoleEmailAdapter`
  // (node_modules/payload/dist/email/consoleEmailAdapter.js), whose `sendEmail`
  // logs one line and RESOLVES. Nothing throws, nothing crashes at boot.
  //
  // It also removes a real liability the previous configuration carried: with no
  // SMTP_HOST, `nodemailerAdapter()` provisioned an ETHEREAL.EMAIL TEST ACCOUNT
  // OVER THE NETWORK ON EVERY BOOT — every `payload migrate`, every worker
  // start, every test run. Boot depended on a third-party service that has
  // nothing to do with this product.
  //
  // CONSEQUENCE, RECORDED: the Admin Panel's "Forgot password?" link cannot
  // deliver. Recovery is `npm run admin:reset-password`, or another
  // administrator editing the account in Admin → Users. RUNBOOK.md §7.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  jobs: {
    tasks,
    // FIFO — the oldest queued job runs first.
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
    // produces DUPLICATE job executions.
    // ⚠️ Not used in development: HMR disrupts cron schedules.
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
    // ⚠️ MEASURED: completed job rows are DELETED BY DEFAULT. Set explicitly so
    // a successful run stays visible in Admin → System → Jobs, which is the only
    // place an administrator can see that the maintenance worker is alive.
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
