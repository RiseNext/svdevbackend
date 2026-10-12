import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Two properties of `projects.logo` that can only be proven with a stubbed
 * environment, because both modules read `env` AT IMPORT TIME.
 *
 *   1. `logo.src` is produced by the SHARED `cloudinaryFileUrl` helper and
 *      therefore lands on the same delivery path as every other image. The
 *      integration suite cannot show this: Cloudinary is intentionally
 *      unconfigured there, so `buildSrc` falls back to Payload's local-disk URL.
 *
 *   2. Changing ONLY the logo fires the EXISTING project revalidation, with the
 *      tags `projects` and `project:<slug>`. The integration suite cannot show
 *      this either: `REVALIDATE_WEBHOOK_URL` is pinned empty in `.env.test`, so
 *      `revalidate()` takes its "not configured" branch and nothing is
 *      observable.
 */

const CLOUD = 'lcjjdvym'
const CREDS = {
  CLOUDINARY_CLOUD_NAME: CLOUD,
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

// ---------------------------------------------------------------------------
describe('logo.src comes from the shared Cloudinary helper', () => {
  const loadSerialiser = async () => {
    vi.resetModules()
    for (const [k, v] of Object.entries(CREDS)) vi.stubEnv(k, v)
    return import('@/serializers/toPublicProject')
  }

  /** A populated media doc, exactly as `depth: 1` would hand it over. */
  const docWithLogo = (filename: string) =>
    ({
      slug: 'sri-vanam',
      name: 'Sri Vanam',
      category: 'Residential Plots',
      locality: 'Aler',
      summary: 'x',
      description: ['x'],
      highlights: [],
      image: { filename: 'cover.jpg', alt: 'Cover', width: 10, height: 10 },
      logo: { filename, alt: 'Sri Vanam', width: 512, height: 218 },
    }) as never

  it('emits the EXACT production delivery path for a logo', async () => {
    const { toPublicProject } = await loadSerialiser()
    const uuid = '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f'
    const shape = toPublicProject(docWithLogo(`${uuid}.png`)) as Record<string, unknown>
    const logo = shape.logo as { src: string }

    // 🔴 The literal string the frontend's next/image remotePatterns must allow.
    expect(logo.src).toBe(
      `https://res.cloudinary.com/${CLOUD}/image/upload/media/${uuid}.png`,
    )
    expect(logo.src.startsWith(`https://res.cloudinary.com/${CLOUD}/image/upload/media/`)).toBe(true)
  })

  it('uses the `media` folder and the `image` resource type, never `raw`', async () => {
    const { toPublicProject } = await loadSerialiser()
    for (const ext of ['png', 'webp', 'jpg', 'avif']) {
      const shape = toPublicProject(docWithLogo(`abc.${ext}`)) as Record<string, unknown>
      const src = (shape.logo as { src: string }).src
      expect(src, ext).toContain('/image/upload/media/')
      expect(src, ext).not.toContain('/raw/upload/')
      expect(src, ext).not.toContain('/video/upload/')
    }
  })

  it('is byte-identical to what the shared helper returns — no second convention', async () => {
    vi.resetModules()
    for (const [k, v] of Object.entries(CREDS)) vi.stubEnv(k, v)
    const { cloudinaryFileUrl } = await import('@/media/mediaUrl')
    const { toPublicProject } = await import('@/serializers/toPublicProject')

    const filename = '9a5aa726-87a6-43c2-8674-0b09b6c03220.png'
    const shape = toPublicProject(docWithLogo(filename)) as Record<string, unknown>
    // If these ever diverge, the media library 404s while every other test passes.
    expect((shape.logo as { src: string }).src).toBe(cloudinaryFileUrl('media', filename))
  })

  it('still omits the key when there is no logo, with Cloudinary configured', async () => {
    const { toPublicProject } = await loadSerialiser()
    const shape = toPublicProject({
      slug: 'sri-vanam',
      name: 'Sri Vanam',
      category: 'Residential Plots',
      locality: 'Aler',
      summary: 'x',
      description: ['x'],
      highlights: [],
      image: { filename: 'cover.jpg', alt: 'Cover', width: 10, height: 10 },
    } as never) as Record<string, unknown>
    expect('logo' in shape).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('changing ONLY the logo fires the EXISTING project revalidation', () => {
  const WEBHOOK = 'https://frontend.example/api/revalidate'
  const SECRET = 'a-shared-secret-of-sufficient-length-0001'

  const loadHook = async () => {
    vi.resetModules()
    vi.stubEnv('REVALIDATE_WEBHOOK_URL', WEBHOOK)
    vi.stubEnv('REVALIDATE_SECRET', SECRET)
    const { revalidateProject } = await import('@/hooks/revalidate')
    return revalidateProject
  }

  /** Captures the single webhook POST the hook makes. */
  const capture = () => {
    const calls: { url: string; body: { paths: string[]; tags: string[]; secret: string } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) })
        return { ok: true, status: 200 } as Response
      }),
    )
    return calls
  }

  /**
   * The hook receives the doc AFTER the change. Payload passes the whole
   * document to `afterChange` regardless of which fields were touched, which is
   * exactly why a logo-only edit needs no special handling — this test pins that
   * generic behaviour rather than any logo-specific code, because there is none.
   */
  const logoOnlyChange = {
    slug: 'sri-vanam',
    id: 'p1',
    logo: { filename: 'abc.png', alt: 'Sri Vanam', width: 512, height: 218 },
  }

  it('emits the tags `projects` and `project:<slug>`', async () => {
    const revalidateProject = await loadHook()
    const calls = capture()

    await (revalidateProject as unknown as (a: unknown) => Promise<unknown>)({
      req: { payload: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } },
      doc: logoOnlyChange,
      context: {},
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(WEBHOOK)
    expect(calls[0]!.body.tags).toContain('projects')
    expect(calls[0]!.body.tags).toContain('project:sri-vanam')
    // Exactly the two the frontend's getProject() is cached under.
    expect(calls[0]!.body.tags.sort()).toEqual(['project:sri-vanam', 'projects'])
  })

  it('emits every path that renders a project, including /gallery', async () => {
    const revalidateProject = await loadHook()
    const calls = capture()

    await (revalidateProject as unknown as (a: unknown) => Promise<unknown>)({
      req: { payload: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } },
      doc: logoOnlyChange,
      context: {},
    })

    /* The homepage deck is at '/', which is where the logo plate is rendered.
     *
     * 🔶 `/gallery` WAS ADDED, and this assertion changed WITH the behaviour
     * rather than being relaxed to accommodate it — it is still an exact array,
     * in order. That page did not exist when this list was written; it is built
     * entirely from the project set (`getProjects()` then `getProject()` per
     * slug, deduped by `src`), so a new or edited project's photographs belong
     * in the wall as soon as it publishes. Omitting it meant the gallery served
     * a stale set until the one-hour ISR floor expired.
     *
     * If this fails again, the question to ask is whether a route that renders
     * project data was added or removed — not whether the expectation is
     * inconvenient. */
    expect(calls[0]!.body.paths).toEqual([
      '/',
      '/projects',
      '/gallery',
      '/sitemap.xml',
      '/projects/sri-vanam',
    ])
  })

  it('`revalidateProject` is still registered on the Projects afterChange hook', async () => {
    // The wiring, not the payload: if this is ever dropped, a logo edit — and
    // every other edit — silently stops reaching the website.
    vi.resetModules()
    const { Projects } = await import('@/collections/Projects')
    const { revalidateProject } = await import('@/hooks/revalidate')
    expect(Projects.hooks?.afterChange).toContain(revalidateProject)
    expect(Projects.hooks?.afterDelete).toContain(revalidateProject)
  })

  it('honours the existing skipRevalidate escape hatch', async () => {
    // Used by the seed and by every test fixture. A logo change must not become
    // the one edit that ignores it.
    const revalidateProject = await loadHook()
    const calls = capture()

    await (revalidateProject as unknown as (a: unknown) => Promise<unknown>)({
      req: { payload: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } },
      doc: logoOnlyChange,
      context: { skipRevalidate: true },
    })

    expect(calls).toHaveLength(0)
  })
})
