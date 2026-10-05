/**
 * Prefer scripts/import-coastline.ts (bulk OSM data, no Overpass at all) for regions you advertise
 * in; this fallback fills single tiles from Overpass.
 *
 * Pre-fill the coastline cache for the coasts an ad campaign targets (track 027), so the first
 * visitor from an ad never waits on Overpass. Slow and polite on purpose: one tile at a time,
 * generous timeouts, a pause between requests (Overpass fair use). Re-runnable — covered tiles
 * are skipped, failed ones are retried on the next run.
 *
 *   cd apps/marketing && source .env.local && npm run seed:coastline -- mallorca costa-del-sol
 *   npm run seed:coastline -- --box 36.4,-5.4,36.8,-4.2          # south,west,north,east
 *
 * POSTGRES_URL decides which database is filled (local / test / production).
 */
import { parseArgs } from 'node:util'
import { storeCoastTile, uncoveredCoastTiles } from '@repo/data/coastline-db'
import { coastTilesInBox } from '@repo/data/coastline-tiles'
import { fetchCoastTile } from '../lib/overpass'
import { regionBoxes, type Box } from '../lib/coast-regions'

const PAUSE_MS = 1500

const { values, positionals } = parseArgs({ allowPositionals: true, options: { box: { type: 'string' } } })
const boxes: [string, Box][] = regionBoxes(positionals)
if (values.box) {
  const [south, west, north, east] = values.box.split(',').map(Number) as [number, number, number, number]
  boxes.push(['box', { south, west, north, east }])
}
if (!boxes.length) throw new Error('name a region (see lib/coast-regions.ts) or --box s,w,n,e')

for (const [name, box] of boxes) {
  const todo = await uncoveredCoastTiles(coastTilesInBox(box))
  console.log(`${name}: ${todo.length} tile(s) to fetch`)
  let done = 0
  let failed = 0
  for (const key of todo) {
    const ways = await fetchCoastTile(key, 60_000)
    if (ways) {
      await storeCoastTile(key, ways)
      done++
    } else failed++
    process.stdout.write(`\r  ${done} stored, ${failed} failed (retry later)`)
    await new Promise((r) => setTimeout(r, PAUSE_MS))
  }
  console.log()
}
process.exit(0)
