/**
 * OSM coastline cache — DB access (track 027). The marketing beach mockup reads the shoreline
 * from here in milliseconds instead of asking the public Overpass API per visitor (it timed out
 * under load, 2026-10-05). Tiles are filled by apps/marketing (on first use, or by the seeding
 * script); the grid itself is pure, in `./coastline-tiles`.
 *
 * Geometries are stored as SRID 4326 LineStrings, GiST-indexed; reads filter on the index with a
 * bounding box, then on true distance in metres (geography).
 */
import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * The coastline lives in its OWN database (`COASTLINE_POSTGRES_URL`; schema in
 * `coastline/schema.sql`, applied with `npm run coastline:schema`) — public map data shared by
 * every environment, outside the app schema and its migrations. This module only issues raw SQL
 * over that connection, so it depends on no app model. Unset → every call throws, and callers
 * (the marketing route) fall back to manual turning; the app itself is unaffected.
 */
const globalForCoast = globalThis as unknown as { coastPrisma?: PrismaClient }
function db(): PrismaClient {
  const url = process.env.COASTLINE_POSTGRES_URL
  if (!url) throw new Error('COASTLINE_POSTGRES_URL is not set (the coastline database)')
  return (globalForCoast.coastPrisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }))
}

export interface CoastPoint {
  lat: number
  lng: number
}

export interface CoastWay {
  /** OSM way id. */
  id: number
  /** Points in OSM order — the coastline convention puts the water on the RIGHT. */
  points: CoastPoint[]
}

/** Of these tile keys, the ones never fetched. */
export async function uncoveredCoastTiles(keys: string[]): Promise<string[]> {
  if (!keys.length) return []
  const covered = await db().$queryRaw<{ key: string }[]>`SELECT key FROM coast_tile WHERE key IN (${Prisma.join(keys)})`
  const have = new Set(covered.map((t) => t.key))
  return keys.filter((k) => !have.has(k))
}

/**
 * Store a fetched tile: every coastline way touching it (a way already stored for a neighbouring
 * tile is skipped), then mark the tile covered — even with zero ways ("no coast here" is an
 * answer). Idempotent.
 */
export async function storeCoastTile(key: string, ways: CoastWay[]): Promise<void> {
  const valid = ways.filter((w) => Number.isSafeInteger(w.id) && w.points.length >= 2)
  await db().$transaction(async (tx) => {
    for (const w of valid) {
      const wkt = `LINESTRING(${w.points.map((p) => `${p.lng} ${p.lat}`).join(',')})`
      await tx.$executeRaw`
        INSERT INTO coast_line (osm_way_id, geom)
        VALUES (${BigInt(w.id)}, ST_GeomFromText(${wkt}, 4326))
        ON CONFLICT (osm_way_id) DO NOTHING`
    }
    await tx.$executeRaw`
      INSERT INTO coast_tile (key, ways) VALUES (${key}, ${valid.length})
      ON CONFLICT (key) DO UPDATE SET ways = EXCLUDED.ways, fetched_at = now()`
  })
}

/** Coastline ways within `radiusM` metres of a point, whole, in OSM order. */
export async function coastlineNear(lat: number, lng: number, radiusM: number): Promise<CoastWay[]> {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
  const rows = await db().$queryRaw<{ id: bigint; geojson: string }[]>`
    SELECT osm_way_id AS id, ST_AsGeoJSON(geom) AS geojson
    FROM coast_line
    WHERE geom && ST_MakeEnvelope(${lng - dLng}, ${lat - dLat}, ${lng + dLng}, ${lat + dLat}, 4326)
      AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM})`
  return rows.map((r) => ({
    id: Number(r.id),
    points: (JSON.parse(r.geojson) as { coordinates: [number, number][] }).coordinates.map(([x, y]) => ({ lat: y, lng: x })),
  }))
}

// ── Bulk import (osmdata.openstreetmap.de, track 027) ──────────────────────────────────────────

export interface ImportBox {
  south: number
  west: number
  north: number
  east: number
}

const envelope = (b: ImportBox) => Prisma.sql`ST_MakeEnvelope(${b.west}, ${b.south}, ${b.east}, ${b.north}, 4326)`

/**
 * Start a region import: drop what an earlier import stored in the box (imported lines have
 * negative ids; water is import-only), so a newer dataset version replaces it cleanly.
 * Overpass-fetched ways (positive ids) are left alone.
 */
export async function clearImportedRegion(box: ImportBox): Promise<void> {
  await db().$executeRaw`DELETE FROM coast_line WHERE osm_way_id < 0 AND geom && ${envelope(box)}`
  await db().$executeRaw`DELETE FROM coast_water WHERE geom && ${envelope(box)}`
}

/** Insert imported coastline segments (WKT, OSM direction kept) — idempotent per id. */
export async function insertImportedLines(rows: { id: number; wkt: string }[]): Promise<void> {
  if (!rows.length) return
  const values = Prisma.join(rows.map((r) => Prisma.sql`(${BigInt(-Math.abs(r.id))}, ST_GeomFromText(${r.wkt}, 4326))`))
  await db().$executeRaw`INSERT INTO coast_line (osm_way_id, geom) VALUES ${values}
    ON CONFLICT (osm_way_id) DO UPDATE SET geom = EXCLUDED.geom, fetched_at = now()`
}

/** Insert imported water polygons (WKT MULTIPOLYGON), made valid on the way in — idempotent per id. */
export async function insertImportedWater(rows: { id: number; wkt: string }[]): Promise<void> {
  if (!rows.length) return
  const values = Prisma.join(rows.map((r) => Prisma.sql`(${BigInt(r.id)}, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText(${r.wkt}, 4326)), 3)))`))
  await db().$executeRaw`INSERT INTO coast_water (id, geom) VALUES ${values}
    ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom, imported_at = now()`
}

/** Mark every tile of an imported region covered, so lookups there never call Overpass. */
export async function markImportedTiles(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000)
    const values = Prisma.join(chunk.map((k) => Prisma.sql`(${k}, 0, 'osmdata')`))
    await db().$executeRaw`INSERT INTO coast_tile (key, ways, source) VALUES ${values}
      ON CONFLICT (key) DO UPDATE SET source = 'osmdata', fetched_at = now()`
  }
}

// ── Inland water (Geofabrik country extracts, track 027 P15) ───────────────────────────────────

/** Start a region's inland import: its previous lakes, rivers and their shores go. */
export async function clearInlandRegion(region: string): Promise<void> {
  await db().$executeRaw`DELETE FROM inland_shore WHERE region = ${region}`
  await db().$executeRaw`DELETE FROM inland_water WHERE region = ${region}`
}

/** Insert inland water polygons (WKT MULTIPOLYGON), made valid on the way in. */
export async function insertInlandWater(region: string, rows: { fclass: string; wkt: string }[]): Promise<void> {
  if (!rows.length) return
  const values = Prisma.join(rows.map((r) => Prisma.sql`(${region}, ${r.fclass}, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText(${r.wkt}, 4326)), 3)))`))
  await db().$executeRaw`INSERT INTO inland_water (region, fclass, geom) VALUES ${values}`
}

/** Insert inland shore lines (WKT LINESTRING, water on the RIGHT). */
export async function insertInlandShores(region: string, wkts: string[]): Promise<void> {
  if (!wkts.length) return
  const values = Prisma.join(wkts.map((w) => Prisma.sql`(${region}, ST_GeomFromText(${w}, 4326))`))
  await db().$executeRaw`INSERT INTO inland_shore (region, geom) VALUES ${values}`
}

/** Lake and river shores within `radiusM` of a point, water on the right — like `coastlineNear`. */
export async function inlandShoreNear(lat: number, lng: number, radiusM: number): Promise<CoastPoint[][]> {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
  const rows = await db().$queryRaw<{ geojson: string }[]>`
    SELECT ST_AsGeoJSON(geom) AS geojson
    FROM inland_shore
    WHERE geom && ST_MakeEnvelope(${lng - dLng}, ${lat - dLat}, ${lng + dLng}, ${lat + dLat}, 4326)
      AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM})`
  return rows.map((r) => (JSON.parse(r.geojson) as { coordinates: [number, number][] }).coordinates.map(([x, y]) => ({ lat: y, lng: x })))
}

/**
 * The water — sea AND inland — within `radiusM` of a point, clipped to that square, as rings of
 * points (outer rings and holes alike). Everything is UNIONED first, so overlapping pieces (a
 * river polygon running into the sea, two split sea pieces sharing an edge) never cancel each
 * other in the even-odd point-in-polygon test. Empty where nothing was imported.
 */
export async function waterNear(lat: number, lng: number, radiusM: number): Promise<CoastPoint[][]> {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
  const box = envelope({ south: lat - dLat, west: lng - dLng, north: lat + dLat, east: lng + dLng })
  const rows = await db().$queryRaw<{ geojson: string | null }[]>`
    SELECT ST_AsGeoJSON(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_Intersection(geom, ${box}), 3))), 3), 6) AS geojson
    FROM (SELECT geom FROM coast_water WHERE geom && ${box}
          UNION ALL SELECT geom FROM inland_water WHERE geom && ${box}) w`
  const rings: CoastPoint[][] = []
  for (const r of rows) {
    if (!r.geojson) continue
    const g = JSON.parse(r.geojson) as { type: string; coordinates: number[][][] | number[][][][] }
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
    for (const poly of polys) for (const ring of poly) if (ring.length >= 4) rings.push(ring.map(([x, y]) => ({ lat: y!, lng: x! })))
  }
  return rings
}
