/**
 * Void a Veri*factu record — the invoice should never have been issued.
 *
 * Requires BOTH `--invoice` and `--confirm`, because this is not a correction:
 * it tells AEAT a record should not exist. Used on a sale that really happened,
 * it erases the evidence of it.
 *
 * NOT for a refund. Money going back does not undo the sale — that is a credit
 * note, which `payment.ts` already files as a rectificativa. NOT for a wrong
 * record either; that is `npm run verifactu:subsanar:*`.
 *
 * Usage:
 *   npm run verifactu:anular:local -- --invoice <id>              # dry run
 *   npm run verifactu:anular:local -- --invoice <id> --confirm    # file it
 *
 * Exit codes: 0 filed (or dry run fine), 1 refused, 2 bad usage.
 */
import prisma from '../index'
import { anularInvoiceStandalone, planAnulacion } from '../src/tax/es-verifactu/anulacion'
import { sistemaInformatico } from '../src/tax/es-verifactu/sistema-informatico'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const invoiceId = argValue('--invoice')
  if (!invoiceId) {
    console.error('Usage: --invoice <invoiceId> [--confirm]')
    await prisma.$disconnect()
    process.exit(2)
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { invoiceNumber: true, issuerVatNumber: true, totalAmount: true, invoicedAt: true },
  })
  if (!invoice) {
    console.error('No such invoice.')
    await prisma.$disconnect()
    process.exit(1)
  }

  const records = await prisma.verifactuRecord.findMany({
    where: { invoiceId },
    orderBy: { chainSeq: 'desc' },
    select: { status: true, recordType: true, chainSeq: true },
  })

  console.log(`Invoice ${invoice.invoiceNumber ?? invoiceId}`)
  console.log(`  issuer ${invoice.issuerVatNumber ?? '(none)'}`)
  console.log(`  total  ${invoice.totalAmount.toFixed(2)}`)
  console.log(`  dated  ${invoice.invoicedAt.toISOString().slice(0, 10)}`)
  console.log('  records:')
  if (records.length === 0) console.log('    (none — nothing to void)')
  for (const r of records) {
    console.log(`    #${r.chainSeq} ${r.recordType.padEnd(12)} ${r.status}`)
  }

  const plan = planAnulacion(records)
  console.log('')
  console.log(
    `  would file: SinRegistroPrevio=${plan.sinRegistroPrevio ?? '(absent)'} ` +
      `RechazoPrevio=${plan.rechazoPrevio ?? '(absent)'}`,
  )

  if (!process.argv.includes('--confirm')) {
    console.log('')
    console.log('Dry run. Re-run with --confirm to file it.')
    console.log(
      'Reminder: an annulment says this invoice should NEVER have existed. For a refund\n' +
        'use a credit note; for a wrong record use verifactu:subsanar.',
    )
    await prisma.$disconnect()
    process.exit(0)
  }

  const result = await anularInvoiceStandalone(invoiceId, sistemaInformatico())
  switch (result.status) {
    case 'created':
      console.log(`\nAnnulment filed. Record ${result.recordId}. Queued for the sweep.`)
      break
    case 'already-annulled':
      console.log('\nAEAT has already accepted an annulment for this invoice.')
      break
    case 'not-found':
      console.log('\nNo record exists for this invoice — nothing to void.')
      break
    case 'out-of-scope':
      console.log('\nThis issuer is not a Spanish Veri*factu filer; no record was ever owed.')
      break
    case 'blocked':
      console.error(`\nCannot file: ${result.reason}`)
      break
  }

  await prisma.$disconnect()
  process.exit(result.status === 'created' ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
