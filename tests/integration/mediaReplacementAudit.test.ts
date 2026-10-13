import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'

/**
 * REPLACING A FILE MUST BE AUDITED.
 *
 * 🔴 THE DEFECT THIS PINS. `captureReplacedFile` records the superseded
 * filename with a nested `payload.update({ …, req, context: { skipAudit: true }
 * })`. Passing `req` shares the transaction — which is correct — but
 * `createLocalReq` MUTATES that req rather than cloning it, so `skipAudit: true`
 * stuck to `req.context` permanently. Because Payload re-reads `context:
 * req.context` for every remaining hook, the very next hook in the chain —
 * `auditAfterChange`, registered right after `captureReplacedFile` on
 * `media`/`documents`/`videos` — hit its own `if (context?.skipAudit) return`
 * and bailed.
 *
 * Net effect: **every file replacement on the three upload collections went
 * unrecorded in the audit log**, while ordinary field edits were recorded
 * normally — which is the worst shape for a defect like this, because spot
 * checks on alt-text edits looked fine. Fixed by `preservingReq`
 * (`src/lib/nestedWrite.ts`).
 *
 * These tests do not need Cloudinary. The storage plugin is inert in the test
 * environment (`CLOUDINARY_CLOUD_NAME` is blank, so `enabled: false` and the
 * plugin registers no hooks), but `captureReplacedFile` and `auditAfterChange`
 * are our own collection hooks and run regardless. The audit poisoning is pure
 * repo code, so it is fully reproducible here.
 */

let payload: Payload

let pad = 0
const jpegBytes = async (): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: {
      width: 64 + (pad++ % 7),
      height: 48,
      channels: 3,
      background: { r: 9, g: 60, b: 33 },
    },
  })
    .jpeg()
    .toBuffer()
}

const auditRowsFor = async (entityType: string, entityId: string) =>
  payload.find({
    collection: 'audit-log',
    where: { and: [{ entityType: { equals: entityType } }, { entityId: { equals: entityId } }] },
    overrideAccess: true,
    limit: 50,
    depth: 0,
    sort: '-createdAt',
  })

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)
})

describe('file replacement is recorded in the audit log', () => {
  it('replacing an image writes BOTH the superseded filename and an audit row', async () => {
    // CREATE — deliberately audited, so we can prove the replace adds a row
    // rather than merely that rows exist.
    const first = await jpegBytes()
    const created = await payload.create({
      collection: 'media',
      overrideAccess: true,
      file: { data: first, name: 'audit-original.jpg', mimetype: 'image/jpeg', size: first.length },
      data: { alt: 'Audited original' },
    })
    const id = String(created.id)
    const originalFilename = created.filename as string
    expect(originalFilename).toBeTruthy()

    const afterCreate = await auditRowsFor('media', id)
    expect(afterCreate.totalDocs, 'the create itself should be audited').toBeGreaterThanOrEqual(1)

    // REPLACE the file.
    const second = await jpegBytes()
    const replaced = await payload.update({
      collection: 'media',
      id,
      overrideAccess: true,
      file: {
        data: second,
        name: 'audit-replacement.jpg',
        mimetype: 'image/jpeg',
        size: second.length,
      },
      data: {},
    })

    // The upload guard renames to a fresh UUID on update as well as create, so
    // the stored key always changes on a replace.
    expect(replaced.filename).not.toBe(originalFilename)

    // Existing behaviour preserved: the old key is still recorded. Must be
    // RE-READ — `captureReplacedFile` records it via a nested update from
    // `afterChange`, so the document returned by `update()` was already built.
    const reread = await payload.findByID({ collection: 'media', id, overrideAccess: true })
    expect(reread.supersededFilenames).toContain(originalFilename)

    // 🔴 THE ASSERTION THE DEFECT MADE FAIL.
    const afterReplace = await auditRowsFor('media', id)
    expect(
      afterReplace.totalDocs,
      'the replacement must add an audit row — `skipAudit` must not leak out of captureReplacedFile',
    ).toBeGreaterThan(afterCreate.totalDocs)

    /**
     * 🔴 AND THE ROW MUST NAME THE SUPERSEDED STORAGE KEY, WITH A TIMESTAMP.
     *
     * This is the half that was missing. The row existed but carried
     * `changes: null`, because `filename` was absent from `SENSITIVE_FIELDS` —
     * so the audit log said "this media document was edited" and nothing about
     * which Cloudinary object had just been orphaned.
     *
     * That gap is why `sweepDeletedMedia` documented superseded-object
     * collection as needing a new child table: there was no record of WHEN a key
     * was superseded. With `filename` in the diff there now is one, in an
     * append-only table, and no migration was required. See the note on
     * SENSITIVE_FIELDS and the revised scope limit on the sweep task.
     */
    const row = afterReplace.docs[0] as unknown as {
      changes?: { filename?: { from?: unknown; to?: unknown } } | null
      createdAt?: string
    }
    expect(row.changes?.filename?.from, 'the superseded key must be recorded').toBe(
      originalFilename,
    )
    expect(row.changes?.filename?.to, 'the replacement key must be recorded').toBe(
      replaced.filename,
    )
    // The timestamp that makes safe garbage collection possible at all.
    expect(Number.isNaN(Date.parse(String(row.createdAt))), 'audit rows are dated').toBe(false)
  })

  it('the superseded key is discoverable by DATE, which is what a future sweeper needs', async () => {
    /**
     * The query shape the revised scope limit on `sweepDeletedMedia` documents,
     * exercised for real so the comment cannot rot into a false claim. If this
     * ever stops returning the key, the basis for safe collection is gone and
     * the note needs rewriting — the test is what forces that.
     *
     * ⚠️ This does NOT delete anything, and nothing in this release does.
     * `MEDIA_SWEEP_ENABLED` stays off; this only proves the data exists.
     */
    const first = await jpegBytes()
    const created = await payload.create({
      collection: 'media',
      overrideAccess: true,
      file: { data: first, name: 'gc-basis.jpg', mimetype: 'image/jpeg', size: first.length },
      data: { alt: 'Garbage-collection basis' },
    })
    const supersededKey = created.filename as string

    const second = await jpegBytes()
    await payload.update({
      collection: 'media',
      id: String(created.id),
      overrideAccess: true,
      file: { data: second, name: 'gc-basis-2.jpg', mimetype: 'image/jpeg', size: second.length },
      data: {},
    })

    // Every superseded key across the three upload collections, with its date.
    const candidates = await payload.find({
      collection: 'audit-log',
      overrideAccess: true,
      where: {
        and: [
          { action: { equals: 'update' } },
          { entityType: { in: ['media', 'documents', 'videos'] } },
        ],
      },
      limit: 200,
      depth: 0,
      sort: '-createdAt',
    })

    const superseded = (
      candidates.docs as unknown as {
        changes?: { filename?: { from?: unknown } } | null
        createdAt?: string
      }[]
    )
      .map((d) => ({ key: d.changes?.filename?.from, at: d.createdAt }))
      .filter((x): x is { key: string; at: string } => typeof x.key === 'string')

    const hit = superseded.find((x) => x.key === supersededKey)
    expect(hit, 'the superseded key must be findable with its supersession date').toBeDefined()
    expect(Number.isNaN(Date.parse(hit!.at))).toBe(false)
  })

  it('an ordinary field edit is still audited, and records no superseded filename', async () => {
    const bytes = await jpegBytes()
    const created = await payload.create({
      collection: 'media',
      overrideAccess: true,
      file: { data: bytes, name: 'audit-altonly.jpg', mimetype: 'image/jpeg', size: bytes.length },
      data: { alt: 'Before' },
    })
    const id = String(created.id)
    const before = await auditRowsFor('media', id)

    const edited = await payload.update({
      collection: 'media',
      id,
      overrideAccess: true,
      data: { alt: 'After' },
    })

    expect(edited.alt).toBe('After')
    // No new file, so nothing was superseded and the storage key is unchanged.
    expect(edited.filename).toBe(created.filename)
    expect(edited.supersededFilenames ?? []).toHaveLength(0)

    const after = await auditRowsFor('media', id)
    expect(after.totalDocs, 'a metadata edit must still be audited').toBeGreaterThan(
      before.totalDocs,
    )
  })

  it('replacing a video is audited too', async () => {
    // `videos.poster` is required, so the fixture needs an image first.
    const posterBytes = await jpegBytes()
    const poster = await payload.create({
      collection: 'media',
      overrideAccess: true,
      file: {
        data: posterBytes,
        name: 'audit-poster.jpg',
        mimetype: 'image/jpeg',
        size: posterBytes.length,
      },
      data: { alt: 'Audited poster' },
    })

    const mp4 = (padding: number): Buffer => {
      const mdatSize = 8 + padding
      return Buffer.concat([
        Buffer.from([0, 0, 0, 0x20]),
        Buffer.from('ftyp'),
        Buffer.from('isom'),
        Buffer.from([0, 0, 2, 0]),
        Buffer.from('isomiso2avc1mp41'),
        Buffer.from([
          (mdatSize >> 24) & 0xff,
          (mdatSize >> 16) & 0xff,
          (mdatSize >> 8) & 0xff,
          mdatSize & 0xff,
        ]),
        Buffer.from('mdat'),
        Buffer.alloc(padding, 0),
      ])
    }

    const firstClip = mp4(32)
    const created = await payload.create({
      collection: 'videos',
      overrideAccess: true,
      file: {
        data: firstClip,
        name: 'audit-clip.mp4',
        mimetype: 'video/mp4',
        size: firstClip.length,
      },
      data: { title: 'Audited clip', poster: poster.id },
    })
    const id = String(created.id)
    const originalFilename = created.filename as string
    const before = await auditRowsFor('videos', id)

    const secondClip = mp4(64)
    const replaced = await payload.update({
      collection: 'videos',
      id,
      overrideAccess: true,
      file: {
        data: secondClip,
        name: 'audit-clip-v2.mp4',
        mimetype: 'video/mp4',
        size: secondClip.length,
      },
      data: {},
    })

    expect(replaced.filename).not.toBe(originalFilename)
    const reread = await payload.findByID({ collection: 'videos', id, overrideAccess: true })
    expect(reread.supersededFilenames).toContain(originalFilename)

    const after = await auditRowsFor('videos', id)
    expect(after.totalDocs, 'a video replacement must be audited').toBeGreaterThan(before.totalDocs)
  })
})

describe('preservingReq leaves the request as it found it', () => {
  /**
   * The unit-level guarantee behind the three cases above: a nested write must
   * not leave `skipAudit` (or a nulled `req.file`) behind for the hooks that
   * run after it.
   */
  it('restores req.context and req.file even when the nested write throws', async () => {
    const { preservingReq } = await import('@/lib/nestedWrite')

    const originalContext = { marker: 'outer' } as Record<string, unknown>
    const originalFile = { name: 'in-flight.jpg' } as unknown
    const req = { context: originalContext, file: originalFile } as never as {
      context: Record<string, unknown>
      file: unknown
    }

    await expect(
      preservingReq(req as never, async () => {
        // Simulate what createLocalReq does to the caller's req.
        req.context = { ...req.context, skipAudit: true }
        req.file = undefined
        throw new Error('nested write failed')
      }),
    ).rejects.toThrow('nested write failed')

    expect(req.context).toBe(originalContext)
    expect(req.context.skipAudit).toBeUndefined()
    expect(req.file).toBe(originalFile)
  })
})
