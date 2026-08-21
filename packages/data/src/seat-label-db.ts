/**
 * DB-backed seat-label helpers. SERVER-ONLY — imports the Prisma client (pg).
 * Never import this from a client component; use `./seat-label` (pure) for the
 * display helpers. Server actions / scripts call recompute/backfill here.
 */

import prisma from '../index'
import { computeSeatLabelsWithUnits, type UnitAddress } from './seat-label'

interface SeatRow {
  id: string
  status: string
  sunbedGroupId: string | null
  sunbedGroup: { seq: number | null; parcel: number | null; row: number | null } | null
}

/**
 * Write each unit's ADDRESS (track 021). This function is the ONLY writer of
 * `SunbedGroup.parcel` / `.row` — units are created bare everywhere in the app
 * and get their address here, which is what keeps a single source of truth for
 * a value that is also derivable from seats.
 *
 * Three cases, and the middle one is the reason this isn't a plain upsert:
 *
 *   - a derivable address → written (set-based; rows already correct are
 *     skipped by the IS DISTINCT FROM guard, so the steady state costs nothing)
 *   - placed seats that DISAGREE about parcel or row → left untouched. The
 *     disagreement is transient (mid-rearrange), and clobbering a good address
 *     with a guess would re-point any device bound to it
 *   - no placed seats at all → address cleared. The unit names no physical
 *     spot, and leaving a stale address would let it block the UNIQUE index
 *     against a real unit later built there
 */
async function persistUnitAddresses(
  rows: SeatRow[],
  addresses: Map<string, UnitAddress>,
): Promise<void> {
  const ids: string[] = []
  const parcels: number[] = []
  const rowIdxs: number[] = []
  for (const [unitId, addr] of addresses) {
    const current = rows.find((r) => r.sunbedGroupId === unitId)?.sunbedGroup
    if (current && current.parcel === addr.parcel && current.row === addr.row) continue
    ids.push(unitId)
    parcels.push(addr.parcel)
    rowIdxs.push(addr.row)
  }

  if (ids.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "SunbedGroup" AS g
          SET parcel = v.parcel, row_idx = v.row_idx
         FROM unnest($1::text[], $2::int[], $3::int[]) AS v(id, parcel, row_idx)
        WHERE g.id = v.id
          AND (g.parcel IS DISTINCT FROM v.parcel OR g.row_idx IS DISTINCT FROM v.row_idx)`,
      ids,
      parcels,
      rowIdxs,
    )
  }

  const placedUnits = new Set(
    rows.filter((r) => r.sunbedGroupId && r.status !== 'pool').map((r) => r.sunbedGroupId!),
  )
  const orphaned = [
    ...new Set(
      rows
        .filter(
          (r) =>
            r.sunbedGroupId &&
            !placedUnits.has(r.sunbedGroupId) &&
            (r.sunbedGroup?.parcel != null || r.sunbedGroup?.row != null),
        )
        .map((r) => r.sunbedGroupId!),
    ),
  ]
  if (orphaned.length > 0) {
    await prisma.sunbedGroup.updateMany({
      where: { id: { in: orphaned } },
      data: { parcel: null, row: null },
    })
  }
}

/**
 * Recompute seat labels for all inventory items belonging to a site and
 * persist any that have changed.
 *
 * Idempotent: items whose computed label already matches what is stored are
 * skipped. Returns the number of items updated.
 */
export async function recomputeSeatLabels(siteId: string): Promise<number> {
  const rows = await prisma.inventoryItem.findMany({
    where: { siteId },
    select: {
      id: true,
      number: true,
      group: true,
      status: true,
      sunbedGroupId: true,
      seatLabel: true,
      sunbedGroup: { select: { seq: true, parcel: true, row: true } },
    },
  })
  const items = rows.map((row) => ({ ...row, unitSeq: row.sunbedGroup?.seq ?? null }))

  const { labels: computed, unitSeqs, unitAddresses } = computeSeatLabelsWithUnits(items)

  // Track 021 P3: persist the ordinal of any unit that did not have one, so it
  // is read verbatim from here on. Units keep whatever they already had, which
  // is why this is idempotent and why no label moves when it first runs.
  const unassigned = [
    ...new Set(
      rows.filter((r) => r.sunbedGroupId && r.sunbedGroup?.seq == null)
        .map((r) => r.sunbedGroupId as string),
    ),
  ]
  if (unassigned.length > 0) {
    const seqIds: string[] = []
    const seqValues: number[] = []
    for (const id of unassigned) {
      // Prefer the ordinal from the bucket the unit's PLACED seats sit in.
      // For a unit with no pool extras these are the same value; for one with
      // extras they can differ, and the address must win — otherwise the
      // stored triple would mix a seq from one row with a parcel/row from
      // another, and UNIQUE(site, parcel, row, seq) would be guarding a
      // combination that names no real spot.
      const seq = unitAddresses.get(id)?.seq ?? unitSeqs.get(id)
      if (seq != null) {
        seqIds.push(id)
        seqValues.push(seq)
      }
    }
    // ONE set-based statement, not one per unit. A beach-sized site has
    // thousands of units, and `$transaction([...updates])` sends a statement
    // each — 2,020 of them blew the 5 s interactive-transaction timeout on the
    // first import of a real 4,040-seat beach, so the site could never be
    // labelled at all. Same `unnest` shape `persistUnitAddresses` below already
    // uses, and the IS DISTINCT FROM guard keeps it idempotent.
    if (seqIds.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "SunbedGroup" AS g
            SET seq = v.seq
           FROM unnest($1::text[], $2::int[]) AS v(id, seq)
          WHERE g.id = v.id
            AND g.seq IS DISTINCT FROM v.seq`,
        seqIds,
        seqValues,
      )
    }
  }

  await persistUnitAddresses(rows, unitAddresses)

  const updates: Array<{ id: string; label: string }> = []
  for (const item of items) {
    const newLabel = computed.get(item.id) ?? null
    if (newLabel !== null && newLabel !== item.seatLabel) {
      updates.push({ id: item.id, label: newLabel })
    }
  }

  if (updates.length === 0) return 0

  // Set-based for the same reason as the seq write above: one statement per
  // seat is fine for an edit that moves a handful and fatal for an import that
  // touches four thousand.
  await prisma.$executeRawUnsafe(
    `UPDATE "InventoryItem" AS i
        SET seat_label = v.label
       FROM unnest($1::text[], $2::text[]) AS v(id, label)
      WHERE i.id = v.id
        AND i.seat_label IS DISTINCT FROM v.label`,
    updates.map((u) => u.id),
    updates.map((u) => u.label),
  )

  return updates.length
}

/**
 * Backfill seat labels for every site in the system.
 * Intended for one-time data migration after Phase 1 ships.
 *
 * @returns Total number of inventory items updated across all sites.
 */
export async function backfillAllSeatLabels(): Promise<number> {
  const sites = await prisma.site.findMany({ select: { id: true } })
  let total = 0
  for (const site of sites) {
    total += await recomputeSeatLabels(site.id)
  }
  return total
}
