import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildBeginCheckoutParams,
  buildPurchaseParams,
  buildViewItemParams,
  siteCategory,
  sendOnce,
  authEvent,
  isPaidPurchase,
  resetSentGuard,
  type GuardStorage,
} from './funnel'

const base = { kind: 'sunbed' as const, siteId: 'site-1', siteName: 'Playa Norte', value: 24.5, quantity: 2 }

function memStorage(): GuardStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('purchase params', () => {
  it('reports the paid amount in EUR with the transaction id', () => {
    expect(buildPurchaseParams({ ...base, transactionId: 'res-9' })).toEqual({
      transaction_id: 'res-9',
      currency: 'EUR',
      value: 24.5,
      items: [{ item_id: 'site-1', item_name: 'Playa Norte', item_category: 'sunbed', quantity: 2 }],
    })
  })

  it('refuses to report a purchase without a positive amount or transaction id', () => {
    expect(buildPurchaseParams({ ...base, value: 0, transactionId: 'r' })).toBeNull()
    expect(buildPurchaseParams({ ...base, value: -3, transactionId: 'r' })).toBeNull()
    expect(buildPurchaseParams({ ...base, value: NaN, transactionId: 'r' })).toBeNull()
    expect(buildPurchaseParams({ ...base, transactionId: '' })).toBeNull()
  })

  it('never leaks identity fields into params', () => {
    const json = JSON.stringify(buildPurchaseParams({
      ...base, transactionId: 'r', email: 'a@b.com', anonId: 'uuid', userId: 'u1',
    } as never))
    expect(json).not.toMatch(/a@b\.com|uuid|u1|email|anon/i)
  })
})

describe('begin_checkout / view_item params', () => {
  it('has no transaction_id and is null without an amount', () => {
    const p = buildBeginCheckoutParams(base)!
    expect(p).not.toHaveProperty('transaction_id')
    expect(buildBeginCheckoutParams({ ...base, value: 0 })).toBeNull()
  })

  it('view_item uses the site id as item_id', () => {
    expect(buildViewItemParams({ id: 's1', name: 'N' }, 'rental')).toEqual({
      items: [{ item_id: 's1', item_name: 'N', item_category: 'rental' }],
    })
    expect(buildViewItemParams({ id: null }, 'sunbed')).toBeNull()
  })

  it('categorises a site: sunbeds win, rentals next, else fnb; default is sunbed', () => {
    expect(siteCategory(undefined)).toBe('sunbed')
    expect(siteCategory(['rentals', 'sunbeds'])).toBe('sunbed')
    expect(siteCategory(['rentals'])).toBe('rental')
    expect(siteCategory(['food'])).toBe('fnb')
  })
})

describe('sendOnce (one purchase per transaction)', () => {
  beforeEach(() => resetSentGuard())

  it('sends the first time and never again for the same key (re-render / revisit)', () => {
    const storage = memStorage()
    const send = vi.fn()
    expect(sendOnce('purchase:a', send, { storage })).toBe(true)
    expect(sendOnce('purchase:a', send, { storage })).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('survives a reload: a persisted marker blocks the send even with empty memory', () => {
    const storage = memStorage()
    sendOnce('purchase:a', vi.fn(), { storage })
    resetSentGuard() // simulates a fresh page load
    const send = vi.fn()
    expect(sendOnce('purchase:a', send, { storage })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('different transactions are independent', () => {
    const storage = memStorage()
    const send = vi.fn()
    sendOnce('purchase:a', send, { storage })
    sendOnce('purchase:b', send, { storage })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not burn the one chance when analytics is not ready (no consent / gtag missing)', () => {
    const storage = memStorage()
    const send = vi.fn()
    expect(sendOnce('purchase:a', send, { storage, canSend: () => false })).toBe(false)
    expect(storage.data.size).toBe(0)
    expect(sendOnce('purchase:a', send, { storage, canSend: () => true })).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('still dedupes in-memory when storage throws (private mode)', () => {
    const broken: GuardStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    const send = vi.fn()
    expect(sendOnce('purchase:a', send, { storage: broken })).toBe(true)
    expect(sendOnce('purchase:a', send, { storage: broken })).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('isPaidPurchase guard', () => {
  it('requires the complete status AND a paymentRef', () => {
    expect(isPaidPurchase({ status: 'complete', paymentRef: 'tr_1' }, 'complete')).toBe(true)
    expect(isPaidPurchase({ status: 'complete', paymentRef: null }, 'complete')).toBe(false)
    expect(isPaidPurchase({ status: 'complete' }, 'complete')).toBe(false)
  })

  it('never qualifies failed, expired, processing or pending states even with a paymentRef', () => {
    for (const status of ['payment_failed', 'expired', 'processing', 'pending', undefined, null]) {
      expect(isPaidPurchase({ status, paymentRef: 'tr_1' }, 'complete')).toBe(false)
    }
  })
})

describe('authEvent', () => {
  it('maps a sign-in that created the account to sign_up, otherwise login', () => {
    expect(authEvent('google', true)).toEqual({ name: 'sign_up', params: { method: 'google' } })
    expect(authEvent('credentials', false)).toEqual({ name: 'login', params: { method: 'credentials' } })
    expect(authEvent('credentials', undefined).name).toBe('login')
  })
})
