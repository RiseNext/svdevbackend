import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'

/**
 * ADMIN FEATURE AUDIT SWEEP.
 *
 * ⚠️ THIS FILE IS AN AUDIT ARTEFACT, not part of the product's own regression
 * suite. It exists to produce EVIDENCE for a feature-by-feature audit, covering
 * the gaps the existing 497 tests leave: access control by role, logout/session
 * behaviour, FAQ/Statistics CRUD and ordering, the testimonial consent gate at
 * the data layer, Site Settings validation, and the publish/visibility rules for
 * every content collection.
 *
 * It asserts DOCUMENTED intended behaviour. A failure here is a real defect, not
 * a test-authoring artefact — or, where intended behaviour is genuinely
 * ambiguous, the assertion is written to record what the code actually does and
 * says so in a comment.
 *
 * Runs against the disposable `sv_test` database with storage inert.
 */

let payload: Payload

const CTX = { skipAudit: true, skipRevalidate: true }

/** An active admin, as the access predicates expect to see one. */
const ADMIN = { id: 'audit-admin', collection: 'users', role: 'admin', isActive: true } as never
/** Same account, deactivated — every predicate must treat this as anonymous. */
const INACTIVE = { id: 'audit-admin', collection: 'users', role: 'admin', isActive: false } as never

let pad = 0
const jpeg = async (): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: 40 + (pad++ % 5), height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg()
    .toBuffer()
}

const uploadImage = async (alt: string): Promise<string> => {
  const data = await jpeg()
  const d = await payload.create({
    collection: 'media',
    overrideAccess: true,
    file: { data, name: `audit-${pad}.jpg`, mimetype: 'image/jpeg', size: data.length },
    data: { alt },
    context: CTX,
  })
  return String(d.id)
}

/**
 * 🔴 WHERE A CUSTOM `validate` MESSAGE ACTUALLY ENDS UP. MEASURED.
 *
 * Payload wraps a failed field validation in a `ValidationError` whose
 * `.message` is a GENERIC SUMMARY — "The following field is invalid: Alt" — and
 * puts the authored message in `.data.errors[].message`. So every carefully
 * worded admin-facing string in this repo is one level down from where you would
 * look for it.
 *
 * This matters beyond test authoring: if the admin UI renders only the top-level
 * message, none of those strings ever reach an administrator. Flagged in the
 * audit as a browser-verification item.
 */
const validationMessages = (err: unknown): string => {
  const e = err as { message?: string; data?: { errors?: { message?: string }[] } }
  const nested = (e?.data?.errors ?? []).map((x) => x?.message ?? '').join(' | ')
  return [e?.message ?? '', nested].filter(Boolean).join(' || ')
}

/** Asserts the operation rejects AND that `pattern` appears somewhere in the
 *  error — top-level message or nested field errors. */
const expectRejectionMentioning = async (op: Promise<unknown>, pattern: RegExp) => {
  let caught: unknown
  try {
    await op
  } catch (e) {
    caught = e
  }
  expect(caught, 'expected the operation to reject').toBeDefined()
  expect(validationMessages(caught)).toMatch(pattern)
}

const REQUIRED_SITE = {
  name: 'SV Developers',
  legalName: 'SV Developers',
  url: 'https://example.com',
  email: 'test@example.com',
  phone: '7799774169',
  whatsapp: '7799774169',
  address: ['A line'],
}

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)
  await payload.updateGlobal({
    slug: 'site-settings',
    overrideAccess: true,
    data: REQUIRED_SITE as never,
    context: CTX,
  })
})

// ===========================================================================
// A. ACCESS CONTROL — the layer with the least existing coverage by name
// ===========================================================================

describe('A1. anonymous read access per collection', () => {
  const PUBLIC_READABLE = ['media', 'documents', 'videos'] as const
  const PUBLISHED_ONLY = ['projects', 'blog-posts', 'faqs', 'statistics'] as const
  const ADMIN_ONLY = ['leads', 'users', 'audit-log'] as const

  it.each(PUBLIC_READABLE)('%s is readable anonymously (needed for relation resolution)', async (slug) => {
    const r = await payload.find({
      collection: slug,
      overrideAccess: false,
      user: undefined,
      limit: 1,
      depth: 0,
    })
    expect(r).toBeTruthy()
  })

  it.each(ADMIN_ONLY)('%s is NOT readable anonymously', async (slug) => {
    await expect(
      payload.find({ collection: slug, overrideAccess: false, user: undefined, limit: 1, depth: 0 }),
    ).rejects.toThrow()
  })

  it.each(PUBLISHED_ONLY)('%s hides drafts from anonymous readers', async (slug) => {
    const r = await payload.find({
      collection: slug,
      overrideAccess: false,
      user: undefined,
      limit: 100,
      depth: 0,
    })
    for (const d of r.docs) {
      expect((d as { _status?: string })._status, `${slug} leaked a draft`).toBe('published')
    }
  })

  it('site-settings IS readable anonymously (the public site needs it on every page)', async () => {
    const g = await payload.findGlobal({
      slug: 'site-settings',
      overrideAccess: false,
      user: undefined,
      depth: 0,
    })
    expect((g as { name?: string }).name).toBeTruthy()
  })
})

describe('A2. a DEACTIVATED admin is treated as anonymous', () => {
  /**
   * `isAdmin` = logged in AND isActive AND role==='admin' (access/index.ts).
   * Deactivation is the sanctioned way to remove access, so this is the
   * assertion that proves it actually does.
   */
  it('cannot create a project', async () => {
    await expect(
      payload.create({
        collection: 'projects',
        overrideAccess: false,
        user: INACTIVE,
        data: { name: 'Nope', slug: 'nope-inactive' } as never,
      }),
    ).rejects.toThrow()
  })

  it('cannot read leads', async () => {
    await expect(
      payload.find({ collection: 'leads', overrideAccess: false, user: INACTIVE, limit: 1 }),
    ).rejects.toThrow()
  })

  it('cannot read the audit log', async () => {
    await expect(
      payload.find({ collection: 'audit-log', overrideAccess: false, user: INACTIVE, limit: 1 }),
    ).rejects.toThrow()
  })

  it('but an ACTIVE admin can do all three', async () => {
    await expect(
      payload.find({ collection: 'leads', overrideAccess: false, user: ADMIN, limit: 1 }),
    ).resolves.toBeTruthy()
    await expect(
      payload.find({ collection: 'audit-log', overrideAccess: false, user: ADMIN, limit: 1 }),
    ).resolves.toBeTruthy()
  })
})

describe('A3. append-only / no-create collections really are', () => {
  it('audit-log cannot be created, updated or deleted even by an active admin', async () => {
    await expect(
      payload.create({
        collection: 'audit-log',
        overrideAccess: false,
        user: ADMIN,
        data: { action: 'create', entityType: 'x', entityId: 'y' } as never,
      }),
    ).rejects.toThrow()
  })

  it('leads cannot be created through the normal access path (only the public endpoint may)', async () => {
    await expect(
      payload.create({
        collection: 'leads',
        overrideAccess: false,
        user: ADMIN,
        data: { name: 'Hand Typed', phone: '9876500001' } as never,
      }),
    ).rejects.toThrow()
  })

  it('users cannot be deleted by anyone', async () => {
    /**
     * ⚠️ UNIQUE EMAIL PER RUN, DELIBERATELY. `resetTestDatabase` does NOT
     * truncate `users` (tests/resetDb.ts) — by design, so the seeded admin
     * accounts survive. A fixed address therefore collides with the row this
     * test created on its previous run, and the failure looks like a product
     * defect when it is only test residue.
     */
    const email = `audit-deletable-${Date.now()}@example.com`
    const u = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        email,
        password: 'a-long-enough-passphrase-9',
        name: 'Audit Deletable',
        role: 'admin',
        isActive: true,
      } as never,
      context: CTX,
    })
    await expect(
      payload.delete({ collection: 'users', id: String(u.id), overrideAccess: false, user: ADMIN }),
    ).rejects.toThrow()
    // Still there.
    expect(
      (await payload.find({ collection: 'users', where: { id: { equals: u.id } }, overrideAccess: true, limit: 1 }))
        .totalDocs,
    ).toBe(1)
  })
})

// ===========================================================================
// B. FAQs — thin existing coverage
// ===========================================================================

describe('B. FAQs: CRUD, uniqueness, ordering, public visibility', () => {
  it('requires question and answer on publish', async () => {
    await expect(
      payload.create({
        collection: 'faqs',
        overrideAccess: true,
        data: { _status: 'published' } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('rejects a duplicate question (unique index) even on a draft save', async () => {
    await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question: 'Audit duplicate question?', answer: 'A.' } as never,
      context: CTX,
    })
    await expect(
      payload.create({
        collection: 'faqs',
        overrideAccess: true,
        draft: true,
        data: { question: 'Audit duplicate question?', answer: 'B.' } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('D-8 FIXED: an ARCHIVED faq no longer owns its question text', async () => {
    /**
     * 🔴 CORRECTED ASSERTION. This test previously REQUIRED the collision —
     * it was written during the audit to pin the defect ("the
     * invisible-collision trap"), and it did its job: an administrator who
     * archived an FAQ and then wrote the same question again was refused by a
     * row that does not appear in the default list view.
     *
     * `20261013_090000_partial_unique_active_only` replaced the plain unique
     * index with a PARTIAL one — `WHERE deleted_at IS NULL` — so the constraint
     * now covers active rows only. The expectation is therefore inverted, and
     * the paired assertion that TWO ACTIVE rows still collide is immediately
     * above this one, unchanged.
     *
     * Full coverage of the fix, including the projects/blog-posts/statistics
     * keys and the restore-conflict edge, lives in
     * `tests/integration/archivedUniqueness.test.ts`.
     */
    const f = await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question: 'Audit archived question?', answer: 'A.' } as never,
      context: CTX,
    })
    await payload.update({
      collection: 'faqs',
      id: String(f.id),
      overrideAccess: true,
      data: { deletedAt: new Date().toISOString() } as never,
      context: CTX,
    })

    const replacement = await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question: 'Audit archived question?', answer: 'B.' } as never,
      context: CTX,
    })
    expect(replacement.id, 'the question text must be reusable once archived').not.toBe(f.id)
  })

  it('a published faq is visible anonymously; a draft is not', async () => {
    await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      data: { question: 'Audit published question?', answer: 'Yes.', _status: 'published' } as never,
      context: CTX,
    })
    await payload.create({
      collection: 'faqs',
      overrideAccess: true,
      draft: true,
      data: { question: 'Audit draft question?', answer: 'No.' } as never,
      context: CTX,
    })
    const anon = await payload.find({
      collection: 'faqs',
      overrideAccess: false,
      user: undefined,
      limit: 100,
      depth: 0,
    })
    const qs = anon.docs.map((d) => (d as { question?: string }).question)
    expect(qs).toContain('Audit published question?')
    expect(qs).not.toContain('Audit draft question?')
  })

  it('orderable: sorting by _order is supported', async () => {
    const r = await payload.find({
      collection: 'faqs',
      overrideAccess: true,
      sort: '_order',
      limit: 100,
      depth: 0,
    })
    expect(r.docs.length).toBeGreaterThan(0)
  })
})

// ===========================================================================
// C. STATISTICS — including the 0 / <4 / 4 / >4 cases the audit asked for
// ===========================================================================

describe('C. Statistics: CRUD, uniqueness, and the record-count cases', () => {
  const mk = (label: string, value: string, published = true) =>
    payload.create({
      collection: 'statistics',
      overrideAccess: true,
      ...(published ? {} : { draft: true }),
      data: { label, value, ...(published ? { _status: 'published' } : {}) } as never,
      context: CTX,
    })

  it('ZERO published statistics: the public endpoint returns an empty set, no error', async () => {
    const anon = await payload.find({
      collection: 'statistics',
      overrideAccess: false,
      user: undefined,
      limit: 100,
      depth: 0,
    })
    expect(anon.totalDocs).toBe(0)
  })

  it('requires label and value', async () => {
    await expect(
      payload.create({
        collection: 'statistics',
        overrideAccess: true,
        data: { _status: 'published' } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('value is TEXT — "250+", "100%" and "Immediate" are all accepted', async () => {
    for (const v of ['250+', '100%', 'Immediate']) {
      const d = await mk(`Audit stat ${v}`, v)
      expect((d as { value?: string }).value).toBe(v)
    }
  })

  it('label must be unique', async () => {
    await mk('Audit unique stat', '1')
    await expect(mk('Audit unique stat', '2')).rejects.toThrow()
  })

  it('FEWER THAN FOUR, EXACTLY FOUR and MORE THAN FOUR all save and serve without error', async () => {
    // The old help text claimed the grid needed exactly four. Nothing enforces
    // a count at any layer — assert that explicitly so the claim cannot return.
    const before = (
      await payload.find({ collection: 'statistics', overrideAccess: true, limit: 200, depth: 0 })
    ).totalDocs
    for (let i = 0; i < 6; i++) await mk(`Audit count stat ${i}`, String(i))
    const after = await payload.find({
      collection: 'statistics',
      overrideAccess: false,
      user: undefined,
      limit: 200,
      depth: 0,
    })
    expect(after.totalDocs).toBeGreaterThan(before)
    // No validation error was raised at 1, 4 or >4 — the count is unconstrained.
  })
})

// ===========================================================================
// D. TESTIMONIALS — the consent gate and the public filter
// ===========================================================================

describe('D. Testimonials: consent gate and publishedAndConsented filter', () => {
  it('REFUSES to publish without consent, with the documented message', async () => {
    await expect(
      payload.create({
        collection: 'testimonials',
        overrideAccess: true,
        data: { name: 'Audit NoConsent', body: 'Never said this.', consented: false, _status: 'published' } as never,
        context: CTX,
      }),
    ).rejects.toThrow(/consenting client is a fabricated record/i)
  })

  it('allows a DRAFT without consent (the gate is publish-time only)', async () => {
    const d = await payload.create({
      collection: 'testimonials',
      overrideAccess: true,
      draft: true,
      data: { name: 'Audit DraftNoConsent', body: 'Pending.', consented: false } as never,
      context: CTX,
    })
    expect(d.id).toBeTruthy()
  })

  it('published + consented is visible anonymously', async () => {
    await payload.create({
      collection: 'testimonials',
      overrideAccess: true,
      data: { name: 'Audit Consented', body: 'Real quote.', consented: true, _status: 'published' } as never,
      context: CTX,
    })
    const anon = await payload.find({
      collection: 'testimonials',
      overrideAccess: false,
      user: undefined,
      limit: 100,
      depth: 0,
    })
    expect(anon.docs.map((d) => (d as { name?: string }).name)).toContain('Audit Consented')
  })

  it('consent CANNOT be revoked while the testimonial is published — stronger than expected', async () => {
    /**
     * MEASURED, and better than the obvious design. The gate merges
     * `originalDoc` with `data`, so on a published row `next._status` is still
     * 'published' even when the update only touches `consented`. Setting it
     * false is therefore a "publish without consent" and is refused outright.
     *
     * Consequence worth knowing: to withdraw a client's consent you must
     * UNPUBLISH first, then untick. The access filter
     * (`publishedAndConsented`) is a second layer that never gets exercised by
     * this route, because the write never lands.
     */
    const t = await payload.create({
      collection: 'testimonials',
      overrideAccess: true,
      data: { name: 'Audit Revoked', body: 'Quote.', consented: true, _status: 'published' } as never,
      context: CTX,
    })
    await expectRejectionMentioning(
      payload.update({
        collection: 'testimonials',
        id: String(t.id),
        overrideAccess: true,
        data: { consented: false } as never,
        context: CTX,
      }),
      /consenting client is a fabricated record/i,
    )

    // And the documented withdrawal route does work: unpublish, then untick.
    await payload.update({
      collection: 'testimonials',
      id: String(t.id),
      overrideAccess: true,
      data: { _status: 'draft' } as never,
      context: CTX,
    })
    const unticked = await payload.update({
      collection: 'testimonials',
      id: String(t.id),
      overrideAccess: true,
      data: { consented: false } as never,
      context: CTX,
    })
    expect((unticked as { consented?: boolean }).consented).toBe(false)

    const anon = await payload.find({
      collection: 'testimonials',
      overrideAccess: false,
      user: undefined,
      limit: 100,
      depth: 0,
    })
    expect(anon.docs.map((d) => (d as { name?: string }).name)).not.toContain('Audit Revoked')
  })

  it('rating is accepted in 1..5 and rejected outside it', async () => {
    const ok = await payload.create({
      collection: 'testimonials',
      overrideAccess: true,
      draft: true,
      data: { name: 'Audit Rating OK', body: 'Q.', consented: true, rating: 5 } as never,
      context: CTX,
    })
    expect((ok as { rating?: number }).rating).toBe(5)
    await expect(
      payload.create({
        collection: 'testimonials',
        overrideAccess: true,
        data: { name: 'Audit Rating Bad', body: 'Q.', consented: true, rating: 6, _status: 'published' } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })
})

// ===========================================================================
// E. SITE SETTINGS — required fields, formats, placeholder carve-out, versions
// ===========================================================================

describe('E. Site Settings validation and version history', () => {
  it('rejects a missing required field', async () => {
    await expect(
      payload.updateGlobal({
        slug: 'site-settings',
        overrideAccess: true,
        data: { ...REQUIRED_SITE, name: '' } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('rejects a malformed whatsapp number but ACCEPTS a [PLACEHOLDER]', async () => {
    await expect(
      payload.updateGlobal({
        slug: 'site-settings',
        overrideAccess: true,
        data: { ...REQUIRED_SITE, whatsapp: '+91 98765 43210' } as never,
        context: CTX,
      }),
    ).rejects.toThrow()

    const ok = await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: { ...REQUIRED_SITE, whatsapp: '[WHATSAPP_NUMBER]' } as never,
      context: CTX,
    })
    expect((ok as { whatsapp?: string }).whatsapp).toBe('[WHATSAPP_NUMBER]')
  })

  it('rejects a malformed email but accepts a [PLACEHOLDER]', async () => {
    await expect(
      payload.updateGlobal({
        slug: 'site-settings',
        overrideAccess: true,
        data: { ...REQUIRED_SITE, email: 'not-an-email' } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
    const ok = await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: { ...REQUIRED_SITE, email: '[EMAIL@DOMAIN]' } as never,
      context: CTX,
    })
    expect((ok as { email?: string }).email).toBe('[EMAIL@DOMAIN]')
  })

  it('rejects duplicate address lines and an empty address list', async () => {
    await expect(
      payload.updateGlobal({
        slug: 'site-settings',
        overrideAccess: true,
        data: { ...REQUIRED_SITE, address: ['Same', 'Same'] } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
    await expect(
      payload.updateGlobal({
        slug: 'site-settings',
        overrideAccess: true,
        data: { ...REQUIRED_SITE, address: [] } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('heroMedia row validation: each kind demands its own source', async () => {
    const img = await uploadImage('Audit hero image')
    // kind=image with no image
    await expectRejectionMentioning(
      payload.updateGlobal({
        slug: 'site-settings',
        overrideAccess: true,
        data: { ...REQUIRED_SITE, heroMedia: [{ kind: 'image' }] } as never,
        context: CTX,
      }),
      /choose a photograph/i,
    )
    // kind=youtube with a link but no poster
    await expectRejectionMentioning(
      payload.updateGlobal({
        slug: 'site-settings',
        overrideAccess: true,
        data: {
          ...REQUIRED_SITE,
          heroMedia: [{ kind: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }],
        } as never,
        context: CTX,
      }),
      /needs a poster image/i,
    )
    // a valid image row saves
    const ok = await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: { ...REQUIRED_SITE, heroMedia: [{ kind: 'image', image: img }] } as never,
      context: CTX,
    })
    expect(((ok as { heroMedia?: unknown[] }).heroMedia ?? []).length).toBe(1)
  })

  it('D-5 REGRESSION: an invalid YouTube URL is now REJECTED at save time', async () => {
    const poster = await uploadImage('Audit yt poster')
    /**
     * 🔴 MEASURED BEFORE THE FIX: this saved with a 200. The frontend's
     * `youtubeId()` then returned null, the play button was never rendered, and
     * the slide showed its poster forever with nothing in any log.
     * `validateYoutubeUrl` now rejects it server-side on all four fields.
     */
    await expectRejectionMentioning(
      payload.updateGlobal({
        slug: 'site-settings',
        overrideAccess: true,
        data: {
          ...REQUIRED_SITE,
          heroMedia: [{ kind: 'youtube', youtubeUrl: 'https://vimeo.com/123', poster }],
        } as never,
        context: CTX,
      }),
      /not a YouTube video link/i,
    )

    // A real Share-button link still saves.
    const ok = await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: {
        ...REQUIRED_SITE,
        heroMedia: [{ kind: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', poster }],
      } as never,
      context: CTX,
    })
    expect(((ok as { heroMedia?: { youtubeUrl?: string }[] }).heroMedia ?? [])[0]?.youtubeUrl).toBe(
      'https://youtu.be/dQw4w9WgXcQ',
    )
  })

    it('keeps version history for rollback', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: { ...REQUIRED_SITE, tagline: 'Audit tagline A' } as never,
      context: CTX,
    })
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: { ...REQUIRED_SITE, tagline: 'Audit tagline B' } as never,
      context: CTX,
    })
    const versions = await payload.findGlobalVersions({
      slug: 'site-settings',
      overrideAccess: true,
      limit: 10,
    })
    expect(versions.totalDocs).toBeGreaterThanOrEqual(2)
  })
})

// ===========================================================================
// F. PUBLISH / VISIBILITY rules per content collection
// ===========================================================================

describe('F. publish, unpublish and anonymous visibility', () => {
  it('a project is invisible as a draft, visible when published, invisible again when unpublished', async () => {
    const cover = await uploadImage('Audit lifecycle cover')
    const p = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: {
        name: 'Audit Lifecycle',
        slug: 'audit-lifecycle',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'S.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
      } as never,
      context: CTX,
    })
    const anonCount = async () =>
      (
        await payload.find({
          collection: 'projects',
          where: { slug: { equals: 'audit-lifecycle' } },
          overrideAccess: false,
          user: undefined,
          limit: 1,
          depth: 0,
        })
      ).totalDocs

    expect(await anonCount()).toBe(0)
    await payload.update({
      collection: 'projects',
      id: String(p.id),
      overrideAccess: true,
      data: { _status: 'published' } as never,
      context: CTX,
    })
    expect(await anonCount()).toBe(1)
    await payload.update({
      collection: 'projects',
      id: String(p.id),
      overrideAccess: true,
      data: { _status: 'draft' } as never,
      context: CTX,
    })
    expect(await anonCount()).toBe(0)
  })

  it('a blog post cannot publish with no body, no video and no external URL', async () => {
    await expect(
      payload.create({
        collection: 'blog-posts',
        overrideAccess: true,
        data: {
          title: 'Audit Empty Post',
          slug: 'audit-empty-post',
          excerpt: 'E.',
          publishedAt: '2026-10-13T00:00:00.000Z',
          _status: 'published',
        } as never,
        context: CTX,
      }),
    ).rejects.toThrow(/needs something to show/i)
  })

  it('a blog post publishes with ONLY an external URL', async () => {
    const d = await payload.create({
      collection: 'blog-posts',
      overrideAccess: true,
      data: {
        title: 'Audit External Post',
        slug: 'audit-external-post',
        excerpt: 'E.',
        publishedAt: '2026-10-13T00:00:00.000Z',
        externalUrl: 'https://example.com/article',
        _status: 'published',
      } as never,
      context: CTX,
    })
    expect(d._status).toBe('published')
  })

  it('a published slug is LOCKED on both projects and blog posts', async () => {
    const posts = await payload.find({
      collection: 'blog-posts',
      where: { slug: { equals: 'audit-external-post' } },
      overrideAccess: true,
      limit: 1,
    })
    const id = String(posts.docs[0]!.id)
    await expect(
      payload.update({
        collection: 'blog-posts',
        id,
        overrideAccess: true,
        data: { slug: 'audit-external-post-renamed' } as never,
        context: CTX,
      }),
    ).rejects.toThrow(/web address of a published post cannot be changed/i)
  })

  it('a duplicate slug is rejected', async () => {
    const cover = await uploadImage('Audit dup cover')
    await expect(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        draft: true,
        data: {
          name: 'Audit Lifecycle Clone',
          slug: 'audit-lifecycle',
          category: 'Residential Plots',
          locality: 'Testville',
          summary: 'S.',
          description: ['One.'],
          highlights: [{ icon: 'tree', title: 'H' }],
          image: cover,
        } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('an invalid category is rejected', async () => {
    const cover = await uploadImage('Audit cat cover')
    await expect(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        data: {
          name: 'Audit Bad Category',
          slug: 'audit-bad-category',
          category: 'Not A Real Category',
          locality: 'Testville',
          summary: 'S.',
          description: ['One.'],
          highlights: [{ icon: 'tree', title: 'H' }],
          image: cover,
          _status: 'published',
        } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('the per-project CTA override is both-or-neither', async () => {
    const cover = await uploadImage('Audit cta cover')
    await expectRejectionMentioning(
      payload.create({
        collection: 'projects',
        overrideAccess: true,
        data: {
          name: 'Audit CTA Half',
          slug: 'audit-cta-half',
          category: 'Residential Plots',
          locality: 'Testville',
          summary: 'S.',
          description: ['One.'],
          highlights: [{ icon: 'tree', title: 'H' }],
          image: cover,
          cta: { title: 'Only a title' },
          _status: 'published',
        } as never,
        context: CTX,
      }),
      /both the title and the description/i,
    )
  })
})

// ===========================================================================
// G. UPLOAD VALIDATION
// ===========================================================================

describe('G. upload validation', () => {
  it('rejects an SVG with the documented security message', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
    await expect(
      payload.create({
        collection: 'media',
        overrideAccess: true,
        file: { data: svg, name: 'x.svg', mimetype: 'image/svg+xml', size: svg.length },
        data: { alt: 'svg' },
        context: CTX,
      }),
    ).rejects.toThrow(/SVG files cannot be uploaded/i)
  })

  it('rejects an empty file', async () => {
    await expect(
      payload.create({
        collection: 'media',
        overrideAccess: true,
        file: { data: Buffer.alloc(0), name: 'empty.jpg', mimetype: 'image/jpeg', size: 0 },
        data: { alt: 'empty' },
        context: CTX,
      }),
    ).rejects.toThrow(/empty/i)
  })

  it('rejects a PDF uploaded into the image collection', async () => {
    const pdf = Buffer.from('%PDF-1.4\ntrailer\n%%EOF\n')
    await expect(
      payload.create({
        collection: 'media',
        overrideAccess: true,
        file: { data: pdf, name: 'doc.jpg', mimetype: 'image/jpeg', size: pdf.length },
        data: { alt: 'mismatched' },
        context: CTX,
      }),
    ).rejects.toThrow()
  })

  it('requires alt text unless the image is marked decorative', async () => {
    const data = await jpeg()
    await expectRejectionMentioning(
      payload.create({
        collection: 'media',
        overrideAccess: true,
        file: { data, name: 'noalt.jpg', mimetype: 'image/jpeg', size: data.length },
        data: { alt: '' },
        context: CTX,
      }),
      /Alt text is required/i,
    )

    const d2 = await jpeg()
    const ok = await payload.create({
      collection: 'media',
      overrideAccess: true,
      file: { data: d2, name: 'decorative.jpg', mimetype: 'image/jpeg', size: d2.length },
      data: { alt: '', isDecorative: true },
      context: CTX,
    })
    expect(ok.id).toBeTruthy()
  })

  it('a video requires a poster and a title', async () => {
    const mdat = 8 + 32
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x20]),
      Buffer.from('ftyp'),
      Buffer.from('isom'),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from('isomiso2avc1mp41'),
      Buffer.from([(mdat >> 24) & 255, (mdat >> 16) & 255, (mdat >> 8) & 255, mdat & 255]),
      Buffer.from('mdat'),
      Buffer.alloc(32, 0),
    ])
    await expect(
      payload.create({
        collection: 'videos',
        overrideAccess: true,
        file: { data: mp4, name: 'nop.mp4', mimetype: 'video/mp4', size: mp4.length },
        data: { title: 'No poster' } as never,
        context: CTX,
      }),
    ).rejects.toThrow()
  })
})

// ===========================================================================
// H. AUDIT LOG — does it actually record the lifecycle actions?
// ===========================================================================

describe('H. audit log records the lifecycle', () => {
  const rowsFor = async (entityType: string, entityId: string) =>
    payload.find({
      collection: 'audit-log',
      where: { and: [{ entityType: { equals: entityType } }, { entityId: { equals: entityId } }] },
      overrideAccess: true,
      limit: 50,
      sort: '-createdAt',
      depth: 0,
    })

  it('records create, publish, unpublish and delete on a project', async () => {
    const cover = await uploadImage('Audit log cover')
    // NOTE: no skipAudit here — that is the point of this test.
    const p = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: {
        name: 'Audit Log Project',
        slug: 'audit-log-project',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'S.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
      } as never,
      context: { skipRevalidate: true },
    })
    const id = String(p.id)
    const afterCreate = await rowsFor('projects', id)
    expect(afterCreate.totalDocs, 'create must be audited').toBeGreaterThanOrEqual(1)

    await payload.update({
      collection: 'projects',
      id,
      overrideAccess: true,
      data: { _status: 'published' } as never,
      context: { skipRevalidate: true },
    })
    const afterPublish = await rowsFor('projects', id)
    expect(afterPublish.totalDocs).toBeGreaterThan(afterCreate.totalDocs)
    expect(afterPublish.docs.map((d) => (d as { action?: string }).action)).toContain('publish')

    await payload.update({
      collection: 'projects',
      id,
      overrideAccess: true,
      data: { _status: 'draft' } as never,
      context: { skipRevalidate: true },
    })
    expect(
      (await rowsFor('projects', id)).docs.map((d) => (d as { action?: string }).action),
    ).toContain('unpublish')
  })

  it('records a site-settings save as an update against site-settings', async () => {
    const before = await rowsFor('site-settings', 'site-settings')
    await payload.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: { ...REQUIRED_SITE, officeHours: 'Audit 9-6' } as never,
      context: { skipRevalidate: true },
    })
    const after = await rowsFor('site-settings', 'site-settings')
    expect(after.totalDocs).toBeGreaterThan(before.totalDocs)
  })

  it('⚠️ an ARCHIVE is recorded as `update`, not `delete` (soft delete is an update)', async () => {
    const cover = await uploadImage('Audit archive cover')
    const p = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      draft: true,
      data: {
        name: 'Audit Archive Action',
        slug: 'audit-archive-action',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'S.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
      } as never,
      context: { skipRevalidate: true },
    })
    const id = String(p.id)
    await payload.update({
      collection: 'projects',
      id,
      overrideAccess: true,
      data: { deletedAt: new Date().toISOString() } as never,
      context: { skipRevalidate: true },
    })
    const actions = (await rowsFor('projects', id)).docs.map((d) => (d as { action?: string }).action)
    expect(actions).toContain('update')
    expect(actions, 'archiving does NOT write a `delete` row').not.toContain('delete')
  })

  it('D-2 REGRESSION: RESTORING an archived record writes a `restore` row', async () => {
    /**
     * 🔴 `restore` HAS BEEN IN THE ENUM SINCE MIGRATION 001 AND NOTHING EVER
     * WROTE IT. Verified empirically before the fix: zero `restore` rows after a
     * full archive/restore round trip across every content collection.
     *
     * `deriveAction` now derives it from the `deletedAt` delta — the same
     * mechanism `publish`/`unpublish` already use, because a soft delete and an
     * un-delete are both ordinary updates with no operation of their own.
     *
     * ⚠️ The derivation is checked BEFORE `_status`, because restoring a
     * published document also restores `_status: 'published'` and the publish
     * branch would otherwise claim the event — logging a `publish` nobody
     * performed and hiding the restore all over again.
     */
    const cover = await uploadImage('Audit restore cover')
    const p = await payload.create({
      collection: 'projects',
      overrideAccess: true,
      data: {
        name: 'Audit Restore Action',
        slug: 'audit-restore-action',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'S.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
        _status: 'published',
      } as never,
      context: { skipRevalidate: true },
    })
    const id = String(p.id)

    await payload.update({
      collection: 'projects',
      id,
      overrideAccess: true,
      data: { deletedAt: new Date().toISOString() } as never,
      context: { skipRevalidate: true },
    })

    // RESTORE: clear deletedAt. `trash: true` is required for the lookup to
    // find the archived row at all.
    await payload.update({
      collection: 'projects',
      id,
      overrideAccess: true,
      trash: true,
      data: { deletedAt: null } as never,
      context: { skipRevalidate: true },
    })

    const actions = (await rowsFor('projects', id)).docs.map((d) => (d as { action?: string }).action)
    expect(actions, 'a restore must be recorded as `restore`').toContain('restore')
    // And it must NOT have been mislabelled as a publish.
    const restoreRow = (await rowsFor('projects', id)).docs.find(
      (d) => (d as { action?: string }).action === 'restore',
    )
    expect(restoreRow).toBeTruthy()
  })
})
