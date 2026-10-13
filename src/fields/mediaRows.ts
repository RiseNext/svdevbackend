import { youtubeId } from './youtubeUrl'

/**
 * THE MEDIA-ROW RULE — shared by `site-settings.heroMedia` and
 * `projects.videos`.
 *
 * Both are arrays of rows whose `kind` select decides which sibling field is
 * mandatory, and both were implemented as separate inline validators producing
 * the same four messages. `heroMedia` additionally accepts `image`.
 *
 * 🔴 WHY THE ROW RULE CANNOT LIVE ON THE SUB-FIELDS. `admin.condition` hides a
 * sibling; it does not require it, and it does not stop the REST API writing a
 * `youtubeUrl` onto a `kind: 'image'` row. A row whose kind and source disagree
 * is UNRENDERABLE — the serialiser drops it — so the administrator would see an
 * entry in the list that never appears on the site, with nothing to explain
 * why. The rule is a property of the ROW, so it is validated at the array.
 *
 * ⚠️ THE MESSAGES NAME THE ROW NUMBER, and that is the whole point of D-1. The
 * generic summary for this field reads "The following field is invalid: Content"
 * — the name of the TAB. "Row 3: a YouTube entry needs a poster image" is the
 * difference between a fixable problem and a hunt.
 */

export type MediaRowKinds = {
  /** `kind: 'image'` requires `image`. Only `heroMedia` has this. */
  image?: boolean
  /** `kind: 'video'` requires `video`. */
  video?: boolean
  /** `kind: 'youtube'` requires `youtubeUrl` AND `poster`. */
  youtube?: boolean
}

export type MediaRowsOptions = {
  kinds: MediaRowKinds
  /** Used in the "must be a list" message: "Hero media" / "Videos". */
  noun: string
}

/**
 * Collects EVERY offending row rather than returning on the first.
 *
 * The previous inline validators returned on the first failure, so an
 * administrator with three broken rows fixed them one save at a time and was
 * told about one of them each time. There is no reason for that: the rows are
 * all in hand.
 */
export const validateMediaRows =
  ({ kinds, noun }: MediaRowsOptions) =>
  (value: unknown): true | string => {
    if (value === undefined || value === null) return true
    if (!Array.isArray(value)) return `${noun} must be a list.`

    const problems: string[] = []

    value.forEach((raw, i) => {
      const row = raw as Record<string, unknown> | null
      if (!row) return
      const at = `Row ${i + 1}`
      const kind = row.kind

      if (kinds.image && kind === 'image' && !row.image) {
        problems.push(`${at}: choose a photograph, or change its type.`)
        return
      }
      if (kinds.video && kind === 'video' && !row.video) {
        problems.push(`${at}: choose an uploaded video, or change its type.`)
        return
      }
      if (kinds.youtube && kind === 'youtube') {
        const url = typeof row.youtubeUrl === 'string' ? row.youtubeUrl.trim() : ''
        if (!url) {
          problems.push(`${at}: paste a YouTube link, or change its type.`)
          return
        }
        /**
         * 🔴 THE FORMAT IS CHECKED HERE TOO, not only on the sub-field.
         *
         * The sub-field validator (`validateYoutubeUrl`) is what rejects a
         * Vimeo link, but its message is one of the ones Payload hides. Running
         * the same check at the row level means the administrator is told
         * WHICH ROW is wrong, which the sub-field message cannot say.
         */
        if (!youtubeId(url)) {
          problems.push(
            `${at}: that is not a YouTube video link the website can play. Use the link YouTube's Share button gives you.`,
          )
          return
        }
        if (!row.poster) {
          problems.push(
            `${at}: a YouTube entry needs a poster image — YouTube's own thumbnail cannot be used here.`,
          )
        }
      }
    })

    if (problems.length === 0) return true
    return problems.join(' · ')
  }
