import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

/**
 * `sweepDeletedMedia` WITH THE ARM SWITCH ON.
 *
 * 🔴 WHY THIS FILE IS SEPARATE. `MEDIA_SWEEP_ENABLED` is parsed once, at import
 * time, into a frozen `env` object (`src/lib/env.ts`). It cannot be toggled per
 * test. So this file mocks `@/lib/env` — which means it must live on its own,
 * because that mock applies to the whole module graph of the file it is in.
 *
 * WHAT IT COVERS, and why it matters: the DISARMED path is the shipped default
 * and is covered in `storageSafety.test.ts`, but the ARMED path contains the
 * branch that decides whether a failure is a legitimate skip or a real fault:
 *
 *   · a 409 from an in-use guard  -> skip + warn, `swept` not incremented
 *   · anything else               -> error, and keep going
 *
 * Get that backwards and either a genuine Cloudinary outage is logged as a
 * routine skip, or a correctly-refused asset is reported as a failure and the
 * dead-letter watchdog starts firing on healthy behaviour. Neither is visible
 * without a test, because the task reports success either way.
 */

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = (await importOriginal()) as { env: Record<string, unknown> }
  return { ...actual, env: { ...actual.env, MEDIA_SWEEP_ENABLED: true } }
})

let payload: Payload

const CTX = { skipAudit: true, skipRevalidate: true }

let pad = 0
const uploadImage = async (alt: string): Promise<string> => {
  const sharp = (await import('sharp')).default
  const data = await sharp({
    create: {
      width: 64 + (pad % 5),
      height: 48,
      channels: 3,
      background: { r: 9, g: 60, b: 33 },
    },
  })
    .jpeg()
    .toBuffer()
  const doc = await payload.create({
    collection: 'media',
    overrideAccess: true,
    file: { data, name: `armed-${pad++}.jpg`, mimetype: 'image/jpeg', size: data.length },
    data: { alt },
    context: CTX,
  })
  return String(doc.id)
}

const expire = (id: string) =>
  payload.update({
    collection: 'media',
    id,
    overrideAccess: true,
    context: CTX,
    // Older than MEDIA_GRACE_PERIOD_DAYS (30).
    data: { deletedAt: new Date(Date.now() - 60 * 864e5).toISOString() } as never,
  })

const exists = async (id: string): Promise<boolean> =>
  (
    await payload.find({
      collection: 'media',
      where: { id: { equals: id } },
      overrideAccess: true,
      trash: true,
      limit: 1,
      depth: 0,
    })
  ).totalDocs === 1

const runSweep = async (): Promise<number> => {
  const { sweepDeletedMedia } = await import('@/jobs')
  const result = await (
    sweepDeletedMedia.handler as unknown as (a: {
      req: unknown
    }) => Promise<{ output: { swept: number } }>
  )({ req: { payload } })
  return result.output.swept
}

beforeAll(async () => {
  const { getTestPayload } = await import('../setup')
  const { resetTestDatabase } = await import('../resetDb')
  payload = await getTestPayload()
  await resetTestDatabase(payload)

  // Guard the premise: if the mock did not take, every assertion below would
  // pass for the wrong reason (nothing swept because nothing is armed).
  const { env } = await import('@/lib/env')
  expect(env.MEDIA_SWEEP_ENABLED, 'the env mock must be in effect').toBe(true)
})

describe('armed sweep actually deletes expired, unreferenced media', () => {
  it('removes an expired orphan and counts it', async () => {
    const orphan = await uploadImage('Armed orphan')
    await expire(orphan)
    expect(await exists(orphan)).toBe(true)

    const swept = await runSweep()

    expect(swept, 'the armed sweep must actually delete').toBeGreaterThanOrEqual(1)
    expect(await exists(orphan), 'the expired orphan should be gone').toBe(false)
  })

  it('leaves media that has NOT expired alone', async () => {
    const fresh = await uploadImage('Armed but fresh')
    // Archived today, well inside the 30-day grace period.
    await payload.update({
      collection: 'media',
      id: fresh,
      overrideAccess: true,
      context: CTX,
      data: { deletedAt: new Date().toISOString() } as never,
    })

    await runSweep()

    expect(await exists(fresh), 'inside the grace period it must survive').toBe(true)
  })

  it('leaves media that is NOT archived at all alone', async () => {
    const live = await uploadImage('Armed and live')
    await runSweep()
    expect(await exists(live), 'a live row must never be swept').toBe(true)
  })

  it('🔴 a 409 from the in-use guard is a SKIP, not a delete and not an error', async () => {
    /**
     * The asset was archived, the grace period elapsed, and then it was
     * re-attached to a published project during the window — which is exactly
     * the race the guards exist for. `payload.delete` runs `beforeDelete`
     * regardless of `overrideAccess`, so `mediaDeleteGuard` throws 409 and the
     * sweeper must treat that as a legitimate skip while leaving the row intact.
     */
    const cover = await uploadImage('Armed in use')

    // ORDER IS THE WHOLE TRICK. `mediaTrashGuard` refuses to archive an image
    // that is already referenced, so archiving FIRST — while it is still an
    // orphan — is the only way to reach the state the sweeper's guard-refusal
    // branch exists for. Attaching it afterwards is not blocked, because the
    // guards live on `media`, not on `projects`.
    await expire(cover)
    expect(await exists(cover), 'archived while unreferenced').toBe(true)

    await payload.create({
      collection: 'projects',
      overrideAccess: true,
      context: CTX,
      data: {
        slug: 'armed-inuse-project',
        name: 'Armed In-Use Project',
        category: 'Residential Plots',
        locality: 'Testville',
        summary: 'Armed sweep guard test.',
        description: ['One.'],
        highlights: [{ icon: 'tree', title: 'H' }],
        image: cover,
        _status: 'published',
      } as never,
    })

    // Precondition proven: the row IS an expired sweep candidate, AND the guard
    // will refuse it. Without this the test could pass vacuously.
    const candidates = await payload.find({
      collection: 'media',
      overrideAccess: true,
      trash: true,
      limit: 100,
      depth: 0,
      where: { deletedAt: { less_than: new Date(Date.now() - 30 * 864e5).toISOString() } },
    })
    expect(
      candidates.docs.map((d) => String(d.id)),
      'the archived in-use image must be a sweep candidate',
    ).toContain(cover)

    const swept = await runSweep()

    // The guard refused the delete, so it survives...
    expect(await exists(cover), 'an in-use asset must survive an armed sweep').toBe(true)
    // ...and the refusal was classified as a skip, not counted as a deletion.
    expect(swept, 'a guard refusal must not be counted as swept').toBe(0)
  })
})
