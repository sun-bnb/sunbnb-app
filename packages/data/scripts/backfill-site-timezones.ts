/**
 * Backfill `Site.timeZone` from each site's coordinates (track 017 P7).
 *
 * `Site.timeZone` was added by track 012 P0 but never written — reads always
 * derived it from lat/lng at request time via `tz-lookup`. That is accurate
 * everywhere EXCEPT the multi-site consumer search SQL (`apps/user`
 * `siteService.ts`), which cannot run the JS `tz-lookup` and falls back to
 * `Europe/Madrid` for any site with a NULL `time_zone` — so a Canary/Helsinki
 * venue's advertised availability is anchored to the wrong day (track 017 P2
 * residual). Populating the column from coordinates closes that gap.
 *
 * Safe by construction: deterministic (same coords → same IANA zone), additive
 * (only fills rows where `time_zone IS NULL`), touches no money/reservation data.
 * Idempotent — re-running only affects rows still NULL.
 *
 * Sites only. New LINKED restaurants inherit their site's tz at create time
 * (track 017 P7, partner `createRestaurant`); backfilling existing linked
 * restaurants is a separate follow-up (a Restaurant has no geo columns of its
 * own, so it derives from the linked Site's coords).
 *
 * Usage:
 *   # Dry-run (list candidates + the tz each would get, no writes):
 *   npx tsx scripts/backfill-site-timezones.ts --dry-run
 *
 *   # Live run:
 *   npx tsx scripts/backfill-site-timezones.ts
 *
 *   # The npm scripts below set POSTGRES_URL via with-db-url.sh:
 *   npm run backfill:tz:local:dry       npm run backfill:tz:local
 *   npm run backfill:tz:test:dry        npm run backfill:tz:test
 *   npm run backfill:tz:production:dry  npm run backfill:tz:production
 */

import prisma from '../index'
import { deriveTimeZoneFromCoords } from '../src/site-day'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run') || process.env.DRY_RUN === '1'

function maskDbUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return '(invalid URL)'
  }
}

interface Candidate {
  id: string
  name: string
  locationLat: string | null
  locationLng: string | null
  derived: string | null
}

async function findCandidates(): Promise<Candidate[]> {
  const sites = await prisma.site.findMany({
    where: { OR: [{ timeZone: null }, { timeZone: '' }] },
    select: { id: true, name: true, locationLat: true, locationLng: true },
    orderBy: { createdAt: 'asc' },
  })
  return sites.map((s) => ({
    id: s.id,
    name: s.name ?? '(unnamed)',
    locationLat: s.locationLat,
    locationLng: s.locationLng,
    derived: deriveTimeZoneFromCoords(
      s.locationLat ? parseFloat(s.locationLat) : null,
      s.locationLng ? parseFloat(s.locationLng) : null,
    ),
  }))
}

async function main() {
  console.log(`\n[backfill-site-timezones] DB: ${maskDbUrl(process.env.POSTGRES_URL ?? '')}`)
  console.log(`[backfill-site-timezones] Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE'}\n`)

  const candidates = await findCandidates()
  const resolvable = candidates.filter((c) => c.derived != null)
  const unresolvable = candidates.filter((c) => c.derived == null)

  console.log(`Sites with NULL time_zone: ${candidates.length}`)
  console.log(`  → derivable from coords:  ${resolvable.length}`)
  console.log(`  → NOT derivable (missing/ocean coords, left NULL): ${unresolvable.length}\n`)

  for (const c of resolvable) {
    console.log(`  ${c.id}  ${c.derived}  (${c.name})`)
  }
  if (unresolvable.length > 0) {
    console.log(`\n  Left NULL (no derivable tz):`)
    for (const c of unresolvable) {
      console.log(`  ${c.id}  lat=${c.locationLat ?? 'null'} lng=${c.locationLng ?? 'null'}  (${c.name})`)
    }
  }

  if (DRY_RUN) {
    console.log(`\n[backfill-site-timezones] DRY-RUN complete — no rows written.\n`)
    return
  }

  let updated = 0
  for (const c of resolvable) {
    await prisma.site.update({ where: { id: c.id }, data: { timeZone: c.derived! } })
    updated += 1
  }

  console.log(`\n[backfill-site-timezones] Updated ${updated} site(s). Left ${unresolvable.length} NULL.\n`)
}

main()
  .catch((err) => {
    console.error('[backfill-site-timezones] FAILED:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
