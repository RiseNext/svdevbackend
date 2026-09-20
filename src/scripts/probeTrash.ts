import configPromise from '@payload-config'
import { getPayload } from 'payload'

const run = async () => {
  const payload = await getPayload({ config: configPromise })
  const mk = async (slug: string) => {
    const media = await payload.find({ collection: 'media', limit: 1, overrideAccess: true, depth: 0 })
    return payload.create({
      collection: 'projects', overrideAccess: true, draft: true,
      context: { skipAudit: true, skipRevalidate: true },
      data: {
        slug, name: 'Trash probe ' + slug, category: 'Residential Plots', locality: 'T',
        summary: 'x', description: ['p'], highlights: [{ icon: 'tree', title: 'h' }],
        ...(media.docs[0] ? { image: media.docs[0].id } : {}),
      } as never,
    })
  }
  const count = async (slug: string, trash: boolean) =>
    (await payload.find({ collection: 'projects', where: { slug: { equals: slug } }, overrideAccess: true, trash, limit: 1, depth: 0 })).totalDocs

  const a = await mk('trash-probe-default')
  await payload.delete({ collection: 'projects', id: a.id, overrideAccess: true, context: { skipAudit: true, skipRevalidate: true } })
  console.log('delete() with NO trash arg  -> rows(trash:true) =', await count('trash-probe-default', true), ' rows(default) =', await count('trash-probe-default', false))

  const b = await mk('trash-probe-explicit')
  await payload.delete({ collection: 'projects', id: b.id, overrideAccess: true, trash: true, context: { skipAudit: true, skipRevalidate: true } })
  console.log('delete({ trash: true })     -> rows(trash:true) =', await count('trash-probe-explicit', true), ' rows(default) =', await count('trash-probe-explicit', false))

  process.exit(0)
}
await run()
