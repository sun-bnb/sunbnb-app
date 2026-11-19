import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import { createTestUser, createTestPartnerAccount, createTestSite, resetCounter } from './test/fixtures'
import {
  reserveCappedCommission,
  takeCappedCommission,
  releaseCappedCommission,
  reverseCappedCommission,
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

  it('a refund that reverses commission reduces the month usage', async () => {
    const { a } = await twoSites()
    await takeCappedCommission({ siteId: a, sourceKey: 'big', uncapped: 199, cap: CAP, at: JUNE })
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'r1', uncapped: 2, cap: CAP, at: JUNE })).toBe(0)
    await reverseCappedCommission('big', 10)
    expect(await reserveCappedCommission({ siteId: a, sourceKey: 'r2', uncapped: 2, cap: CAP, at: JUNE })).toBe(2)
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
