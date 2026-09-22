import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import config from '@payload-config'
import type { SanitizedConfig } from 'payload'

/**
 * THE CONFIG TEST.
 *
 * 🔴 Payload's DEFAULT access is `({ req: { user } }) => Boolean(user)` — ANY
 * AUTHENTICATED USER, FULL CRUD. That is the OPPOSITE of "deny-by-default access
 * control on every collection". It is benign today with one role and becomes a
 * hole the moment a second auth-enabled collection exists.
 *
 * This test enumerates every collection and global and FAILS ON ANY MISSING KEY,
 * so the guarantee is mechanical rather than remembered.
 */

const resolved = (await config) as SanitizedConfig

describe('access control is EXPLICIT on 100% of collections', () => {
  const required = ['create', 'read', 'update', 'delete'] as const

  it.each(resolved.collections.map((c) => c.slug))(
    'collection "%s" declares every access key',
    (slug) => {
      const collection = resolved.collections.find((c) => c.slug === slug)!
      // Payload's own internal collections are not ours to configure.
      if (slug.startsWith('payload-')) return

      for (const key of required) {
        expect(
          typeof collection.access?.[key],
          `${slug}.access.${key} is missing — Payload would default it to Boolean(user)`,
        ).toBe('function')
      }
    },
  )

  it('every VERSIONED collection declares readVersions', () => {
    // Version records are a second copy of EVERY HISTORICAL VALUE of every
    // DTCP/RERA approval claim ever entered, and `/{api}/{slug}/versions` exists
    // on the generated REST surface. Its default when omitted is undocumented.
    for (const collection of resolved.collections) {
      if (collection.slug.startsWith('payload-')) continue
      if (!collection.versions) continue
      expect(
        typeof collection.access?.readVersions,
        `${collection.slug} has versions but no readVersions access`,
      ).toBe('function')
    }
  })

  it('users declares admin and unlock', () => {
    const users = resolved.collections.find((c) => c.slug === 'users')!
    expect(typeof users.access?.admin).toBe('function')
    expect(typeof users.access?.unlock).toBe('function')
  })

  it('every global declares read and update', () => {
    // Applies to Payload-injected globals too — `payload-jobs-stats` is pushed
    // into config.globals by sanitize() as soon as any task has a `schedule`,
    // and it must still resolve to a function rather than to nothing.
    for (const global of resolved.globals) {
      expect(typeof global.access?.read, `${global.slug}.access.read`).toBe('function')
      expect(typeof global.access?.update, `${global.slug}.access.update`).toBe('function')
    }
  })

  it('every VERSIONED global declares readVersions', () => {
    // Mirrors the collection rule above. `readVersions` is only meaningful
    // where versions exist; requiring it unconditionally asserted something
    // that cannot be true of a global with no version history.
    for (const global of resolved.globals) {
      if (!global.versions) continue
      expect(
        typeof global.access?.readVersions,
        `${global.slug} has versions but no readVersions access`,
      ).toBe('function')
    }
  })

  it('site-settings — OUR global — declares all three', () => {
    // The conditional rule above must not become a loophole for the one global
    // we actually own and that actually has versions.
    const siteSettings = resolved.globals.find((g) => g.slug === 'site-settings')!
    expect(typeof siteSettings.access?.read).toBe('function')
    expect(typeof siteSettings.access?.update).toBe('function')
    expect(typeof siteSettings.access?.readVersions).toBe('function')
  })

  it('the Payload-injected jobs-stats global is hidden and unversioned', () => {
    /**
     * 🔶 EXPOSURE RECORDED RATHER THAN SKIPPED.
     *
     * `payload-jobs-stats` arrives from Payload's own sanitize step, not from
     * our config, so we cannot give it an explicit access block — the jobs
     * config exposes `jobsCollectionOverrides` but no equivalent for this
     * global. It therefore carries Payload's DEFAULT access, `Boolean(user)`:
     * any authenticated user may read and update it.
     *
     * Bounded by three facts, which this test pins so they cannot drift:
     * it is hidden from the Admin UI, it holds only scheduling timestamps
     * (no PII, no content), and there is exactly one role. If a second
     * auth-enabled collection or a non-admin role is ever added, revisit this.
     */
    const stats = resolved.globals.find((g) => g.slug === 'payload-jobs-stats')
    expect(stats, 'jobs-stats global missing — schedules would fail at runtime').toBeDefined()
    expect((stats!.admin as { hidden?: boolean } | undefined)?.hidden).toBe(true)
    expect(stats!.versions).toBeFalsy()
    // Exactly one authored field (`stats`) plus Payload's own timestamps —
    // no PII and no content can reach this table.
    expect(stats!.fields.map((f) => (f as { name?: string }).name)).toEqual([
      'stats',
      'updatedAt',
      'createdAt',
    ])
  })
})

describe('the generated surface is locked down', () => {
  it('GraphQL is DISABLED', () => {
    expect(resolved.graphQL?.disable).toBe(true)
  })

  it('the generated REST surface is moved off /api', () => {
    // Six of our public paths ARE collection slugs. At the default `/api`,
    // Payload's raw document shape would sit at the same URL as our contract.
    expect(resolved.routes?.api).toBe('/payload-api')
    expect(resolved.routes?.admin).toBe('/admin')
  })

  it('CORS is an allow-list, never "*"', () => {
    const cors = resolved.cors
    expect(cors).not.toBe('*')
    if (typeof cors === 'object' && cors !== null && 'origins' in cors) {
      expect(Array.isArray(cors.origins)).toBe(true)
      expect(cors.origins).not.toContain('*')
    }
  })

  it('depth and text length are bounded', () => {
    expect(resolved.maxDepth).toBe(3)
    expect(resolved.defaultDepth).toBe(1)
    expect(resolved.defaultMaxTextLength).toBe(20000)
  })

  it('telemetry is off and the cookie prefix is set', () => {
    expect(resolved.telemetry).toBe(false)
    expect(resolved.cookiePrefix).toBe('sv')
  })

  it('admin.autoLogin is NOT set in any environment', () => {
    expect(resolved.admin?.autoLogin).toBeFalsy()
  })
})

describe('upload security config', () => {
  it('pasteURL is FALSE on both upload collections', () => {
    // ⚠️ ENABLED BY DEFAULT. Left on, an authenticated editor can make the
    // SERVER fetch an arbitrary remote URL — SSRF handed out for free.
    for (const slug of ['media', 'documents']) {
      const collection = resolved.collections.find((c) => c.slug === slug)!
      expect(collection.upload, `${slug} should be an upload collection`).toBeTruthy()
      expect(
        (collection.upload as { pasteURL?: unknown }).pasteURL,
        `${slug}.upload.pasteURL must be false`,
      ).toBe(false)
    }
  })

  it('image/svg+xml is NOT in either mimeTypes allow-list', () => {
    // SVG is NOT on Payload's restricted-file-type list, and defining mimeTypes
    // makes Payload SKIP its restricted check entirely.
    for (const slug of ['media', 'documents']) {
      const collection = resolved.collections.find((c) => c.slug === slug)!
      const mimeTypes = (collection.upload as { mimeTypes?: string[] }).mimeTypes ?? []
      expect(mimeTypes).not.toContain('image/svg+xml')
      // And never the docs' own example, which INCLUDES svg.
      expect(mimeTypes).not.toContain('image/*')
      expect(mimeTypes.length).toBeGreaterThan(0)
    }
  })

  it('the thumbnail size sets withoutEnlargement', () => {
    // The default `undefined` returns NULL for images smaller than the target in
    // both dimensions — silently broken admin thumbnails for the logo.
    const media = resolved.collections.find((c) => c.slug === 'media')!
    const sizes = (media.upload as { imageSizes?: { withoutEnlargement?: unknown }[] }).imageSizes
    expect(sizes?.length).toBeGreaterThan(0)
    for (const size of sizes ?? []) expect(size.withoutEnlargement).toBe(true)
  })
})

/**
 * THE TEMP-DIRECTORY REGRESSION.
 *
 * 🔴 WHAT HAPPENED. `tempFileDir` was `path.resolve(dirname, '../.tmp/uploads')`,
 * i.e. INSIDE the application directory. In the container that is `/app/…`, and
 * `/app` is created by `WORKDIR` as root at mode 755 while the process runs as
 * `USER nextjs` (uid 1001). Payload's multipart handler `mkdirSync`s the parent
 * of each temp file (`uploads/fetchAPI-multipart/handlers.js` ->
 * `checkAndMakeDir`), so every single production upload died on:
 *
 *   EACCES: permission denied, mkdir '/app/.tmp/uploads'
 *   POST /payload-api/media -> 500
 *
 * Nothing caught it: the path is only unwritable under the container's
 * unprivileged user, and locally it happily created `<repo>/.tmp/uploads`.
 *
 * The Dockerfile had ALREADY provisioned the correct directory and its comment
 * named this exact failure — the two files had simply drifted apart. The last
 * case below is therefore the one that matters most: it pins config and
 * Dockerfile together so they cannot diverge again.
 */
describe('upload temp directory — the EACCES regression', () => {
  const tempFileDir = (resolved.upload as { tempFileDir?: unknown }).tempFileDir

  it('useTempFiles stays ON — it is the large-file memory control', () => {
    expect((resolved.upload as { useTempFiles?: unknown }).useTempFiles).toBe(true)
  })

  it('tempFileDir is an ABSOLUTE path', () => {
    // A relative value is resolved against the process CWD — which in the
    // container is `/app`, the directory that cannot be written to. Payload's own
    // default is the relative string 'tmp', so inheriting it reintroduces the bug.
    expect(typeof tempFileDir).toBe('string')
    expect(path.isAbsolute(tempFileDir as string)).toBe(true)
  })

  it('tempFileDir is NOT inside the application directory', () => {
    // This is the actual failure condition, expressed directly.
    const dir = path.resolve(tempFileDir as string)
    const appRoot = path.resolve(process.cwd())
    expect(
      dir.startsWith(appRoot + path.sep),
      `tempFileDir must live outside the app directory — ${dir} is inside ${appRoot}, which is root-owned in the container`,
    ).toBe(false)
    // And specifically never the old value.
    expect(dir).not.toMatch(/[\\/]\.tmp[\\/]uploads$/)
  })

  it('tempFileDir is the conventional /tmp location, not a bespoke path', () => {
    expect(tempFileDir).toBe('/tmp/payload-uploads')
  })

  it('the Dockerfile provisions EXACTLY the directory the config asks for', async () => {
    // The cross-file pin. The outage was a drift between these two values, so a
    // change to either one alone must fail here.
    const dockerfile = await readFile(path.resolve(process.cwd(), 'Dockerfile'), 'utf8')

    const mkdirMatch = dockerfile.match(/mkdir -p (\S+) && chown -R (\S+) (\S+)/)
    expect(mkdirMatch, 'Dockerfile must mkdir + chown the upload temp directory').toBeTruthy()

    const [, madeDir, owner, chownedDir] = mkdirMatch!
    expect(madeDir, 'Dockerfile mkdir path must equal config.upload.tempFileDir').toBe(tempFileDir)
    expect(chownedDir, 'Dockerfile chown path must equal config.upload.tempFileDir').toBe(tempFileDir)
    // Must be owned by the user the container actually runs as.
    expect(dockerfile).toMatch(/^USER nextjs$/m)
    expect(owner).toBe('nextjs:nodejs')
  })

  it('the temp directory is NOT permanent storage — Cloudinary is', () => {
    // Guards against "fixing" the EACCES by pointing staticDir at /tmp, which
    // would silently make every asset vanish on the next deploy.
    for (const slug of ['media', 'documents']) {
      const collection = resolved.collections.find((c) => c.slug === slug)!
      const staticDir = (collection.upload as { staticDir?: unknown }).staticDir
      expect(String(staticDir ?? '')).not.toMatch(/(^|[\\/])tmp([\\/]|$)/)
      expect(staticDir).not.toBe(tempFileDir)
    }
  })
})

describe('versions and drafts', () => {
  it('projects pins maxPerDoc explicitly — the default is 100', () => {
    const projects = resolved.collections.find((c) => c.slug === 'projects')!
    expect((projects.versions as { maxPerDoc?: number }).maxPerDoc).toBe(20)
  })

  it('autosave is OFF everywhere — it would flood the audit log at 800ms', () => {
    for (const collection of resolved.collections) {
      const drafts = (collection.versions as { drafts?: { autosave?: unknown } } | undefined)?.drafts
      if (drafts && typeof drafts === 'object') expect(drafts.autosave).toBeFalsy()
    }
  })

  it('site-settings uses `max`, NOT `maxPerDoc` — the key differs on globals', () => {
    // Writing maxPerDoc on a global is SILENTLY IGNORED. This is the single most
    // likely typo in the whole configuration.
    const settings = resolved.globals.find((g) => g.slug === 'site-settings')!
    const versions = settings.versions as { max?: number; maxPerDoc?: number }
    expect(versions.max).toBe(50)
    expect(versions.maxPerDoc).toBeUndefined()
  })

  it('leads, media, documents, users and audit-log have NO versions', () => {
    // Versioning an operational PII table multiplies PII copies; a version table
    // on an audit table is a second, PRUNABLE copy of the unprunable thing.
    for (const slug of ['leads', 'media', 'documents', 'users', 'audit-log']) {
      const collection = resolved.collections.find((c) => c.slug === slug)!
      expect(collection.versions, `${slug} must not be versioned`).toBeFalsy()
    }
  })
})

describe('no rich text anywhere', () => {
  it('declares no richText field on any collection or global', () => {
    // D-010 + the XSS posture. A rich-text field is a NEW CAPABILITY, not a
    // migration, and Payload's Lexical editor is one config line away — which is
    // exactly why this is asserted rather than assumed.
    const findRichText = (fields: unknown[], path: string): string[] => {
      const hits: string[] = []
      for (const field of fields as Record<string, unknown>[]) {
        if (field?.type === 'richText') hits.push(`${path}.${String(field.name)}`)
        for (const key of ['fields', 'tabs', 'blocks']) {
          const nested = field?.[key]
          if (Array.isArray(nested)) hits.push(...findRichText(nested, path))
        }
      }
      return hits
    }

    for (const collection of resolved.collections) {
      expect(findRichText(collection.fields, collection.slug)).toEqual([])
    }
    for (const global of resolved.globals) {
      expect(findRichText(global.fields, global.slug)).toEqual([])
    }
  })
})
