/**
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

type Box = { south: number; west: number; north: number; east: number }

/** Campaign coasts. Boxes are generous; inland tiles cost one tiny request and store "no coast". */
const REGIONS: Record<string, Box> = {
  mallorca: { south: 39.25, west: 2.3, north: 39.97, east: 3.48 },
  menorca: { south: 39.8, west: 3.78, north: 40.1, east: 4.33 },
  ibiza: { south: 38.63, west: 1.15, north: 39.13, east: 1.62 },
  'costa-del-sol': { south: 36.4, west: -5.4, north: 36.8, east: -4.2 },
  'costa-blanca': { south: 37.85, west: -0.8, north: 38.85, east: 0.25 },
  'costa-brava': { south: 41.65, west: 2.75, north: 42.45, east: 3.35 },
}

const PAUSE_MS = 1500

const { values, positionals } = parseArgs({ allowPositionals: true, options: { box: { type: 'string' } } })
const boxes: [string, Box][] = positionals.map((name) => {
  const b = REGIONS[name]
  if (!b) throw new Error(`unknown region "${name}" — one of: ${Object.keys(REGIONS).join(', ')}`)
  return [name, b]
})
if (values.box) {
  const [south, west, north, east] = values.box.split(',').map(Number) as [number, number, number, number]
  boxes.push(['box', { south, west, north, east }])
}
if (!boxes.length) throw new Error(`name a region (${Object.keys(REGIONS).join(', ')}) or --box s,w,n,e`)

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
