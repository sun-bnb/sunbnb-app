import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createStubVivaClient, stubState, DEFAULT_RESOLVE_AFTER_MS } from './stub-client'
import { VivaFeeGuardError } from './types'
import type { VivaSaleRequest } from './types'

function saleReq(overrides: Partial<VivaSaleRequest> = {}): VivaSaleRequest {
  return {
    sessionId: 'session-1',
    terminalId: '16000010',
    cashRegisterId: 'REG-1',
    amount: 1000,
    merchantReference: 'reservation-1',
    isvDetails: { amount: 30, terminalMerchantId: 'merchant-1' },
    ...overrides,
  }
}

beforeEach(() => {
  stubState.reset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  stubState.reset()
})

describe('createStubVivaClient — lifecycle', () => {
  it('defaults to a 4s auto-resolve delay when none is configured', () => {
    expect(DEFAULT_RESOLVE_AFTER_MS).toBe(4000)
  })

  it('a plain sessionId is pending immediately, then approved after resolveAfterMs elapses', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 100 })
    await client.createSale(saleReq())

    const pending = await client.getSession('session-1')
    expect(pending.state).toBe('pending')
    expect(pending.transactionId).toBeUndefined()

    vi.advanceTimersByTime(100)

    const resolved = await client.getSession('session-1')
    expect(resolved.state).toBe('approved')
    expect(resolved.transactionId).toBeDefined()
    expect(resolved.amount).toBe(1000)
  })

  it('does not resolve before resolveAfterMs has elapsed', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 100 })
    await client.createSale(saleReq())
    vi.advanceTimersByTime(99)
    expect((await client.getSession('session-1')).state).toBe('pending')
  })

  it('an unknown sessionId resolves to state unknown, not a throw', async () => {
    const client = createStubVivaClient()
    const session = await client.getSession('does-not-exist')
    expect(session.state).toBe('unknown')
  })
})

describe('createStubVivaClient — decline/abort markers', () => {
  it('a sessionId containing "decline" resolves immediately to declined (no timer wait)', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 100 })
    await client.createSale(saleReq({ sessionId: 'session-decline-1' }))
    // No vi.advanceTimersByTime — must already be resolved.
    const session = await client.getSession('session-decline-1')
    expect(session.state).toBe('declined')
    expect(session.transactionId).toBeUndefined()
  })

  it('a sessionId containing "ABORT" (case-insensitive) resolves immediately to aborted', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 100 })
    await client.createSale(saleReq({ sessionId: 'session-ABORT-1' }))
    const session = await client.getSession('session-ABORT-1')
    expect(session.state).toBe('aborted')
  })
})

describe('createStubVivaClient — fee guard', () => {
  it('rejects isvDetails.amount <= 0', async () => {
    const client = createStubVivaClient()
    await expect(
      client.createSale(saleReq({ amount: 1000, isvDetails: { amount: 0, terminalMerchantId: 'm' } })),
    ).rejects.toThrow(VivaFeeGuardError)
  })

  it('rejects isvDetails.amount >= amount (fee at or above the sale amount)', async () => {
    const client = createStubVivaClient()
    await expect(
      client.createSale(saleReq({ amount: 1000, isvDetails: { amount: 1000, terminalMerchantId: 'm' } })),
    ).rejects.toThrow(VivaFeeGuardError)
  })

  it('never creates a session when the fee guard rejects — no phantom pending state', async () => {
    const client = createStubVivaClient()
    await expect(
      client.createSale(saleReq({ isvDetails: { amount: -5, terminalMerchantId: 'm' } })),
    ).rejects.toThrow(VivaFeeGuardError)
    expect((await client.getSession('session-1')).state).toBe('unknown')
  })

  it('accepts a fee strictly between 0 and the sale amount', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 10 })
    await expect(client.createSale(saleReq({ amount: 1000, isvDetails: { amount: 1, terminalMerchantId: 'm' } }))).resolves.toEqual({
      sessionId: 'session-1',
    })
  })
})

describe('createStubVivaClient — abort race (mirrors Mollie 422-already-paid)', () => {
  it('abortSession on a pending session moves it to aborted and cancels the pending timer', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 100 })
    await client.createSale(saleReq())

    const aborted = await client.abortSession('session-1', 'REG-1')
    expect(aborted.state).toBe('aborted')

    // If the timer weren't cancelled, this would flip the state to approved.
    vi.advanceTimersByTime(1000)
    expect((await client.getSession('session-1')).state).toBe('aborted')
  })

  it('abortSession on an already-approved session returns the approved session unchanged — abort loses the race', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 0 })
    await client.createSale(saleReq())
    vi.advanceTimersByTime(0)
    expect((await client.getSession('session-1')).state).toBe('approved')

    const result = await client.abortSession('session-1', 'REG-1')
    expect(result.state).toBe('approved')
    expect(result.transactionId).toBeDefined()
  })

  it('abortSession on an unknown session returns state unknown rather than throwing', async () => {
    const client = createStubVivaClient()
    const result = await client.abortSession('nope', 'REG-1')
    expect(result.state).toBe('unknown')
  })
})

describe('createStubVivaClient — shared module-level store', () => {
  it('a session created via one client instance is visible from a separately constructed client', async () => {
    const writer = createStubVivaClient({ resolveAfterMs: 100 })
    const reader = createStubVivaClient({ resolveAfterMs: 100 })
    await writer.createSale(saleReq({ sessionId: 'shared-session' }))
    expect((await reader.getSession('shared-session')).state).toBe('pending')
  })
})

describe('stubState', () => {
  it('resolveNow forces a pending session straight to a terminal outcome, bypassing the timer', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 5000 })
    await client.createSale(saleReq())
    stubState.resolveNow('session-1', 'declined')
    expect((await client.getSession('session-1')).state).toBe('declined')
  })

  it('reset() clears the store — a previously created session becomes unknown', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 100 })
    await client.createSale(saleReq())
    stubState.reset()
    expect((await client.getSession('session-1')).state).toBe('unknown')
  })
})

describe('createStubVivaClient — refund', () => {
  it('refunds only against an approved parent session', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 0 })
    await client.createSale(saleReq())
    vi.advanceTimersByTime(0)

    const refund = await client.refund({
      sessionId: 'refund-session-1',
      parentSessionId: 'session-1',
      terminalId: '16000010',
      cashRegisterId: 'REG-1',
      amount: 1000,
      isvDetails: { terminalMerchantId: 'merchant-1' },
    })
    expect(refund.sessionId).toBe('refund-session-1')
    expect((await client.getSession('refund-session-1')).state).toBe('approved')
  })

  it('rejects a refund against a pending (not yet approved) parent', async () => {
    const client = createStubVivaClient({ resolveAfterMs: 5000 })
    await client.createSale(saleReq())
    await expect(
      client.refund({
        sessionId: 'refund-session-2',
        parentSessionId: 'session-1',
        terminalId: '16000010',
        cashRegisterId: 'REG-1',
        amount: 1000,
        isvDetails: { terminalMerchantId: 'merchant-1' },
      }),
    ).rejects.toThrow(/not an approved sale/)
  })

  it('rejects a refund against a non-existent parent', async () => {
    const client = createStubVivaClient()
    await expect(
      client.refund({
        sessionId: 'refund-session-3',
        parentSessionId: 'no-such-session',
        terminalId: '16000010',
        cashRegisterId: 'REG-1',
        amount: 1000,
        isvDetails: { terminalMerchantId: 'merchant-1' },
      }),
    ).rejects.toThrow(/not an approved sale/)
  })
})

describe('createStubVivaClient — searchDevices', () => {
  it('returns the two fixed fake terminals', async () => {
    const client = createStubVivaClient()
    const devices = await client.searchDevices('merchant-1')
    expect(devices.map((d) => d.terminalId)).toEqual(['16000010', '16000011'])
    expect(devices.every((d) => d.statusId === 1)).toBe(true)
  })
})
