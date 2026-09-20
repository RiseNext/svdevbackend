/**
 * ONE reviewed, unit-tested HTML escaper.
 *
 * 🔴 PAYLOAD PROVIDES ZERO ESCAPING and ships no templating engine:
 * "Payload doesn't ship with an HTML templating engine, so you are free to
 * choose your own."
 *
 * `lead.name` and `lead.message` are PUBLIC FREE TEXT going straight into an
 * HTML email read by SV staff. React escapes by default in the admin panel; an
 * email has no such guarantee. This is a shared, tested helper rather than an
 * inline `.replace()` at the call site, because an inline one gets copied,
 * abbreviated and eventually forgotten.
 *
 * Order matters: `&` must be escaped FIRST, or the ampersands introduced by the
 * later replacements get double-escaped.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
