/**
 * List records that need correcting, and file a correction for one.
 *
 * Deliberately TWO commands in one, with listing as the default: a subsanación
 * re-sends corrected data, and deciding what was wrong is a judgement about why
 * AEAT objected. Auto-correcting would resend identical content and reproduce the
 * same error forever — the `/api/reconcile` failure mode this track keeps avoiding.
 *
 * Usage:
 *   npm run verifactu:subsanar:local                      # list candidates
 *   npm run verifactu:subsanar:local -- --invoice <id>    # file a correction
 *   npm run verifactu:subsanar:{test,production}
 *
 * Exit codes: 0 fine, 1 something needs attention, 2 bad usage.
 */
import prisma from '../index'
import {
  findRecordsNeedingSubsanacion,
  subsanarInvoiceStandalone,
} from '../src/tax/es-verifactu/subsanacion'
import { sistemaInformatico } from '../src/tax/es-verifactu/sistema-informatico'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const invoiceId = argValue('--invoice')

  if (!invoiceId) {
    const candidates = await findRecordsNeedingSubsanacion()
    if (candidates.length === 0) {
      console.log('No records need correcting.')
      await prisma.$disconnect()
      process.exit(0)
    }

    console.log(`${candidates.length} record(s) may need a subsanación:\n`)
    for (const c of candidates) {
      console.log(`  ${c.invoiceNumber.padEnd(24)} ${c.issuerNif.padEnd(14)} ${c.status}`)
      console.log(`    invoice: ${c.invoiceId}`)
      console.log(`    AEAT:    ${c.lastError}`)
      console.log('')
    }
    console.log(
      'A `sent` row with an error is the important case: AEAT HOLDS that record and flagged\n' +
        'defects in it, so it reads as filed everywhere else. Per the huella spec §7, a wrong\n' +
        'hash arrives exactly this way rather than as a rejection.\n\n' +
        'Fix the underlying data FIRST, then: --invoice <id>. Re-sending the same content\n' +
        'reproduces the same error.',
    )
    await prisma.$disconnect()
    process.exit(1)
  }

  const result = await subsanarInvoiceStandalone(invoiceId, sistemaInformatico())
  switch (result.status) {
    case 'created':
      console.log(`Correction filed (${result.case}). Record ${result.recordId}.`)
      console.log('It is queued; the submission sweep will send it.')
      break
    case 'already-corrected':
      console.log('This invoice has already been corrected once.')
      console.log('A second correction needs the schema change noted in subsanacion.ts.')
      break
    case 'not-found':
      console.log('No record exists for that invoice — nothing to correct.')
      break
    case 'blocked':
      console.error(`Cannot file a correction: ${result.reason}`)
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
