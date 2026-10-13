/**
 * SERVER-SIDE YOUTUBE LINK VALIDATION — one definition, four call sites.
 *
 * ─── 🔴 THE DEFECT THIS CLOSES ─────────────────────────────────────────────
 *
 * There was NO server-side format validation on any YouTube field. Measured: a
 * `heroMedia` row with `youtubeUrl: 'https://vimeo.com/123'` saved with a 200
 * and no warning. The frontend's `youtubeId()` then returned `null`, the play
 * button was never rendered, and the slide showed its poster image forever —
 * with nothing in any log and nothing in the admin panel. An administrator who
 * pasted a channel page, a playlist, an `@handle` link or anything copied out
 * of YouTube Studio got a silently dead slide and no way to find out why.
 *
 * Four fields were affected: `site-settings.heroMedia[].youtubeUrl`,
 * `projects.videos[].youtubeUrl`, `projects.promoVideo.youtubeUrl` and
 * `blog-posts.video.youtubeUrl`.
 *
 * ─── 🔴 WHY THE LOGIC IS COPIED RATHER THAN IMPORTED ───────────────────────
 *
 * The arbiter has always been `svfrontend/src/lib/blog.ts` `youtubeId()`. The
 * backend cannot import from the frontend repository, so the host set, the id
 * shape and the path prefixes are mirrored here DELIBERATELY and must stay in
 * step. `checkAllDrift.ts` already guards exactly this class of cross-repo copy
 * for the icon enum and the four public contracts; a matching check belongs
 * here if either side is ever widened.
 *
 * Accepting a SUPERSET would be worse than useless — it would restore the
 * silent failure for whatever the frontend still rejects — so this is written
 * to accept exactly what `youtubeId()` accepts and nothing more.
 */

/** Exactly 11 characters of the YouTube id alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * An EXACT host set, never a suffix test. `endsWith('youtube.com')` would
 * accept `notyoutube.com` and `youtube.com.evil.net`.
 */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
])

/** Path forms that carry the id in the NEXT segment: /shorts/<id>, /embed/<id>… */
const ID_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v'])

/**
 * Returns the 11-character video id, or `null` if this is not a link the
 * website can play. Mirrors `svfrontend/src/lib/blog.ts` `youtubeId()`.
 */
export const youtubeId = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // A bare id is accepted, as the frontend accepts it.
  if (YOUTUBE_ID.test(trimmed)) return trimmed

  let url: URL
  try {
    // A scheme-less paste ("youtu.be/xxxx") is common from the Share sheet.
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be') {
    const id = segments[0] ?? ''
    return YOUTUBE_ID.test(id) ? id : null
  }

  if (!YOUTUBE_HOSTS.has(host)) return null

  const v = url.searchParams.get('v')
  if (v && YOUTUBE_ID.test(v)) return v

  const [prefix, id] = segments
  if (prefix && id && ID_PATH_PREFIXES.has(prefix) && YOUTUBE_ID.test(id)) return id

  return null
}

/**
 * The message an administrator actually sees. Names the two shapes the Share
 * button produces, because "invalid URL" tells someone nothing about what to do
 * next — and lists the paste that is most often the cause.
 */
export const YOUTUBE_URL_MESSAGE =
  'That is not a YouTube video link the website can play. Open the video on YouTube, press Share, then Copy — the link should look like https://youtu.be/XXXXXXXXXXX or https://www.youtube.com/watch?v=XXXXXXXXXXX. A channel page, a playlist, an @handle link or a link copied from YouTube Studio will not work.'

/**
 * Field-level validator. Empty is allowed — whether the link is REQUIRED is the
 * surrounding array's business (a `kind: 'youtube'` row demands one), and
 * duplicating that here would reject legitimately blank optional fields such as
 * `projects.promoVideo.youtubeUrl`.
 */
export const validateYoutubeUrl = (value: unknown): true | string => {
  if (value === undefined || value === null || value === '') return true
  if (typeof value !== 'string') return YOUTUBE_URL_MESSAGE
  if (value.trim() === '') return true
  return youtubeId(value) ? true : YOUTUBE_URL_MESSAGE
}
