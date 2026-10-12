/* =============================================================================
   THE PROJECT VIDEO CONTRACT — an ordered list of uploaded MP4s and YouTube
   links, per project.

   ─── WHAT THIS IS NOT ─────────────────────────────────────────────────────
   🔴 IT IS NOT THE IMAGE GALLERY. `Project.gallery` already holds multiple
   photographs per project and is untouched by this: images and videos are
   different media with different controls, different loading costs and
   different accessibility needs, and merging them into one list would mean the
   photo stepper and the video grid fighting over one ordering.

   🔴 IT IS NOT `promoVideo` EITHER, and that field stays exactly as it is.
   `promoVideo` is the SINGLE video that fills the pane on the homepage card —
   one project, one headline video, chosen deliberately. This list is the full
   set shown in a dedicated section on the project's own page. Two fields
   because they answer two different questions; a card that tried to render six
   videos would be a worse card, and a detail page that could only show one
   would be a worse page.

   So a project may have: many photographs (`gallery`), one card video
   (`promoVideo`), and many page videos (`videos`). All three are optional and
   independent, and a project with none of them renders exactly as it does
   today.

   ─── WHY THIS IS A NEW FILE ───────────────────────────────────────────────
   `types/content.ts` is vendored into svbackend and byte-compared by its
   `check:drift`, so it is the contract for everything already shipping against
   a live backend. A new shape gets its own file — as `types/blog.ts` and
   `types/heroMedia.ts` already did — so adding project videos cannot
   destabilise the project, site-settings or blog reads. The backend vendors
   and diffs this file separately.

   ─── ORDER IS THE CONTRACT ────────────────────────────────────────────────
   Array index IS display order. The admin's drag-to-reorder is the only thing
   that decides it; neither the backend serialiser nor the frontend may sort.
   ========================================================================== */

/**
 * An uploaded MP4, shown in the project's video section.
 *
 * 🔴 UNLIKE THE HERO, THIS DOES NOT AUTOPLAY AND IS NOT MUTED. A hero video is
 * decorative motion behind a headline; these are content a visitor chose to
 * look at. So they render with native controls and `preload="metadata"` —
 * N autoplaying muted loops in a grid would decode N video streams for a
 * section the visitor may never reach, which is the single most expensive thing
 * a page can do on a phone.
 *
 * 🔴 `src` IS NOT SUBJECT TO next/image's HOST ALLOWLIST, because `<video>` is
 * not next/image. A wrong host therefore fails SILENTLY at runtime rather than
 * loudly at build time, which makes it more dangerous than an image, not less.
 * The backend composes it with the same Cloudinary helper every other asset
 * uses, so the host is the configured one by construction.
 */
export type ProjectUploadedVideo = {
  kind: 'video';
  src: string;
  /** Still frame, shown before playback and while the file loads. Always
   *  emitted by the CMS — `videos.poster` is `required: true`. */
  poster?: string;
  /** Admin-supplied label, shown as the pane's caption and used as the
   *  accessible name. */
  title?: string;
};

/**
 * A YouTube link, played through a real YouTube embed.
 *
 * 🔴 CLICK TO PLAY, like every other YouTube surface on this site. The iframe
 * is mounted by the click, not on page load: a YouTube embed is roughly a
 * megabyte of third-party script and sets tracking cookies, and a project page
 * could carry several. Loading them eagerly would spend the page's whole budget
 * on videos most visitors scroll past, and would track every visitor who never
 * pressed play.
 *
 * 🔴 `poster` IS REQUIRED. YouTube's own thumbnails are served from
 * `i.ytimg.com`, which is deliberately NOT in `next.config.mjs`
 * `images.remotePatterns` — so without a CMS poster there is nothing to show
 * before the click. The backend drops a YouTube row that has no poster rather
 * than emitting a blank pane.
 *
 * `youtubeUrl` is whatever the administrator pasted. The id is parsed out with
 * `youtubeId()` at the render site, which accepts every form a share button
 * produces; an unparseable value drops the player and keeps the poster, so the
 * section still looks finished rather than broken.
 */
export type ProjectYouTubeVideo = {
  kind: 'youtube';
  youtubeUrl: string;
  poster: string;
  title?: string;
  /** Running time as PRINTED on the pane's badge — `2:14`. Optional and
   *  admin-typed: YouTube does not reveal duration without an API key. */
  duration?: string;
};

/**
 * One entry in a project's video list.
 *
 * 🔴 `kind` IS A STORED FIELD, NOT DERIVED, and the backend enforces that each
 * row carries the source its kind promises. Deriving the type from "which field
 * is populated" would mean an administrator who filled in both could not tell
 * which one wins — the same reasoning that keeps `BlogPost.externalUrl` an
 * explicit switch and `HeroMediaItem.kind` a stored one.
 */
export type ProjectVideo = ProjectUploadedVideo | ProjectYouTubeVideo;
