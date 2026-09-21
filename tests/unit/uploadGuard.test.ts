import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

import { documentUploadGuard, imageUploadGuard } from '@/hooks/uploadGuard'

/**
 * THE TEST THAT WAS MISSING — AND WHOSE ABSENCE COST THE WHOLE FEATURE.
 *
 * 🔴 WHY THIS FILE EXISTS. `upload.useTempFiles: true` is set in
 * `payload.config.ts` as a deliberate memory control, and its documented
 * consequence (`payload/dist/uploads/generateFileData.js:39`) is that an
 * uploaded file arrives as a TEMP FILE PATH with `file.data` EMPTY. The guard
 * originally read `file.data` only, so it threw "That file is empty." on the
 * very first line for EVERY HTTP upload — admin panel, REST, bulk upload.
 *
 * Nothing caught it. 189 tests passed, `check:cms` passed, `check:drift` passed
 * and the production build passed, because:
 *   · no test ever posted a real multipart body, and
 *   · the seed uses the LOCAL API, which supplies `data` directly.
 * The production `media` table therefore held ZERO rows.
 *
 * Worse, because the throw happened BEFORE any inspection, the SVG rejection,
 * the declared-vs-actual MIME check, the size ceiling and the decompression-bomb
 * guard were all UNREACHABLE — every one of them "passed" its manual check only
 * because the request had already been rejected for the wrong reason.
 *
 * So these cases assert the guard against BOTH arrival shapes, and assert that
 * the security controls actually fire in the temp-file shape rather than merely
 * that the request failed.
 */

type FakeFile = {
  name: string
  mimetype: string
  size: number
  data: Buffer
  tempFilePath?: string
}

const makeImage = (fmt: 'png' | 'jpeg' | 'webp' | 'avif', w = 64, h = 48): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 12, g: 90, b: 60 } } })[fmt]().toBuffer()

/** The in-memory shape: `useTempFiles: false`. */
const bufferShape = (bytes: Buffer, mimetype: string, name: string): FakeFile => ({
  name,
  mimetype,
  size: bytes.byteLength,
  data: bytes,
})

/** The temp-file shape: `useTempFiles: true` — `data` empty, bytes on disk. */
const tempShape = async (bytes: Buffer, mimetype: string, name: string): Promise<FakeFile> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sv-upload-guard-'))
  const tempFilePath = path.join(dir, 'tmp-upload')
  await writeFile(tempFilePath, bytes)
  return { name, mimetype, size: bytes.byteLength, data: Buffer.alloc(0), tempFilePath }
}

const run = async (guard: typeof imageUploadGuard, file: FakeFile, operation = 'create') => {
  const req = { file } as never
  const context = {} as Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (guard as any)({ req, operation, context, collection: undefined })
  return { file: (req as unknown as { file: FakeFile }).file, context }
}

describe('uploadGuard — both file arrival shapes', () => {
  it('accepts an image supplied as an in-memory buffer (useTempFiles: false)', async () => {
    const png = await makeImage('png')
    const { file, context } = await run(imageUploadGuard, bufferShape(png, 'image/png', 'photo.png'))

    expect(file.name).toMatch(/^[0-9a-f-]{36}\.png$/)
    expect(context.originalFilename).toBe('photo.png')
    expect(context.width).toBe(64)
    expect(context.height).toBe(48)
  })

  it('accepts an image supplied as a TEMP FILE with an empty data buffer (useTempFiles: true)', async () => {
    const png = await makeImage('png')
    const { file, context } = await run(imageUploadGuard, await tempShape(png, 'image/png', 'photo.png'))

    // The regression: this previously threw "That file is empty."
    expect(file.name).toMatch(/^[0-9a-f-]{36}\.png$/)
    expect(context.originalFilename).toBe('photo.png')
    expect(context.width).toBe(64)
  })

  it.each(['png', 'jpeg', 'webp', 'avif'] as const)(
    'accepts %s from a temp file and hands back a populated buffer',
    async (fmt) => {
      const bytes = await makeImage(fmt)
      const mime = fmt === 'jpeg' ? 'image/jpeg' : `image/${fmt}`
      const { file } = await run(imageUploadGuard, await tempShape(bytes, mime, `x.${fmt}`))

      expect(Buffer.isBuffer(file.data)).toBe(true)
      expect(file.data.byteLength).toBeGreaterThan(0)
      expect(file.size).toBe(file.data.byteLength)
    },
  )

  it('DISOWNS the temp file so Payload cannot read the pre-sanitisation bytes back', async () => {
    // Load-bearing: Payload prefers `file.tempFilePath` when it is set
    // (generateFileData.js:147). Leaving it pointed at the original bytes would
    // silently undo the EXIF strip and the re-encode.
    const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .withExifMerge({ IFD0: { Artist: 'SHOULD-NOT-SURVIVE' } })
      .jpeg()
      .toBuffer()

    const { file } = await run(imageUploadGuard, await tempShape(jpeg, 'image/jpeg', 'exif.jpg'))

    expect(file.tempFilePath).toBeUndefined()
    expect(file.data.toString('latin1')).not.toContain('SHOULD-NOT-SURVIVE')
    const meta = await sharp(file.data).metadata()
    expect(meta.exif).toBeFalsy()
  })

  it('still rejects a genuinely empty upload', async () => {
    await expect(
      run(imageUploadGuard, bufferShape(Buffer.alloc(0), 'image/png', 'empty.png')),
    ).rejects.toThrow(/empty/i)
  })
})

describe('uploadGuard — security controls are REACHABLE in the temp-file shape', () => {
  it('rejects an SVG, with the SVG message and not the empty-file message', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    await expect(
      run(imageUploadGuard, await tempShape(svg, 'image/svg+xml', 'x.svg')),
    ).rejects.toThrow(/SVG files cannot be uploaded/i)
  })

  it('rejects a file whose bytes do not match its declared type', async () => {
    const notAnImage = Buffer.from('this is plainly not an image')
    await expect(
      run(imageUploadGuard, await tempShape(notAnImage, 'image/png', 'liar.png')),
    ).rejects.toThrow(/Unrecognised file type|do not match/i)
  })

  it('enforces the pixel ceiling (decompression-bomb guard)', async () => {
    const wide = await sharp({
      create: { width: 12000, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer()
    await expect(
      run(imageUploadGuard, await tempShape(wide, 'image/png', 'wide.png')),
    ).rejects.toThrow(/at most 10000 pixels/i)
  })

  it('rejects a PDF posted to the image collection', async () => {
    const pdf = Buffer.from('%PDF-1.4\ntrailer\n%%EOF\n')
    await expect(
      run(imageUploadGuard, await tempShape(pdf, 'application/pdf', 'x.pdf')),
    ).rejects.toThrow(/not allowed/i)
  })
})

describe('uploadGuard — documents keep streaming from disk', () => {
  it('renames a PDF and leaves the temp file in place (the 25 MB memory control)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
    const file = await tempShape(pdf, 'application/pdf', 'brochure.pdf')
    const tempPath = file.tempFilePath!

    const { file: after, context } = await run(documentUploadGuard, file)

    expect(after.name).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    expect(context.originalFilename).toBe('brochure.pdf')
    // NOT disowned: PDFs are never re-encoded, so there is nothing to replace
    // and the file must keep streaming from disk rather than be buffered.
    expect(after.tempFilePath).toBe(tempPath)
    expect((await readFile(tempPath)).byteLength).toBe(pdf.byteLength)
  })

  it('rejects a non-PDF posted to the document collection', async () => {
    const png = await makeImage('png')
    await expect(
      run(documentUploadGuard, await tempShape(png, 'image/png', 'x.png')),
    ).rejects.toThrow(/not allowed|not a valid PDF/i)
  })
})
