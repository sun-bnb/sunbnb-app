/**
 * Regression tests for getSite ownership guard.
 *
 * Bug fixed: getSite previously had no auth check, exposing full site data
 * (including reservations.user.email) to any caller with a siteId.
 *
 * Fix: ownership enforced query-side via:
 *   where: { id: siteId, userId: session.user.id }
 *   (queries.ts — mirrors the getBrand pattern in site-actions.ts)
 *
 * These tests are the regression guard. getSite is on the UNGATED_ALLOWLIST
 * (not the gated-actions registry) because it returns data|null rather than
 * { status } and enforces ownership at the query layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@repo/data/payment', () => ({
  resolveSiteFees: vi.fn().mockResolvedValue([]),
}))

import { getSite } from './queries'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const OWNER_ID = 'owner-1'
const OTHER_USER_ID = 'other-user-2'
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── unauthenticated caller ──────────────────────────────────────────────────

describe('getSite — unauthenticated caller', () => {
  it('returns null without querying the DB', async () => {
    // no session set — mockAuth returns null
    const result = await getSite(SITE_ID)

    expect(result).toBeNull()
    // must not reach Prisma at all
    expect(vi.mocked(prisma.site.findFirst)).not.toHaveBeenCalled()
  })
})

// ─── non-owner caller ────────────────────────────────────────────────────────

describe('getSite — non-owner caller', () => {
  it('returns null when the site does not belong to the session user', async () => {
    // Authenticated as OTHER_USER_ID (not the site owner)
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)

    // Prisma returns null because the where-clause filters userId !== OTHER_USER_ID
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null)

    const result = await getSite(SITE_ID)

    expect(result).toBeNull()

    // Confirm the ownership filter was passed to Prisma
    const call = vi.mocked(prisma.site.findFirst).mock.calls[0]![0]
    expect((call.where as any).userId).toBe(OTHER_USER_ID)
    expect((call.where as any).id).toBe(SITE_ID)
  })
})

// ─── owner caller ────────────────────────────────────────────────────────────

describe('getSite — owner caller', () => {
  it('returns site data when the session user owns the site', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const fakeSite = {
      id: SITE_ID,
      userId: OWNER_ID,
      workingHours: [],
      inventoryItems: [],
      layoutElements: [],
      products: [],
    }
    vi.mocked(prisma.site.findFirst).mockResolvedValue(fakeSite as any)

    const result = await getSite(SITE_ID)

    expect(result).toMatchObject({ id: SITE_ID, userId: OWNER_ID })

    // Ownership filter is still in place — not bypassed for owner
    const call = vi.mocked(prisma.site.findFirst).mock.calls[0]![0]
    expect((call.where as any).userId).toBe(OWNER_ID)
  })
})
