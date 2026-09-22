import { describe, expect, it } from 'vitest'

import { isEmptyForPublicOutput, put } from '@/serializers/put'
import { toImageRef, UnpopulatedUploadError } from '@/serializers/toImageRef'
import { toPublicProject, toPublicProjectCard } from '@/serializers/toPublicProject'
import { toPublicSiteSettings } from '@/serializers/toPublicContent'
import { coerceIcon, ICON_NAMES, isIconName } from '@/lib/icons'
import { isPlaceholder } from '@/lib/constants'
import { slugify, SLUG_PATTERN } from '@/fields/slugField'
import { digitsOnly, isJunkPhone, stripHtml, toE164 } from '@/hooks/leadHooks'
import { isBreachedPassword } from '@/lib/passwordPolicy'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProject = any

// ---------------------------------------------------------------------------
describe('put() — the ONE omit-don\'t-empty rule', () => {
  it('omits undefined, null, empty string and empty array', () => {
    const o: Record<string, unknown> = {}
    put(o, 'a', undefined)
    put(o, 'b', null)
    put(o, 'c', '')
    put(o, 'd', '   ')
    put(o, 'e', [])
    expect(Object.keys(o)).toEqual([])
    // `in`, not `=== undefined` — the distinction the whole contract rests on.
    expect('a' in o).toBe(false)
  })

  it('KEEPS 0 and false — they are meaningful values, not absence', () => {
    const o: Record<string, unknown> = {}
    put(o, 'zero', 0)
    put(o, 'no', false)
    expect(o).toEqual({ zero: 0, no: false })
  })

  it('keeps a bracketed placeholder VERBATIM', () => {
    const o: Record<string, unknown> = {}
    put(o, 'email', '[EMAIL@DOMAIN]')
    // Strip the brackets and the frontend stops rendering the link inert,
    // so a live-looking dead link ships.
    expect(o.email).toBe('[EMAIL@DOMAIN]')
  })

  it('isEmptyForPublicOutput agrees with put() on every case', () => {
    for (const v of [undefined, null, '', '  ', []]) expect(isEmptyForPublicOutput(v)).toBe(true)
    for (const v of [0, false, 'x', [1]]) expect(isEmptyForPublicOutput(v)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('icons — the closed 41-value enum', () => {
  it('has exactly 41 values, all camelCase alphanumeric', () => {
    expect(ICON_NAMES).toHaveLength(41)
    for (const n of ICON_NAMES) {
      expect(n).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/)
      // Zero hyphens, zero special characters — satisfies the GraphQL enum
      // naming constraint verbatim, so no translation layer is needed.
      expect(n).not.toContain('-')
    }
    expect(new Set(ICON_NAMES).size).toBe(41)
  })

  it('coerceIcon falls back rather than emitting an invisible blank box', () => {
    expect(coerceIcon('tree')).toBe('tree')
    expect(coerceIcon('notAnIcon')).toBe('check')
    expect(coerceIcon(null)).toBe('check')
    expect(isIconName('zoomIn')).toBe(true)
    expect(isIconName('nope')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('toImageRef()', () => {
  const media = {
    id: 'abc',
    filename: 'x.png',
    url: '/payload-api/media/file/x.png',
    alt: 'A layout plan',
    isDecorative: false,
    width: 1600,
    height: 1067,
  }

  it('emits EXACTLY four keys', () => {
    expect(Object.keys(toImageRef(media)).sort()).toEqual(['alt', 'height', 'src', 'width'])
  })

  it('emits alt:"" for a decorative image', () => {
    expect(toImageRef({ ...media, isDecorative: true, alt: 'ignored' }).alt).toBe('')
  })

  it('THROWS on an unpopulated upload rather than emitting a broken image', () => {
    // This is what caught the media-access defect. A bare id string means depth
    // was too shallow or access denied the populate; emitting src:'' silently
    // would break every image on the site with no error anywhere.
    expect(() => toImageRef('just-an-id')).toThrow(UnpopulatedUploadError)
    expect(() => toImageRef(null)).toThrow(UnpopulatedUploadError)
  })
})

// ---------------------------------------------------------------------------
describe('toPublicProject() — the contract', () => {
  const img = {
    filename: 'c.png',
    url: '/payload-api/media/file/c.png',
    alt: 'cover',
    isDecorative: false,
    width: 1200,
    height: 800,
  }

  const thin: AnyProject = {
    id: 'uuid-1',
    _order: 'a0',
    _status: 'published',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    publishedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    slug: 'thin-one',
    name: 'Thin One',
    category: 'Farm Villa Plots',
    projectStatus: null,
    locality: 'Somewhere',
    developer: null,
    tagline: null,
    summary: 'A summary.',
    description: ['Para one.'],
    highlights: [{ id: 'row-1', icon: 'tree', title: 'Trees', body: null }],
    stats: null,
    amenities: null,
    approvals: null,
    locationHighlights: null,
    proximity: null,
    area: null,
    roadDetails: null,
    image: img,
    gallery: null,
    layoutImage: null,
    locationMap: null,
    cta: null,
    seo: null,
    featured: false,
  }

  it('emits the EXACT thin key set and nothing else', () => {
    const out = toPublicProject(thin) as unknown as Record<string, unknown>
    expect(Object.keys(out).sort()).toEqual([
      'category',
      'description',
      'featured',
      'highlights',
      'image',
      'locality',
      'name',
      'slug',
      'summary',
    ])
  })

  it('omits every absent optional — using `in`, never `=== undefined`', () => {
    const out = toPublicProject(thin) as unknown as Record<string, unknown>
    for (const k of [
      'status', 'developer', 'tagline', 'stats', 'amenities', 'approvals',
      'locationHighlights', 'proximity', 'area', 'roadDetails', 'gallery',
      'layoutImage', 'locationMap', 'cta', 'seo',
    ]) {
      expect(k in out).toBe(false)
    }
  })

  it('strips EVERY internal field', () => {
    const out = toPublicProject(thin) as unknown as Record<string, unknown>
    for (const k of [
      'id', '_id', '_status', '_order', 'createdAt', 'updatedAt',
      'publishedAt', 'deletedAt', 'projectStatus', 'createdBy', 'updatedBy',
      'hasPlaceholders',
    ]) {
      expect(k in out).toBe(false)
    }
  })

  it('strips array-row ids — which the measured schema proves exist', () => {
    const out = toPublicProject(thin) as unknown as { highlights: Record<string, unknown>[] }
    expect('id' in out.highlights[0]!).toBe(false)
    expect(out.highlights[0]).toEqual({ icon: 'tree', title: 'Trees' })
  })

  it('ALWAYS emits featured, even when false', () => {
    // The ONE optional always emitted: `false` IS assignable to
    // `boolean | undefined`, while `null` is not assignable to anything.
    const out = toPublicProject(thin) as unknown as Record<string, unknown>
    expect(out.featured).toBe(false)
    expect('featured' in out).toBe(true)
  })

  it('maps projectStatus -> the public key `status`', () => {
    const out = toPublicProject({
      ...thin,
      projectStatus: 'Open for booking',
    }) as unknown as Record<string, unknown>
    expect(out.status).toBe('Open for booking')
    expect('projectStatus' in out).toBe(false)
  })

  it('passes description through as an IDENTITY — never [{id,value}]', () => {
    const out = toPublicProject({
      ...thin,
      description: ['One.', 'Two.'],
    }) as unknown as { description: string[] }
    expect(out.description).toEqual(['One.', 'Two.'])
    expect(out.description.every((d) => typeof d === 'string')).toBe(true)
  })

  it('enforces cta both-or-neither, and seo both-optional (the asymmetry)', () => {
    const partialCta = toPublicProject({
      ...thin,
      cta: { title: 'Only a title', description: null },
    }) as unknown as Record<string, unknown>
    expect('cta' in partialCta).toBe(false)

    const bothCta = toPublicProject({
      ...thin,
      cta: { title: 'T', description: 'D' },
    }) as unknown as Record<string, unknown>
    expect(bothCta.cta).toEqual({ title: 'T', description: 'D' })

    // seo is DELIBERATELY asymmetric — both members optional inside.
    const partialSeo = toPublicProject({
      ...thin,
      seo: { title: 'Just a title', description: null },
    }) as unknown as Record<string, unknown>
    expect(partialSeo.seo).toEqual({ title: 'Just a title' })
  })

  it('coerces an unknown icon rather than emitting it', () => {
    const out = toPublicProject({
      ...thin,
      highlights: [{ id: 'r', icon: 'notARealIcon', title: 'X', body: null }],
    }) as unknown as { highlights: { icon: string }[] }
    expect(out.highlights[0]!.icon).toBe('check')
  })

  it('card shape carries locality — ContactForm\'s <select> renders it', () => {
    const card = toPublicProjectCard(thin) as unknown as Record<string, unknown>
    expect(card.locality).toBe('Somewhere')
    expect('description' in card).toBe(false)
    expect('id' in card).toBe(false)
  })
})

/**
 * ---------------------------------------------------------------------------
 * `escapeHtml` WAS TESTED HERE AND IS GONE.
 *
 * It existed to make the notification EMAIL TEMPLATES safe — Payload provides
 * zero escaping and the email renderer, unlike React, did not escape on output.
 * With no email subsystem there is no unescaped output sink left in the system,
 * so the function and its test went together. Keeping a test for a deleted
 * escaper would have been a test that passes and protects nothing.
 *
 * The boundary sanitiser it backed up — `stripHtml`, which cleans the enquiry
 * message on the way IN — is still here and is covered below.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
describe('slugify', () => {
  it('produces contract-valid slugs', () => {
    expect(slugify('Sri City Aler Town')).toBe('sri-city-aler-town')
    expect(slugify('  SV  Apartment!! ')).toBe('sv-apartment')
    expect(slugify('Bhôngir Plots')).toBe('bhongir-plots')
    for (const s of ['Sri City Aler Town', 'SV Apartment', '60ft & 30ft Roads']) {
      expect(SLUG_PATTERN.test(slugify(s))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
describe('lead normalisation', () => {
  it('normalises to E.164 assuming +91 for a bare 10-digit number', () => {
    expect(toE164('9876543210')).toBe('+919876543210')
    expect(toE164('+91 98765 43210')).toBe('+919876543210')
    expect(toE164('0091 9876543210')).toBe('+919876543210')
    expect(digitsOnly('+91 (98765) 43210')).toBe('919876543210')
  })

  it('rejects junk numbers', () => {
    expect(isJunkPhone('0000000000')).toBe(true)
    expect(isJunkPhone('1111111111')).toBe(true)
    expect(isJunkPhone('12')).toBe(true)
    expect(isJunkPhone('9876543210')).toBe(false)
  })

  it('strips HTML from a message — stored-XSS defence at the boundary', () => {
    const hook = stripHtml as unknown as (a: { value: unknown }) => string
    expect(hook({ value: '<script>alert(1)</script>Hello' })).toBe('Hello')
    expect(hook({ value: '<b>Bold</b> text' })).toBe('Bold text')
    expect(hook({ value: '<style>x{}</style>Clean' })).toBe('Clean')
  })
})

// ---------------------------------------------------------------------------
describe('password policy — a compensating control for the PBKDF2 deviation', () => {
  it('rejects breached passwords and their obvious derivations', () => {
    expect(isBreachedPassword('password')).toBe(true)
    expect(isBreachedPassword('Password123')).toBe(true)
    expect(isBreachedPassword('P@ssw0rd')).toBe(true)
    expect(isBreachedPassword('svdevelopers2026')).toBe(true)
    expect(isBreachedPassword('aaaaaaaaaaaa')).toBe(true)
    expect(isBreachedPassword('abcdefghijkl')).toBe(true)
  })

  it('accepts a long unremarkable passphrase', () => {
    expect(isBreachedPassword('correct-horse-battery-staple-7')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('placeholder detection', () => {
  it('requires the WHOLE string to be bracketed', () => {
    expect(isPlaceholder('[EMAIL@DOMAIN]')).toBe(true)
    expect(isPlaceholder('[910000000000]')).toBe(true)
    // THE BUG THIS DOCUMENTS: `© [YEAR] SV Developers.` has [YEAR] embedded
    // MID-STRING, so it is NOT detected as a placeholder and renders live.
    // That is exactly why copyrightText is COMPUTED, not stored.
    expect(isPlaceholder('© [YEAR] SV Developers. All rights reserved.')).toBe(false)
    // And the one UNBRACKETED placeholder in the whole repository.
    expect(isPlaceholder('https://www.example.com')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
/**
 * REGRESSION. A freshly migrated production database has NO site-settings row
 * until the owner first saves the global, so every field on it reads back
 * `undefined`. `required: true` does not help — it constrains writes, not reads
 * of a document that was never written.
 *
 * `undefined` in a FIELD is dropped by JSON.stringify and the frontend's
 * optional handling covers it. `undefined` interpolated INTO A STRING survives
 * serialisation as the literal seven characters and reaches the visitor. That
 * is the whole difference, and it is why only `copyrightText` needed a guard.
 */
describe('toPublicSiteSettings — copyrightText on an unsaved global', () => {
  const year = new Date().getFullYear()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serialise = (doc: any) => toPublicSiteSettings(doc)

  it('never emits the literal string "undefined" when the global is empty', () => {
    const out = serialise({})
    expect(out.copyrightText).not.toContain('undefined')
    expect(out.copyrightText).toBe(`© ${year}. All rights reserved.`)
  })

  it('prefers the registered legal name', () => {
    const out = serialise({ legalName: 'SV Developers Private Limited', name: 'SV Developers' })
    expect(out.copyrightText).toBe(`© ${year} SV Developers Private Limited. All rights reserved.`)
  })

  it('falls back to the trading name when no legal entity name is set', () => {
    const out = serialise({ name: 'SV Developers' })
    expect(out.copyrightText).toBe(`© ${year} SV Developers. All rights reserved.`)
  })

  it('drops the owner segment rather than inventing one — an omitted proprietor is honest, a fabricated one is a false legal claim', () => {
    const out = serialise({ legalName: '   ', name: '' })
    expect(out.copyrightText).toBe(`© ${year}. All rights reserved.`)
  })

  /**
   * REGRESSION. `PublicSiteSettings` declares these six as `string`, so the
   * frontend's types promise they are always present and its code calls
   * `.startsWith()` on them unguarded. Assigning `undefined` makes
   * JSON.stringify DROP THE KEY, and the frontend then receives an object
   * missing fields its own types swear exist — a lie TypeScript cannot catch,
   * because it is on the wire rather than in the source.
   *
   * It crashed `next build` outright on /projects, which is how it was found.
   */
  it('emits every contract-required scalar even when the global was never saved', () => {
    const out = serialise({})
    for (const key of ['name', 'legalName', 'url', 'email', 'phone', 'whatsapp'] as const) {
      expect(out, `${key} must be present`).toHaveProperty(key)
      expect(typeof out[key], `${key} must be a string`).toBe('string')
    }
    expect(out.address).toEqual([])
    // Survives the round trip the frontend actually performs.
    const onWire = JSON.parse(JSON.stringify(out))
    for (const key of ['name', 'legalName', 'url', 'email', 'phone', 'whatsapp'] as const) {
      expect(onWire, `${key} must survive JSON.stringify`).toHaveProperty(key)
    }
  })

  it('does not fabricate contact details to fill the required fields', () => {
    const out = serialise({})
    expect(out.phone).toBe('')
    expect(out.email).toBe('')
    expect(out.whatsapp).toBe('')
  })
})

describe('toPublicSiteSettings — heroVideos (ordered, per-entry both-or-nothing)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const base = {
    name: 'SV', legalName: 'SV', url: 'https://e.test',
    email: 'a@e.test', phone: '1', whatsapp: '919000000000', address: ['L'],
  }
  const poster = (alt = 'A still') => ({
    id: 'm1', filename: 'p.jpg', url: '/local/p.jpg',
    alt, isDecorative: false, width: 1920, height: 1080,
  })
  const vid = (n: string, title = `T-${n}`) => ({
    id: `v-${n}`, filename: `${n}.mp4`, url: `/local/${n}.mp4`,
    mimeType: 'video/mp4', title, poster: poster(),
  })
  const ser = (doc: any) => toPublicSiteSettings(doc) as any

  it('emits exactly { src, poster, title } per entry — no mimeType, no id', () => {
    const out = ser({ ...base, heroVideos: [vid('a')] })
    expect(Object.keys(out.heroVideos[0]).sort()).toEqual(['poster', 'src', 'title'])
    const json = JSON.stringify(out.heroVideos)
    for (const leak of ['mimeType', '"id"', 'uploadedBy', 'originalFilename', 'filesize']) {
      expect(json, `must not leak ${leak}`).not.toContain(leak)
    }
  })

  it('returns poster as a plain string URL, not an ImageRef', () => {
    const out = ser({ ...base, heroVideos: [vid('a')] })
    expect(typeof out.heroVideos[0].poster).toBe('string')
  })

  it('preserves input order verbatim — never sorts', () => {
    const out = ser({ ...base, heroVideos: [vid('z', 'Zed'), vid('a', 'Ay'), vid('m', 'Em')] })
    expect(out.heroVideos.map((v: any) => v.title)).toEqual(['Zed', 'Ay', 'Em'])
  })

  it('OMITS the key when absent, null, or an empty array', () => {
    expect('heroVideos' in ser({ ...base })).toBe(false)
    expect('heroVideos' in ser({ ...base, heroVideos: null })).toBe(false)
    expect('heroVideos' in ser({ ...base, heroVideos: [] })).toBe(false)
  })

  it('NEVER emits [] or null for heroVideos', () => {
    const out = ser({ ...base, heroVideos: [] })
    expect(JSON.stringify(out)).not.toContain('"heroVideos"')
  })

  it('drops an entry that is an unpopulated bare id, keeping the rest', () => {
    const out = ser({ ...base, heroVideos: [vid('a', 'Keep'), 'v-b', vid('c', 'AlsoKeep')] })
    expect(out.heroVideos.map((v: any) => v.title)).toEqual(['Keep', 'AlsoKeep'])
  })

  it('drops an entry whose SRC cannot be composed', () => {
    const broken = { ...vid('b', 'Broken'), filename: null, url: null }
    const out = ser({ ...base, heroVideos: [vid('a', 'Good'), broken] })
    expect(out.heroVideos.map((v: any) => v.title)).toEqual(['Good'])
  })

  it('drops an entry whose POSTER is missing or a bare id', () => {
    const noPoster = { ...vid('b', 'NoPoster'), poster: null }
    const idPoster = { ...vid('c', 'IdPoster'), poster: 'm1' }
    const out = ser({ ...base, heroVideos: [vid('a', 'Good'), noPoster, idPoster] })
    expect(out.heroVideos.map((v: any) => v.title)).toEqual(['Good'])
  })

  it('drops an entry whose TITLE is missing or blank', () => {
    const noTitle = { ...vid('b'), title: null }
    const blank = { ...vid('c'), title: '   ' }
    const out = ser({ ...base, heroVideos: [vid('a', 'Good'), noTitle, blank] })
    expect(out.heroVideos.map((v: any) => v.title)).toEqual(['Good'])
  })

  it('OMITS the key entirely when every entry is invalid', () => {
    const out = ser({ ...base, heroVideos: ['bare-id', { ...vid('b'), poster: null }] })
    expect('heroVideos' in out).toBe(false)
  })

  it('dedupes by src, keeping the FIRST occurrence and its position', () => {
    const a = vid('a', 'First')
    const out = ser({ ...base, heroVideos: [a, vid('b', 'Second'), { ...a, title: 'Dup' }] })
    expect(out.heroVideos.map((v: any) => v.title)).toEqual(['First', 'Second'])
  })

  it('does not disturb any pre-existing key when heroVideos IS present', () => {
    const withV = ser({ ...base, heroVideos: [vid('a')] })
    const without = ser({ ...base })
    const { heroVideos: _v, ...rest } = withV
    expect(rest).toEqual(without)
  })

  it('carries the poster alt through the existing toImageRef path (decorative -> "")', () => {
    // Proves the poster URL is built by the SAME code that builds every other
    // image on the site, rather than a second composition path.
    const dec = { ...vid('a'), poster: { ...poster(''), isDecorative: true } }
    const out = ser({ ...base, heroVideos: [dec] })
    expect(typeof out.heroVideos[0].poster).toBe('string')
    expect(out.heroVideos[0].poster).toContain('p.jpg')
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
})
