/**
 * ONE shared constants module, imported by BOTH the Payload field config and the
 * Zod schemas.
 *
 * This is the achievable form of NFR-11 ("one definition per rule"). The
 * document's original wording — "one Zod schema that generates everything" — is
 * NOT achievable under D-015: the admin UI form rules and the DB constraints come
 * from Payload field config, while custom endpoints use Zod. What IS achievable,
 * and is what this file delivers, is a single source for every *value* both sides
 * validate against.
 */

// ---------------------------------------------------------------------------
// Business identity
// ---------------------------------------------------------------------------

/**
 * 🔴 THIS IS A FALLBACK, NOT THE COMPANY NAME.
 *
 * The company name is CMS data: `site-settings.name`, edited in the Admin
 * Panel, resolved by the owner on 20 Sep 2026 (OQ-6) to "SV Developers".
 *
 * ⚠️ ITS ONLY CONSUMER — the email templates — WAS DELETED WITH THE EMAIL
 * SUBSYSTEM. It is kept as the seed's default so a fresh database has a sane
 * `site-settings.name` before anyone opens the Admin Panel. Anything that CAN
 * read the CMS must read the CMS; a second consumer here is almost certainly a
 * mistake.
 */
export const DEFAULT_SITE_NAME = 'SV Developers'

// ---------------------------------------------------------------------------
// Phone — D-114 / OQ-19
// ---------------------------------------------------------------------------

/**
 * 🔶 DELIBERATE, TIME-BOXED DIVERGENCE FROM P-08 ("standardise on 10 digits").
 *
 * The live `ContactForm.tsx:34` accepts >= 8 digits. A backend enforcing 10 while
 * that form accepts 8 creates a SILENT LEAD-LOSS REGRESSION inside the very phase
 * whose purpose is to stop lead loss — and the rejections are invisible to the
 * business, because a 422 on an already-filled form reads as "the site is broken".
 *
 * CLOSING CONDITION: raise this to 10 in the SAME RELEASE that changes
 * `ContactForm.tsx:34` and `EnquiryPill.tsx:29`. All three move together.
 * The normaliser is threshold-independent, so the change is this one line.
 */
export const MIN_PHONE_DIGITS = 8

/** E.164 maximum. Not a policy choice — the standard's own limit. */
export const MAX_PHONE_DIGITS = 15

/** Assumed country code when a bare 10-digit Indian mobile number is submitted. */
export const DEFAULT_COUNTRY_CALLING_CODE = '91'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** NIST SP 800-63B: length + a breach check, no forced rotation, no composition rules. */
export const MIN_PASSWORD_LENGTH = 12

export const MAX_LOGIN_ATTEMPTS = 5
/** Milliseconds. Payload's `lockTime` is in ms; `tokenExpiration` is in SECONDS. */
export const LOCK_TIME_MS = 15 * 60 * 1000
/** Seconds. */
export const TOKEN_EXPIRATION_SECONDS = 2 * 60 * 60

// ---------------------------------------------------------------------------
// Leads — anti-abuse windows (D-113)
// ---------------------------------------------------------------------------

/**
 * Deliberately NOT an environment variable. Widening it rejects real enquiries
 * and narrowing it admits spam — a behaviour change that belongs in a reviewed
 * commit with a diff and an audit trail, not in a platform console.
 */
export const LEAD_DEDUPE_WINDOW_MS = 10 * 60 * 1000

/** `Idempotency-Key` TTL. 24h comfortably covers a mobile double-submit. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** The honeypot field name. Named here so the "reject unknown properties" rule
 *  and the honeypot rule cannot contradict each other (CONF-48). */
export const HONEYPOT_FIELD = 'website'

/**
 * RATE LIMITS FOR `POST /api/v1/leads` — enforced IN THE APPLICATION, because
 * the real deployment (Railway) has no reverse proxy to enforce them at.
 *
 * TWO LAYERS, because they stop different things:
 *   · PER IP     — a script hammering the endpoint from one host.
 *   · PER PHONE  — the same number submitted from many IPs, which the IP limit
 *                  cannot see and which a residential proxy pool makes cheap.
 *
 * The per-IP ceiling is the RUNBOOK's own published figure (5/min/IP) so the
 * documented contract and the code agree. The per-phone window matches the
 * "3/hour/phone" the runbook already said could only be enforced in the
 * application, because the edge cannot read a request body.
 *
 * 🔶 CALIBRATED TO BE GENEROUS ON PURPOSE. A false 429 on a plot enquiry costs a
 * real sale; a bot getting five submissions in instead of three costs a row an
 * administrator deletes. When in doubt these go UP, not down.
 */
export const LEAD_RATE_LIMIT_PER_IP = 5
export const LEAD_RATE_LIMIT_IP_WINDOW_MS = 60 * 1000
export const LEAD_RATE_LIMIT_PER_PHONE = 3
export const LEAD_RATE_LIMIT_PHONE_WINDOW_MS = 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** FR-LEAD-16 / DPDP: purge ipAddress + userAgent from old leads. */
export const LEAD_PII_RETENTION_DAYS = 90

/**
 * OQ-17: grace period before a soft-deleted media object is really removed from
 * storage. Applied to BOTH deletes and replaces — capturing the previous
 * filename on replace makes the behaviour independent of whatever Payload does
 * internally, which is undocumented.
 */
export const MEDIA_GRACE_PERIOD_DAYS = 30

// ---------------------------------------------------------------------------
// Job queues
// ---------------------------------------------------------------------------

/**
 * THE TWO QUEUE NAMES, spelled once.
 *
 * A queue name is a bare string in three unrelated places — the `schedule`
 * entry on a task, the `jobs.queue()` call that enqueues it, and the
 * `--queue` argument of the worker that drains it. A typo in any one of them
 * is SILENT: the job is queued to a queue nobody polls, or a worker polls a
 * queue nothing is queued to. Nothing errors, and the symptom is simply that
 * the work never happens.
 *
 * These constants remove two of the three opportunities to get it wrong. The
 * third — the `--queue` argument in docker-compose.prod.yml and in the Railway
 * service start command — is a deployment string that no constant can reach,
 * so a test asserts the exact literals these must equal.
 */
export const DEFAULT_QUEUE = 'default'
export const MAINTENANCE_QUEUE = 'maintenance'

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
/** Decompression-bomb guard. */
export const MAX_IMAGE_SIDE_PX = 10_000

/**
 * 🔴 6 MB, AND THE NUMBER IS A BANDWIDTH DECISION, NOT A TECHNICAL LIMIT.
 *
 * Cloudinary's own `media_limits` on this account allow 100 MB per video, and
 * `upload.limits.fileSize` in payload.config.ts is the 25 MB PDF ceiling — so
 * anything up to 25 MB would upload without a single config change. The binding
 * constraint is the delivery budget: a video used as a looping background
 * autoplays, so it is fetched on essentially every visit to whatever page
 * renders it. At 6 MB that is roughly twice the monthly traffic the current
 * plan sustains compared with 12 MB.
 *
 * ⚠️ IT MUST STAY <= MAX_DOCUMENT_BYTES. `upload.limits.fileSize` is ONE
 * application-wide value; raising this above 25 MB would mean raising that, and
 * that would silently relax the ceiling for images and PDFs too.
 *
 * Duration and pixel dimensions are NOT enforced: sharp cannot read an MP4 and
 * this project deliberately ships no ffmpeg/ffprobe. The byte ceiling is the
 * only technical control, which is why it is deliberately tight and why the
 * collection carries explicit authoring guidance.
 */
export const MAX_VIDEO_BYTES = 6 * 1024 * 1024

/**
 * Our allow-list is STRICTLY NARROWER than Payload's own restricted-type
 * deny-list, which is the only reason it is acceptable that defining `mimeTypes`
 * causes Payload to SKIP its restricted-file verification entirely.
 *
 * 🔴 It must be re-reviewed whenever it is widened.
 * 🔴 NEVER use the docs' own example `mimeTypes: ['image/*']` — that INCLUDES
 *    `image/svg+xml`, and SVG is not on Payload's restricted list.
 */
export const ALLOWED_IMAGE_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
} as const

export const ALLOWED_DOCUMENT_MIME = {
  'application/pdf': 'pdf',
} as const

/**
 * MP4 ONLY, AND WEBM IS DELIBERATELY DEFERRED.
 *
 * H.264/AAC in MP4 plays in every browser in the target set, Safari and iOS
 * included, so nothing needs a second file to play the video at all. Adding
 * WebM now would cost a second upload per asset, a `<source>` list on the
 * frontend (which would change the shape the existing Hero already accepts),
 * and double the storage and orphan-cleanup surface — in exchange for a
 * marginal size win on browsers that already play the MP4.
 *
 * The public contract emits `mimeType`, which is the forward hook: adding a
 * second format later is additive on both sides rather than breaking.
 *
 * 🔴 SAME RE-REVIEW RULE AS THE TWO LISTS ABOVE. Defining `mimeTypes` on a
 * collection makes Payload SKIP its restricted-file verification, so this list
 * must stay strictly narrower than their deny-list. `video/mp4` is not on it —
 * that list covers executables, scripts and HTML.
 *
 * ⚠️ The sniffer must match `video/mp4` EXACTLY. Sibling ISO-BMFF brands
 * (.m4v, .mov, .3gp) share the `ftyp` box and must fail the allow-list rather
 * than be coerced into it.
 */
export const ALLOWED_VIDEO_MIME = {
  'video/mp4': 'mp4',
} as const

// ---------------------------------------------------------------------------
// Content limits — mirrored by Payload field config and by Zod
// ---------------------------------------------------------------------------

export const LIMITS = {
  projectName: 120,
  slug: 100,
  locality: 200,
  developer: 200,
  tagline: 200,
  summary: 600,
  descriptionParagraph: 5000,
  area: 100,
  roadDetails: 200,
  featureTitle: 200,
  featureBody: 1000,
  statLabel: 60,
  statValue: 120,
  proximityMeasure: 40,
  proximityPlace: 200,
  ctaTitle: 120,
  ctaDescription: 400,
  seoTitle: 70,
  seoDescription: 160,
  alt: 300,
  leadName: 120,
  leadMessage: 2000,
  siteName: 120,
  siteTagline: 200,
  siteDescription: 400,
  addressLine: 120,
  officeHours: 200,
  formNote: 400,
  faqQuestion: 300,
  faqAnswer: 2000,
  testimonialName: 120,
  testimonialRole: 120,
  testimonialBody: 2000,
  userName: 120,
} as const

/** Every repeatable list is capped. Prevents an accidental paste of 10 000 rows. */
export const MAX_ARRAY_ROWS = 50
/** `description` is the exception: 12 paragraphs is already a very long page. */
export const MAX_DESCRIPTION_PARAGRAPHS = 12

// ---------------------------------------------------------------------------
// Categories — a closed 4-value set, NOT user-extensible (so: no collection)
// ---------------------------------------------------------------------------

export const PROJECT_CATEGORIES = [
  'Premium Villa Plots',
  'Farm Villa Plots',
  'Residential Plots',
  'Apartments',
] as const
export type ProjectCategoryValue = (typeof PROJECT_CATEGORIES)[number]

export const PROJECT_STATUSES = [
  'Open for booking',
  'Nearing sell-out',
  'Completed',
  'Coming soon',
] as const
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number]

export const LEAD_SOURCES = ['contact_form', 'hero_pill', 'whatsapp', 'phone'] as const
export type LeadSourceValue = (typeof LEAD_SOURCES)[number]

/**
 * 11 values, not the 7 the spec lists.
 * `SECURITY.md` §13 additionally requires logout, lockout and password_change,
 * and `restore` has no value at all in the original list. An enum with a missing
 * value means the audit hook THROWS on the first logout — a Postgres enum rejects
 * an unlisted value at write time.
 */
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'publish',
  'unpublish',
  'delete',
  'restore',
  'login',
  'logout',
  'login_failed',
  'lockout',
  'password_change',
] as const
export type AuditActionValue = (typeof AUDIT_ACTIONS)[number]

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

/**
 * A value matching this bypasses FORMAT validation (url/email/phone) but still
 * obeys length limits, and is emitted VERBATIM by the serialiser.
 *
 * 🔴 Never "helpfully" clean one. Strip the brackets from `[EMAIL@DOMAIN]` and
 * `svfrontend/src/lib/href.ts` stops rendering it inert — so a live-looking dead
 * link ships, which is the exact failure the frontend was built to prevent.
 */
export const PLACEHOLDER_PATTERN = /^\[.*\]$/

export const isPlaceholder = (value: unknown): boolean =>
  typeof value === 'string' && PLACEHOLDER_PATTERN.test(value.trim())

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

export const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600'
export const NO_STORE_CACHE_CONTROL = 'no-store'
