
import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import { MapCenter, MapBounds, SiteGeography } from '@/app/sites/types'


function parseMapData(data: { center: string; bounding_box: string }): SiteGeography {
  // Parse the center point
  const centerMatch = data.center.match(/POINT\(([^)]+)\)/);
  if (!centerMatch) {
    throw new Error('Invalid center format');
  }
  const [centerLat, centerLng] = centerMatch[1]!.split(' ').map(Number);
  const center: MapCenter = {
    lat: centerLat!,
    lng: centerLng!,
  };

  // Parse the bounding box
  const boundingBoxMatch = data.bounding_box.match(/POLYGON\(\(([^)]+)\)\)/);
  if (!boundingBoxMatch) {
    throw new Error('Invalid bounding box format');
  }
  const boundingBoxCoords = boundingBoxMatch[1]!.split(',').map(coord => coord.trim().split(' ').map(Number));

  // Extract the bounds from the bounding box coordinates
  const lats = boundingBoxCoords.map(coord => coord[0]!);
  const lngs = boundingBoxCoords.map(coord => coord[1]!);

  const bounds: MapBounds = {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };

  console.log('bounds', bounds)
  console.log('center', center)

  return { center, bounds };
}


export async function searchSites(lat?: string, lng?: string) {

  const distanceQuery = lat && lng 
  ? Prisma.sql`ST_DistanceSphere(coords, ST_MakePoint(${lat}::double precision, ${lng}::double precision)) / 1000 AS dist_km,`
  : Prisma.sql``;

const orderByClause = lat && lng 
  ? Prisma.sql`ORDER BY dist_km` 
  : Prisma.sql``;

const results = await prisma.$queryRaw<any[]>(
  Prisma.sql`SELECT 
    id,
    name,
    description,
    image,
    image_width,
    image_height,
    price,
    location_lat,
    location_lng,
    ${distanceQuery}
    (SELECT COUNT(*) FROM "InventoryItem" WHERE site_id = "Site".id)::int AS item_count,
    (SELECT COUNT(*) FROM "InventoryItem" WHERE site_id = "Site".id AND status = 'available')::int AS available_count
    FROM "Site"
    ${orderByClause}
    LIMIT 10`
);

  const ids = results.map(r => r.id);
  const bounds = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT
        ST_AsText(ST_Centroid(ST_Collect(coords))) AS center,
        ST_AsText(ST_Extent(coords)) AS bounding_box
      FROM 
        "Site"
        WHERE id IN (${Prisma.join(ids)});
      `
  )

  console.log('results', results)

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
    itemCount: r.item_count,
    availableCount: r.available_count
  }))

  return {
    sites,
    geography: parseMapData({
      center: bounds[0].center,
      bounding_box: bounds[0].bounding_box
    })
  }


}