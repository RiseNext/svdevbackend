import type { CollectionConfig, FieldHook } from 'payload'

import { isAdmin, isAdminBoolean } from '@/access'
import {
  LIMITS,
  LOCK_TIME_MS,
  MAX_LOGIN_ATTEMPTS,
  MIN_PASSWORD_LENGTH,
  TOKEN_EXPIRATION_SECONDS,
} from '@/lib/constants'
import { env, isProduction } from '@/lib/env'
import { isBreachedPassword } from '@/lib/passwordPolicy'
import { renderBrandedEmail } from '@/email/renderBrandedEmail'
import { auditForgotPassword, auditLogin, auditLogout } from '@/hooks/authEvents'

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

    forgotPassword: {
      expiration: 60 * 60 * 1000,
      // The only throttle Payload gives us on this path. The real rate limit is
      // at the edge, alongside the login limit.
      minRequestInterval: 15_000,
      generateEmailSubject: () => 'Reset your SV Developers admin password',
      generateEmailHTML: (args) => {
        const token = (args as { token?: string } | undefined)?.token ?? ''
        const url = `${env.NEXT_PUBLIC_SERVER_URL}/admin/reset/${token}`
        return renderBrandedEmail({
          heading: 'Reset your password',
          intro:
            'Someone asked to reset the password for your SV Developers admin account. If that was not you, you can ignore this email — nothing has changed.',
          bodyHtml: `<p style="margin:24px 0"><a href="${url}" style="background:#1a1a1a;color:#ffffff;padding:12px 20px;border-radius:4px;text-decoration:none;display:inline-block">Reset password</a></p><p style="font-size:13px;color:#666">This link expires in one hour and can be used once.</p>`,
        })
      },
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
    afterLogin: [auditLogin],
    afterLogout: [auditLogout],
    afterForgotPassword: [auditForgotPassword],
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
        description:
          'Disable instead of deleting — audit attribution must survive. NOTE: unticking this closes the authorisation door on the next request, but does NOT end an existing session. To fully revoke access you must ALSO change this user’s password as an admin, which ends all of their sessions. See the deactivation runbook.',
      },
    },
  ],
}
