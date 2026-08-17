/**
 * Track 021 — populate `SunbedGroup.parcel` / `.row`, the two columns that
 * complete a unit's ADDRESS now that it lives on the unit instead of being
 * scattered across its seats.
 *
 *   npm run backfill:addresses:local[:dry]
 *   npm run backfill:addresses:test[:dry]
 *   npm run backfill:addresses:production[:dry]
 *
 * Safe by construction, per the track's operating constraint:
 *   - PURE TRANSCRIPTION. The address written is the one the app already
 *     resolves today (parcel from `InventoryItem.group`, row decoded out of
 *     `InventoryItem.number`, seq from the unit). Nothing a device or a label
 *     resolves to changes on release — that is the whole point of doing this
 *     while the data is still pristine.
 *   - IDEMPOTENT. Re-running is a no-op; a partial run is completed by the next.
 *   - Goes through the SAME `recomputeSeatLabels` the app calls, so the backfill
 *     and the write paths cannot disagree about what an address is.
 *   - --dry-run reports what WOULD change and writes nothing.
 *
 * The verification pass is deliberately RAW SQL rather than a second call into
 * the module being verified: a backfill checked with its own logic only proves
 * self-consistency, and the failure mode that matters here is the code's notion
 * of an address having drifted from the data's. It also re-checks that not one
 * `seq` moved — a moved seq is a renamed bed, and the bed is painted.
 */

import prisma from '../index'
import { computeSeatLabelsWithUnits } from '../src/seat-label'
import { recomputeSeatLabels } from '../src/seat-label-db'

const DRY_RUN = process.argv.includes('--dry-run')

interface Divergence {
  unitId: string
  stored: string
  derived: string
}

/** The address the CURRENT code would compute, without writing anything. */
async function plannedAddresses(siteId: string) {
  const rows = await prisma.inventoryItem.findMany({
    where: { siteId },
    select: {
      id: true,
      number: true,
      group: true,
      status: true,
      sunbedGroupId: true,
      sunbedGroup: { select: { seq: true, parcel: true, row: true } },
    },
  })
  const items = rows.map((row) => ({ ...row, unitSeq: row.sunbedGroup?.seq ?? null }))
  const { unitAddresses } = computeSeatLabelsWithUnits(items)

  const current = new Map<string, { parcel: number | null; row: number | null }>()
  for (const row of rows) {
    if (row.sunbedGroupId && row.sunbedGroup) {
      current.set(row.sunbedGroupId, { parcel: row.sunbedGroup.parcel, row: row.sunbedGroup.row })
    }
  }

  let changing = 0
  for (const [unitId, addr] of unitAddresses) {
    const now = current.get(unitId)
    if (!now || now.parcel !== addr.parcel || now.row !== addr.row) changing++
  }
  return { units: current.size, withAddress: unitAddresses.size, changing }
}

/**
 * Independent check: recompute the address straight from the seat rows in SQL
 * and compare it with what is stored. Placed seats only — a `pool` extra's
 * synthetic number decodes to another row and would make the address ambiguous.
 */
async function verify(): Promise<{ divergent: Divergence[]; unaddressed: number }> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string
      stored_parcel: number | null
      stored_row: number | null
      derived_parcel: number | null
      derived_row: number | null
      placed_seats: bigint
      parcel_variants: bigint
      row_variants: bigint
    }>
  >(`
    SELECT g.id,
           g.parcel AS stored_parcel,
           g.row_idx AS stored_row,
           min(i."group") FILTER (WHERE i.status <> 'pool') AS derived_parcel,
           min((i.number/100)%100) FILTER (WHERE i.status <> 'pool') AS derived_row,
           count(*) FILTER (WHERE i.status <> 'pool') AS placed_seats,
           count(DISTINCT i."group") FILTER (WHERE i.status <> 'pool') AS parcel_variants,
           count(DISTINCT ((i.number/100)%100)) FILTER (WHERE i.status <> 'pool') AS row_variants
      FROM "SunbedGroup" g
      LEFT JOIN "InventoryItem" i ON i.sunbed_group_id = g.id
     GROUP BY g.id, g.parcel, g.row_idx
  `)

  const divergent: Divergence[] = []
  let unaddressed = 0
  for (const r of rows) {
    const derivable = Number(r.placed_seats) > 0 && Number(r.parcel_variants) === 1 && Number(r.row_variants) === 1
    if (!derivable) {
      if (r.stored_parcel != null || r.stored_row != null) {
        divergent.push({
          unitId: r.id,
          stored: `${r.stored_parcel}-${r.stored_row}`,
          derived: `<not derivable: ${r.placed_seats} placed seat(s), ${r.parcel_variants} parcel(s), ${r.row_variants} row(s)>`,
        })
      } else {
        unaddressed++
      }
      continue
    }
    if (r.stored_parcel !== r.derived_parcel || r.stored_row !== r.derived_row) {
      divergent.push({
        unitId: r.id,
        stored: `${r.stored_parcel}-${r.stored_row}`,
        derived: `${r.derived_parcel}-${r.derived_row}`,
      })
    }
  }
  return { divergent, unaddressed }
}

async function main() {
  const sites = await prisma.site.findMany({ select: { id: true, name: true } })
  console.log(`Sites: ${sites.length}${DRY_RUN ? '  (DRY RUN — nothing will be written)' : ''}\n`)

  // Captured BEFORE the run: a seq that moves is a bed that got renamed while
  // the number stayed painted on it, which is the one outcome this must never
  // produce. Compared again at the end.
  const seqBefore = new Map<string, number | null>()
  for (const u of await prisma.sunbedGroup.findMany({ select: { id: true, seq: true } })) {
    seqBefore.set(u.id, u.seq)
  }

  let totalUnits = 0
  let totalWithAddress = 0
  let totalChanging = 0

  for (const site of sites) {
    const planned = await plannedAddresses(site.id)
    totalUnits += planned.units
    totalWithAddress += planned.withAddress
    totalChanging += planned.changing

    if (planned.units === 0) continue
    const note = planned.changing > 0 ? `${planned.changing} to write` : 'already current'
    console.log(
      `  ${site.name}: ${planned.units} unit(s), ${planned.withAddress} addressable — ${note}`,
    )

    if (!DRY_RUN) await recomputeSeatLabels(site.id)
  }

  console.log(
    `\nUnits: ${totalUnits}   addressable: ${totalWithAddress}   ${DRY_RUN ? 'would write' : 'written'}: ${totalChanging}`,
  )

  if (DRY_RUN) {
    console.log('\nDry run — no verification (nothing was written).')
    return
  }

  const { divergent, unaddressed } = await verify()
  let moved = 0
  for (const u of await prisma.sunbedGroup.findMany({ select: { id: true, seq: true } })) {
    if (seqBefore.has(u.id) && seqBefore.get(u.id) !== u.seq) moved++
  }

  console.log(`\nVerification (raw SQL, independent of the backfill code):`)
  console.log(`  units whose stored address disagrees with the data: ${divergent.length}`)
  console.log(`  units with no address (no placed seats): ${unaddressed}`)
  console.log(`  units whose seq MOVED: ${moved}`)

  if (divergent.length > 0) {
    console.log('\n  first divergences:')
    for (const d of divergent.slice(0, 10)) {
      console.log(`    ${d.unitId}: stored ${d.stored}, data says ${d.derived}`)
    }
  }

  if (divergent.length > 0 || moved > 0) {
    console.error('\n✗ FAILED — addresses do not match the data, or a seq moved.')
    process.exitCode = 1
  } else {
    console.log('\n✓ Every stored address matches the data, and no seq moved.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
