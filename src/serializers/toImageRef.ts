import type { ImageRef } from '@/types/frontend-contract'
import { env } from '@/lib/env'

/**
 * A populated `media` document -> the ONLY public image shape.
 *
 * `ImageRef` (types/content.ts:29-34) requires `src`, `alt`, `width` and
 * `height` — ALL FOUR NON-OPTIONAL. Six `next/image` call sites plus two raw
 * `<img>` in Lightbox depend on it, and the CLS budget (<0.05) depends on the
 * dimensions specifically.
 *
 * 🔴 EXACTLY FOUR KEYS. No `id`, no `filename`, no `mimeType`, no `filesize`,
 * no `sizes`, no `createdAt`. A contract test asserts the key set.
 */

type MediaLike = {
  id?: string
  url?: string | null
  filename?: string | null
  alt?: string | null
  isDecorative?: boolean | null
  width?: number | null
  height?: number | null
}

export class UnpopulatedUploadError extends Error {
  constructor(field: string) {
    super(
      `Upload field "${field}" was not populated. The public query needs depth >= 1 — at depth 0 an upload field is a bare id string and the serialiser would emit a broken image.`,
    )
    this.name = 'UnpopulatedUploadError'
  }
}

/**
 * Compose `src` DETERMINISTICALLY rather than trusting the `url` field.
 *
 * How Payload composes `url` is not documented beyond the
 * `/collectionSlug/staticURL/filename` pattern, and when a query selects `url`
 * on an upload collection it is "important to specify filename: true as well" —
 * otherwise Payload returns `url: null`. Building it ourselves from
 * CDN_BASE_URL + prefix + filename removes both dependencies.
 *
 * Falls back to Payload's own `url` in local development, where CDN_BASE_URL is
 * intentionally empty and files are served from disk.
 */
const buildSrc = (doc: MediaLike, prefix: 'media' | 'documents'): string => {
  if (env.CDN_BASE_URL && doc.filename) {
    return `${env.CDN_BASE_URL.replace(/\/+$/, '')}/${prefix}/${doc.filename}`
  }
  if (doc.url) return doc.url
  if (doc.filename) return `${env.NEXT_PUBLIC_SERVER_URL}/payload-api/${prefix}/file/${doc.filename}`
  return ''
}

export const toImageRef = (
  value: unknown,
  fieldName = 'image',
  prefix: 'media' | 'documents' = 'media',
): ImageRef => {
  // A bare id string means `depth` was too shallow. Throwing is deliberate:
  // silently emitting a broken image is far worse than a loud 500 that the
  // contract tests catch on the first run.
  if (typeof value === 'string' || value === null || value === undefined) {
    throw new UnpopulatedUploadError(fieldName)
  }

  const doc = value as MediaLike

  return {
    src: buildSrc(doc, prefix),
    // The alt:'' escape hatch. `pages.ts:20` deliberately sets alt:''; Logo.tsx
    // and PinnedProof.tsx pass alt="". `required: true` on `alt` rejects '',
    // so `isDecorative` carries that intent and is resolved HERE.
    alt: doc.isDecorative ? '' : (doc.alt ?? ''),
    width: doc.width ?? 0,
    height: doc.height ?? 0,
  }
}

/** Upload fields that may legitimately be absent. Returns `undefined` so `put()`
 *  omits the key entirely rather than emitting a broken ImageRef. */
export const toImageRefOrUndefined = (
  value: unknown,
  fieldName: string,
): ImageRef | undefined => {
  if (value === null || value === undefined) return undefined
  return toImageRef(value, fieldName)
}
