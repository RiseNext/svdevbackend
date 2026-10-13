import { APIError, type PayloadRequest } from 'payload'

/**
 * MAKES AUTHORED VALIDATION MESSAGES VISIBLE TO AN ADMINISTRATOR.
 *
 * ─── 🔴 THE DEFECT THIS EXISTS TO FIX (D-1), MEASURED IN A BROWSER ─────────
 *
 * A field `validate` that returns a string has its message DISCARDED before the
 * response leaves the server. Captured from the admin panel over HTTP:
 *
 *   POST /payload-api/media  ->  400
 *   {"errors":[{"message":"The following field is invalid: Alt"}]}
 *
 * There is no `path`, no per-field entry, and no trace of
 * "Alt text is required, or tick \"decorative\" …" anywhere in the rendered
 * DOM — not inline, not in a tooltip, not in the toast. Every one of the 41
 * authored messages in this repository was invisible.
 *
 * It is worse than merely unhelpful on arrays and groups, because the summary
 * names the TAB rather than the field. An administrator with one bad hero row
 * was shown:
 *
 *   "The following field is invalid: Content"
 *
 * instead of "Row 3: a YouTube entry needs a poster image — YouTube's own
 * thumbnail cannot be used here." One of those is actionable.
 *
 * ─── WHY A HOOK, AND WHY THIS IS NOT A WORKAROUND ──────────────────────────
 *
 * The contrast was established in the same browser session: an `APIError`
 * thrown from a collection hook arrives with its message intact and is rendered
 * verbatim in a toast. Proven against the testimonial consent gate, whose full
 * two-sentence message appears on screen.
 *
 * So the mechanism is: run the SAME validator functions the fields use, from a
 * `beforeValidate` hook, and throw one `APIError` carrying the real text.
 *
 * ⚠️ THE FIELD `validate` STAYS ATTACHED. This hook does not replace it:
 *   · `required: true` still paints the asterisk the editor navigates by;
 *   · the field validator is still the enforcement of record for any path this
 *     hook's check list does not cover, so a gap here degrades to the old
 *     generic summary rather than to no validation at all.
 * Both run, on every path, against one definition of each rule. Nothing is
 * weakened to improve the message.
 *
 * ⚠️ ALL FAILURES ARE COLLECTED, NOT JUST THE FIRST. Payload's own summary at
 * least names every invalid field; throwing on the first check would have been
 * a regression against that. One throw, every problem listed.
 */

export type FieldCheck = {
  /**
   * Dot path to the value, relative to the document root. Tabs are unnamed in
   * this schema so they contribute nothing to the path: `description`,
   * `heroMedia`, `promoVideo.youtubeUrl`.
   */
  path: string
  /** What the administrator sees this field called on screen. */
  label: string
  /** The field's own validator. Must be the SAME function the field config uses. */
  validate: (value: unknown, doc: Record<string, unknown>) => true | string
}

type Options = {
  /**
   * 🔴 FOR A DRAFTS-ENABLED COLLECTION THIS MUST BE TRUE, OR THE FIX BREAKS
   * "DRAFTS ARE SCRATCH".
   *
   * `versions.drafts.validate: false` is a deliberate design decision on
   * `projects`, `blog-posts`, `testimonials`, `faqs` and `statistics`: an
   * editor must be able to save a half-finished record and come back tomorrow.
   * Payload implements it by passing `skipValidation` into the FIELD pipeline
   * only — COLLECTION `beforeValidate` hooks still run on a draft save.
   *
   * So a hook that validated unconditionally would start rejecting draft saves
   * that are currently allowed: a worse defect than the one being fixed, and
   * invisible until an editor lost work. With this set, the checks run only
   * when the merged document is being published, which is exactly when the
   * field validators run today.
   */
  onlyWhenPublished: boolean
}

const readPath = (doc: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, doc)

/**
 * Formats one or many failures into a single message.
 *
 * The label is prefixed because the authored strings are deliberately written
 * about the VALUE ("Add at least one line.") and say nothing about which field
 * they belong to — which is fine inline under an input, and useless in a toast.
 * Array messages already carry their own row number, so the result reads
 * "Hero media — Row 3: a YouTube entry needs a poster image …".
 */
const format = (failures: readonly { label: string; message: string }[]): string => {
  if (failures.length === 1) {
    const { label, message } = failures[0]!
    return `${label} — ${message}`
  }
  const list = failures.map((f) => `${f.label} — ${f.message}`).join(' · ')
  return `${failures.length} fields need attention. ${list}`
}

type HookArgs = {
  data?: Record<string, unknown> | null
  originalDoc?: Record<string, unknown> | null
  operation?: string
  req?: PayloadRequest
  context?: Record<string, unknown>
}

export const surfaceValidationErrors =
  (checks: readonly FieldCheck[], { onlyWhenPublished }: Options) =>
  (args: HookArgs): Record<string, unknown> | null | undefined => {
    const { data, originalDoc } = args

    /**
     * ⚠️ MERGED, NOT `data` ALONE. On an update Payload sends only the CHANGED
     * fields, so validating `data` by itself would report every untouched field
     * as missing — which is what makes a publish-only-changes-`_status` save
     * (exactly what the Publish button sends) fail on a complete document.
     */
    const merged = { ...(originalDoc ?? {}), ...(data ?? {}) }

    if (onlyWhenPublished && merged._status !== 'published') return data

    const failures: { label: string; message: string }[] = []
    for (const check of checks) {
      // A path absent from BOTH data and originalDoc is genuinely absent; the
      // validator decides whether that is an error (required) or fine.
      const value = readPath(merged, check.path)
      let result: true | string
      try {
        result = check.validate(value, merged)
      } catch {
        // A validator that throws is a bug in the validator, not an invalid
        // document. Fall through to the field pipeline rather than blaming the
        // administrator for it.
        continue
      }
      if (result !== true) failures.push({ label: check.label, message: result })
    }

    if (failures.length > 0) {
      throw new APIError(format(failures), 400, {
        errors: failures.map((f) => ({ field: f.label, message: f.message })),
      })
    }

    return data
  }
