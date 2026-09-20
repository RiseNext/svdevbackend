import { fileTypeFromBuffer } from 'file-type'

/**
 * MAGIC-BYTE SNIFFING. 100% ours — PAYLOAD DOCUMENTS NO CONTENT SNIFFING
 * ANYWHERE, and puts the onus on us explicitly: "Remember that all custom hooks
 * attached to the media collection will still trigger. Ensure that files match
 * the specified mimeTypes or sizes."
 *
 * A `.jpg` extension proves nothing, and neither does a declared `Content-Type`
 * on a multipart part — both are attacker-controlled.
 */

export type SniffResult = {
  /** The MIME type actually implied by the file's bytes. */
  mime: string
  /** The canonical extension for that type, derived from the BYTES not the name. */
  ext: string
}

/**
 * SVG detection, done by hand as well as by `file-type`.
 *
 * SVG is TEXT, so byte-signature sniffers are not always decisive on it — a file
 * beginning with whitespace, a BOM, an XML declaration or a comment can slip
 * past a naive check. And SVG is the one type where a false negative is a stored
 * XSS vector: an SVG is an HTML document that can carry `<script>`.
 *
 * 🔴 SVG IS NOT ON PAYLOAD'S RESTRICTED-FILE-TYPE LIST. That list covers
 * executables, scripts, HTML/PHP/JS, .hta, .reg and similar — 30 entries, none
 * of them image/svg+xml. Worse: "If your Collection has defined mimeTypes …
 * restricted file verification WILL BE SKIPPED", and Payload's own documented
 * example is `mimeTypes: ['image/*']`, WHICH INCLUDES image/svg+xml.
 * Never copy that example.
 */
export const looksLikeSvg = (buffer: Buffer): boolean => {
  // Only the head matters, and decoding a megabyte to check for '<' is wasteful.
  const head = buffer
    .subarray(0, 2048)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase()

  if (head.startsWith('<svg')) return true
  if (head.startsWith('<?xml')) {
    // An XML prologue followed by an <svg> root anywhere in the head.
    if (head.includes('<svg')) return true
    // A DOCTYPE svg is equally conclusive.
    if (head.includes('<!doctype svg')) return true
  }
  // A leading XML comment or processing instruction can precede the root.
  if (head.startsWith('<!--') && head.includes('<svg')) return true
  return false
}

/**
 * HTML/script smuggling inside something claiming to be an image. Cheap, and it
 * closes the "polyglot file" trick where a valid image header is followed by
 * markup that a mis-sniffing browser will execute.
 */
export const looksLikeMarkup = (buffer: Buffer): boolean => {
  const head = buffer
    .subarray(0, 512)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase()
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<script')
}

/** PDFs start with `%PDF-`. Checked directly rather than trusting the sniffer. */
export const looksLikePdf = (buffer: Buffer): boolean =>
  buffer.subarray(0, 5).toString('latin1') === '%PDF-'

export const sniff = async (buffer: Buffer): Promise<SniffResult | null> => {
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected) return null
  return { mime: detected.mime, ext: detected.ext }
}
