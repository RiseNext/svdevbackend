import { env } from './env'
import { ifNoneMatchSatisfied, noStoreHeaders, publicCacheHeaders } from './cache'
import { PublicApiError, toErrorEnvelope, unsupportedMediaType } from './errors'
import { logger, newRequestId } from './logger'

/**
 * THE WRAPPER THAT CANNOT BE FORGOTTEN.
 *
 * Every public route handler is written through this. It attaches, in one place:
 *   · CORS headers  — ⚠️ "By default, custom endpoints don't handle CORS headers
 *     in responses." Under D-015 EVERY public endpoint is hand-written, so the
 *     one route that genuinely needs CORS (POST /api/v1/leads, the only live call
 *     from a visitor's browser) is precisely the route the root `cors` config
 *     does NOT cover.
 *   · Cache-Control + ETag on GETs, `no-store` on writes and probes
 *   · a mandatory try/catch mapping every error onto the nine-code envelope
 *   · an OPTIONS handler for preflight (behaviour for custom endpoints is not
 *     documented, so it is implemented and tested rather than assumed)
 *
 * The Phase-10 CORS test must run IN A REAL BROWSER from the frontend origin.
 * A curl test passes either way and proves nothing.
 */

type Handler = (req: Request, ctx: { requestId: string }) => Promise<unknown>

/**
 * CORS is an exact-match allow-list against CORS_ORIGINS. Never `*`, and never
 * a reflected `Origin` that was not on the list.
 */
const corsHeadersFor = (req: Request): Record<string, string> => {
  const origin = req.headers.get('origin')
  if (!origin) return {}
  if (!env.CORS_ORIGINS.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    'Access-Control-Max-Age': '86400',
    // No Access-Control-Allow-Credentials: the public API is unauthenticated by
    // design, and granting credentials would let a browser attach admin cookies.
  }
}

const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string>,
): Response => {
  const serialised = JSON.stringify(body)
  return new Response(serialised, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

export type PublicEndpointOptions = {
  /** `cache: 'public'` adds Cache-Control + ETag and answers 304s.
   *  `cache: 'no-store'` is for POSTs and probes. */
  cache: 'public' | 'no-store'
  /** Defaults to 200. `POST /leads` uses 201. */
  successStatus?: number
}

export function definePublicEndpoint(handler: Handler, options: PublicEndpointOptions) {
  return async function route(req: Request): Promise<Response> {
    const requestId = newRequestId()
    const cors = corsHeadersFor(req)

    try {
      const data = await handler(req, { requestId })

      // `undefined` is the handler's way of saying "204, nothing to say".
      if (data === undefined) {
        return new Response(null, { status: 204, headers: { ...cors, ...noStoreHeaders() } })
      }

      const envelope = { data }
      const body = JSON.stringify(envelope)

      if (options.cache === 'public') {
        const cacheHeaders = publicCacheHeaders(body)
        if (ifNoneMatchSatisfied(req.headers.get('if-none-match'), cacheHeaders.ETag!)) {
          // A 304 carries no body but MUST carry the validators.
          return new Response(null, { status: 304, headers: { ...cors, ...cacheHeaders } })
        }
        return jsonResponse(options.successStatus ?? 200, envelope, { ...cors, ...cacheHeaders })
      }

      return jsonResponse(options.successStatus ?? 200, envelope, {
        ...cors,
        ...noStoreHeaders(),
      })
    } catch (err) {
      const { status, body, headers } = toErrorEnvelope(err, requestId)
      return jsonResponse(status, body, { ...cors, ...headers, ...noStoreHeaders() })
    }
  }
}

/** Preflight. Registered on every public route; behaviour is unverified in the
 *  official docs for custom endpoints, so it is explicit and tested. */
export function definePreflight() {
  return async function OPTIONS(req: Request): Promise<Response> {
    const cors = corsHeadersFor(req)
    // 204 with no body is the correct preflight response. If the origin was not
    // on the allow-list, `cors` is empty and the browser rejects the request —
    // which is the desired outcome, expressed by omission rather than by an error.
    return new Response(null, { status: 204, headers: { ...cors, Vary: 'Origin' } })
  }
}

/**
 * `POST /api/v1/leads` accepts `application/json` ONLY. Anything else is 415 —
 * a different code from the 400 a UTF-8 decoding failure produces. These are
 * different failures and the contract says so once, here, so nobody uses them
 * interchangeably. A Route Handler receives a bare Web `Request` and performs
 * NO content-type negotiation of its own.
 */
export const assertJsonContentType = (req: Request): void => {
  const raw = req.headers.get('content-type') ?? ''
  const mediaType = raw.split(';')[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw unsupportedMediaType('Send this request as application/json.')
  }
}

/**
 * Body parsing, with the two failure modes kept distinct:
 *   · a UTF-8 / JSON decoding failure  -> 400
 *   · an oversized body                -> 413
 * Neither is 422; 422 is reserved for a well-formed body that fails validation.
 */
export const readJsonBody = async (req: Request, maxBytes = 64 * 1024): Promise<unknown> => {
  const raw = await req.text()
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new PublicApiError('PAYLOAD_TOO_LARGE', 'That request is too large.')
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new PublicApiError('VALIDATION_ERROR', 'The request body is not valid JSON.')
  }
}

export { logger }
