/**
 * A FIXED-WINDOW, IN-PROCESS RATE LIMITER — roughly forty lines, and that is the
 * whole of the abuse control for the one public write in the system.
 *
 * 🔴 WHY THIS EXISTS AT ALL, GIVEN THAT THE RUNBOOK SAID "DO IT AT THE EDGE".
 * It said that because Payload 3 ships no HTTP rate limiting (v2's `rateLimit`
 * died with Express and the anti-abuse page offers no replacement), and the
 * planned deployment had a reverse proxy in front. THE REAL DEPLOYMENT DOES NOT.
 * Railway terminates TLS and routes straight to the container; there is no nginx
 * conf, no WAF and no place to write a `limit_req` rule. So the choice was not
 * "application or edge" — it was "application or nothing", and the public
 * enquiry form is exactly the endpoint that must not be left as "nothing".
 *
 * ⚠️ IN-PROCESS, AND THEREFORE PER-INSTANCE. This is the SAME assumption the
 * idempotency cache in the leads route already makes, and it is exact for the
 * documented deployment of ONE CMS replica. Two replicas would double the
 * effective ceiling — it degrades, it does not fail open completely. If a second
 * replica is ever added, this and the idempotency cache move to Postgres
 * TOGETHER; they share the constraint and should share the fix.
 *
 * DELIBERATELY NOT BUILT, because none of it is warranted by a contact form on a
 * plot-showcase website: no Redis, no sliding-window log, no token bucket, no
 * distributed coordination, no ban list, no CAPTCHA integration. A fixed window
 * over a Map is coarser at the window boundary (a burst can straddle two
 * windows) and that is an accepted, stated limit rather than an oversight.
 */

export type RateLimitResult = {
  allowed: boolean
  /** Seconds until the current window ends. Sent as `Retry-After` on a 429. */
  retryAfterSeconds: number
}

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/**
 * Bounded memory. Without this, a hostile client rotating the `X-Forwarded-For`
 * header would grow the Map without limit — the rate limiter would become the
 * denial-of-service. On overflow the whole Map is cleared rather than evicted
 * one-by-one: clearing briefly forgives everyone, which is the SAFE direction to
 * fail for a contact form, whereas an LRU eviction would let an attacker
 * deliberately evict a legitimate visitor's bucket.
 */
const MAX_TRACKED_KEYS = 10_000

const prune = (now: number): void => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
  if (buckets.size > MAX_TRACKED_KEYS) buckets.clear()
}

/**
 * Consumes one unit against `key`. Call ONCE per request that should count.
 *
 * @param key    the bucket identity — an IP for the per-IP limit, a normalised
 *               phone number for the per-phone limit. Namespace it (`ip:1.2.3.4`)
 *               so the two cannot collide.
 * @param limit  requests permitted per window
 * @param windowMs  window length in milliseconds
 */
export const consumeRateLimit = (key: string, limit: number, windowMs: number): RateLimitResult => {
  const now = Date.now()
  prune(now)

  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  existing.count += 1

  if (existing.count > limit) {
    return {
      allowed: false,
      // Always at least 1: a `Retry-After: 0` invites an immediate retry.
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}

/** TEST SUPPORT ONLY. The Map is module state, and test order must not matter. */
export const resetRateLimits = (): void => buckets.clear()
