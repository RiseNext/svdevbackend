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

  it('every global declares read, update and readVersions', () => {
    for (const global of resolved.globals) {
      expect(typeof global.access?.read, `${global.slug}.access.read`).toBe('function')
      expect(typeof global.access?.update, `${global.slug}.access.update`).toBe('function')
      expect(typeof global.access?.readVersions, `${global.slug}.readVersions`).toBe('function')
    }
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
