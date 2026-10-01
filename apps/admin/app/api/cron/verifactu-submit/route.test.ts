import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const submitPlatformRecords = vi.fn()

vi.mock('@repo/data/tax/es-verifactu/submit', () => ({
  submitPlatformRecords: (...args: unknown[]) => submitPlatformRecords(...args),
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
  submitPlatformRecords.mockResolvedValue({
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
  it('runs the platform sweep when the cron secret matches', async () => {
    const res = await GET(request('Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(submitPlatformRecords).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toMatchObject({ accepted: 0, complete: true })
  })

  it('rejects a wrong or missing secret without touching the sweep', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect((await GET(request())).status).toBe(401)
    expect(submitPlatformRecords).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(request('Bearer anything'))
    expect(res.status).toBe(503)
    expect(submitPlatformRecords).not.toHaveBeenCalled()
  })

  it('reports a missing certificate as 503, not as a generic failure', async () => {
    // A misconfigured certificate is not transient, and it must be loud: the
    // alternative (falling back to a stub) would mark records sent while AEAT
    // held nothing.
    submitPlatformRecords.mockRejectedValue(new AeatCertificateMissingError('AEAT_CERT_PFX_BASE64 not set'))
    const res = await GET(request('Bearer test-secret'))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      error: 'AEAT certificate not configured',
    })
  })

  it('returns 500 on an unexpected failure, and never leaks internals', async () => {
    // A failed sweep is an ops event: records stay queued with retries, which is
    // what AEAT prescribes for an incident. Nothing about an invoice is at risk.
    submitPlatformRecords.mockRejectedValue(new Error('connection reset by peer'))
    const res = await GET(request('Bearer test-secret'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Submission sweep failed')
    expect(JSON.stringify(body)).not.toContain('connection reset')
  })
})
