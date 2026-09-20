/**
 * A TYPE-ONLY SHIM. It exists for exactly one reason:
 *
 * `src/types/frontend-contract.ts` is a BYTE-IDENTICAL copy of
 * `svfrontend/src/types/content.ts`, CI-diffed so a contract drift fails the
 * build in THIS repo rather than silently in the other one. Its first line is
 * `import type { IconName } from '@/components/ui/Icon';`.
 *
 * Preserving byte-identity means that import path must resolve here too. So this
 * file exists at the same path and re-exports the same type — sourced from
 * `src/lib/icons.ts`, which is itself CI-diffed against the frontend's real
 * `Icon.tsx` union.
 *
 * It contains NO icon rendering. The backend never renders an icon; it only
 * validates that a stored value is one of the 41 names the frontend can render.
 */
export type { IconName } from '@/lib/icons'
