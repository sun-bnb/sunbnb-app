/**
 * applyTransition — DB interpreter integration tests (track 018 P2 slice 2).
 *
 * Requirements source: `.claude/tracks/018-state-machine-intended.md`.
 * These drive the interpreter against the real sunbnb_test DB and assert the
 * founder-decided behaviors END TO END — including the B1 regression (a split
 * settled party can never be re-charged) and the I4 deletable rule.
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
import { applyTransition } from './reservation-machine-apply'
import { siteDayBounds } from './site-day'
import { recordSettlement } from './till'

const HELSINKI = { latitude: 60.1699, longitude: 24.9384 }
const dayBounds = () => siteDayBounds(HELSINKI)

let user: Awaited<ReturnType<typeof createTestUser>>
let site: Awaited<ReturnType<typeof createTestSite>>

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  user = await createTestUser()
  await createTestPartnerAccount(user.id) // receipts/credit-notes need an issuer
  site = await createTestSite(user.id, { type: 'paid', price: 10 })
})

afterAll(async () => {
  await disconnectDatabase()
})

/** A cash walk-in for today on `n` seats; optionally settled with a TillEntry. */
async function walkIn(n: number, opts: { settled?: boolean; amount?: number; to?: Date } = {}) {
  const { start, end } = dayBounds()
  const items = []
  for (let i = 0; i < n; i++) {
    items.push(await createTestInventoryItem(user.id, site.id, { number: i + 1, price: 10 }))
  }
  const amount = opts.amount ?? n * 10
  const reservation = await createTestReservation(user.id, site.id, items.map((i) => i.id), {
    status: 'paid-in-cash',
    operationalStatus: 'walked-in',
    checkedInAt: new Date(),
    paymentRef: null,
    paymentAmount: amount,
    from: start,
    to: opts.to ?? end,
  })
  if (opts.settled) {
    await recordSettlement({ siteId: site.id, reservationId: reservation.id, amount })
  }
  return { reservation, items }
}

const activeTill = (reservationId?: string) =>
  prisma.tillEntry.findMany({
    where: { voidedAt: null, ...(reservationId ? { reservationId } : {}) },
    orderBy: { amount: 'asc' },
  })

// ─── staff.settle ────────────────────────────────────────────────────────────

describe('staff.settle', () => {
  it('records the till entry and a second settle is a must-reject (double-settle)', async () => {
    const { reservation } = await walkIn(2)
    const first = await applyTransition(reservation.id, 'staff.settle', { amount: 20 })
    expect(first.outcome).toBe('applied')

    const entries = await activeTill(reservation.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.amount).toBe(20)

    const second = await applyTransition(reservation.id, 'staff.settle', { amount: 20 })
    expect(second.outcome).toBe('rejected')
    expect(await activeTill(reservation.id)).toHaveLength(1)
  })
})

// ─── staff.unreserve.whole ───────────────────────────────────────────────────

describe('staff.unreserve.whole', () => {
  it('settled: row is KEPT as refunded, till voided, occupancy departed (money-rows-kept)', async () => {
    const { reservation } = await walkIn(2, { settled: true })
    const result = await applyTransition(reservation.id, 'staff.unreserve.whole')
    expect(result.outcome).toBe('applied')

    const after = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(after).not.toBeNull() // NOT deleted
    expect(after!.status).toBe('refunded')
    expect(after!.paymentRef).toBeNull()
    expect(after!.operationalStatus).toBe('departed')
    expect(await activeTill(reservation.id)).toHaveLength(0) // cash left the drawer
    // voided history preserved (refund audit)
    expect(await prisma.tillEntry.count({ where: { reservationId: reservation.id } })).toBe(1)
  })

  it('I2 end-to-end: settle issues the receipt, unreserve nets it with a credit note', async () => {
    const { reservation } = await walkIn(2) // unsettled
    expect((await applyTransition(reservation.id, 'staff.settle', { amount: 20 })).outcome).toBe('applied')

    const receipt = await prisma.invoice.findFirstOrThrow({
      where: { reservationId: reservation.id, creditsInvoiceId: null },
    })
    expect(receipt.totalAmount).toBe(20)

    expect((await applyTransition(reservation.id, 'staff.unreserve.whole')).outcome).toBe('applied')

    const cn = await prisma.invoice.findFirstOrThrow({
      where: { reservationId: reservation.id, creditsInvoiceId: receipt.id },
    })
    expect(cn.totalAmount).toBe(-20)
    // I2 over the lineage: Σ receipts − Σ credit notes == Σ non-voided till == 0
    const invoiceSum = await prisma.invoice.aggregate({
      where: { reservationId: reservation.id }, _sum: { totalAmount: true },
    })
    expect(invoiceSum._sum.totalAmount).toBeCloseTo(0, 2)
    expect(await activeTill(reservation.id)).toHaveLength(0)
  })

  it('unsettled: plain delete (zero-money row)', async () => {
    const { reservation } = await walkIn(1)
    const result = await applyTransition(reservation.id, 'staff.unreserve.whole')
    expect(result.outcome).toBe('applied')
    expect(await prisma.reservation.findUnique({ where: { id: reservation.id } })).toBeNull()
  })
})

// ─── I4 defense ──────────────────────────────────────────────────────────────

describe('I4 deletable rule', () => {
  it('cron.gc never deletes a row with till history — even voided (refund audit)', async () => {
    const { start } = dayBounds()
    const { reservation } = await walkIn(1, { to: new Date(start.getTime() - 1000) })
    // Voided entry = refund history; derived state reads unsettled.
    const entry = await recordSettlement({ siteId: site.id, reservationId: reservation.id, amount: 10 })
    await prisma.tillEntry.update({ where: { id: entry.id }, data: { voidedAt: new Date() } })
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { createdAt: new Date(Date.now() - 2 * 24 * 3600_000) },
    })

    const result = await applyTransition(reservation.id, 'cron.gc')
    expect(result.outcome).toBe('rejected')
    if (result.outcome === 'rejected') expect(result.reason).toContain('I4')
    expect(await prisma.reservation.findUnique({ where: { id: reservation.id } })).not.toBeNull()
  })

  it('cron.gc has no cell at all for a settled walk-in', async () => {
    const { start } = dayBounds()
    const { reservation } = await walkIn(1, { settled: true, to: new Date(start.getTime() - 1000) })
    const result = await applyTransition(reservation.id, 'cron.gc')
    expect(result.outcome).toBe('rejected')
  })
})

// ─── split.subset — the B1 fix ───────────────────────────────────────────────

describe('split.subset (B1: money follows the seats)', () => {
  it('partitions seats, paymentAmount, and the till; the peeled party still reads settled', async () => {
    const { reservation, items } = await walkIn(4, { settled: true }) // €40, one entry
    const subset = [items[0]!.id, items[1]!.id]

    const result = await applyTransition(reservation.id, 'split.subset', { itemIds: subset })
    expect(result.outcome).toBe('applied')
    const newId = result.outcome === 'applied' ? result.newReservationId! : ''
    expect(newId).toBeTruthy()

    // Seats partitioned (I3)
    const orig = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: { items: true } })
    const peeled = await prisma.reservation.findUnique({ where: { id: newId }, include: { items: true } })
    expect(orig!.items.map((i) => i.id).sort()).not.toEqual(expect.arrayContaining(subset))
    expect(peeled!.items.map((i) => i.id).sort()).toEqual(subset.sort())

    // Amounts partitioned, sum preserved (I7/I1)
    expect(orig!.paymentAmount! + peeled!.paymentAmount!).toBe(40)
    expect(peeled!.paymentAmount).toBe(20)

    // Lineage stamped (splitFromId) — invariants are checkable lineage-wide
    expect(peeled!.splitFromId).toBe(reservation.id)

    // Till partitioned: original entry voided, per-part entries sum to €40 (I1)
    const active = await activeTill()
    expect(active).toHaveLength(2)
    expect(active.reduce((s, e) => s + e.amount, 0)).toBe(40)
    expect(active.find((e) => e.reservationId === newId)?.amount).toBe(20)

    // THE B1 regression: the peeled party derives settled → Collect is a reject cell
    const collect = await applyTransition(newId, 'collect.start')
    expect(collect.outcome).toBe('rejected')
    // and so is a second cash settle
    expect((await applyTransition(newId, 'staff.settle', { amount: 20 })).outcome).toBe('rejected')
  })

  it('unsettled split leaves the (empty) till untouched and both parties unsettled', async () => {
    const { reservation, items } = await walkIn(2)
    const result = await applyTransition(reservation.id, 'split.subset', { itemIds: [items[0]!.id] })
    expect(result.outcome).toBe('applied')
    expect(await prisma.tillEntry.count()).toBe(0)
  })

  it('rejects a non-subset (whole selection is not a split)', async () => {
    const { reservation, items } = await walkIn(2)
    const result = await applyTransition(reservation.id, 'split.subset', { itemIds: items.map((i) => i.id) })
    expect(result.outcome).toBe('rejected')
  })
})

// ─── staff.resume.undoDepart ─────────────────────────────────────────────────

describe('staff.resume.undoDepart', () => {
  async function departedToday() {
    const { reservation, items } = await walkIn(1, { settled: true })
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { operationalStatus: 'departed', departedAt: new Date() },
    })
    return { reservation, items }
  }

  it('re-seats a same-day departed cash walk-in without new money', async () => {
    const { reservation } = await departedToday()
    const result = await applyTransition(reservation.id, 'staff.resume.undoDepart')
    expect(result.outcome).toBe('applied')
    const after = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(after!.operationalStatus).toBe('walked-in')
    expect(after!.departedAt).toBeNull()
    expect(await activeTill(reservation.id)).toHaveLength(1) // till untouched
  })

  it('conflicts when the freed bed was re-let in between', async () => {
    const { reservation, items } = await departedToday()
    const { start, end } = dayBounds()
    await createTestReservation(user.id, site.id, [items[0]!.id], {
      status: 'paid-in-cash', operationalStatus: 'walked-in', paymentRef: null,
      from: start, to: end,
    })
    const result = await applyTransition(reservation.id, 'staff.resume.undoDepart')
    expect(result.outcome).toBe('conflict')
  })

  it('is not available on a later day (no sameCivilDay fact)', async () => {
    const { reservation } = await departedToday()
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { departedAt: new Date(Date.now() - 3 * 24 * 3600_000) },
    })
    const result = await applyTransition(reservation.id, 'staff.resume.undoDepart')
    expect(result.outcome).toBe('rejected')
  })
})

// ─── staff.depart (day-cycle branches) ───────────────────────────────────────

describe('staff.depart', () => {
  it('multiday: departing mid-stay cycles to expected, bed still held', async () => {
    const { end } = dayBounds()
    const { reservation } = await walkIn(1, { settled: true, to: new Date(end.getTime() + 2 * 24 * 3600_000) })
    const result = await applyTransition(reservation.id, 'staff.depart')
    expect(result.outcome).toBe('applied')
    const after = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(after!.operationalStatus).toBe('expected')
    const today = await prisma.reservationDay.findFirst({ where: { reservationId: reservation.id } })
    expect(today!.operationalStatus).toBe('expected')
  })

  it('last day: departs terminally, money untouched', async () => {
    const { reservation } = await walkIn(1, { settled: true })
    const result = await applyTransition(reservation.id, 'staff.depart')
    expect(result.outcome).toBe('applied')
    const after = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(after!.operationalStatus).toBe('departed')
    expect(await activeTill(reservation.id)).toHaveLength(1)
  })
})

// ─── Kind-blind guard fixes (D6 / D10) at the DB level ───────────────────────

describe('kind guards', () => {
  it('D6: collect.start on a settled walk-in is rejected', async () => {
    const { reservation } = await walkIn(1, { settled: true })
    expect((await applyTransition(reservation.id, 'collect.start')).outcome).toBe('rejected')
  })

  it('D10: check-in on a hold is rejected; on a paid online booking it lands', async () => {
    const { start, end } = dayBounds()
    const item = await createTestInventoryItem(user.id, site.id, { number: 99 })
    const hold = await createTestReservation(user.id, site.id, [item.id], {
      status: 'held', operationalStatus: 'expected', paymentRef: null, from: start, to: end,
    })
    expect((await applyTransition(hold.id, 'staff.checkIn')).outcome).toBe('rejected')

    const item2 = await createTestInventoryItem(user.id, site.id, { number: 100 })
    const online = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'complete', operationalStatus: 'expected', from: start, to: end,
    })
    const result = await applyTransition(online.id, 'staff.checkIn')
    expect(result.outcome).toBe('applied')
    const after = await prisma.reservation.findUnique({ where: { id: online.id } })
    expect(after!.operationalStatus).toBe('checked-in')
  })
})

// ─── Collect flow (P4 slice e executors) ─────────────────────────────────────

describe('collect.start / collect.abandon / pay.fail', () => {
  it('collect.start (demo): unsettled walkin → collecting with demo ref, DB amount, minted anonId', async () => {
    const { reservation } = await walkIn(2) // unsettled, €10/seat, today-only
    const result = await applyTransition(reservation.id, 'collect.start', { collect: { demo: true } })
    expect(result.outcome).toBe('applied')
    if (result.outcome === 'applied') expect(result.data?.amount).toBe(20)

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('processing')
    expect(after.paymentRef).toMatch(/^pi_demo_/)
    expect(after.paymentAmount).toBe(20) // amountFromDb persisted (I7)
    expect(after.anonId).toBeTruthy() // mintAnonId
  })

  it('collect.start without provider config: effect-failed, walk-in stays unsettled cash (never stranded)', async () => {
    const { reservation } = await walkIn(1)
    const result = await applyTransition(reservation.id, 'collect.start', { collect: { demo: false } })
    expect(result.outcome).toBe('effect-failed')

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('paid-in-cash')
    expect(after.paymentRef).toBeNull()
  })

  it('collect.abandon on a demo collection: the paid race resolves as pay.confirm → collected + invoices', async () => {
    const { reservation } = await walkIn(1)
    await applyTransition(reservation.id, 'collect.start', { collect: { demo: true } })

    const result = await applyTransition(reservation.id, 'collect.abandon')
    expect(result.outcome).toBe('applied')
    if (result.outcome === 'applied') {
      expect(result.data?.paymentStatus).toBe('complete')
      expect(result.transition.event).toBe('pay.confirm') // the HONEST transition
    }

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('complete') // derive: walkin·collected
    expect(await prisma.invoice.count({ where: { reservationId: reservation.id } })).toBeGreaterThanOrEqual(1)
    // D5: the seat was NEVER freed — the row exists and stays walked-in
    expect(after.operationalStatus).toBe('walked-in')
  })

  it('pay.fail: collecting → unsettled cash with the ref cleared (bed survives)', async () => {
    const { reservation } = await walkIn(1)
    await applyTransition(reservation.id, 'collect.start', { collect: { demo: true } })

    const result = await applyTransition(reservation.id, 'pay.fail')
    expect(result.outcome).toBe('applied')

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('paid-in-cash')
    expect(after.paymentRef).toBeNull()
    expect(after.operationalStatus).toBe('walked-in')
  })
})

// ─── Bulk-refund cells: seat-unreserve on non-present cash parties ───────────

describe('staff.unreserve.seat on between-days / departed parties (bulk refund, 2026-08-12)', () => {
  it('between-days settled party: seat share partitions out, occupancy untouched', async () => {
    const { end } = dayBounds()
    const { reservation, items } = await walkIn(2, { settled: true, to: new Date(end.getTime() + 24 * 3600_000) })
    // Cycle to the between-days leg (multiday depart → expected)
    expect((await applyTransition(reservation.id, 'staff.depart')).outcome).toBe('applied')
    const before = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(before.operationalStatus).toBe('expected')

    const result = await applyTransition(reservation.id, 'staff.unreserve.seat', { itemIds: [items[0]!.id] })
    expect(result.outcome).toBe('applied')

    const after = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservation.id }, include: { items: true },
    })
    expect(after.operationalStatus).toBe('expected') // occupancy untouched
    expect(after.items).toHaveLength(1)
    // 2-seat party settled €20 (fixture: n×10 flat) → freeing one seat moves €10 out
    expect((await activeTill(reservation.id)).reduce((s, e) => s + e.amount, 0)).toBe(10)
    expect(after.paymentAmount).toBe(10)
  })
})
