/**
 * Fleet query auth + scoping (track 021 P5).
 *
 * A device belongs to exactly one customer — that association is flashed at the
 * bench so a unit lands in the right operator's list with no claiming step.
 * These tests pin that the query never crosses that boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))

import { getFleet } from './queries'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const OWNER = 'partner-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null as never)
})

describe('getFleet', () => {
  it('returns [] for an unauthenticated caller and never queries devices', async () => {
    expect(await getFleet()).toEqual([])
    expect(vi.mocked(prisma.device.findMany)).not.toHaveBeenCalled()
  })

  it('scopes strictly to the session user — one operator never sees another fleet', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER } } as never)
    vi.mocked(prisma.device.findMany).mockResolvedValue([] as never)

    await getFleet()

    expect(vi.mocked(prisma.device.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerAccountId: OWNER } }),
    )
  })

  it('derives health and battery per device rather than trusting stored state', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER } } as never)
    vi.mocked(prisma.device.findMany).mockResolvedValue([
      {
        id: 'd1', code: 'NWJMDB', status: 'active',
        assignedSiteId: 's1', assignedParcel: 1, assignedRow: 1, assignedSeq: 1,
        reportedLocation: '1-1-1', lastSeenAt: new Date(), fw: '1.4.2',
        battMv: 3200, rssiDbm: -70,
      },
      {
        id: 'd2', code: 'K3N8FQ', status: 'provisioned',
        assignedSiteId: null, assignedParcel: null, assignedRow: null, assignedSeq: null,
        reportedLocation: null, lastSeenAt: null, fw: null, battMv: null, rssiDbm: null,
      },
    ] as never)

    const fleet = await getFleet()

    expect(fleet[0]).toMatchObject({
      code: 'NWJMDB', assignedLocation: '1-1-1', health: 'ok', battery: 'critical',
    })
    // Provisioned but never heard from — the "flashed, not installed" case.
    expect(fleet[1]).toMatchObject({
      code: 'K3N8FQ', assignedLocation: null, health: 'never-seen', battery: 'unknown',
    })
  })
})
