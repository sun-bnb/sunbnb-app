import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createVivaHttpClient,
  VivaApiError,
  toCents,
  resetVivaTokenCacheForTests,
} from './http-client'
import { VivaFeeGuardError } from './types'
import type { VivaIsvConfig, VivaSaleRequest } from './types'

const CONFIG: VivaIsvConfig = {
  clientId: 'cid-1',
  clientSecret: 'secret-1',
  sourceCode: 'src-default',
  env: 'demo',
}

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    body: {
      access_token: 'tok-abc',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'urn:viva:payments:ecr:api',
      ...overrides,
    },
  }
}

function mockFetchSequence(...responses: Array<{ ok: boolean; status?: number; body?: unknown; text?: string }>) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: async () => r.body ?? {},
      text: async () => r.text ?? JSON.stringify(r.body ?? {}),
    })
  }
  global.fetch = fn as unknown as typeof fetch
  return fn
}

/** `fn.mock.calls[i]` is `noUncheckedIndexedAccess`-unsafe — this narrows once, at the point of use. */
function call(fn: ReturnType<typeof vi.fn>, i: number): [string, { method?: string; headers: Record<string, string>; body?: unknown }] {
  const entry = fn.mock.calls[i]
  if (!entry) throw new Error(`Expected a fetch call at index ${i}, got none`)
  return entry as [string, { method?: string; headers: Record<string, string>; body?: unknown }]
}

function saleReq(overrides: Partial<VivaSaleRequest> = {}): VivaSaleRequest {
  return {
    sessionId: '4bdebe62-c211-4ca0-a994-b2fbea2061c5',
    terminalId: '16000010',
    cashRegisterId: 'REG-1',
    amount: 1170,
    merchantReference: 'reservation-1',
    isvDetails: { amount: 30, terminalMerchantId: 'merchant-1' },
    ...overrides,
  }
}

beforeEach(() => {
  resetVivaTokenCacheForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toCents', () => {
  it('converts whole and simple 2-decimal euro amounts', () => {
    expect(toCents(19.99)).toBe(1999)
    expect(toCents(3)).toBe(300)
    expect(toCents(0)).toBe(0)
  })

  it('rounds through round() first — matches round()-then-scale on a 3-decimal input', () => {
    // 10/3 = 3.333... — round() takes it to 3.33 (2dp) before scaling.
    expect(toCents(10 / 3)).toBe(333)
  })

  it('rounds a half-cent case consistently with round()', () => {
    expect(toCents(33.335)).toBe(3334)
  })
})

describe('createVivaHttpClient — token handling', () => {
  it('fetches a token once and reuses it across two API calls', async () => {
    const fetchSpy = mockFetchSequence(
      tokenResponse(),
      { ok: true, status: 200, body: { sessionId: 's1', success: true, transactionId: 'tx1', amount: 1170 } },
      { ok: true, status: 200, body: { sessionId: 's1', success: true, transactionId: 'tx1', amount: 1170 } },
    )
    const client = createVivaHttpClient(CONFIG)
    await client.getSession('s1')
    await client.getSession('s1')

    expect(fetchSpy).toHaveBeenCalledTimes(3) // 1 token + 2 session GETs
    expect(call(fetchSpy, 0)[0]).toBe('https://demo-accounts.vivapayments.com/connect/token')
    const tokenCallBody = call(fetchSpy, 0)[1].body as URLSearchParams
    expect(tokenCallBody.get('grant_type')).toBe('client_credentials')
    expect(tokenCallBody.get('client_id')).toBe('cid-1')
    expect(tokenCallBody.get('scope')).toBe('urn:viva:payments:ecr:api')

    // Both session calls carry the SAME bearer token — no second token fetch.
    expect(call(fetchSpy, 1)[1].headers.Authorization).toBe('Bearer tok-abc')
    expect(call(fetchSpy, 2)[1].headers.Authorization).toBe('Bearer tok-abc')
  })

  it('a token request failure surfaces as VivaApiError', async () => {
    mockFetchSequence({ ok: false, status: 401, body: { Message: 'Authorization has been denied' } })
    const client = createVivaHttpClient(CONFIG)
    await expect(client.getSession('s1')).rejects.toThrow(VivaApiError)
  })
})

describe('createVivaHttpClient — createSale', () => {
  it('sends the sale body with required fields and documented defaults', async () => {
    const fetchSpy = mockFetchSequence(tokenResponse(), { ok: true, status: 200, body: null })
    const client = createVivaHttpClient(CONFIG)
    const result = await client.createSale(saleReq())

    expect(result).toEqual({ sessionId: '4bdebe62-c211-4ca0-a994-b2fbea2061c5' })
    const saleCall = call(fetchSpy, 1)
    expect(saleCall[0]).toBe('https://demo-api.vivapayments.com/ecr/isv/v1/transactions:sale')
    expect(saleCall[1].method).toBe('POST')
    expect(saleCall[1].headers.Authorization).toBe('Bearer tok-abc')
    const body = JSON.parse(saleCall[1].body as string)
    expect(body).toMatchObject({
      sessionId: '4bdebe62-c211-4ca0-a994-b2fbea2061c5',
      terminalId: '16000010',
      cashRegisterId: 'REG-1',
      amount: 1170,
      currencyCode: '978', // default
      merchantReference: 'reservation-1',
      tipAmount: 0, // default
      showTransactionResult: true, // default
      showReceipt: true, // default
      isvDetails: {
        amount: 30,
        terminalMerchantId: 'merchant-1',
        sourceCode: 'src-default', // falls back to config.sourceCode
      },
    })
  })

  it('lets a per-request isvDetails.sourceCode override the config default', async () => {
    const fetchSpy = mockFetchSequence(tokenResponse(), { ok: true, status: 200, body: null })
    const client = createVivaHttpClient(CONFIG)
    await client.createSale(saleReq({ isvDetails: { amount: 30, terminalMerchantId: 'm', sourceCode: 'custom-src' } }))
    const body = JSON.parse(call(fetchSpy, 1)[1].body as string)
    expect(body.isvDetails.sourceCode).toBe('custom-src')
  })

  it('rejects isvDetails.amount <= 0 without making any network call', async () => {
    const fetchSpy = mockFetchSequence()
    const client = createVivaHttpClient(CONFIG)
    await expect(
      client.createSale(saleReq({ isvDetails: { amount: 0, terminalMerchantId: 'm' } })),
    ).rejects.toThrow(VivaFeeGuardError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects isvDetails.amount >= amount without making any network call', async () => {
    const fetchSpy = mockFetchSequence()
    const client = createVivaHttpClient(CONFIG)
    await expect(
      client.createSale(saleReq({ amount: 1170, isvDetails: { amount: 1170, terminalMerchantId: 'm' } })),
    ).rejects.toThrow(VivaFeeGuardError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces a 409 (session id already exists) as VivaApiError with status + body', async () => {
    mockFetchSequence(tokenResponse(), { ok: false, status: 409, body: { Message: 'Session with this ID already exists in database.' } })
    const client = createVivaHttpClient(CONFIG)
    try {
      await client.createSale(saleReq())
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(VivaApiError)
      expect((err as VivaApiError).status).toBe(409)
      expect((err as VivaApiError).body).toMatchObject({ Message: expect.stringContaining('already exists') })
    }
  })
})

describe('createVivaHttpClient — getSession normalisation', () => {
  it('maps success:true to approved, carrying transactionId/amount/eventId', async () => {
    mockFetchSequence(tokenResponse(), {
      ok: true,
      status: 200,
      body: { sessionId: 's1', success: true, transactionId: 'tx-1', amount: 1170, eventId: 10051 },
    })
    const client = createVivaHttpClient(CONFIG)
    const session = await client.getSession('s1')
    expect(session).toMatchObject({ sessionId: 's1', state: 'approved', transactionId: 'tx-1', amount: 1170, eventId: 10051 })
  })

  it('maps success:false with no abortSuccess to declined', async () => {
    mockFetchSequence(tokenResponse(), { ok: true, status: 200, body: { sessionId: 's1', success: false } })
    const client = createVivaHttpClient(CONFIG)
    expect((await client.getSession('s1')).state).toBe('declined')
  })

  it('maps success:false + abortSuccess:true to aborted (distinct from a genuine decline)', async () => {
    mockFetchSequence(tokenResponse(), {
      ok: true,
      status: 200,
      body: { sessionId: 's1', success: false, abortSuccess: true },
    })
    const client = createVivaHttpClient(CONFIG)
    expect((await client.getSession('s1')).state).toBe('aborted')
  })

  it('maps HTTP 202 (still processing) to pending without parsing a body', async () => {
    mockFetchSequence(tokenResponse(), { ok: false, status: 202, body: { Message: 'The session is being processed' } })
    const client = createVivaHttpClient(CONFIG)
    expect((await client.getSession('s1')).state).toBe('pending')
  })

  it('maps HTTP 404 (session id not found) to unknown rather than throwing', async () => {
    mockFetchSequence(tokenResponse(), { ok: false, status: 404, body: { Message: 'Session id was not found.' } })
    const client = createVivaHttpClient(CONFIG)
    expect((await client.getSession('s1')).state).toBe('unknown')
  })

  it('a body with no `success` field (200) is treated as still-pending, not a crash', async () => {
    mockFetchSequence(tokenResponse(), { ok: true, status: 200, body: { sessionId: 's1' } })
    const client = createVivaHttpClient(CONFIG)
    expect((await client.getSession('s1')).state).toBe('pending')
  })

  it('surfaces a genuine server error (5xx) as VivaApiError', async () => {
    mockFetchSequence(tokenResponse(), { ok: false, status: 503, body: { Message: 'temporary overload' } })
    const client = createVivaHttpClient(CONFIG)
    await expect(client.getSession('s1')).rejects.toThrow(VivaApiError)
  })
})

describe('createVivaHttpClient — abortSession', () => {
  it('on 200 (accepted), re-fetches the session and returns its resolved state', async () => {
    const fetchSpy = mockFetchSequence(
      tokenResponse(),
      { ok: true, status: 200, body: null }, // DELETE
      { ok: true, status: 200, body: { sessionId: 's1', success: false, abortSuccess: true } }, // GET
    )
    const client = createVivaHttpClient(CONFIG)
    const result = await client.abortSession('s1', 'REG-1')
    expect(result.state).toBe('aborted')
    expect(call(fetchSpy, 1)[1].method).toBe('DELETE')
    expect(call(fetchSpy, 1)[0]).toContain('cashRegisterId=REG-1')
  })

  it('on 409 (abort already started), still chases the session — it may have already resolved to approved (the Mollie 422-already-paid race)', async () => {
    mockFetchSequence(
      tokenResponse(),
      { ok: false, status: 409, body: { Message: 'Abort process already started.' } }, // DELETE
      { ok: true, status: 200, body: { sessionId: 's1', success: true, transactionId: 'tx-1' } }, // GET
    )
    const client = createVivaHttpClient(CONFIG)
    const result = await client.abortSession('s1', 'REG-1')
    expect(result.state).toBe('approved')
    expect(result.transactionId).toBe('tx-1')
  })

  it('on 404 (session not found), returns unknown without a follow-up GET', async () => {
    const fetchSpy = mockFetchSequence(tokenResponse(), { ok: false, status: 404, body: { Message: 'Session id was not found.' } })
    const client = createVivaHttpClient(CONFIG)
    const result = await client.abortSession('s1', 'REG-1')
    expect(result.state).toBe('unknown')
    expect(fetchSpy).toHaveBeenCalledTimes(2) // token + DELETE only
  })

  it('on 403 (wrong cash register), throws VivaApiError rather than treating it as a race', async () => {
    mockFetchSequence(tokenResponse(), {
      ok: false,
      status: 403,
      body: { Message: 'Only cash register that created the transaction can abort it.' },
    })
    const client = createVivaHttpClient(CONFIG)
    await expect(client.abortSession('s1', 'WRONG-REG')).rejects.toThrow(VivaApiError)
  })
})

describe('createVivaHttpClient — refund', () => {
  it('sends the refund body (isvDetails carries only terminalMerchantId, no fee amount)', async () => {
    const fetchSpy = mockFetchSequence(tokenResponse(), { ok: true, status: 200, body: null })
    const client = createVivaHttpClient(CONFIG)
    const result = await client.refund({
      sessionId: 'refund-1',
      parentSessionId: 'sale-1',
      terminalId: '16000010',
      cashRegisterId: 'REG-1',
      amount: 1170,
      isvDetails: { terminalMerchantId: 'merchant-1' },
    })
    expect(result).toEqual({ sessionId: 'refund-1' })
    const body = JSON.parse(call(fetchSpy, 1)[1].body as string)
    expect(body).toEqual({
      sessionId: 'refund-1',
      terminalId: '16000010',
      cashRegisterId: 'REG-1',
      parentSessionId: 'sale-1',
      amount: 1170,
      currencyCode: '978',
      merchantReference: undefined,
      isvDetails: { terminalMerchantId: 'merchant-1' },
    })
  })

  it('surfaces a 404 (parent session not found / already aborted) as VivaApiError', async () => {
    mockFetchSequence(tokenResponse(), { ok: false, status: 404, body: { Message: 'Parent session not found.' } })
    const client = createVivaHttpClient(CONFIG)
    await expect(
      client.refund({
        sessionId: 'refund-1',
        parentSessionId: 'sale-1',
        terminalId: '16000010',
        cashRegisterId: 'REG-1',
        amount: 1170,
        isvDetails: { terminalMerchantId: 'merchant-1' },
      }),
    ).rejects.toThrow(VivaApiError)
  })
})

describe('createVivaHttpClient — searchDevices', () => {
  it('posts merchantId and maps the device list', async () => {
    const fetchSpy = mockFetchSequence(tokenResponse(), {
      ok: true,
      status: 200,
      body: [
        { merchantId: 'm1', terminalId: '16000010', statusId: 1, sourceCode: '543679', virtualTerminalId: 'vt1' },
        { merchantId: 'm1', terminalId: '16000011', statusId: 0, sourceCode: '543680', virtualTerminalId: 'vt2' },
      ],
    })
    const client = createVivaHttpClient(CONFIG)
    const devices = await client.searchDevices('m1')

    const body = JSON.parse(call(fetchSpy, 1)[1].body as string)
    expect(body).toEqual({ merchantId: 'm1' })
    expect(devices).toEqual([
      { merchantId: 'm1', terminalId: '16000010', statusId: 1, sourceCode: '543679', virtualTerminalId: 'vt1' },
      { merchantId: 'm1', terminalId: '16000011', statusId: 0, sourceCode: '543680', virtualTerminalId: 'vt2' },
    ])
  })
})
