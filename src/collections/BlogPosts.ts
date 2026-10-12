import type { CollectionConfig } from 'payload'

import { isAdmin, publishedOrAuthenticated } from '@/access'
import { slugField } from '@/fields/slugField'
import { auditAfterChange, auditAfterDelete } from '@/hooks/audit'
import { blogPublishGate, blogSlugLock } from '@/hooks/blogHooks'
import { revalidateBlogPost } from '@/hooks/revalidate'
import { LIMITS, MAX_DESCRIPTION_PARAGRAPHS } from '@/lib/constants'

/**
 * `blog-posts` — articles and video posts for `/blog` and `/blog/<slug>`.
 *
 * 🔴 THE FRONTEND WROTE THIS CONTRACT FIRST, AND IT IS THE SPEC.
 * `svfrontend/src/types/blog.ts` and `svfrontend/src/lib/api/blog.ts` were
 * committed before any endpoint existed, deliberately, with the page built to
 * render an honest empty state until the API answers — which is what
 * `sv-dev-phi.vercel.app/blog` does in production today ("Nothing published
 * yet"). This collection is implemented AGAINST those two files; where a comment
 * anywhere disagrees with them, they win.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 * 🔴 NO RICH TEXT, NO HTML, NO LEXICAL. `body` is one string per paragraph —
 * the shape `projects.description` already uses. The frontend renders one `<p>`
 * per entry with no sanitiser and no `dangerouslySetInnerHTML`, and its own note
 * is explicit that headings and inline links "would be a real conversation —
 * not a `dangerouslySetInnerHTML` added quietly". Adding a rich-text field here
 * would be a contract change the frontend cannot consume.
 *
 * 🔴 NO UPLOADED VIDEO FIELD. `BlogVideo` is `{ youtubeUrl, duration? }` and
 * nothing else; there is no `<video>` element anywhere in the blog subsystem —
 * the detail page calls `youtubeId()` and renders the `YouTubeEmbed` facade.
 * Adding a `videos` relation would be a silent contract expansion, so it is
 * recorded as a separate scope decision rather than built on assumption.
 *
 * 🔴 NO `featured` FLAG. The index takes the FIRST row as its feature card, and
 * the frontend states why a flag is excluded: "'the latest' and 'the flagged
 * one' would then be two sources for one slot". Newest-first ordering IS the
 * feature mechanism.
 *
 * 🔴 NO `topic` COLLECTION. `topic` is one free-text chip. The index filters by
 * KIND (article/video), which is derived from `video`, not by topic — so a
 * taxonomy would be an editor screen nothing reads.
 */
export const BlogPosts: CollectionConfig = {
  slug: 'blog-posts',

  admin: {
    group: 'Content',
    useAsTitle: 'title',
    defaultColumns: ['title', 'publishedAt', 'topic', '_status', 'updatedAt'],
    listSearchableFields: ['title', 'topic', 'slug'],
    description:
      'Articles and video posts for the Blog page. Newest first is the public order, taken from “Published date” — the first post is shown as the large feature card. A post needs at least one of: paragraphs, a YouTube link, or an external article link.',
    // Same archive semantics as `projects`: a trashed post leaves the admin
    // list but its row survives, so an archived URL 404s rather than 500s.
    //
    // 🔴 NO `baseFilter` — see the long note on `projects`. Payload's own
    // `appendNonTrashedFilter` already hides archived rows from this list, and
    // a `baseFilter` additionally leaks into the Trash view as
    // `deleted_at IS NULL AND deleted_at IS NOT NULL`, which emptied the bin
    // and made "Restore" unreachable. It must stay absent.
    preview: (doc) =>
      typeof doc?.slug === 'string'
        ? `${process.env.REVALIDATE_WEBHOOK_URL?.replace(/\/api\/revalidate$/, '') ?? ''}/blog/${doc.slug}`
        : null,
  },

  /**
   * 🔴 EXPLICIT ON EVERY KEY, `readVersions` INCLUDED. Payload's default is
   * `Boolean(user)` — any authenticated user, full CRUD — and a config test
   * enumerates every collection and fails on a missing key. `readVersions`
   * matters here for the same reason it does on `projects`: version rows are a
   * second copy of every historical draft, and `GET /{api}/{collection}/versions`
   * exists on the generated REST surface.
   */
  access: {
    read: publishedOrAuthenticated,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    readVersions: isAdmin,
  },

  /**
   * 🔴 SORTED BY THE AUTHORED DATE, NOT BY `_order` AND NOT BY `createdAt`.
   * The frontend does not sort: "it takes the first row as the feature card and
   * renders the rest in the order given". So the public order is this one, and
   * `-publishedAt` is what "newest first" means for a blog — `createdAt` would
   * order by when a draft was started, which is not when it was published.
   *
   * ⚠️ NO `orderable: true`, deliberately. A fractional-index drag column would
   * be a SECOND source of order competing with the date, and the frontend reads
   * one list. A pinned evergreen post stays achievable later by sorting on an
   * added column, with no frontend change — which is exactly what its note
   * anticipates.
   */
  defaultSort: '-publishedAt',

  trash: true,

  versions: {
    maxPerDoc: 20,
    drafts: {
      // OFF for the reason recorded on `projects`: an 800ms autosave is a real
      // DB write firing every afterChange hook, which would call the
      // revalidation webhook roughly once per second while an author types.
      autosave: false,
      /**
       * 🔴 FALSE — DRAFTS ARE SCRATCH, PUBLISH IS VALIDATED. An author must be
       * able to save a title and come back tomorrow; `title`, `excerpt`,
       * `publishedAt` and `slug` are all required and none of them is knowable
       * at the moment a post is started. This is what makes `blogPublishGate`
       * fire only on publish, which is where the rule belongs.
       */
      validate: false,
      // No requirement asks for scheduled publishing, and enabling it without a
      // proven runner means an editor schedules a post and it silently never
      // fires. Same call as `projects`.
      schedulePublish: false,
    },
  },

  hooks: {
    beforeValidate: [blogSlugLock, blogPublishGate],
    afterChange: [auditAfterChange, revalidateBlogPost],
    // Archiving a published post must drop it from /blog, which is the same
    // refresh as publishing one.
    afterDelete: [auditAfterDelete, revalidateBlogPost],
  },

  fields: [
    /**
     * Derived from `title` rather than `name`, addressing `/blog/<slug>`, and
     * LOCKED after publish by `blogSlugLock`. The options are the only reason
     * `slugField` takes any: called bare it is byte-identical to the field
     * `projects` has always had.
     */
    slugField({
      routePrefix: '/blog',
      sourceField: 'title',
      noun: 'post',
      example: 'what-to-check-before-you-buy-a-plot',
    }),

    {
      name: 'title',
      type: 'text',
      required: true,
      maxLength: LIMITS.postTitle,
      admin: {
        description:
          'The headline. A sentence rather than a label — it is set in the display serif on the post’s own page.',
      },
    },

    {
      name: 'excerpt',
      type: 'textarea',
      required: true,
      maxLength: LIMITS.postExcerpt,
      admin: {
        description:
          'Two or three lines. This is the card copy AND the search-engine description, so write it rather than letting it be a truncated first paragraph.',
      },
    },

    {
      /**
       * 🔴 AUTHORED, NOT STAMPED — AND THIS IS THE ONE DECISION WHERE THIS
       * COLLECTION DEPARTS FROM `projects`.
       *
       * `projects` derives `publishedAt` with `stampPublishedAt`, which writes
       * the moment the Publish button was pressed and CLEARS it on unpublish.
       * That is right for a project, whose "published" date is an event.
       *
       * A post's date is editorial: it is printed on the card, it is the sort
       * key for the whole index, and an author back-dating an imported article
       * or preparing next Monday's post is ordinary. A stamped field cannot
       * express either, and clearing it on unpublish would silently reorder the
       * index when a post was pulled for an edit.
       *
       * The frontend requires it to PARSE (`new Date(publishedAt)`, rendered
       * into `<time dateTime>`), which a `date` field guarantees and a free-text
       * "Oct 2026" would not.
       */
      name: 'publishedAt',
      label: 'Published date',
      type: 'date',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayOnly', displayFormat: 'd MMM yyyy' },
        description:
          'The date printed on the card and used to order the Blog page, newest first. Set it yourself — this is NOT the moment you press Publish, so an older article can be added in its right place.',
      },
    },

    {
      name: 'topic',
      type: 'text',
      maxLength: LIMITS.postTopic,
      admin: {
        position: 'sidebar',
        description:
          'Optional one-word-ish label for the chip on the card, e.g. “Buying guide” or “Site update”. Free text — there is no fixed list.',
      },
    },

    {
      name: 'author',
      type: 'text',
      maxLength: LIMITS.postAuthor,
      admin: {
        position: 'sidebar',
        description:
          'Optional byline. Leave empty rather than entering the company name — “SV Developers” under a company blog post reads as noise.',
      },
    },

    {
      /**
       * The card and header image.
       *
       * ⚠️ RELATES TO THE EXISTING `media` COLLECTION, which is what makes this
       * field free: `toImageRef` already composes `/image/upload/media/**` — a
       * path `svfrontend/next.config.mjs` ALREADY allowlists — and `media` runs
       * the whole existing pipeline (sniffing, four-layer SVG rejection, EXIF
       * strip, intrinsic dimensions). A second image path here would duplicate
       * all of it.
       *
       * 🔴 THE HOST IS NOT COSMETIC. `next/image` throws "hostname is not
       * configured" at BUILD time for an unlisted host, which fails the whole
       * frontend build rather than one card. Reusing `media` is what guarantees
       * the host is the configured one.
       */
      name: 'cover',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description:
          'Optional. The picture on the card and at the top of the post. STRONGLY RECOMMENDED on video posts too: without one the card falls back to YouTube’s own thumbnail, which is served from a host the website cannot resize through.',
      },
    },

    {
      /**
       * THE VIDEO HALF. Present => the post is a video post; the frontend
       * derives its kind with `postKind()` and never reads a second field, "so
       * the badge on the card and the player on the page cannot disagree about
       * what a post is".
       */
      name: 'video',
      label: 'YouTube video',
      type: 'group',
      admin: {
        description:
          'Fill this in to make this a video post. Leave it empty for an article.',
      },
      fields: [
        {
          /**
           * 🔴 STORED EXACTLY AS PASTED. The frontend's own words: "Do NOT ask
           * the admin for a bare id, and do not extract one in the backend
           * either: a field labelled 'video id' gets a full URL pasted into it
           * on the first day, and then nothing works." `youtubeId()` parses
           * watch URLs, `youtu.be`, `/shorts/`, `/embed/`, `/live/` and bare
           * ids, tracking tail and all, and degrades an unparseable value to a
           * plain outbound link rather than a broken embed.
           *
           * ⚠️ NO SERVER-SIDE URL VALIDATION, for the same reason as
           * `projects.promoVideo`: one arbiter at the render site, not two
           * places to look. The trim is the only normalisation.
           */
          name: 'youtubeUrl',
          label: 'YouTube link',
          type: 'text',
          maxLength: LIMITS.url,
          hooks: {
            beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim() : value)],
          },
          admin: {
            description:
              'Paste the link exactly as YouTube’s Share button gives it — a watch link, a youtu.be link or a Shorts link all work.',
          },
        },
        {
          name: 'duration',
          label: 'Running time',
          type: 'text',
          maxLength: LIMITS.mediaDuration,
          admin: {
            description:
              'Optional, and typed by hand — e.g. “12:40”. YouTube does not reveal duration without an API key, so leave it empty rather than guessing; no value simply means no badge.',
          },
        },
      ],
    },

    {
      /**
       * 🔴 THE SWITCH THAT DECIDES WHERE A CARD GOES, and the only one.
       * SET => the card leaves the site and no page is rendered at
       * `/blog/<slug>`. EMPTY => the card goes to `/blog/<slug>`.
       *
       * ⚠️ DELIBERATELY NOT INFERRED from "has a body" — the frontend's
       * reasoning, kept because it is the same reasoning used for the hero's
       * media `kind`: "inference means an admin who fills in both cannot tell
       * which one wins". `body` on an external post is simply unused.
       */
      name: 'externalUrl',
      label: 'External article link',
      type: 'text',
      maxLength: LIMITS.url,
      hooks: {
        beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim() : value)],
      },
      admin: {
        description:
          'Optional. Set this ONLY when the post lives somewhere else (a news site, LinkedIn, a PDF) — the card will then link straight out and no page is built on this site. Leave empty for a post written here.',
      },
    },

    {
      /**
       * THE ARTICLE — ONE STRING PER PARAGRAPH.
       *
       * 🔴 `text` + `hasMany: true`, WHICH IS WHAT MAKES IT AN IDENTITY
       * SERIALISE to the `readonly string[]` the frontend declares. Identical
       * to `projects.description`, including the admin component: Payload
       * renders `text` + `hasMany` as a creatable react-select whose
       * placeholder is the literal "Select a value", and typed text is only
       * committed as a chip on Enter — clicking away DISCARDS it. That was
       * reported as "my paragraph became 'Select a value'", and
       * `ParagraphsField` is the existing fix. Reusing it is not a nicety; the
       * default control is unusable for a 5000-character paragraph.
       *
       * ⚠️ NOT `required`. An article needs paragraphs, but a VIDEO post or an
       * EXTERNAL post legitimately has none — `blogPublishGate` enforces "at
       * least one of the three" instead, which is the rule the contract states.
       */
      name: 'body',
      label: 'Article paragraphs',
      type: 'text',
      hasMany: true,
      maxRows: MAX_DESCRIPTION_PARAGRAPHS,
      admin: {
        description:
          'One entry per paragraph. Order is meaningful, and each paragraph must be unique — the website uses the text itself as a rendering key. Leave empty for a video-only or external post.',
        components: {
          Field: '@/components/admin/ParagraphsField#ParagraphsField',
        },
      },
      /**
       * Per-entry length and non-emptiness, plus uniqueness within the array —
       * three things no Payload built-in does on a `hasMany` text. Copied from
       * `projects.description` because the frontend renders both the same way
       * and a React key collision is silent on a prerendered page.
       */
      validate: (value: unknown): true | string => {
        if (value === undefined || value === null) return true
        if (!Array.isArray(value)) return 'Paragraphs must be a list.'
        if (value.length > MAX_DESCRIPTION_PARAGRAPHS) {
          return `At most ${MAX_DESCRIPTION_PARAGRAPHS} paragraphs.`
        }
        const seen = new Set<string>()
        for (const v of value) {
          if (typeof v !== 'string' || v.trim() === '') return 'Paragraphs cannot be empty.'
          if (v.length > LIMITS.postParagraph) {
            return `A paragraph may be at most ${LIMITS.postParagraph} characters.`
          }
          if (seen.has(v)) return 'Each paragraph must be unique.'
          seen.add(v)
        }
        return true
      },
    },
  ],
}
