import prisma from '@repo/data/PrismaCient'

/**
 * Parcel-tier summary for the inventory editor (track 020 C2 slice 2).
 *
 * One row per parcel instead of one row per seat: a 4 400-seat site described
 * by ~12 records. Carries the ItemGroup geometry `parcelFootprint` needs to
 * draw the overview box WITHOUT loading a single seat, plus the counts the
 * editor header, parcel bar and "is the whole parcel selected?" checks read.
 *
 * `itemGroupId` is null for legacy parcels created before ItemGroup existed —
 * those have no geometry, so the client falls back to deriving their box from
 * seats (few, and it degrades to today's behaviour rather than breaking).
 */
export interface ParcelSummary {
  group: number
  count: number
  itemGroupId: string | null
  rows: number | null
  seatsPerRow: number | null
  horizontalGap: number | null
  verticalGap: number | null
  pairGap: number | null
  rotation: number | null
  locationLat: string | null
  locationLng: string | null
  schematicX: number | null
  schematicY: number | null
  category: string | null
  price: number | null
}

export interface SiteParcels {
  parcels: ParcelSummary[]
  /** Seats with no parcel (group 0) — no box to live in, so they ship as rows. */
  ungroupedCount: number
}

export async function getParcelSummaries(siteId: string): Promise<SiteParcels> {
  // Pool sentinels sit at (0,0) and are excluded from the editor entirely —
  // same rule the map's visibleItems filter applies.
  const grouped = await prisma.inventoryItem.groupBy({
    by: ['group', 'itemGroupId'],
    where: { siteId, status: { not: 'pool' } },
    _count: { _all: true },
  })

  const itemGroupIds = [...new Set(grouped.map((g) => g.itemGroupId).filter(Boolean))] as string[]
  const geometries = itemGroupIds.length
    ? await prisma.itemGroup.findMany({
        where: { id: { in: itemGroupIds } },
        select: {
          id: true, rows: true, seatsPerRow: true, horizontalGap: true, verticalGap: true,
          pairGap: true, rotation: true, locationLat: true, locationLng: true,
          schematicX: true, schematicY: true, category: true, price: true,
        },
      })
    : []
  const byId = new Map(geometries.map((g) => [g.id, g]))

  // A parcel can span several itemGroupId values only in legacy/corrupt data;
  // fold by group number and keep the first geometry found, so the editor
  // still shows exactly one box per parcel.
  const byGroup = new Map<number, ParcelSummary>()
  for (const row of grouped) {
    if (!(row.group > 0)) continue
    const existing = byGroup.get(row.group)
    const geo = row.itemGroupId ? byId.get(row.itemGroupId) : undefined
    if (existing) {
      existing.count += row._count._all
      if (!existing.itemGroupId && geo) {
        Object.assign(existing, {
          itemGroupId: geo.id, rows: geo.rows, seatsPerRow: geo.seatsPerRow,
          horizontalGap: geo.horizontalGap, verticalGap: geo.verticalGap, pairGap: geo.pairGap,
          rotation: geo.rotation, locationLat: geo.locationLat, locationLng: geo.locationLng,
          schematicX: geo.schematicX, schematicY: geo.schematicY,
          category: geo.category, price: geo.price,
        })
      }
      continue
    }
    byGroup.set(row.group, {
      group: row.group,
      count: row._count._all,
      itemGroupId: geo?.id ?? null,
      rows: geo?.rows ?? null,
      seatsPerRow: geo?.seatsPerRow ?? null,
      horizontalGap: geo?.horizontalGap ?? null,
      verticalGap: geo?.verticalGap ?? null,
      pairGap: geo?.pairGap ?? null,
      rotation: geo?.rotation ?? null,
      locationLat: geo?.locationLat ?? null,
      locationLng: geo?.locationLng ?? null,
      schematicX: geo?.schematicX ?? null,
      schematicY: geo?.schematicY ?? null,
      category: geo?.category ?? null,
      price: geo?.price ?? null,
    })
  }

  const ungroupedCount = grouped
    .filter((g) => !(g.group > 0))
    .reduce((sum, g) => sum + g._count._all, 0)

  return {
    parcels: [...byGroup.values()].sort((a, b) => a.group - b.group),
    ungroupedCount,
  }
}
