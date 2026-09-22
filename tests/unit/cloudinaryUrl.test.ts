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

describe('resource type — images vs video vs raw', () => {
  /**
   * 🔴 THE FIRST TWO CASES ARE NO-REGRESSION GUARDS, NOT COVERAGE.
   *
   * `resourceTypeFor` is shared by the image path, the PDF path AND the new
   * video path, and it is what `handleUpload`, `handleDelete` and `generateURL`
   * all derive from. Adding the `video` branch must leave the existing two
   * mappings byte-identical: if `jpg` ever stopped resolving to `image`, every
   * image on the website would 404 and every image delete would silently orphan
   * its Cloudinary object.
   */
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

  /**
   * 🔴 MEASURED AGAINST THE REAL CLOUDINARY ACCOUNT BEFORE THIS BRANCH EXISTED:
   *     .../video/upload/videos/<uuid>.mp4  -> 200
   *     .../raw/upload/videos/<uuid>.mp4    -> 404
   *     .../image/upload/videos/<uuid>.mp4  -> 404
   * `.mp4` used to fall through to `raw`, so without this every video URL would
   * 404 and every video delete would silently orphan the asset.
   */
  it('treats an MP4 as `video`, not the `raw` fallback it used to hit', async () => {
    const { resourceTypeFor } = await load(CREDS)
    expect(resourceTypeFor('abc.mp4')).toBe('video')
    expect(resourceTypeFor('abc.MP4')).toBe('video')
  })

  it('does NOT widen to other video containers — only mp4 is allowed', async () => {
    const { resourceTypeFor } = await load(CREDS)
    // WebM is deferred, and .mov/.m4v share the ftyp box but are not accepted.
    for (const ext of ['webm', 'mov', 'm4v', '3gp', 'avi']) {
      expect(resourceTypeFor(`abc.${ext}`)).toBe('raw')
    }
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

  it('STRIPS the extension for a video — Cloudinary states images AND videos', async () => {
    const { publicIdFor } = await load(CREDS)
    expect(publicIdFor('videos/3f2b.mp4')).toBe('videos/3f2b')
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

  it('composes a video URL under /video/upload/ with no version', async () => {
    const { cloudinaryFileUrl } = await load(CREDS)
    expect(cloudinaryFileUrl('videos', '3f2b.mp4')).toBe(
      'https://res.cloudinary.com/sv-test-cloud/video/upload/videos/3f2b.mp4',
    )
  })

  it('video: the id and the URL address the same object', async () => {
    const { cloudinaryFileUrl, publicIdFor } = await load(CREDS)
    const url = cloudinaryFileUrl('videos', '3f2b.mp4')!
    expect(url).toContain(`/video/upload/${publicIdFor('videos/3f2b.mp4')}.mp4`)
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
