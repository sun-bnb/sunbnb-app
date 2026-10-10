import { describe, it, expect, vi, beforeEach } from 'vitest'

const stripe = vi.hoisted(() => ({
  terminal: { locations: { create: vi.fn() }, connectionTokens: { create: vi.fn() } },
  paymentIntents: { create: vi.fn(), retrieve: vi.fn(), cancel: vi.fn() },
}))
const siteUpdate = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ getStripeConnectClient: () => stripe, getStripeClient: () => { throw new Error('Connect code must not use the subscription client') } }))
vi.mock('../../index', () => ({ default: { site: { update: siteUpdate } } }))

import {
  ensureTerminalLocation,
  createConnectionToken,
  createTerminalPaymentIntent,
  cancelTerminalPaymentIntent,
} from './terminal'

const ACCT = 'acct_123'
const site = (over = {}) => ({
  id: 's1', name: 'Beach Club', stripeTerminalLocationId: null,
  address: 'Rantatie 1', city: 'Helsinki', postalCode: '00100', country: 'FI', ...over,
})

beforeEach(() => vi.resetAllMocks())

describe('ensureTerminalLocation', () => {
  it('reuses an existing location without calling Stripe', async () => {
    expect(await ensureTerminalLocation(site({ stripeTerminalLocationId: 'tml_1' }), ACCT)).toBe('tml_1')
    expect(stripe.terminal.locations.create).not.toHaveBeenCalled()
    expect(siteUpdate).not.toHaveBeenCalled()
  })

  it('creates on the connected account and persists the id', async () => {
    stripe.terminal.locations.create.mockResolvedValue({ id: 'tml_new' })
    expect(await ensureTerminalLocation(site(), ACCT)).toBe('tml_new')
    expect(stripe.terminal.locations.create).toHaveBeenCalledWith(
      { display_name: 'Beach Club', address: { line1: 'Rantatie 1', city: 'Helsinki', postal_code: '00100', country: 'FI' } },
      { stripeAccount: ACCT },
    )
    expect(siteUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { stripeTerminalLocationId: 'tml_new' } })
  })
})

describe('createConnectionToken', () => {
  it('scopes the token to the location on the connected account', async () => {
    stripe.terminal.connectionTokens.create.mockResolvedValue({ secret: 'pst_x' })
    expect(await createConnectionToken(ACCT, 'tml_1')).toBe('pst_x')
    expect(stripe.terminal.connectionTokens.create).toHaveBeenCalledWith({ location: 'tml_1' }, { stripeAccount: ACCT })
  })
})

describe('createTerminalPaymentIntent', () => {
  const input = { amount: 40.1, applicationFee: 2.35, stripeAccount: ACCT, description: 'Beach Club', meta: { type: 'reservation' as const, entityId: 'r1', siteId: 's1', collect: true } }

  it('creates a card_present auto-capture PI in exact cents with the application fee', async () => {
    stripe.paymentIntents.create.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret' })
    expect(await createTerminalPaymentIntent(input)).toEqual({ paymentIntentId: 'pi_1', clientSecret: 'pi_1_secret' })
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      {
        amount: 4010, currency: 'eur', allowed_payment_method_types: ['card_present'], capture_method: 'automatic',
        application_fee_amount: 235, description: 'Beach Club',
        metadata: { type: 'reservation', entityId: 'r1', siteId: 's1', collect: '1' },
      },
      { stripeAccount: ACCT },
    )
  })

  it('omits application_fee_amount when the fee is 0', async () => {
    stripe.paymentIntents.create.mockResolvedValue({ id: 'pi_1', client_secret: 's' })
    await createTerminalPaymentIntent({ ...input, applicationFee: 0 })
    expect(stripe.paymentIntents.create.mock.calls[0]![0]).not.toHaveProperty('application_fee_amount')
  })
})

describe('cancelTerminalPaymentIntent', () => {
  const run = (status: string) => {
    stripe.paymentIntents.retrieve.mockResolvedValue({ status })
    stripe.paymentIntents.cancel.mockResolvedValue({})
    return cancelTerminalPaymentIntent('pi_1', ACCT)
  }

  it('succeeded -> paid, never cancels', async () => {
    expect(await run('succeeded')).toBe('paid')
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled()
  })
  it('canceled -> canceled, no second cancel', async () => {
    expect(await run('canceled')).toBe('canceled')
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled()
  })
  it.each(['requires_payment_method', 'requires_confirmation', 'requires_capture', 'requires_action'])(
    '%s -> cancels on the connected account', async (status) => {
      expect(await run(status)).toBe('canceled')
      expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_1', {}, { stripeAccount: ACCT })
    })
  it('processing -> error without cancelling', async () => {
    expect(await run('processing')).toBe('error')
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled()
  })
  it('API error -> error', async () => {
    stripe.paymentIntents.retrieve.mockRejectedValue(new Error('boom'))
    expect(await cancelTerminalPaymentIntent('pi_1', ACCT)).toBe('error')
  })
})

describe('terminalLocationState (ES requires address.state)', () => {
  it('uses a known ES taxRegion first, normalised', async () => {
    const { terminalLocationState } = await import('./terminal')
    expect(terminalLocationState({ country: 'ES', taxRegion: ' pm ', postalCode: '29640' })).toBe('PM')
  })
  it('falls back to the postal-code province when taxRegion is missing or unknown', async () => {
    const { terminalLocationState } = await import('./terminal')
    expect(terminalLocationState({ country: 'ES', taxRegion: null, postalCode: '29640' })).toBe('MA')
    expect(terminalLocationState({ country: 'es', taxRegion: 'XX', postalCode: '07001' })).toBe('PM')
    expect(terminalLocationState({ country: 'ES', taxRegion: null, postalCode: '35001' })).toBe('GC')
  })
  it('is undefined outside Spain or when nothing resolves', async () => {
    const { terminalLocationState } = await import('./terminal')
    expect(terminalLocationState({ country: 'FI', taxRegion: null, postalCode: '00100' })).toBeUndefined()
    expect(terminalLocationState({ country: 'ES', taxRegion: null, postalCode: '99999' })).toBeUndefined()
    expect(terminalLocationState({ country: 'ES', taxRegion: null, postalCode: null })).toBeUndefined()
  })
})
