import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import { createTestUser, createTestPartnerAccount, createTestSite, createTestReservation, resetCounter } from './test/fixtures'
import {
  reserveCappedCommission,
  takeCappedCommission,
  releaseCappedCommission,
  reverseCappedCommission,
  reverseCapForRefundedPayment,
} from './commission-cap'

const CAP = 199
const JUNE = new Date('2027-06-15T10:00:00Z')
const JULY = new Date('2027-07-01T08:00:00Z')

beforeEach(async () => {
  await prisma.commissionCapEntry.deleteMany()
  await cleanDatabase()
  resetCounter()
})
afterAll(async () => {
  await disconnectDatabase()
})

async function twoSites() {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  const a = await createTestSite(user.id)
  const b = await createTestSite(user.id)
  return { a: a.id, b: b.id }
}

describe('commission cap ledger (CR-002)', () => {
  it('below, at and above the cap; two bookings crossing it', async () => {
    const { a } = await twoSites()
    // 98 bookings of EUR 100 at 2% = 196
    for (let i = 0; i < 98; i++) {
      expect(await reserveCappedCommission({ siteId: a, sourceKey: `reservation:r${i}`, uncapped: 2, cap: CAP, at: JUNE })).toBe(2)
    }
    // crossing: 2 then 1 (196 -> 198 -> 199)
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'reservation:x1', uncapped: 2, cap: CAP, at: JUNE })).toBe(2)
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'reservation:x2', uncapped: 2, cap: CAP, at: JUNE })).toBe(1)
    // at the cap: 0
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'reservation:x3', uncapped: 2, cap: CAP, at: JUNE })).toBe(0)
    // next month starts at 0 again
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'reservation:jul1', uncapped: 2, cap: CAP, at: JULY })).toBe(2)
  })

  it('invoice reads the amount decided at charge time (collected === invoiced), idempotently', async () => {
    const { a } = await twoSites()
    await reserveCappedCommission({ siteId: a, sourceKey: 'big', uncapped: 198, cap: CAP, at: JUNE })
    const charged = await reserveCappedCommission({ siteId: a, sourceKey: 'r', uncapped: 4, cap: CAP, at: JUNE })
    expect(charged).toBe(1)
    // a retry of the same charge does not re-spend headroom
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'r', uncapped: 4, cap: CAP, at: JUNE })).toBe(1)
    // invoicing later (even after other usage changed) returns the same cents
    await releaseCappedCommission('big')
    expect(await takeCappedCommission({ siteId: a, sourceKey: 'r', uncapped: 4, cap: CAP, at: JULY })).toBe(1)
    expect(await takeCappedCommission({ siteId: a, sourceKey: 'r', uncapped: 4, cap: CAP, at: JULY })).toBe(1)
    const row = await prisma.commissionCapEntry.findUnique({ where: { sourceKey: 'r' } })
    expect(row).toMatchObject({ status: 'taken', month: '2027-06', amount: 1 })
  })

  it('a released (failed) charge gives its headroom back', async () => {
    const { a } = await twoSites()
    await reserveCappedCommission({ siteId: a, sourceKey: 'big', uncapped: 199, cap: CAP, at: JUNE })
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'r', uncapped: 2, cap: CAP, at: JUNE })).toBe(0)
    await releaseCappedCommission('big')
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'r2', uncapped: 2, cap: CAP, at: JUNE })).toBe(2)
  })

  describe('refunds that reverse commission (T-149)', () => {
    const used = async (siteId: string, month: string) =>
      (await prisma.commissionCapEntry.aggregate({
        _sum: { amount: true },
        where: { siteId, month, status: { in: ['reserved', 'taken', 'reversal'] } },
      }))._sum.amount ?? 0

    it('before the cap: the month drops by the reversed commission; the invoiced entry is unchanged', async () => {
      const { a } = await twoSites()
      await takeCappedCommission({ siteId: a, sourceKey: 'reservation:r1', uncapped: 2, cap: CAP, at: JUNE })
      await takeCappedCommission({ siteId: a, sourceKey: 'reservation:r2', uncapped: 3, cap: CAP, at: JUNE })
      expect(await used(a, '2027-06')).toBe(5)
      expect(await reverseCappedCommission({ sourceKey: 'reservation:r1', refundKey: 'full', fraction: 1 })).toBe(2)
      expect(await used(a, '2027-06')).toBe(3)
      // collected === invoiced: the payable's own entry still carries what was taken
      expect(await prisma.commissionCapEntry.findUnique({ where: { sourceKey: 'reservation:r1' } })).toMatchObject({ amount: 2, status: 'taken' })
      // idempotent: a retried refund hook reverses nothing more
      expect(await reverseCappedCommission({ sourceKey: 'reservation:r1', refundKey: 'full', fraction: 1 })).toBe(2)
      expect(await used(a, '2027-06')).toBe(3)
    })

    it('after the cap: a capped-to-zero booking reverses 0; a full-fee booking frees headroom again', async () => {
      const { a } = await twoSites()
      await takeCappedCommission({ siteId: a, sourceKey: 'reservation:big', uncapped: 199, cap: CAP, at: JUNE })
      expect(await takeCappedCommission({ siteId: a, sourceKey: 'reservation:zero', uncapped: 2, cap: CAP, at: JUNE })).toBe(0)
      expect(await reverseCappedCommission({ sourceKey: 'reservation:zero', refundKey: 'full', fraction: 1 })).toBe(0)
      expect(await used(a, '2027-06')).toBe(199)
      expect(await reserveCappedCommission({ siteId: a, sourceKey: 'reservation:n1', uncapped: 2, cap: CAP, at: JUNE })).toBe(0)
      expect(await reverseCappedCommission({ sourceKey: 'reservation:big', refundKey: 'full', fraction: 1 })).toBe(199)
      expect(await used(a, '2027-06')).toBe(0)
      expect(await reserveCappedCommission({ siteId: a, sourceKey: 'reservation:n2', uncapped: 2, cap: CAP, at: JUNE })).toBe(2)
    })

    it('partial refunds reverse pro rata and never more than was taken (month never below 0)', async () => {
      const { a } = await twoSites()
      await takeCappedCommission({ siteId: a, sourceKey: 'reservation:p', uncapped: 4, cap: CAP, at: JUNE })
      expect(await reverseCappedCommission({ sourceKey: 'reservation:p', refundKey: 're_1', fraction: 0.25 })).toBe(1)
      expect(await used(a, '2027-06')).toBe(3)
      expect(await reverseCappedCommission({ sourceKey: 'reservation:p', refundKey: 're_2', fraction: 0.5 })).toBe(2)
      // the third refund asks for 75% (3) but only 1 is left
      expect(await reverseCappedCommission({ sourceKey: 'reservation:p', refundKey: 're_3', fraction: 0.75 })).toBe(1)
      expect(await reverseCappedCommission({ sourceKey: 'reservation:p', refundKey: 're_4', fraction: 1 })).toBe(0)
      expect(await used(a, '2027-06')).toBe(0)
    })

    it('a refund in a later month lowers the original month only', async () => {
      const { a } = await twoSites()
      await takeCappedCommission({ siteId: a, sourceKey: 'reservation:jun', uncapped: 199, cap: CAP, at: JUNE })
      await takeCappedCommission({ siteId: a, sourceKey: 'reservation:jul', uncapped: 5, cap: CAP, at: JULY })
      // refunded in July (the ledger month comes from the entry, not the refund date)
      expect(await reverseCappedCommission({ sourceKey: 'reservation:jun', refundKey: 'full', fraction: 1 })).toBe(199)
      expect(await used(a, '2027-06')).toBe(0)
      expect(await used(a, '2027-07')).toBe(5)
    })

    it('by payment ref: Stripe and Viva reverse; Mollie keeps its fee; rentals key on the lowest booking id', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const mk = (paymentRef: string) =>
        createTestReservation(user.id, site.id, [], { status: 'complete', paymentRef })
      const stripe = await mk('stripe_cs_cs_t149')
      const viva = await mk('vso_123456789')
      const mollie = await mk('tr_t149mollie')
      for (const r of [stripe, viva, mollie]) {
        await takeCappedCommission({ siteId: site.id, sourceKey: `reservation:${r.id}`, uncapped: 2, cap: CAP, at: JUNE })
      }
      expect(await reverseCapForRefundedPayment('stripe_cs_cs_t149')).toBe(2)
      expect(await reverseCapForRefundedPayment('vso_123456789')).toBe(2)
      expect(await reverseCapForRefundedPayment('tr_t149mollie')).toBe(0)
      expect(await reverseCapForRefundedPayment('pi_demo_1')).toBe(0)
      expect(await reverseCapForRefundedPayment('stripe_cs_unknown')).toBe(0)
      expect(await used(site.id, '2027-06')).toBe(2)
    })
  })

  it('the cap is per site, not per account', async () => {
    const { a, b } = await twoSites()
    await reserveCappedCommission({ siteId: a, sourceKey: 'a-big', uncapped: 199, cap: CAP, at: JUNE })
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'a-1', uncapped: 2, cap: CAP, at: JUNE })).toBe(0)
    expect(await reserveCappedCommission({ siteId: b, sourceKey: 'b-1', uncapped: 2, cap: CAP, at: JUNE })).toBe(2)
  })

  it('concurrent charges never exceed the cap', async () => {
    const { a } = await twoSites()
    await reserveCappedCommission({ siteId: a, sourceKey: 'big', uncapped: 190, cap: CAP, at: JUNE })
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        reserveCappedCommission({ siteId: a, sourceKey: `c${i}`, uncapped: 2, cap: CAP, at: JUNE }),
      ),
    )
    expect(results.reduce((s, x) => s + x, 0)).toBe(9)
  })

  it('no cap: passes through and writes no ledger row', async () => {
    const { a } = await twoSites()
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'n', uncapped: 7.5, cap: null, at: JUNE })).toBe(7.5)
    expect(await prisma.commissionCapEntry.count()).toBe(0)
  })
})
