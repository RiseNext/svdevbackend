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
 * Panel, resolved by the owner on 20 Sep 2026 (OQ-6) to "SV Developers". This
 * constant exists for the ONE place that cannot read the database — the email
 * templates, when the `site-settings` lookup itself fails — so that a cosmetic
 * footer can never fail a lead notification.
 *
 * Anything that CAN read the CMS must read the CMS. Adding a second consumer of
 * this constant is almost certainly a mistake: check `site-settings` first.
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
// Uploads
// ---------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
/** Decompression-bomb guard. */
export const MAX_IMAGE_SIDE_PX = 10_000

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
