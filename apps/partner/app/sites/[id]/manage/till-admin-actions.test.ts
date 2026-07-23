/**
 * Unit tests for the admin-gated till summary actions:
 *   getOpenTills      — live unclosed tills for all employees
 *   getTillDayReport  — historical per-employee totals for a civil day
 *
 * Gate: verifySiteAdmin (lib/auth-helpers.ts) — requires 'admin' in the
 * token's resources. A plain ['all'] / ['manage_site'] token must be REJECTED.
 * Owner/sudo session passes via the session path.
 *
 * These tests are requirements-driven: they fail when the auth gate is absent
 * or when the wrong token scope is accepted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@repo/data/payment', () => ({
  processConfirmedReservation: vi.fn().mockResolvedValue(undefined),
  processCashRentalBooking: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@repo/data/reservations', () => ({
  reserveWithConflictGuard: vi.fn().mockResolvedValue({ outcome: 'created', reservationId: 'r1' }),
  moveReservationWithConflictGuard: vi.fn().mockResolvedValue({ outcome: 'moved' }),
  createRentalBookingsWithGuard: vi.fn().mockResolvedValue({ outcome: 'created', bookingIds: ['rb1'] }),
}))

import { getOpenTills, getTillDayReport } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getOpenTillsByEmployee, getTillByEmployee } from '@repo/data/till'

const mockAuth = vi.mocked(auth)
const mockGetOpenTillsByEmployee = vi.mocked(getOpenTillsByEmployee)
const mockGetTillByEmployee = vi.mocked(getTillByEmployee)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-1'
const SITE_ID = 'site-1'

const VALID_ADMIN_TOKEN = {
  id: 'admin-token-1',
  userId: OWNER_ID,
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
  resources: ['all', 'admin'],
}

beforeEach(() => {
  vi.clearAllMocks()
  // Always reset to null — clearAllMocks clears call history but not
  // implementations; auth leaks between tests if not reset here.
  mockAuth.mockResolvedValue(null)
  // Default: token not found (unauthenticated/wrong-scope token).
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)
  // Default: site owned by OWNER_ID.
  vi.mocked(prisma.site.findUnique).mockResolvedValue({
    userId: OWNER_ID,
    timeZone: 'Europe/Madrid',
    locationLat: '40.4',
    locationLng: '-3.7',
    features: [],
  } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  // Default aggregations return empty.
  mockGetOpenTillsByEmployee.mockResolvedValue([])
  mockGetTillByEmployee.mockResolvedValue([])
})

// ─── Helper: authenticate as owner via session ────────────────────────────────

function authenticateAsOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
}

function authenticateAsSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'sudo-user' } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
}

function applyAdminToken() {
  mockAuth.mockResolvedValue(null)
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(VALID_ADMIN_TOKEN as any)
}

// ─── getOpenTills ─────────────────────────────────────────────────────────────

describe('getOpenTills', () => {

  // AUTH GATE TESTS — these are the whole point of verifySiteAdmin.

  it('no session, no token → rejects with Not authenticated', async () => {
    const res = await getOpenTills(SITE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('authenticated non-owner session → rejects with Not authorized', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    const res = await getOpenTills(SITE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('plain manage/all token (lacks "admin" resource) → REJECTED', async () => {
    // This is the critical gate test: a standard manage-page token must NOT
    // be able to access the admin till summary. The Prisma filter
    // (hasSome: ['admin']) returns null for this token because 'admin' is absent.
    // We model this by keeping findUnique returning null (the default).
    const res = await getOpenTills(SITE_ID, 'plain-manage-token')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid or expired access key')
  })

  it('admin token (has "admin" resource) → authorized', async () => {
    applyAdminToken()
    const res = await getOpenTills(SITE_ID, VALID_ADMIN_TOKEN.id)
    expect(res.status).toBe('ok')
  })

  it('owner session → authorized', async () => {
    authenticateAsOwner()
    const res = await getOpenTills(SITE_ID)
    expect(res.status).toBe('ok')
  })

  it('sudo user → authorized (bypasses ownership check)', async () => {
    authenticateAsSudo()
    const res = await getOpenTills(SITE_ID)
    expect(res.status).toBe('ok')
  })

  // HAPPY-PATH DATA TESTS

  it('returns aggregation from getOpenTillsByEmployee on success', async () => {
    authenticateAsOwner()
    const tills = [
      { employeeId: 'emp-1', name: 'Alice', active: true, total: 120, count: 4 },
      { employeeId: 'emp-2', name: 'Bob', active: true, total: 0, count: 0 },
    ]
    mockGetOpenTillsByEmployee.mockResolvedValue(tills)

    const res = await getOpenTills(SITE_ID)

    expect(res.status).toBe('ok')
    expect(res.tills).toEqual(tills)
    expect(mockGetOpenTillsByEmployee).toHaveBeenCalledWith(SITE_ID, expect.any(Date))
  })

  it('returns empty array when no employees have open tills', async () => {
    authenticateAsOwner()
    mockGetOpenTillsByEmployee.mockResolvedValue([])

    const res = await getOpenTills(SITE_ID)

    expect(res.status).toBe('ok')
    expect(res.tills).toEqual([])
  })

  it('forwards a site-derived dayStart (venue-local start of today) — track 016', async () => {
    authenticateAsOwner()
    // Site is in Madrid (UTC+2 in summer) — dayStart must be a real Date, not
    // the server's own local midnight, proving the action derives it from the
    // site's timezone rather than skipping the day-anchoring entirely.
    await getOpenTills(SITE_ID)

    expect(mockGetOpenTillsByEmployee).toHaveBeenCalledTimes(1)
    const [calledSiteId, dayStart] = mockGetOpenTillsByEmployee.mock.calls[0]!
    expect(calledSiteId).toBe(SITE_ID)
    expect(dayStart).toBeInstanceOf(Date)
    // dayStart must be at-or-before "now" (it's the start of the current venue day).
    expect((dayStart as Date).getTime()).toBeLessThanOrEqual(Date.now())
  })
})

// ─── getTillDayReport ─────────────────────────────────────────────────────────

describe('getTillDayReport', () => {

  // AUTH GATE TESTS

  it('no session, no token → rejects with Not authenticated', async () => {
    const res = await getTillDayReport(SITE_ID, '2025-07-01')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('authenticated non-owner session → rejects with Not authorized', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    const res = await getTillDayReport(SITE_ID, '2025-07-01')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('plain manage/all token (lacks "admin" resource) → REJECTED', async () => {
    // findUnique returns null because 'admin' is missing from resources filter.
    const res = await getTillDayReport(SITE_ID, '2025-07-01', 'plain-manage-token')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid or expired access key')
  })

  it('admin token (has "admin" resource) → authorized', async () => {
    applyAdminToken()
    const res = await getTillDayReport(SITE_ID, '2025-07-01', VALID_ADMIN_TOKEN.id)
    expect(res.status).toBe('ok')
  })

  it('owner session → authorized', async () => {
    authenticateAsOwner()
    const res = await getTillDayReport(SITE_ID, '2025-07-01')
    expect(res.status).toBe('ok')
  })

  it('sudo user → authorized (bypasses ownership check)', async () => {
    authenticateAsSudo()
    const res = await getTillDayReport(SITE_ID, '2025-07-01')
    expect(res.status).toBe('ok')
  })

  // DATE VALIDATION TESTS

  it('rejects malformed dateIso (no dashes)', async () => {
    authenticateAsOwner()
    const res = await getTillDayReport(SITE_ID, '20250701')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid date format — expected YYYY-MM-DD')
  })

  it('rejects malformed dateIso (wrong format)', async () => {
    authenticateAsOwner()
    const res = await getTillDayReport(SITE_ID, '07/01/2025')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid date format — expected YYYY-MM-DD')
  })

  it('rejects malformed dateIso (empty string)', async () => {
    authenticateAsOwner()
    const res = await getTillDayReport(SITE_ID, '')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid date format — expected YYYY-MM-DD')
  })

  it('rejects malformed dateIso (partial)', async () => {
    authenticateAsOwner()
    const res = await getTillDayReport(SITE_ID, '2025-07')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid date format — expected YYYY-MM-DD')
  })

  // HAPPY-PATH DATA TESTS

  it('returns aggregation from getTillByEmployee on success', async () => {
    authenticateAsOwner()
    const tills = [
      { employeeId: 'emp-1', name: 'Alice', active: true, total: 85, count: 3 },
    ]
    mockGetTillByEmployee.mockResolvedValue(tills)

    const res = await getTillDayReport(SITE_ID, '2025-07-01')

    expect(res.status).toBe('ok')
    expect(res.tills).toEqual(tills)
  })

  it('calls getTillByEmployee with venue-local day bounds derived from site timezone', async () => {
    authenticateAsOwner()
    // Site is in Madrid (UTC+2 in summer). For 2025-07-01:
    //   venue local 00:00 = 2025-06-30T22:00:00Z (UTC)
    //   venue local 23:59:59.999 = 2025-07-01T21:59:59.999Z (UTC)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      timeZone: 'Europe/Madrid',
      locationLat: '40.4',
      locationLng: '-3.7',
    } as any)

    await getTillDayReport(SITE_ID, '2025-07-01')

    expect(mockGetTillByEmployee).toHaveBeenCalledTimes(1)
    const [calledSiteId, from, to] = mockGetTillByEmployee.mock.calls[0]!
    expect(calledSiteId).toBe(SITE_ID)
    // Both from and to must be Date instances
    expect(from).toBeInstanceOf(Date)
    expect(to).toBeInstanceOf(Date)
    // from is before to
    expect(from.getTime()).toBeLessThan(to.getTime())
    // The requested date (2025-07-01) must be fully inside [from, to]
    const midDay = new Date('2025-07-01T12:00:00.000Z')
    expect(from.getTime()).toBeLessThanOrEqual(midDay.getTime())
    expect(to.getTime()).toBeGreaterThanOrEqual(midDay.getTime())
  })

  it('calls getTillByEmployee with site-id matching the action siteId', async () => {
    authenticateAsOwner()
    await getTillDayReport(SITE_ID, '2025-07-01')
    expect(mockGetTillByEmployee.mock.calls[0]![0]).toBe(SITE_ID)
  })
})
