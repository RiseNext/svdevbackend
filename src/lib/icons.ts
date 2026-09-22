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

/**
 * THE ICON DRIFT INVARIANT: **BACKEND ⊆ FRONTEND**.
 *
 * Returns the backend icons the frontend cannot render — empty means no drift.
 *
 * 🔴 THE DIRECTION IS THE WHOLE POINT, AND IT IS ASYMMETRIC ON PURPOSE.
 *
 *   backend has an icon the frontend lacks  -> DANGEROUS. The CMS can store it,
 *     `Icon.tsx` has no shape for it, and it renders as "a silent, invisible
 *     24px blank box. No error, no warning, no visual indication in logs."
 *     That is the failure this check exists for.
 *
 *   frontend has an icon the backend lacks  -> HARMLESS. It is a UI-internal
 *     icon the CMS simply never offers. Nothing can store it, so nothing can
 *     fail to render it.
 *
 * ⚠️ THIS USED TO REQUIRE THE TWO LISTS TO BE IDENTICAL, AND THAT WAS STRICTER
 * THAN ITS OWN STATED PURPOSE. The frontend's hero carousel added `play` and
 * `pause` for its pause control — transport icons, never content, never stored.
 * Equality failed on them and the only ways to satisfy it were to add two
 * meaningless options to `enum_icon_name` (a shared production enum backing
 * `projects` feature/proximity icons and `site-settings` social/ticker icons,
 * plus a migration) or to ignore the check. Neither is right, because neither
 * addresses any actual risk.
 *
 * 🔴 THIS IS A TIGHTENING OF CORRECTNESS, NOT A LOOSENING OF SAFETY. The
 * dangerous direction is still a hard failure; only the direction that was
 * never dangerous is now permitted. A backend icon missing from the frontend
 * still fails, which `tests/unit/iconDrift.test.ts` pins.
 */
export const iconsNotRenderableByFrontend = (
  backend: readonly string[],
  frontend: readonly string[],
): string[] => {
  const renderable = new Set(frontend)
  return backend.filter((name) => !renderable.has(name)).sort()
}
