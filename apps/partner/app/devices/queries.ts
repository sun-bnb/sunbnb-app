'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { deviceHealth, formatLocation, batteryLevel, type DeviceHealth } from './device-health'
import { getPlatformDevicePolicy } from '@repo/data/preferences'
import {
  resolveDevicePolicyForDevice,
  resolveDevicePolicy,
  type DevicePowerMode,
  type DevicePolicySource,
} from '@repo/data/device-power'

export interface FleetDevice {
  id: string
  code: string
  status: string
  assignedLocation: string | null
  assignedSiteId: string | null
  reportedLocation: string | null
  lastSeenAt: Date | null
  fw: string | null
  battMv: number | null
  battery: ReturnType<typeof batteryLevel>
  rssiDbm: number | null
  reverseSegments: boolean
  /**
   * What this device is actually being served on its next poll, and where that
   * came from. Resolved here rather than in the view for the same reason
   * `health` is: one opinion about a device, testable without a browser, and
   * produced by the very function the hardware route uses — a badge that can
   * disagree with the device is worse than no badge.
   */
  policy: { mode: DevicePowerMode; pollAfterSec: number; source: DevicePolicySource }
  /** The device's own override as stored, or null when it inherits. */
  policyOverride: { mode: string; intervalSec: number } | null
  /**
   * Set when the device claims a DIFFERENT customer than the one it is
   * registered to. Recorded, never applied — surfaced here because a claim
   * nobody sees is the same as no claim at all.
   */
  claimedPartnerCode: string | null
  health: DeviceHealth
}

/**
 * The customer's fleet (track 021 P5). Session-scoped by `partnerAccountId`,
 * which is flashed on the device at the bench — so a device lands in exactly
 * one operator's list with no claiming step, and appears there on its FIRST
 * poll, before anyone has assigned it anything.
 *
 * Returns [] rather than throwing for an unauthenticated caller: this is a
 * read, and the ungated-allowlist pattern (see getSite) is ownership enforced
 * in the query itself.
 */
export async function getFleet(): Promise<FleetDevice[]> {
  const session = await auth()
  if (!session?.user) return []

  // ONE platform read for the whole fleet, not one per device: it is the same
  // fallback for every row, and it is cached besides.
  const platform = await getPlatformDevicePolicy()

  const devices = await prisma.device.findMany({
    where: { partnerAccountId: session.user.id },
    select: {
      id: true, code: true, status: true,
      assignedSiteId: true, assignedParcel: true, assignedRow: true, assignedSeq: true,
      reportedLocation: true, lastSeenAt: true, fw: true, battMv: true, rssiDbm: true,
      reverseSegments: true, claimedPartnerCode: true,
      powerMode: true, pollIntervalSec: true,
    },
    orderBy: [{ assignedParcel: 'asc' }, { assignedRow: 'asc' }, { assignedSeq: 'asc' }, { code: 'asc' }],
  })

  const now = new Date()
  return devices.map((device) => {
    const assignedLocation = formatLocation(device)
    return {
      id: device.id,
      code: device.code,
      status: device.status,
      assignedLocation,
      assignedSiteId: device.assignedSiteId,
      reportedLocation: device.reportedLocation,
      lastSeenAt: device.lastSeenAt,
      fw: device.fw,
      battMv: device.battMv,
      battery: batteryLevel(device.battMv),
      rssiDbm: device.rssiDbm,
      reverseSegments: device.reverseSegments,
      policy: resolveDevicePolicyForDevice(
        { mode: device.powerMode, intervalSec: device.pollIntervalSec },
        platform,
      ),
      policyOverride:
        device.powerMode && device.pollIntervalSec != null
          ? { mode: device.powerMode, intervalSec: device.pollIntervalSec }
          : null,
      claimedPartnerCode: device.claimedPartnerCode,
      health: deviceHealth(
        {
          assignedLocation,
          reportedLocation: device.reportedLocation,
          lastSeenAt: device.lastSeenAt,
        },
        now,
      ),
    }
  })
}

/** The operator's own venues — a device may only be pointed at one of these. */
export async function getAssignableSites(): Promise<{ id: string; name: string }[]> {
  const session = await auth()
  if (!session?.user) return []
  const sites = await prisma.site.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return sites.map((site) => ({ id: site.id, name: site.name ?? 'Untitled site' }))
}

/**
 * The fleet default, for the two things a per-device value cannot supply: what
 * to prefill the editor with when a device is currently inheriting, and what to
 * call the escape hatch ("Use platform default — deep sleep, 60 s"). Resolved
 * (clamped) rather than raw, because it is shown to a person.
 */
export async function getPlatformPolicy(): Promise<{
  mode: DevicePowerMode
  pollAfterSec: number
}> {
  const platform = await getPlatformDevicePolicy()
  const { mode, pollAfterSec } = resolveDevicePolicy(platform.mode, platform.intervalSec)
  return { mode, pollAfterSec }
}
