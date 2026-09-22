import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * THE REVALIDATION DIAGNOSTIC — THE ONE THAT NAMES A SILENT OUTAGE.
 *
 * 🔴 WHY THIS FILE EXISTS. On 21 Sep 2026 a Site Settings save in production
 * succeeded ("Updated successfully", a version row was written, and
 * `/api/v1/site-settings` served the new phone number) while the public site
 * kept serving blanks. The evidence in `payload_jobs` was a single row:
 *
 *   task_slug: revalidatePaths   queue: default
 *   created_at: 23:58:09.932Z    (103 ms after the save at 23:58:09.829Z)
 *   total_tried: 0               has_error: false   completed_at: null
 *
 * That row proves three things at once: the afterChange hook fired, the DIRECT
 * webhook call failed (the only path that queues this job), and the retry was
 * never attempted — so the handler below, which is the only thing that can
 * distinguish "wrong shared secret" from "frontend is down", never ran.
 *
 * `tests/integration/jobs.test.ts` covers scheduling, queue routing and the
 * deployed worker commands. It does NOT execute this handler, so the 401 branch
 * — the single most useful line of diagnostics in the deployment — was
 * completely untested while the failure it describes was happening live.
 *
 * The distinction is load-bearing and not cosmetic: a 401 is a PERMANENT
 * misconfiguration that must cancel rather than burn five retries and vanish,
 * and its message has to name `REVALIDATE_SECRET`, because the mismatch is
 * otherwise invisible from either side.
 */

const WEBHOOK = 'https://frontend.example/api/revalidate'
const SECRET = 'a-shared-secret-of-sufficient-length-0001'

const loadTask = async (over: Record<string, string> = {}) => {
  vi.resetModules()
  vi.stubEnv('REVALIDATE_WEBHOOK_URL', WEBHOOK)
  vi.stubEnv('REVALIDATE_SECRET', SECRET)
  for (const [k, v] of Object.entries(over)) vi.stubEnv(k, v)
  const { revalidatePaths } = await import('@/jobs')
  return revalidatePaths
}

const run = async (
  task: Awaited<ReturnType<typeof loadTask>>,
  input: { paths: string[]; tags?: string[] } = { paths: ['/'], tags: ['site-settings'] },
) => {
  const req = { payload: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (task.handler as any)({ input, req, job: {}, tasks: {}, inlineTask: undefined })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('revalidatePaths — the webhook contract', () => {
  it('POSTs the secret, paths and tags to the configured webhook', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const task = await loadTask()
    const out = await run(task, { paths: ['/', '/contact'], tags: ['site-settings'] })

    expect(out).toEqual({ output: { revalidated: true } })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(WEBHOOK)
    expect(init?.method).toBe('POST')
    // The frontend route reads exactly these three keys; drift here is the
    // difference between "published" and "silently never updates".
    expect(JSON.parse(String(init?.body))).toEqual({
      secret: SECRET,
      paths: ['/', '/contact'],
      tags: ['site-settings'],
    })
  })

  it('defaults tags to an empty array rather than sending undefined', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const task = await loadTask()
    await run(task, { paths: ['/'] })
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).tags).toEqual([])
  })
})

describe('revalidatePaths — a shared-secret mismatch must CANCEL, never retry', () => {
  it.each([401, 403])('cancels on %i and names REVALIDATE_SECRET', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }))
    const task = await loadTask()

    // The message is the deliverable: it is the only place the operator is told
    // which of the two environments to correct.
    await expect(run(task)).rejects.toThrow(/REVALIDATE_SECRET does not match/i)
    await expect(run(task)).rejects.toThrow(new RegExp(String(status)))
  })

  it('cancels rather than throwing a retryable error on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }))
    const task = await loadTask()
    const err = await run(task).catch((e: unknown) => e)
    // JobCancelledError is what stops Payload burning all five retries on a
    // condition that retrying cannot possibly fix.
    expect((err as Error).constructor.name).toBe('JobCancelledError')
  })
})

describe('revalidatePaths — transient failures stay retryable', () => {
  it.each([500, 502, 503])('throws a RETRYABLE error on %i', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }))
    const task = await loadTask()
    const err = await run(task).catch((e: unknown) => e)

    expect((err as Error).message).toMatch(new RegExp(String(status)))
    // Explicitly NOT cancelled — a frontend redeploy is worth retrying.
    expect((err as Error).constructor.name).not.toBe('JobCancelledError')
  })
})

describe('revalidatePaths — an unconfigured webhook cancels immediately', () => {
  it.each([
    ['REVALIDATE_WEBHOOK_URL', { REVALIDATE_WEBHOOK_URL: '' }],
    ['REVALIDATE_SECRET', { REVALIDATE_SECRET: '' }],
  ])('cancels when %s is empty, without calling fetch', async (_label, over) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const task = await loadTask(over as Record<string, string>)

    await expect(run(task)).rejects.toThrow(/not configured — retrying cannot help/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('revalidatePaths — task wiring', () => {
  it('retries 5 times and runs on the default queue via the hook, not a schedule', async () => {
    const task = await loadTask()
    expect(task.slug).toBe('revalidatePaths')
    expect(task.retries).toBe(5)
    // Event-driven: a schedule here would revalidate the site on a timer and
    // mask exactly the failure this file exists to surface.
    expect('schedule' in task ? task.schedule : undefined).toBeUndefined()
  })
})
