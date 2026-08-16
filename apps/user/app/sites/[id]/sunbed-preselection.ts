/**
 * Pure pair/group preselection helpers for the sunbed reservation flow.
 * Extracted from SunbedSelection.tsx so they can be imported and unit-tested
 * without pulling in Google Maps, MUI, or other client-only dependencies.
 */
import type { InventoryItem } from '@/app/sites/types'

/**
 * Resolve a full "selection set" starting from a single inventory item.
 * Walks BOTH pair directions (pair and pairedBy are one-directional — only the
 * primary holds the pointer forward; the secondary holds a back-pointer via
 * pairedBy). SunbedGroup membership supersedes bare pair pointers.
 *
 * Returns the item itself plus any group/pair partner, looked up by id from
 * the full inventory list so the returned objects carry all fields.
 */
export function resolveSelectionSet(
  item: InventoryItem,
  inventoryItems: InventoryItem[],
): InventoryItem[] {
  const byId = (id: string) => inventoryItems.find((i) => i.id === id)

  // SunbedGroup takes precedence over bare pair pointers.
  if (item.sunbedGroup?.items?.length) {
    const members = item.sunbedGroup.items
      .map((m) => byId(m.id))
      .filter((m): m is InventoryItem => m !== undefined)
    return members.length ? members : [item]
  }

  // Track 021 P1: SunbedGroup is the only pairing representation — the legacy
  // pair/pairedBy self-relation is retired (no row in any environment carried
  // a pairId without a group, so this fallback was unreachable).
  return [item]
}

/**
 * Pick the first available item in availability-list order, then resolve the
 * full selection set (pair/group). Returns [] when nothing is available.
 *
 * @param availabilityList   - ordered array from the availability API response
 * @param inventoryItems     - full item list (carry pair fields + coordinates)
 */
export function pickFirstAvailablePair(
  availabilityList: { itemId: string; available: boolean }[],
  inventoryItems: InventoryItem[],
): InventoryItem[] {
  const byId = (id: string) => inventoryItems.find((i) => i.id === id)

  for (const entry of availabilityList) {
    if (!entry.available) continue
    const item = byId(entry.itemId)
    if (!item) continue
    return resolveSelectionSet(item, inventoryItems)
  }

  return []
}
