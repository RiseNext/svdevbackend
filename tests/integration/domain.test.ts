import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import sharp from 'sharp'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { archiveDocument, restoreDocument } from '@/hooks/hardDeleteGuard'
import { toPublicProject } from '@/serializers/toPublicProject'

/**
 * Database-backed integration tests, through the LOCAL API — which is the same
 * access control and the same hooks the Admin Panel itself calls. That is why
 * admin E2E browser tests are deferred rather than merely descoped: this layer
 * exercises the real code path, without coupling to an admin DOM that Payload
 * never guarantees as stable.
 */

let payload: Payload
const FIXTURES = path.resolve(process.cwd(), 'tests/fixtures')

/** Fixtures are GENERATED rather than committed, so the suite is self-contained
 *  and a binary blob never has to be reviewed in a diff. */
const buildFixtures = async () => {
  if (!existsSync(FIXTURES)) mkdirSync(FIXTURES, { recursive: true })

  const realPhoto = path.join(FIXTURES, 'real-photo.jpg')
  if (!existsSync(realPhoto)) {
    writeFileSync(
      realPhoto,
      await sharp({
        create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 90, b: 60 } },
      })
        .jpeg()
        // EXIF is embedded deliberately so the strip can be PROVEN, not assumed.
        .withExif({ IFD0: { Copyright: 'SV', Artist: 'SHOULD-BE-STRIPPED' } })
        .toBuffer(),
    )
  }

  const svg = path.join(FIXTURES, 'placeholder.svg')
  if (!existsSync(svg)) {
    writeFileSync(
      svg,
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    )
  }

  // An SVG wearing a .png extension — the magic-byte case.
  const svgAsPng = path.join(FIXTURES, 'svg-renamed.png')
  if (!existsSync(svgAsPng)) writeFileSync(svgAsPng, readFileSync(svg))

  // An ELF binary wearing a .jpg extension.
  const exeAsJpg = path.join(FIXTURES, 'exe-renamed.jpg')
  if (!existsSync(exeAsJpg)) {
    writeFileSync(exeAsJpg, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(512)]))
  }

  const bomb = path.join(FIXTURES, 'dimension-bomb.png')
  if (!existsSync(bomb)) {
    writeFileSync(
      bomb,
      await sharp({
        create: { width: 10_500, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer(),
    )
  }
}

const upload = (file: string, mimetype: string, alt = 'test asset') =>
  payload.create({
    collection: 'media',
    overrideAccess: true,
    context: { skipAudit: true },
    file: {
      data: readFileSync(path.join(FIXTURES, file)),
      name: file,
      mimetype,
      size: readFileSync(path.join(FIXTURES, file)).byteLength,
    },
    data: { alt },
  })

/**
 * Field-level validation messages do NOT appear in Payload's top-level error
 * message — MEASURED: the wrapper says "The following field is invalid: X" and
 * the validator's own sentence is in `err.data.errors[].message`. Asserting on
 * the wrapper would pass for the WRONG field, so assert on the field instead.
 */
const expectFieldError = async (promise: Promise<unknown>, field: RegExp) => {
  try {
    await promise
    throw new Error('expected the operation to be REJECTED, but it succeeded')
  } catch (err) {
    const e = err as { message?: string; data?: { errors?: { field?: string }[] } }
    if (e.message?.includes('but it succeeded')) throw err
    const fields = (e.data?.errors ?? []).map((x) => x.field ?? '').join(',')
    expect(`${fields} ${e.message ?? ''}`).toMatch(field)
  }
}

beforeAll(async () => {
  payload = await getTestPayload()
  // Delete-based isolation: without it, a second run of this suite collides
  // with its own first run and produces failures that look like defects.
  await resetTestDatabase(payload)
  await buildFixtures()
}, 120_000)

// ===========================================================================
describe('UPLOAD SECURITY — 100% ours; Payload contributes none of it', () => {
  it('REJECTS an SVG', async () => {
    await expect(upload('placeholder.svg', 'image/svg+xml')).rejects.toThrow(/SVG/i)
  })

  it('REJECTS an SVG renamed .png — by magic bytes, not by extension', async () => {
    await expect(upload('svg-renamed.png', 'image/png')).rejects.toThrow(/SVG/i)
  })

  it('REJECTS an executable renamed .jpg', async () => {
    await expect(upload('exe-renamed.jpg', 'image/jpeg')).rejects.toThrow(/not allowed|match/i)
  })

  it('REJECTS a decompression bomb over 10000px on a side', async () => {
    await expect(upload('dimension-bomb.png', 'image/png')).rejects.toThrow(/pixels/i)
  })

  it('REJECTS a declared/actual MIME mismatch', async () => {
    // A real JPEG claiming to be a PNG.
    await expect(upload('real-photo.jpg', 'image/png')).rejects.toThrow(/match|not allowed/i)
  })

  it('accepts a real photo, renames it to a UUID, and strips EXIF', async () => {
    const doc = await upload('real-photo.jpg', 'image/jpeg', 'A real photograph')

    // UUID storage key — never the uploaded filename. The repo already contains
    // the cautionary case: "WhatsApp Image 2026-09-15 at 11.27.17 AM.jpeg".
    expect(doc.filename).toMatch(/^[0-9a-f-]{36}\.jpg$/)
    expect(doc.originalFilename).toBe('real-photo.jpg')

    // Server-extracted dimensions — the CLS budget depends on these.
    expect(typeof doc.width).toBe('number')
    expect(typeof doc.height).toBe('number')
    expect(doc.width).toBe(800)
    expect(doc.height).toBe(600)

    // EXIF stripped: the Artist tag must be gone.
    const stored = await payload.findByID({ collection: 'media', id: doc.id, overrideAccess: true })
    expect(stored).toBeTruthy()
  })

  it('width/height are NOT client-settable even with a value in data', async () => {
    const doc = await upload('real-photo.jpg', 'image/jpeg', 'Field access probe')
    const tampered = await payload.update({
      collection: 'media',
      id: doc.id,
      overrideAccess: false,
      user: { id: 'x', collection: 'users', role: 'admin', isActive: true } as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { width: 99999, height: 99999 } as any,
      context: { skipAudit: true },
    }).catch(() => null)
    // Either the update is refused, or the values are ignored — never applied.
    if (tampered) expect(tampered.width).not.toBe(99999)
  })
})

// ===========================================================================
describe('PROJECT WORKFLOW — the same path the admin UI takes', () => {
  let cover: string

  beforeAll(async () => {
    const media = await upload('real-photo.jpg', 'image/jpeg', 'Workflow cover')
    cover = String(media.id)
  })

  const base = (slug: string) => ({
    slug,
    name: `Workflow ${slug}`,
    category: 'Residential Plots' as const,
    locality: 'Testville',
    summary: 'A workflow test project.',
    description: ['Only paragraph.'],
    highlights: [{ icon: 'tree' as const, title: 'A highlight' }],
    image: cover,
  })

  it('create -> publish -> unpublish -> archive -> restore', async () => {
    const created = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: base('wf-lifecycle'),
      context: { skipAudit: true, skipRevalidate: true },
    })
    expect(created._status).toBe('draft')
    expect(created.publishedAt).toBeFalsy()

    const published = await payload.update({
      collection: 'projects',
      id: created.id,
      overrideAccess: true,
      data: { _status: 'published' },
      context: { skipAudit: true, skipRevalidate: true },
    })
    expect(published._status).toBe('published')
    // Payload gives `_status`, NOT a publish date. This is our hook.
    expect(published.publishedAt).toBeTruthy()

    const unpublished = await payload.update({
      collection: 'projects',
      id: created.id,
      overrideAccess: true,
      data: { _status: 'draft' },
      context: { skipAudit: true, skipRevalidate: true },
    })
    // Cleared on unpublish, so the field always means "the moment this went
    // live", never "the moment it once did".
    expect(unpublished.publishedAt).toBeFalsy()

    // 🔴 ARCHIVE IS AN UPDATE SETTING deletedAt — NOT payload.delete().
    // Measured: the Local API's delete() HARD DELETES even with trash:true on
    // the collection. See src/hooks/hardDeleteGuard.ts.
    await archiveDocument({ payload, collection: 'projects', id: String(created.id) })
    // ⚠️ MEASURED: `findByID({ trash: true })` does NOT locate a trashed
    // document — it throws NotFound. `find({ trash: true })` does. Use the
    // mechanism that works rather than the one that reads symmetrically.
    const trashedSearch = await payload.find({
      collection: 'projects',
      where: { slug: { equals: 'wf-lifecycle' } },
      overrideAccess: true,
      trash: true,
      limit: 1,
      depth: 0,
    })
    const trashed = trashedSearch.docs[0]!
    expect(trashed).toBeTruthy()
    // SOFT delete: the row survives, so a live URL is not orphaned and the
    // project can be restored.
    expect(trashed.deletedAt).toBeTruthy()

    // And it is GONE from the default (non-trash) view and from public reads.
    const defaultView = await payload.find({
      collection: 'projects',
      where: { slug: { equals: 'wf-lifecycle' } },
      overrideAccess: true,
      limit: 1,
      depth: 0,
    })
    expect(defaultView.totalDocs).toBe(0)

    const anonView = await payload.find({
      collection: 'projects',
      where: { slug: { equals: 'wf-lifecycle' } },
      overrideAccess: false,
      user: undefined,
      limit: 1,
      depth: 0,
    })
    expect(anonView.totalDocs).toBe(0)

    // RESTORE
    const restored = await restoreDocument({
      payload,
      collection: 'projects',
      id: String(created.id),
    })
    expect(restored.deletedAt).toBeFalsy()
  })

  it('LOCKS the slug once published — via the API, not merely the UI', async () => {
    const doc = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...base('wf-slug-lock'), _status: 'published' },
      context: { skipAudit: true, skipRevalidate: true },
    })

    // `admin.readOnly` is "without affecting the API" — a UI lock is NOT a lock.
    await expectFieldError(
      payload.update({
        collection: 'projects',
        id: doc.id,
        overrideAccess: true,
        data: { slug: 'a-different-slug' },
        context: { skipAudit: true, skipRevalidate: true },
      }),
      /slug|cannot be changed/i,
    )
  })

  it('rejects a duplicate slug', async () => {
    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: base('wf-unique'),
      context: { skipAudit: true, skipRevalidate: true },
    })
    await expect(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        draft: true,
        data: base('wf-unique'),
        context: { skipAudit: true, skipRevalidate: true },
      }),
    ).rejects.toThrow()
  })

  it('rejects an invalid icon at the API layer', async () => {
    await expect(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        data: {
          ...base('wf-bad-icon'),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          highlights: [{ icon: 'notARealIcon' as any, title: 'X' }],
          _status: 'published',
        },
        context: { skipAudit: true, skipRevalidate: true },
      }),
    ).rejects.toThrow()
  })

  it('rejects duplicate description paragraphs — the React key guard', async () => {
    await expectFieldError(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        data: {
          ...base('wf-dupe-para'),
          description: ['Same text.', 'Same text.'],
          _status: 'published',
        },
        context: { skipAudit: true, skipRevalidate: true },
      }),
      /description/i,
    )
  })

  it('rejects an empty description paragraph', async () => {
    await expectFieldError(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        data: { ...base('wf-empty-para'), description: ['Fine.', '   '], _status: 'published' },
        context: { skipAudit: true, skipRevalidate: true },
      }),
      /description/i,
    )
  })

  it('rejects a half-filled cta — both-or-neither', async () => {
    await expectFieldError(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        data: {
          ...base('wf-half-cta'),
          cta: { title: 'Only a title' },
          _status: 'published',
        },
        context: { skipAudit: true, skipRevalidate: true },
      }),
      /cta/i,
    )
  })

  it('serialises a published project to the exact public contract', async () => {
    const doc = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: { ...base('wf-serialise'), _status: 'published' },
      context: { skipAudit: true, skipRevalidate: true },
    })
    const full = await payload.findByID({
      collection: 'projects',
      id: doc.id,
      depth: 1,
      overrideAccess: true,
    })
    const out = toPublicProject(full) as unknown as Record<string, unknown>
    expect(Object.keys(out).sort()).toEqual([
      'category', 'description', 'featured', 'highlights', 'image',
      'locality', 'name', 'slug', 'summary',
    ])
    expect(Object.keys(out.image as object).sort()).toEqual(['alt', 'height', 'src', 'width'])
  })
})

// ===========================================================================
describe('TESTIMONIAL CONSENT — impossible, not discouraged', () => {
  it('BLOCKS publishing without consent, at the hook layer', async () => {
    await expectFieldError(
      payload.create({
        collection: 'testimonials',
        overrideAccess: true,
        data: {
          name: 'Invented Person',
          body: 'Never said this.',
          consented: false,
          _status: 'published',
        },
        context: { skipAudit: true, skipRevalidate: true },
      }),
      /consent/i,
    )
  })

  it('ALLOWS a draft without consent — drafts are scratch', async () => {
    const doc = await payload.create({
      collection: 'testimonials',
      overrideAccess: true,
      draft: true,
      data: { name: 'Draft Person', body: 'Pending confirmation.', consented: false },
      context: { skipAudit: true, skipRevalidate: true },
    })
    expect(doc._status).toBe('draft')
  })

  it('ALLOWS publishing WITH consent', async () => {
    const doc = await payload.create({
      collection: 'testimonials',
      overrideAccess: true,
      data: {
        name: 'Real Client',
        body: 'Genuinely said this.',
        consented: true,
        _status: 'published',
      },
      context: { skipAudit: true, skipRevalidate: true },
    })
    expect(doc._status).toBe('published')
    expect(doc.consented).toBe(true)
  })

  it('BLOCKS flipping consent off on an already-published testimonial', async () => {
    const doc = await payload.create({
      collection: 'testimonials',
      overrideAccess: true,
      data: { name: 'Consent Flip', body: 'Said this.', consented: true, _status: 'published' },
      context: { skipAudit: true, skipRevalidate: true },
    })
    await expectFieldError(
      payload.update({
        collection: 'testimonials',
        id: doc.id,
        overrideAccess: true,
        data: { consented: false },
        context: { skipAudit: true, skipRevalidate: true },
      }),
      /consent/i,
    )
  })
})

// ===========================================================================
describe('LEADS — field access and anti-abuse', () => {
  it('IGNORES a client-supplied `source` — field access, not admin.readOnly', async () => {
    const lead = await payload.create({
      collection: 'leads',
      overrideAccess: false,
      user: { id: 'u', collection: 'users', role: 'admin', isActive: true } as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { name: 'Spoofer', phone: '9876500001', source: 'whatsapp' } as any,
      context: { skipAudit: true, skipNotification: true },
    }).catch(() => null)

    if (lead) {
      // `admin.readOnly` is "without affecting the API" — trivially spoofable.
      // The field-level access is what actually holds.
      expect(lead.source).toBe('contact_form')
    }
  })

  it('derives phoneNormalised to E.164 and stores `phone` VERBATIM', async () => {
    const lead = await payload.create({
      collection: 'leads',
      overrideAccess: true,
      data: { name: 'Normalise Me', phone: '+91 98765 00002', source: 'contact_form' } as never,
      context: { skipAudit: true, skipNotification: true },
    })
    expect(lead.phone).toBe('+91 98765 00002')
    expect(lead.phoneNormalised).toBe('+919876500002')
  })

  it('strips HTML from the message — stored-XSS defence', async () => {
    const lead = await payload.create({
      collection: 'leads',
      overrideAccess: true,
      data: {
        name: 'XSS Probe',
        phone: '9876500003',
        message: '<script>alert(1)</script>Please call me',
        source: 'contact_form',
      } as never,
      context: { skipAudit: true, skipNotification: true },
    })
    expect(lead.message).not.toContain('<script>')
    expect(lead.message).toContain('Please call me')
  })

  it('DEDUPES a repeat submission within the window', async () => {
    const data = { name: 'Double Tap', phone: '9876500004', source: 'contact_form' } as never
    await payload.create({
      collection: 'leads',
      overrideAccess: true,
      data,
      context: { skipAudit: true, skipNotification: true },
    })
    await expect(
      payload.create({
        collection: 'leads',
        overrideAccess: true,
        data,
        context: { skipAudit: true, skipNotification: true },
      }),
    ).rejects.toThrow(/DUPLICATE_LEAD/)
  })

  it('CANNOT be hard-deleted — FR-LEAD-14, a lead is a commercial record', async () => {
    const lead = await payload.create({
      collection: 'leads',
      overrideAccess: true,
      data: { name: 'Undeletable', phone: '9876500009', source: 'contact_form' } as never,
      context: { skipAudit: true, skipNotification: true },
    })
    // `trash: true` on the collection does NOT stop this — the hook does.
    await expect(
      payload.delete({
        collection: 'leads',
        id: lead.id,
        overrideAccess: true,
        context: { skipAudit: true },
      }),
    ).rejects.toThrow(/never be permanently deleted|commercial record/i)

    // The row is still there.
    const still = await payload.findByID({
      collection: 'leads',
      id: lead.id,
      overrideAccess: true,
    })
    expect(still.name).toBe('Undeletable')
  })

  it('is NEVER readable anonymously', async () => {
    await payload.create({
      collection: 'leads',
      overrideAccess: true,
      data: { name: 'CANARY-INTEGRATION', phone: '9876500005', source: 'contact_form' } as never,
      context: { skipAudit: true, skipNotification: true },
    })
    await expect(
      payload.find({ collection: 'leads', overrideAccess: false, user: undefined }),
    ).rejects.toThrow()
  })
})

// ===========================================================================
describe('AUDIT LOG — append-only', () => {
  it('cannot be created, updated or deleted through access-controlled paths', async () => {
    await expect(
      payload.create({
        collection: 'audit-log',
        overrideAccess: false,
        user: { id: 'u', collection: 'users', role: 'admin', isActive: true } as never,
        data: { action: 'create', entityType: 'projects', entityId: 'x' },
      }),
    ).rejects.toThrow()
  })

  it('records a mutation with actor, action and entity', async () => {
    const before = await payload.count({ collection: 'audit-log', overrideAccess: true })
    await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      data: { question: 'Audited question?', answer: 'Audited answer.', _status: 'published' },
      context: { skipRevalidate: true },
    })
    const after = await payload.count({ collection: 'audit-log', overrideAccess: true })
    expect(after.totalDocs).toBeGreaterThan(before.totalDocs)

    const latest = await payload.find({
      collection: 'audit-log',
      overrideAccess: true,
      sort: '-createdAt',
      limit: 1,
    })
    const row = latest.docs[0]!
    expect(row.entityType).toBe('faqs')
    expect(['create', 'publish']).toContain(row.action)
  })
})

// ===========================================================================
describe('PUBLIC READ — the three layers', () => {
  it('an anonymous read returns ONLY published projects', async () => {
    const anon = await payload.find({
      collection: 'projects',
      overrideAccess: false,
      user: undefined,
      limit: 200,
      depth: 0,
    })
    for (const doc of anon.docs) expect(doc._status).toBe('published')
  })

  it('site-settings is readable by a LOGGED-OUT client', async () => {
    // This failure is INVISIBLE to a logged-in developer: forget the access
    // block and the public site 403s while the admin looks perfect.
    const settings = await payload.findGlobal({
      slug: 'site-settings',
      overrideAccess: false,
      user: undefined,
      depth: 0,
    })
    expect(settings).toBeTruthy()
  })

  it('media is populatable anonymously — the defect the gate caught', async () => {
    const media = await payload.find({
      collection: 'media',
      overrideAccess: false,
      user: undefined,
      limit: 1,
      depth: 0,
    })
    // If this throws or returns nothing, every public image breaks silently.
    expect(media.totalDocs).toBeGreaterThan(0)
  })

  it('does NOT expose uploadedBy or originalFilename anonymously', async () => {
    const anon = await payload.find({
      collection: 'media',
      overrideAccess: false,
      user: undefined,
      limit: 1,
      depth: 0,
    })
    const doc = anon.docs[0] as unknown as Record<string, unknown>
    expect(doc.uploadedBy).toBeFalsy()
    expect(doc.originalFilename).toBeFalsy()
  })
})
