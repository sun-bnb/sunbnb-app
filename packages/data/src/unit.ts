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

// ─── Hardware guard (invariant I5) ──────────────────────────────────────────

export interface BlockingDevice {
  code: string
  location: string
}

/**
 * Devices that would be left pointing at nothing if these seats were deleted.
 *
 * Deleting every seat of a unit IS dismounting the parasol (Q5). If a device is
 * assigned to that spot, the deletion must be refused — unassign first, exactly
 * as you would unscrew the device before pulling the pole out. Without this the
 * device keeps polling an address that no longer resolves and sits amber, and
 * nothing in the UI explains why.
 *
 * A device stores an ADDRESS, not a unit id, so the check resolves each
 * about-to-be-emptied unit's address from the seats themselves: parcel from
 * `group`, row from the encoded `number`, ordinal from the unit row.
 *
 * Only units losing their LAST member block: removing one bed of a pair leaves
 * the spot standing, and the device with it.
 */
export async function devicesBlockingSeatRemoval(
  siteId: string,
  seatIds: string[],
): Promise<BlockingDevice[]> {
  if (seatIds.length === 0) return []

  const doomed = await prisma.inventoryItem.findMany({
    where: { id: { in: seatIds }, siteId, status: PLACED, sunbedGroupId: { not: null } },
    select: { id: true, group: true, number: true, sunbedGroupId: true },
  })
  if (doomed.length === 0) return []

  const unitIds = [...new Set(doomed.map((seat) => seat.sunbedGroupId as string))]
  const survivors = await prisma.inventoryItem.findMany({
    where: {
      sunbedGroupId: { in: unitIds },
      status: PLACED,
      id: { notIn: seatIds },
    },
    select: { sunbedGroupId: true },
  })
  const surviving = new Set(survivors.map((seat) => seat.sunbedGroupId as string))

  // Units that lose every placed member — i.e. spots being dismounted.
  const emptied = unitIds.filter((id) => !surviving.has(id))
  if (emptied.length === 0) return []

  const units = await prisma.sunbedGroup.findMany({
    where: { id: { in: emptied } },
    select: { id: true, seq: true },
  })
  const seqById = new Map(units.map((unit) => [unit.id, unit.seq]))

  const addresses = doomed
    .filter((seat) => emptied.includes(seat.sunbedGroupId as string))
    .map((seat) => ({
      parcel: seat.group,
      row: Math.floor(seat.number / 100) % 100,
      seq: seqById.get(seat.sunbedGroupId as string) ?? null,
    }))
    .filter((address): address is { parcel: number; row: number; seq: number } => address.seq !== null)

  if (addresses.length === 0) return []

  const devices = await prisma.device.findMany({
    where: {
      assignedSiteId: siteId,
      OR: addresses.map((address) => ({
        assignedParcel: address.parcel,
        assignedRow: address.row,
        assignedSeq: address.seq,
      })),
    },
    select: { code: true, assignedParcel: true, assignedRow: true, assignedSeq: true },
  })

  return devices.map((device) => ({
    code: device.code,
    location: `${device.assignedParcel}-${device.assignedRow}-${device.assignedSeq}`,
  }))
}

/** The refusal message every delete path shares, so they cannot word it differently. */
export function deviceRemovalError(blocking: BlockingDevice[]): string {
  const list = blocking.map((d) => `${d.code} (${d.location})`).join(', ')
  return `Cannot remove: ${blocking.length} device(s) are mounted at these spots — ${list}. Unassign them first.`
}
