/**
 * Tests for GET /api/cron/prune-telemetry
 *
 * This endpoint DESTROYS data no backfill can reconstruct, so the auth gate is
 * not boilerplate here — an unauthenticated caller must never be able to reach
 * the sweep, and a missing secret must fail CLOSED rather than sweep with no
 * protection at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { pruneDeviceTelemetry } from '@repo/data/device-telemetry'

vi.mock('@repo/data/device-telemetry')

const mockPrune = vi.mocked(pruneDeviceTelemetry)

function makeRequest(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/prune-telemetry', {
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

const CUTOFF = new Date('2025-09-23T03:20:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  mockPrune.mockResolvedValue({ deleted: 0, complete: true, cutoff: CUTOFF, retentionDays: 365 })
  process.env.CRON_SECRET = 'test-secret'
})

describe('GET /api/cron/prune-telemetry', () => {
  describe('auth gate', () => {
    it('fails CLOSED with 503 when CRON_SECRET is not configured', async () => {
      delete process.env.CRON_SECRET
      const res = await GET(makeRequest('Bearer test-secret'))
      expect(res.status).toBe(503)
      expect(mockPrune).not.toHaveBeenCalled()
    })

    it('returns 401 without an Authorization header, and does not sweep', async () => {
      const res = await GET(makeRequest())
      expect(res.status).toBe(401)
      expect(mockPrune).not.toHaveBeenCalled()
    })

    it('returns 401 for the wrong token, and does not sweep', async () => {
      const res = await GET(makeRequest('Bearer wrong'))
      expect(res.status).toBe(401)
      expect(mockPrune).not.toHaveBeenCalled()
    })
  })

  it('sweeps and reports what it enforced', async () => {
    mockPrune.mockResolvedValue({ deleted: 1200, complete: true, cutoff: CUTOFF, retentionDays: 365 })
    const res = await GET(makeRequest('Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      deleted: 1200,
      complete: true,
      retentionDays: 365,
      cutoff: CUTOFF.toISOString(),
    })
  })

  it('reports an incomplete sweep as a 200, not a failure', async () => {
    // Hitting the per-run ceiling is the design working, not an error: the
    // remainder goes with tomorrow's run.
    mockPrune.mockResolvedValue({ deleted: 250_000, complete: false, cutoff: CUTOFF, retentionDays: 7 })
    const res = await GET(makeRequest('Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ complete: false, deleted: 250_000 })
  })

  it('returns 500 when the sweep throws, without leaking the reason', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrune.mockRejectedValue(new Error('connection terminated'))
    const res = await GET(makeRequest('Bearer test-secret'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Prune failed' })
  })
})
