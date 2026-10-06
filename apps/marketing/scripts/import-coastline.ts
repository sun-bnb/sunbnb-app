/**
 * Bulk-import OSM coastlines + water polygons for named regions (track 027), so shore lookups
 * there never depend on the public Overpass API.
 *
 * Data: osmdata.openstreetmap.de (© OpenStreetMap contributors, ODbL), refreshed daily —
 *   coastlines-split-4326.zip   → lines.shp           (water on the LEFT — reversed on import, see below)
 *   water-polygons-split-4326.zip → water_polygons.shp (the sea, in ≤ 1° pieces)
 * Download + unzip both into one folder (≈ 1.8 GB zipped, 2.6 GB unzipped).
 *
 * Inland water (P15) — lakes, reservoirs, river areas — for regions listed in INLAND_EXTRACTS:
 * Geofabrik's free shapefile extract (© OpenStreetMap contributors, ODbL), water layer only:
 *   curl -LO https://download.geofabrik.de/europe/austria-latest-free.shp.zip
 *   unzip -j austria-latest-free.shp.zip 'gis_osm_water_a_free_1.*' -d /path/to/geofabrik/austria
 *
 * Then both layers in one run:
 *   cd apps/marketing && source .env.local
 *   npm run import:coastline -- --data /path/to/osm --inland /path/to/geofabrik austria
 *   # --data: the folder holding both osmdata datasets; --inland: one folder per region;
 *   # regions: lib/coast-regions.ts (world too, sea only)
 *
 * POSTGRES_URL decides the database. Re-runnable: each region's previous import is replaced
 * (newer dataset → clean swap); Overpass-fetched ways are left alone. Streams the files in
 * constant memory; a region only decodes the records whose bounding box touches it.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { clearImportedRegion, clearInlandRegion, insertImportedLines, insertImportedWater, insertInlandShores, insertInlandWater, markImportedTiles } from '@repo/data/coastline-db'
import { coastTilesInBox } from '@repo/data/coastline-tiles'
import { INLAND_EXTRACTS, regionBoxes } from '../lib/coast-regions'
import { isBathingWater, shoreLines } from '../lib/inland-water'
import { openDbf, readShapes, toWkt, type Box, type ShapeRecord } from '../lib/shapefile'

/** Marking every 0.1° tile covered is only sensible for country-sized boxes; beyond this the
 *  route recognises imported coverage from the imported rows themselves (negative line ids). */
const MAX_TILES_TO_MARK = 50_000
/** Keep each INSERT statement to a few MB of WKT. */
const BATCH_CHARS = 2_000_000

const { values, positionals } = parseArgs({ allowPositionals: true, options: { data: { type: 'string' }, inland: { type: 'string' } } })
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
const inlandRegions = [...new Set(positionals)].filter((r) => INLAND_EXTRACTS[r])
const INLAND_LAYER = 'gis_osm_water_a_free_1'
if (inlandRegions.length && !values.inland) throw new Error(`${inlandRegions.join(', ')} ha${inlandRegions.length > 1 ? 've' : 's'} inland water: pass --inland <folder> (see the header)`)
for (const r of inlandRegions) {
  if (!existsSync(join(values.inland!, r, `${INLAND_LAYER}.shp`))) throw new Error(`${join(values.inland!, r, INLAND_LAYER)}.shp not found — unzip ${INLAND_EXTRACTS[r]}'s water layer there`)
}

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
/**
 * A region's lakes, reservoirs and river areas: polygons for "is this water?", and their edges as
 * shore lines (water on the right) for the snap. Replaces the region's previous inland import.
 */
async function importInland(region: string): Promise<void> {
  const base = join(values.inland!, region, INLAND_LAYER)
  const attrs = openDbf(`${base}.dbf`)
  await clearInlandRegion(region)
  let water: { fclass: string; wkt: string }[] = []
  let shores: string[] = []
  let chars = 0
  let kept = 0
  let skipped = 0
  const flush = async () => {
    await insertInlandWater(region, water)
    for (let i = 0; i < shores.length; i += 500) await insertInlandShores(region, shores.slice(i, i + 500))
    water = []
    shores = []
    chars = 0
  }
  for (const rec of readShapes(`${base}.shp`)) {
    const fclass = attrs.read(rec.n).fclass ?? ''
    if (rec.type !== 5 || !isBathingWater(fclass, rec.parts)) {
      skipped++
      continue
    }
    const wkt = toWkt(rec)
    water.push({ fclass, wkt })
    shores.push(...shoreLines(rec.parts))
    chars += wkt.length
    kept++
    if (chars >= BATCH_CHARS || water.length >= 500) {
      await flush()
      process.stdout.write(`\r  inland water polygons: ${kept}`)
    }
  }
  await flush()
  attrs.close()
  console.log(`\r  inland water polygons: ${kept} (skipped ${skipped}: wetland, glacier, dock or under the size floor)`)
}

for (const region of inlandRegions) {
  console.log(`${region} inland (${INLAND_EXTRACTS[region]})`)
  await importInland(region)
}
console.log(`done in ${Math.round((Date.now() - started) / 1000)} s`)
process.exit(0)
