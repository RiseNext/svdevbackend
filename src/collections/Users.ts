import type { CollectionConfig, FieldHook } from 'payload'

import { isAdmin, isAdminBoolean } from '@/access'
import {
  LIMITS,
  LOCK_TIME_MS,
  MAX_LOGIN_ATTEMPTS,
  MIN_PASSWORD_LENGTH,
  TOKEN_EXPIRATION_SECONDS,
} from '@/lib/constants'
import { isProduction } from '@/lib/env'
import { isBreachedPassword } from '@/lib/passwordPolicy'
import { auditAfterChange } from '@/hooks/audit'
import {
  auditAuthFailure,
  auditForgotPassword,
  auditLogin,
  auditLogout,
  auditPasswordChangeHook,
  blockInactiveLogin,
  flagPasswordChange,
  revokeSessionsOnDeactivate,
} from '@/hooks/authEvents'

/**
 * `email` is auth-injected. We REDEFINE it purely to attach a lowercasing hook.
 *
 * ⚠️ `citext` is not a Payload concept. Without this hook, `Admin@x.com` and
 * `admin@x.com` are TWO ROWS under `unique: true` — and then only one of them
 * can ever log in, with no error explaining why.
 */
const lowercaseEmail: FieldHook = ({ value }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

export const Users: CollectionConfig = {
  slug: 'users',

  auth: {
    // 🔴 DEFAULT, AND NEVER SET TO FALSE. "Stateless JWTs cannot be revoked, so
    // they stay valid until tokenExpiration even after a password change."
    // The entire D-117 session-revocation guarantee rests on this one line.
    useSessions: true,

    // No documented defaults are published for the next three. Set all of them
    // explicitly and assert them in a config test rather than inheriting an
    // undocumented value that could change between minors.
    tokenExpiration: TOKEN_EXPIRATION_SECONDS,
    maxLoginAttempts: MAX_LOGIN_ATTEMPTS,
    lockTime: LOCK_TIME_MS,

    depth: 0,
    // The cookie is the transport; the response body does not need the JWT, and
    // a JWT in a body is a JWT in a log.
    removeTokenFromResponses: true,

    cookies: {
      // `secure: true` CANNOT work over http://localhost — this must stay
      // environment-conditional or local development silently cannot log in.
      secure: isProduction,
      // Viable ONLY because the CMS is deployed on a subdomain of the public
      // site's registrable domain (D-109). An unrelated host forces
      // SameSite=None, which removes the browser's own CSRF defence.
      sameSite: 'Lax',
      // `domain` deliberately NOT set — the admin and the API share one host.
    },

    /**
     * 🔴 THE "FORGOT PASSWORD?" LINK IN THE ADMIN PANEL CANNOT DELIVER ANYTHING,
     * AND THAT IS A DELIBERATE, DOCUMENTED TRADE, NOT AN OVERSIGHT.
     *
     * This product sends no email (payload.config.ts declares no `email` key),
     * so a reset token has no way of reaching a mailbox. Payload exposes no flag
     * to remove the link, and overriding the whole Login view to hide one anchor
     * would be more code and more upgrade risk than the problem is worth.
     *
     * ⚠️ THE CAPABILITY IS REPLACED, NOT DROPPED. Password recovery is:
     *   1. another administrator sets a new password in Admin → Users, or
     *   2. `npm run admin:reset-password -- <email>` from a workstation, which
     *      is why that script exists — a single-administrator deployment would
     *      otherwise be one forgotten password away from a permanent lockout.
     * RUNBOOK.md §7 carries the procedure.
     *
     * The two settings below still do real work and are kept: the token TTL
     * bounds a leaked token, and `minRequestInterval` is the ONLY throttle
     * Payload gives on this path — load-bearing here because Railway provides no
     * edge at which to write one.
     */
    forgotPassword: {
      expiration: 60 * 60 * 1000,
      minRequestInterval: 15_000,
    },

    // loginWithUsername: NOT used — email login is correct for a 2-person team.
    // verify:            NOT used — there is no self-signup, so no verification loop.
    // useAPIKey:         NOT used — the public endpoints are unauthenticated reads.
    // disableLocalStrategy: NEVER. See D-118: it would forfeit login, lockout,
    //                    reset, the admin login UI AND the session machinery.
  },

  admin: {
    useAsTitle: 'email',
    group: 'Administration',
    defaultColumns: ['email', 'name', 'role', 'isActive'],
    description:
      'Administrator accounts. There is no public registration: an account can only be created here. Deactivate an account instead of deleting it — audit attribution must survive.',
  },

  // 🔴 EXPLICIT ON EVERY KEY. Payload's default is Boolean(user) — any
  // authenticated user, full CRUD.
  access: {
    // FR-AUTH-09: this single line is what guarantees no self-registration.
    // There is no "disable registration" flag; it is purely an access consequence.
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    // Deactivate, never delete — audit attribution must survive. This is the one
    // entity where soft delete is explicitly rejected too (D-006's own exception).
    delete: () => false,
    // So one admin can release a locked-out peer rather than waiting out lockTime.
    unlock: isAdminBoolean,
    // Who may enter the Admin Panel at all.
    admin: isAdminBoolean,
  },

  // Versioning an auth collection multiplies credential-adjacent history for
  // zero benefit. `readVersions` is therefore N/A and correctly absent.
  versions: false,
  trash: false,
  defaultSort: 'email',

  hooks: {
    // 🔴 `beforeLogin` RUNS AFTER THE PASSWORD IS VERIFIED AND BEFORE A SESSION
    // IS ISSUED, which is what makes it the correct place to refuse a
    // deactivated account. Without it, unticking `isActive` closed
    // authorisation but left authentication working — measured in a browser as
    // a successful login — and the only mitigation was a two-step procedure in
    // the runbook. See `blockInactiveLogin`.
    beforeLogin: [blockInactiveLogin],
    afterLogin: [auditLogin],
    afterLogout: [auditLogout],
    afterForgotPassword: [auditForgotPassword],
    // ⚠️ TWO HOOKS, AND THE SPLIT IS FORCED. `data.password` is stripped by
    // Payload between `beforeChange` and `afterChange`
    // (collections/operations/utilities/update.js:299), so the fact has to be
    // captured in `beforeChange` and the row written in `afterChange` once the
    // change has actually committed.
    beforeChange: [flagPasswordChange],
    // ⚠️ ORDER MATTERS. `revokeSessionsOnDeactivate` runs LAST so that the
    // ordinary `update` audit row is written before the `logout` row that
    // records the revocation — an auditor reading the log top to bottom sees
    // the cause before the effect.
    afterChange: [auditPasswordChangeHook, auditAfterChange, revokeSessionsOnDeactivate],
    /**
     * 🔴 THE ONLY SEAM THAT SEES A FAILED LOGIN. `login_failed` and `lockout`
     * were in the audit enum from the first migration and nothing ever wrote
     * them, because the failure throws at `login.js:185` — before `beforeLogin`
     * — and `incrementLoginAttempts` writes through the raw adapter, below the
     * hook layer. `afterError` is reached via `handleEndpoints` -> `routeError`,
     * and the admin panel's login form posts to that same REST endpoint. See
     * the long note on `auditAuthFailure`.
     */
    afterError: [auditAuthFailure],
  },

  fields: [
    // Redefined only to attach the lowercasing hook.
    {
      name: 'email',
      type: 'text',
      hooks: { beforeValidate: [lowercaseEmail] },
    },
    // ⚠️ Redefining the INJECTED `password` field to attach `validate` is not
    // shown anywhere in the official docs. The password-policy test is what
    // proves it actually attaches; if it ever stops, that test fails rather than
    // the policy silently disappearing.
    {
      name: 'password',
      type: 'text',
      validate: (value: unknown): true | string => {
        // On update the password field is absent when unchanged.
        if (typeof value !== 'string' || value === '') return true
        if (value.length < MIN_PASSWORD_LENGTH) {
          return `Use at least ${MIN_PASSWORD_LENGTH} characters. Length beats complexity — a long phrase you can remember is stronger than a short one full of symbols.`
        }
        if (isBreachedPassword(value)) {
          return 'That password appears in a known breach list. Choose another.'
        }
        return true
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      maxLength: LIMITS.userName,
      admin: { description: 'Shown in the audit log against everything this person changes.' },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'admin',
      options: [{ label: 'Administrator', value: 'admin' }],
      // The column exists from migration 001 with a single option, so answering
      // OQ-4 later is `ALTER TYPE … ADD VALUE` plus new access functions — NOT a
      // migration on a populated table.
      enumName: 'enum_admin_role',
      admin: { position: 'sidebar' },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      admin: {
        position: 'sidebar',
        // ⚠️ THIS TEXT PREVIOUSLY DESCRIBED A TWO-STEP PROCEDURE ("you must ALSO
        // change this user's password"). That was accurate when written and is
        // no longer true: `revokeSessionsOnDeactivate` now ends every session on
        // the spot. Help text that overstates what an operator must do is a
        // defect in its own right — it teaches a ritual that is not required and
        // invites the reader to doubt the control that is actually there.
        description:
          'Disable instead of deleting — audit attribution must survive. Unticking this takes effect immediately: the account can no longer sign in, and any session it already has is ended on its next request. No second step is needed.',
      },
    },
  ],
}
