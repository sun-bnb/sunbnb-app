/**
 * Pure rules for picking seats on the POS (QR) page, kept out of the view so
 * they can be tested without a DOM, a map, or a payment provider.
 *
 * The POS page is the guest standing AT the unit with their phone. That is why
 * its picking rule differs from the online map's (`../../seat-selection.ts`):
 * here the whole unit starts selected — it is what they walked up to — and a
 * click is only ever about the bed they tapped. On the map, where nothing is
 * selected yet, the first click on a unit takes all of it.
 */
import type { InventoryItem, SiteProps } from '@/app/sites/types'

/**
 * Whether the guest is offered a choice of beds at all: the site must allow
 * partial group booking AND the unit must hold more than one bed. A lone bed
 * has nothing to pick — offering a toggle there only lets a guest deselect the
 * one thing they came to book.
 */
export function canPickSeats(site: SiteProps, unitItems: InventoryItem[]): boolean {
  return (site.partialGroupBookingEnabled ?? false) && unitItems.length > 1
}

/**
 * The selection the page opens with: every bed of the unit that is actually
 * free. A bed somebody else holds is never preselected — it would put the
 * guest in a state the server rejects at Reserve.
 */
export function initialSeatSelection(
  unitItems: InventoryItem[],
  availableItemIds: string[],
): string[] {
  const available = new Set(availableItemIds)
  return unitItems.filter(item => available.has(item.id)).map(item => item.id)
}

/** Add or remove one bed. Order is preserved so the selection stays stable. */
export function toggleSeatId(selectedIds: string[], itemId: string): string[] {
  return selectedIds.includes(itemId)
    ? selectedIds.filter(id => id !== itemId)
    : [...selectedIds, itemId]
}

/**
 * What one bed costs. Mirrors the server's rule in
 * `saveReservationForMultipleItems` — a seat with no price of its own is sold
 * at the site price — so the number on the button is the number charged.
 */
export function seatPrice(item: InventoryItem, sitePrice?: number | null): number {
  return (item.price ?? null) || sitePrice || 0
}

/** What the current pick costs. Zero seats picked is zero, not the unit price. */
export function selectionPrice(
  selectedItems: InventoryItem[],
  sitePrice?: number | null,
): number {
  return selectedItems.reduce((sum, item) => sum + seatPrice(item, sitePrice), 0)
}

/**
 * Whether the unit can be sold at all right now.
 *
 * With per-seat picking a unit is sellable while ANY bed is free — the guest
 * chooses which. Without it the unit is all-or-nothing: one taken bed makes the
 * whole parasol unbookable, which is what "you get the unit or nothing" means.
 */
export function unitIsSellable(
  unitItems: InventoryItem[],
  availableItemIds: string[],
  picking: boolean,
): boolean {
  const available = new Set(availableItemIds)
  return picking
    ? unitItems.some(item => available.has(item.id))
    : unitItems.length > 0 && unitItems.every(item => available.has(item.id))
}
