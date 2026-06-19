import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestRentalItem,
  createTestRentalBooking,
  resetCounter,
} from './test/fixtures'
import { getOpenTill, getTillByEmployee } from './till'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})
afterAll(async () => {
  await disconnectDatabase()
})

async function setup() {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  const site = await createTestSite(user.id)
  const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
  const rentalItem = await createTestRentalItem(site.id)
  const mkEmp = (name: string) => prisma.employee.create({ data: { accountId: user.id, name } })
  return { user, site, item, rentalItem, mkEmp }
}

const CASH_WALKIN = { status: 'paid-in-cash', operationalStatus: 'walked-in' }

describe('getOpenTill', () => {
  it('sums attributed cash walk-ins + cash rentals; excludes comps and unattributed', async () => {
    const { user, site, item, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    await createTestReservation(user.id, site.id, [item.id], { ...CASH_WALKIN, paymentAmount: 10, employeeId: alice.id })
    await createTestReservation(user.id, site.id, [item.id], { ...CASH_WALKIN, paymentAmount: 20, employeeId: alice.id })
    await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })
    // Comp (operationalStatus comp) — not cash, excluded:
    await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'comp', isComp: true, paymentAmount: 0, employeeId: alice.id })
    // Unattributed walk-in — excluded:
    await createTestReservation(user.id, site.id, [item.id], { ...CASH_WALKIN, paymentAmount: 99 })

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 45, count: 3 })
  })

  it('only counts cash taken AFTER the last close', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const now = Date.now()

    // Pre-close sale, then a close, then a post-close sale.
    await createTestReservation(user.id, site.id, [item.id], { ...CASH_WALKIN, paymentAmount: 10, employeeId: alice.id, createdAt: new Date(now - 2 * 3600_000) })
    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 3600_000), totalAmount: 10, txnCount: 1 } })
    await createTestReservation(user.id, site.id, [item.id], { ...CASH_WALKIN, paymentAmount: 30, employeeId: alice.id })

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 30, count: 1 })
  })
})

describe('getTillByEmployee', () => {
  it('breaks the day down per roster employee, zero-filled and name-sorted', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const carol = await mkEmp('Carol') // no sales → zero row

    await createTestReservation(user.id, site.id, [item.id], { ...CASH_WALKIN, paymentAmount: 10, employeeId: alice.id })
    await createTestReservation(user.id, site.id, [item.id], { ...CASH_WALKIN, paymentAmount: 20, employeeId: alice.id })
    await createTestReservation(user.id, site.id, [item.id], { ...CASH_WALKIN, paymentAmount: 5, employeeId: bob.id })

    const n = new Date()
    const from = new Date(n.getFullYear(), n.getMonth(), n.getDate())
    const to = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59)

    expect(await getTillByEmployee(site.id, from, to)).toEqual([
      { employeeId: alice.id, name: 'Alice', active: true, total: 30, count: 2 },
      { employeeId: bob.id, name: 'Bob', active: true, total: 5, count: 1 },
      { employeeId: carol.id, name: 'Carol', active: true, total: 0, count: 0 },
    ])
  })
})
