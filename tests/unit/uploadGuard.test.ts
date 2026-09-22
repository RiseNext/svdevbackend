import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

import { documentUploadGuard, imageUploadGuard, videoUploadGuard } from '@/hooks/uploadGuard'

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

/**
 * VIDEO — the same non-re-encoded path as PDFs, with a tighter ceiling.
 *
 * ⚠️ THE FIXTURE IS A STRUCTURALLY VALID CONTAINER, NOT A PLAYABLE VIDEO, and
 * that is the right fixture for THIS file. The guard's entire job is byte
 * inspection: sniff the `ftyp` box, match the allow-list, compare against the
 * declared type, enforce the ceiling, rename. None of that decodes a frame, and
 * committing a real multi-megabyte MP4 to the repository to prove a rename
 * would be the wrong trade. Real end-to-end playability — delivery, content
 * type, range requests, seeking — was verified against the live Cloudinary
 * account with a real H.264/AAC file before any of this code was written.
 */
const makeMp4 = (padding = 0): Buffer =>
  Buffer.concat([
    // ftyp box: size 0x20, major brand isom, compatible brands.
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from('ftyp'),
    Buffer.from('isom'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isom'),
    Buffer.from('iso2'),
    Buffer.from('avc1'),
    Buffer.from('mp41'),
    // mdat box, optionally padded so a case can exceed the size ceiling.
    Buffer.from([0, 0, 0, 8]),
    Buffer.from('mdat'),
    Buffer.alloc(padding),
  ])

describe('uploadGuard — video takes the document path, never the sharp path', () => {
  it('accepts an MP4, renames it to a UUID and preserves the original name', async () => {
    const mp4 = makeMp4()
    const { file, context } = await run(videoUploadGuard, await tempShape(mp4, 'video/mp4', 'Drone Shot FINAL.mp4'))

    expect(file.name).toMatch(/^[0-9a-f-]{36}\.mp4$/)
    expect(file.name).not.toContain('Drone')
    expect(context.originalFilename).toBe('Drone Shot FINAL.mp4')
  })

  it('leaves tempFilePath intact so the adapter STREAMS rather than buffers', async () => {
    const mp4 = makeMp4()
    const file = await tempShape(mp4, 'video/mp4', 'clip.mp4')
    const tempPath = file.tempFilePath!

    const { file: after } = await run(videoUploadGuard, file)

    // This is what routes the upload through `uploadFromPath` in the adapter.
    // If it were disowned, the adapter would fall through to the empty-buffer
    // branch and Cloudinary would answer "Empty file" — the exact PDF outage.
    expect(after.tempFilePath).toBe(tempPath)
    expect((await readFile(tempPath)).byteLength).toBe(mp4.byteLength)
  })

  it('does NOT re-encode — the stored bytes are the uploaded bytes', async () => {
    const mp4 = makeMp4(128)
    const file = await tempShape(mp4, 'video/mp4', 'clip.mp4')
    const { file: after } = await run(videoUploadGuard, file)
    expect((await readFile(after.tempFilePath!)).equals(mp4)).toBe(true)
  })

  it('also works in the in-memory buffer shape', async () => {
    const { file } = await run(videoUploadGuard, bufferShape(makeMp4(), 'video/mp4', 'clip.mp4'))
    expect(file.name).toMatch(/^[0-9a-f-]{36}\.mp4$/)
  })

  it('rejects a video over the 6 MB ceiling', async () => {
    const tooBig = makeMp4(6 * 1024 * 1024 + 1)
    await expect(
      run(videoUploadGuard, await tempShape(tooBig, 'video/mp4', 'huge.mp4')),
    ).rejects.toThrow(/The limit is 6 MB/i)
  })

  it('rejects a JPEG renamed to .mp4 (declared-vs-actual mismatch)', async () => {
    const jpeg = await makeImage('jpeg')
    await expect(
      run(videoUploadGuard, await tempShape(jpeg, 'video/mp4', 'fake.mp4')),
    ).rejects.toThrow(/not allowed|do not match/i)
  })

  it('rejects an executable renamed to .mp4', async () => {
    // A DOS/PE header — the classic "renamed binary" case.
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024, 0x41)])
    await expect(
      run(videoUploadGuard, await tempShape(exe, 'video/mp4', 'payload.mp4')),
    ).rejects.toThrow(/not allowed|Unrecognised|do not match/i)
  })

  it('rejects an SVG renamed to .mp4, with the SVG message', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    await expect(
      run(videoUploadGuard, await tempShape(svg, 'video/mp4', 'x.mp4')),
    ).rejects.toThrow(/SVG files cannot be uploaded/i)
  })

  it('rejects HTML markup smuggled as a video', async () => {
    const html = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>')
    await expect(
      run(videoUploadGuard, await tempShape(html, 'video/mp4', 'x.mp4')),
    ).rejects.toThrow(/web markup|not allowed|Unrecognised/i)
  })

  it('rejects a PDF posted to the video collection', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
    await expect(
      run(videoUploadGuard, await tempShape(pdf, 'application/pdf', 'x.pdf')),
    ).rejects.toThrow(/not allowed/i)
  })

  it('rejects an MP4 posted to the IMAGE collection — the reverse direction', async () => {
    await expect(
      run(imageUploadGuard, await tempShape(makeMp4(), 'video/mp4', 'x.mp4')),
    ).rejects.toThrow(/not allowed/i)
  })

  it('rejects an MP4 posted to the DOCUMENT collection', async () => {
    await expect(
      run(documentUploadGuard, await tempShape(makeMp4(), 'video/mp4', 'x.mp4')),
    ).rejects.toThrow(/not allowed/i)
  })
})
