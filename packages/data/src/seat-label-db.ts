/**
 * DB-backed seat-label helpers. SERVER-ONLY — imports the Prisma client (pg).
 * Never import this from a client component; use `./seat-label` (pure) for the
 * display helpers. Server actions / scripts call recompute/backfill here.
 */

import prisma from '../index'
import { computeSeatLabelsWithUnits } from './seat-label'

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
      sunbedGroupId: true,
      seatLabel: true,
      sunbedGroup: { select: { seq: true } },
    },
  })
  const items = rows.map((row) => ({ ...row, unitSeq: row.sunbedGroup?.seq ?? null }))

  const { labels: computed, unitSeqs } = computeSeatLabelsWithUnits(items)

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
    await prisma.$transaction(
      unassigned
        .filter((id) => unitSeqs.has(id))
        .map((id) =>
          prisma.sunbedGroup.update({ where: { id }, data: { seq: unitSeqs.get(id)! } }),
        ),
    )
  }

  const updates: Array<{ id: string; label: string }> = []
  for (const item of items) {
    const newLabel = computed.get(item.id) ?? null
    if (newLabel !== null && newLabel !== item.seatLabel) {
      updates.push({ id: item.id, label: newLabel })
    }
  }

  if (updates.length === 0) return 0

  await prisma.$transaction(
    updates.map(({ id, label }) =>
      prisma.inventoryItem.update({
        where: { id },
        data: { seatLabel: label },
      }),
    ),
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
