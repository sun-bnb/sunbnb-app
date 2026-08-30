/**
 * Card-present (Viva) collect flow — integration tests (track 024, W8, packet A3).
 *
 * Exercises the cardPresent rows on collect.start/collect.abandon end to end
 * against the real sunbnb_test DB, using the in-process Viva stub (VIVA_MODE
 * defaults to stub — no VIVA_ISV_CLIENT_ID in the test env). `getVivaClient`
 * is wrapped (not replaced) so `createSale` calls are inspectable while every
 * other method still runs the real stub logic against the shared module-level
 * session store — the same store `stubState.resolveNow` drives.
 */
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestVivaTerminal,
  createTestSettings,
  createTestServiceFee,
  resetCounter,
} from './test/fixtures'
import { applyTransition } from './reservation-machine-apply'
import { getReservationPaymentStatus } from './reservation-payment'
import { siteDayBounds } from './site-day'
import { stubState, vivaRefFromSession, getVivaClient } from './viva'

const { createSaleSpy } = vi.hoisted(() => ({ createSaleSpy: vi.fn() }))

// vi.mock is hoisted above every import in this file (including the static
// `./viva` import above), so `getVivaClient` resolved here is already the
// wrapped version — no dynamic import needed.
vi.mock('./viva', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./viva')>()
  const client = actual.createStubVivaClient()
  return {
    ...actual,
    getVivaClient: () => ({
      ...client,
      createSale: (req: unknown) => {
        createSaleSpy(req)
        return client.createSale(req as Parameters<typeof client.createSale>[0])
      },
    }),
  }
})

const HELSINKI = { latitude: 60.1699, longitude: 24.9384 }
const dayBounds = () => siteDayBounds(HELSINKI)

let user: Awaited<ReturnType<typeof createTestUser>>
let site: Awaited<ReturnType<typeof createTestSite>>
let terminal: Awaited<ReturnType<typeof createTestVivaTerminal>>

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  createSaleSpy.mockClear()
  stubState.reset()
  user = await createTestUser()
  await createTestPartnerAccount(user.id, { vivaMerchantId: 'merchant_1' })
  site = await createTestSite(user.id, { type: 'paid', price: 10 })
  terminal = await createTestVivaTerminal(site.id)
})

afterEach(() => {
  stubState.reset()
})

afterAll(async () => {
  await disconnectDatabase()
})

/** A cash walk-in for today on `n` seats — unsettled, present, card-collectible. */
async function walkIn(n: number) {
  const { start, end } = dayBounds()
  const items = []
  for (let i = 0; i < n; i++) {
    items.push(await createTestInventoryItem(user.id, site.id, { number: i + 1, price: 10 }))
  }
  const amount = n * 10
  const reservation = await createTestReservation(user.id, site.id, items.map((i) => i.id), {
    status: 'paid-in-cash',
    operationalStatus: 'walked-in',
    checkedInAt: new Date(),
    paymentRef: null,
    paymentAmount: amount,
    from: start,
    to: end,
  })
  return { reservation, items, amount }
}

describe('collect.start card-present (Viva)', () => {
  it('writes a viva_ ref + processing, and sends the sunbed-rental cascade fee (fixed default) in cents', async () => {
    const { reservation, amount } = await walkIn(1)
    const result = await applyTransition(reservation.id, 'collect.start', {
      collect: { method: 'card', terminalId: terminal.terminalId },
    })
    expect(result.outcome).toBe('applied')
    if (result.outcome === 'applied') {
      expect(result.data?.card).toBe(true)
      expect(result.data?.sessionId).toBeTruthy()
    }

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('processing')
    expect(after.paymentRef).toMatch(/^viva_/)
    expect(after.anonId).toBeNull() // no mintAnonId on the card rail

    expect(createSaleSpy).toHaveBeenCalledTimes(1)
    const req = createSaleSpy.mock.calls[0]![0] as {
      amount: number
      terminalId: string
      cashRegisterId: string
      isvDetails: { amount: number; terminalMerchantId: string }
    }
    expect(req.amount).toBe(Math.round(amount * 100)) // €10 → 1000 cents
    expect(req.terminalId).toBe(terminal.terminalId)
    expect(req.cashRegisterId).toBe(terminal.cashRegisterId)
    expect(req.isvDetails.terminalMerchantId).toBe('merchant_1')
    expect(req.isvDetails.amount).toBe(100) // default bootstrap fee: fixed €1.00 → 100 cents
  })

  it('fee-guard failure (fee >= amount) reverts to cash, no viva ref written', async () => {
    const settings = await createTestSettings()
    // Site-level override: a 150% fee exceeds the sale amount — assertValidIsvFee rejects it.
    await createTestServiceFee(settings.id, { siteId: site.id, chargeType: 'percentage', percentage: 150 })

    const { reservation } = await walkIn(1)
    const result = await applyTransition(reservation.id, 'collect.start', {
      collect: { method: 'card', terminalId: terminal.terminalId },
    })
    expect(result.outcome).toBe('effect-failed')
    if (result.outcome === 'effect-failed') expect(result.effect).toBe('vivaSale')

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('paid-in-cash')
    expect(after.paymentRef).toBeNull()
  })

  it('missing terminalId ⇒ effect-failed, reservation stays cash', async () => {
    const { reservation } = await walkIn(1)
    const result = await applyTransition(reservation.id, 'collect.start', { collect: { method: 'card' } })
    expect(result.outcome).toBe('effect-failed')

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('paid-in-cash')
    expect(after.paymentRef).toBeNull()
  })

  it('terminal belongs to another site ⇒ effect-failed, reservation stays cash', async () => {
    const otherSite = await createTestSite(user.id, { type: 'paid', price: 10 })
    const otherTerminal = await createTestVivaTerminal(otherSite.id)
    const { reservation } = await walkIn(1)
    const result = await applyTransition(reservation.id, 'collect.start', {
      collect: { method: 'card', terminalId: otherTerminal.terminalId },
    })
    expect(result.outcome).toBe('effect-failed')
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('paid-in-cash')
  })

  it('venue has not connected Viva ⇒ effect-failed, reservation stays cash', async () => {
    const noVivaUser = await createTestUser()
    await createTestPartnerAccount(noVivaUser.id) // no vivaMerchantId
    const noVivaSite = await createTestSite(noVivaUser.id, { type: 'paid', price: 10 })
    const noVivaTerminal = await createTestVivaTerminal(noVivaSite.id)
    const item = await createTestInventoryItem(noVivaUser.id, noVivaSite.id, { number: 1, price: 10 })
    const { start, end } = dayBounds()
    const reservation = await createTestReservation(noVivaUser.id, noVivaSite.id, [item.id], {
      status: 'paid-in-cash', operationalStatus: 'walked-in', checkedInAt: new Date(),
      paymentRef: null, paymentAmount: 10, from: start, to: end,
    })

    const result = await applyTransition(reservation.id, 'collect.start', {
      collect: { method: 'card', terminalId: noVivaTerminal.terminalId },
    })
    expect(result.outcome).toBe('effect-failed')
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('paid-in-cash')
    expect(after.paymentRef).toBeNull()
  })
})

describe('collect.abandon card-present (Viva)', () => {
  it('abandon before the card is read ⇒ aborts and reverts to unsettled cash', async () => {
    const { reservation } = await walkIn(1)
    await applyTransition(reservation.id, 'collect.start', {
      collect: { method: 'card', terminalId: terminal.terminalId },
    })
    // No timer advance, no manual resolve — the stub session is still 'pending'.
    const result = await applyTransition(reservation.id, 'collect.abandon')
    expect(result.outcome).toBe('applied')
    if (result.outcome === 'applied') expect(result.data?.paymentStatus).toBe('cash')

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('paid-in-cash')
    expect(after.paymentRef).toBeNull()
    expect(after.operationalStatus).toBe('walked-in') // D5: never frees the bed
  })

  it('abandon after the card was approved ⇒ resolves as pay.confirm, complete + invoices', async () => {
    const { reservation } = await walkIn(1)
    const start = await applyTransition(reservation.id, 'collect.start', {
      collect: { method: 'card', terminalId: terminal.terminalId },
    })
    const sessionId = start.outcome === 'applied' ? (start.data?.sessionId as string) : ''
    expect(sessionId).toBeTruthy()
    stubState.resolveNow(sessionId, 'approved')

    const result = await applyTransition(reservation.id, 'collect.abandon')
    expect(result.outcome).toBe('applied')
    if (result.outcome === 'applied') {
      expect(result.data?.paymentStatus).toBe('complete')
      expect(result.transition.event).toBe('pay.confirm')
    }

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('complete')
    expect(after.operationalStatus).toBe('walked-in')
    expect(await prisma.invoice.count({ where: { reservationId: reservation.id } })).toBeGreaterThanOrEqual(1)
  })

  it('abandon while the abort cannot be resolved (ambiguous cash register) ⇒ stays processing, never reverts (the deliberate divergence)', async () => {
    // A second terminal on the same site defeats cancelReservationVivaPayment's
    // "exactly one terminal" fallback, forcing cancel.status === 'error' — the
    // same branch a real 409-in-progress abort race would land on.
    await createTestVivaTerminal(site.id)

    const { reservation } = await walkIn(1)
    await applyTransition(reservation.id, 'collect.start', {
      collect: { method: 'card', terminalId: terminal.terminalId },
    })
    // Session stays genuinely pending (never resolved) — combined with the
    // unresolvable cash register, the executor must poll, not guess.
    const result = await applyTransition(reservation.id, 'collect.abandon', {
      collect: { abortPollMs: 0 },
    })
    expect(result.outcome).toBe('applied')
    if (result.outcome === 'applied') expect(result.data?.paymentStatus).toBe('processing')

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('processing') // untouched — never reverted mid-auth
    expect(after.paymentRef).toMatch(/^viva_/)
  })
})

describe('getReservationPaymentStatus — viva branch', () => {
  it('maps session state: approved→succeeded, declined/aborted→failed, pending/unknown→neither', async () => {
    const item = await createTestInventoryItem(user.id, site.id, { number: 1, price: 10 })
    const { start, end } = dayBounds()
    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'processing', operationalStatus: 'walked-in', paymentAmount: 10,
      paymentRef: null, from: start, to: end,
    })
    const client = getVivaClient()
    const saleReq = (sessionId: string) => ({
      sessionId, terminalId: terminal.terminalId, cashRegisterId: terminal.cashRegisterId,
      amount: 1000, merchantReference: reservation.id,
      isvDetails: { amount: 50, terminalMerchantId: 'merchant_1' },
    })

    // approved
    await client.createSale(saleReq('sess-approved'))
    stubState.resolveNow('sess-approved', 'approved')
    await prisma.reservation.update({ where: { id: reservation.id }, data: { paymentRef: vivaRefFromSession('sess-approved') } })
    expect(await getReservationPaymentStatus(reservation.id)).toMatchObject({ status: 'ok', succeeded: true, failed: false })

    // declined
    await client.createSale(saleReq('sess-declined'))
    stubState.resolveNow('sess-declined', 'declined')
    await prisma.reservation.update({ where: { id: reservation.id }, data: { paymentRef: vivaRefFromSession('sess-declined') } })
    expect(await getReservationPaymentStatus(reservation.id)).toMatchObject({ status: 'ok', succeeded: false, failed: true })

    // aborted — abortSession while still pending (pending → aborted), not resolveNow
    await client.createSale(saleReq('sess-aborted'))
    await client.abortSession('sess-aborted', terminal.cashRegisterId)
    await prisma.reservation.update({ where: { id: reservation.id }, data: { paymentRef: vivaRefFromSession('sess-aborted') } })
    expect(await getReservationPaymentStatus(reservation.id)).toMatchObject({ status: 'ok', succeeded: false, failed: true })

    // pending — created, never resolved.
    await client.createSale(saleReq('sess-pending'))
    await prisma.reservation.update({ where: { id: reservation.id }, data: { paymentRef: vivaRefFromSession('sess-pending') } })
    expect(await getReservationPaymentStatus(reservation.id)).toMatchObject({ status: 'ok', succeeded: false, failed: false })

    // unknown — a ref for a session that was never created (transient-404 shape).
    await prisma.reservation.update({ where: { id: reservation.id }, data: { paymentRef: vivaRefFromSession('sess-never-existed') } })
    expect(await getReservationPaymentStatus(reservation.id)).toMatchObject({ status: 'ok', succeeded: false, failed: false })
  })
})
