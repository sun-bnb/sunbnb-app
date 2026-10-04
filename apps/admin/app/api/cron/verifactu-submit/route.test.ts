import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const submitPendingRecords = vi.fn()

vi.mock('@repo/data/tax/es-verifactu/submit', () => ({
  submitPendingRecords: (...args: unknown[]) => submitPendingRecords(...args),
}))

// Declared INSIDE the factory: vi.mock is hoisted above the module body, so a
// top-level class is not yet initialised when the factory runs.
vi.mock('@repo/data/tax/es-verifactu/client', () => ({
  AeatCertificateMissingError: class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'AeatCertificateMissingError'
    }
  },
}))

import { GET } from './route'
import { AeatCertificateMissingError } from '@repo/data/tax/es-verifactu/client'

const ORIGINAL = process.env.CRON_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
  submitPendingRecords.mockResolvedValue({
    mode: 'stub',
    environment: 'pruebas',
    issuers: [],
    accepted: 0,
    rejected: 0,
    complete: true,
  })
})
afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL
})

function request(auth?: string) {
  return new Request('https://admin.sunbnb.app/api/cron/verifactu-submit', {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('GET /api/cron/verifactu-submit', () => {
  it('runs the sweep when the cron secret matches', async () => {
    const res = await GET(request('Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(submitPendingRecords).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toMatchObject({ accepted: 0, complete: true })
  })

  it('sweeps EVERY authorised issuer, not just our own NIF (P7.2)', async () => {
    // The whole of the P7.2 change at this layer, and the reason it is pinned:
    // narrowing it back to `submitPlatformRecords` would silently stop filing
    // every partner's records while every test still passed and the health
    // check still reported them as merely pending.
    await GET(request('Bearer test-secret'))
    // Called with no issuer filter — passing one is what scopes it to us.
    const args = submitPendingRecords.mock.calls[0]
    expect(args?.[0]?.onlyIssuerNifIn).toBeUndefined()
  })

  it('rejects a wrong or missing secret without touching the sweep', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect((await GET(request())).status).toBe(401)
    expect(submitPendingRecords).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(request('Bearer anything'))
    expect(res.status).toBe(503)
    expect(submitPendingRecords).not.toHaveBeenCalled()
  })

  it('reports a missing certificate as 503, not as a generic failure', async () => {
    // A misconfigured certificate is not transient, and it must be loud: the
    // alternative (falling back to a stub) would mark records sent while AEAT
    // held nothing.
    submitPendingRecords.mockRejectedValue(new AeatCertificateMissingError('AEAT_CERT_PFX_BASE64 not set'))
    const res = await GET(request('Bearer test-secret'))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      error: 'AEAT certificate not configured',
    })
  })

  it('returns 500 on an unexpected failure, and never leaks internals', async () => {
    // A failed sweep is an ops event: records stay queued with retries, which is
    // what AEAT prescribes for an incident. Nothing about an invoice is at risk.
    submitPendingRecords.mockRejectedValue(new Error('connection reset by peer'))
    const res = await GET(request('Bearer test-secret'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Submission sweep failed')
    expect(JSON.stringify(body)).not.toContain('connection reset')
  })
})
