import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetVivaTokenCacheForTests, VivaApiError } from './http-client'
import { createVivaCheckoutHttpClient, vivaOnlineHttp } from './checkout-http'
import type { VivaIsvConfig } from './types'
import type { VivaOrderRequest } from './checkout-types'

const CONFIG: VivaIsvConfig = { clientId: 'cid', clientSecret: 'sec', sourceCode: 'src-default', env: 'demo' }
const REQ: VivaOrderRequest = {
  amountCents: 4000,
  isvAmountCents: 400,
  customerTrns: 'Reservation r1',
  merchantTrns: 'reservation:r1',
  merchantId: 'm 1',
  tags: ['sunbnb'],
}

function mockFetch(...rs: Array<{ ok: boolean; status?: number; body?: unknown }>) {
  const fn = vi.fn()
  for (const r of rs) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    })
  }
  global.fetch = fn as unknown as typeof fetch
  return fn
}
const TOKEN = { ok: true, body: { access_token: 'tok', expires_in: 3600 } }
type Call = [string, { method?: string; headers: Record<string, string>; body?: string }]
const call = (fn: ReturnType<typeof vi.fn>, i: number) => fn.mock.calls[i] as Call

beforeEach(() => resetVivaTokenCacheForTests())
afterEach(() => vi.restoreAllMocks())

describe('createVivaCheckoutHttpClient', () => {
  it('createOrder requests the online scope, posts to orderPath with merchant query and orderBody', async () => {
    const fn = mockFetch(TOKEN, { ok: true, body: { orderCode: 1234567890123456 } })
    const r = await createVivaCheckoutHttpClient(CONFIG).createOrder(REQ)
    expect(r).toEqual({ orderCode: '1234567890123456' })
    expect(call(fn, 0)[1].body?.toString()).toContain(encodeURIComponent(vivaOnlineHttp.scope))
    const [url, init] = call(fn, 1)
    expect(url).toBe(`https://demo-api.vivapayments.com${vivaOnlineHttp.orderPath}?${vivaOnlineHttp.merchantQuery('m 1')}`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body as string)).toEqual(JSON.parse(JSON.stringify(vivaOnlineHttp.orderBody(REQ, 'src-default'))))
    expect(JSON.parse(init.body as string)).toMatchObject({ amount: 4000, isvAmount: 400, sourceCode: 'src-default', paymentTimeout: 1800 })
  })

  it('getTransaction maps statusId via statusMap; unknown -> pending', async () => {
    const c = createVivaCheckoutHttpClient(CONFIG)
    const fn = mockFetch(
      TOKEN,
      { ok: true, body: { statusId: 'F', orderCode: 99, amount: 40 } },
      { ok: true, body: { statusId: 'ZZ' } },
      { ok: true, body: { statusId: 'R' } },
      { ok: true, body: { statusId: 'E' } },
    )
    expect(await c.getTransaction('t1')).toMatchObject({ state: 'paid', statusId: 'F', orderCode: '99', amountCents: 4000 })
    expect((await c.getTransaction('t2')).state).toBe('pending')
    expect((await c.getTransaction('t3')).state).toBe('refunded')
    expect((await c.getTransaction('t4')).state).toBe('failed')
    expect(call(fn, 1)[0]).toContain(vivaOnlineHttp.transactionPath('t1'))
  })

  it('refund uses refundMethod and refundPath', async () => {
    const fn = mockFetch(TOKEN, { ok: true })
    await createVivaCheckoutHttpClient(CONFIG).refund('tx1', 4000)
    expect(call(fn, 1)[1].method).toBe('DELETE')
    expect(call(fn, 1)[0]).toContain(vivaOnlineHttp.refundPath('tx1', 4000))
  })

  it('non-2xx throws VivaApiError', async () => {
    mockFetch(TOKEN, { ok: false, status: 422, body: { message: 'bad' } })
    await expect(createVivaCheckoutHttpClient(CONFIG).createOrder(REQ)).rejects.toBeInstanceOf(VivaApiError)
    mockFetch({ ok: false, status: 500 })
    resetVivaTokenCacheForTests()
    await expect(createVivaCheckoutHttpClient(CONFIG).refund('t', 1)).rejects.toBeInstanceOf(VivaApiError)
  })

  it('checkoutUrl uses the env host and colour', () => {
    expect(createVivaCheckoutHttpClient(CONFIG, { color: '#ff0000' }).checkoutUrl('42')).toBe(
      'https://demo.vivapayments.com/web/checkout?ref=42&color=ff0000',
    )
    expect(createVivaCheckoutHttpClient({ ...CONFIG, env: 'production' }).checkoutUrl('42')).toBe(
      'https://www.vivapayments.com/web/checkout?ref=42',
    )
  })
})
