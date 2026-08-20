/**
 * Pure click-to-select logic for the sunbed reservation flow, shared by the
 * geo map (`SunbedSelection`) and the schematic canvas (`SchematicSelection`)
 * so the two surfaces cannot drift apart on what a click means.
 *
 * Two policies, chosen per site by `Site.partialGroupBookingEnabled`:
 *
 * - **Whole-unit (default).** A click moves the entire SunbedGroup — the beds
 *   standing together under one parasol. You get the unit or you get nothing.
 * - **Partial.** The FIRST click on an untouched unit still takes the whole
 *   unit (the common case is still "a parasol for two", and it keeps the
 *   flag from making every booking a per-seat chore). Once a unit holds a
 *   selected seat, clicks toggle seats one at a time, so a guest can drop the
 *   seats they don't want — down to a single bed — or add them back.
 *   Deselecting the last seat returns the unit to untouched, so the next click
 *   takes the whole unit again.
 */
import type { InventoryItem } from '@/app/sites/types'

/** Resolve an inventory row by id — the group's own members are id-only stubs. */
export type SeatLookup = (id: string) => InventoryItem | undefined

export interface SeatSelectionOptions {
  /** `Site.partialGroupBookingEnabled` — false means whole-unit only. */
  partialGroupBooking: boolean
  /** Availability for the requested date range, as the surface already computes it. */
  isAvailable: (item: InventoryItem) => boolean
  /** Optional id → full row lookup; without it, siblings enter the selection as stubs. */
  resolveItem?: SeatLookup
}

/**
 * The seats of the clicked seat's unit, as full rows where they can be
 * resolved. A seat with no SunbedGroup is its own unit.
 */
function unitMembers(item: InventoryItem, resolveItem?: SeatLookup): InventoryItem[] {
  const memberIds = item.sunbedGroup?.items?.length
    ? item.sunbedGroup.items.map(m => m.id)
    : [item.id]

  return memberIds.map(id => {
    if (id === item.id) return item
    // Falling back to an id-only stub keeps a member that is missing from the
    // loaded inventory selectable — downstream only ever reads `.id`.
    return resolveItem?.(id) ?? ({ id } as InventoryItem)
  })
}

/**
 * Apply a seat click to the current selection and return the new selection.
 * Returns the input array unchanged when the seat cannot be booked, so a
 * caller can skip the dispatch.
 */
export function toggleSeatSelection(
  item: InventoryItem,
  selectedItems: InventoryItem[] | undefined,
  { partialGroupBooking, isAvailable, resolveItem }: SeatSelectionOptions,
): InventoryItem[] {
  const selected = selectedItems ?? []
  if (!isAvailable(item)) return selected

  const members = unitMembers(item, resolveItem)
  const selectedIds = new Set(selected.map(s => s.id))
  const clickedSelected = selectedIds.has(item.id)
  const unitTouched = members.some(m => selectedIds.has(m.id))

  // Whole-unit move: always under the default policy, and under the partial
  // policy for the first click on a unit nobody has touched yet.
  if (!partialGroupBooking || !unitTouched) {
    if (clickedSelected) {
      const removeIds = new Set(members.map(m => m.id))
      return selected.filter(s => !removeIds.has(s.id))
    }
    // Only AVAILABLE members join. A unit can be partly booked — by a partial
    // booking, or by the venue blocking one bed from the manage grid — and
    // adding a seat somebody else holds only earns a server-side rejection of
    // the whole reservation.
    const additions = members.filter(m => !selectedIds.has(m.id) && isAvailable(m))
    return additions.length ? [...selected, ...additions] : selected
  }

  // Partial policy on a unit that is already in play: one seat at a time.
  return clickedSelected
    ? selected.filter(s => s.id !== item.id)
    : [...selected, item]
}
