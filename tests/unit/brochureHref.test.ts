import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * THE BROCHURE HREF — THE 404 THAT REACHED PRODUCTION.
 *
 * 🔴 WHAT HAPPENED. The CTA rendered, and clicking it returned Cloudinary's
 * "Resource not found":
 *
 *   emitted : /raw/upload/387bcd66-….pdf              -> 404
 *   actual  : /raw/upload/documents/387bcd66-….pdf    -> 200, 103617 bytes
 *
 * The asset was perfect — `resource_type: raw`, `public_id:
 * documents/387bcd66-….pdf`, `access_mode: public`, byte count matching
 * `documents.filesize` exactly. The STORED `documents.url` column was correct
 * too. Only the SERIALISED href was wrong.
 *
 * WHY. `url` on an upload collection is a VIRTUAL field — the cloud-storage
 * plugin recomputes it from `{ filename, prefix }` on every populate.
 * `documents.defaultPopulate` is `{ filename, url, title }` and does NOT include
 * `prefix`, so `prefix` arrived `undefined`, `generateURL` composed without the
 * folder, and the serialiser faithfully emitted a public_id that does not exist.
 * The column disagreed with the API because the column was written at UPLOAD
 * time, when `prefix` was still in scope.
 *
 * `media` was never affected because `toImageRef` passes its prefix as a
 * LITERAL and never reads the column. The fix applies that same rule here.
 *
 * These cases pin the composition itself, because the previous implementation
 * passed every existing test: it read a field that was present and a string —
 * just the wrong string. Only asserting the FOLDER catches it.
 */

const CREDS = {
  CLOUDINARY_CLOUD_NAME: 'sv-test-cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
}

const load = async (vars: Record<string, string> = CREDS) => {
  vi.resetModules()
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v)
  return import('@/serializers/toPublicProject')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

/** The minimum a Payload project doc needs, with whatever brochure shape is under test. */
const docWith = (brochure: unknown) =>
  ({
    slug: 'sv-grand-enclave',
    name: 'SV Grand Enclave',
    category: 'Residential Plots',
    locality: 'Aler',
    summary: 'x',
    description: ['x'],
    highlights: [],
    image: { url: '/a.jpg', alt: 'a', width: 1, height: 1, filename: 'a.jpg' },
    brochure,
  }) as never

const PDF = '387bcd66-5d0d-4db7-b20e-57be5eb1c28b.pdf'

/** Exactly what production hands the serialiser: `url` WITHOUT the folder,
 *  because `prefix` was not selected during populate. */
const POPULATED = {
  id: 'd0a01d10-2a6c-463c-8377-8ad84d24666c',
  title: 'SV Grand Enclave Brochure',
  filename: PDF,
  url: `https://res.cloudinary.com/sv-test-cloud/raw/upload/${PDF}`,
}

describe('brochure href is composed deterministically, with the documents/ folder', () => {
  it('emits /raw/upload/documents/ — the regression', async () => {
    const { toPublicProject } = await load()
    const href = toPublicProject(docWith(POPULATED)).brochure!.href

    expect(href).toContain('/raw/upload/documents/')
    expect(href).toBe(`https://res.cloudinary.com/sv-test-cloud/raw/upload/documents/${PDF}`)
  })

  it('preserves the filename exactly', async () => {
    const { toPublicProject } = await load()
    const href = toPublicProject(docWith(POPULATED)).brochure!.href
    expect(href.endsWith(`/${PDF}`)).toBe(true)
    expect(href).toContain(PDF)
  })

  it('uses resource_type "raw" for a PDF, never "image"', async () => {
    // Cloudinary stores PDFs as raw; /image/upload/documents/<pdf> is a 404.
    const { toPublicProject } = await load()
    const href = toPublicProject(docWith(POPULATED)).brochure!.href
    expect(href).toContain('/raw/upload/')
    expect(href).not.toContain('/image/upload/')
  })

  it('IGNORES the prefix-less `url` the plugin regenerates', async () => {
    // The heart of it: the incoming `url` is a valid string and a valid URL —
    // it is simply the wrong one. Trusting it is what shipped the 404.
    const { toPublicProject } = await load()
    const href = toPublicProject(docWith(POPULATED)).brochure!.href
    expect(href).not.toBe(POPULATED.url)
    expect(href.length).toBeGreaterThan(POPULATED.url.length)
  })

  it('still carries the document title through unchanged', async () => {
    const { toPublicProject } = await load()
    const brochure = toPublicProject(docWith(POPULATED)).brochure!
    expect(brochure.title).toBe('SV Grand Enclave Brochure')
    expect(Object.keys(brochure).sort()).toEqual(['href', 'title'])
  })

  it('falls back to `url` when Cloudinary is unconfigured (local disk)', async () => {
    const { toPublicProject } = await load({
      CLOUDINARY_CLOUD_NAME: '',
      CLOUDINARY_API_KEY: '',
      CLOUDINARY_API_SECRET: '',
    })
    const local = { ...POPULATED, url: 'http://localhost:3001/payload-api/documents/file/' + PDF }
    expect(toPublicProject(docWith(local)).brochure!.href).toBe(local.url)
  })
})

describe('brochure omission rules are unchanged', () => {
  it('omits the key entirely when no brochure is attached', async () => {
    const { toPublicProject } = await load()
    const out = toPublicProject(docWith(null)) as Record<string, unknown>
    expect('brochure' in out).toBe(false)
    expect(JSON.stringify(out)).not.toMatch(/\.pdf/i)
  })

  it('omits it when the relation is a bare id (unpopulated)', async () => {
    const { toPublicProject } = await load()
    const out = toPublicProject(docWith('d0a01d10-2a6c-463c-8377-8ad84d24666c')) as Record<string, unknown>
    expect('brochure' in out).toBe(false)
  })

  it('omits it when there is neither a filename nor a url', async () => {
    const { toPublicProject } = await load()
    const out = toPublicProject(docWith({ id: 'x', title: 'A brochure' })) as Record<string, unknown>
    expect('brochure' in out).toBe(false)
  })
})

describe('the rest of the project response is untouched', () => {
  it('serialises identically with and without a brochure, apart from that one key', async () => {
    const { toPublicProject } = await load()
    const withB = toPublicProject(docWith(POPULATED)) as Record<string, unknown>
    const withoutB = toPublicProject(docWith(null)) as Record<string, unknown>

    const { brochure, ...restWith } = withB
    expect(brochure).toBeDefined()
    expect(restWith).toEqual(withoutB)
  })

  it('the image src keeps its own media/ folder — brochure did not disturb it', async () => {
    const { toPublicProject } = await load()
    const out = toPublicProject({
      ...(docWith(POPULATED) as unknown as Record<string, unknown>),
      image: { filename: 'photo.jpg', alt: 'A photo', width: 800, height: 600 },
    } as never)
    expect(out.image.src).toContain('/image/upload/media/')
    expect(out.image.src).toContain('photo.jpg')
  })
})
