/**
 * Tests for GET /api/cron/send-reminders
 *
 * Covers:
 *   - CRON_SECRET auth gate (missing secret → 503, wrong token → 401)
 *   - Sunbed sendDueReminders is called and its count returned
 *   - Rental sendRentalDueReminders is called and its count returned
 *   - Independent failure: sunbed reminders throwing still returns rental count (no 500)
 *   - Independent failure: rental reminders throwing still returns sunbed count (no 500)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { sendDueReminders } from '@repo/data/reservation-emails'
import { sendRentalDueReminders } from '@repo/data/rental-emails'

// vi.hoisted captures env vars at module-load time — use a hoisted ref for
// CRON_SECRET so we can override it per test without env leaking.
const { mockCronSecret } = vi.hoisted(() => ({ mockCronSecret: { value: 'test-secret' } }))

vi.mock('@repo/data/reservation-emails')
vi.mock('@repo/data/rental-emails')

vi.mock('process', () => ({})) // not needed; we stub via Object.defineProperty in beforeEach

const mockSendDueReminders = vi.mocked(sendDueReminders)
const mockSendRentalDueReminders = vi.mocked(sendRentalDueReminders)

function makeRequest(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/send-reminders', {
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Restore defaults after each test
  mockSendDueReminders.mockResolvedValue(0)
  mockSendRentalDueReminders.mockResolvedValue(0)
  // Set CRON_SECRET for the happy path — override per test as needed
  process.env.CRON_SECRET = 'test-secret'
})

describe('GET /api/cron/send-reminders', () => {
  describe('auth gate', () => {
    it('returns 503 when CRON_SECRET is not configured', async () => {
      delete process.env.CRON_SECRET
      const res = await GET(makeRequest('Bearer test-secret'))
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toMatchObject({ error: 'CRON_SECRET not configured' })
    })

    it('returns 401 when Authorization header is missing', async () => {
      const res = await GET(makeRequest())
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toMatchObject({ error: 'Unauthorized' })
    })

    it('returns 401 when Authorization header does not match', async () => {
      const res = await GET(makeRequest('Bearer wrong-secret'))
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toMatchObject({ error: 'Unauthorized' })
    })
  })

  describe('happy path', () => {
    it('calls sendDueReminders on an authenticated request', async () => {
      await GET(makeRequest('Bearer test-secret'))
      expect(mockSendDueReminders).toHaveBeenCalledOnce()
    })

    it('calls sendRentalDueReminders on an authenticated request', async () => {
      await GET(makeRequest('Bearer test-secret'))
      expect(mockSendRentalDueReminders).toHaveBeenCalledOnce()
    })

    it('returns ok: true with both sent counts', async () => {
      mockSendDueReminders.mockResolvedValue(3)
      mockSendRentalDueReminders.mockResolvedValue(7)

      const res = await GET(makeRequest('Bearer test-secret'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true, sent: 3, rentalsSent: 7 })
    })

    it('returns zero counts when no reminders are due', async () => {
      mockSendDueReminders.mockResolvedValue(0)
      mockSendRentalDueReminders.mockResolvedValue(0)

      const res = await GET(makeRequest('Bearer test-secret'))
      const body = await res.json()
      expect(body).toEqual({ ok: true, sent: 0, rentalsSent: 0 })
    })
  })

  describe('independent failure handling', () => {
    it('still returns rentalsSent when sunbed reminders throw, without 500ing', async () => {
      // The sunbed batch throws AFTER some sends — the rental batch should still run
      // and its count still be reported. The response must be 200 (not 500).
      mockSendDueReminders.mockRejectedValue(new Error('sunbed failure'))
      mockSendRentalDueReminders.mockResolvedValue(5)

      const res = await GET(makeRequest('Bearer test-secret'))
      expect(res.status).toBe(200)
      const body = await res.json()
      // Sunbed count defaults to 0 (error path), rental count is 5
      expect(body).toEqual({ ok: true, sent: 0, rentalsSent: 5 })
      // Both functions were still called
      expect(mockSendDueReminders).toHaveBeenCalledOnce()
      expect(mockSendRentalDueReminders).toHaveBeenCalledOnce()
    })

    it('still returns sent when rental reminders throw, without 500ing', async () => {
      mockSendDueReminders.mockResolvedValue(4)
      mockSendRentalDueReminders.mockRejectedValue(new Error('rental failure'))

      const res = await GET(makeRequest('Bearer test-secret'))
      expect(res.status).toBe(200)
      const body = await res.json()
      // Sunbed count is 4, rental defaults to 0 (error path)
      expect(body).toEqual({ ok: true, sent: 4, rentalsSent: 0 })
      expect(mockSendDueReminders).toHaveBeenCalledOnce()
      expect(mockSendRentalDueReminders).toHaveBeenCalledOnce()
    })

    it('returns ok: true with zero counts when both throw', async () => {
      mockSendDueReminders.mockRejectedValue(new Error('sunbed failure'))
      mockSendRentalDueReminders.mockRejectedValue(new Error('rental failure'))

      const res = await GET(makeRequest('Bearer test-secret'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true, sent: 0, rentalsSent: 0 })
    })
  })
})
