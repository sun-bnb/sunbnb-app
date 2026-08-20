/**
 * POS (QR) seat page — data loader.
 *
 * Lives outside `page.tsx` for two reasons: a Next page file may export only the
 * default component and a fixed set of config fields, and keeping the loader here
 * makes the availability contract directly testable.
 *
 * **Availability is decided by the canonical service, never re-implemented here.**
 * `getAvailabilityForItems` (`@/service/availabilityService`) is the single rule —
 * blocking statuses only, INCLUSIVE date overlap, and the track-012 release rule
 * for a no-show/departed stay that is over — and it is oracle-tested against the
 * pre-rewrite implementation. Before this loader existed the POS page derived
 * availability client-side from an UNFILTERED `reservations` include, so any
 * reservation overlapping today blocked the seat regardless of status: a canceled
 * or refunded booking, or an abandoned `pending` checkout, made the seat
 * permanently unbookable from its own QR code. It also used the browser's midnight
 * rather than the venue's civil day (track 017).
 *
 * Absence is unbookable: the service omits ids that are not active seats of this
 * site, and `availableItemIds` therefore excludes them — the same default-deny the
 * booking action relies on (track 020 P2).
 */

import prisma from '@repo/data/PrismaCient'
import { siteDayBounds } from '@repo/data/site-day'
import { SEGMENT_SEATS } from '@repo/data/unit-address'
import { getAvailabilityForItems } from '@/service/availabilityService'

/** Build the `SiteTimezone` shape `siteDayBounds` expects from a site row. */
function siteTz(site: {
  timeZone?: string | null
  locationLat?: string | null
  locationLng?: string | null
} | null) {
  return {
    timeZone: site?.timeZone ?? null,
    latitude: site?.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site?.locationLng ? parseFloat(site.locationLng) : undefined,
  }
}

/**
 * Find the unit a scanned SEAT belongs to (the pre-track-022 key).
 *
 * Kept as its own step so the availability tail below can be shared with the
 * short `/q/{siteCode}/{parcel}-{row}-{seq}` route, which finds the same unit by
 * ADDRESS instead. Two ways in, one set of rules about what is bookable.
 *
 * Also returns the unit's address when it has one, so the legacy route can
 * redirect to its short form instead of rendering a second copy of this page.
 */
export async function loadPosUnitByItem(itemId: string) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    include: {
      site: true,
      // `pool` spares are excluded: a spare parked on a unit is not a bed under
      // that parasol (track 021 P0, the same `SEGMENT_SEATS` rule the HW device
      // resolver uses). Including them made the whole unit unbookable from its
      // own QR — a pool seat is never in the availability set (absence is
      // unbookable), so the `every()` availability check below could never pass,
      // and the seat read "Reserved" forever.
      sunbedGroup: { include: { items: { where: SEGMENT_SEATS } } },
    },
  })

  if (!item) return null

  // SunbedGroup is the source of truth for pairing (track 021 P1 retired the
  // legacy pairId/pairedBy self-relation).
  const otherGroupMembers =
    item.sunbedGroup?.items.filter((member) => member.id !== item.id) ?? []

  const items = otherGroupMembers.length > 0 ? [item, ...otherGroupMembers] : [item]

  const unit = item.sunbedGroup
  const address =
    unit && unit.parcel !== null && unit.row !== null && unit.seq !== null
      ? { parcel: unit.parcel, row: unit.row, seq: unit.seq }
      : null

  return { site: item.site, items, address }
}

/**
 * The seats of this unit that are free for the venue's TODAY.
 *
 * The one place the POS pages decide availability, whichever key found the unit.
 * It delegates to the canonical `getAvailabilityForItems` and does not
 * re-implement any part of it — see this file's header for what happened the
 * last time a POS page derived this for itself.
 */
export async function posAvailability(
  site: { id: string; timeZone?: string | null; locationLat?: string | null; locationLng?: string | null } | null,
  items: { id: string }[],
): Promise<string[]> {
  if (!site) return []

  // The venue's civil day, not the server's UTC day and not the browser's (track 017).
  const { start, end } = siteDayBounds(siteTz(site))

  const availability = await getAvailabilityForItems(
    site.id,
    items.map((i) => i.id),
    start,
    end,
  )
  return availability.filter((a) => a.available).map((a) => a.itemId)
}

/**
 * The legacy seat-keyed entry point, unchanged in contract: `/sites/{id}/pos/{itemId}`
 * and its tests still call this.
 */
export async function getPosContext(itemId: string) {
  const unit = await loadPosUnitByItem(itemId)
  if (!unit) return null

  return {
    site: unit.site,
    items: unit.items,
    availableItemIds: await posAvailability(unit.site, unit.items),
  }
}
