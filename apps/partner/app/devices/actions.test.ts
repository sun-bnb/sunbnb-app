/**
 * Device assignment (track 021).
 *
 * Assigning is naming the SPOT a device is mounted on. The validation here is
 * the last chance to catch an address that names nothing — past this point the
 * failure is a device on a pole polling an address that resolves to no unit,
 * sitting amber, discoverable only by walking out to it.
 *
 * The address is looked up through the same key the HW state route resolves
 * with (`UNIQUE(site_id, parcel, row_idx, seq)`), which is the property these
 * tests exist to hold: when this check and the resolver disagree, an operator
 * gets a green confirmation for a device that will never light.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { assignDeviceLocation, setDevicePowerPolicy, clearDevicePowerPolicy } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const mockDevice = vi.mocked(prisma.device.findFirst)
const mockDeviceUpdate = vi.mocked(prisma.device.update)
const mockSite = vi.mocked(prisma.site.findFirst)
const mockUnit = vi.mocked(prisma.sunbedGroup.findUnique)

const OWNER = 'partner-1'
const SITE_ID = 'site-1'
const DEVICE_ID = 'device-1'
const AT = { siteId: SITE_ID, parcel: 1, row: 4, seq: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: OWNER } } as never)
  mockDevice.mockResolvedValue({ id: DEVICE_ID } as never)
  mockSite.mockResolvedValue({ id: SITE_ID } as never)
  mockUnit.mockResolvedValue({ items: [{ id: 'seat-1' }] } as never)
  mockDeviceUpdate.mockResolvedValue({} as never)
})

describe('assignDeviceLocation — the address must name a real spot', () => {
  it('looks the unit up by the FULL address, row included', async () => {
    // `seq` is scoped to (parcel,row), so 1-4-2 and 1-5-2 are different
    // parasols. Validating without the row would approve an assignment that
    // resolves to a neighbouring row's unit at poll time.
    await assignDeviceLocation(DEVICE_ID, AT)

    expect(mockUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          siteId_parcel_row_seq: { siteId: SITE_ID, parcel: 1, row: 4, seq: 2 },
        },
      }),
    )
  })

  it('refuses an address where no unit stands, naming it back', async () => {
    mockUnit.mockResolvedValue(null as never)

    const res = await assignDeviceLocation(DEVICE_ID, AT)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('1-4-2')
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })

  it('refuses a unit that holds nothing but pool spares', async () => {
    // A spare parked at a unit is not a bed under that parasol — the device
    // would resolve the address and then have no segment to light.
    mockUnit.mockResolvedValue({ items: [] } as never)

    const res = await assignDeviceLocation(DEVICE_ID, AT)

    expect(res.status).toBe('error')
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })

  it('excludes pool spares in the lookup itself', async () => {
    await assignDeviceLocation(DEVICE_ID, AT)

    expect(mockUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          items: expect.objectContaining({ where: { status: { not: 'pool' } } }),
        }),
      }),
    )
  })

  it('writes the address and asks the bar to flash on success', async () => {
    // The flash is not decoration: the operator is standing at the parasol, and
    // a silent re-point is the one failure that makes a light lie.
    const res = await assignDeviceLocation(DEVICE_ID, AT)

    expect(res.status).toBe('ok')
    expect(mockDeviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEVICE_ID },
        data: expect.objectContaining({
          assignedSiteId: SITE_ID,
          assignedParcel: 1,
          assignedRow: 4,
          assignedSeq: 2,
          pendingCmd: 'identify',
        }),
      }),
    )
  })
})

describe('assignDeviceLocation — boundaries', () => {
  it('refuses a site the operator does not run', async () => {
    mockSite.mockResolvedValue(null as never)

    const res = await assignDeviceLocation(DEVICE_ID, AT)

    expect(res.status).toBe('error')
    expect(mockUnit).not.toHaveBeenCalled()
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['fractional', { ...AT, row: 1.5 }],
    ['negative', { ...AT, seq: -1 }],
    ['NaN', { ...AT, parcel: Number.NaN }],
  ])('refuses a %s address component before touching the database', async (_label, at) => {
    const res = await assignDeviceLocation(DEVICE_ID, at)

    expect(res.status).toBe('error')
    expect(mockUnit).not.toHaveBeenCalled()
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })

  it('refuses a device the operator does not own', async () => {
    mockDevice.mockResolvedValue(null as never)

    const res = await assignDeviceLocation(DEVICE_ID, AT)

    expect(res.status).toBe('error')
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })
})

// ── Per-device power policy (track 025) ──────────────────────────────────────
//
// The operator is choosing how their own devices spend their battery, so the
// properties here are the ones a wrong answer makes expensive: nobody edits a
// fleet they do not own, the pair is never written half-set (a mode without a
// cadence is resolved by clamping, i.e. a number nobody chose), and an interval
// the chosen mode physically cannot keep never reaches the row.

describe('setDevicePowerPolicy — the pair, or nothing', () => {
  it('writes both columns together', async () => {
    const result = await setDevicePowerPolicy(DEVICE_ID, 'light_sleep', 20)

    expect(result).toEqual({ status: 'ok' })
    expect(mockDeviceUpdate).toHaveBeenCalledWith({
      where: { id: DEVICE_ID },
      data: { powerMode: 'light_sleep', pollIntervalSec: 20 },
    })
  })

  it('accepts the interval as a string, the way a form sends it', async () => {
    await setDevicePowerPolicy(DEVICE_ID, 'deep_sleep', '120')
    expect(mockDeviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { powerMode: 'deep_sleep', pollIntervalSec: 120 } }),
    )
  })

  it('refuses an interval the chosen mode cannot keep, and writes nothing', async () => {
    for (const [mode, seconds] of [
      ['continuous', 60],
      ['light_sleep', 5],
      ['deep_sleep', 10],
    ] as const) {
      const result = await setDevicePowerPolicy(DEVICE_ID, mode, seconds)
      expect(result.status).toBe('error')
    }
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })

  it('names the mode and its band in the refusal — the operator has to fix it', async () => {
    const result = await setDevicePowerPolicy(DEVICE_ID, 'continuous', 60)
    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.errors[0]).toContain('Continuous')
      expect(result.errors[0]).toContain('1–15 seconds')
    }
  })

  it('refuses an unknown mode without touching the database', async () => {
    for (const mode of ['hibernate', 'Light Sleep', '']) {
      expect((await setDevicePowerPolicy(DEVICE_ID, mode, 20)).status).toBe('error')
    }
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })

  it('refuses a device the operator does not own, and writes nothing', async () => {
    mockDevice.mockResolvedValue(null as never)
    expect((await setDevicePowerPolicy(DEVICE_ID, 'light_sleep', 20)).status).toBe('error')
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller, and writes nothing', async () => {
    mockAuth.mockResolvedValue(null as never)
    expect((await setDevicePowerPolicy(DEVICE_ID, 'light_sleep', 20)).status).toBe('error')
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })

  it('does NOT queue an identify — a cadence is not visible on the bar', async () => {
    // Unlike assignment and segment order, both of which are confirmed by
    // looking at the parasol. A deep-sleep device would also usually outlive
    // the command's TTL before its next poll.
    await setDevicePowerPolicy(DEVICE_ID, 'light_sleep', 20)
    const data = mockDeviceUpdate.mock.calls[0]?.[0].data as Record<string, unknown>
    expect(data).not.toHaveProperty('pendingCmd')
  })
})

describe('clearDevicePowerPolicy', () => {
  it('nulls BOTH columns, so the device follows the venue default again', async () => {
    const result = await clearDevicePowerPolicy(DEVICE_ID)

    expect(result).toEqual({ status: 'ok' })
    expect(mockDeviceUpdate).toHaveBeenCalledWith({
      where: { id: DEVICE_ID },
      data: { powerMode: null, pollIntervalSec: null },
    })
  })

  it('refuses a device the operator does not own, and writes nothing', async () => {
    mockDevice.mockResolvedValue(null as never)
    expect((await clearDevicePowerPolicy(DEVICE_ID)).status).toBe('error')
    expect(mockDeviceUpdate).not.toHaveBeenCalled()
  })
})
