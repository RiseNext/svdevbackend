/**
 * A TYPE-ONLY SHIM — the same device as `src/components/ui/Icon.ts`, and it
 * exists for exactly the same reason.
 *
 * `src/types/frontend-contract-blog.ts` is a BYTE-IDENTICAL copy of
 * `svfrontend/src/types/blog.ts`, CI-diffed so a blog contract drift fails the
 * build in THIS repo rather than silently in the other one. Its first line is:
 *
 *     import type { ImageRef } from '@/types/content';
 *
 * Preserving byte-identity means that import path has to resolve here too. So
 * this file exists at the same path the frontend uses and re-exports the same
 * types — sourced from `src/types/frontend-contract.ts`, which is itself the
 * byte-identical copy of the frontend's `content.ts`. One definition, reachable
 * under both of the names the two vendored files refer to it by.
 *
 * 🔴 DO NOT DECLARE ANYTHING NEW HERE. Every type must come from
 * `frontend-contract.ts`, or the two vendored files would start describing
 * different things and the byte-diff would stop meaning what it claims.
 */
export type * from './frontend-contract'
