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

/**
 * The one task that is queued by a hook in response to an event, never
 * scheduled.
 *
 * ⚠️ IT USED TO BE TWO. `sendLeadNotification` was removed with the email
 * subsystem: this product sends no email, so an enquiry has nothing to be
 * forwarded to. See the "enquiries never touch the queue" block at the bottom
 * of this file, which is the assertion that replaced the old
 * "lead notifications reach the default queue" suite — it pins the STRONGER
 * property that submitting an enquiry queues nothing at all.
 */
const EVENT_DRIVEN = ['revalidatePaths'] as const

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

describe('revalidation is NOT scheduled', () => {
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
// 5. AN ENQUIRY NEVER TOUCHES THE QUEUE
//
// 🔴 THIS SUITE REPLACED ITS OWN OPPOSITE, AND THE INVERSION IS THE POINT.
//
// It used to assert "creating a lead queues sendLeadNotification on the default
// queue", because delivery of an enquiry meant emailing it and the queue was the
// transport. That design had a failure mode the test could not see: a dead
// worker or a down mail provider meant the enquiry saved, the visitor was told
// "we will call you back", and the business was told nothing — silently.
//
// Delivery is now the database row itself. So the property worth pinning is the
// STRONGER one: submitting an enquiry queues NOTHING, which means no background
// process can be between the visitor and the administrator seeing it, which
// means no background process can lose it.
// ---------------------------------------------------------------------------

describe('an enquiry is stored synchronously and queues no background work', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getTestPayload()
  })

  it('creating a lead queues NO jobs on any queue', async () => {
    const before = await payload.count({ collection: 'payload-jobs', overrideAccess: true })

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

    const after = await payload.count({ collection: 'payload-jobs', overrideAccess: true })

    expect(
      after.totalDocs,
      'creating an enquiry queued a job — enquiry delivery must not depend on a worker being alive',
    ).toBe(before.totalDocs)

    // And the enquiry really is there, readable by an administrator, with no
    // intermediate step having run.
    const stored = await payload.findByID({
      collection: 'leads',
      id: lead.id,
      overrideAccess: true,
      depth: 0,
    })
    expect(stored.name).toBe('Jobs Test Enquirer')
    expect(stored.phone).toBe('9876500011')
  })

  it('no task named sendLeadNotification is registered any more', () => {
    // If this ever fails, the email subsystem has been partially reintroduced —
    // which would silently re-open the "lead saved, nobody told" failure mode.
    const slugs = (resolved.jobs?.tasks ?? []).map((t) => t.slug)
    expect(slugs).not.toContain('sendLeadNotification')
    expect(slugs.sort()).toEqual(
      ['purgeLeadPii', 'revalidatePaths', 'sweepDeletedMedia', 'watchdogFailedJobs'],
    )
  })

  it('the deployed worker commands name queues that tasks actually use', () => {
    // The `--queue` argument in docker-compose.prod.yml and in the Railway start
    // command is a bare string no constant can reach. A typo there is SILENT:
    // the worker polls a queue nothing is queued to, forever, looking healthy.
    const compose = readFileSync(path.resolve(process.cwd(), 'docker-compose.prod.yml'), 'utf8')
    expect(compose).toContain(`'--queue', '${DEFAULT_QUEUE}'`)
    expect(compose).toContain(`'--queue', '${MAINTENANCE_QUEUE}'`)
    /**
     * 🔴 EXACTLY ONE SERVICE MAY RUN `--handle-schedules`. Payload's docs are
     * explicit that multiple servers handling schedules each queue their own
     * copy, so a second one means every maintenance task runs twice a night.
     *
     * Counted in COMMAND POSITION — `'--handle-schedules'` with the quotes a
     * YAML exec-form argument carries — rather than anywhere in the file. The
     * comments above the services mention the flag by name twice, and a naive
     * substring count would report three and fail on documentation.
     */
    expect(compose.match(/'--handle-schedules'/g)?.length).toBe(1)
  })
})
