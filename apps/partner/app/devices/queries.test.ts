/**
 * Fleet query auth + scoping (track 021 P5).
 *
 * A device belongs to exactly one customer — that association is flashed at the
 * bench so a unit lands in the right operator's list with no claiming step.
 * These tests pin that the query never crosses that boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))

import { getFleet, getPlatformPolicy } from './queries'
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
        battMv: 3200, rssiDbm: -70, reverseSegments: true, claimedPartnerCode: 'P-7ZZZZ',
      },
      {
        id: 'd2', code: 'K3N8FQ', status: 'provisioned',
        assignedSiteId: null, assignedParcel: null, assignedRow: null, assignedSeq: null,
        reportedLocation: null, lastSeenAt: null, fw: null, battMv: null, rssiDbm: null,
        reverseSegments: false, claimedPartnerCode: null,
      },
    ] as never)

    const fleet = await getFleet()

    expect(fleet[0]).toMatchObject({
      code: 'NWJMDB', assignedLocation: '1-1-1', health: 'ok', battery: 'critical',
      // Q2: surfaced so the UI can show which way round the bar is mounted.
      reverseSegments: true,
      // A disputed device stays with its registered owner; the claim is only
      // surfaced, never applied.
      claimedPartnerCode: 'P-7ZZZZ',
    })
    // Provisioned but never heard from — the "flashed, not installed" case.
    expect(fleet[1]).toMatchObject({
      code: 'K3N8FQ', assignedLocation: null, health: 'never-seen', battery: 'unknown',
    })
  })
})

// ── Per-device power policy (track 025) ──────────────────────────────────────
//
// The badge in the fleet list is the operator's only view of what a device is
// actually being served, so it is resolved HERE with the very function the
// hardware route uses. A badge that can disagree with the device is worse than
// no badge: it is the screen someone checks instead of walking out to the pole.

/** A fleet row as the select returns it, with the policy columns set. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1', code: 'NWJMDB', status: 'active',
    assignedSiteId: 's1', assignedParcel: 1, assignedRow: 1, assignedSeq: 1,
    reportedLocation: '1-1-1', lastSeenAt: new Date(), fw: '1.4.2',
    battMv: 4000, rssiDbm: -70, reverseSegments: false, claimedPartnerCode: null,
    powerMode: null, pollIntervalSec: null,
    ...overrides,
  }
}

describe('getFleet — effective power policy', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: OWNER } } as never)
    // No platform override stored → the registry defaults (deep_sleep / 60 s).
    vi.mocked(prisma.platformPreference.findUnique).mockResolvedValue(null as never)
  })

  it('reports the venue default for a device with no override of its own', async () => {
    vi.mocked(prisma.device.findMany).mockResolvedValue([row()] as never)

    const [device] = await getFleet()

    expect(device!.policy).toEqual({
      mode: 'deep_sleep',
      pollAfterSec: 60,
      clamped: false,
      source: 'platform',
    })
    expect(device!.policyOverride).toBeNull()
  })

  it('reports the device OWN policy when it carries one, and says so', async () => {
    vi.mocked(prisma.device.findMany).mockResolvedValue([
      row({ powerMode: 'continuous', pollIntervalSec: 5 }),
    ] as never)

    const [device] = await getFleet()

    expect(device!.policy).toMatchObject({ mode: 'continuous', pollAfterSec: 5, source: 'device' })
    expect(device!.policyOverride).toEqual({ mode: 'continuous', intervalSec: 5 })
  })

  it('treats a half-set row as no override at all', async () => {
    // The DB constraint refuses one, but a restore or an older release could
    // still present it, and the badge must not claim half a policy.
    vi.mocked(prisma.device.findMany).mockResolvedValue([
      row({ powerMode: 'continuous', pollIntervalSec: null }),
    ] as never)

    const [device] = await getFleet()

    expect(device!.policy.source).toBe('platform')
    expect(device!.policyOverride).toBeNull()
  })

  it('reads the platform pair ONCE for the whole fleet, not once per device', async () => {
    vi.mocked(prisma.device.findMany).mockResolvedValue([
      row({ id: 'd1' }), row({ id: 'd2' }), row({ id: 'd3' }),
    ] as never)

    await getFleet()

    // Two keys make up the pair; three devices must not make it six reads.
    expect(vi.mocked(prisma.platformPreference.findUnique).mock.calls.length)
      .toBeLessThanOrEqual(2)
  })
})

describe('getPlatformPolicy', () => {
  it('hands the editor a RESOLVED default to prefill and to name', async () => {
    vi.mocked(prisma.platformPreference.findUnique).mockResolvedValue(null as never)
    await expect(getPlatformPolicy()).resolves.toEqual({ mode: 'deep_sleep', pollAfterSec: 60 })
  })
})
