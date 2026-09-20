import { DEFAULT_SITE_NAME } from '@/lib/constants'

import { escapeHtml } from './escapeHtml'

/**
 * ONE hand-written layout function. NO TEMPLATING LIBRARY.
 *
 * Reason: there are exactly two email bodies in this system, both under twenty
 * lines. A template engine, a CSS inliner and a build step would be more moving
 * parts than the thing they render.
 *
 * Table-based layout with inline styles, because that is still what email
 * clients reliably render.
 */

export type BrandedEmailArgs = {
  heading: string
  intro?: string
  /** Pre-escaped, caller's responsibility. Used for links and buttons. */
  bodyHtml?: string
  /** `[label, value]` pairs. VALUES MUST ALREADY BE ESCAPED by the caller. */
  rows?: [string, string][]
  footer?: string
}

/**
 * Last-resort footer, used only when the caller supplies none.
 *
 * The company name is CMS data (`site-settings.name`). `renderLeadEmail` reads
 * it and passes a real footer in; this default exists so a template can still
 * render if that lookup fails. See DEFAULT_SITE_NAME.
 */
const DEFAULT_FOOTER = `Sent automatically by the ${DEFAULT_SITE_NAME} website.`

export const renderBrandedEmail = (args: BrandedEmailArgs): string => {
  const rows = (args.rows ?? [])
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 0;vertical-align:top;color:#6b6b6b;font-size:13px;width:140px">${escapeHtml(label)}</td>
          <td style="padding:8px 0;vertical-align:top;color:#1a1a1a;font-size:15px">${value || '&mdash;'}</td>
        </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(args.heading)}</title></head>
<body style="margin:0;padding:0;background:#f5f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f2;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px">
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1a1a1a;font-weight:600">${escapeHtml(args.heading)}</h1>
          ${args.intro ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4a4a4a">${escapeHtml(args.intro)}</p>` : ''}
          ${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e8e6e3;margin-top:8px">${rows}</table>` : ''}
          ${args.bodyHtml ?? ''}
          <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e8e6e3;font-size:12px;color:#8a8a8a">${escapeHtml(args.footer ?? DEFAULT_FOOTER)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** The plaintext alternate. Never optional: a text/plain part materially
 *  improves deliverability and is what a spam filter reads first. */
export const renderPlainEmail = (args: BrandedEmailArgs): string => {
  const lines = [args.heading, '']
  if (args.intro) lines.push(args.intro, '')
  for (const [label, value] of args.rows ?? []) {
    // Rows arrive HTML-escaped for the HTML part; undo that for plaintext.
    const plain = value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    lines.push(`${label}: ${plain || '-'}`)
  }
  lines.push('', args.footer ?? DEFAULT_FOOTER)
  return lines.join('\n')
}
