/**
 * Track 022 — give every site a stable EXTERNAL code.
 *
 *   npm run backfill:site-codes:local[:dry]
 *   npm run backfill:site-codes:test[:dry]
 *   npm run backfill:site-codes:production[:dry]
 *
 * Additive and idempotent: it only ever fills a NULL, never rewrites an existing
 * code. Rewriting one would silently orphan every QR card printed for that venue
 * — cards are glued to loungers, and the reprint is a site visit. That is the
 * exact failure this identifier exists to prevent, so the filter below is the
 * load-bearing line of the script.
 */

import prisma from '../index'
import { generateSiteCode, isSiteCodeCollision } from '../src/site-code'

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const pending = await prisma.site.findMany({
    where: { code: null },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Sites without a code: ${pending.length}`)
  for (const site of pending) console.log(`  ${site.id}  ${site.name}`)

  if (pending.length === 0) {
    console.log('Every site already has a code — nothing to do.')
    return
  }
  if (DRY_RUN) {
    console.log('\n--dry-run: no writes performed.')
    return
  }

  let assigned = 0
  for (const site of pending) {
    // Retry on the unique collision rather than pre-checking: a check-then-write
    // would still race, and at 32^6 collisions are vanishingly rare anyway.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const code = generateSiteCode()
        await prisma.site.update({ where: { id: site.id }, data: { code } })
        console.log(`  ${site.id} → ${code}`)
        assigned++
        break
      } catch (err) {
        // A non-collision failure (a dropped connection, a permissions error)
        // must surface immediately: burning five attempts on it would report the
        // wrong cause, and the operator running this against production needs to
        // know which it was.
        if (!isSiteCodeCollision(err) || attempt === 5) throw err
      }
    }
  }

  const remaining = await prisma.site.count({ where: { code: null } })
  console.log(`\nAssigned ${assigned} code(s). Remaining without one: ${remaining}`)
  if (remaining > 0) process.exitCode = 1
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
