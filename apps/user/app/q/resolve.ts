/**
 * QR entry resolution (track 022) — turn the two segments of a printed card's
 * URL, `/q/{siteCode}/{parcel}-{row}-{seq}`, into the site and the beds standing
 * at that spot.
 *
 * Both segments come off a card glued to a lounger, so both are folded before
 * they are trusted: `normalizeSiteCode` accepts the code lowercase or without
 * its `S-` prefix (someone reads it aloud, someone else types it into a phone),
 * and `parseUnitAddress` accepts the four-segment seat id `1-1-1-2` that the
 * card also prints.
 *
 * **Syntax is checked before the database is touched.** A malformed URL is the
 * common case for a scanner or a crawler wandering in, and it should cost a
 * regex, not a query — the same ordering the HW device route uses.
 *
 * **The address, not the seat row, is the key** (track 022 D1, [[track:021]]'s
 * paradigm): this resolves whatever unit stands at that spot TODAY. A parcel
 * rebuilt in place keeps its printed cards working; a genuine rearrange can
 * re-point one, which is the trade the founder took and the reason the seat cuid
 * is gone from the URL.
 */

import prisma from '@repo/data/PrismaCient'
import { isValidSiteCode, normalizeSiteCode } from '@repo/data/site-code'
import { parseUnitAddress, unitAddressWhere, SEGMENT_SEATS } from '@repo/data/unit-address'

export async function resolveQrTarget(siteCodeRaw: string, addressRaw: string) {
  if (!siteCodeRaw || !addressRaw) return null
  if (!isValidSiteCode(siteCodeRaw)) return null

  const address = parseUnitAddress(addressRaw)
  if (!address) return null

  const site = await prisma.site.findUnique({
    where: { code: normalizeSiteCode(siteCodeRaw) },
  })
  if (!site) return null

  const unit = await prisma.sunbedGroup.findUnique({
    where: unitAddressWhere({ siteId: site.id, ...address }),
    include: {
      // `pool` spares are excluded everywhere a unit's beds are counted: a spare
      // parked on a unit is not a bed under that parasol, and surfacing one made
      // the whole unit read "Reserved" forever, since a pool seat is never in
      // the availability set (track 021 P0).
      items: { where: SEGMENT_SEATS, orderBy: { number: 'asc' } },
    },
  })
  if (!unit) return null

  // A unit with no placed seats has no physical position — it has surrendered
  // its address (track 021) and there is nothing at that spot to sell. Declining
  // is the fail-safe direction: the alternative is a page offering zero beds.
  if (unit.items.length === 0) return null

  return { site, items: unit.items }
}
