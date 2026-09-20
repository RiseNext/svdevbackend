/**
 * THE 41 ICON NAMES — one source of truth, CI-diffed against
 * `svfrontend/src/components/ui/Icon.tsx` by `src/scripts/checkIconDrift.ts`.
 *
 * WHY THIS IS A CLOSED ENUM AT THE DATABASE LAYER:
 * `Icon.tsx:50` is `const shapes: Record<IconName, ReactNode>` — an EXHAUSTIVE
 * mapped type. Adding a name to the union without adding an SVG is a TypeScript
 * error, so the CMS *cannot* introduce a new icon; adding one is a frontend code
 * change first (D-007). The 41 values are therefore genuinely closed, and a
 * Postgres enum is the correct representation.
 *
 * WHY IT MATTERS: an unknown icon renders as "a silent, invisible 24px blank
 * box. No error, no warning, no visual indication in logs." That is the worst
 * failure mode in the codebase, which is why there are three layers against it:
 * the Postgres enum, this CI drift check, and the serialiser's fallback.
 *
 * The count is 41, not 40 — A5 §9.4's "40" is a counting error (CONF-79).
 * All 41 are pure camelCase alphanumerics: zero hyphens, zero special
 * characters, so they satisfy GraphQL enum naming constraints verbatim and need
 * no translation layer in the serialiser.
 */
export const ICON_NAMES = [
  'arrowRight',
  'bank',
  'bolt',
  'briefcase',
  'bus',
  'check',
  'chevronDown',
  'chevronRight',
  'city',
  'close',
  'compass',
  'document',
  'download',
  'drain',
  'droplet',
  'external',
  'facebook',
  'fence',
  'hospital',
  'instagram',
  'key',
  'lamp',
  'mail',
  'mapPin',
  'menu',
  'phone',
  'plane',
  'road',
  'route',
  'ruler',
  'school',
  'shield',
  'shop',
  'star',
  'temple',
  'train',
  'tree',
  'wall',
  'whatsapp',
  'youtube',
  'zoomIn',
] as const

export type IconName = (typeof ICON_NAMES)[number]

export const ICON_NAME_SET: ReadonlySet<string> = new Set(ICON_NAMES)

export const isIconName = (value: unknown): value is IconName =>
  typeof value === 'string' && ICON_NAME_SET.has(value)

/**
 * The defensive serialiser fallback. Unreachable given the database enum — which
 * is the point: it guards the failure mode (an invisible blank box) rather than
 * the likely case.
 */
export const ICON_FALLBACK: IconName = 'check'

export const coerceIcon = (value: unknown): IconName => (isIconName(value) ? value : ICON_FALLBACK)

/** `chevronDown` -> `Chevron down`. Used only for admin dropdown labels. */
export const humaniseIcon = (value: string): string => {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
