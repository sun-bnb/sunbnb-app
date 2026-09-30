/**
 * Is the Veri*factu register complete in the connected database?
 *
 * READ-ONLY — it never writes. Exists so the detector has a trigger from the day
 * it is written: the standing lesson of this repo is that `/api/reconcile` was
 * built for a cron and never wired, so it has been dark ever since. The ops page
 * (P9) will render the same `getVerifactuHealth`; this is what makes it usable
 * before that page exists, and it is how to answer "can we file our own
 * commission invoices?" against production BEFORE switching transmission on.
 *
 * Usage:
 *   npm run verifactu:health:local
 *   npm run verifactu:health:test
 *   npm run verifactu:health:production
 *   npm run verifactu:health:local -- --from 2026-07-01 --to 2026-08-01
 *
 * Exit codes: 0 healthy, 1 needs attention, 2 bad usage. Non-zero on unhealthy
 * so this can be a cron or CI gate without anyone parsing the text.
 */
import prisma from '../index'
import { getVerifactuHealth, describeVerifactuHealth } from '../src/tax/es-verifactu/health'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

function parseDate(raw: string | undefined, flag: string): Date | undefined {
  if (raw === undefined) return undefined
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    console.error(`${flag}: "${raw}" is not a date (try 2026-07-01)`)
    process.exit(2)
  }
  return d
}

async function main() {
  const from = parseDate(argValue('--from'), '--from')
  const to = parseDate(argValue('--to'), '--to')

  const health = await getVerifactuHealth({ from, to })

  console.log(describeVerifactuHealth(health))
  console.log('')

  if (from || to) {
    console.log(
      `Invoice window: ${from ? from.toISOString().slice(0, 10) : 'all time'} → ${
        to ? to.toISOString().slice(0, 10) : 'all time'
      }  (chains are always all-time)`,
    )
    console.log('')
  }

  const statuses = Object.entries(health.recordsByStatus).sort(([a], [b]) => a.localeCompare(b))
  console.log('Records by submission state:')
  if (statuses.length === 0) console.log('  (none)')
  for (const [status, n] of statuses) console.log(`  ${status.padEnd(8)} ${n}`)
  if (health.oldestUnsentAt) {
    const ageMin = Math.round((Date.now() - health.oldestUnsentAt.getTime()) / 60000)
    console.log(`  oldest unsent: ${health.oldestUnsentAt.toISOString()} (${ageMin} min ago)`)
  }
  console.log('')

  console.log('Chains:')
  if (health.chains.length === 0) console.log('  (none)')
  for (const c of health.chains) {
    const mark = c.contiguous ? 'ok' : 'GAP'
    console.log(`  ${c.issuerNif.padEnd(14)} ${c.recordCount}/${c.lastChainSeq}  ${mark}`)
  }
  console.log('')

  if (health.unresolvedEsIssuers.length > 0) {
    console.log(`Spanish issuers with NO taxRegion (${health.unresolvedEsIssuers.length}):`)
    for (const i of health.unresolvedEsIssuers) {
      console.log(
        `  ${(i.issuerNif ?? '(no nif)').padEnd(14)} ${i.invoiceCount} invoice(s) out of scope`,
      )
    }
    console.log('')
    console.log(
      'These are NOT counted as unfiled, because an unclassified issuer never owed a record —\n' +
        'which is exactly why they are called out separately. Set PartnerAccount.taxRegion (the\n' +
        'province of the fiscal domicile) in admin; a foral region (VI/BI/SS/NA) is TicketBAI and\n' +
        'stays out of scope deliberately.',
    )
    console.log('')
  }

  if (health.unfiled.length > 0) {
    console.log(`Invoices with NO record (${health.unfiled.length}):`)
    for (const inv of health.unfiled) {
      console.log(
        `  ${(inv.invoiceNumber ?? '(no number)').padEnd(24)} ${inv.issuerType.padEnd(8)} ` +
          `${(inv.issuerNif ?? '(no nif)').padEnd(14)} ${inv.invoicedAt.toISOString().slice(0, 10)}`,
      )
    }
    console.log('')
    console.log(
      'These are Spanish invoices we are obliged to have filed. PLATFORM rows are OUR own\n' +
        'commission invoices and need no partner authorisation to fix; PARTNER rows are a\n' +
        "venue's sales. Run with --from/--to to narrow. The reason each was refused is in the\n" +
        'application log at issue time ([Verifactu] <number> cannot be filed: …).',
    )
  }

  await prisma.$disconnect()
  process.exit(health.healthy ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
