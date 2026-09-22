import type { GlobalConfig } from 'payload'

import { anyone, isAdmin } from '@/access'
import { iconField } from '@/fields/iconField'
import { FORMATS, placeholderText } from '@/fields/placeholderText'
import { uniqueByKey } from '@/fields/featureItemFields'
import { LIMITS, MAX_ARRAY_ROWS } from '@/lib/constants'
import { auditGlobalAfterChange } from '@/hooks/audit'
import { revalidateEverything } from '@/hooks/revalidate'

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

  hooks: { afterChange: [auditGlobalAfterChange, revalidateEverything] },

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
              maxRows: 5,
              admin: {
                description:
                  'One line per entry, in the order they should be printed. Rendered as three stacked lines — NOT a free-text block.',
              },
              validate: (value: unknown): true | string => {
                if (!Array.isArray(value) || value.length === 0) return 'Add at least one line.'
                for (const line of value) {
                  if (typeof line !== 'string' || line.trim() === '') return 'Lines cannot be empty.'
                  if (line.length > LIMITS.addressLine) {
                    return `Each line may be at most ${LIMITS.addressLine} characters.`
                  }
                }
                const lower = value.map((l: string) => l.trim().toLowerCase())
                if (new Set(lower).size !== lower.length) return 'Address lines must be unique.'
                return true
              },
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
               * 🔴 THE ACTIVE VIDEO — AND THE NAME IS DELIBERATELY `video`, NOT
               * `heroVideo`.
               *
               * This field answers exactly one question: WHICH video is live.
               * It does not answer WHERE it appears, and it must never grow a
               * field that does. No placement enum, no section selector, no
               * ordering, no layout configuration. The website decides where a
               * video is rendered; the CMS decides which one is current.
               *
               * That separation is what makes the asset reusable: the same
               * value can feed a homepage background today and an about-page
               * band later with NO backend change of any kind.
               *
               * It follows the two references that already live on this global —
               * `logo` -> media, `masterPlan` -> documents, `video` -> videos —
               * so it is the third instance of an established pattern rather
               * than a new mechanism.
               *
               * Optional on purpose: clearing it is how a video is taken off the
               * site WITHOUT deleting the asset. The public serialiser then
               * omits the key entirely and the frontend falls back to whatever
               * it renders without one.
               */
              name: 'video',
              type: 'upload',
              relationTo: 'videos',
              admin: {
                description:
                  'The site’s active video. Where it appears on the website is decided by the website itself — this setting only chooses which video is live. Leave empty for no video.',
              },
            },
          ],
        },
      ],
    },
  ],
}
