import type { ImageRef, VideoRef } from '@/types/content';

/* =============================================================================
   THE HERO MEDIA CONTRACT — images, uploaded video and YouTube in ONE ordered
   list.

   ─── WHY THIS IS A NEW FILE AND NOT AN EDIT TO `content.ts` ────────────────
   `types/content.ts` is vendored into svbackend and byte-compared by its
   `check:drift`, so it is the contract for everything already shipping against
   a live backend — `VideoRef` and the whole project record included. A brand
   new shape gets its own file, exactly as `types/blog.ts` did, so that adding
   the hero's image support cannot destabilise the project and site-settings
   reads. The backend vendors THIS file separately and diffs it separately.

   ─── IT SUPERSEDES `heroVideos` WITHOUT REPLACING IT ──────────────────────
   🔴 `site-settings.heroVideos` IS STILL EMITTED AND STILL RENDERED. One hero
   video is live in production through it right now. The hero prefers
   `heroMedia` when the API returns a non-empty list and falls back to mapping
   `heroVideos` into `{ kind: 'video' }` entries otherwise — see
   `heroItems()` in `src/lib/heroMedia.ts`.

   That is what makes this additive: an administrator who never opens the new
   field sees no change on the site, and there is no content migration. The
   legacy field can be retired later, as its own decision.

   ─── ORDER IS THE CONTRACT ────────────────────────────────────────────────
   Array index IS slideshow order, across all three kinds. The admin's
   drag-to-reorder is the only thing that decides it; neither the backend
   serialiser nor the frontend may sort.
   ========================================================================== */

/**
 * A hero photograph.
 *
 * 🔴 THE HOST MUST BE IN `next.config.mjs` `images.remotePatterns` — i.e. the
 * Cloudinary delivery origin in NEXT_PUBLIC_MEDIA_BASE_URL. These render
 * through `next/image`, which throws "hostname is not configured" at BUILD
 * time for an unlisted host — failing the whole build rather than one slide.
 * The backend emits it through the same `toImageRef` every other image on the
 * site uses, so the host is the configured one by construction.
 *
 * `alt` comes from the Media library entry rather than from a field on the
 * hero row, which is what stops a hero photograph being accessible in one
 * place and not the other.
 */
export type HeroImage = {
  kind: 'image';
  src: string;
  alt: string;
  width: number;
  height: number;
  /** Names the slide for the slideshow's controls. Not rendered as body copy. */
  title?: string;
};

/**
 * An uploaded MP4, played silently and looped — the behaviour the hero has
 * always had.
 *
 * Identical in shape to `VideoRef` plus the discriminant, and that is
 * deliberate: the backend resolves it through the SAME helper that serves
 * `heroVideos`, so a video reached either way is byte-identical.
 *
 * 🔴 `src` IS NOT SUBJECT TO next/image's HOST ALLOWLIST, because `<video>` is
 * not next/image. A wrong host here therefore fails SILENTLY at runtime rather
 * than loudly at build time, which makes it more dangerous than an image, not
 * less.
 */
export type HeroVideo = {
  kind: 'video';
  src: string;
  /** Still frame. Always emitted by the CMS — `videos.poster` is required. */
  poster?: string;
  title?: string;
};

/**
 * A YouTube link, played through a real YouTube embed.
 *
 * 🔴 A YOUTUBE SLIDE DOES NOT AUTOPLAY, AND THAT IS A DESIGN DECISION RATHER
 * THAN A LIMITATION. It renders its poster with a play control and mounts the
 * iframe on the click — the same facade `YouTubeEmbed` uses everywhere else on
 * this site. Three reasons, all of which apply harder in a hero than anywhere:
 *
 *   · A YouTube iframe costs roughly a megabyte of third-party script and
 *     several connections BEFORE anyone decides to watch. In the hero that is
 *     the first screen's entire budget, on every single visit.
 *   · The embed sets tracking cookies on load. Loading it only on an explicit
 *     click means a visitor who never plays it is never tracked.
 *   · Autoplay would be refused anyway on iOS Low Power Mode and Data Saver,
 *     so the poster is what many visitors would see regardless.
 *
 * 🔴 `poster` IS REQUIRED HERE, unlike on `HeroVideo`. YouTube's own thumbnails
 * are served from `i.ytimg.com`, which is deliberately NOT in the image
 * allowlist — so without a CMS poster there is nothing to show before the
 * click. The backend drops a YouTube row that has no poster rather than
 * emitting a blank slide.
 *
 * `youtubeUrl` is whatever the administrator pasted. The id is parsed out with
 * `youtubeId()` at the render site, which accepts every form a share button
 * produces; an unparseable value drops the slide rather than rendering a dead
 * player.
 */
export type HeroYouTube = {
  kind: 'youtube';
  youtubeUrl: string;
  poster: string;
  title?: string;
};

/**
 * One hero slide.
 *
 * 🔴 `kind` IS A STORED FIELD, NOT DERIVED, and the backend enforces that each
 * row carries the source its kind promises. Deriving the type from "which
 * field is populated" would mean an administrator who filled in two could not
 * tell which one wins — the same reasoning that keeps `BlogPost.externalUrl`
 * an explicit switch rather than an inference from "has a body".
 */
export type HeroMediaItem = HeroImage | HeroVideo | HeroYouTube;

/** The legacy shape, for the fallback path. Re-exported so the hero's own
 *  modules need one import rather than two. */
export type { ImageRef, VideoRef };
