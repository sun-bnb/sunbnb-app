'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { deviceHealth, formatLocation, batteryLevel, type DeviceHealth } from './device-health'

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

  const devices = await prisma.device.findMany({
    where: { partnerAccountId: session.user.id },
    select: {
      id: true, code: true, status: true,
      assignedSiteId: true, assignedParcel: true, assignedRow: true, assignedSeq: true,
      reportedLocation: true, lastSeenAt: true, fw: true, battMv: true, rssiDbm: true,
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
