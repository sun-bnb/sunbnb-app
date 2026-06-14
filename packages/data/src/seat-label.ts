/**
 * Seat-label computation for InventoryItems.
 *
 * Label format: `{parcel}-{row}{groupSeq:02}-{member}`
 *   e.g.  2-302-1  = parcel 2, row 3, 2nd unit in that row, member 1
 *
 * Decoding `InventoryItem.number` (an encoded Int):
 *   parcel  = Math.floor(number / 10000)   — matches item.group
 *   row     = Math.floor(number / 100) % 100
 *   seatIdx = number % 100                 — left→right order within the row
 *
 * A "unit" within a (parcel, row) bucket is:
 *   - A SunbedGroup (sunbedGroupId is non-null): all members sharing the same groupId
 *   - A singleton: an ungrouped item (sunbedGroupId === null), treated as its own unit
 *
 * Units are ordered by their minimum seatIdx (left→right). Within a unit,
 * members are ordered by seatIdx. The resulting ordinal position gives
 * groupSeq (1-based, zero-padded to 2 digits) and member (1-based).
 */

import prisma from '../index'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeatLabelItem {
  id: string
  number: number
  group: number
  sunbedGroupId: string | null
}

// ---------------------------------------------------------------------------
// Pure compute
// ---------------------------------------------------------------------------

/**
 * Compute seat labels for a collection of inventory items.
 * Pure function — no DB access.
 *
 * @returns Map<itemId, label>
 */
export function computeSeatLabels(items: SeatLabelItem[]): Map<string, string> {
  // kb: decision — using item.group as the parcel rather than re-deriving
  // Math.floor(number/10000) because group IS the parcel and is already
  // available on the item record; no risk of disagreement if number encoding
  // ever changes.

  // 1. Bucket items by (parcel, row)
  type BucketKey = `${number}:${number}`
  const buckets = new Map<BucketKey, SeatLabelItem[]>()

  for (const item of items) {
    const parcel = item.group
    const row = Math.floor(item.number / 100) % 100
    const key: BucketKey = `${parcel}:${row}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(item)
  }

  const result = new Map<string, string>()

  for (const [key, bucketItems] of buckets) {
    const [parcelStr, rowStr] = key.split(':')
    const parcel = Number(parcelStr)
    const row = Number(rowStr)

    // 2. Group items into units within this bucket.
    // kb: decision — singleton ungrouped items use the item.id as unit key so
    // that each ungrouped seat gets its own sequential groupSeq slot. Using a
    // common sentinel like 'null' would collapse all ungrouped seats in a row
    // into one unit, which is wrong: they may be physically separate chairs.
    type UnitKey = string
    const unitMap = new Map<UnitKey, SeatLabelItem[]>()

    for (const item of bucketItems) {
      const unitKey: UnitKey = item.sunbedGroupId ?? `__solo_${item.id}`
      if (!unitMap.has(unitKey)) unitMap.set(unitKey, [])
      unitMap.get(unitKey)!.push(item)
    }

    // 3. Order units by minimum seatIdx (left→right).
    // kb: decision — min-seatIdx ordering is robust to non-contiguous group
    // members (e.g. group A occupies seats 1,3 and group B occupies seats 2,4
    // in the same row). A run-based approach would split such groups. Min-seatIdx
    // always picks one canonical representative per unit regardless of layout.
    const seatIdx = (item: SeatLabelItem) => item.number % 100
    const units = Array.from(unitMap.entries()).sort(([, aItems], [, bItems]) => {
      const aMin = Math.min(...aItems.map(seatIdx))
      const bMin = Math.min(...bItems.map(seatIdx))
      return aMin - bMin
    })

    // 4. Assign groupSeq + member
    for (let i = 0; i < units.length; i++) {
      const groupSeq = i + 1 // 1-based
      const [, members] = units[i]!
      // Order members left→right by seatIdx
      const sortedMembers = [...members].sort((a, b) => seatIdx(a) - seatIdx(b))
      for (let j = 0; j < sortedMembers.length; j++) {
        const member = j + 1 // 1-based
        const label = `${parcel}-${row}${String(groupSeq).padStart(2, '0')}-${member}`
        result.set(sortedMembers[j]!.id, label)
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Format helper
// ---------------------------------------------------------------------------

/**
 * Format a stored seatLabel for display.
 *
 * @param label   The stored seatLabel value (may be null / empty string).
 * @param options `parcel: false` strips the leading "{parcel}-" segment so only
 *                the within-parcel portion is shown (e.g. "302-1" instead of
 *                "2-302-1"). Defaults to `true` (full label).
 * @returns Formatted string, or '' if label is null/empty.
 */
export function formatSeatLabel(
  label: string | null | undefined,
  options: { parcel?: boolean } = {},
): string {
  if (!label) return ''
  const { parcel = true } = options
  if (parcel) return label
  // Strip the first segment: everything up to and including the first '-'
  const dashIdx = label.indexOf('-')
  return dashIdx === -1 ? label : label.slice(dashIdx + 1)
}

/**
 * Display formatter for a seat: prefer the structured `seatLabel`, falling back
 * to the legacy zero-padded `number` when a seat has no label yet (e.g. created
 * by old code before a recompute). Use this at every place a seat number is
 * shown to a user. `parcel: false` omits the leading "{parcel}-" segment.
 */
export function formatSeat(
  item: { seatLabel?: string | null; number: number },
  options: { parcel?: boolean } = {},
): string {
  if (item.seatLabel) return formatSeatLabel(item.seatLabel, options)
  return String(item.number).padStart(4, '0')
}

// ---------------------------------------------------------------------------
// DB-dependent helpers
// ---------------------------------------------------------------------------

/**
 * Recompute seat labels for all inventory items belonging to a site and
 * persist any that have changed.
 *
 * Idempotent: items whose computed label already matches what is stored are
 * skipped. Returns the number of items updated.
 */
export async function recomputeSeatLabels(siteId: string): Promise<number> {
  const items = await prisma.inventoryItem.findMany({
    where: { siteId },
    select: {
      id: true,
      number: true,
      group: true,
      sunbedGroupId: true,
      seatLabel: true,
    },
  })

  const computed = computeSeatLabels(items)

  const updates: Array<{ id: string; label: string }> = []
  for (const item of items) {
    const newLabel = computed.get(item.id) ?? null
    if (newLabel !== null && newLabel !== item.seatLabel) {
      updates.push({ id: item.id, label: newLabel })
    }
  }

  if (updates.length === 0) return 0

  await prisma.$transaction(
    updates.map(({ id, label }) =>
      prisma.inventoryItem.update({
        where: { id },
        data: { seatLabel: label },
      }),
    ),
  )

  return updates.length
}

/**
 * Backfill seat labels for every site in the system.
 * Intended for one-time data migration after Phase 1 ships.
 *
 * @returns Total number of inventory items updated across all sites.
 */
export async function backfillAllSeatLabels(): Promise<number> {
  const sites = await prisma.site.findMany({ select: { id: true } })
  let total = 0
  for (const site of sites) {
    total += await recomputeSeatLabels(site.id)
  }
  return total
}
