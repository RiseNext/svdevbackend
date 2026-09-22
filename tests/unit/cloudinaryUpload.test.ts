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
