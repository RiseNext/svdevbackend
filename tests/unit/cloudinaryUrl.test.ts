import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * THE MEDIA URL IS THE HIGHEST-CONSEQUENCE STRING IN THE SYSTEM.
 *
 * `cloudinaryFileUrl()` is called by BOTH the storage adapter's `generateURL`
 * (what Payload persists in `media.url`) and by `toImageRef()` (what the public
 * API emits as `ImageRef.src`). Get the composition wrong and every image on the
 * website 404s — with no error anywhere in the CMS, because the upload itself
 * succeeded.
 *
 * The module reads the environment at import time, so each case reloads it.
 */

const CREDS = {
  CLOUDINARY_CLOUD_NAME: 'sv-test-cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
}

const load = async (vars: Record<string, string>) => {
  vi.resetModules()
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v)
  return import('@/media/mediaUrl')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('resource type — images vs raw', () => {
  it('treats the four allowed image extensions as Cloudinary `image`', async () => {
    const { resourceTypeFor } = await load(CREDS)
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'avif']) {
      expect(resourceTypeFor(`abc.${ext}`)).toBe('image')
    }
  })

  it('treats a PDF as `raw`', async () => {
    const { resourceTypeFor } = await load(CREDS)
    expect(resourceTypeFor('abc.pdf')).toBe('raw')
  })

  it('is case-insensitive — an uploader may send .JPG', async () => {
    const { resourceTypeFor } = await load(CREDS)
    expect(resourceTypeFor('abc.JPG')).toBe('image')
  })

  it('falls back to `raw` for an unknown or absent extension', async () => {
    const { resourceTypeFor } = await load(CREDS)
    expect(resourceTypeFor('noextension')).toBe('raw')
  })
})

describe('public_id — the extension rule Cloudinary states verbatim', () => {
  /* "The public ID value for images and videos shouldn't include a file
     extension. Include the file extension for `raw` files only."
     Inverting this makes the stored id and the delivery URL disagree. */

  it('STRIPS the extension for an image', async () => {
    const { publicIdFor } = await load(CREDS)
    expect(publicIdFor('media/3f2b.jpg')).toBe('media/3f2b')
  })

  it('KEEPS the extension for a raw file', async () => {
    const { publicIdFor } = await load(CREDS)
    expect(publicIdFor('documents/3f2b.pdf')).toBe('documents/3f2b.pdf')
  })

  it('only strips the FINAL extension, never a dot inside the folder', async () => {
    const { publicIdFor } = await load(CREDS)
    expect(publicIdFor('media/v1.2/3f2b.png')).toBe('media/v1.2/3f2b')
  })
})

describe('delivery URL', () => {
  it('composes an image URL with NO version component', async () => {
    const { cloudinaryFileUrl } = await load(CREDS)
    // The version is optional and needed only on overwrite; `overwrite: false`
    // plus UUID keys means this system never overwrites.
    expect(cloudinaryFileUrl('media', '3f2b.jpg')).toBe(
      'https://res.cloudinary.com/sv-test-cloud/image/upload/media/3f2b.jpg',
    )
  })

  it('composes a raw URL for a PDF under /raw/upload/', async () => {
    const { cloudinaryFileUrl } = await load(CREDS)
    expect(cloudinaryFileUrl('documents', '3f2b.pdf')).toBe(
      'https://res.cloudinary.com/sv-test-cloud/raw/upload/documents/3f2b.pdf',
    )
  })

  it('agrees with publicIdFor — the id and the URL address the same object', async () => {
    const { cloudinaryFileUrl, publicIdFor } = await load(CREDS)
    const storageFilePath = 'media/3f2b.jpg'
    const url = cloudinaryFileUrl('media', '3f2b.jpg')!
    // The URL path after /image/upload/ must be the public_id plus the extension.
    expect(url).toContain(`/image/upload/${publicIdFor(storageFilePath)}.jpg`)
  })

  it('honours a private-CDN / custom-hostname override', async () => {
    const { cloudinaryFileUrl } = await load({
      ...CREDS,
      CLOUDINARY_DELIVERY_BASE_URL: 'https://media.example.test',
    })
    expect(cloudinaryFileUrl('media', '3f2b.jpg')).toBe(
      'https://media.example.test/image/upload/media/3f2b.jpg',
    )
  })

  it('never emits a double slash from a stray trailing or leading slash', async () => {
    const { cloudinaryFileUrl } = await load(CREDS)
    const url = cloudinaryFileUrl('/media/', '3f2b.jpg')!
    expect(url).toBe('https://res.cloudinary.com/sv-test-cloud/image/upload/media/3f2b.jpg')
    expect(url.slice('https://'.length)).not.toContain('//')
  })

  it('returns undefined when Cloudinary is unconfigured — the local-disk path', async () => {
    const { cloudinaryEnabled, cloudinaryFileUrl } = await load({ CLOUDINARY_CLOUD_NAME: '' })
    expect(cloudinaryEnabled).toBe(false)
    // undefined, NOT a half-built URL: callers fall back to Payload's own url.
    expect(cloudinaryFileUrl('media', '3f2b.jpg')).toBeUndefined()
  })

  it('returns undefined for an empty filename rather than a folder URL', async () => {
    const { cloudinaryFileUrl } = await load(CREDS)
    expect(cloudinaryFileUrl('media', '')).toBeUndefined()
  })
})
