import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'

const run = async () => {
  const payload = await getPayload({ config: configPromise })
  const media = await payload.find({ collection: 'media', limit: 1, overrideAccess: true, depth: 0 })
  const slug = 'trash-sql-probe'
  await payload.db.drizzle.execute(sql.raw(`DELETE FROM projects WHERE slug='${slug}'`))

  const doc = await payload.create({
    collection: 'projects', overrideAccess: true, draft: true,
    context: { skipAudit: true, skipRevalidate: true },
    data: {
      slug, name: 'SQL trash probe', category: 'Residential Plots', locality: 'T',
      summary: 'x', description: ['p'], highlights: [{ icon: 'tree', title: 'h' }],
      ...(media.docs[0] ? { image: media.docs[0].id } : {}),
    } as never,
  })
  const raw = async (label: string) => {
    const r = await payload.db.drizzle.execute(sql.raw(`SELECT id, deleted_at FROM projects WHERE slug='${slug}'`))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (r as any).rows ?? r
    console.log(`  ${label.padEnd(34)} SQL rows=${rows.length}` + (rows.length ? ` deleted_at=${rows[0].deleted_at}` : ''))
  }
  await raw('after create')
  await payload.delete({ collection: 'projects', id: doc.id, overrideAccess: true, context: { skipAudit: true, skipRevalidate: true } })
  await raw('after payload.delete() (no arg)')

  // The documented restore path is an UPDATE setting deletedAt.
  const doc2 = await payload.create({
    collection: 'projects', overrideAccess: true, draft: true,
    context: { skipAudit: true, skipRevalidate: true },
    data: {
      slug: slug + '-2', name: 'SQL trash probe 2', category: 'Residential Plots', locality: 'T',
      summary: 'x', description: ['p'], highlights: [{ icon: 'tree', title: 'h' }],
      ...(media.docs[0] ? { image: media.docs[0].id } : {}),
    } as never,
  })
  await payload.update({
    collection: 'projects', id: doc2.id, overrideAccess: true,
    data: { deletedAt: new Date().toISOString() } as never,
    context: { skipAudit: true, skipRevalidate: true },
  })
  const r2 = await payload.db.drizzle.execute(sql.raw(`SELECT deleted_at FROM projects WHERE slug='${slug}-2'`))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows2 = (r2 as any).rows ?? r2
  console.log(`  update{deletedAt} -> SQL rows=${rows2.length} deleted_at=${rows2[0]?.deleted_at}`)
  const via = await payload.find({ collection: 'projects', where: { slug: { equals: slug + '-2' } }, overrideAccess: true, trash: true, limit: 1, depth: 0 })
  const without = await payload.find({ collection: 'projects', where: { slug: { equals: slug + '-2' } }, overrideAccess: true, limit: 1, depth: 0 })
  console.log(`  find(trash:true)=${via.totalDocs}  find(default)=${without.totalDocs}`)
  await payload.db.drizzle.execute(sql.raw(`DELETE FROM projects WHERE slug LIKE '${slug}%'`))
  process.exit(0)
}
await run()
