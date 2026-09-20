import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

/**
 * SVG -> PNG, ONCE, OFFLINE. The output is COMMITTED to `src/seed/assets/`.
 *
 * 🔴 THIS IS THE RESOLUTION OF THE SVG SEEDING PARADOX, and it is NOT an
 * exception to the SVG ban.
 *
 * The conflict: `MEDIA-MANAGEMENT.md` §11 instructs the cutover to UPLOAD the
 * five project SVGs "so nothing renders blank", while four other documents state
 * SVG is ALWAYS REJECTED — "an admin-uploaded SVG is a stored-XSS vector that
 * the placeholder-only rationale does not cover". And Local API uploads still
 * fire ALL hooks, so a seed script gets no free pass.
 *
 * The resolution, in three parts:
 *   1. The DATA seed uploads nothing at all — projects are created as drafts,
 *      and `versions.drafts.validate: false` means the required `image` is not
 *      enforced on a draft. That is exactly what that setting was chosen for.
 *   2. The ASSET seed uploads these rasterised PNGs through the NORMAL pipeline,
 *      hooks and all. Nothing bypasses validation.
 *   3. NO "allow SVG for the seeded five" EXCEPTION IS CREATED. That would be a
 *      permanent hole for a temporary problem, sitting on the one collection an
 *      authenticated editor can write to.
 *
 * WHY THE OUTPUT IS COMMITTED rather than generated at seed time: seeding must
 * be DETERMINISTIC and must not depend on a rasteriser being installed on
 * whatever machine runs it.
 *
 * ⚠️ These are GENERATED TITLE CARDS, NOT PHOTOGRAPHS. Replacing them is a
 * CONTENT deliverable, not an engineering one, and it is what gates removing
 * `dangerouslyAllowSVG` from the frontend.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_DIR = path.resolve(dirname, '../../../svfrontend/public/images')
const OUT_DIR = path.resolve(dirname, 'assets')

/** The placeholder cover art declares 1200x800 in the frontend content. */
const TARGET_WIDTH = 1600

const run = async (): Promise<void> => {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`[rasterise] source directory not found: ${SOURCE_DIR}`)
    process.exit(1)
  }

  mkdirSync(OUT_DIR, { recursive: true })

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.name.toLowerCase().endsWith('.svg') ? [full] : []
    })

  const svgs = walk(SOURCE_DIR)
  if (svgs.length === 0) {
    console.error('[rasterise] no SVG files found — nothing to do')
    process.exit(1)
  }

  let written = 0
  for (const source of svgs) {
    const name = path.basename(source, '.svg')
    const target = path.join(OUT_DIR, `${name}.png`)
    try {
      const svg = readFileSync(source)
      const png = await sharp(svg, { density: 200 })
        .resize({ width: TARGET_WIDTH, withoutEnlargement: false })
        .png({ compressionLevel: 9 })
        .toBuffer()
      writeFileSync(target, png)
      const meta = await sharp(png).metadata()
      console.log(`[rasterise] ${name}.svg -> ${name}.png (${meta.width}x${meta.height})`)
      written += 1
    } catch (err) {
      // 🔴 FAIL LOUDLY ON A MISSING OR UNREADABLE SOURCE. The asset migration
      // must NEVER create a media row whose `src` 404s — a silent dead row is
      // exactly how `media.hero` and `media.heroPortrait` survived in the
      // frontend content pointing at files that do not exist on disk.
      console.error(`[rasterise] FAILED on ${source}:`, (err as Error).message)
      process.exit(1)
    }
  }

  console.log(`[rasterise] wrote ${written} PNG file(s) to ${OUT_DIR}`)
  console.log('[rasterise] COMMIT THESE FILES — the seed must not depend on a rasteriser.')
  process.exit(0)
}

await run()
