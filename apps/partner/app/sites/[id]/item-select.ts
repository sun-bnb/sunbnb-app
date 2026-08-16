/**
 * Shared seat projection for the partner site loaders (track 020 C2).
 *
 * Lives in its OWN module because `queries.ts` is a `'use server'` file, and
 * such a file may export async functions only — exporting this object from
 * there compiles fine and then fails at request time with
 * "A 'use server' file can only export async functions, found object."
 * (Mocked unit tests cannot catch that; it showed up as a 500 in the browser.)
 */

/**
 * The seat columns the partner editors actually read (track 020 C2).
 *
 * Deliberately omits `notes`, `image`, `userId`, `siteId` and the timestamps
 * (unread client-side, and Dates serialize verbosely), and reduces
 * `pair`/`pairedBy` from whole InventoryItem rows to id stubs — the only
 * thing any consumer reads off them is `.id`. Shared by `site-page` and
 * `getSite` so the initial payload and the refresh payload cannot drift.
 */
export const INVENTORY_ITEM_SELECT = {
  id: true,
  number: true,
  seatLabel: true,
  label: true,
  status: true,
  category: true,
  price: true,
  rotation: true,
  locationLat: true,
  locationLng: true,
  schematicX: true,
  schematicY: true,
  group: true,
  itemGroupId: true,
  sunbedGroupId: true,
  // Track 021 P1: `pairId`/`pair`/`pairedBy` are no longer projected — the
  // editors resolve pairing through `sunbedGroup` alone.
} as const
