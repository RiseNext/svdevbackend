import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { toPublicProject, toPublicProjectCard } from '@/serializers/toPublicProject'
import { THIN_PROJECT_SLUG, FAT_PROJECT_SLUG } from '@/seed/data/projects'

/**
 * THE D-015 PHASE-1 VALIDATION GATE, executed against the real database.
 *
 * This prints the measured evidence for the gate report. It does not assert —
 * the Vitest suite does that. This exists so the report contains OBSERVED
 * VALUES rather than claims.
 */

const line = (s: string) => console.log(s)
const hr = () => line('-'.repeat(78))

const run = async () => {
  const payload = await getPayload({ config: configPromise })

  hr()
  line('GATE #2 — description round-trips as string[] (Local API layer)')
  hr()
  const fat = await payload.find({
    collection: 'projects',
    where: { slug: { equals: FAT_PROJECT_SLUG } },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  })
  const doc = fat.docs[0] as unknown as Record<string, unknown> | undefined
  if (!doc) throw new Error(`seed record ${FAT_PROJECT_SLUG} not found`)

  const desc = doc.description
  line(`  Array.isArray(description)      : ${Array.isArray(desc)}`)
  line(`  every element typeof === string : ${(desc as unknown[]).every((d) => typeof d === 'string')}`)
  line(`  length                          : ${(desc as unknown[]).length}`)
  line(`  element[0] (first 70 chars)     : ${JSON.stringify(String((desc as string[])[0]).slice(0, 70))}`)
  line(`  has .value property?            : ${Object.prototype.hasOwnProperty.call((desc as unknown[])[0] ?? {}, 'value')}`)
  line(`  unique (React key safety)       : ${new Set(desc as string[]).size === (desc as string[]).length}`)

  hr()
  line('GATE #3 — omit-don\'t-empty: the THIN record key set')
  hr()
  const thinRes = await payload.find({
    collection: 'projects',
    where: { slug: { equals: THIN_PROJECT_SLUG } },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  })
  const thinDoc = thinRes.docs[0]
  if (!thinDoc) throw new Error(`seed record ${THIN_PROJECT_SLUG} not found`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thinPublic = toPublicProject(thinDoc as any) as unknown as Record<string, unknown>
  const thinKeys = Object.keys(thinPublic).sort()
  line(`  emitted keys: ${JSON.stringify(thinKeys)}`)

  const mustBeAbsent = [
    'status', 'developer', 'stats', 'amenities', 'approvals', 'locationHighlights',
    'proximity', 'area', 'roadDetails', 'gallery', 'layoutImage', 'locationMap',
    'cta', 'seo',
    'id', '_id', '_status', '_order', 'publishedAt', 'deletedAt', 'createdAt', 'updatedAt',
    'projectStatus', 'hasPlaceholders', 'createdBy', 'updatedBy',
  ]
  const leaked = mustBeAbsent.filter((k) => k in thinPublic)
  line(`  keys that MUST be absent, found : ${leaked.length === 0 ? 'NONE ✓' : JSON.stringify(leaked)}`)

  hr()
  line('GATE #3b — the FAT record: internal fields stripped, array-row ids stripped')
  hr()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fatPublic = toPublicProject(doc as any) as unknown as Record<string, unknown>
  line(`  emitted keys: ${JSON.stringify(Object.keys(fatPublic).sort())}`)
  const internalLeak = ['id', '_status', '_order', 'createdAt', 'updatedAt', 'publishedAt', 'deletedAt', 'projectStatus']
    .filter((k) => k in fatPublic)
  line(`  internal fields leaked          : ${internalLeak.length === 0 ? 'NONE ✓' : JSON.stringify(internalLeak)}`)

  const arraysWithIds: string[] = []
  for (const key of ['stats', 'highlights', 'amenities', 'approvals', 'locationHighlights', 'proximity']) {
    const arr = fatPublic[key]
    if (Array.isArray(arr) && arr.some((r) => r && typeof r === 'object' && 'id' in r)) {
      arraysWithIds.push(key)
    }
  }
  line(`  array rows carrying an id       : ${arraysWithIds.length === 0 ? 'NONE ✓' : JSON.stringify(arraysWithIds)}`)

  const img = fatPublic.image as Record<string, unknown>
  line(`  ImageRef key set                : ${JSON.stringify(Object.keys(img).sort())}`)
  line(`  ImageRef width/height are numbers: ${typeof img.width === 'number' && typeof img.height === 'number'}`)
  line(`  ImageRef src                    : ${String(img.src).slice(0, 80)}`)

  hr()
  line('GATE — UUID storage keys, EXIF strip, original filename preserved')
  hr()
  const media = await payload.find({ collection: 'media', limit: 3, depth: 0, overrideAccess: true })
  for (const m of media.docs) {
    const mm = m as unknown as Record<string, unknown>
    line(
      `  filename=${String(mm.filename)} uuid-shaped=${/^[0-9a-f-]{36}\.(png|jpg|webp|avif)$/.test(String(mm.filename))} original=${String(mm.originalFilename)} ${mm.width}x${mm.height}`,
    )
  }

  hr()
  line('GATE — ordering: the measured `_order` fractional index')
  hr()
  const ordered = await payload.find({
    collection: 'projects',
    sort: '_order',
    limit: 10,
    depth: 0,
    overrideAccess: true,
    select: { slug: true },
  })
  line(`  sort:'_order' returned ${ordered.docs.length} docs in order:`)
  ordered.docs.forEach((d, i) => line(`    ${i + 1}. ${(d as { slug?: string }).slug}`))

  hr()
  line('GATE — card serialiser')
  hr()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const card = toPublicProjectCard(thinDoc as any) as Record<string, unknown>
  line(`  thin card keys: ${JSON.stringify(Object.keys(card).sort())}`)

  hr()
  line('GATE — placeholder fidelity in site-settings')
  hr()
  const settings = (await payload.findGlobal({
    slug: 'site-settings',
    depth: 0,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>
  line(`  email    : ${JSON.stringify(settings.email)}`)
  line(`  whatsapp : ${JSON.stringify(settings.whatsapp)}`)
  line(`  url      : ${JSON.stringify(settings.url)}`)
  line(`  address  : ${JSON.stringify(settings.address)}`)

  hr()
  process.exit(0)
}

await run()
