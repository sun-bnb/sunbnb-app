'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { isValidItemStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
import { recomputeSeatLabels } from '@repo/data/seat-label-db'
import { pruneEmptyUnits } from '@repo/data/unit'
import { generateChairs } from './inventory/chair-util'

/** Founder decision (track 021 P2): a hand-placed unit is a PAIR by default. */
const DEFAULT_UNIT_MEMBERS = 2
/** Same intra-pair spacing the parcel generator uses for a paired row. */
const DEFAULT_INTRA_PAIR_GAP = 0.4

// ─── Create Inventory Item ──────────────────────────────────────────────────

/**
 * Create a seating UNIT (track 021 P2, founder decision 2026-08-16).
 *
 * Seats are never created loose: one click places a unit of TWO side-by-side
 * beds sharing a `SunbedGroup`, matching how a parcel pair is built (the offset
 * comes from the same `generateChairGrid` a parcel uses, so a hand-placed unit
 * and a generated one are geometrically identical). This is what replaced the
 * old pair/unpair actions — units are created, never assembled.
 *
 * `locationLat`/`locationLng` are optional: without them the seats land on the
 * sentinel origin and the caller places them, which is the pre-existing
 * create-then-place flow the schematic editor still uses.
 */
export async function createInventoryItem(inventoryItem: {
  siteId: string
  locationLat?: string
  locationLng?: string
  members?: number
}) {
  const { session, error } = await requireSiteOwner(inventoryItem.siteId)
  if (error) return { status: 'error', errors: [error] }

  // Track 020 P4: max(number)+1 was a read-then-write race — two concurrent
  // creates could mint the same seat number (no unique constraint exists to
  // catch it, so the duplicates were silent). A per-site advisory lock inside
  // the transaction serialises the read+write; the lock releases with the
  // transaction. hashtext() collisions across sites are harmless — worst case
  // two unrelated creates briefly queue.
  const item = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inventoryItem.siteId}))`
    const lastItem = await tx.inventoryItem.findFirst({
      where: { siteId: inventoryItem.siteId },
      orderBy: { number: 'desc' },
      select: { number: true },
    })
    // Track 021 P2 (I1): every PLACED seat belongs to exactly one unit, minted
    // in the SAME transaction as the seats — a seat that committed without its
    // unit would be an I1 violation nothing repairs.
    const unit = await tx.sunbedGroup.create({ data: { siteId: inventoryItem.siteId } })

    const baseLat = inventoryItem.locationLat ?? '0'
    const baseLng = inventoryItem.locationLng ?? '0'
    const memberCount = Math.max(1, inventoryItem.members ?? DEFAULT_UNIT_MEMBERS)
    const placed = baseLat !== '0' || baseLng !== '0'

    // Offsets from the SAME generator a parcel uses, so a hand-placed unit and
    // a generated pair are geometrically identical. Unplaced seats (the
    // create-then-place flow) all sit on the origin and are positioned later.
    const offsets = placed
      ? generateChairs({
          baseLat: Number(baseLat), baseLng: Number(baseLng),
          group: 0, rotation: 0, rows: 1, seatsPerRow: memberCount,
          horizontalGap: 0, verticalGap: 0, intraPairGap: DEFAULT_INTRA_PAIR_GAP,
          pairSeats: memberCount > 1,
        } as never).map((c) => ({ locationLat: c.locationLat, locationLng: c.locationLng }))
      : Array.from({ length: memberCount }, () => ({ locationLat: '0', locationLng: '0' }))

    const nextNumber = (lastItem?.number || 0) + 1
    await tx.inventoryItem.createMany({
      data: offsets.map((offset, i) => ({
        number: nextNumber + i,
        siteId: inventoryItem.siteId,
        userId: session.user.id,
        status: 'new',
        locationLat: offset.locationLat,
        locationLng: offset.locationLng,
        sunbedGroupId: unit.id,
      })),
    })
    return tx.inventoryItem.findFirstOrThrow({
      where: { siteId: inventoryItem.siteId, number: nextNumber },
    })
  })

  await recomputeSeatLabels(inventoryItem.siteId)
  revalidatePath('/sites')
  return { status: 'ok', item }
}

// ─── Delete Inventory Item ──────────────────────────────────────────────────

export async function deleteInventoryItem(id: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { siteId: true, site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const deletedSiteId = item.siteId

  // Load item to get its sunbedGroupId before deletion
  const itemForGroup = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { sunbedGroupId: true },
  })

  // Track 021 P2: deleting a BED is not deleting the UNIT. This used to detach
  // every sibling from the group first, so removing one seat of a pair left the
  // survivor unitless (violating I1) and destroyed a unit that still had a bed
  // standing in it — which, once devices bind to units, silently orphans the
  // device mounted there.
  await prisma.$transaction([
    // The legacy self-FK still bites until the column is dropped.
    prisma.inventoryItem.updateMany({ where: { pairId: id }, data: { pairId: null } }),
    prisma.inventoryItem.delete({ where: { id } }),
  ])

  // Only the removal of the LAST member ends the unit (outside the transaction
  // so the deletion is committed before emptiness is evaluated).
  if (itemForGroup?.sunbedGroupId) {
    const remaining = await prisma.inventoryItem.count({
      where: { sunbedGroupId: itemForGroup.sunbedGroupId },
    })
    if (remaining === 0) {
      await prisma.sunbedGroup.delete({ where: { id: itemForGroup.sunbedGroupId } })
    }
  }

  await recomputeSeatLabels(deletedSiteId)
  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Bulk Delete Inventory Items ────────────────────────────────────────────

/**
 * Set-based bulk delete (track 020 — founder-reported: deleting a parcel ran
 * one deleteInventoryItem PER SEAT, each with its own auth round-trip, its own
 * transaction and — the real killer — its own SITE-WIDE recomputeSeatLabels
 * (60 seats × a 4 400-item site = a minute of label recomputes).
 *
 * Semantics match the single delete, applied once for the whole selection:
 * SunbedGroups touched by any deleted seat are DISSOLVED (all members
 * detached, group rows removed), survivors' legacy pairId pointing at deleted
 * seats is cleared, then one deleteMany — all in one transaction — and ONE
 * label recompute at the end.
 */
export async function deleteInventoryItems(siteId: string, itemIds: string[]) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }
  if (itemIds.length === 0) return { status: 'ok' }

  // Scope to the site — ids from other sites are silently ignored, same
  // boundary the single delete enforced via its ownership check.
  const rows = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: { id: true, sunbedGroupId: true },
  })
  if (rows.length === 0) return { status: 'ok' }

  const ids = rows.map((r) => r.id)
  const groupIds = [...new Set(rows.map((r) => r.sunbedGroupId).filter(Boolean))] as string[]

  // Track 021 P2: delete the SELECTED beds only. Detaching every sibling first
  // (as this did) left survivors unitless — an I1 violation — and destroyed
  // units that still had beds standing in them.
  await prisma.$transaction([
    // The legacy self-FK still bites until the column is dropped.
    prisma.inventoryItem.updateMany({
      where: { pairId: { in: ids } },
      data: { pairId: null },
    }),
    prisma.inventoryItem.deleteMany({ where: { id: { in: ids }, siteId } }),
  ])

  // Units that lost their LAST member end here; units that kept a bed survive
  // with their identity intact.
  await pruneEmptyUnits(siteId, groupIds)

  await recomputeSeatLabels(siteId)
  revalidatePath('/sites')
  return { status: 'ok', deleted: ids.length }
}

// ─── Update Item Location ───────────────────────────────────────────────────

export async function saveInventoryItemLocation(
  id: string,
  inventoryItem: { locationLat: string; locationLng: string }
) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  await prisma.inventoryItem.update({
    where: { id },
    data: {
      status: 'active',
      locationLat: inventoryItem.locationLat,
      locationLng: inventoryItem.locationLng,
    },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Update Item Schematic Location ─────────────────────────────────────────

export async function saveInventoryItemSchematicLocation(
  id: string,
  x: number,
  y: number,
) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { status: 'error', errors: ['Invalid coordinates'] }
  }
  if (x < -10000 || x > 10000 || y < -10000 || y > 10000) {
    return { status: 'error', errors: ['Coordinates out of range'] }
  }

  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  await prisma.inventoryItem.update({
    where: { id },
    data: {
      status: 'active',
      schematicX: x,
      schematicY: y,
    },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Update Item Properties ─────────────────────────────────────────────────

export async function saveInventoryItemProperties(
  id: string,
  inventoryItem: {
    category?: string
    price?: number
    rotation?: number
    number?: number
    group?: number
    label?: string
    pairId?: string
    status?: string
  }
) {
  // Input validation
  if (inventoryItem.label !== undefined && typeof inventoryItem.label === 'string' && inventoryItem.label.length > 100) {
    return { status: 'error', errors: ['Label is too long (max 100)'] }
  }
  if (inventoryItem.category !== undefined && typeof inventoryItem.category === 'string' && inventoryItem.category.length > 50) {
    return { status: 'error', errors: ['Category is too long (max 50)'] }
  }
  if (inventoryItem.price !== undefined && inventoryItem.price !== null && (isNaN(Number(inventoryItem.price)) || Number(inventoryItem.price) < 0 || Number(inventoryItem.price) > 100000)) {
    return { status: 'error', errors: ['Price must be 0–100,000'] }
  }
  if (inventoryItem.rotation !== undefined && inventoryItem.rotation !== null && (isNaN(Number(inventoryItem.rotation)) || Number(inventoryItem.rotation) < 0 || Number(inventoryItem.rotation) > 360)) {
    return { status: 'error', errors: ['Rotation must be 0–360'] }
  }
  if (inventoryItem.number !== undefined && inventoryItem.number !== null && (isNaN(Number(inventoryItem.number)) || Number(inventoryItem.number) < 0 || Number(inventoryItem.number) > 99999)) {
    return { status: 'error', errors: ['Item number must be 0–99,999'] }
  }
  if (inventoryItem.group !== undefined && inventoryItem.group !== null && (isNaN(Number(inventoryItem.group)) || Number(inventoryItem.group) < 0 || Number(inventoryItem.group) > 9999)) {
    return { status: 'error', errors: ['Group must be 0–9,999'] }
  }
  if (inventoryItem.status !== undefined && !isValidItemStatus(inventoryItem.status)) {
    return { status: 'error', errors: ['Invalid item status'] }
  }

  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { siteId: true, site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const itemSiteId = item.siteId

  const pairItem = inventoryItem.pairId
    ? await prisma.inventoryItem.findUnique({ where: { id: inventoryItem.pairId }, select: { id: true, siteId: true } })
    : undefined

  if (pairItem) {
    // Verify the pair item belongs to the same site
    if (pairItem.siteId !== itemSiteId) {
      return { status: 'error', errors: ['Pair item must belong to the same site'] }
    }
  }

  await prisma.inventoryItem.update({
    where: { id },
    data: {
      category: inventoryItem.category,
      price: inventoryItem.price,
      rotation: inventoryItem.rotation,
      number: inventoryItem.number,
      group: inventoryItem.group,
      label: inventoryItem.label,
      status: inventoryItem.status,
      // Track 021 P1: the legacy `pair` relation is NOT connected any more —
      // connecting it writes pair_id just as surely as assigning the column.
      // The SunbedGroup below is the pairing.
    },
  })

  // A pairing request creates/assigns the 2-member SunbedGroup — the single
  // representation of "these two seats are one unit".
  if (pairItem && inventoryItem.pairId) {
    // Fetch current sunbedGroupIds for both items
    const [currentItem, currentPair] = await Promise.all([
      prisma.inventoryItem.findUnique({ where: { id }, select: { sunbedGroupId: true } }),
      prisma.inventoryItem.findUnique({ where: { id: inventoryItem.pairId }, select: { sunbedGroupId: true } }),
    ])

    // Detach both from any prior groups and delete groups that become empty
    const priorGroupIds = new Set(
      [currentItem?.sunbedGroupId, currentPair?.sunbedGroupId].filter(Boolean) as string[]
    )
    if (priorGroupIds.size > 0) {
      await prisma.inventoryItem.updateMany({
        where: { sunbedGroupId: { in: [...priorGroupIds] } },
        data: { sunbedGroupId: null },
      })
      for (const gid of priorGroupIds) {
        const cnt = await prisma.inventoryItem.count({ where: { sunbedGroupId: gid } })
        if (cnt === 0) await prisma.sunbedGroup.delete({ where: { id: gid } })
      }
    }

    const newGroup = await prisma.sunbedGroup.create({
      data: {
        siteId: itemSiteId,
        items: { connect: [{ id }, { id: inventoryItem.pairId }] },
      },
    })
    // Explicitly set sunbedGroupId on both items (connect above sets it via relation)
    await prisma.inventoryItem.updateMany({
      where: { id: { in: [id, inventoryItem.pairId] } },
      data: { sunbedGroupId: newGroup.id },
    })
  }

  await recomputeSeatLabels(itemSiteId)
  revalidatePath('/sites')
  return { status: 'ok' }
}

// Track 021 P2: pairInventoryItems / depairInventoryItem removed. Seats are
// created as UNITS (a hand-placed unit is a pair) and never assembled from or
// split into loose beds — a mis-grouped unit is deleted and placed again.

export async function deleteItemsByGroup(siteId: string, group: number) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  // Track 021 P2: capture the units first — after the seats are gone there is
  // nothing left pointing at them, and they would linger as empty rows forever.
  const unitIds = [
    ...new Set(
      (
        await prisma.inventoryItem.findMany({
          where: { siteId, group },
          select: { sunbedGroupId: true },
        })
      )
        .map((i) => i.sunbedGroupId)
        .filter(Boolean) as string[],
    ),
  ]

  await prisma.inventoryItem.deleteMany({
    where: { siteId, group },
  })

  await pruneEmptyUnits(siteId, unitIds)

  // Track 020 P4: this was the ONLY bulk mutation that skipped the label
  // recompute — surviving parcels kept stale seat labels after a parcel
  // delete.
  await recomputeSeatLabels(siteId)

  revalidatePath(`/sites/${siteId}/inventory`)
  return { status: 'ok' }
}
