import type { GlobalConfig } from 'payload'

import { anyone, isAdmin } from '@/access'
import { iconField } from '@/fields/iconField'
import { FORMATS, placeholderText } from '@/fields/placeholderText'
import { uniqueByKey } from '@/fields/featureItemFields'
import { validateMediaRows } from '@/fields/mediaRows'
import { validateYoutubeUrl } from '@/fields/youtubeUrl'
import { LIMITS, MAX_ARRAY_ROWS } from '@/lib/constants'
import { auditGlobalAfterChange } from '@/hooks/audit'
import { revalidateEverything } from '@/hooks/revalidate'
import { surfaceValidationErrors } from '@/hooks/surfaceValidation'

/**
 * `site-settings` — THE ONLY GLOBAL.
 *
 * Payload's own test is decisive: globals "correspond to a SINGLE Document", and
 * "if you have more than one Global that share the same structure, consider
 * using a Collection instead". There is exactly one site.
 *
 * ⚠️ THE KEY ASYMMETRY: collections use `maxPerDoc`, GLOBALS USE `max`.
 * Writing `maxPerDoc` here is SILENTLY IGNORED. This is the single most likely
 * typo in the whole configuration.
 *
 * DRAFTS ARE OFF, DELIBERATELY. A draft/published split on site settings creates
 * a "why isn't my new phone number live?" failure mode. Version history is kept
 * for instant rollback of a fat-fingered phone number — which is a site-wide
 * outage of the primary conversion path — without imposing a publish gate on a
 * one-field edit.
 */
/**
 * Validators `SiteSettings` needs in two places — on the field, and in the
 * `beforeValidate` hook that is the only path by which their message reaches
 * the administrator. See src/hooks/surfaceValidation.ts.
 */
/**
 * 🔴 `MAX_ADDRESS_LINES` IS ENFORCED HERE, AND IT WAS NOT BEFORE.
 *
 * The field declares `maxRows: 5`. For a `type: 'array'` field Payload enforces
 * that itself; for a `text` + `hasMany` field — which this is — IT DOES NOT.
 * The admin UI's own control stops offering an Add button at the limit, so the
 * cap looked enforced while being nothing but a UI affordance: the Local API,
 * REST, a script or a future import could write twenty lines and Payload
 * accepted every one.
 *
 * It matters because the footer renders the address as THREE STACKED LINES. A
 * six-line address does not error anywhere; it overflows a layout nobody is
 * watching.
 *
 * A config-sweep test (`tests/integration/maxRowsEnforcement.test.ts`) now walks
 * every field in every collection and global, finds each `maxRows`, and requires
 * the `hasMany` ones to refuse an over-long write — so the next capped scalar
 * field added is covered the day it is added. This was the only one of the three
 * that was unprotected; `projects.description` and `blog-posts.body` go through
 * `validateParagraphs`, which has always checked its `maxRows`.
 */
const MAX_ADDRESS_LINES = 5

export const validateAddressLines = (value: unknown): true | string => {
  if (!Array.isArray(value) || value.length === 0) return 'Add at least one line.'
  if (value.length > MAX_ADDRESS_LINES) {
    return `Use at most ${MAX_ADDRESS_LINES} lines — the footer prints the address as stacked lines.`
  }
  for (const line of value) {
    if (typeof line !== 'string' || line.trim() === '') return 'Lines cannot be empty.'
    if (line.length > LIMITS.addressLine) {
      return `Each line may be at most ${LIMITS.addressLine} characters.`
    }
  }
  const lower = value.map((l: string) => l.trim().toLowerCase())
  if (new Set(lower).size !== lower.length) return 'Address lines must be unique.'
  return true
}

export const validateHeroMediaRows = validateMediaRows({
  kinds: { image: true, video: true, youtube: true },
  noun: 'Hero media',
})

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site Settings',
  dbName: 'site_settings',

  access: {
    // The ONLY place in the system where anonymous read is granted. The public
    // site needs contact details on every page.
    // ⚠️ This failure is INVISIBLE to a logged-in developer: forget it and the
    // public site 403s while the admin looks perfect. There is a dedicated
    // logged-out test for exactly that reason.
    read: anyone,
    update: isAdmin,
    readVersions: isAdmin,
  },

  admin: {
    group: 'Configuration',
    description: 'These values appear on every page of the public website.',
  },

  versions: { max: 50, drafts: false },

  hooks: {
    /**
     * 🔴 D-1. `onlyWhenPublished: false` because this global has
     * `drafts: false` — every save is immediately live, so there is no draft
     * state to exempt and the checks must run on every save.
     *
     * This is the single worst case the defect produced: the generic summary
     * for a broken hero row read "The following field is invalid: Content" —
     * the name of the TAB — while the authored message names the row.
     */
    beforeValidate: [
      surfaceValidationErrors(
        [
          { path: 'address', label: 'Address', validate: validateAddressLines },
          { path: 'heroMedia', label: 'Hero media', validate: validateHeroMediaRows },
          { path: 'social', label: 'Social links', validate: uniqueByKey('label', 'label') },
          { path: 'legalLinks', label: 'Legal links', validate: uniqueByKey('label', 'label') },
          { path: 'heroTicker', label: 'Hero ticker', validate: uniqueByKey('text', 'ticker line') },
        ],
        { onlyWhenPublished: false },
      ),
    ],
    afterChange: [auditGlobalAfterChange, revalidateEverything],
  },

  fields: [
    {
      type: 'tabs',
      tabs: [
        // ---------------------------------------------------------------
        {
          label: 'Brand',
          fields: [
            {
              name: 'name',
              type: 'text',
              required: true,
              maxLength: LIMITS.siteName,
              admin: {
                description:
                  'The public trading name. Renders in every page heading, every search-result title, the footer wordmark, the navigation bar and the sales notification email. ✅ RESOLVED 20 Sep 2026 (OQ-6): "SV Developers" — an owner decision, which supersedes the "SRR Developers Pvt. Ltd." that appears in the original brief.',
              },
            },
            {
              name: 'legalName',
              type: 'text',
              required: true,
              maxLength: LIMITS.siteName,
              admin: {
                description:
                  '🔶 STILL OPEN. The REGISTERED ENTITY name, used only in the copyright line — a DISTINCT FIELD with a distinct use, which is why resolving the public name above did not silently change this one. It currently mirrors the trading name because no registered entity name has been supplied. If the company is registered as "… Pvt. Ltd.", enter that exact string here; it is the only place the footer copyright reads from.',
              },
            },
            { name: 'tagline', type: 'text', maxLength: LIMITS.siteTagline },
            { name: 'description', type: 'textarea', maxLength: LIMITS.siteDescription },
            placeholderText({
              name: 'url',
              required: true,
              maxLength: 200,
              format: FORMATS.httpsUrl,
              description:
                'The public website address, e.g. https://www.svdevelopers.in — no trailing slash. This feeds every canonical link, every social-sharing tag and every sitemap entry.',
            }),
            {
              name: 'logo',
              type: 'upload',
              relationTo: 'media',
              admin: {
                description:
                  'Should be a transparent PNG. SVG cannot be uploaded — see the media library.',
              },
            },
          ],
        },

        // ---------------------------------------------------------------
        {
          label: 'Contact',
          description: 'These appear in the header, the footer and on the contact page.',
          fields: [
            placeholderText({
              name: 'email',
              required: true,
              maxLength: 200,
              format: FORMATS.email,
              warnWhenPlaceholder: false,
              description: 'Used for the mailto: link in the footer and on the contact page.',
            }),
            placeholderText({
              name: 'phone',
              required: true,
              maxLength: 40,
              description: 'Displayed exactly as typed, and used for the click-to-call link.',
            }),
            placeholderText({
              name: 'whatsapp',
              required: true,
              maxLength: 20,
              format: FORMATS.whatsappDigits,
              description:
                '⚠️ THREE CONSEQUENCES, all of which fire on the first day of real content. (1) Setting a real value CHANGES THE HOMEPAGE HERO: the enquiry pill stops routing to /contact and opens WhatsApp directly. (2) Those enquiries are then NOT RECORDED ANYWHERE — no lead row is created. (3) The contact page currently passes this value as a raw link and will 404 until that is fixed. Digits only, country code first, no + and no spaces.',
            }),
            {
              name: 'address',
              type: 'text',
              hasMany: true,
              required: true,
              minRows: 1,
              // Shares the constant with `validateAddressLines` so the UI cap
              // and the API cap cannot drift apart — the drift was the defect.
              maxRows: MAX_ADDRESS_LINES,
              admin: {
                description:
                  'One line per entry, in the order they should be printed. Rendered as three stacked lines — NOT a free-text block.',
              },
              validate: validateAddressLines,
            },
            placeholderText({
              name: 'mapUrl',
              maxLength: 500,
              format: FORMATS.httpsUrl,
              description: 'A Google Maps link to the office.',
            }),
            { name: 'officeHours', type: 'text', maxLength: LIMITS.officeHours },
          ],
        },

        // ---------------------------------------------------------------
        {
          label: 'Social',
          fields: [
            {
              name: 'social',
              type: 'array',
              dbName: 'site_social',
              maxRows: 10,
              validate: uniqueByKey('label', 'label'),
              admin: { initCollapsed: false },
              fields: [
                { name: 'label', type: 'text', required: true, maxLength: 60 },
                placeholderText({ name: 'href', required: true, maxLength: 500, format: FORMATS.httpsUrl }),
                iconField(),
              ],
            },
          ],
        },

        // ---------------------------------------------------------------
        {
          label: 'Legal',
          fields: [
            {
              name: 'legalLinks',
              type: 'array',
              dbName: 'site_legal_links',
              maxRows: 10,
              validate: uniqueByKey('label', 'label'),
              admin: {
                description:
                  '⚖️ A PRIVACY POLICY IS LEGALLY REQUIRED once the website collects a name and phone number. The enquiry form is switched off in production until a real privacy URL is configured.',
              },
              fields: [
                { name: 'label', type: 'text', required: true, maxLength: 60 },
                placeholderText({ name: 'href', required: true, maxLength: 500, format: FORMATS.httpsUrl }),
              ],
            },
            // `copyright` is DELIBERATELY NOT A FIELD. `site.ts:90` stores
            // "© [YEAR] ${legalName}. All rights reserved." with [YEAR] embedded
            // MID-STRING, so `isPlaceholder()` returns false and the literal text
            // "© [YEAR] SV Developers." renders live in the footer TODAY,
            // unstyled and unguarded. The serialiser COMPUTES it instead, which
            // deletes a whole class of bug. Do not re-add it.
            // `disclaimer` is also not a field: "changing it is a lawyer's job,
            // not a CMS edit."
          ],
        },

        // ---------------------------------------------------------------
        {
          label: 'Content',
          fields: [
            {
              name: 'formNote',
              type: 'textarea',
              maxLength: LIMITS.formNote,
              admin: {
                description:
                  '⚖️ THIS IS THE CONSENT ARTEFACT. It is rendered next to the submit button and is the promise the business makes about how the number will be used. It must stay truthful to actual data use — if leads are ever sent to a third party, this sentence has to change first.',
              },
            },
            {
              name: 'cta',
              type: 'group',
              admin: {
                description:
                  'The closing call-to-action banner. NOTE: this is {title, body}; the PER-PROJECT override is {title, description}. They are different fields and are not interchangeable.',
              },
              fields: [
                { name: 'title', type: 'text', maxLength: LIMITS.ctaTitle },
                { name: 'body', type: 'text', maxLength: LIMITS.ctaDescription },
              ],
            },
            {
              name: 'heroTicker',
              type: 'array',
              dbName: 'site_hero_ticker',
              maxRows: MAX_ARRAY_ROWS,
              validate: uniqueByKey('text', 'ticker line'),
              admin: {
                // FALSE — the same defect fixed on the six `projects` arrays.
                // `ADD_ROW` creates a row with no `collapsed` flag, so
                // `isRowCollapsed()` falls back to `initCollapsed` whenever no
                // collapse preference exists yet, and a freshly added row
                // arrives COLLAPSED with its Icon and Text inputs hidden.
                // `social` above already used `false`; this was the outlier.
                initCollapsed: false,
                description:
                  'The scrolling claims under the homepage headline. Each line must be unique.',
              },
              fields: [
                iconField(),
                { name: 'text', type: 'text', required: true, maxLength: 120 },
              ],
            },
            {
              name: 'masterPlan',
              type: 'upload',
              relationTo: 'documents',
              admin: {
                description: 'The master-plan PDF offered for download on /master-plan.',
              },
            },
            {
              /**
               * 🔴 THE ACTIVE HERO VIDEOS — AN ORDERED LIST, AND THE ORDER IS
               * THE CONTRACT.
               *
               * This replaces the singular `video` field from d40bad6. That
               * field was written against a contract the frontend had not yet
               * implemented; the frontend now ships `site-settings.heroVideos`
               * and consumes an ARRAY whose index IS the carousel order
               * (`HeroVideoStage` advances with `(i + 1) % videos.length`). One
               * entry renders a still pane, two or more render the carousel,
               * and absent-or-empty renders the type-only hero.
               *
               * 🔴 `hasMany: true` IS WHAT MAKES ORDERING A STORED FACT rather
               * than an emergent one. Payload persists a hasMany relation in a
               * `_rels` side table carrying an explicit `order` column and
               * returns rows in that order, so drag-to-reorder in the admin is
               * the ONLY thing that decides carousel order. The serialiser must
               * therefore never sort — see the note in `toPublicContent.ts`.
               *
               * ⚠️ STILL PLACEMENT-NEUTRAL, AND THE NAME DOES NOT CHANGE THAT.
               * `heroVideos` is the frontend's chosen key for "the ordered
               * videos the site is currently running", not an instruction about
               * where they go. There is still no placement enum, no section
               * selector, no carousel configuration and no layout field here —
               * the website owns all of that. The name matches the consumer's
               * contract, which is the one thing a CMS field genuinely must do.
               *
               * Optional on purpose: clearing the list is how videos are taken
               * off the site WITHOUT deleting the assets, which stay in
               * Media → Videos.
               */
              name: 'heroVideos',
              type: 'upload',
              relationTo: 'videos',
              hasMany: true,
              admin: {
                description:
                  'LEGACY — prefer “Hero media” below, which also takes images and YouTube links. Still fully supported and still rendered when “Hero media” is empty, so nothing here needs changing. The videos the site is currently running, in order — drag to reorder.',
              },
            },
            {
              /**
               * 🔴 THE UNIFIED HERO MEDIA LIST — images, uploaded MP4s and
               * YouTube links in ONE ordered sequence.
               *
               * ─── WHY AN `array` AND NOT A POLYMORPHIC UPLOAD RELATION ─────
               * `relationTo: ['media', 'videos']` with `hasMany` was the
               * obvious shape and it CANNOT WORK, for a reason that is about
               * the data and not about taste: a YouTube entry is a pasted URL
               * and has no upload row to point at. A relation can only
               * reference documents, so a polymorphic relation could express
               * two of the three kinds and would need a second field beside it
               * for the third — which is two sources of order for one list.
               *
               * An `array` holds all three in one ordered sequence. It is also
               * the pattern this global ALREADY uses three times (`social`,
               * `legalLinks`, `heroTicker`), whereas no polymorphic relation
               * exists anywhere in this codebase — so this is the proven path,
               * not the novel one.
               *
               * ─── WHY `kind` IS EXPLICIT AND NOT DERIVED ───────────────────
               * 🔴 Deriving the type from "which source field is populated"
               * fails the moment an admin fills in two, and then precedence is
               * invisible to them. The frontend already settled this exact
               * question for `BlogPost.externalUrl` and wrote down the rule:
               * "inference means an admin who fills in both cannot tell which
               * one wins". One field, one meaning.
               *
               * ⚠️ `admin.condition` BELOW IS A UI AFFORDANCE, NOT VALIDATION.
               * It hides the irrelevant fields; it does NOT stop the REST API
               * storing a `youtubeUrl` on a `kind: 'image'` row. `validate` on
               * this array is the enforcement — see it below.
               *
               * ─── ORDERING ─────────────────────────────────────────────────
               * Array order IS carousel order, across all three kinds. Payload
               * persists an array in a child table with an explicit `_order`
               * column, so drag-to-reorder in the admin is the only thing that
               * decides it. The serialiser must never sort.
               *
               * ─── BACKWARD COMPATIBILITY ───────────────────────────────────
               * 🔴 `heroVideos` ABOVE IS UNTOUCHED AND STILL SERIALISED
               * IDENTICALLY. One hero video is live in production right now;
               * this field is ADDITIVE, and the frontend prefers `heroMedia`
               * only when it is non-empty, falling back to `heroVideos`
               * otherwise. So an admin who never opens this field sees no
               * change, and there is NO content migration.
               */
              name: 'heroMedia',
              label: 'Hero media',
              type: 'array',
              maxRows: MAX_ARRAY_ROWS,
              admin: {
                description:
                  'The homepage hero, in order — drag to reorder. Mix photographs, uploaded videos and YouTube links freely. One entry shows on its own; several become a slideshow in exactly this order. Leave empty to keep using “Hero videos” above.',
                initCollapsed: true,
                components: {
                  RowLabel: '@/components/admin/HeroMediaRowLabel#HeroMediaRowLabel',
                },
              },
              /**
               * EACH ROW MUST CARRY THE SOURCE ITS `kind` PROMISES.
               *
               * 🔴 THIS IS THE REAL GUARD, because `admin.condition` is not one.
               * A row whose kind and source disagree is unrenderable: the
               * serialiser would drop it and the admin would see an entry in the
               * list that never appears on the site, with nothing to explain why.
               *
               * ⚠️ A YOUTUBE ROW REQUIRES A POSTER, and that is not fussiness.
               * YouTube's own thumbnails come from `i.ytimg.com`, which is
               * deliberately NOT in svfrontend's `next.config.mjs`
               * `images.remotePatterns` and is not being added. Without a
               * poster from `media` there is nothing the hero can show before
               * the visitor clicks.
               */
              validate: validateHeroMediaRows,
              fields: [
                {
                  name: 'kind',
                  label: 'Type',
                  type: 'select',
                  required: true,
                  defaultValue: 'image',
                  options: [
                    { label: 'Photograph', value: 'image' },
                    { label: 'Uploaded video (MP4)', value: 'video' },
                    { label: 'YouTube link', value: 'youtube' },
                  ],
                  admin: {
                    description:
                      'What this entry is. Choose first — the field you need appears below.',
                  },
                },
                {
                  /**
                   * ⚠️ THE EXISTING `media` COLLECTION, which is the whole
                   * reason an image entry costs nothing: `toImageRef` already
                   * composes `/image/upload/media/**` — a path svfrontend
                   * ALREADY allowlists — and `media` runs the established
                   * pipeline (sniffing, four-layer SVG rejection, EXIF strip,
                   * intrinsic dimensions). Its `alt` text comes with it, which
                   * is what makes a hero photograph accessible without a second
                   * field here.
                   */
                  name: 'image',
                  label: 'Photograph',
                  type: 'upload',
                  relationTo: 'media',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.kind === 'image',
                    description:
                      'A landscape photograph. Its alternative text comes from the Media library entry, so write it there.',
                  },
                },
                {
                  /**
                   * ⚠️ THE EXISTING `videos` COLLECTION — the SAME one
                   * `heroVideos` uses, so an uploaded hero video inherits the
                   * MP4-only allow-list, the 6 MB ceiling, `pasteURL: false`
                   * and the required poster/title WITHOUT any new upload code.
                   * That is also what makes a video already in the library
                   * reusable here rather than needing a second upload.
                   */
                  name: 'video',
                  label: 'Uploaded video',
                  type: 'upload',
                  relationTo: 'videos',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.kind === 'video',
                    description:
                      'Choose a video from Media → Videos, or upload a new one. MP4, up to 6 MB, and it must already have a poster set there.',
                  },
                },
                {
                  name: 'youtubeUrl',
                  label: 'YouTube link',
                  type: 'text',
                  maxLength: LIMITS.url,
                  // 🔴 SERVER-SIDE FORMAT VALIDATION. Before this, a non-YouTube link
                  // (a Vimeo URL, a channel page, a playlist, anything from YouTube
                  // Studio) saved with a 200 and then rendered as a dead still image
                  // forever, with nothing in the admin and nothing in any log. One
                  // shared definition, mirrored from the frontend's `youtubeId()`.
                  validate: validateYoutubeUrl,
                  hooks: {
                    beforeValidate: [
                      ({ value }) => (typeof value === 'string' ? value.trim() : value),
                    ],
                  },
                  admin: {
                    condition: (_data, siblingData) => siblingData?.kind === 'youtube',
                    description:
                      'Paste the link exactly as YouTube’s Share button gives it. ⚠️ A YouTube entry does NOT autoplay — it shows its poster with a play button, and starts when a visitor clicks. Upload an MP4 instead if you need silent background motion.',
                  },
                },
                {
                  name: 'poster',
                  label: 'Poster image',
                  type: 'upload',
                  relationTo: 'media',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.kind === 'youtube',
                    description:
                      'REQUIRED for a YouTube entry — this is what fills the hero until someone presses play. Use a still from the video itself.',
                  },
                },
                {
                  name: 'title',
                  type: 'text',
                  maxLength: 200,
                  admin: {
                    description:
                      'Optional label, e.g. “Aerial approach”. Not shown as body copy — it names this slide for the slideshow’s controls, so a screen-reader user hears it instead of “Slide 2”.',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
