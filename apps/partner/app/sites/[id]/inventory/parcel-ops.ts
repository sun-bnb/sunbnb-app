'use server'

/**
 * Server-side parcel compositions (track 030 S1b).
 *
 * Rotating a complete parcel, re-configuring a parcel and rotating a unit used
 * to be composed IN THE BROWSER (inventory/view.tsx, schematic/view.tsx,
 * ParcelForm.tsx, useSunbedEditing.ts): read the ItemGroup, rebuild a
 * ChairConfig, call syncChairsWithLayout / rotateSelection. An AI agent runs
 * server-side and cannot do that, so the composition lives here and BOTH the
 * editors and the agent call it — one implementation, identical geometry.
 *
 * Rules every action here follows:
 *  - `requireSiteOwner(siteId)` first (sudo bypass included).
 *  - Every id / group number is resolved WITHIN `siteId`; a foreign or unknown
 *    one is an error, never a cross-site write.
 *  - The config is rebuilt from the DB, never taken from the client — the
 *    caller supplies only a delta / an editable patch.
 *  - Geometry is delegated to the existing actions (syncChairsWithLayout,
 *    rotateSelection), so seat labels (recomputeSeatLabels), units and the
 *    centroid-preserving rearrange behave exactly as before.
 *
 * This file may export async functions only; pure helpers are in parcel-config.ts.
 */

import { revalidatePath } from 'next/cache'
import prisma from '@repo/data/PrismaCient'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { syncChairsWithLayout, rotateSelection } from './actions'
import {
  buildParcelConfig,
  configFromItemGroup,
  parcelIsPaired,
  validatePatch,
  type LayoutMode,
  type ParcelConfigPatch,
} from './parcel-config'

export type ParcelOpResult = {
  status: 'ok' | 'error'
  errors?: string[]
  /** Ids of the parcel's / unit's seats after the operation (for scoped refresh). */
  changedItemIds?: string[]
}

const fail = (message: string): ParcelOpResult => ({ status: 'error', errors: [message] })

const SEAT_SELECT = {
  id: true,
  number: true,
  rotation: true,
  itemGroupId: true,
  sunbedGroupId: true,
  locationLat: true,
  locationLng: true,
  schematicX: true,
  schematicY: true,
} as const

/**
 * Resolve a parcel WITHIN the site. `group` is the parcel number (number) or an
 * ItemGroup id (string). Pool seats are excluded — they carry sentinel
 * coordinates and are not part of the parcel's geometry.
 */
async function resolveParcel(siteId: string, group: number | string) {
  const isId = typeof group === 'string'
  if (!isId && (!Number.isInteger(group) || group < 1)) return null
  if (isId && group.length === 0) return null

  const seats = await prisma.inventoryItem.findMany({
    where: {
      siteId,
      status: { not: 'pool' },
      ...(isId ? { itemGroupId: group } : { group }),
    },
    select: SEAT_SELECT,
    orderBy: { number: 'asc' },
  })
  if (seats.length === 0) return null

  const itemGroupId = seats.find((s) => s.itemGroupId)?.itemGroupId ?? null
  const itemGroup = itemGroupId
    ? await prisma.itemGroup.findUnique({ where: { id: itemGroupId } })
    : null
  const number = itemGroup?.number ?? (isId ? null : group)
  if (number === null || number === undefined) return null

  const layout = await prisma.site.findUnique({
    where: { id: siteId },
    select: { layoutMode: true },
  })
  const layoutMode: LayoutMode = layout?.layoutMode === 'schematic' ? 'schematic' : 'geo'

  return { number, seats, itemGroup, layoutMode }
}

async function parcelSeatIds(siteId: string, group: number): Promise<string[]> {
  const rows = await prisma.inventoryItem.findMany({
    where: { siteId, group, status: { not: 'pool' } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * Rotate a COMPLETE parcel by `deltaDegrees`: regenerates the grid at the new
 * rotation around the preserved centroid (what the editor's rotate buttons did
 * when the whole parcel was selected). A parcel with no ItemGroup record falls
 * back to rotating its seats as a selection.
 */
export async function rotateParcel(
  siteId: string,
  group: number | string,
  deltaDegrees: number,
): Promise<ParcelOpResult> {
  const { error } = await requireSiteOwner(siteId)
  if (error) return fail(error)
  if (typeof deltaDegrees !== 'number' || !Number.isFinite(deltaDegrees)) {
    return fail('deltaDegrees must be a finite number')
  }
  const delta = Math.round(deltaDegrees)

  const parcel = await resolveParcel(siteId, group)
  if (!parcel) return fail('Parcel not found')

  let result: { status?: string; errors?: string[] } | undefined
  if (parcel.itemGroup) {
    // Real pairing from the units, NOT pairGap > 0 (an unpaired parcel keeps a non-zero pairGap).
    const base = configFromItemGroup(
      parcel.itemGroup,
      parcel.seats.length,
      parcel.layoutMode,
      parcelIsPaired(parcel.seats, parcel.itemGroup.pairGap),
    )
    result = await syncChairsWithLayout(
      siteId,
      { ...base, rotation: base.rotation + delta },
      'rearrange',
    )
  } else {
    result = await rotateSelection(siteId, parcel.seats.map((s) => s.id), delta)
  }
  if (result?.status === 'error') return { status: 'error', errors: result.errors }

  revalidatePath('/sites')
  return { status: 'ok', changedItemIds: await parcelSeatIds(siteId, parcel.number) }
}

/**
 * Re-apply a parcel's configuration: rows, seats per row, gaps, pairing,
 * rotation, category, price. Fields not in `patch` keep their stored value, so
 * an EMPTY patch is "restore order" (re-lay the seats on the stored config).
 * Growing/shrinking follows syncChairsWithLayout's resize rules (existing
 * spots keep their ids; a shrink over booked seats is refused).
 */
export async function applyParcelConfig(
  siteId: string,
  group: number | string,
  patch: ParcelConfigPatch = {},
): Promise<ParcelOpResult> {
  const { error } = await requireSiteOwner(siteId)
  if (error) return fail(error)
  if (typeof patch !== 'object' || patch === null) return fail('patch must be an object')
  const invalid = validatePatch(patch)
  if (invalid) return fail(invalid)

  const parcel = await resolveParcel(siteId, group)
  if (!parcel) return fail('Parcel not found')

  const { config } = buildParcelConfig({
    number: parcel.number,
    itemGroup: parcel.itemGroup,
    seats: parcel.seats,
    layoutMode: parcel.layoutMode,
    patch,
  })

  const result = await syncChairsWithLayout(siteId, config, 'rearrange')
  if (result?.status === 'error') return { status: 'error', errors: result.errors }

  revalidatePath('/sites')
  return { status: 'ok', changedItemIds: await parcelSeatIds(siteId, parcel.number) }
}

/**
 * Rotate one sunbed UNIT: every member of the item's SunbedGroup orbits the
 * unit's centroid together (rotateSelection); a loose seat just turns in place,
 * normalised into [0, 360). Members are resolved from the DB, not the client.
 */
export async function rotateUnit(
  siteId: string,
  itemId: string,
  deltaDegrees: number,
): Promise<ParcelOpResult> {
  const { error } = await requireSiteOwner(siteId)
  if (error) return fail(error)
  if (typeof deltaDegrees !== 'number' || !Number.isFinite(deltaDegrees)) {
    return fail('deltaDegrees must be a finite number')
  }
  const delta = Math.round(deltaDegrees)

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, siteId },
    select: { id: true, rotation: true, sunbedGroupId: true },
  })
  if (!item) return fail('Item not found')

  const members = item.sunbedGroupId
    ? await prisma.inventoryItem.findMany({
        where: { sunbedGroupId: item.sunbedGroupId, siteId, status: { not: 'pool' } },
        select: { id: true },
        orderBy: { number: 'asc' },
      })
    : []
  const ids = members.length > 1 ? members.map((m) => m.id) : [item.id]

  if (ids.length > 1) {
    const result = await rotateSelection(siteId, ids, delta)
    if (result?.status === 'error') return { status: 'error', errors: result.errors }
  } else {
    // Single seat: turn in place. Written directly (not via
    // saveInventoryItemProperties, whose id-only owner check has no sudo
    // bypass) — the item is already proven to belong to `siteId` above.
    const rotation = ((((item.rotation ?? 0) + delta) % 360) + 360) % 360
    await prisma.inventoryItem.update({ where: { id: item.id }, data: { rotation } })
  }

  revalidatePath('/sites')
  return { status: 'ok', changedItemIds: ids }
}

/**
 * Set the status (`active` | `disabled`) of a set of seats. Site-scoped and sudo-aware
 * (`requireSiteOwner`), unlike the id-only `setItemStatusByGroup` / `saveInventoryItemProperties`.
 * `pool` is deliberately not settable here: pool seats are unplaced extras with their own lifecycle.
 * Ids outside the site are ignored (never written).
 */
export async function setSeatsStatus(
  siteId: string,
  itemIds: string[],
  status: string,
): Promise<ParcelOpResult> {
  const { error } = await requireSiteOwner(siteId)
  if (error) return fail(error)
  if (status !== 'active' && status !== 'disabled') return fail('status must be active or disabled')
  if (!Array.isArray(itemIds) || itemIds.some((id) => typeof id !== 'string')) return fail('itemIds must be a list of ids')
  if (itemIds.length === 0) return { status: 'ok', changedItemIds: [] }

  await prisma.inventoryItem.updateMany({
    where: { id: { in: itemIds }, siteId, status: { not: 'pool' } },
    data: { status },
  })
  revalidatePath('/sites')
  return { status: 'ok', changedItemIds: itemIds }
}
