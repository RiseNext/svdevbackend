import configPromise from '@payload-config'
import { getPayload } from 'payload'

/**
 * EMPIRICAL PROBE: how do `select` and `depth` interact for an upload relation?
 *
 * The docs state `select` restricts what is QUERIED and `depth` controls
 * population, but do not state what happens when BOTH are used on an upload
 * field. This measures it instead of guessing.
 */
const run = async () => {
  const payload = await getPayload({ config: configPromise })
  const where = { slug: { equals: 'sri-city-aler-town' } }

  const show = (label: string, img: unknown) => {
    const kind =
      typeof img === 'string'
        ? 'BARE ID STRING'
        : img && typeof img === 'object'
          ? `OBJECT keys=[${Object.keys(img as object).sort().join(',')}]`
          : String(img)
    console.log(`  ${label.padEnd(46)} -> ${kind}`)
  }

  console.log('\nimage field shape under each query shape:')

  const a = await payload.find({ collection: 'projects', where, limit: 1, depth: 1, overrideAccess: true })
  show('depth:1, NO select', a.docs[0]?.image)

  const b = await payload.find({
    collection: 'projects', where, limit: 1, depth: 1, overrideAccess: true,
    select: { slug: true, name: true, image: true },
  })
  show('depth:1 + select{image:true}', b.docs[0]?.image)

  const c = await payload.find({
    collection: 'projects', where, limit: 1, depth: 2, overrideAccess: true,
    select: { slug: true, name: true, image: true },
  })
  show('depth:2 + select{image:true}', c.docs[0]?.image)

  const d = await payload.find({
    collection: 'projects', where, limit: 1, depth: 1, overrideAccess: true,
    select: { slug: true, name: true, image: true },
    populate: { media: { filename: true, url: true, alt: true, isDecorative: true, width: true, height: true } },
  })
  show('depth:1 + select + explicit populate', d.docs[0]?.image)

  const e = await payload.find({
    collection: 'projects', where, limit: 1, depth: 0, overrideAccess: true,
  })
  show('depth:0, NO select', e.docs[0]?.image)

  console.log('\nAS AN ANONYMOUS PUBLIC CALLER (overrideAccess:false, user:undefined):')
  const f = await payload.find({
    collection: 'projects', where, limit: 1, depth: 1,
    overrideAccess: false, user: undefined,
    select: { slug: true, name: true, image: true },
  })
  show('anon + depth:1 + select', f.docs[0]?.image)

  try {
    const g = await payload.find({ collection: 'media', limit: 1, depth: 0, overrideAccess: false, user: undefined })
    console.log(`  anon direct media read                          -> ${g.totalDocs} docs`)
  } catch (err) {
    console.log(`  anon direct media read                          -> THREW: ${(err as Error).message.slice(0,60)}`)
  }

  console.log('')
  process.exit(0)
}

await run()
