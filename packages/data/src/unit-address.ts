/**
 * The unit ADDRESS as a query (track 021).
 *
 * Pure — NO database import, so both apps and any client-side caller can use it
 * without pulling `pg` into a bundle. It only shapes Prisma inputs; the queries
 * themselves live at the call sites.
 *
 * Why this is shared rather than written out three times: a device's position is
 * read by three parties that must agree — the HW state route that serves it, the
 * partner action that assigns it, and the guard that refuses to delete the seats
 * under it. Each used to re-derive the address itself (parcel from
 * `InventoryItem.group`, row decoded out of `InventoryItem.number`), which is
 * exactly the arrangement that let a device, the UI that assigned it and the
 * guard protecting it hold three different opinions about where it was.
 */

/** A unit's position. `{parcel}-{row}-{seq}` is the address painted on the bed. */
export interface UnitLocation {
  siteId: string
  parcel: number
  row: number
  seq: number
}

/**
 * `where` for the ONE unit standing at a location — hits
 * `UNIQUE(site_id, parcel, row_idx, seq)` directly.
 *
 * Use with `findUnique`: an address names at most one unit, and the database
 * now enforces that rather than the caller hoping for it.
 */
export function unitAddressWhere(location: UnitLocation) {
  return {
    siteId_parcel_row_seq: {
      siteId: location.siteId,
      parcel: location.parcel,
      row: location.row,
      seq: location.seq,
    },
  }
}

/**
 * The seats of a unit that may claim an LED segment, or count as the unit
 * standing anywhere: everything it holds except `pool` spares. A spare parked at
 * a unit is not a bed under that parasol (track 021 P0), and its synthetic
 * number decodes to a different row than the unit itself.
 */
export const SEGMENT_SEATS = { status: { not: 'pool' } } as const

/** The human form, shown in the fleet UI and echoed to the device. */
export function formatUnitLocation(location: Omit<UnitLocation, 'siteId'>): string {
  return `${location.parcel}-${location.row}-${location.seq}`
}
