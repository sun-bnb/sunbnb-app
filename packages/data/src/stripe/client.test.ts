import { describe, it, expect, afterEach } from 'vitest'
import { getStripeClient, getStripeConnectClient } from './client'

const saved = { s: process.env.STRIPE_SECRET_KEY, c: process.env.STRIPE_CONNECT_SECRET_KEY }
afterEach(() => {
  process.env.STRIPE_SECRET_KEY = saved.s
  process.env.STRIPE_CONNECT_SECRET_KEY = saved.c
  if (saved.s === undefined) delete process.env.STRIPE_SECRET_KEY
  if (saved.c === undefined) delete process.env.STRIPE_CONNECT_SECRET_KEY
})

describe('stripe clients', () => {
  it('Connect client uses its own key, distinct from the subscription client', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_sub'
    process.env.STRIPE_CONNECT_SECRET_KEY = 'rk_test_connect'
    expect(getStripeConnectClient()).not.toBe(getStripeClient())
    expect(getStripeConnectClient()).toBe(getStripeConnectClient())
  })
  it('falls back to STRIPE_SECRET_KEY when no Connect key is set', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_single'
    delete process.env.STRIPE_CONNECT_SECRET_KEY
    expect(() => getStripeConnectClient()).not.toThrow()
  })
  it('throws when neither key is set', () => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_CONNECT_SECRET_KEY
    expect(() => getStripeConnectClient()).toThrow(/not configured/)
  })
})
