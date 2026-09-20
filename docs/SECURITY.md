# SECURITY.md

> ## 🟠 CORRECTION BANNER — three controls in this document are not achievable as written (20 Sep 2026)
>
> Verified against the current official Payload 3 documentation. **The threat framing below is correct and unchanged; three specified mechanisms are not.**
>
> | § | This document requires | Official Payload 3 reality | Resolution |
> |---|---|---|---|
> | §1 | **argon2id** password hashing | Payload never names its KDF and exposes **no option to change it**. Reaching argon2id requires `disableLocalStrategy` + a hand-written auth stack, forfeiting login, `maxLoginAttempts`/`lockTime`, reset **and the session machinery D-004 depends on**. | **Accepted documented deviation.** Compensating controls — long minimum password length, `maxLoginAttempts` + `lockTime`, admin-only account creation — in plan §10. |
> | §11 | **Rate limiting** as a backend control | **Payload 3 ships none.** v2's `rateLimit` option died with Express; the official anti-abuse page has no rate-limiting section and recommends no replacement. | **All HTTP throttling is our own code at the edge** (reverse proxy / CDN). Login lockout is per-account only and protects no unauthenticated endpoint. Plan §15. |
> | §2 | Server-side **session records** (`admin_sessions` table) per D-004 | Payload's own session store already provides this. `useSessions: true` is the default; a password change **ends the user's other sessions**, and an admin changing another user's password **ends all of them**. | **D-004's intent is satisfied** by a different mechanism. `admin_sessions` is **not built**; no `tokenVersion` field. `OPEN-QUESTIONS.md` OQ-26 → `DECISIONS.md` D-029. |
>
> Two further corrections: §13's audit-action list omits `logout`, `lockout`, `password_change` and `restore`; and **Payload's version history does not constitute an audit log** — a dedicated `audit-log` collection written by hooks is required.
>
> **Authoritative replacement:** [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) §15 (security), §10 (auth), §12 (audit).
> **Correction detail:** [`DOCUMENTATION-CORRECTIONS.md`](./DOCUMENTATION-CORRECTIONS.md) FIX-31..39.

---

**Threat framing:** the admin backend controls what a public website says about **legally regulated matters** — DTCP/RERA approval claims, clear-title assertions, land extents, proximity claims. A compromise is not just defacement; it is publishing false regulatory claims under the company's name. Treat admin access accordingly.

Second surface: one **public, unauthenticated write** (`POST /leads`) that stores **PII** (name + phone) under India's DPDP Act.

---

## 1. Admin authentication

| Control | Requirement |
|---|---|
| Password hashing | **argon2id** (bcrypt cost ≥12 acceptable). Never MD5/SHA/plaintext/reversible |
| Password policy | Min 12 chars. Check against a breached-password list. **No forced rotation, no composition rules** — both are counterproductive (NIST SP 800-63B) |
| Storage | Only the hash. Never log passwords, even at debug |
| Timing | Constant-time comparison; run the hash even for unknown emails so response time doesn't reveal existence |
| Failure message | **Generic** — "Incorrect email or password." Never "no such user" |
| Lockout | Exponential backoff + lock after ~10 failures. `failed_login_count`, `locked_until` |
| Rate limit | 5 attempts / 15 min / IP **and** per account |
| Registration | ❌ **No endpoint.** Accounts seeded/invited (FR-AUTH-09) |

## 2. Session design

**Recommended: server-side sessions in an httpOnly cookie** (`ARCHITECTURE.md` §6).

```
Set-Cookie: sid=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=…
```

- `HttpOnly` — XSS cannot read it
- `Secure` — HTTPS only
- `SameSite=Lax` — primary CSRF defence
- **Opaque, high-entropy** id (≥128 bits CSPRNG); store a hash of it
- Sliding expiry (e.g. 8h idle) + absolute cap (e.g. 7 days)
- **Server-side revocation** — logout deletes the row; deactivating an account kills all sessions immediately
- Password change invalidates **all other** sessions
- Rotate the session id on login (session-fixation defence)

**If JWTs are chosen instead:** short access token (≤15 min) + rotating refresh token stored server-side, so revocation still works. Never put a JWT in `localStorage` — that is XSS-readable. Record the decision in `DECISIONS.md`.

## 3. Authorization

- **Every** `/api/v1/admin/**` route passes through one auth middleware. No route opts out.
- Fail closed: unknown route under `/admin` → 401, never a fallthrough to a public handler.
- `401` unauthenticated vs `403` authenticated-but-forbidden, kept distinct.
- Single `admin` role today (OQ-4); the check layer exists so adding roles is a policy change, not a rewrite.
- **Authorization lives in the service layer**, not in route handlers — so it cannot be forgotten on a new endpoint.

## 4. Public/admin data separation

| Rule |
|---|
| Public serialisers are **explicit allow-lists**, never "the DB row minus a few fields" |
| Leads are **never** readable on any public route (FR-LEAD-15) |
| Unpublished content returns **`404`, not `403`** — a 403 confirms it exists |
| Public responses never include `createdBy`, `updatedBy`, internal ids, audit data, or draft flags |
| Admin-only fields never leak through an "expand"/"include" parameter — there isn't one |

## 5. CORS

```
Allow-Origin:  exactly two values — public site origin, admin UI origin
Allow-Methods: GET, POST, PATCH, DELETE (as per surface)
Allow-Credentials: true (admin origin only)
```

**Never `*`.** The admin API is cookie-authenticated; a wildcard with credentials is an open door. The public site needs CORS for exactly one route — `POST /leads`.

## 6. CSRF

Cookie auth means CSRF is in scope.

- `SameSite=Lax` blocks cross-site form POSTs — the primary defence
- **Origin/Referer check on every state-changing admin request**
- Double-submit CSRF token if the admin UI is on a different origin from the API (likely — OQ-5)
- `POST /leads` is intentionally cross-origin and unauthenticated, so CSRF does not apply; it is defended by rate limiting and spam controls instead

## 7. Input validation

**The client cannot be trusted at all.** `ContactForm` uses `noValidate`, so *all* browser validation is JS that a user can bypass.

- Validate every input server-side against a Zod schema (`VALIDATION-RULES.md`)
- **Allow-list, never deny-list**
- Enum fields (`category`, `status`, `role`, `icon`, `source`) checked against fixed sets — **`icon` against the 41-name union**, or unknown values break rendering
- `projectSlug` on a lead verified to exist — never trusted (FR-LEAD-03)
- Reject unknown properties rather than silently ignoring them
- Cap request body size; cap array lengths and string lengths
- `source` is **server-assigned**, never client-controlled

## 8. SQL injection

Parameterised queries only, via the ORM. **No string-concatenated SQL anywhere.** If raw SQL is unavoidable, bound parameters only — never interpolation. Sort/filter parameters map through a **fixed allow-list of column names**; never pass a user string into `ORDER BY`.

## 9. XSS

The real risk is **stored** XSS: an admin or a lead submits markup that renders later.

- Lead `message` and `name` are free text → **escape on output**, in the admin UI *and* in notification emails
- React escapes by default — **never** `dangerouslySetInnerHTML` on any CMS or lead content
- **No rich-text/HTML content type exists** in this CMS. Keep it that way; `description` is an array of plain paragraphs
- **Reject SVG uploads** (`MEDIA-MANAGEMENT.md` §6)
- Serve media from a **separate origin** so uploaded content cannot script against the app
- Consider a CSP on the admin UI

## 10. File upload security

Full detail in `MEDIA-MANAGEMENT.md` §6, §10. Essentials: admin-only; extension **and** MIME **and** magic-byte checks; SVG rejected; size and dimension caps; EXIF stripped; UUID storage keys (never the uploaded filename); served from a separate origin with `nosniff`; `Content-Disposition: attachment` for non-images.

## 11. Rate limiting and abuse

| Endpoint | Limit |
|---|---|
| `POST /api/v1/leads` | 5/min/IP **and** 3/hour/phone |
| `POST /admin/auth/login` | 5/15min/IP **and** per-account lockout |
| `POST /admin/media` | Per-session ceiling |
| Other admin | Generous per-session ceiling |
| All public GET | Per-IP ceiling |

Plus on the lead endpoint: **honeypot field** (silently discard), optional invisible CAPTCHA, and `Idempotency-Key` support so a double-submit on a flaky mobile connection creates one lead, not two.

> Choose an invisible mechanism. The audience is mid-range Android on patchy networks — an interactive CAPTCHA will cost real leads.

## 12. Secrets management

- Environment variables only. **Never committed** — the frontend `.gitignore` already blocks `.env*`; the backend must too
- Distinct secrets per environment; **staging must not send real notifications**
- Rotatable without a code change
- Never logged, never returned in an error, never echoed by a debug route
- `SESSION_SECRET` ≥32 bytes random

## 13. Audit logging

Because admins change legally-regulated public claims (FR-AUDIT-01..03):

- Log **every** admin mutation: actor, action, entity type, entity id, timestamp, IP
- Record **before/after** for sensitive fields — `project_features` where `kind='approval'`, `area`, `proximity`, anything title-related
- Log auth events: login, logout, failed login, lockout, password change
- **Append-only** — no update or delete path exists in the application
- Never log passwords, session ids, or full PII

## 14. Transport and headers

HTTPS everywhere; HTTP → HTTPS redirect; HSTS with a long max-age. Headers: `X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` (admin) · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy` minimal. TLS 1.2+.

## 15. Error disclosure

- **Never** return stack traces, SQL, file paths, driver messages, or library versions
- Generic client message + a `requestId` that correlates to the full server-side log
- `404` for unpublished content (not `403`)
- Generic auth failures
- Distinguish `401`/`403`/`404` deliberately, not accidentally

## 16. Database security

Least-privilege application role (no DDL in production beyond migrations, which run as a separate migration role). TLS to the database. Never expose it publicly. Encryption at rest. **Daily backups with a tested restore** (NFR-10) — and backups contain PII, so they inherit the same access controls and retention.

## 17. PII and DPDP compliance

Leads hold name + phone — personal data under India's DPDP Act.

- **Purpose limitation:** `formNote` promises *"We will only use your number to talk to you about this project."* The system must not exceed that — no marketing blasts, no sale of data.
- **Publish the privacy policy.** `[PRIVACY_URL]` is currently inert and the form links to it. **Collecting PII without a reachable policy is the single largest compliance gap.**
- **Retention:** define a lifetime for lead records; `ip_address`/`user_agent` should purge much earlier (e.g. 90 days) than the commercial record.
- **Deletion:** support erasure on request (soft delete + a purge path).
- **Access control:** leads readable only by authenticated admins.
- **Notifications carry PII** — they inherit these obligations.

## 18. Pre-production checklist

- [ ] No default/seeded credentials remain
- [ ] `SESSION_SECRET` is unique and strong
- [ ] CORS is a two-origin allow-list, not `*`
- [ ] Rate limits active on `/leads` and `/admin/auth/login`
- [ ] Uploads reject SVG and enforce magic-byte checks
- [ ] Error responses leak nothing
- [ ] Audit logging verified on every mutation
- [ ] Backups tested by an actual restore
- [ ] HTTPS + HSTS enforced
- [ ] Privacy policy published and linked
- [ ] PII retention job scheduled
- [ ] Public endpoints verified to expose no lead or admin data
- [ ] Unpublished content verified to 404
