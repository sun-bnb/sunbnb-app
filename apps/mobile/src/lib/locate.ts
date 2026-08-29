/**
 * Cross-tab locate request: the Guests tab asks the Beds tab to open a seat
 * (web parity: GuestSearchSheet's onLocate → switch parcel + open BedDetail).
 */
let pending: string | null = null

export function requestLocate(itemId: string) {
  pending = itemId
}

export function consumeLocate(): string | null {
  const p = pending
  pending = null
  return p
}
