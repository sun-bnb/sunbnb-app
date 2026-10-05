/**
 * OSM coastline cache — DB access (track 027). The marketing beach mockup reads the shoreline
 * from here in milliseconds instead of asking the public Overpass API per visitor (it timed out
 * under load, 2026-10-05). Tiles are filled by apps/marketing (on first use, or by the seeding
 * script); the grid itself is pure, in `./coastline-tiles`.
 *
 * Geometries are stored as SRID 4326 LineStrings, GiST-indexed; reads filter on the index with a
 * bounding box, then on true distance in metres (geography).
 */
import prisma from '../index'

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
