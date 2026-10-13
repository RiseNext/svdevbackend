/**
 * THE PARAGRAPH-ARRAY RULE — one definition, two call sites.
 *
 * `projects.description` and `blog-posts.body` are the same field shape (a
 * `text` + `hasMany` array rendered by `ParagraphsField`) with the same five
 * rules. They were implemented as two near-identical inline validators, and
 * they had DRIFTED:
 *
 *   · `projects.description` compared paragraphs after `trim().toLowerCase()`
 *   · `blog-posts.body` compared them with `seen.has(v)` — exact match
 *
 * So two paragraphs differing only in capitalisation or a trailing space were
 * rejected on a project and accepted on a blog post, where they then collided
 * as React keys on the rendered page — the exact failure the uniqueness rule
 * exists to prevent. That is what two copies of one rule buys.
 *
 * ⚠️ THE DIFFERENCE IS NOW AN EXPLICIT PARAMETER, NOT AN ACCIDENT. Both call
 * sites pass `caseInsensitiveUniqueness: true`; the option exists so that
 * choosing otherwise has to be deliberate and visible in the diff.
 */

export type ParagraphsOptions = {
  /** Upper bound on the number of paragraphs. */
  maxRows: number
  /** Upper bound on one paragraph. */
  maxChars: number
  /**
   * Compare paragraphs after trim + lowercase. True for both call sites: the
   * frontend uses the text itself as a React key, and keys collide on the
   * rendered value, not on a case-sensitive comparison of the source.
   */
  caseInsensitiveUniqueness: boolean
  /**
   * Appended to the uniqueness message. `projects` explains WHY ("the website
   * uses the text itself as a rendering key"); the blog message was terser.
   * Kept as a parameter so neither message has to change to share the logic.
   */
  uniquenessMessage: string
  /** When false, an absent/empty array is allowed (an optional field). */
  required: boolean
}

export const validateParagraphs =
  (opts: ParagraphsOptions) =>
  (value: unknown): true | string => {
    if (value === undefined || value === null) {
      return opts.required ? 'Add at least one paragraph.' : true
    }
    if (!Array.isArray(value)) return 'Paragraphs must be a list.'
    if (value.length === 0) {
      return opts.required ? 'Add at least one paragraph.' : true
    }
    if (value.length > opts.maxRows) return `At most ${opts.maxRows} paragraphs.`

    for (const v of value) {
      if (typeof v !== 'string' || v.trim() === '') return 'Paragraphs cannot be empty.'
      if (v.length > opts.maxChars) {
        return `A paragraph may be at most ${opts.maxChars} characters.`
      }
    }

    const keys = opts.caseInsensitiveUniqueness
      ? value.map((v: string) => v.trim().toLowerCase())
      : (value as string[])
    if (new Set(keys).size !== keys.length) return opts.uniquenessMessage

    return true
  }
