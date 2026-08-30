import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createVivaAccountsHttpClient,
  createStubVivaAccountsClient,
  accountsStubState,
} from './accounts'
import { VivaApiError, resetVivaTokenCacheForTests } from './http-client'
import type { VivaIsvConfig } from './types'
import type { VivaCreateConnectedAccountInput } from './accounts'

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
      access_token: 'tok-accounts',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'urn:viva:payments:core:api:isv',
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

function createInput(overrides: Partial<VivaCreateConnectedAccountInput> = {}): VivaCreateConnectedAccountInput {
  return {
    email: 'venue@example.com',
    returnUrl: 'https://partner.sunbnb.app/account/viva/return',
    branding: { partnerName: 'Sunbnb', logoUrl: 'https://sunbnb.app/logo.png' },
    ...overrides,
  }
}

beforeEach(() => {
  process.env.VIVA_STUB_AUTO_VERIFY = 'false'
  resetVivaTokenCacheForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createVivaAccountsHttpClient — createConnectedAccount', () => {
  it('posts only email/returnUrl/branding — the spec has no legalName/taxNumber/etc fields', async () => {
    const fetchSpy = mockFetchSequence(tokenResponse(), {
      ok: true,
      status: 200,
      body: {
        accountId: 'acct-1',
        invitation: { email: 'venue@example.com', redirectUrl: 'https://onboard.viva/acct-1', created: '2026-08-30T10:00:00Z' },
      },
    })
    const client = createVivaAccountsHttpClient(CONFIG)
    const result = await client.createConnectedAccount(
      createInput({ legalName: 'Beach Club SL', taxNumber: 'B12345678', mobile: '+34600000000', address: 'Calle 1', tradeName: 'Beach Club' }),
    )

    expect(result).toEqual({
      accountId: 'acct-1',
      invitation: { email: 'venue@example.com', redirectUrl: 'https://onboard.viva/acct-1', created: '2026-08-30T10:00:00Z' },
    })

    // Token call uses the accounts scope, distinct from the ECR scale.
    const tokenCallBody = call(fetchSpy, 0)[1].body as URLSearchParams
    expect(tokenCallBody.get('scope')).toBe('urn:viva:payments:core:api:isv')

    const createCall = call(fetchSpy, 1)
    expect(createCall[0]).toBe('https://demo-api.vivapayments.com/isv/v1/accounts')
    expect(createCall[1].method).toBe('POST')
    expect(createCall[1].headers.Authorization).toBe('Bearer tok-accounts')
    const body = JSON.parse(createCall[1].body as string)
    expect(body).toEqual({
      email: 'venue@example.com',
      returnUrl: 'https://partner.sunbnb.app/account/viva/return',
      branding: { partnerName: 'Sunbnb', logoUrl: 'https://sunbnb.app/logo.png', primaryColor: undefined },
    })
    // None of the extra onboarding-form fields leaked onto the wire.
    expect(body.legalName).toBeUndefined()
    expect(body.taxNumber).toBeUndefined()
    expect(body.mobile).toBeUndefined()
    expect(body.address).toBeUndefined()
    expect(body.tradeName).toBeUndefined()
  })

  it('forwards branding.primaryColor when given', async () => {
    const fetchSpy = mockFetchSequence(tokenResponse(), {
      ok: true,
      status: 200,
      body: { accountId: 'acct-1', invitation: { email: 'venue@example.com', redirectUrl: 'https://onboard.viva/acct-1', created: 'now' } },
    })
    const client = createVivaAccountsHttpClient(CONFIG)
    await client.createConnectedAccount(createInput({ branding: { partnerName: 'Sunbnb', logoUrl: 'https://x/logo.png', primaryColor: '#112233' } }))
    const body = JSON.parse(call(fetchSpy, 1)[1].body as string)
    expect(body.branding.primaryColor).toBe('#112233')
  })

  it('a token or API error surfaces as VivaApiError', async () => {
    mockFetchSequence({ ok: false, status: 401, body: { Message: 'Authorization has been denied' } })
    const client = createVivaAccountsHttpClient(CONFIG)
    await expect(client.createConnectedAccount(createInput())).rejects.toThrow(VivaApiError)
  })

  it('throws if the response has no accountId (malformed body, not silently accepted)', async () => {
    mockFetchSequence(tokenResponse(), { ok: true, status: 200, body: { invitation: {} } })
    const client = createVivaAccountsHttpClient(CONFIG)
    await expect(client.createConnectedAccount(createInput())).rejects.toThrow(VivaApiError)
  })
})

describe('createVivaAccountsHttpClient — getConnectedAccount status normalisation', () => {
  it('verified:true -> verified, carries merchantId and acquiringEnabled', async () => {
    mockFetchSequence(tokenResponse(), {
      ok: true,
      status: 200,
      body: { accountId: 'acct-1', email: 'venue@example.com', verified: true, merchantId: 'merchant-9', acquiringEnabled: true },
    })
    const client = createVivaAccountsHttpClient(CONFIG)
    const account = await client.getConnectedAccount('acct-1')
    expect(account).toMatchObject({
      accountId: 'acct-1',
      email: 'venue@example.com',
      verificationStatus: 'verified',
      merchantId: 'merchant-9',
      acquiringEnabled: true,
    })
  })

  it('verified:false -> pending (the API has no distinct "rejected" value)', async () => {
    mockFetchSequence(tokenResponse(), {
      ok: true,
      status: 200,
      body: { accountId: 'acct-1', email: 'venue@example.com', verified: false },
    })
    const client = createVivaAccountsHttpClient(CONFIG)
    const account = await client.getConnectedAccount('acct-1')
    expect(account.verificationStatus).toBe('pending')
  })

  it('a body with no `verified` field normalises to unknown rather than crashing', async () => {
    mockFetchSequence(tokenResponse(), { ok: true, status: 200, body: { accountId: 'acct-1' } })
    const client = createVivaAccountsHttpClient(CONFIG)
    expect((await client.getConnectedAccount('acct-1')).verificationStatus).toBe('unknown')
  })

  it('maps HTTP 404 (unknown account) to unknown rather than throwing', async () => {
    mockFetchSequence(tokenResponse(), { ok: false, status: 404, body: { Message: 'Not found' } })
    const client = createVivaAccountsHttpClient(CONFIG)
    const account = await client.getConnectedAccount('acct-missing')
    expect(account).toEqual({ accountId: 'acct-missing', verificationStatus: 'unknown', raw: null })
  })

  it('surfaces a genuine server error (5xx) as VivaApiError', async () => {
    mockFetchSequence(tokenResponse(), { ok: false, status: 503, body: { Message: 'temporary overload' } })
    const client = createVivaAccountsHttpClient(CONFIG)
    await expect(client.getConnectedAccount('acct-1')).rejects.toThrow(VivaApiError)
  })

  it('keeps undocumented example fields (taxNumber/vatNumber/legalName) only on raw, not promoted', async () => {
    mockFetchSequence(tokenResponse(), {
      ok: true,
      status: 200,
      body: { accountId: 'acct-1', verified: true, taxNumber: null, vatNumber: 'PT500500500', legalName: 'Entity Name' },
    })
    const client = createVivaAccountsHttpClient(CONFIG)
    const account = await client.getConnectedAccount('acct-1')
    expect(account.raw).toMatchObject({ vatNumber: 'PT500500500', legalName: 'Entity Name' })
    expect((account as unknown as Record<string, unknown>).vatNumber).toBeUndefined()
  })
})

describe('createStubVivaAccountsClient — lifecycle', () => {
  beforeEach(() => {
    accountsStubState.reset()
  })

  it('createConnectedAccount mints a pending account with a stub onboarding redirectUrl', async () => {
    const client = createStubVivaAccountsClient()
    const created = await client.createConnectedAccount(createInput())
    expect(created.accountId).toMatch(/^stub_acct_/)
    expect(created.invitation.redirectUrl).toBe(`https://stub.viva.local/onboarding/${created.accountId}`)
    expect(created.invitation.email).toBe('venue@example.com')

    const account = await client.getConnectedAccount(created.accountId)
    expect(account.verificationStatus).toBe('pending')
    expect(account.merchantId).toBeUndefined()
  })

  it('a separately-constructed client sees the same module-level store', async () => {
    const writer = createStubVivaAccountsClient()
    const created = await writer.createConnectedAccount(createInput())
    const reader = createStubVivaAccountsClient()
    const account = await reader.getConnectedAccount(created.accountId)
    expect(account.verificationStatus).toBe('pending')
  })

  it('getConnectedAccount on an unknown accountId returns unknown, not a throw', async () => {
    const client = createStubVivaAccountsClient()
    const account = await client.getConnectedAccount('never-created')
    expect(account).toEqual({ accountId: 'never-created', verificationStatus: 'unknown', raw: null })
  })

  it('accountsStubState.verify() flips the account to verified and mints a merchantId if none given', async () => {
    const client = createStubVivaAccountsClient()
    const created = await client.createConnectedAccount(createInput())
    const verified = accountsStubState.verify(created.accountId)
    expect(verified.verificationStatus).toBe('verified')
    expect(verified.merchantId).toBeTruthy()

    const account = await client.getConnectedAccount(created.accountId)
    expect(account.verificationStatus).toBe('verified')
    expect(account.merchantId).toBe(verified.merchantId)
    expect(account.acquiringEnabled).toBe(true)
  })

  it('accountsStubState.verify() accepts an explicit merchantId', async () => {
    const client = createStubVivaAccountsClient()
    const created = await client.createConnectedAccount(createInput())
    accountsStubState.verify(created.accountId, 'merchant-explicit')
    const account = await client.getConnectedAccount(created.accountId)
    expect(account.merchantId).toBe('merchant-explicit')
  })

  it('accountsStubState.verify() on an unknown accountId throws (no silent no-op)', () => {
    expect(() => accountsStubState.verify('never-created')).toThrow(/unknown stub accountId/)
  })

  it('accountsStubState.reset() clears every account', async () => {
    const client = createStubVivaAccountsClient()
    const created = await client.createConnectedAccount(createInput())
    accountsStubState.reset()
    const account = await client.getConnectedAccount(created.accountId)
    expect(account.verificationStatus).toBe('unknown')
  })
})
