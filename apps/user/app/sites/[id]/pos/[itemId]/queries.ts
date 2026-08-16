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

export async function getPosContext(itemId: string) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    include: {
      site: true,
      sunbedGroup: { include: { items: true } },
    },
  })

  if (!item) return null

  // SunbedGroup is the source of truth for pairing (track 021 P1 retired the
  // legacy pairId/pairedBy self-relation).
  const otherGroupMembers =
    item.sunbedGroup?.items.filter((member) => member.id !== item.id) ?? []

  const items = otherGroupMembers.length > 0 ? [item, ...otherGroupMembers] : [item]

  // The venue's civil day, not the server's UTC day and not the browser's (track 017).
  const { start, end } = siteDayBounds(siteTz(item.site))

  const availability = item.site
    ? await getAvailabilityForItems(
        item.site.id,
        items.map((i) => i.id),
        start,
        end,
      )
    : []

  return {
    site: item.site,
    items,
    availableItemIds: availability.filter((a) => a.available).map((a) => a.itemId),
  }
}
