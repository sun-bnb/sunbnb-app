/**
 * Bulk-import OSM coastlines + water polygons for named regions (track 027), so shore lookups
 * there never depend on the public Overpass API.
 *
 * Data: osmdata.openstreetmap.de (© OpenStreetMap contributors, ODbL), refreshed daily —
 *   coastlines-split-4326.zip   → lines.shp           (water on the LEFT — reversed on import, see below)
 *   water-polygons-split-4326.zip → water_polygons.shp (the sea, in ≤ 1° pieces)
 * Download + unzip both into one folder (≈ 1.8 GB zipped, 2.6 GB unzipped), then:
 *
 *   cd apps/marketing && source .env.local
 *   npm run import:coastline -- --data /path/to/osm spain   # --data: the folder holding both unzipped datasets; regions: lib/coast-regions.ts (world too)
 *
 * POSTGRES_URL decides the database. Re-runnable: each region's previous import is replaced
 * (newer dataset → clean swap); Overpass-fetched ways are left alone. Streams the files in
 * constant memory; a region only decodes the records whose bounding box touches it.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { clearImportedRegion, insertImportedLines, insertImportedWater, markImportedTiles } from '@repo/data/coastline-db'
import { coastTilesInBox } from '@repo/data/coastline-tiles'
import { regionBoxes } from '../lib/coast-regions'
import { readShapes, toWkt, type Box, type ShapeRecord } from '../lib/shapefile'

/** Marking every 0.1° tile covered is only sensible for country-sized boxes; beyond this the
 *  route recognises imported coverage from the imported rows themselves (negative line ids). */
const MAX_TILES_TO_MARK = 50_000
/** Keep each INSERT statement to a few MB of WKT. */
const BATCH_CHARS = 2_000_000

const { values, positionals } = parseArgs({ allowPositionals: true, options: { data: { type: 'string' } } })
if (!values.data) throw new Error('--data <folder with lines.shp and water_polygons.shp> is required')
const data = values.data
/** The file as unzipped (its own folder) or flattened into --data. */
function dataFile(folder: string, name: string): string {
  const p = [join(data, folder, name), join(data, name)].find((f) => existsSync(f))
  if (!p) throw new Error(`${name} not found in ${data} or ${join(data, folder)}`)
  return p
}
const LINES = dataFile('coastlines-split-4326', 'lines.shp')
const WATER = dataFile('water-polygons-split-4326', 'water_polygons.shp')
const boxes = regionBoxes(positionals)
if (!boxes.length) throw new Error('name at least one region (see lib/coast-regions.ts)')

/**
 * osmdata's split coastline lines run with the water on the LEFT — the reverse of OSM coastline
 * ways (water on the right), which everything downstream assumes. Measured against the water
 * polygons on Muro, Benidorm, Las Canteras and La Concha (2026-10-05): every segment reversed.
 * So lines are stored reversed; water polygons are direction-free.
 */
const toOsmDirection = (rec: ShapeRecord): ShapeRecord => ({ ...rec, parts: rec.parts.map((p) => [...p].reverse()) })

async function importLayer(file: string, box: Box, insert: (rows: { id: number; wkt: string }[]) => Promise<void>, reverse = false): Promise<number> {
  let batch: { id: number; wkt: string }[] = []
  let chars = 0
  let count = 0
  for (const rec of readShapes(file, box)) {
    const wkt = toWkt(reverse ? toOsmDirection(rec) : rec)
    if (wkt.endsWith('()') || wkt.endsWith('(()')) continue
    batch.push({ id: rec.n, wkt })
    chars += wkt.length
    count++
    if (chars >= BATCH_CHARS || batch.length >= 1000) {
      await insert(batch)
      batch = []
      chars = 0
      process.stdout.write(`\r  ${count}`)
    }
  }
  await insert(batch)
  return count
}

const started = Date.now()
for (const [name, box] of boxes) {
  console.log(`${name} ${JSON.stringify(box)}`)
  await clearImportedRegion(box)
  const lines = await importLayer(LINES, box, insertImportedLines, true)
  console.log(`\r  coastline segments: ${lines}`)
  const water = await importLayer(WATER, box, insertImportedWater)
  console.log(`\r  water polygons: ${water}`)
  const tiles = coastTilesInBox(box)
  if (tiles.length <= MAX_TILES_TO_MARK) {
    await markImportedTiles(tiles)
    console.log(`  tiles marked covered: ${tiles.length}`)
  } else console.log(`  ${tiles.length} tiles — coverage recognised from the imported rows instead`)
}
console.log(`done in ${Math.round((Date.now() - started) / 1000)} s`)
process.exit(0)
