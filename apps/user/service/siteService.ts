
import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import { MapCenter, MapBounds, SiteGeography } from '@/app/sites/types'
import { BLOCKING_STATUSES, OP_NO_SHOW, OP_DEPARTED } from '@repo/data/reservation-status'

function parsePointWKT(wkt: string): [number, number] {
  // Matches something like "POINT(lat lng)"
  const match = wkt.match(/POINT\(\s*([^)]+)\s*\)/);
  if (!match) throw new Error(`Invalid WKT POINT: ${wkt}`);

  const [lat, lng] = match[1]!.split(/\s+/).map(Number);
  return [lat!, lng!];
}

function parsePolygonWKT(wkt: string): number[][] {
  // Matches "POLYGON((lat1 lng1, lat2 lng2, ...))"
  const match = wkt.match(/POLYGON\(\(\s*([^)]+)\s*\)\)/);
  if (!match) throw new Error(`Invalid WKT POLYGON: ${wkt}`);

  return match[1]!
    .split(',')
    .map(part => part.trim().split(/\s+/).map(Number)); // [[lat, lng], [lat, lng], ...]
}

export function parseMapData(data: { center: string; bounding_box: string }): SiteGeography {
  // 1) Parse the center point (always POINT(...))
  const [centerLat, centerLng] = parsePointWKT(data.center);
  const center: MapCenter = { lat: centerLat, lng: centerLng };

  // 2) Parse the bounding box, which might be POINT(...) or POLYGON(...)
  const boundingStr = data.bounding_box.trim();
  let bounds: MapBounds;

  if (boundingStr.startsWith('POINT(')) {
    // Single site => bounding box is the same point
    const [lat, lng] = parsePointWKT(boundingStr);
    bounds = {
      north: lat,
      south: lat,
      east: lng,
      west: lng,
    };
  } else if (boundingStr.startsWith('POLYGON((')) {
    // Multiple sites => bounding box is a polygon
    const coords = parsePolygonWKT(boundingStr);
    const lats = coords.map(pair => pair[0]!);
    const lngs = coords.map(pair => pair[1]!);

    bounds = {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    };
  } else {
    // Unexpected geometry type
    throw new Error(`Unknown bounding_box format: ${data.bounding_box}`);
  }

  return { center, bounds };
}


export async function searchSites(lat?: string, lng?: string) {

  // Validate lat/lng are finite numbers to prevent unexpected Postgres behavior
  if (lat !== undefined && lng !== undefined) {
    const latNum = Number(lat)
    const lngNum = Number(lng)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return { sites: [], geography: undefined }
    }
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return { sites: [], geography: undefined }
    }
  }

  // Prepare partial SQL snippets for the optional distance logic
  const distanceColumn = lat && lng
  ? Prisma.sql`
      ST_DistanceSphere(
        coords,
        ST_MakePoint(${lat}::double precision, ${lng}::double precision)
      ) / 1000 AS dist_km,
    `
  : Prisma.sql``;

  /*
  const whereClause = lat && lng
  ? Prisma.sql`
      WHERE ST_DistanceSphere(
        coords,
        ST_MakePoint(${lat}::double precision, ${lng}::double precision)
      ) <= 30000
    `
  : Prisma.sql``;
  */

  const whereClause = Prisma.sql`
    WHERE status = 'active'
      -- Must have a name
      AND name IS NOT NULL AND name != ''
      -- Must have a valid location
      AND location_lat IS NOT NULL AND location_lng IS NOT NULL
      AND location_lat != '0' AND location_lng != '0'
      -- Must have at least one active inventory item
      AND EXISTS (
        SELECT 1 FROM "InventoryItem"
        WHERE site_id = "Site".id AND status = 'active'
      )
      -- Must have at least one working hours entry
      AND EXISTS (
        SELECT 1 FROM "SiteWorkingHours"
        WHERE site_id = "Site".id
      )
      -- Must have a cover image
      AND image IS NOT NULL
      -- Paid reservations require price, VAT, and Mollie
      AND (
        type IS DISTINCT FROM 'paid'
        OR (
          price IS NOT NULL AND price > 0
          AND vat IS NOT NULL
        )
      )
      -- Any service using integrated payments requires Mollie onboarding
      AND (
        (type IS DISTINCT FROM 'paid' AND order_payment_type IS DISTINCT FROM 'paid' AND rental_payment_type IS DISTINCT FROM 'paid')
        OR EXISTS (
          SELECT 1 FROM "PartnerAccount"
          WHERE user_id = "Site".user_id
            AND mollie_access_token IS NOT NULL
            AND mollie_onboarding_status = 'completed'
        )
      )
  `;

  const orderByClause = lat && lng
  ? Prisma.sql`ORDER BY dist_km`
  : Prisma.sql``;

  // Server-local today bounds — matches the convention used by availabilityService
  // (endOfToday = new Date() with setHours(23,59,59,999)) so counts are consistent.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  // Build the IN (...) list for BLOCKING_STATUSES using Prisma.join to avoid
  // hardcoding status strings (single source of truth from @repo/data).
  const blockingStatusList = Prisma.join(BLOCKING_STATUSES)

  // Query
  const results = await prisma.$queryRaw<any[]>(
    Prisma.sql`
      SELECT
        id,
        name,
        description,
        image,
        image_width,
        image_height,
        price,
        services,
        features,
        location_lat,
        location_lng,
        ${distanceColumn}
        (
          SELECT COUNT(*)
          FROM "InventoryItem"
          WHERE site_id = "Site".id
            AND status = 'active'
        )::int AS item_count,
        (
          SELECT COUNT(*)
          FROM "InventoryItem" i
          WHERE i.site_id = "Site".id
            AND i.status = 'active'
            AND NOT EXISTS (
              SELECT 1
              FROM "_InventoryItemToReservation" itor
              JOIN "Reservation" r ON r.id = itor."B"
              WHERE itor."A" = i.id
                AND r.status IN (${blockingStatusList})
                AND r.from <= ${endOfToday}
                AND r.to >= ${startOfToday}
                AND NOT (
                  r.operational_status IN (${OP_NO_SHOW}, ${OP_DEPARTED})
                  AND r.to <= ${endOfToday}
                )
            )
        )::int AS available_count
      FROM "Site"
      ${whereClause}
      ${orderByClause}
      LIMIT 20
    `
  );


  const ids = results.map(r => r.id);

  let bounds: any = null;

  if (ids.length > 1) {
    // Multiple sites: use ST_Centroid(ST_Collect(...)) and ST_Extent(...)
    bounds = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT
          ST_AsText(ST_Centroid(ST_Collect(coords))) AS center,
          ST_AsText(ST_Extent(coords))          AS bounding_box
        FROM "Site"
        WHERE id IN (${Prisma.join(ids)});
      `
    );
  } else if (ids.length === 1) {
    // Exactly one site: we can return coords directly as center.
    // For bounding_box, ST_Envelope(coords) gives a minimal bounding rectangle
    // around the single geometry (which is effectively just the point).
    bounds = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT
          ST_AsText(coords)                 AS center,
          ST_AsText(ST_Envelope(coords))    AS bounding_box
        FROM "Site"
        WHERE id = ${ids[0]};
      `
    );
  } else {
    // No sites: no geometry to compute
    bounds = null;
  }

  const sites = results.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    image: r.image,
    imageWidth: r.image_width,
    imageHeight: r.image_height,
    locationLat: r.location_lat,
    locationLng: r.location_lng,
    distance: r.dist_km,
    price: r.price,
    services: r.services,
    features: r.features,
    itemCount: r.item_count,
    availableCount: r.available_count
  }))

  return {
    sites,
    geography: (bounds && bounds[0]?.center && bounds[0]?.bounding_box) ? parseMapData({
      center: bounds[0].center,
      bounding_box: bounds[0].bounding_box
    }) : undefined
  }


}