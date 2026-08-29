/**
 * Floor view-model types — the loaded shapes the floor surfaces (partner manage
 * grid, mobile floor app) render from. Extracted verbatim from
 * apps/partner/types/shared.ts ([[track:024]] P6-lite): pure declarations, no
 * runtime imports, safe for any client.
 */

/** Per-day operational state row (ReservationDay model). */
export interface ReservationDayRow {
  id: string
  reservationId: string
  date: Date
  operationalStatus: string
  checkedInAt: Date | null
  departedAt: Date | null
}

export interface Reservation {
  id: string
  siteId: string
  itemId?: string | null
  type: string
  status: string
  operationalStatus: string
  from: Date
  to: Date
  checkedInAt?: Date | null
  departedAt?: Date | null
  guestName?: string | null
  guestContact?: string | null
  internalNotes?: string | null
  paymentAmount?: number | null
  paymentRef?: string | null
  refundedAt?: Date | null
  isComp?: boolean
  user: {
    id: string
    email: string
  }
  /**
   * The party's seats — a MINIMAL shape (id + price), matching what the manage
   * grid query selects. Prices feed the Seat-mode unreserve dialog's
   * partitioned-share display (track 018 B2). Not full InventoryItem rows.
   */
  items?: { id: string; price?: number | null }[] | null
  /** Today's per-day operational state row. Absent for blocked reservations. */
  today?: ReservationDayRow | null
  /**
   * Whether the booking's stay is over (no remaining reserved days — `to` is on
   * or before the end of today). Computed server-side so client/server timezones
   * can't skew the comparison. A departed/no-show booking only frees its bed when
   * this is true (single-day or last day); mid-stay it stays held. (track 012)
   */
  stayOver?: boolean
  /**
   * Non-voided TillEntry rows for this reservation — present when the page query
   * includes tillEntries (manage page). One entry per Settle event. Used to derive
   * the "settled" indicator in BedDetail without a separate query.
   */
  tillEntries?: { id: string; amount: number }[]
}

export interface InventoryItem {
  id: string
  number: number
  group: number
  itemGroupId?: string | null
  status: string
  category?: string | null
  price?: number | null
  rotation?: number | null
  label?: string | null
  locationLat?: string
  locationLng?: string
  schematicX?: number | null
  schematicY?: number | null
  sunbedGroupId?: string | null
  sunbedGroup?: { id: string; items: { id: string; number?: number; status?: string }[] } | null
  seatLabel?: string | null
  reservations?: Reservation[]
}

export interface RentalItemProps {
  id: string
  siteId: string
  name: string
  description?: string | null
  imageUrl?: string | null
  category?: string | null
  pricePerHour?: number | null
  pricePerDay?: number | null
  totalQuantity: number
  active: boolean
}

export interface RentalBookingProps {
  id: string
  siteId: string
  rentalItemId: string
  userId: string
  from: Date
  to: Date
  quantity: number
  durationType: string
  totalPrice: number
  status: string
  operationalStatus: string
  guestName?: string | null
  paymentRef?: string | null
  pickedUpAt?: Date | null
  returnedAt?: Date | null
  rentalItem: RentalItemProps
  user: { id: string; name?: string | null; email: string }
}
