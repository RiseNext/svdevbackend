import { randomBytes } from 'node:crypto'

import configPromise from '@payload-config'
import { getPayload } from 'payload'

/**
 * ADMIN PASSWORD RECOVERY — the replacement for the email reset link.
 *
 * 🔴 WHY THIS FILE EXISTS. This product sends no email, so the Admin Panel's
 * "Forgot password?" link cannot deliver a reset token. With a single
 * administrator account that would make ONE FORGOTTEN PASSWORD A PERMANENT
 * LOCKOUT from the CMS — the only way to read enquiries. Removing a capability
 * without replacing it is not simplification, it is a new failure mode, so the
 * capability is replaced here rather than dropped.
 *
 * Run it from a WORKSTATION CHECKOUT pointed at the production database, the
 * same way the seed is run:
 *
 *   DATABASE_URL="<neon direct url>" DATABASE_SSL=true \
 *   PAYLOAD_SECRET="<secret>" NEXT_PUBLIC_SERVER_URL="https://cms.<domain>" \
 *   CORS_ORIGINS="https://www.<domain>" CSRF_ORIGINS="https://cms.<domain>" \
 *     npm run admin:reset-password -- someone@example.com
 *
 * It prints the new password ONCE, to stdout. Change it after signing in.
 *
 * ⚠️ TWO DOCUMENTED SIDE EFFECTS, both deliberate and both desirable here:
 *   1. Changing a password ENDS ALL OF THAT USER'S SESSIONS. That is exactly
 *      what break-glass recovery should do.
 *   2. This runs WITHOUT an authenticated actor, so the audit hook records the
 *      change with no attributed user. The console output below is the operator
 *      record; note the run in the deployment log.
 */

const EMAIL = process.argv[2]?.trim().toLowerCase()

if (!EMAIL) {
  console.error('Usage: npm run admin:reset-password -- <email>')
  process.exit(1)
}

/**
 * 24 random bytes, base64url. Comfortably over MIN_PASSWORD_LENGTH and not
 * something a person invents under pressure — which is when this script runs.
 * Generated here rather than prompted for, because a prompt cannot be piped and
 * `Read-Host`-style input is exactly what fails in an incident.
 */
const generated = randomBytes(24).toString('base64url')

const run = async (): Promise<void> => {
  const payload = await getPayload({ config: configPromise })

  const found = await payload.find({
    collection: 'users',
    where: { email: { equals: EMAIL } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const user = found.docs[0]
  if (!user) {
    // 🔴 NEVER CREATE THE ACCOUNT. A typo'd email must fail loudly, not silently
    // mint a new administrator.
    console.error(`No administrator account exists with the email "${EMAIL}".`)
    console.error('Existing accounts:')
    const all = await payload.find({
      collection: 'users',
      limit: 50,
      depth: 0,
      overrideAccess: true,
      select: { email: true, isActive: true },
    })
    for (const doc of all.docs) {
      console.error(`  · ${(doc as { email?: string }).email} (active: ${(doc as { isActive?: boolean }).isActive})`)
    }
    process.exit(1)
  }

  await payload.update({
    collection: 'users',
    id: user.id,
    overrideAccess: true,
    data: { password: generated },
  })

  console.log('')
  console.log('  Password reset. This is printed ONCE — copy it now.')
  console.log('')
  console.log(`    email:    ${EMAIL}`)
  console.log(`    password: ${generated}`)
  console.log('')
  console.log('  All existing sessions for this account have ended.')
  console.log('  Sign in and change it to something you will remember.')
  console.log('')

  process.exit(0)
}

await run()
