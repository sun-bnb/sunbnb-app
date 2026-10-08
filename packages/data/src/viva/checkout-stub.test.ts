import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createStubVivaCheckoutClient, checkoutStubState } from './checkout-stub'

const REQ = { amountCents: 4000, isvAmountCents: 400, customerTrns: 'c', merchantTrns: 'reservation:r1', merchantId: 'm' }

beforeEach(() => checkoutStubState.reset())
afterEach(() => {
  vi.useRealTimers()
  delete process.env.VIVA_STUB_AUTO_PAY
})

describe('stub checkout client', () => {
  it('mints a 16-digit order code, pending until paid', async () => {
    const c = createStubVivaCheckoutClient({ resolveAfterMs: 60_000 })
    const { orderCode } = await c.createOrder(REQ)
    expect(orderCode).toMatch(/^\d{16}$/)
    expect((await c.getOrder(orderCode)).state).toBe('pending')
    checkoutStubState.pay(orderCode)
    const o = await c.getOrder(orderCode)
    expect(o).toMatchObject({ state: 'paid', transactionId: `stubtx_${orderCode}` })
    expect(await c.getTransaction(`stubtx_${orderCode}`)).toMatchObject({ state: 'paid', statusId: 'F', orderCode, amountCents: 4000 })
  })
  it('fail() resolves to failed', async () => {
    const c = createStubVivaCheckoutClient({ resolveAfterMs: 60_000 })
    const { orderCode } = await c.createOrder(REQ)
    checkoutStubState.fail(orderCode)
    expect((await c.getOrder(orderCode)).state).toBe('failed')
  })
  it('auto-pays after resolveAfterMs unless VIVA_STUB_AUTO_PAY=false', async () => {
    vi.useFakeTimers()
    const c = createStubVivaCheckoutClient({ resolveAfterMs: 1000 })
    const { orderCode } = await c.createOrder(REQ)
    expect((await c.getOrder(orderCode)).state).toBe('pending')
    vi.advanceTimersByTime(1500)
    expect((await c.getOrder(orderCode)).state).toBe('paid')
    process.env.VIVA_STUB_AUTO_PAY = 'false'
    expect((await c.createOrder(REQ).then((r) => (vi.advanceTimersByTime(5000), c.getOrder(r.orderCode)))).state).toBe('pending')
  })
  it('decline / expire markers fail immediately', async () => {
    const c = createStubVivaCheckoutClient()
    for (const marker of ['decline', 'expire']) {
      const { orderCode } = await c.createOrder({ ...REQ, merchantTrns: `x:${marker}` })
      expect((await c.getOrder(orderCode)).state).toBe('failed')
    }
  })
  it('refund marks a paid order refunded; unpaid refund throws', async () => {
    const c = createStubVivaCheckoutClient({ resolveAfterMs: 60_000 })
    const { orderCode } = await c.createOrder(REQ)
    await expect(c.refund(`stubtx_${orderCode}`, 4000)).rejects.toThrow()
    checkoutStubState.pay(orderCode)
    await c.refund(`stubtx_${orderCode}`, 4000)
    expect((await c.getOrder(orderCode)).state).toBe('refunded')
  })
  it('checkoutUrl points at the app stub page', () => {
    expect(createStubVivaCheckoutClient({ appUrl: 'https://a.test' }).checkoutUrl('123')).toBe('https://a.test/payment/viva/stub?ref=123')
  })
})
