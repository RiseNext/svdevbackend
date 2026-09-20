import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import configPromise from '@payload-config'
import { getPayload, type Payload } from 'payload'

import { env } from '@/lib/env'

import { seedProjects } from './data/projects'
import { seedSiteSettings } from './data/siteSettings'

/**
 * THE SEED — a standalone script run with `payload run`.
 *
 * Why `payload run` and not bare `node`/`tsx`: it "loads the environment
 * variables the same way Next.js loads them, eliminating the need for additional
 * dependencies like dotenv" and "initializes tsx, allowing direct execution of
 * TypeScript files".
 *
 * 🔴 `onInit` IS NOT USED, FOR ANYTHING. The docs describe it only as "a
 * function that is called immediately following startup". They do NOT document
 * how many times it runs across multiple instances, whether it runs during
 * `next build`, whether it runs on every HMR reload, or whether a throw aborts
 * startup. An `onInit` content seed in a two-replica deployment is a RACE THAT
 * PRODUCES DUPLICATE PROJECTS. This script is deterministic and auditable.
 *
 * 🔴 EVERY ENTITY IS A NATURAL-KEY UPSERT. No blind `create` anywhere.
 * Acceptance: running the seed TWICE produces 5 projects, not 10.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSET_DIR = path.resolve(dirname, 'assets')

// ---------------------------------------------------------------------------

/**
 * Two admins, NOT one.
 *
 * Payload's account lockout is PER ACCOUNT, NOT PER IP. With a single admin
 * account, a targeted attacker can trivially deny service by locking the sole
 * administrator out on purpose — and there would be nobody left with
 * `access.unlock` to release them. Two accounts is a PROCESS requirement, not a
 * config one, and it is checked in every environment.
 *
 * 🔴 The passwords here are DEVELOPMENT ONLY and are rotated immediately after
 * the production seed (deployment step 22). They are generated, not hardcoded,
 * when a password is not supplied by the environment.
 */
const seedAdmins = async (payload: Payload): Promise<void> => {
  const admins = [
    { email: 'admin@svdevelopers.local', name: 'SV Administrator' },
    { email: 'second-admin@svdevelopers.local', name: 'SV Second Administrator' },
  ]

  for (const admin of admins) {
    const existing = await payload.find({
      collection: 'users',
      where: { email: { equals: admin.email } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      payload.logger.info(`[seed] admin already exists: ${admin.email}`)
      continue
    }

    // A generated password, printed ONCE to the console and never stored.
    const password =
      process.env.SEED_ADMIN_PASSWORD ??
      `Sv-${Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64url')}`

    await payload.create({
      collection: 'users',
      // Required: `users.access.create` is `isAdmin`, and on a fresh database
      // there is no admin yet. This is the bootstrap path, and it deliberately
      // does NOT depend on /admin/create-first-user — the interaction between a
      // denied `create` and that screen is UNDOCUMENTED, and getting it wrong
      // means a lockout recoverable only with shell access.
      overrideAccess: true,
      data: { ...admin, password, role: 'admin', isActive: true },
      context: { skipAudit: true },
    })

    payload.logger.info(`[seed] created admin ${admin.email}`)
    if (!process.env.SEED_ADMIN_PASSWORD) {
      // eslint-disable-next-line no-console
      console.log(`\n  ADMIN LOGIN  ${admin.email}\n  PASSWORD     ${password}\n`)
    }
  }
}

// ---------------------------------------------------------------------------

const seedSettings = async (payload: Payload): Promise<void> => {
  // A global is inherently idempotent — there is exactly one document.
  await payload.updateGlobal({
    slug: 'site-settings',
    overrideAccess: true,
    data: seedSiteSettings,
    context: { skipAudit: true, skipRevalidate: true },
  })
  payload.logger.info('[seed] site-settings updated (bracketed placeholders preserved verbatim)')
}

// ---------------------------------------------------------------------------

/** Natural key: `originalFilename`. Returns the media document id. */
const upsertMedia = async (
  payload: Payload,
  fileName: string,
  alt: string,
): Promise<string | null> => {
  const filePath = path.join(ASSET_DIR, fileName)
  if (!existsSync(filePath)) {
    // 🔴 FAIL LOUDLY. Never create a media row whose `src` 404s — that is
    // exactly how the frontend ended up with two content keys pointing at files
    // that do not exist on disk.
    payload.logger.error(`[seed] MISSING ASSET ${filePath} — run: npm run seed:rasterise`)
    return null
  }

  const existing = await payload.find({
    collection: 'media',
    where: { originalFilename: { equals: fileName } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs[0]) return String(existing.docs[0].id)

  const created = await payload.create({
    collection: 'media',
    overrideAccess: true,
    // Uploaded through the NORMAL pipeline: the upload guard sniffs magic bytes,
    // rejects SVG, strips EXIF and renames to a UUID. Nothing is bypassed.
    file: {
      data: readFileSync(filePath),
      name: fileName,
      mimetype: 'image/png',
      size: readFileSync(filePath).byteLength,
    },
    data: { alt },
    context: { skipAudit: true },
  })

  payload.logger.info(`[seed] uploaded media ${fileName}`)
  return String(created.id)
}

// ---------------------------------------------------------------------------

/** Natural key: `slug`. */
const seedProjectRecords = async (payload: Payload, withMedia: boolean): Promise<void> => {
  for (const project of seedProjects) {
    const imageId = withMedia
      ? await upsertMedia(payload, project.imageSource.replace(/\.svg$/, '.png'), project.imageAlt)
      : null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      slug: project.slug,
      name: project.name,
      category: project.category,
      locality: project.locality,
      summary: project.summary,
      description: project.description,
      highlights: project.highlights,
      featured: Boolean(project.featured),
      ...(project.developer ? { developer: project.developer } : {}),
      ...(project.tagline ? { tagline: project.tagline } : {}),
      ...(project.area ? { area: project.area } : {}),
      ...(project.roadDetails ? { roadDetails: project.roadDetails } : {}),
      ...(project.stats ? { stats: project.stats } : {}),
      ...(project.approvals ? { approvals: project.approvals } : {}),
      ...(project.amenities ? { amenities: project.amenities } : {}),
      ...(project.locationHighlights ? { locationHighlights: project.locationHighlights } : {}),
      ...(imageId ? { image: imageId } : {}),
      // Published only when a cover exists — `image` is REQUIRED and publish is
      // the validated path. Without media, the record is a DRAFT, which is
      // exactly what `versions.drafts.validate: false` exists to permit.
      _status: imageId ? 'published' : 'draft',
    }

    const existing = await payload.find({
      collection: 'projects',
      where: { slug: { equals: project.slug } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    if (existing.docs[0]) {
      await payload.update({
        collection: 'projects',
        id: existing.docs[0].id,
        overrideAccess: true,
        ...(imageId ? {} : { draft: true }),
        data,
        // The audit log is a record of HUMAN mutations; seed noise would drown it.
        context: { skipAudit: true, skipRevalidate: true },
      })
      payload.logger.info(`[seed] updated project ${project.slug}`)
    } else {
      await payload.create({
        collection: 'projects',
        overrideAccess: true,
        // ⚠️ MEASURED, NOT ASSUMED: `draft: true` is an OPERATION ARGUMENT.
        // `_status: 'draft'` in `data` alone still runs FULL validation, and the
        // required `image` upload then rejects the create. This is precisely the
        // path that makes a media-less seed possible (plan §17.4 stage 1), so
        // getting it wrong would break the documented Phase-1 seed.
        ...(imageId ? {} : { draft: true }),
        data,
        context: { skipAudit: true, skipRevalidate: true },
      })
      payload.logger.info(`[seed] created project ${project.slug}`)
    }
  }
}

// ---------------------------------------------------------------------------

const run = async (): Promise<void> => {
  // 🔴 A HARD REFUSAL, NOT A SKIP. A seed run by accident against production is
  // exactly the incident this guard exists to prevent: it would upsert the five
  // projects over live edits.
  if (!env.PAYLOAD_SEED) {
    // eslint-disable-next-line no-console
    console.error('[seed] PAYLOAD_SEED is not "true" — refusing to seed.')
    process.exit(1)
  }

  const payload = await getPayload({ config: configPromise })

  // Tier-2 content (testimonials, faqs, statistics) is DELIBERATELY NOT SEEDED.
  // The three testimonials in the source are invented placeholders with
  // bracketed names, and publishing them is "a fabricated record". Seeding them
  // creates the exact artefact the CMS is built to make impossible.

  await seedAdmins(payload)
  await seedSettings(payload)

  const withMedia = process.env.SEED_SKIP_MEDIA !== 'true'
  await seedProjectRecords(payload, withMedia)

  const count = await payload.count({ collection: 'projects', overrideAccess: true })
  payload.logger.info(`[seed] complete — ${count.totalDocs} projects`)
  process.exit(0)
}

await run()
