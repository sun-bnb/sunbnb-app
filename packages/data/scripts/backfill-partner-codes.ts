/**
 * Track 021 — give every partner account a stable EXTERNAL code.
 *
 *   npm run backfill:partner-codes:local[:dry]
 *   npm run backfill:partner-codes:test[:dry]
 *   npm run backfill:partner-codes:production[:dry]
 *
 * Additive and idempotent: it only ever fills a NULL, never rewrites an
 * existing code — rewriting one would silently orphan every device flashed with
 * it, which is the exact failure this identifier exists to prevent.
 */

import prisma from '../index'
import { generatePartnerCode } from '../src/partner-code'

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const pending = await prisma.partnerAccount.findMany({
    where: { code: null },
    select: { userId: true, company: true },
  })

  console.log(`Partner accounts without a code: ${pending.length}`)
  for (const account of pending) console.log(`  ${account.userId}  ${account.company}`)

  if (pending.length === 0) {
    console.log('Every account already has a code — nothing to do.')
    return
  }
  if (DRY_RUN) {
    console.log('\n--dry-run: no writes performed.')
    return
  }

  let assigned = 0
  for (const account of pending) {
    // Retry on the unique collision rather than pre-checking: a check-then-write
    // would still race, and at 32^5 collisions are vanishingly rare anyway.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const code = generatePartnerCode()
        await prisma.partnerAccount.update({ where: { userId: account.userId }, data: { code } })
        console.log(`  ${account.userId} → ${code}`)
        assigned++
        break
      } catch (err) {
        if (attempt === 5) throw err
      }
    }
  }

  const remaining = await prisma.partnerAccount.count({ where: { code: null } })
  console.log(`\nAssigned ${assigned} code(s). Remaining without one: ${remaining}`)
  if (remaining > 0) process.exitCode = 1
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
