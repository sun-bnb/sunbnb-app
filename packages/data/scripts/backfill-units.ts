/**
 * Track 021 P2 consistency pass for the unit model. Two jobs:
 *
 *  1. Invariant I1 — every PLACED seat belongs to exactly one unit
 *     (`SunbedGroup`). Seats that pre-date universal units get their own
 *     single-member unit; pool/unplaced seats are left alone by design,
 *     because a null group is exactly what "in the pool" means.
 *  2. Orphaned EMPTY units — units with no members left. Until the delete
 *     paths were fixed, deleting a parcel removed its seats and left its
 *     units behind forever, invisible in every UI (production carried 2).
 *     They reference nothing and nothing references them.
 *
 * NOTE: once devices bind to units (P5), an empty unit may be legitimate — a
 * shade whose beds are stowed — and pruning must become conditional. Revisit
 * this script then; today an empty unit is only ever residue.
 *
 *   npm run backfill:units:local[:dry]
 *   npm run backfill:units:test[:dry]
 *   npm run backfill:units:production[:dry]
 *
 * Safe by construction, per the track's operating constraint:
 *   - ADDITIVE only. It creates SunbedGroup rows and sets sunbed_group_id where
 *     it is NULL. It never deletes, never rewrites an existing unit, and never
 *     touches a seat that already has one.
 *   - IDEMPOTENT. Re-running is a no-op; a partial run is completed by the next.
 *   - Uses the SAME `ensurePlacedSeatsHaveUnits` the app calls, so the backfill
 *     and the write paths cannot disagree about what "placed" means.
 *   - --dry-run reports what WOULD change and writes nothing.
 */

import prisma from '../index'
import { ensurePlacedSeatsHaveUnits, findUnitlessPlacedSeats, pruneEmptyUnits } from '../src/unit'

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const emptyUnits = await prisma.sunbedGroup.findMany({
    where: { items: { none: {} } },
    select: { id: true, siteId: true },
  })
  const pending = await findUnitlessPlacedSeats()
  const bySite = new Map<string, number>()
  for (const seat of pending) bySite.set(seat.siteId, (bySite.get(seat.siteId) ?? 0) + 1)

  console.log(`Placed seats without a unit: ${pending.length} across ${bySite.size} site(s)`)
  for (const [siteId, count] of bySite) console.log(`  ${siteId}  ${count}`)

  const emptyBySite = new Map<string, number>()
  for (const unit of emptyUnits) emptyBySite.set(unit.siteId, (emptyBySite.get(unit.siteId) ?? 0) + 1)
  console.log(`Orphaned EMPTY units: ${emptyUnits.length} across ${emptyBySite.size} site(s)`)
  for (const [siteId, count] of emptyBySite) console.log(`  ${siteId}  ${count}`)

  if (pending.length === 0 && emptyUnits.length === 0) {
    console.log('Unit model already consistent — nothing to do.')
    return
  }
  if (DRY_RUN) {
    console.log('\n--dry-run: no writes performed.')
    return
  }

  let created = 0
  for (const siteId of bySite.keys()) {
    const result = await ensurePlacedSeatsHaveUnits(siteId)
    created += result.created
    console.log(`  ${siteId}: ${result.created} unit(s) created`)
  }

  let pruned = 0
  for (const siteId of emptyBySite.keys()) {
    const result = await pruneEmptyUnits(siteId)
    pruned += result.deleted
    console.log(`  ${siteId}: ${result.deleted} empty unit(s) pruned`)
  }
  if (pruned > 0) console.log(`Pruned ${pruned} empty unit(s).`)

  const remaining = await findUnitlessPlacedSeats()
  console.log(`\nCreated ${created} unit(s). Remaining unitless placed seats: ${remaining.length}`)
  if (remaining.length > 0) {
    console.error('I1 still violated — investigate before proceeding.')
    process.exitCode = 1
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
