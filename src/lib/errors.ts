import { logger, newRequestId } from './logger'

/**
 * THE ERROR ENVELOPE — reproduced verbatim from API-CONTRACT.md §2.4.
 *
 * `afterError` is NOT documented to fire for Local API calls and cannot be relied
 * on to reshape responses, so every public handler carries a mandatory try/catch
 * that maps internal errors onto this envelope. Payload's own `APIError` has a
 * different body shape and is translated by the same code path.
 */

/** Exactly nine top-level codes. The vocabulary is CLOSED. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

/**
 * Thirteen field codes. `CONSENT_REQUIRED` joins the list as a FIELD code
 * deliberately — making it a tenth top-level code would reopen the closed
 * nine-code vocabulary, and the inline-error rendering path already handles
 * field codes with no redesign.
 */
export const FIELD_CODES = [
  'REQUIRED',
  'TOO_SHORT',
  'TOO_LONG',
  'INVALID',
  'INVALID_TYPE',
  'INVALID_FORMAT',
  'INVALID_ENUM',
  'DUPLICATE',
  'SLUG_LOCKED',
  'UNKNOWN_PROJECT',
  'EMPTY_ITEM',
  'INCOMPLETE_PAIR',
  'CONSENT_REQUIRED',
] as const
export type FieldCode = (typeof FIELD_CODES)[number]

export type FieldError = {
  /**
   * MUST exactly match the frontend input `name` attribute so ContactForm's
   * existing `Errors` map renders server errors in the same inline slots with
   * NO redesign. Note the deliberate asymmetry: the request body key is
   * `projectSlug`, the error field is `project`.
   */
  field: string
  code: FieldCode
  message: string
}

export type ErrorEnvelope = {
  error: {
    code: ErrorCode
    message: string
    requestId: string
    details?: FieldError[]
  }
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_ERROR: 500,
}

export const statusForCode = (code: ErrorCode): number => STATUS_BY_CODE[code]

/**
 * The one error type our own code throws. Anything else reaching the handler is
 * treated as an internal error and its message is NEVER passed through.
 */
export class PublicApiError extends Error {
  readonly code: ErrorCode
  readonly details?: FieldError[]
  readonly headers?: Record<string, string>

  constructor(
    code: ErrorCode,
    message: string,
    options?: { details?: FieldError[]; headers?: Record<string, string> },
  ) {
    super(message)
    this.name = 'PublicApiError'
    this.code = code
    this.details = options?.details
    this.headers = options?.headers
  }
}

export const notFound = (message = 'Not found.') => new PublicApiError('NOT_FOUND', message)

export const validationError = (details: FieldError[]) =>
  new PublicApiError('VALIDATION_ERROR', 'One or more fields are invalid.', { details })

export const unsupportedMediaType = (message = 'Unsupported content type.') =>
  new PublicApiError('UNSUPPORTED_MEDIA_TYPE', message)

export const rateLimited = (retryAfterSeconds: number) =>
  new PublicApiError('RATE_LIMITED', 'Too many requests. Please try again shortly.', {
    // The contract says 429 is ALWAYS accompanied by Retry-After.
    headers: { 'Retry-After': String(retryAfterSeconds) },
  })

export const conflict = (message: string, details?: FieldError[]) =>
  new PublicApiError('CONFLICT', message, { details })

/**
 * Builds the envelope and logs the underlying cause server-side.
 *
 * 🔴 `error.message` is NEVER passed through for an INTERNAL_ERROR. The body
 * carries an opaque sentence and a requestId; the stack, SQL, file path and
 * driver string stay in the log.
 */
export function toErrorEnvelope(
  err: unknown,
  requestId: string = newRequestId(),
): { status: number; body: ErrorEnvelope; headers: Record<string, string> } {
  if (err instanceof PublicApiError) {
    // A client error is expected traffic, not an incident. Log at debug.
    logger.debug({ requestId, code: err.code, details: err.details }, 'public api client error')
    return {
      status: statusForCode(err.code),
      headers: err.headers ?? {},
      body: {
        error: {
          code: err.code,
          message: err.message,
          requestId,
          ...(err.details?.length ? { details: err.details } : {}),
        },
      },
    }
  }

  const translated = translatePayloadError(err)
  if (translated) {
    logger.debug({ requestId, code: translated.code }, 'translated payload error')
    return {
      status: statusForCode(translated.code),
      headers: {},
      body: {
        error: {
          code: translated.code,
          message: translated.message,
          requestId,
          ...(translated.details?.length ? { details: translated.details } : {}),
        },
      },
    }
  }

  logger.error({ requestId, err }, 'unhandled error in public endpoint')
  return {
    status: 500,
    headers: {},
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        // Opaque by design. The requestId is the only correlation handle.
        message: 'Something went wrong on our side. Please try again.',
        requestId,
      },
    },
  }
}

/**
 * Payload throws its own `APIError` shape from hooks and validators, and no
 * project document defines the mapping to our envelope. Without this, a consent
 * failure arrives at the admin UI in a shape the inline-error renderer does not
 * understand and the editor sees a generic failure instead of the sentence
 * explaining why.
 */
function translatePayloadError(
  err: unknown,
): { code: ErrorCode; message: string; details?: FieldError[] } | null {
  if (typeof err !== 'object' || err === null) return null

  const e = err as {
    name?: string
    message?: string
    status?: number
    data?: { errors?: { field?: string; path?: string; message?: string }[] }
  }

  const status = typeof e.status === 'number' ? e.status : undefined
  if (status === undefined) return null

  const byStatus: Partial<Record<number, ErrorCode>> = {
    400: 'VALIDATION_ERROR',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    422: 'VALIDATION_ERROR',
    429: 'RATE_LIMITED',
  }

  const code = byStatus[status]
  if (!code) return null

  const details = e.data?.errors
    ?.map((fieldError) => ({
      field: fieldError.field ?? fieldError.path ?? 'unknown',
      code: 'INVALID' as FieldCode,
      message: fieldError.message ?? 'Invalid value.',
    }))
    .filter((d) => d.field !== 'unknown')

  return {
    code,
    // A Payload APIError message is authored by us (in a hook) or by Payload
    // itself; neither contains a stack or a driver string. Safe to surface.
    message: e.message ?? 'Request could not be completed.',
    details: details?.length ? details : undefined,
  }
}
