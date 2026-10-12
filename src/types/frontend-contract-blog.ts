import type { ImageRef } from '@/types/content';

/* =============================================================================
   THE BLOG CONTRACT — written BEFORE the endpoint exists, deliberately.

   🔴 NOTHING SERVES THIS YET. There is no `/blog-posts` on the CMS as of
   8 Oct 2026. This file is the SPEC the backend implements against, and every
   component downstream is built so the page renders its honest empty state
   until the endpoint answers — see the `fallback` in `src/lib/api/blog.ts`.
   The blog therefore goes live by the API starting to return rows. No frontend
   deploy, no code change, nothing to unpick first.

   ─── WHY THIS IS A NEW FILE AND NOT AN EDIT TO `content.ts` ────────────────
   `types/content.ts` is the contract for everything already shipping against a
   live backend. A brand-new collection gets its own file so that adding the
   blog cannot destabilise the project and site-settings reads — the same
   reasoning that keeps `lib/api/blog.ts` separate from `lib/api/content.ts`.

   ─── THE ONE RULE FOR THE BACKEND ─────────────────────────────────────────
   A published post MUST carry at least one of `body`, `video` or
   `externalUrl`. All three absent is a post with nothing to show: the card
   would promise a destination that renders a title and no content. Enforce it
   at the publish hook rather than hoping — the frontend cannot invent a body.
   ========================================================================== */

/** Derived, never stored — see `postKind()` in `src/lib/blog.ts`. A post is a
 *  video post when it has a video, and an article otherwise. Modelling this as
 *  a second CMS field would let the two disagree. */
export type BlogPostKind = 'article' | 'video';

/**
 * The YouTube half of a post.
 *
 * 🔴 `youtubeUrl` IS WHATEVER THE ADMIN PASTED, AND THAT IS THE POINT. The
 * frontend parses the id out of it (`youtubeId()` in `src/lib/blog.ts`), and
 * it accepts every form a share button hands out:
 *
 *     https://www.youtube.com/watch?v=<id>
 *     https://youtu.be/<id>
 *     https://www.youtube.com/shorts/<id>
 *     https://www.youtube.com/embed/<id>        · with or without &t=, ?si=, …
 *
 * Do NOT ask the admin for a bare id, and do not extract one in the backend
 * either: a field labelled "video id" gets a full URL pasted into it on the
 * first day, and then nothing works. One field, "paste the YouTube link", and
 * an unparseable value degrades to a plain outbound link rather than a broken
 * embed.
 */
export type BlogVideo = {
  /** The watch/share URL, verbatim as pasted. */
  youtubeUrl: string;
  /**
   * Running time as PRINTED on the card — `12:40`, `1:05:22`. Optional and
   * ADMIN-TYPED: YouTube does not reveal duration without a Data API call and
   * a key, which is not worth a quota for a badge. No value, no badge.
   */
  duration?: string;
};

/**
 * One post. The LIST endpoint may omit `body` — see `BlogPostCard`.
 *
 * Required fields are the ones every post has whatever its kind. Everything
 * else is optional BY DESIGN: a post with no cover photograph renders a
 * type-only card rather than a grey box, and a video post with no commentary
 * drops its prose section instead of showing an empty one. Do not add a field
 * to make a card look complete.
 */
export type BlogPost = {
  /** URL-safe and STABLE: it is the post's address. Changing it breaks every
   *  link already shared, so the backend should freeze it after first publish
   *  rather than re-deriving it from an edited title. */
  slug: string;
  title: string;
  /** Card copy and the meta description. Two or three lines — it is the only
   *  body text that reaches the index, and a truncated paragraph reads worse
   *  than a written summary. */
  excerpt: string;
  /** ISO 8601 (`2026-10-08` or a full timestamp). Rendered as the mono date
   *  badge and as `<time dateTime>`, so it must parse — a display string like
   *  "Oct 2026" cannot do the second job. */
  publishedAt: string;
  /** One free-text label for the mono chip, e.g. 'Buying guide', 'Site update'.
   *  The index's filter is kind (article/video), not topic, so this is a label
   *  and not a taxonomy — no need for a second collection. */
  topic?: string;
  /** Shown as a byline when present. Omit rather than defaulting to the
   *  company name: "SV Developers" under a company blog post is noise. */
  author?: string;
  /**
   * Card and header image.
   *
   * 🔴 THE HOST MUST BE IN `next.config.mjs` `images.remotePatterns` — i.e.
   * the Cloudinary delivery origin in NEXT_PUBLIC_MEDIA_BASE_URL. next/image
   * throws "hostname is not configured" at build time otherwise, which fails
   * the whole build rather than one card.
   *
   * STRONGLY PREFERRED ON VIDEO POSTS TOO. Without it the card falls back to
   * YouTube's own thumbnail, which is served from `i.ytimg.com` — a host that
   * is deliberately NOT in the allowlist, so it renders through a plain `<img>`
   * with none of next/image's resizing. It works and it is not pretty. If the
   * backend can pull the thumbnail into Cloudinary at save time and emit it
   * here, every card gets the same treatment.
   */
  cover?: ImageRef;
  /** Present => this is a video post. */
  video?: BlogVideo;
  /**
   * 🔴 THE SWITCH THAT DECIDES WHERE A CARD GOES, and the only one.
   *
   * SET  — the post lives somewhere else (a news site, LinkedIn, a PDF). The
   *        card leaves this site, marked with the outbound icon, and no page is
   *        rendered at `/blog/<slug>`.
   * EMPTY— the post lives here. The card goes to `/blog/<slug>`, which renders
   *        `body` and, on a video post, the player.
   *
   * It is deliberately NOT inferred from "has a body": inference means an admin
   * who fills in both cannot tell which one wins. One field, one meaning, and
   * `body` on an external post is simply unused.
   */
  externalUrl?: string;
  /**
   * The article itself, ONE STRING PER PARAGRAPH.
   *
   * This is the shape `Project.description` already uses, and copying it is
   * the point: it needs no rich-text renderer, no sanitiser and no decision
   * about Lexical vs HTML vs Markdown, and it cannot carry markup that breaks
   * the page's typography. If the client later needs headings, lists and
   * inline links inside an article, that is a real conversation — not a
   * `dangerouslySetInnerHTML` added quietly.
   *
   * Only the SINGLE-POST endpoint needs to return it.
   */
  body?: readonly string[];
};

/**
 * The card shape: exactly the fields the index reads, and a subset of
 * `BlogPost`, so a full record still satisfies it.
 *
 * `body` IS ABSENT ON PURPOSE. The list endpoint should not ship every
 * paragraph of every post to render a grid of summaries — the same
 * over-fetching argument `ProjectCard` makes. The index never needs it: where
 * a card goes is decided by `externalUrl` alone.
 */
export type BlogPostCard = Pick<BlogPost, 'slug' | 'title' | 'excerpt' | 'publishedAt'> &
  Partial<Pick<BlogPost, 'topic' | 'author' | 'cover' | 'video' | 'externalUrl'>>;
