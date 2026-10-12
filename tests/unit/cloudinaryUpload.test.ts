import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE DOCUMENTS (PDF) UPLOAD REGRESSION.
 *
 * 🔴 WHAT HAPPENED IN PRODUCTION. Every PDF upload through Admin → Documents
 * returned 500:
 *
 *   POST /api/documents?depth=1 -> 500
 *   "There was an error while uploading files corresponding to the collection
 *    documents with filename <uuid>.pdf"
 *   "Empty file"  (400, from Cloudinary)
 *
 * WHY, exactly — and why `media` was unaffected:
 *
 *   · `useTempFiles: true` puts the bytes at `file.tempFilePath` and leaves
 *     `file.data` an EMPTY Buffer.
 *   · The upload guard RE-ENCODES every image and hands the sanitised bytes back
 *     as `file.data` (`adoptSanitisedBytes`), clearing `tempFilePath`. So `media`
 *     always reaches the adapter with a populated buffer.
 *   · A PDF is deliberately NOT re-encoded — the guard's document branch renames
 *     it and returns — so `file.data` stays empty.
 *   · With Cloudinary on, `generateFileData.js` sets `skipTempFileBuffer` true and
 *     never buffers the file, and `getIncomingFiles.js` then hands the adapter
 *     `{ buffer: <empty>, tempFilePath: <the real bytes> }`.
 *   · The adapter uploaded `file.buffer` unconditionally -> zero bytes ->
 *     Cloudinary's "Empty file".
 *
 * These cases pin BOTH source paths. The first one is the guard rail that
 * matters most for safety: the production-proven `media` buffer path must keep
 * behaving exactly as it did.
 */

type Captured = { options: Record<string, unknown>; body: Buffer }
const captured: Captured[] = []
let failNext: Error | null = null

vi.mock('cloudinary', () => {
  const upload_stream = vi.fn(
    (options: Record<string, unknown>, cb: (e: unknown, r: unknown) => void) => {
      const chunks: Buffer[] = []
      return new Writable({
        write(chunk, _enc, done) {
          chunks.push(Buffer.from(chunk))
          done()
        },
        final(done) {
          const body = Buffer.concat(chunks)
          captured.push({ options, body })
          if (failNext) {
            const err = failNext
            failNext = null
            cb(err, null)
          } else {
            cb(null, { public_id: String(options.public_id), bytes: body.byteLength })
          }
          done()
        },
      })
    },
  )
  return {
    v2: { config: vi.fn(), uploader: { upload_stream, destroy: vi.fn() } },
  }
})

const loadAdapter = async () => {
  const { cloudinaryAdapter } = await import('@/media/cloudinary')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (cloudinaryAdapter as any)({}) as {
    handleUpload: (args: {
      file: { buffer?: Buffer; tempFilePath?: string; filename: string; filesize: number; mimeType: string }
      storageFilePath: string
    }) => Promise<unknown>
    // Declared so the delete-side cases are type-checked too: upload and delete
    // must agree on `resource_type`, and that agreement is what stops a video
    // from being silently orphaned in Cloudinary.
    handleDelete: (args: {
      filename: string
      storageFilePath: string
      // Passed by the plugin on both the replace and the real-delete path. The
      // adapter reads `req.context.skipStorageDelete` off it to tell them apart.
      req?: { context?: Record<string, unknown> }
    }) => Promise<unknown>
  }
}

const writeTemp = async (bytes: Buffer) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sv-cloudinary-'))
  const file = path.join(dir, 'tmp-upload')
  await writeFile(file, bytes)
  return file
}

beforeEach(() => {
  captured.length = 0
  failNext = null
})
afterEach(() => vi.clearAllMocks())

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
const IMG = Buffer.from('fake-image-bytes-but-non-empty')

describe('cloudinary handleUpload — the media (buffer) path is UNCHANGED', () => {
  it('uploads the buffer verbatim when file.buffer has bytes', async () => {
    const adapter = await loadAdapter()
    await adapter.handleUpload({
      file: { buffer: IMG, filename: 'a.jpg', filesize: IMG.byteLength, mimeType: 'image/jpeg' },
      storageFilePath: 'media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg',
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]!.body.equals(IMG)).toBe(true)
    // Images are stored WITHOUT an extension in the public_id.
    expect(captured[0]!.options.resource_type).toBe('image')
    expect(captured[0]!.options.public_id).toBe('media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('PREFERS the buffer even when a tempFilePath is also present', async () => {
    // Ordering guard: media must never be re-routed through the disk path.
    const adapter = await loadAdapter()
    const temp = await writeTemp(Buffer.from('bytes-that-must-not-be-used'))
    await adapter.handleUpload({
      file: { buffer: IMG, tempFilePath: temp, filename: 'a.png', filesize: IMG.byteLength, mimeType: 'image/png' },
      storageFilePath: 'media/11111111-2222-3333-4444-555555555555.png',
    })
    expect(captured[0]!.body.equals(IMG)).toBe(true)
  })

  it('preserves every hardening option on the upload', async () => {
    const adapter = await loadAdapter()
    await adapter.handleUpload({
      file: { buffer: IMG, filename: 'a.webp', filesize: IMG.byteLength, mimeType: 'image/webp' },
      storageFilePath: 'media/99999999-8888-7777-6666-555555555555.webp',
    })
    const o = captured[0]!.options
    expect(o.type).toBe('upload')
    expect(o.access_mode).toBe('public')
    expect(o.overwrite).toBe(false)
    expect(o.use_filename).toBe(false)
    expect(o.unique_filename).toBe(false)
    expect(o.discard_original_filename).toBe(true)
  })
})

describe('cloudinary handleUpload — the documents (temp-file) path', () => {
  it('streams the PDF from tempFilePath when file.buffer is EMPTY', async () => {
    // This is the exact production shape: empty buffer + real bytes on disk.
    const adapter = await loadAdapter()
    const temp = await writeTemp(PDF)

    await adapter.handleUpload({
      file: {
        buffer: Buffer.alloc(0),
        tempFilePath: temp,
        filename: '6263494e-50b3-4d3f-9521-74b385d5104f.pdf',
        filesize: PDF.byteLength,
        mimeType: 'application/pdf',
      },
      storageFilePath: 'documents/6263494e-50b3-4d3f-9521-74b385d5104f.pdf',
    })

    expect(captured).toHaveLength(1)
    // The regression: this used to be 0 bytes, which Cloudinary rejects.
    expect(captured[0]!.body.byteLength).toBe(PDF.byteLength)
    expect(captured[0]!.body.equals(PDF)).toBe(true)
  })

  it('stores a PDF as a RAW asset and KEEPS the extension in the public_id', async () => {
    // Cloudinary: "include the file extension for raw files only". Get this
    // wrong and the public_id and the delivery URL stop agreeing -> 404.
    const adapter = await loadAdapter()
    const temp = await writeTemp(PDF)
    await adapter.handleUpload({
      file: { buffer: Buffer.alloc(0), tempFilePath: temp, filename: 'x.pdf', filesize: PDF.byteLength, mimeType: 'application/pdf' },
      storageFilePath: 'documents/6263494e-50b3-4d3f-9521-74b385d5104f.pdf',
    })
    expect(captured[0]!.options.resource_type).toBe('raw')
    expect(captured[0]!.options.public_id).toBe(
      'documents/6263494e-50b3-4d3f-9521-74b385d5104f.pdf',
    )
  })

  it('also works when buffer is undefined rather than an empty Buffer', async () => {
    const adapter = await loadAdapter()
    const temp = await writeTemp(PDF)
    await adapter.handleUpload({
      file: { tempFilePath: temp, filename: 'x.pdf', filesize: PDF.byteLength, mimeType: 'application/pdf' },
      storageFilePath: 'documents/aaaa1111-2222-3333-4444-555555555555.pdf',
    })
    expect(captured[0]!.body.equals(PDF)).toBe(true)
  })

  it('surfaces a Cloudinary error instead of resolving silently', async () => {
    const adapter = await loadAdapter()
    const temp = await writeTemp(PDF)
    failNext = new Error('Empty file')
    await expect(
      adapter.handleUpload({
        file: { buffer: Buffer.alloc(0), tempFilePath: temp, filename: 'x.pdf', filesize: 1, mimeType: 'application/pdf' },
        storageFilePath: 'documents/bbbb1111-2222-3333-4444-555555555555.pdf',
      }),
    ).rejects.toThrow(/Empty file/)
  })

  it('rejects a missing temp file rather than uploading nothing', async () => {
    const adapter = await loadAdapter()
    await expect(
      adapter.handleUpload({
        file: {
          buffer: Buffer.alloc(0),
          tempFilePath: path.join(tmpdir(), 'sv-does-not-exist-zzz', 'nope'),
          filename: 'x.pdf',
          filesize: 1,
          mimeType: 'application/pdf',
        },
        storageFilePath: 'documents/cccc1111-2222-3333-4444-555555555555.pdf',
      }),
    ).rejects.toThrow()
  })
})

describe('cloudinary handleUpload — never upload zero bytes silently', () => {
  it('throws a NAMED error when there is neither a buffer nor a tempFilePath', async () => {
    // Cloudinary's own "Empty file" named neither the collection nor which
    // representation was missing, which is what made this take so long to find.
    const adapter = await loadAdapter()
    await expect(
      adapter.handleUpload({
        file: { buffer: Buffer.alloc(0), filename: 'x.pdf', filesize: 0, mimeType: 'application/pdf' },
        storageFilePath: 'documents/dddd1111-2222-3333-4444-555555555555.pdf',
      }),
    ).rejects.toThrow(/has no bytes.*tempFilePath/is)

    expect(captured, 'nothing may be sent to Cloudinary').toHaveLength(0)
  })
})

const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftyp'),
  Buffer.from('isom'),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from('isom'),
  Buffer.from('iso2'),
  Buffer.from('avc1'),
  Buffer.from('mp41'),
  Buffer.from([0, 0, 0, 8]),
  Buffer.from('mdat'),
])

describe('cloudinary handleUpload — the videos (temp-file) path', () => {
  it('streams the MP4 from tempFilePath, bytes intact', async () => {
    // Video is never re-encoded, so it arrives in exactly the PDF shape:
    // empty buffer, real bytes on disk.
    const adapter = await loadAdapter()
    const temp = await writeTemp(MP4)

    await adapter.handleUpload({
      file: {
        buffer: Buffer.alloc(0),
        tempFilePath: temp,
        filename: '7f3c2a10-4b5d-4e6f-8a9b-0c1d2e3f4a5b.mp4',
        filesize: MP4.byteLength,
        mimeType: 'video/mp4',
      },
      storageFilePath: 'videos/7f3c2a10-4b5d-4e6f-8a9b-0c1d2e3f4a5b.mp4',
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]!.body.byteLength).toBe(MP4.byteLength)
    expect(captured[0]!.body.equals(MP4)).toBe(true)
  })

  it('stores it as a VIDEO asset and STRIPS the extension from the public_id', async () => {
    const adapter = await loadAdapter()
    const temp = await writeTemp(MP4)
    await adapter.handleUpload({
      file: { buffer: Buffer.alloc(0), tempFilePath: temp, filename: 'x.mp4', filesize: MP4.byteLength, mimeType: 'video/mp4' },
      storageFilePath: 'videos/7f3c2a10-4b5d-4e6f-8a9b-0c1d2e3f4a5b.mp4',
    })
    // NOT 'raw' — the extension-derived mapping is what makes the delivery URL
    // resolve, and `raw` was measured to 404 against the real account.
    expect(captured[0]!.options.resource_type).toBe('video')
    expect(captured[0]!.options.public_id).toBe('videos/7f3c2a10-4b5d-4e6f-8a9b-0c1d2e3f4a5b')
  })

  it('applies the SAME hardening options as images and PDFs', async () => {
    const adapter = await loadAdapter()
    const temp = await writeTemp(MP4)
    await adapter.handleUpload({
      file: { buffer: Buffer.alloc(0), tempFilePath: temp, filename: 'x.mp4', filesize: MP4.byteLength, mimeType: 'video/mp4' },
      storageFilePath: 'videos/aaaa2222-3333-4444-5555-666666666666.mp4',
    })
    const o = captured[0]!.options
    expect(o.type).toBe('upload')
    expect(o.access_mode).toBe('public')
    expect(o.overwrite).toBe(false)
    expect(o.discard_original_filename).toBe(true)
  })
})

describe('cloudinary handleDelete — upload and delete MUST agree on resource_type', () => {
  /**
   * 🔴 THE SILENT-ORPHAN GUARD, AND IT IS THE REASON THIS BLOCK EXISTS.
   *
   * `handleUpload` and `handleDelete` both derive `resource_type` from
   * `resourceTypeFor`. If they ever disagreed, Cloudinary would answer
   * "not found" on the destroy, the adapter would resolve normally, the Payload
   * row would disappear, and the asset would stay in Cloudinary forever — with
   * NO error in any log. Nothing else in the system would notice.
   */
  const getDestroy = async () => {
    const mod = (await import('cloudinary')) as unknown as {
      v2: { uploader: { destroy: { mock: { calls: unknown[][] } } } }
    }
    return mod.v2.uploader.destroy
  }

  it('deletes a VIDEO as resource_type video, with the extension stripped', async () => {
    const adapter = await loadAdapter()
    const destroy = await getDestroy()
    await adapter.handleDelete({
      filename: '7f3c2a10-4b5d-4e6f-8a9b-0c1d2e3f4a5b.mp4',
      storageFilePath: 'videos/7f3c2a10-4b5d-4e6f-8a9b-0c1d2e3f4a5b.mp4',
    })

    const [publicId, opts] = destroy.mock.calls.at(-1) as [string, Record<string, unknown>]
    expect(publicId).toBe('videos/7f3c2a10-4b5d-4e6f-8a9b-0c1d2e3f4a5b')
    expect(opts.resource_type).toBe('video')
    expect(opts.invalidate).toBe(true)
  })

  it('still deletes an IMAGE as image and a PDF as raw — no regression', async () => {
    const adapter = await loadAdapter()
    const destroy = await getDestroy()

    await adapter.handleDelete({
      filename: 'a.jpg',
      storageFilePath: 'media/11112222-3333-4444-5555-666666666666.jpg',
    })
    let [publicId, opts] = destroy.mock.calls.at(-1) as [string, Record<string, unknown>]
    expect(opts.resource_type).toBe('image')
    expect(publicId).toBe('media/11112222-3333-4444-5555-666666666666')

    await adapter.handleDelete({
      filename: 'a.pdf',
      storageFilePath: 'documents/11112222-3333-4444-5555-666666666666.pdf',
    })
    ;[publicId, opts] = destroy.mock.calls.at(-1) as [string, Record<string, unknown>]
    expect(opts.resource_type).toBe('raw')
    expect(publicId).toBe('documents/11112222-3333-4444-5555-666666666666.pdf')
  })

  it('round-trips: the public_id uploaded is the public_id destroyed', async () => {
    const adapter = await loadAdapter()
    const destroy = await getDestroy()
    const temp = await writeTemp(MP4)
    const storageFilePath = 'videos/cafe0000-1111-2222-3333-444444444444.mp4'

    await adapter.handleUpload({
      file: { buffer: Buffer.alloc(0), tempFilePath: temp, filename: 'x.mp4', filesize: MP4.byteLength, mimeType: 'video/mp4' },
      storageFilePath,
    })
    await adapter.handleDelete({ filename: 'x.mp4', storageFilePath })

    const uploadedId = captured.at(-1)!.options.public_id
    const [destroyedId] = destroy.mock.calls.at(-1) as [string]
    expect(destroyedId).toBe(uploadedId)
  })
})

/**
 * REPLACE PRESERVATION — the data-loss fix for file replacement.
 *
 * 🔴 WHAT WAS WRONG. `@payloadcms/plugin-cloud-storage`'s `afterChange` calls
 * `handleDelete` on every key absent from the NEW document
 * (dist/hooks/afterChange.js:82-135). `uploadGuard` renames every upload that
 * carries bytes — updates included — to a fresh `randomUUID()`, so on a replace
 * the previous key is ALWAYS "absent" and was always destroyed: original and
 * generated thumbnail, in the same request, with `invalidate: true` purging the
 * CDN. An accidental wrong-file replacement was unrecoverable the instant Save
 * was pressed, and the repo's own "recoverable for 30 days" promise was false.
 *
 * THE FIX. `captureReplacedFile` sets `req.context.skipStorageDelete` before the
 * plugin's hook runs (plugin hooks are appended after the collection's own), and
 * the adapter returns early on it. These tests pin both directions, because the
 * flag must be narrow: a REAL delete has to keep destroying.
 */
describe('handleDelete preserves the previous object on a replace', () => {
  const getDestroyMock = async () => {
    const mod = (await import('cloudinary')) as unknown as {
      v2: { uploader: { destroy: ReturnType<typeof vi.fn> } }
    }
    return mod.v2.uploader.destroy
  }

  it('destroys normally when there is no req at all (sweeper / afterDelete path)', async () => {
    const adapter = await loadAdapter()
    const destroy = await getDestroyMock()

    await adapter.handleDelete({ filename: 'a.jpg', storageFilePath: 'media/a.jpg' })

    expect(destroy).toHaveBeenCalledTimes(1)
    const [publicId, opts] = destroy.mock.calls.at(-1) as [string, Record<string, unknown>]
    expect(publicId).toContain('media/a')
    expect(opts.invalidate).toBe(true)
  })

  it('destroys normally when req.context carries no flag (ordinary delete)', async () => {
    const adapter = await loadAdapter()
    const destroy = await getDestroyMock()

    await adapter.handleDelete({
      filename: 'b.jpg',
      storageFilePath: 'media/b.jpg',
      req: { context: { skipAudit: true } },
    })

    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('🔴 does NOT destroy when skipStorageDelete is set (the replace path)', async () => {
    const adapter = await loadAdapter()
    const destroy = await getDestroyMock()

    await adapter.handleDelete({
      filename: 'old.jpg',
      storageFilePath: 'media/old.jpg',
      req: { context: { skipStorageDelete: true } },
    })

    expect(
      destroy,
      'a replaced object must survive — this is the data-loss fix',
    ).not.toHaveBeenCalled()
  })

  it('does not destroy the generated thumbnail either', async () => {
    const adapter = await loadAdapter()
    const destroy = await getDestroyMock()

    // The plugin issues one handleDelete per stale key: original + each size.
    for (const key of ['media/old.jpg', 'media/old-400x300.jpg']) {
      await adapter.handleDelete({
        filename: key.split('/')[1]!,
        storageFilePath: key,
        req: { context: { skipStorageDelete: true } },
      })
    }

    expect(destroy).not.toHaveBeenCalled()
  })

  it('a falsy flag still destroys — the guard must not be truthiness-by-accident', async () => {
    const adapter = await loadAdapter()
    const destroy = await getDestroyMock()

    await adapter.handleDelete({
      filename: 'c.mp4',
      storageFilePath: 'videos/c.mp4',
      req: { context: { skipStorageDelete: false } },
    })

    expect(destroy).toHaveBeenCalledTimes(1)
    const [, opts] = destroy.mock.calls.at(-1) as [string, Record<string, unknown>]
    // And the video resource type still agrees with the upload side.
    expect(opts.resource_type).toBe('video')
  })
})
