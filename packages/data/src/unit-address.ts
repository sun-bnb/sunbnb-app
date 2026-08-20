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

/**
 * The inverse of `formatUnitLocation` (track 022) — read an address back out of
 * a string, for the printed QR URL `/q/{siteCode}/{parcel}-{row}-{seq}`.
 *
 * It lives next to the formatter deliberately: this module exists because three
 * parties re-deriving one address is how they came to disagree about it, and a
 * parser written somewhere else would be a fourth opinion about the same string.
 *
 * **Syntax only, not domain bounds.** It accepts any non-negative integers and
 * lets the database say whether a unit stands there. `0` is deliberately legal:
 * parcel 0 / row 0 are live addresses in real data (21 units in both the dev and
 * test databases), so a parser that "sensibly" required 1 would 404 them.
 *
 * A FOURTH segment is accepted and ignored — `1-1-1-2` is what `formatSeatId`
 * prints on the card, and it names a bed inside this unit. The page renders the
 * whole unit either way (the scanned seat is not used), so accepting the longer
 * form costs nothing and means a card printed with it keeps resolving if the
 * format ever gains that meaning.
 *
 * @returns the address, or `null` for anything malformed — no throwing, because
 *   every caller is handling untrusted URL input and wants a 404, not a 500.
 */
export function parseUnitAddress(raw: string): Omit<UnitLocation, 'siteId'> | null {
  const parts = raw.trim().split('-')
  if (parts.length !== 3 && parts.length !== 4) return null

  const numbers: number[] = []
  for (const part of parts.slice(0, 3)) {
    // Digits only: this rejects '', '+1', '-1', '1.0', '1e3' and ' 1' — all of
    // which `Number()` would happily accept or coerce, some into a value that
    // then queries a DIFFERENT unit than the string names.
    if (!/^\d+$/.test(part)) return null
    const value = Number(part)
    // Postgres int4. Past this the query throws instead of returning nothing,
    // which turns a mistyped URL into a 500.
    if (value > 2147483647) return null
    numbers.push(value)
  }

  const [parcel, row, seq] = numbers as [number, number, number]
  return { parcel, row, seq }
}
