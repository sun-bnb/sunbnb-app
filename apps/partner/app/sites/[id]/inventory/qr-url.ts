/**
 * The URL that goes inside a printed QR card (track 022).
 *
 * This is the one place in the product where a URL leaves the screen and lands
 * on a physical bed, so it is worth its own tested module rather than an inline
 * template string. A card is glued down and read by a phone at an angle in
 * sunlight; its length decides the QR's version, and its KEY decides what the
 * card still means after the venue rearranges.
 *
 *   short   {appUrl}/q/S-K7M2X9/1-1-1              35 chars → QR v3, 29×29
 *   legacy  {appUrl}/sites/{cuid}/pos/{cuid}       80 chars → QR v5, 37×37
 *
 * The short form is keyed by the unit's ADDRESS, so the card belongs to the
 * SPOT: a parcel rebuilt in place keeps working, where a seat cuid would have
 * been deleted out from under it (track 022 D1).
 */

import { parseSeatLabel } from '@repo/data/seat-label'
import { formatUnitLocation } from '@repo/data/unit-address'

interface QrCardTarget {
  appUrl: string
  siteId: string
  /** `Site.code`. Absent until `backfill:site-codes` has run on this environment. */
  siteCode?: string | null
  item: { id: string; seatLabel?: string | null }
}

export function qrCardUrl({ appUrl, siteId, siteCode, item }: QrCardTarget): string {
  const address = parseSeatLabel(item.seatLabel)

  // FALL BACK, never refuse. A site whose code has not been backfilled yet, or
  // a seat with no label, still needs printable cards — an operator setting up a
  // venue should not discover that printing is blocked on a platform migration
  // they cannot see. The legacy URL is not dead: `/sites/{id}/pos/{itemId}`
  // redirects to the short form as soon as both halves exist, so a card printed
  // during that window keeps resolving afterwards. It is only longer.
  if (!siteCode || !address) return `${appUrl}/sites/${siteId}/pos/${item.id}`

  // The unit, not the bed: the page renders the whole unit whichever bed was
  // scanned, so the member segment would be printed data that nothing reads
  // (track 022 D3). The card's visible LABEL still names the bed.
  return `${appUrl}/q/${siteCode}/${formatUnitLocation(address)}`
}
