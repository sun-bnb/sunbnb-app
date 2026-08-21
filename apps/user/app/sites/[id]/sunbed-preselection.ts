/**
 * Pure unit-selection helpers for the sunbed reservation flow.
 * Extracted from SunbedSelection.tsx so they can be imported and unit-tested
 * without pulling in Google Maps, MUI, or other client-only dependencies.
 */
import type { InventoryItem } from '@/app/sites/types'

/**
 * Resolve a full "selection set" starting from a single inventory item: booking
 * one seat of a unit books the unit.
 *
 * Returns the item itself plus its fellow unit members, looked up by id from the
 * full inventory list so the returned objects carry all fields.
 */
export function resolveSelectionSet(
  item: InventoryItem,
  inventoryItems: InventoryItem[],
): InventoryItem[] {
  const byId = (id: string) => inventoryItems.find((i) => i.id === id)

  if (item.sunbedGroup?.items?.length) {
    const members = item.sunbedGroup.items
      .map((m) => byId(m.id))
      .filter((m): m is InventoryItem => m !== undefined)
    return members.length ? members : [item]
  }

  // A seat with no unit stands alone. Track 021 retired the legacy
  // pair/pairedBy self-relation that used to provide a second answer here.
  return [item]
}

/**
 * Pick the first available item in availability-list order, then resolve the
 * full selection set (its unit). Returns [] when nothing is available.
 *
 * Unit members that are NOT available are dropped: a unit can be partly booked
 * — by a partial-group booking, or by the venue blocking one bed from the
 * manage grid — and preselecting a seat somebody else holds puts the flow in a
 * state the server rejects the moment the guest presses Reserve.
 *
 * @param availabilityList   - ordered array from the availability API response
 * @param inventoryItems     - full item list (carry unit fields + coordinates)
 */
export function pickFirstAvailablePair(
  availabilityList: { itemId: string; available: boolean }[],
  inventoryItems: InventoryItem[],
): InventoryItem[] {
  const byId = (id: string) => inventoryItems.find((i) => i.id === id)
  const availableIds = new Set(
    availabilityList.filter((a) => a.available).map((a) => a.itemId),
  )

  for (const entry of availabilityList) {
    if (!entry.available) continue
    const item = byId(entry.itemId)
    if (!item) continue
    // Never empty: the seat we picked is itself available.
    return resolveSelectionSet(item, inventoryItems).filter((i) =>
      availableIds.has(i.id),
    )
  }

  return []
}

/**
 * Where the map should OPEN: a real seat near the middle of the inventory.
 *
 * The naive answer — the bounding-box centre of all seats — is only on the sand
 * when the inventory is compact. A beach that CURVES (Alcúdia: 43 parcels along
 * a 2.8 km bay) puts its bounding-box centre in the water, and the map then
 * opens at seat-level zoom over open sea with every seat culled out of view.
 * Anchoring on the seat nearest that centre keeps the "middle of the site"
 * intent, but lands on a bed that exists.
 *
 * Pure so it can be tested against exactly that shape of inventory.
 */
export function inventoryAnchor(
  items: { locationLat?: string; locationLng?: string }[],
): { lat: number; lng: number } | null {
  const placed = items
    .map((i) => ({ lat: Number(i.locationLat), lng: Number(i.locationLng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (placed.length === 0) return null

  const lats = placed.map((p) => p.lat)
  const lngs = placed.map((p) => p.lng)
  const centre = {
    lat: (Math.max(...lats) + Math.min(...lats)) / 2,
    lng: (Math.max(...lngs) + Math.min(...lngs)) / 2,
  }

  let best = placed[0]!
  let bestD = Infinity
  for (const p of placed) {
    // Squared equirectangular distance — ranking only, no need for haversine.
    const dLat = p.lat - centre.lat
    const dLng = (p.lng - centre.lng) * Math.cos((centre.lat * Math.PI) / 180)
    const d = dLat * dLat + dLng * dLng
    if (d < bestD) { bestD = d; best = p }
  }
  return { lat: best.lat, lng: best.lng }
}
