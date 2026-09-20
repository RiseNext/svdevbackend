import { createHash } from 'node:crypto'

import { NO_STORE_CACHE_CONTROL, PUBLIC_CACHE_CONTROL } from './constants'

/**
 * Cache-Control + ETag helpers.
 *
 * Under the ISR model these responses are fetched by ONE build machine, not by
 * visitors, so the cache window is short and the ETag is what actually saves
 * work: a full `next build` re-requests every endpoint and most bodies are
 * unchanged between builds.
 */

/** A weak-free, strong ETag over the exact bytes we are about to send. */
export const etagFor = (body: string): string =>
  `"${createHash('sha1').update(body).digest('base64url')}"`

export const publicCacheHeaders = (body: string): Record<string, string> => ({
  'Cache-Control': PUBLIC_CACHE_CONTROL,
  ETag: etagFor(body),
  Vary: 'Origin',
})

export const noStoreHeaders = (): Record<string, string> => ({
  'Cache-Control': NO_STORE_CACHE_CONTROL,
  Vary: 'Origin',
})

/**
 * RFC 9110 says If-None-Match is a LIST and `*` matches anything. Parsing it
 * properly costs three lines and avoids a class of "the CDN sent two etags and
 * we 200'd" bug.
 */
export const ifNoneMatchSatisfied = (header: string | null, etag: string): boolean => {
  if (!header) return false
  const candidates = header.split(',').map((v) => v.trim())
  if (candidates.includes('*')) return true
  // A cache may add the weak validator prefix; compare on the opaque part.
  const strip = (v: string) => v.replace(/^W\//, '')
  return candidates.some((c) => strip(c) === strip(etag))
}
