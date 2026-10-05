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
import appPrisma from '../index'

/**
 * Coastline data is public and identical in every environment, so it need not be duplicated:
 * `COASTLINE_POSTGRES_URL` points these functions at the database that holds it (test reads
 * production's). Unset → the app's own database. Every coast_* read and write in this module goes
 * through this client — the shared database's Overpass read-through cache then serves both
 * environments. Grant that connection's role only SELECT/INSERT/UPDATE/DELETE on coast_line,
 * coast_water and coast_tile (see the track 027 log for the SQL).
 */
const globalForCoast = globalThis as unknown as { coastPrisma?: PrismaClient }
const prisma: PrismaClient = process.env.COASTLINE_POSTGRES_URL
  ? (globalForCoast.coastPrisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.COASTLINE_POSTGRES_URL }) }))
  : appPrisma

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
  const covered = await prisma.coastTile.findMany({ where: { key: { in: keys } }, select: { key: true } })
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
  await prisma.$transaction(async (tx) => {
    for (const w of valid) {
      const wkt = `LINESTRING(${w.points.map((p) => `${p.lng} ${p.lat}`).join(',')})`
      await tx.$executeRaw`
        INSERT INTO coast_line (osm_way_id, geom)
        VALUES (${BigInt(w.id)}, ST_GeomFromText(${wkt}, 4326))
        ON CONFLICT (osm_way_id) DO NOTHING`
    }
    await tx.coastTile.upsert({
      where: { key },
      create: { key, ways: valid.length },
      update: { ways: valid.length, fetchedAt: new Date() },
    })
  })
}

/** Coastline ways within `radiusM` metres of a point, whole, in OSM order. */
export async function coastlineNear(lat: number, lng: number, radiusM: number): Promise<CoastWay[]> {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
  const rows = await prisma.$queryRaw<{ id: bigint; geojson: string }[]>`
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
  await prisma.$executeRaw`DELETE FROM coast_line WHERE osm_way_id < 0 AND geom && ${envelope(box)}`
  await prisma.$executeRaw`DELETE FROM coast_water WHERE geom && ${envelope(box)}`
}

/** Insert imported coastline segments (WKT, OSM direction kept) — idempotent per id. */
export async function insertImportedLines(rows: { id: number; wkt: string }[]): Promise<void> {
  if (!rows.length) return
  const values = Prisma.join(rows.map((r) => Prisma.sql`(${BigInt(-Math.abs(r.id))}, ST_GeomFromText(${r.wkt}, 4326))`))
  await prisma.$executeRaw`INSERT INTO coast_line (osm_way_id, geom) VALUES ${values}
    ON CONFLICT (osm_way_id) DO UPDATE SET geom = EXCLUDED.geom, fetched_at = now()`
}

/** Insert imported water polygons (WKT MULTIPOLYGON), made valid on the way in — idempotent per id. */
export async function insertImportedWater(rows: { id: number; wkt: string }[]): Promise<void> {
  if (!rows.length) return
  const values = Prisma.join(rows.map((r) => Prisma.sql`(${BigInt(r.id)}, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText(${r.wkt}, 4326)), 3)))`))
  await prisma.$executeRaw`INSERT INTO coast_water (id, geom) VALUES ${values}
    ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom, imported_at = now()`
}

/** Mark every tile of an imported region covered, so lookups there never call Overpass. */
export async function markImportedTiles(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000)
    const values = Prisma.join(chunk.map((k) => Prisma.sql`(${k}, 0, 'osmdata')`))
    await prisma.$executeRaw`INSERT INTO coast_tile (key, ways, source) VALUES ${values}
      ON CONFLICT (key) DO UPDATE SET source = 'osmdata', fetched_at = now()`
  }
}

/**
 * The sea within `radiusM` of a point, clipped to that square, as rings of points (outer rings
 * and holes alike — an even-odd point-in-polygon test over all of them answers "in the sea?").
 * Empty where no region was imported.
 */
export async function waterNear(lat: number, lng: number, radiusM: number): Promise<CoastPoint[][]> {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
  const box = envelope({ south: lat - dLat, west: lng - dLng, north: lat + dLat, east: lng + dLng })
  const rows = await prisma.$queryRaw<{ geojson: string }[]>`
    SELECT ST_AsGeoJSON(ST_CollectionExtract(ST_Intersection(geom, ${box}), 3), 6) AS geojson
    FROM coast_water WHERE geom && ${box}`
  const rings: CoastPoint[][] = []
  for (const r of rows) {
    const g = JSON.parse(r.geojson) as { type: string; coordinates: number[][][] | number[][][][] }
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
    for (const poly of polys) for (const ring of poly) if (ring.length >= 4) rings.push(ring.map(([x, y]) => ({ lat: y!, lng: x! })))
  }
  return rings
}
