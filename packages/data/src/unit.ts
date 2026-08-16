/**
 * Physical units (track 021).
 *
 * A `SunbedGroup` is the physical UNIT — the spot where a shade and its beds
 * stand. Invariant I1: **every PLACED seat belongs to exactly one unit**; a
 * null `sunbedGroupId` means precisely "not placed — in the pool", and nothing
 * else. The unit is what a device mounts to and what carries the persisted
 * label number, so it must exist for every seat that occupies a spot.
 *
 * SERVER-ONLY — imports the Prisma client.
 */

import prisma from '../index'

/** Seats in the pool are unplaced by definition and legitimately hold no unit. */
const PLACED = { not: 'pool' } as const

export interface EnsureUnitsResult {
  /** Seats that were placed but unitless, and now have a unit of their own. */
  created: number
}

/**
 * Give every placed-but-unitless seat its own single-member unit.
 *
 * Idempotent and re-runnable: it only ever acts on seats with a null group, so
 * running it twice is a no-op and running it after a partial failure completes
 * the job. Used both by the write paths (so a parcel created without pairing
 * still satisfies I1) and by the backfill — ONE implementation, because two
 * would eventually disagree about what "placed" means.
 *
 * Set-based rather than per-seat: a pairing-off parcel can be 500 seats, and
 * the track-020 work exists precisely so a bulk operation is not N statements.
 */
export async function ensurePlacedSeatsHaveUnits(
  siteId: string,
  options: { group?: number } = {},
): Promise<EnsureUnitsResult> {
  const unitless = await prisma.inventoryItem.findMany({
    where: {
      siteId,
      status: PLACED,
      sunbedGroupId: null,
      ...(options.group !== undefined ? { group: options.group } : {}),
    },
    select: { id: true },
    orderBy: { number: 'asc' },
  })
  if (unitless.length === 0) return { created: 0 }

  await prisma.$transaction(async (tx) => {
    // createManyAndReturn preserves input order, so index i pairs seat i with
    // its freshly minted unit.
    const units = await tx.sunbedGroup.createManyAndReturn({
      data: unitless.map(() => ({ siteId })),
      select: { id: true },
    })
    await tx.$executeRaw`
      UPDATE "InventoryItem" i SET sunbed_group_id = v.gid, "updatedAt" = now()
      FROM (
        SELECT unnest(${unitless.map((s) => s.id)}::text[]) AS id,
               unnest(${units.map((u) => u.id)}::text[]) AS gid
      ) v
      WHERE i.id = v.id`
  })

  return { created: unitless.length }
}

/**
 * I1 audit: placed seats that still have no unit. Zero is the invariant; a
 * non-zero result names the offenders rather than just counting them, because
 * the useful question in the field is always "which ones".
 */
export async function findUnitlessPlacedSeats(siteId?: string) {
  return prisma.inventoryItem.findMany({
    where: {
      status: PLACED,
      sunbedGroupId: null,
      ...(siteId ? { siteId } : {}),
    },
    select: { id: true, siteId: true, number: true, seatLabel: true, status: true },
    orderBy: [{ siteId: 'asc' }, { number: 'asc' }],
  })
}

/**
 * Delete units that have no members left.
 *
 * Removing a BED is not removing the UNIT: deleting one seat of a pair must
 * leave the survivor in its unit (I1), and only the removal of the LAST member
 * ends the unit. Callers pass the units they touched; omitting `unitIds`
 * sweeps the whole site.
 *
 * An empty unit means the parasol was dismounted (founder, 2026-08-16): a
 * broken or seasonal bed is disabled/blocked instead of deleted, so it keeps
 * its row and its unit. Track 021 P5 adds the one guard this needs — a unit
 * with a DEVICE bound cannot be deleted at all — which is why every delete path
 * routes through here rather than inlining a count-and-delete.
 */
export async function pruneEmptyUnits(
  siteId: string,
  unitIds?: string[],
): Promise<{ deleted: number }> {
  if (unitIds && unitIds.length === 0) return { deleted: 0 }

  const result = await prisma.sunbedGroup.deleteMany({
    where: {
      siteId,
      ...(unitIds ? { id: { in: unitIds } } : {}),
      items: { none: {} },
    },
  })
  return { deleted: result.count }
}
