import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { toErrorEnvelope } from '@/lib/errors'

const run = async () => {
  const payload = await getPayload({ config: configPromise })
  try {
    await payload.create({
      collection: 'testimonials',
      overrideAccess: true,
      data: { name: 'X', body: 'Y', consented: false, _status: 'published' },
      context: { skipAudit: true, skipRevalidate: true },
    })
  } catch (err) {
    const e = err as { message?: string; status?: number; data?: { errors?: unknown[] } }
    console.log('top-level message :', e.message)
    console.log('status            :', e.status)
    console.log('data.errors       :', JSON.stringify(e.data?.errors, null, 2))
    const env = toErrorEnvelope(err, 'req_probe')
    console.log('OUR ENVELOPE      :', JSON.stringify(env.body, null, 2))
    console.log('OUR STATUS        :', env.status)
  }
  process.exit(0)
}
await run()
