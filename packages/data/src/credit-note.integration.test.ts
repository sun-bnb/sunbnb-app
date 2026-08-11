/**
 * issueCashCreditNote — integration tests (track 018 P2d / track 015 deferred).
 *
 * Requirements: `.claude/tracks/018-state-machine-intended.md` — invariant I2
 * (Σ receipts − Σ credit notes ≡ Σ non-voided till entries over a lineage),
 * decision record §6.2 (cash refund → credit note; receipts immutable).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  resetCounter,
} from './test/fixtures'
import { processConfirmedReservation, issueCashCreditNote } from './payment'
import { siteDayBounds } from './site-day'

const HELSINKI = { latitude: 60.1699, longitude: 24.9384 }

let user: Awaited<ReturnType<typeof createTestUser>>
let site: Awaited<ReturnType<typeof createTestSite>>

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  user = await createTestUser()
  await createTestPartnerAccount(user.id)
  site = await createTestSite(user.id, { type: 'paid', price: 10 })
})

afterAll(async () => {
  await disconnectDatabase()
})

/** A settled cash walk-in WITH its PARTNER receipt issued. */
async function receiptedWalkIn(amount = 20, seats = 2) {
  const { start, end } = siteDayBounds(HELSINKI)
  const items = []
  for (let i = 0; i < seats; i++) {
    items.push(await createTestInventoryItem(user.id, site.id, { number: i + 1, price: amount / seats }))
  }
  const reservation = await createTestReservation(user.id, site.id, items.map((i) => i.id), {
    status: 'paid-in-cash',
    operationalStatus: 'walked-in',
    paymentRef: null,
    paymentAmount: amount,
    from: start,
    to: end,
  })
  await processConfirmedReservation(reservation.id, { skipCommission: true, skipEmail: true })
  const receipt = await prisma.invoice.findFirstOrThrow({
    where: { reservationId: reservation.id, issuerType: 'PARTNER' },
  })
  return { reservation, receipt }
}

describe('issueCashCreditNote', () => {
  it('full credit: negative twin of the receipt, own CN series, linked and chained', async () => {
    const { reservation, receipt } = await receiptedWalkIn(20)

    const result = await issueCashCreditNote(reservation.id)
    expect(result.status).toBe('created')
    if (result.status !== 'created') return

    const cn = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { invoiceLines: true },
    })
    expect(cn.creditsInvoiceId).toBe(receipt.id)
    expect(cn.totalAmount).toBe(-20)
    expect(cn.issuerType).toBe('PARTNER')
    expect(cn.invoiceNumber).toMatch(/^PARTNER-CN-\d{4}-00001$/)
    // Internal consistency: base + VAT = total (negated reverse-VAT)
    expect(cn.totalCharge + cn.totalTax).toBeCloseTo(cn.totalAmount, 2)
    // Proportional to the receipt's own effective VAT
    expect(cn.totalTax).toBeCloseTo(-receipt.totalTax, 2)
    // Shares the PARTNER hash chain: CN links back to the receipt's hash
    expect(cn.previousHash).toBe(receipt.hash)
    expect(cn.hash).toBeTruthy()
    // One negative line referencing the original document
    expect(cn.invoiceLines).toHaveLength(1)
    expect(cn.invoiceLines[0]!.amount).toBe(-20)
    expect(cn.invoiceLines[0]!.description).toContain(receipt.invoiceNumber!)
  })

  it('is idempotent once fully credited', async () => {
    const { reservation } = await receiptedWalkIn(20)
    await issueCashCreditNote(reservation.id)

    const again = await issueCashCreditNote(reservation.id)
    expect(again).toEqual({ status: 'skipped', reason: 'fully-credited' })
    expect(await prisma.invoice.count({ where: { creditsInvoiceId: { not: null } } })).toBe(1)
  })

  it('partial credits accumulate and are capped at the receipt total (I2)', async () => {
    const { reservation, receipt } = await receiptedWalkIn(20)

    const first = await issueCashCreditNote(reservation.id, { amount: 5 })
    expect(first.status === 'created' && first.amount).toBe(5)

    // Requesting more than the remainder caps at it
    const second = await issueCashCreditNote(reservation.id, { amount: 20 })
    expect(second.status === 'created' && second.amount).toBe(15)

    const third = await issueCashCreditNote(reservation.id, { amount: 1 })
    expect(third).toEqual({ status: 'skipped', reason: 'fully-credited' })

    const credited = await prisma.invoice.aggregate({
      where: { creditsInvoiceId: receipt.id },
      _sum: { totalAmount: true },
    })
    expect(credited._sum.totalAmount).toBeCloseTo(-20, 2) // exactly nets the receipt
  })

  it('skips cleanly when there is no receipt (pre-track-015 rows, failed receipt issue)', async () => {
    const { start, end } = siteDayBounds(HELSINKI)
    const item = await createTestInventoryItem(user.id, site.id, { number: 9 })
    const bare = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash', operationalStatus: 'walked-in', paymentRef: null,
      from: start, to: end,
    })
    expect(await issueCashCreditNote(bare.id)).toEqual({ status: 'skipped', reason: 'no-receipt' })
  })

  it('rejects a zero/negative requested amount', async () => {
    const { reservation } = await receiptedWalkIn(20)
    expect(await issueCashCreditNote(reservation.id, { amount: 0 }))
      .toEqual({ status: 'skipped', reason: 'zero-amount' })
  })

  it('CN series does not disturb the plain PARTNER receipt sequence', async () => {
    const { reservation } = await receiptedWalkIn(20) // PARTNER-YYYY-00001
    await issueCashCreditNote(reservation.id)         // PARTNER-CN-YYYY-00001

    const { receipt: second } = await receiptedWalkIn(10, 1)
    expect(second.invoiceNumber).toMatch(/^PARTNER-\d{4}-00002$/) // dense, CN-independent
  })
})
