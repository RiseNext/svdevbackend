import type { CollectionConfig } from 'payload'

import { isAdmin, publishedOrAuthenticated, serverOnlyField } from '@/access'
import { featureArray, uniqueByKey } from '@/fields/featureItemFields'
import { iconField } from '@/fields/iconField'
import { slugField } from '@/fields/slugField'
import {
  LIMITS,
  MAX_ARRAY_ROWS,
  MAX_DESCRIPTION_PARAGRAPHS,
  PROJECT_CATEGORIES,
  PROJECT_STATUSES,
} from '@/lib/constants'
import { auditAfterChange, auditAfterDelete } from '@/hooks/audit'
import { slugLock, stampPublishedAt } from '@/hooks/projectHooks'
import { revalidateProject } from '@/hooks/revalidate'

/**
 * ★ THE CORE ENTITY.
 *
 * Every field name matches the FRONTEND KEY, not the documented SQL column
 * (principle P1): `image` not `cover`, `roadDetails` not `road_details`,
 * `locationHighlights` not `project_features.kind='location'`. That makes
 * `toPublicProject()` a near-identity function plus omission logic, which is the
 * only place the contract can be got wrong.
 *
 * `types/content.ts:57-105` is the contract. 25 fields.
 */
export const Projects: CollectionConfig = {
  slug: 'projects',

  // Native fractional-index drag ordering in the List View. This is the exact
  // capability whose absence got Strapi rejected.
  //
  // ✅ MEASURED, NOT ASSUMED (the plan flagged this as the one unresolved fact):
  // `orderable: true` emits `_order: varchar("_order")` on the collection table,
  // indexed as `projects__order_idx`. It is a FRACTIONAL-INDEX STRING, which is
  // why a plain lexicographic `sort` reproduces drag order exactly — that is the
  // whole point of the scheme. Evidence: src/payload-generated.schema.ts.
  //
  // 🔴 `_order` is NEVER exposed publicly — it is not in types/content.ts, and
  // the serialiser's strip-list names it explicitly.
  orderable: true,
  defaultSort: '_order',

  // FR-PROJ-06 archive. "Hard-deleting a project orphans a live URL and its
  // sitemap entry" (D-006). Archived -> public 404, never 403.
  trash: true,

  versions: {
    // EXPLICIT. The default is 100 PER DOCUMENT and pruning behaviour is
    // undocumented — inheriting it silently on nine entities is how a
    // five-project brochure site ends up with version tables larger than its
    // content tables.
    maxPerDoc: 20,
    drafts: {
      // OFF, deliberately. The default interval is 800ms, every autosave is a
      // real DB write firing EVERY afterChange hook — which would flood
      // audit-log and call the revalidation webhook roughly once per second
      // while an editor types a paragraph. The hook-argument property that
      // identifies an autosave write is NOT DOCUMENTED, so the guard cannot
      // even be written correctly today.
      autosave: false,
      // FALSE, against VALIDATION-RULES.md's preference, for one concrete
      // reason: `projects` has 8 required fields including a required `image`
      // upload, and none of them can be filled on day one of a new project.
      // ADMIN-CMS-SPEC's preamble demands that "I don't have this information"
      // be an easy choice. DRAFTS ARE SCRATCH; PUBLISH IS VALIDATED.
      validate: false,
      // No requirement asks for scheduled publishing, and enabling it without a
      // proven runner means an editor schedules a launch and it silently never
      // fires.
      schedulePublish: false,
    },
  },

  defaultPopulate: { slug: true, name: true, locality: true },

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'category', 'locality', 'featured', '_status', 'updatedAt'],
    listSearchableFields: ['name', 'locality', 'slug'],
    group: 'Content',
    description:
      'The project catalogue. NOTE: until the website’s navigation is wired to this list, a newly published project appears at /projects, in the sitemap and at its own address, but NOT yet in the header dropdown or the footer column. Publishing a sixth project also requires a copy change on the homepage, which currently reads “Five layouts.”',
    // ⚠️ The option is `baseFilter`, NOT `baseListFilter`.
    baseFilter: () => ({ deletedAt: { exists: false } }),
    preview: (doc) =>
      typeof doc?.slug === 'string'
        ? `${process.env.REVALIDATE_WEBHOOK_URL?.replace(/\/api\/revalidate$/, '') ?? ''}/projects/${doc.slug}`
        : null,
  },

  // 🔴 EXPLICIT ON EVERY KEY, INCLUDING readVersions. Version records are a
  // second copy of EVERY HISTORICAL VALUE of every DTCP/RERA approval claim ever
  // entered, and `GET /{api}/{collection}/versions` exists on the generated REST
  // surface. Its default when omitted is undocumented; the framework-wide
  // default is Boolean(user) — any authenticated user.
  access: {
    read: publishedOrAuthenticated,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    readVersions: isAdmin,
  },

  disableBulkEdit: true,
  disableBulkDelete: true,
  disableDuplicate: false,

  hooks: {
    beforeValidate: [slugLock],
    beforeChange: [stampPublishedAt],
    afterChange: [auditAfterChange, revalidateProject],
    afterDelete: [auditAfterDelete, revalidateProject],
    // ⚠️ MEASURED FROM THE TYPES: `beforeDuplicate` is a FIELD hook in Payload 3,
    // NOT a collection hook — `CollectionConfig['hooks']` has no such key and
    // putting it here is a type error. It lives on the slug field instead
    // (src/fields/slugField.ts), which is also the only field that needs it.
  },

  fields: [
    // Unnamed tabs: ZERO schema impact, so the stored shape stays flat (D-106).
    {
      type: 'tabs',
      tabs: [
        // ---------------------------------------------------------------
        {
          label: 'Identity',
          fields: [
            {
              name: 'name',
              type: 'text',
              required: true,
              minLength: 1,
              maxLength: LIMITS.projectName,
            },
            {
              name: 'category',
              type: 'select',
              required: true,
              // The catalogue filter predicate (`ProjectCatalogue.tsx:21`) and
              // `usedCategories()` both read this on every public list request.
              index: true,
              options: PROJECT_CATEGORIES.map((v) => ({ label: v, value: v })),
              // A REAL Postgres enum type — closed at the database.
              enumName: 'enum_project_category',
              admin: {
                description:
                  'Shown on the card badge and used by the catalogue filter. One of four; a new category requires a frontend release.',
              },
            },
            {
              // ⚠️ RENAMED FROM `status` (D-105). `status` is RESERVED on
              // Postgres collections with drafts enabled, and "using reserved
              // field names will result in your field being sanitized from the
              // config" — SILENTLY. The serialiser maps this back to the public
              // key `status`, so types/content.ts is unchanged.
              name: 'projectStatus',
              type: 'select',
              options: PROJECT_STATUSES.map((v) => ({ label: v, value: v })),
              enumName: 'enum_project_status',
              // NO defaultValue: 0 of 5 projects have one, because no brochure
              // states one. Claiming a sales status nobody confirmed is exactly
              // the kind of invention the content rules forbid.
              admin: {
                isClearable: true,
                description:
                  'Leave blank unless the brochure states one. No project has a status today — the card badge shows the category instead.',
              },
            },
            {
              name: 'locality',
              type: 'text',
              required: true,
              minLength: 1,
              maxLength: LIMITS.locality,
              admin: {
                description:
                  'The place as written on the brochure, e.g. "Gummadavelli, Jeedikal, Aler". Also shown in the enquiry form’s project list.',
              },
            },
            {
              name: 'developer',
              type: 'text',
              maxLength: LIMITS.developer,
              admin: {
                description:
                  'ONLY when the developer differs from the site’s own company name, so the catalogue attributes it separately instead of silently absorbing it. e.g. Sri Virinchi Infra Developers Pvt. Ltd.',
              },
            },
            {
              name: 'tagline',
              type: 'text',
              maxLength: LIMITS.tagline,
              admin: { description: 'The short positioning line from the brochure cover.' },
            },
          ],
        },

        // ---------------------------------------------------------------
        {
          label: 'Narrative',
          fields: [
            {
              name: 'summary',
              type: 'textarea',
              required: true,
              minLength: 1,
              maxLength: LIMITS.summary,
              admin: {
                description:
                  'Rendered as the LARGE HEADING on the detail page — not as a paragraph. Keep it to a sentence or two.',
              },
            },
            {
              // 🔴 THE PHASE-1 GATE FIELD.
              // `types/content.ts:72` declares `description: readonly string[]`,
              // and `ProjectDetail.tsx:100-104` maps it to one <p> per entry
              // with key={paragraph} — so entries must be UNIQUE STRINGS.
              //
              // `text` + `hasMany: true` is documented as "an ordered array of
              // text", which is the only option that satisfies the contract with
              // an IDENTITY serialiser. The `array`-with-one-text-subfield
              // alternative stores "an array of OBJECTS" and would emit
              // [{id, value}] — the exact shape the contract forbids.
              name: 'description',
              type: 'text',
              hasMany: true,
              required: true,
              minRows: 1,
              maxRows: MAX_DESCRIPTION_PARAGRAPHS,
              label: 'Description paragraphs',
              admin: {
                description:
                  'One entry per paragraph. Order is meaningful. Each paragraph must be unique — the website uses the text itself as a rendering key.',
              },
              // Does two things no Payload built-in does: PER-ENTRY length and
              // non-emptiness (whether minLength/maxLength apply per entry or to
              // the joined value on a hasMany text is NOT DOCUMENTED, while
              // VALIDATION-RULES.md §3 demands each 1-5000 with no empty
              // strings), and UNIQUENESS within the array (nothing in Payload
              // catches a React key collision).
              validate: (value: unknown): true | string => {
                if (!Array.isArray(value) || value.length === 0) {
                  return 'Add at least one paragraph.'
                }
                if (value.length > MAX_DESCRIPTION_PARAGRAPHS) {
                  return `At most ${MAX_DESCRIPTION_PARAGRAPHS} paragraphs.`
                }
                for (const v of value) {
                  if (typeof v !== 'string' || v.trim() === '') {
                    return 'Paragraphs cannot be empty.'
                  }
                  if (v.length > LIMITS.descriptionParagraph) {
                    return `A paragraph may be at most ${LIMITS.descriptionParagraph} characters.`
                  }
                }
                const normalised = value.map((v: string) => v.trim().toLowerCase())
                if (new Set(normalised).size !== normalised.length) {
                  return 'Paragraphs must be unique — the website uses the text itself as a rendering key.'
                }
                return true
              },
            },
            {
              name: 'area',
              type: 'text',
              maxLength: LIMITS.area,
              admin: {
                description:
                  'The total extent EXACTLY as printed, e.g. "6 Acres 22.50 Guntas". Never converted to a number — the unit and the precision are part of the claim.',
              },
            },
            {
              name: 'roadDetails',
              type: 'text',
              maxLength: LIMITS.roadDetails,
              admin: { description: 'Road widths and surfacing as printed, e.g. "60\' & 30\' wide BT roads".' },
            },
          ],
        },

        // ---------------------------------------------------------------
        // SIX repeatable lists, not four. ADMIN-CMS-SPEC §4's header says "4
        // repeatable lists" and then enumerates six. Said unambiguously:
        // four FeatureItem arrays + stats {label,value} + proximity
        // {icon,measure,place}.
        {
          label: 'Lists',
          description:
            'Leave any list empty and that section simply does not appear on the website. An empty section is better than an invented one.',
          fields: [
            {
              name: 'stats',
              type: 'array',
              dbName: 'proj_stats',
              maxRows: MAX_ARRAY_ROWS,
              admin: {
                initCollapsed: true,
                description:
                  'The four-up figure strip. The grid is exactly four columns — use four, or none. Values are TEXT, exactly as printed ("6 Acres 22.50 Guntas", "DTCP & RERA", "100%").',
                components: { RowLabel: '@/components/admin/StatRowLabel#StatRowLabel' },
              },
              validate: uniqueByKey('label', 'label'),
              fields: [
                { name: 'label', type: 'text', required: true, maxLength: LIMITS.statLabel },
                {
                  name: 'value',
                  type: 'text',
                  required: true,
                  maxLength: LIMITS.statValue,
                  admin: {
                    description:
                      'Text, never a number. "6 Acres 22.50 Guntas" and "DTCP & RERA" are both valid values.',
                  },
                },
              ],
            },

            featureArray({
              name: 'highlights',
              dbName: 'proj_highlights',
              label: 'Highlights',
              required: true,
              minRows: 1,
              description:
                'The headline selling points. At least one is required — this section is not guarded in the page template.',
            }),

            featureArray({
              name: 'approvals',
              dbName: 'proj_approvals',
              label: 'Approvals',
              description:
                '⚖️ LEGAL CLAIMS — these edits are audited. THE FIRST ITEM APPEARS IN THIS PROJECT’S SEARCH-RESULT DESCRIPTION, so reordering this list silently changes what Google shows.',
            }),

            featureArray({
              name: 'amenities',
              dbName: 'proj_amenities',
              label: 'Amenities',
              description: 'Infrastructure and on-site facilities, kept separate from positioning.',
            }),

            featureArray({
              name: 'locationHighlights',
              dbName: 'proj_loc_hl',
              label: 'Location highlights',
              description:
                'Named surroundings. NO DISTANCE IS IMPLIED — if the brochure prints a distance, use Proximity instead.',
            }),

            {
              name: 'proximity',
              type: 'array',
              dbName: 'proj_proximity',
              maxRows: MAX_ARRAY_ROWS,
              admin: {
                initCollapsed: true,
                description:
                  '⚖️ Only enter distances PRINTED ON THE BROCHURE. An unmeasured proximity claim is the one most likely to be challenged on a land page.',
                components: { RowLabel: '@/components/admin/ProximityRowLabel#ProximityRowLabel' },
              },
              validate: uniqueByKey('place', 'place'),
              fields: [
                iconField(),
                {
                  name: 'measure',
                  type: 'text',
                  required: true,
                  maxLength: LIMITS.proximityMeasure,
                  admin: { description: 'e.g. "55 min" or "12 km" — as printed.' },
                },
                {
                  name: 'place',
                  type: 'text',
                  required: true,
                  maxLength: LIMITS.proximityPlace,
                },
              ],
            },
          ],
        },

        // ---------------------------------------------------------------
        // FOUR named upload fields — NOT a `project-media` join collection.
        // The FIELD NAME IS THE ROLE: zero enum, zero CHECK, zero drift. And
        // single-valued roles are enforced BY THE SCHEMA — a non-hasMany upload
        // field physically cannot hold two, which is stronger than the partial
        // unique index the documented design specified (and which is written
        // wrong in the source anyway: as written it permits only ONE of the
        // three single-valued roles in total).
        {
          label: 'Media',
          fields: [
            {
              name: 'image',
              type: 'upload',
              relationTo: 'media',
              required: true,
              admin: {
                description:
                  'The card and hero image. Used at 4:3 on cards, 16:9 in the page hero, and as the social-sharing preview.',
              },
            },
            {
              name: 'gallery',
              type: 'upload',
              relationTo: 'media',
              hasMany: true,
              admin: { description: 'Site photography, plantation and cottage shots. Drag to reorder.' },
            },
            {
              name: 'layoutImage',
              type: 'upload',
              relationTo: 'media',
              admin: {
                description: 'The plot layout / master plan. Shown CONTAINED and zoomable — never cropped.',
              },
            },
            {
              name: 'locationMap',
              type: 'upload',
              relationTo: 'media',
              admin: { description: 'The location map from the brochure. Shown contained, never cropped.' },
            },
            // `brochureImages` is DEFERRED (principle P4): types/content.ts:98
            // declares it, but there are ZERO render sites anywhere in src/ and
            // 0 of 5 projects populate it. One field plus one migration adds it
            // the day a render slot exists. Creating it now would let an admin
            // upload five brochure scans and see nothing change on the site.
          ],
        },

        // ---------------------------------------------------------------
        {
          label: 'Overrides',
          description: 'Leave both blank unless this project genuinely needs different wording.',
          fields: [
            {
              name: 'cta',
              type: 'group',
              admin: { description: 'Overrides the shared call-to-action banner for this project only.' },
              // ⚠️ BOTH members are REQUIRED INSIDE the group in the contract
              // (`cta?: { title: string; description: string }`), so it is
              // both-or-neither. This is ASYMMETRIC with `seo`, where both
              // members are optional — mirror that exactly or `seo: {}` becomes
              // impossible and `cta: { title }` becomes possible.
              validate: (value: unknown): true | string => {
                const v = value as { title?: unknown; description?: unknown } | null | undefined
                if (!v) return true
                const hasTitle = typeof v.title === 'string' && v.title.trim() !== ''
                const hasBody = typeof v.description === 'string' && v.description.trim() !== ''
                if (hasTitle !== hasBody) {
                  return 'Fill in both the title and the description, or leave both blank.'
                }
                return true
              },
              fields: [
                { name: 'title', type: 'text', maxLength: LIMITS.ctaTitle },
                { name: 'description', type: 'text', maxLength: LIMITS.ctaDescription },
              ],
            },
            {
              name: 'seo',
              type: 'group',
              admin: {
                description:
                  'Overrides the generated search-result title and description. Leave blank: the generated version is facts-only by construction, with no superlatives, because there is no field they could come from.',
              },
              fields: [
                { name: 'title', type: 'text', maxLength: LIMITS.seoTitle },
                { name: 'description', type: 'text', maxLength: LIMITS.seoDescription },
              ],
            },
          ],
        },
      ],
    },

    // -------------------------------------------------------------------
    // Sidebar
    slugField(),
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      // The homepage featured strip filters on this on every build.
      index: true,
      admin: {
        position: 'sidebar',
        description:
          'Shows this project in the homepage Featured strip. That strip is a THREE-COLUMN grid — a fourth featured project leaves a ragged row.',
      },
    },
    {
      name: 'publishedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Set automatically when this project is first published. Drives the sitemap.',
      },
      // `admin.readOnly` alone is spoofable over the API.
      access: serverOnlyField,
    },
  ],
}
