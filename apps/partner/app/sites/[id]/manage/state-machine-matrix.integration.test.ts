/**
 * Reservation state-machine MATRIX — real partner actions driven through the
 * signed-off transition table (track 018, P3).
 *
 * Requirements source: @repo/data/reservation-machine (TRANSITIONS — the
 * contract) + `.claude/tracks/018-state-machine-intended.md`.
 *
 * Three cell colors:
 *   GREEN — the action already behaves as the table demands. Plain `it`; the
 *     expected post-state comes from `resolveTransition`, NOT hand-written.
 *   RED — a known divergence (bug ledger B-/D-items). Written with `it.fails`: the
 *     test PASSES while the bug exists and STARTS FAILING the moment a P4
 *     migration fixes the action — forcing the cell to be flipped to green.
 *     Never delete a red cell; flip it.
 *   DEFERRED — events with no cell yet, each with a reason, asserted
 *     exhaustively so a new table event forces a classification here.
 *
 * State is always read via deriveState (the ONE derivation) against the DB.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
} from '@/app/test/fixtures'

let mockUserId: string | null = null

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  reserveItems,
  unreserveItem,
  settleReservation,
  checkInReservation,
  resumeWalkIn,
  undoDepartWalkIn,
  markDeparted,
  markNoShow,
  holdBeds,
  releaseHold,
  convertHoldToWalkIn,
  splitWalkInSeat,
} from './actions'
import {
  deriveState,
  resolveTransition,
  EVENTS,
  type CompoundState,
  type EventName,
} from '@repo/data/reservation-machine'
import { siteDayKey, siteDayBounds } from '@repo/data/site-day'

// ─── Harness ─────────────────────────────────────────────────────────────────

let user: Awaited<ReturnType<typeof createTestUser>>
let site: Awaited<ReturnType<typeof createTestSite>>

const siteTz = () => ({
  timeZone: site.timeZone,
  latitude: site.locationLat ? parseFloat(site.locationLat) : undefined,
  longitude: site.locationLng ? parseFloat(site.locationLng) : undefined,
})

beforeEach(async () => {
  await cleanDatabase()
  user = await createTestUser()
  await createTestPartnerAccount(user.id)
  site = await createTestSite(user.id, { type: 'paid', price: 10 })
  mockUserId = user.id
})

afterAll(async () => {
  await disconnectDatabase()
})

/** THE derivation, read from the DB — same inputs the machine interpreter uses. */
async function stateOf(reservationId: string): Promise<CompoundState | null> {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { tillEntries: { select: { voidedAt: true } } },
  })
  if (!r) return null
  const day = await prisma.reservationDay.findUnique({
    where: {
      reservationId_date: { reservationId, date: new Date(siteDayKey(siteTz())) },
    },
    select: { operationalStatus: true },
  })
  return deriveState({
    status: r.status,
    operationalStatus: r.operationalStatus,
    todayOperationalStatus: day?.operationalStatus ?? null,
    isComp: r.isComp,
    settled: r.tillEntries.some((e) => e.voidedAt === null),
  })
}

/** Expected post-state per the TABLE (unspecified axes carry over from pre). */
function tablePost(pre: CompoundState, event: EventName, conds: Parameters<typeof resolveTransition>[2] = []) {
  const row = resolveTransition(pre, event, conds)
  expect(row, `table has no row for ${event} from ${JSON.stringify(pre)} [${conds}]`).not.toBeNull()
  return {
    kind: row!.post.kind ?? pre.kind,
    pay: row!.post.pay ?? pre.pay,
    occ: row!.post.occ ?? pre.occ,
    deleted: row!.post.deleted === true,
  }
}

const expectState = (actual: CompoundState | null, expected: { kind: string; pay: string; occ: string }) => {
  expect(actual).not.toBeNull()
  expect({ kind: actual!.kind, pay: actual!.pay, occ: actual!.occ })
    .toEqual({ kind: expected.kind, pay: expected.pay, occ: expected.occ })
}

async function nSeats(n: number, startNumber = 1) {
  const items = []
  for (let i = 0; i < n; i++) {
    items.push(await createTestInventoryItem(user.id, site.id, { number: startNumber + i, price: 10 }))
  }
  return items
}

/** Real-flow cash walk-in: created via the actual action (settled ⇒ till + receipt). */
async function cashWalkIn(n: number, opts: { settled?: boolean; until?: string } = {}) {
  const items = await nSeats(n)
  const r = await reserveItems(
    site.id, items.map((i) => i.id), 'Guest', undefined, undefined, opts.until, undefined,
    opts.settled ?? true,
  )
  expect(r.status).toBe('ok')
  return { reservationId: (r as { reservationId: string }).reservationId, items }
}

const activeTillSum = async (reservationId: string) => {
  const agg = await prisma.tillEntry.aggregate({
    where: { reservationId, voidedAt: null },
    _sum: { amount: true },
  })
  return agg._sum.amount ?? 0
}

const tomorrowStr = () => {
  const d = new Date(Date.now() + 24 * 3600_000)
  return d.toISOString().slice(0, 10)
}

// ─── GREEN cells — action behavior matches the table ─────────────────────────

describe('GREEN cells (table ⇔ action agree)', () => {
  it('staff.walkIn.cash → walkin·settled·present, till + receipt recorded', async () => {
    const { reservationId } = await cashWalkIn(2)
    const post = tablePost(null as never, 'staff.walkIn.cash')
    expectState(await stateOf(reservationId), post)
    expect(await activeTillSum(reservationId)).toBe(20)
    expect(await prisma.invoice.count({ where: { reservationId } })).toBe(1) // PARTNER receipt
  })

  it('staff.walkIn.card → walkin·unsettled·present, NO till entry', async () => {
    const { reservationId } = await cashWalkIn(1, { settled: false })
    expectState(await stateOf(reservationId), tablePost(null as never, 'staff.walkIn.card'))
    expect(await activeTillSum(reservationId)).toBe(0)
  })

  it('staff.settle: unsettled → settled with till entry', async () => {
    const { reservationId } = await cashWalkIn(1, { settled: false })
    const pre = (await stateOf(reservationId))!
    const res = await settleReservation(site.id, reservationId, 10)
    expect(res.status).toBe('ok')
    expectState(await stateOf(reservationId), tablePost(pre, 'staff.settle'))
    expect(await activeTillSum(reservationId)).toBe(10)
  })

  it('staff.depart (lastDay): settled walkin → departed, money untouched', async () => {
    const { reservationId } = await cashWalkIn(1)
    const pre = (await stateOf(reservationId))!
    expect((await markDeparted(site.id, reservationId)).status).toBe('ok')
    expectState(await stateOf(reservationId), tablePost(pre, 'staff.depart', ['lastDay']))
    expect(await activeTillSum(reservationId)).toBe(10)
  })

  it('staff.depart (hasFutureDays): multiday walkin cycles to expected', async () => {
    const { reservationId } = await cashWalkIn(1, { until: tomorrowStr() })
    const pre = (await stateOf(reservationId))!
    expect((await markDeparted(site.id, reservationId)).status).toBe('ok')
    expectState(await stateOf(reservationId), tablePost(pre, 'staff.depart', ['hasFutureDays']))
  })

  it('staff.resume: between-days walkin re-seats without new money', async () => {
    const { reservationId } = await cashWalkIn(1, { until: tomorrowStr() })
    await markDeparted(site.id, reservationId) // → expected (between days)
    const pre = (await stateOf(reservationId))!
    expect(pre.occ).toBe('expected')
    expect((await resumeWalkIn(site.id, reservationId)).status).toBe('ok')
    expectState(await stateOf(reservationId), tablePost(pre, 'staff.resume'))
    expect(await activeTillSum(reservationId)).toBe(20) // 2 civil days × €10 — unchanged by resume
  })

  it('staff.resume.undoDepart: same-day departed walk-in re-seats, till untouched (P4 slice 2 capability)', async () => {
    const { reservationId } = await cashWalkIn(1)
    await markDeparted(site.id, reservationId) // lastDay → departed
    const pre = (await stateOf(reservationId))!
    expect(pre.occ).toBe('departed')

    expect((await undoDepartWalkIn(site.id, reservationId)).status).toBe('ok')
    expectState(await stateOf(reservationId), tablePost(pre, 'staff.resume.undoDepart', ['sameCivilDay']))
    expect(await activeTillSum(reservationId)).toBe(10)
  })

  it('staff.resume.undoDepart: conflicts when the freed bed was re-let in between', async () => {
    const { reservationId, items } = await cashWalkIn(1)
    await markDeparted(site.id, reservationId)
    // Re-let the same seat to a new party
    const relet = await reserveItems(site.id, [items[0]!.id], 'NewGuest', undefined, undefined, undefined, undefined, true)
    expect(relet.status).toBe('ok')

    const res = await undoDepartWalkIn(site.id, reservationId)
    expect(res.status).toBe('error')
    expect((await stateOf(reservationId))!.occ).toBe('departed') // unchanged
  })

  it('staff.checkIn: online·complete·expected → present', async () => {
    const [item] = await nSeats(1)
    const { start, end } = siteDayBounds(siteTz())
    const online = await createTestReservation(user.id, site.id, [item!.id], {
      status: 'complete', operationalStatus: 'expected', from: start, to: end,
    })
    const pre = (await stateOf(online.id))!
    expect((await checkInReservation(site.id, online.id)).status).toBe('ok')
    expectState(await stateOf(online.id), tablePost(pre, 'staff.checkIn'))
  })

  it('staff.noShow: online·complete·expected → no-show', async () => {
    const [item] = await nSeats(1)
    const { start, end } = siteDayBounds(siteTz())
    const online = await createTestReservation(user.id, site.id, [item!.id], {
      status: 'complete', operationalStatus: 'expected', from: start, to: end,
    })
    const pre = (await stateOf(online.id))!
    expect((await markNoShow(site.id, online.id)).status).toBe('ok')
    expectState(await stateOf(online.id), tablePost(pre, 'staff.noShow'))
  })

  it('staff.hold → hold·none·expected; staff.releaseHold deletes (zero-money, I4-legal)', async () => {
    const items = await nSeats(1)
    expect((await holdBeds(site.id, [items[0]!.id])).status).toBe('ok')
    const hold = await prisma.reservation.findFirstOrThrow({ where: { status: 'held' } })
    expectState(await stateOf(hold.id), tablePost(null as never, 'staff.hold'))

    const pre = (await stateOf(hold.id))!
    expect(tablePost(pre, 'staff.releaseHold').deleted).toBe(true)
    expect((await releaseHold(site.id, items[0]!.id)).status).toBe('ok')
    expect(await stateOf(hold.id)).toBeNull()
  })

  it('convert.holdToWalkIn.whole (cash): hold → walkin·settled·present with till', async () => {
    const items = await nSeats(1)
    await holdBeds(site.id, [items[0]!.id])
    const hold = await prisma.reservation.findFirstOrThrow({ where: { status: 'held' } })
    const pre = (await stateOf(hold.id))!
    const res = await convertHoldToWalkIn(
      site.id, items[0]!.id, undefined, undefined, undefined, undefined, true, undefined, true,
    )
    expect(res.status).toBe('ok')
    expectState(await stateOf(hold.id), tablePost(pre, 'convert.holdToWalkIn.whole', ['cash']))
    expect(await activeTillSum(hold.id)).toBe(10)
  })
})

// ─── Formerly-RED cells — the bug ledger, flipped GREEN by P4 slice 1 ────────
//     (unreserveItem / markDeparted split / splitWalkInSeat / checkInReservation
//     migrated onto applyTransition on 2026-08-11). Kept in their own block as
//     the permanent regression record of B1a/B1b/B1c, D12, D2, D10.

describe('Formerly-RED cells (bug ledger — fixed by the P4 slice-1 migration)', () => {
  it('B1a: depart-split — the peeled party must keep its settled pay-phase', async () => {
    const { reservationId, items } = await cashWalkIn(4) // €40 settled
    const subset = items.slice(0, 2).map((i) => i.id)
    expect((await markDeparted(site.id, reservationId, undefined, subset)).status).toBe('ok')

    const peeled = await prisma.reservation.findFirstOrThrow({
      where: { id: { not: reservationId }, items: { some: { id: subset[0]! } } },
    })
    // Table: split.subset carries tillPartition — the peeled reservation stays settled.
    expect((await stateOf(peeled.id))!.pay).toBe('settled')
  })

  it('B1b: depart-split — till evidence must partition with the seats (I1)', async () => {
    const { reservationId, items } = await cashWalkIn(4) // €40, one entry on the original
    await markDeparted(site.id, reservationId, undefined, items.slice(0, 2).map((i) => i.id))
    // Table: original keeps exactly its remaining share (€20), not the full €40.
    expect(await activeTillSum(reservationId)).toBe(20)
  })

  it('B1c: splitWalkInSeat — the peeled seat must carry its till share', async () => {
    const { reservationId, items } = await cashWalkIn(2) // €20 settled
    const res = await splitWalkInSeat(site.id, reservationId, items[0]!.id)
    expect(res.status).toBe('ok')
    const newId = (res as { reservationId: string }).reservationId
    expect((await stateOf(newId))!.pay).toBe('settled')
    expect(await activeTillSum(newId)).toBe(10)
  })

  it('D12/I4: refund-unreserve must KEEP the money row as refunded + credit note', async () => {
    const { reservationId, items } = await cashWalkIn(1) // settled, receipted
    expect((await unreserveItem(site.id, items[0]!.id)).status).toBe('ok')
    // Table: walkin·settled --unreserve.whole--> refunded, kept:true, creditNoteIssue.
    const after = await prisma.reservation.findUnique({ where: { id: reservationId } })
    expect(after).not.toBeNull() // currently: hard-deleted
    expect(after!.status).toBe('refunded')
    expect(
      await prisma.invoice.count({ where: { reservationId, creditsInvoiceId: { not: null } } }),
    ).toBe(1)
  })

  it('D2: seat-mode unreserve must move the freed seat’s cash out of the till (partition)', async () => {
    const { reservationId, items } = await cashWalkIn(2) // €20 settled
    expect((await unreserveItem(site.id, items[0]!.id, undefined, false)).status).toBe('ok')
    // Table: seatDisconnect + tillPartition — original keeps €10; today the full €20 stays.
    expect(await activeTillSum(reservationId)).toBe(10)
  })

  it('D10: check-in must reject a hold (kind guard)', async () => {
    const items = await nSeats(1)
    await holdBeds(site.id, [items[0]!.id])
    const hold = await prisma.reservation.findFirstOrThrow({ where: { status: 'held' } })
    // Table: staff.checkIn has no row for kind=hold → the action must error.
    expect(resolveTransition((await stateOf(hold.id))!, 'staff.checkIn')).toBeNull()
    expect((await checkInReservation(site.id, hold.id)).status).toBe('error')
  })
})

// ─── Coverage manifest — every table event is covered or explicitly deferred ──

const COVERED: EventName[] = [
  'staff.walkIn.cash', 'staff.walkIn.card', 'staff.settle', 'staff.depart',
  'staff.resume', 'staff.checkIn', 'staff.noShow', 'staff.hold',
  'staff.releaseHold', 'convert.holdToWalkIn.whole', 'staff.unreserve.whole',
  'staff.resume.undoDepart',
  'staff.unreserve.seat', 'split.subset',
]

/** Shrink-only: move an event to COVERED when its cells land. Never grows silently. */
const DEFERRED: Record<string, string> = {
  'consumer.book.paid': 'consumer app action — user-app matrix (P4 scope)',
  'consumer.book.free': 'consumer app action — user-app matrix (P4 scope)',
  'staff.comp': 'same create+delete shape as hold; cells with P4 comp migration',
  'staff.block': 'same create+delete shape as hold; cells with P4 block migration',
  'pay.initiate': 'payment rail — Mollie/demo env harness needed',
  'pay.initiate.fail': 'payment rail — Mollie/demo env harness needed',
  'collect.start': 'D6 cell needs demo-mode module reload (DEMO_MODE captured at import)',
  'pay.confirm': 'payment rail — webhook/poll drivers live in user app',
  'pay.fail': 'payment rail — webhook/poll drivers live in user app',
  'collect.abandon': 'D5 cell needs Mollie cancel stub — with collect migration (P4)',
  'pay.refund.webhook': 'user-app webhook driver',
  'staff.move': 'covered by existing moveReservation action tests; matrix cells with P4',
  'convert.holdToWalkIn.subset': 'subset-convert cells with P4 convert migration',
  'staff.uncomp': 'with staff.comp cells',
  'staff.unblock': 'with staff.block cells',
  'partner.cancel': 'refund/cancel decoupling cells with P4 cancel migration',
  'partner.refund': 'needs Mollie refund stub',
  'user.cancel': 'consumer app action — user-app matrix',
  'staff.removeFailed': 'trivial delete; cells with P4',
  'cron.gc': 'cron route driver — cells with P4 cron migration (I4 sweep change)',
}

describe('matrix coverage manifest', () => {
  it('every table event is exactly one of COVERED / DEFERRED', () => {
    const covered = new Set<string>(COVERED)
    const deferred = new Set(Object.keys(DEFERRED))
    for (const e of EVENTS) {
      const inC = covered.has(e)
      const inD = deferred.has(e)
      expect(inC || inD, `event ${e} is unclassified — add matrix cells or defer with a reason`).toBe(true)
      expect(inC && inD, `event ${e} is both covered and deferred`).toBe(false)
    }
    for (const e of [...covered, ...deferred]) {
      expect(EVENTS as readonly string[]).toContain(e)
    }
  })
})
