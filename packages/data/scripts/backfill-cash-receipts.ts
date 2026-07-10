/**
 * Backfill PARTNER cash receipts for existing cash sales that have no invoice.
 *
 * Processes three groups sequentially (reservation → rental → order) so that
 * invoice numbering remains deterministic and serial within each issuer type.
 *
 * IMPORTANT: This creates real legal invoices. Always run with --dry-run first.
 *
 * Usage:
 *   # Dry-run (count + list candidates, no writes):
 *   npx tsx scripts/backfill-cash-receipts.ts --dry-run
 *
 *   # Live run:
 *   npx tsx scripts/backfill-cash-receipts.ts
 *
 *   # The npm scripts below set POSTGRES_URL via with-db-url.sh:
 *   npm run backfill:cash:local:dry
 *   npm run backfill:cash:local
 *   npm run backfill:cash:test:dry
 *   npm run backfill:cash:test
 *   npm run backfill:cash:production:dry
 *   npm run backfill:cash:production
 */

import prisma from '../index'
import {
  processConfirmedReservation,
  processCashRentalBooking,
  processConfirmedOrder,
} from '../src/payment'

// ── CLI / env flags ──────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run') || process.env.DRY_RUN === '1'

// ── Helpers ──────────────────────────────────────────────────────────────────

function maskDbUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return '(invalid URL)'
  }
}

interface CandidateRow {
  id: string
  createdAt: Date
  paymentAmount: number
}

interface GroupResult {
  group: string
  candidates: CandidateRow[]
  created: number
  skipped: number
  errors: Array<{ id: string; error: string }>
}

// ── Group 1: Cash Reservations ────────────────────────────────────────────────
//
// WHERE:
//   status = 'paid-in-cash'
//   paymentAmount > 0
//   isComp = false
//   operationalStatus NOT IN ('blocked')   -- blocked beds are stored as paid-in-cash + blocked
//   refundedAt IS NULL
//   No existing PARTNER invoice for this reservationId

async function findCashReservations(): Promise<CandidateRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; createdAt: Date; payment_amount: number }>
  >`
    SELECT r.id, r."createdAt", r.payment_amount
    FROM "Reservation" r
    WHERE r.status = 'paid-in-cash'
      AND r.payment_amount > 0
      AND r.is_comp = false
      AND r.operational_status NOT IN ('blocked')
      AND r.refunded_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Invoice" i
        WHERE i.reservation_id = r.id
          AND i.issuer_type = 'PARTNER'
      )
    ORDER BY r."createdAt" ASC
  `
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    paymentAmount: r.payment_amount,
  }))
}

async function processReservationGroup(): Promise<GroupResult> {
  const candidates = await findCashReservations()
  const result: GroupResult = {
    group: 'Cash Reservations',
    candidates,
    created: 0,
    skipped: 0,
    errors: [],
  }

  if (DRY_RUN) return result

  for (const r of candidates) {
    try {
      await processConfirmedReservation(r.id, {
        skipCommission: true,
        invoicedAt: r.createdAt,
        skipEmail: true, // backfill: never email customers about historical sales
      })
      result.created++
    } catch (err) {
      result.errors.push({
        id: r.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Verify: re-query to find how many were already-invoiced (i.e. the function
  // skipped them as idempotent). created + skipped should equal candidates.length.
  // A cheaper approach: track pre/post invoice counts. Here we trust the
  // processConfirmedReservation idempotency — skipped = candidates - created - errors.
  result.skipped =
    candidates.length - result.created - result.errors.length

  return result
}

// ── Group 2: Cash Rental Bookings ─────────────────────────────────────────────
//
// WHERE:
//   status = 'paid-in-cash'
//   paymentAmount > 0
//   No existing invoice with paymentRef = 'cash-rental-' + id
//   (If the booking already has a non-null paymentRef, processCashRentalBooking
//   will use that as the ref — so we check for EITHER form.)

async function findCashRentalBookings(): Promise<CandidateRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; createdAt: Date; payment_amount: number; payment_ref: string | null }>
  >`
    SELECT rb.id, rb."createdAt", rb.payment_amount, rb.payment_ref
    FROM "RentalBooking" rb
    WHERE rb.status = 'paid-in-cash'
      AND rb.payment_amount > 0
      AND NOT EXISTS (
        SELECT 1 FROM "Invoice" i
        WHERE i.payment_ref = COALESCE(rb.payment_ref, 'cash-rental-' || rb.id)
      )
    ORDER BY rb."createdAt" ASC
  `
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    paymentAmount: r.payment_amount,
  }))
}

async function processRentalGroup(): Promise<GroupResult> {
  const candidates = await findCashRentalBookings()
  const result: GroupResult = {
    group: 'Cash Rental Bookings',
    candidates,
    created: 0,
    skipped: 0,
    errors: [],
  }

  if (DRY_RUN) return result

  for (const b of candidates) {
    try {
      await processCashRentalBooking(b.id, {
        invoicedAt: b.createdAt,
      })
      result.created++
    } catch (err) {
      result.errors.push({
        id: b.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  result.skipped =
    candidates.length - result.created - result.errors.length

  return result
}

// ── Group 3: Cash Orders ──────────────────────────────────────────────────────
//
// WHERE:
//   status = 'paid-in-cash'
//   paymentAmount > 0
//   No existing PARTNER invoice for this orderId

async function findCashOrders(): Promise<CandidateRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; createdAt: Date; payment_amount: number }>
  >`
    SELECT o.id, o."createdAt", o.payment_amount
    FROM "Order" o
    WHERE o.status = 'paid-in-cash'
      AND o.payment_amount > 0
      AND NOT EXISTS (
        SELECT 1 FROM "Invoice" i
        WHERE i.order_id = o.id
          AND i.issuer_type = 'PARTNER'
      )
    ORDER BY o."createdAt" ASC
  `
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    paymentAmount: r.payment_amount,
  }))
}

async function processOrderGroup(): Promise<GroupResult> {
  const candidates = await findCashOrders()
  const result: GroupResult = {
    group: 'Cash Orders',
    candidates,
    created: 0,
    skipped: 0,
    errors: [],
  }

  if (DRY_RUN) return result

  for (const o of candidates) {
    try {
      await processConfirmedOrder(o.id, {
        skipCommission: true,
        invoicedAt: o.createdAt,
      })
      result.created++
    } catch (err) {
      result.errors.push({
        id: o.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  result.skipped =
    candidates.length - result.created - result.errors.length

  return result
}

// ── Output helpers ────────────────────────────────────────────────────────────

function printGroupResult(r: GroupResult): void {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Group: ${r.group}`)
  console.log(`  Candidates : ${r.candidates.length}`)

  if (DRY_RUN) {
    if (r.candidates.length > 0) {
      console.log('  Would create receipts for:')
      for (const c of r.candidates) {
        console.log(
          `    ${c.id}  ${c.createdAt.toISOString().slice(0, 10)}  €${c.paymentAmount.toFixed(2)}`
        )
      }
    }
  } else {
    console.log(`  Created    : ${r.created}`)
    console.log(`  Skipped    : ${r.skipped} (already invoiced)`)
    console.log(`  Errors     : ${r.errors.length}`)
    if (r.errors.length > 0) {
      for (const e of r.errors) {
        console.log(`    ERROR ${e.id}: ${e.error}`)
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dbUrl = process.env.POSTGRES_URL ?? ''
  const dbDisplay = dbUrl ? maskDbUrl(dbUrl) : '(POSTGRES_URL not set)'

  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log(`║  backfill-cash-receipts  ${DRY_RUN ? 'DRY-RUN MODE' : 'LIVE MODE     '}              ║`)
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`DB: ${dbDisplay}`)
  console.log(
    DRY_RUN
      ? 'No writes will be performed.\n'
      : 'Writing receipts to DB...\n'
  )

  // Process groups sequentially for deterministic invoice numbering.
  const reservationResult = await processReservationGroup()
  const rentalResult = await processRentalGroup()
  const orderResult = await processOrderGroup()

  const results = [reservationResult, rentalResult, orderResult]

  for (const r of results) {
    printGroupResult(r)
  }

  // ── Summary ──
  const totalCandidates = results.reduce((sum, r) => sum + r.candidates.length, 0)
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0)

  console.log(`\n${'═'.repeat(60)}`)
  console.log('SUMMARY')
  console.log(`  Mode       : ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`)
  if (DRY_RUN) {
    console.log(`  Total candidates (would create): ${totalCandidates}`)
    console.log(
      totalCandidates === 0
        ? '  All groups already fully invoiced — nothing to backfill.'
        : '  Re-run without --dry-run to create receipts.'
    )
  } else {
    const totalCreated = results.reduce((sum, r) => sum + r.created, 0)
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0)
    console.log(`  Receipts created : ${totalCreated}`)
    console.log(`  Already invoiced : ${totalSkipped}`)
    console.log(`  Errors           : ${totalErrors}`)
  }
  console.log(`${'═'.repeat(60)}`)

  await prisma.$disconnect()

  if (totalErrors > 0) {
    console.error('\nExiting non-zero: errors occurred (see above).')
    process.exit(1)
  }
}

main().catch(async (err) => {
  console.error('Fatal error:', err)
  await prisma.$disconnect()
  process.exit(1)
})
