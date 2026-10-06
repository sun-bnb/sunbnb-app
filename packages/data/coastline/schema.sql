-- The coastline database (track 027): OSM coastlines + water polygons for the marketing beach
-- mockup, in its OWN database — public map data, shared by every environment, outside the app
-- schema and its Prisma migrations. Idempotent: apply with `npm run coastline:schema`
-- (COASTLINE_POSTGRES_URL decides where). Read/written by src/coastline-db.ts only.

CREATE EXTENSION IF NOT EXISTS postgis;

-- A 0.1° tile (~10 km) whose coastline is in coast_line: bulk-imported ("osmdata") or fetched
-- once from Overpass ("overpass"). A covered tile with zero ways = "no coast here".
CREATE TABLE IF NOT EXISTS coast_tile (
  key        TEXT PRIMARY KEY,
  ways       INTEGER NOT NULL,
  source     TEXT NOT NULL DEFAULT 'overpass',
  fetched_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Coastline ways in OSM direction (land left, water right), SRID 4326. Positive ids = OSM way ids
-- (Overpass); NEGATIVE ids = bulk-imported osmdata segments (which carry no way id).
CREATE TABLE IF NOT EXISTS coast_line (
  osm_way_id BIGINT PRIMARY KEY,
  geom       geometry NOT NULL,
  fetched_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS coast_line_geom_idx ON coast_line USING GIST (geom);

-- The sea as polygons (osmdata water-polygons-split), bulk-imported per region.
CREATE TABLE IF NOT EXISTS coast_water (
  id          BIGINT PRIMARY KEY,
  geom        geometry NOT NULL,
  imported_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS coast_water_geom_idx ON coast_water USING GIST (geom);

-- Inland water (lakes, reservoirs, rivers) per region, from Geofabrik country extracts (track 027
-- P15) — the sea tables above only know the sea, so a lake or river beach had no shore. Replaced
-- whole per region on re-import (`region` = the name in apps/marketing/lib/coast-regions.ts).
CREATE TABLE IF NOT EXISTS inland_water (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  region      TEXT NOT NULL,
  fclass      TEXT NOT NULL,
  geom        geometry NOT NULL,
  imported_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS inland_water_geom_idx ON inland_water USING GIST (geom);
CREATE INDEX IF NOT EXISTS inland_water_region_idx ON inland_water (region);

-- Those polygons' edges as lines with the WATER ON THE RIGHT (the coast_line convention), in short
-- pieces, so the shore lookup treats a lake shore exactly like a coastline.
CREATE TABLE IF NOT EXISTS inland_shore (
  id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  region TEXT NOT NULL,
  geom   geometry NOT NULL
);
CREATE INDEX IF NOT EXISTS inland_shore_geom_idx ON inland_shore USING GIST (geom);
CREATE INDEX IF NOT EXISTS inland_shore_region_idx ON inland_shore (region);

-- The website's role (production) reads them; created by hand, so only when it exists.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coast_rw') THEN
    GRANT SELECT ON inland_water, inland_shore TO coast_rw;
  END IF;
END $$;
