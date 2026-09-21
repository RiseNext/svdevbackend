import { readFileSync } from 'node:fs'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import { Cron } from 'croner'
import type { Payload, TaskConfig } from 'payload'

import config from '@payload-config'
import type { SanitizedConfig } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { DEFAULT_QUEUE, MAINTENANCE_QUEUE } from '@/lib/constants'

/**
 * THE JOBS TEST.
 *
 * 🔴 WHY THIS FILE EXISTS. Before it, three tasks — `purgeLeadPii`,
 * `sweepDeletedMedia` and `watchdogFailedJobs` — were defined, registered,
 * type-checked and completely unreachable: nothing queued them and none of them
 * declared a `schedule`, so `worker-maintenance` polled an empty queue forever
 * while looking perfectly healthy. Every existing test passed throughout.
 *
 * That is the failure mode this file is built around. It does not test that the
 * handlers work — `domain.test.ts` covers behaviour — it tests that the wiring
 * which makes them RUN AT ALL is present and cannot silently regress.
 */

const resolved = (await config) as SanitizedConfig

const taskBySlug = (slug: string): TaskConfig<any> => {
  const task = resolved.jobs?.tasks?.find((t) => t.slug === slug)
  expect(task, `task "${slug}" is not registered in payload.config`).toBeDefined()
  return task as TaskConfig<any>
}

/** The three that run on a timer, and the cadence each was chosen to have. */
const SCHEDULED = [
  { slug: 'purgeLeadPii', cron: '45 21 * * *' },
  { slug: 'sweepDeletedMedia', cron: '15 22 * * *' },
  { slug: 'watchdogFailedJobs', cron: '*/15 * * * *' },
] as const

/** The two that are queued by a hook in response to an event, never scheduled. */
const EVENT_DRIVEN = ['sendLeadNotification', 'revalidatePaths'] as const

// ---------------------------------------------------------------------------
// 1. Every maintenance task HAS a schedule, on the maintenance queue
// ---------------------------------------------------------------------------

describe('maintenance tasks are scheduled', () => {
  it.each(SCHEDULED.map((s) => s.slug))('"%s" declares a schedule', (slug) => {
    const task = taskBySlug(slug)
    expect(
      task.schedule,
      `${slug} has no schedule — it would never run, and nothing else would report that`,
    ).toBeDefined()
    expect(task.schedule!.length).toBeGreaterThan(0)
  })

  it.each(SCHEDULED)('"$slug" is scheduled onto the maintenance queue', ({ slug }) => {
    for (const entry of taskBySlug(slug).schedule!) {
      expect(
        entry.queue,
        `${slug} must be scheduled onto "${MAINTENANCE_QUEUE}" — worker-default does not poll it`,
      ).toBe(MAINTENANCE_QUEUE)
    }
  })

  it.each(SCHEDULED)('"$slug" uses the documented cron "$cron"', ({ slug, cron }) => {
    expect(taskBySlug(slug).schedule![0]!.cron).toBe(cron)
  })
})

// ---------------------------------------------------------------------------
// 2. The cron strings mean what the comments claim
//
// 🔴 Croner accepts a SIX-field pattern where the first field is SECONDS.
// A five-field string is standard cron, but getting that wrong is silent: a
// daily purge would quietly become an every-minute purge. These assertions pin
// the actual interpretation rather than trusting the field count.
// ---------------------------------------------------------------------------

describe('schedule cron expressions parse to the intended cadence', () => {
  // Payload constructs Cron with this exact option; mirror it or the test is
  // validating a different parser configuration than production uses.
  const parse = (cron: string) => new Cron(cron, { sloppyRanges: true })

  it.each(SCHEDULED)('"$slug" cron is parseable', ({ cron }) => {
    expect(() => parse(cron)).not.toThrow()
    expect(parse(cron).nextRun()).toBeInstanceOf(Date)
  })

  /**
   * 🔴 TIMEZONE. Payload builds the Cron with NO timezone option, so croner
   * uses the PROCESS'S LOCAL TIME — not UTC. The production container pins
   * `TZ=UTC` in the Dockerfile precisely so "21:45" means 21:45 UTC.
   *
   * These assertions therefore use LOCAL getters, which is what the cron
   * actually addresses, and stay correct on a developer machine in any zone.
   * The separate test below pins the UTC assumption itself.
   */
  it('purgeLeadPii runs once a day at 21:45 container-local (= 21:45 UTC in production)', () => {
    const c = parse('45 21 * * *')
    const first = c.nextRun(new Date('2026-01-01T00:00:00Z'))!
    const second = c.nextRun(first)!
    expect(first.getHours()).toBe(21)
    expect(first.getMinutes()).toBe(45)
    // Exactly 24h apart => daily, not hourly and not every minute.
    expect(second.getTime() - first.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('sweepDeletedMedia runs once a day at 22:15 container-local, 30 min after the purge', () => {
    const c = parse('15 22 * * *')
    const first = c.nextRun(new Date('2026-01-01T00:00:00Z'))!
    const second = c.nextRun(first)!
    expect(first.getHours()).toBe(22)
    expect(first.getMinutes()).toBe(15)
    expect(second.getTime() - first.getTime()).toBe(24 * 60 * 60 * 1000)

    // The stagger is deliberate: both run on the SAME single worker.
    const purge = parse('45 21 * * *').nextRun(new Date('2026-01-01T00:00:00Z'))!
    expect(first.getTime() - purge.getTime()).toBe(30 * 60 * 1000)
  })

  it('the production image pins TZ=UTC, which is what makes those times UTC', () => {
    // If this ever fails, the nightly jobs have moved and nothing else reports
    // it. The pin lives in the Dockerfile runner stage.
    const dockerfile = readFileSync(path.resolve(process.cwd(), 'Dockerfile'), 'utf8')
    expect(
      /^ENV TZ=UTC$/m.test(dockerfile),
      'Dockerfile must pin ENV TZ=UTC — croner resolves schedule crons in process-local time',
    ).toBe(true)
  })

  it('watchdogFailedJobs runs every 15 minutes, matching its own re-queue delay', () => {
    const c = parse('*/15 * * * *')
    const first = c.nextRun(new Date('2026-01-01T00:00:00Z'))!
    const second = c.nextRun(first)!
    expect(second.getTime() - first.getTime()).toBe(15 * 60 * 1000)
    // The handler re-queues with waitUntil = now + 15 min. A longer cadence
    // would leave re-queued jobs sitting past their wait.
    expect([0, 15, 30, 45]).toContain(first.getUTCMinutes())
  })
})

// ---------------------------------------------------------------------------
// 3. Event-driven tasks stayed event-driven
// ---------------------------------------------------------------------------

describe('lead notification and revalidation are NOT scheduled', () => {
  it.each(EVENT_DRIVEN)('"%s" has no schedule', (slug) => {
    expect(
      taskBySlug(slug).schedule,
      `${slug} is queued by a hook in response to an event. A schedule would run it on a timer with empty input.`,
    ).toBeUndefined()
  })

  it('no task is scheduled onto the default queue', () => {
    // 🔴 THE DUPLICATE-EXECUTION GUARD. worker-default and worker-maintenance
    // both run continuously. A schedule on the default queue would be queued by
    // whichever worker handles schedules AND drained by worker-default, and the
    // two services would fight over it.
    for (const task of resolved.jobs?.tasks ?? []) {
      for (const entry of task.schedule ?? []) {
        expect(
          entry.queue,
          `${task.slug} is scheduled onto "${entry.queue}" — only "${MAINTENANCE_QUEUE}" is handled by a schedule-running worker`,
        ).not.toBe(DEFAULT_QUEUE)
      }
    }
  })

  it('exactly one queue carries schedules', () => {
    const queues = new Set(
      (resolved.jobs?.tasks ?? []).flatMap((t) => (t.schedule ?? []).map((s) => s.queue)),
    )
    // More than one scheduled queue means more than one worker must run
    // --handle-schedules, and the docs are explicit that multiple servers
    // handling schedules each queue their own copy.
    expect([...queues]).toEqual([MAINTENANCE_QUEUE])
  })
})

// ---------------------------------------------------------------------------
// 4. The maintenance worker can actually queue and drain them
//
// `payload.jobs.handleSchedules({ queue })` IS the code path that
// `payload jobs:run --handle-schedules` invokes.
// ---------------------------------------------------------------------------

describe('the maintenance worker processes the scheduled tasks', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getTestPayload()
    await resetTestDatabase(payload)
  })

  it('handleSchedules queues all three maintenance tasks', async () => {
    const result = await payload.jobs.handleSchedules({ queue: MAINTENANCE_QUEUE })

    expect(result.errored, 'no schedule should error').toEqual([])

    const queuedSlugs = result.queued.map((q) => q.taskConfig?.slug).filter(Boolean).sort()
    expect(queuedSlugs).toEqual(
      [...SCHEDULED.map((s) => s.slug)].sort(),
    )
  })

  it('the queued jobs really landed in the maintenance queue', async () => {
    const jobs = await payload.find({
      collection: 'payload-jobs',
      overrideAccess: true,
      depth: 0,
      limit: 100,
      where: { queue: { equals: MAINTENANCE_QUEUE } },
    })

    const slugs = jobs.docs.map((d) => (d as { taskSlug?: string }).taskSlug).sort()
    expect(slugs).toEqual([...SCHEDULED.map((s) => s.slug)].sort())
  })

  it('running handleSchedules again does NOT duplicate them', async () => {
    // Payload's defaultBeforeSchedule refuses to schedule a task that is already
    // running or already scheduled in the future. Proving it here is what makes
    // a restart loop on the worker safe: without this, every worker restart
    // would queue another copy of all three.
    const before = await payload.count({
      collection: 'payload-jobs',
      overrideAccess: true,
      where: { queue: { equals: MAINTENANCE_QUEUE } },
    })

    const second = await payload.jobs.handleSchedules({ queue: MAINTENANCE_QUEUE })

    const after = await payload.count({
      collection: 'payload-jobs',
      overrideAccess: true,
      where: { queue: { equals: MAINTENANCE_QUEUE } },
    })

    expect(second.queued, 'a second pass must queue nothing').toEqual([])
    expect(after.totalDocs).toBe(before.totalDocs)
  })

  it('handling the DEFAULT queue queues no maintenance work', async () => {
    // worker-default does not pass --handle-schedules, but even if it did, it
    // must not pick these up: the queue names do not match.
    const result = await payload.jobs.handleSchedules({ queue: DEFAULT_QUEUE })
    expect(result.queued).toEqual([])
    expect(result.errored).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. The default queue still carries lead notifications
// ---------------------------------------------------------------------------

describe('lead notifications still reach the default queue', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getTestPayload()
  })

  it('creating a lead queues sendLeadNotification on the default queue', async () => {
    const lead = await payload.create({
      collection: 'leads',
      overrideAccess: true,
      data: {
        name: 'Jobs Test Enquirer',
        phone: '9876500011',
        source: 'contact_form',
        consentGiven: true,
      },
    })

    const jobs = await payload.find({
      collection: 'payload-jobs',
      overrideAccess: true,
      depth: 0,
      limit: 50,
      where: {
        and: [{ queue: { equals: DEFAULT_QUEUE } }, { taskSlug: { equals: 'sendLeadNotification' } }],
      },
    })

    expect(
      jobs.totalDocs,
      'the lead saved but nothing was queued — the sales team would never be told',
    ).toBeGreaterThan(0)

    const inputs = jobs.docs.map((d) => (d as { input?: { leadId?: string } }).input?.leadId)
    expect(inputs).toContain(String(lead.id))
  })

  it('the lead notification job was NOT queued to the maintenance queue', async () => {
    const stray = await payload.count({
      collection: 'payload-jobs',
      overrideAccess: true,
      where: {
        and: [
          { queue: { equals: MAINTENANCE_QUEUE } },
          { taskSlug: { equals: 'sendLeadNotification' } },
        ],
      },
    })
    expect(stray.totalDocs).toBe(0)
  })
})
