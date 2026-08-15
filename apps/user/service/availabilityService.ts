import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import { BLOCKING_STATUSES, OP_NO_SHOW, OP_DEPARTED } from '@repo/data/reservation-status'
import { siteDayBounds } from '@repo/data/site-day'

/** Build the `SiteTimezone` shape `siteDayBounds` expects from a site row. */
function siteTz(site: { timeZone?: string | null; locationLat?: string | null; locationLng?: string | null } | null) {
  return {
    timeZone: site?.timeZone ?? null,
    latitude: site?.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site?.locationLng ? parseFloat(site.locationLng) : undefined,
  }
}

export interface ItemAvailability {
  itemId: string
  available: boolean
  /** Blocking reservation windows overlapping the queried range (empty when available). */
  periods: Array<{ from: Date; to: Date }>
}

/**
 * Availability for a site's seats over [from, to] — set-based SQL (track 020 P2).
 *
 * THE RULE (single source, shared by every caller and mirrored by
 * `searchSites`' available_count subquery): a seat is unavailable iff some
 * reservation on it has a BLOCKING status and overlaps [from, to] INCLUSIVELY
 * (r.from <= to AND r.to >= from) — except that a no-show/departed reservation
 * whose stay is over (r.to <= end of the VENUE's today) releases its seat
 * (track 012); a multiday booking departed mid-stay keeps blocking its future
 * days, and re-use before then goes through an explicit release.
 *
 * Until P2 this was computed in JS: fetch every active seat, fetch every
 * overlapping reservation WITH its full item rows and the full Site row per
 * reservation, then an O(items × reservations × party-size) dayjs loop — per
 * call, on a PUBLIC unauthenticated endpoint. The SQL decides availability per
 * seat with an indexed NOT EXISTS (Reservation(site_id, from, to), track 020
 * P1); the JS loop is gone. Equivalence with the old implementation is locked
 * by an oracle test (availability-semantics.integration.test.ts) that runs the
 * ORIGINAL algorithm, verbatim, against the same seeded matrix.
 *
 * Ordering is part of the contract: ascending seat number drives consumer
 * preselection (`pickFirstAvailablePair`, track 014).
 */
export async function getAvailability(siteId: string, from: Date, to: Date): Promise<ItemAvailability[]> {
  return queryAvailability(siteId, null, from, to)
}

/**
 * Availability for SPECIFIC seats — the booking-validation variant
 * (track 020 P2). Same rule and same query as `getAvailability`, scoped with
 * `i.id = ANY(itemIds)` so validating a 2-seat booking no longer computes
 * availability for every seat on a 3 000-seat venue.
 *
 * Contract note for callers doing never-trust-the-client checks: a requested
 * id that is NOT an active seat of this site is simply ABSENT from the result
 * (exactly as it was absent from the site-wide set before) — callers must
 * treat absence as unbookable, never as available.
 */
export async function getAvailabilityForItems(
  siteId: string,
  itemIds: string[],
  from: Date,
  to: Date
): Promise<ItemAvailability[]> {
  if (itemIds.length === 0) return []
  return queryAvailability(siteId, itemIds, from, to)
}

async function queryAvailability(
  siteId: string,
  itemIds: string[] | null,
  from: Date,
  to: Date
): Promise<ItemAvailability[]> {
  // Resolve the venue timezone so "end of today" anchors to the site's civil
  // day, not the server's (UTC on Vercel). (track 017 P2)
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { timeZone: true, locationLat: true, locationLng: true },
  })
  const endOfToday = siteDayBounds(siteTz(site)).end

  const releasedOps = [OP_NO_SHOW, OP_DEPARTED]

  // Two flat, index-driven queries; the per-seat verdict is an O(1) Map lookup.
  //
  // QUERY SHAPE MATTERS (measured on the 3 000-seat scale fixture, track 020):
  // the links query drives from the RESERVATION range — Reservation(site_id,
  // from, to) (P1) selects the handful of rows overlapping the window and
  // walks their seat links once (~20ms). The tempting inversion — a correlated
  // `NOT EXISTS (... WHERE j."A" = i.id)` per seat — probes every seat's
  // ENTIRE reservation history and measured 1 525ms, i.e. 24× slower than even
  // the old JS loop. A `j."A" = ANY(<hundreds of ids>)` filter was also
  // measured (+38ms) and is semantically a NO-OP site-wide: every link row of
  // an overlapping blocking reservation belongs to a blocked seat by
  // definition. `searchSites`' available_count subquery still uses the
  // correlated shape (bounded today by LIMIT 20 small sites) — recorded in
  // the track.
  const [items, links] = await Promise.all([
    prisma.$queryRaw<Array<{ itemId: string }>>`
      SELECT i.id AS "itemId"
      FROM "InventoryItem" i
      WHERE i.site_id = ${siteId} AND i.status = 'active'
        ${itemIds ? Prisma.sql`AND i.id = ANY(${itemIds})` : Prisma.empty}
      ORDER BY i.number ASC`,
    prisma.$queryRaw<Array<{ itemId: string; from: Date; to: Date }>>`
      SELECT j."A" AS "itemId", r."from", r."to"
      FROM "Reservation" r
      JOIN "_InventoryItemToReservation" j ON j."B" = r.id
      WHERE r.site_id = ${siteId}
        AND r.status = ANY(${BLOCKING_STATUSES})
        AND r."from" <= ${to} AND r."to" >= ${from}
        AND NOT (r.operational_status = ANY(${releasedOps})
                 AND r."to" <= ${endOfToday})
        ${itemIds ? Prisma.sql`AND j."A" = ANY(${itemIds})` : Prisma.empty}
      ORDER BY r."from" ASC`,
  ])

  // The DTO's `periods` (blocking windows, Date objects) is preserved for the
  // public route's consumers — it falls out of the links query for free.
  const periodsByItem = new Map<string, Array<{ from: Date; to: Date }>>()
  for (const row of links) {
    const list = periodsByItem.get(row.itemId)
    if (list) list.push({ from: row.from, to: row.to })
    else periodsByItem.set(row.itemId, [{ from: row.from, to: row.to }])
  }

  return items.map((f) => {
    const periods = periodsByItem.get(f.itemId)
    return { itemId: f.itemId, available: !periods, periods: periods ?? [] }
  })
}

/**
 * Count available sunbeds for a site today using the canonical availability rule.
 * Uses the same BLOCKING_STATUSES + no-show/departed release logic as getAvailability.
 * Returns { availableCount, itemCount } where itemCount is active items only.
 */
export async function countAvailableToday(siteId: string): Promise<{ availableCount: number; itemCount: number }> {
  // Venue-anchored "today" window (not the server's UTC day). (track 017 P2)
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { timeZone: true, locationLat: true, locationLng: true },
  })
  const { start: startOfToday, end: endOfToday } = siteDayBounds(siteTz(site))

  const availabilityData = await getAvailability(siteId, startOfToday, endOfToday)
  const itemCount = availabilityData.length
  const availableCount = availabilityData.filter(a => a.available).length

  return { availableCount, itemCount }
}
