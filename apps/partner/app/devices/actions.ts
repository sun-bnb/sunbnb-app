'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { unitAddressWhere, SEGMENT_SEATS } from '@repo/data/unit-address'
import { validateDevicePolicy } from '@repo/data/device-power'

/**
 * Device assignment (track 021 P5).
 *
 * Assigning is naming the SPOT a device is mounted on — parcel, row, unit — not
 * binding it to seats. The device then answers for whatever unit occupies that
 * address, so a parcel rebuilt at the same address needs no re-assignment.
 *
 * Every action is scoped to the customer flashed on the device at the bench: an
 * operator can only touch their own fleet, and there is no claiming step.
 */

// NOTE: no non-function exports here. A `'use server'` file may export async
// functions ONLY — a exported constant compiles fine and then 500s at request
// time ("can only export async functions, found number"). The command TTL that
// pairs with this lives beside the reader, in the user app's hw-filter.

async function ownedDevice(deviceId: string) {
  const session = await auth()
  if (!session?.user) return { error: 'Not authenticated' as const }
  const device = await prisma.device.findFirst({
    where: { id: deviceId, partnerAccountId: session.user.id },
    select: { id: true },
  })
  if (!device) return { error: 'Not authorized' as const }
  return { device }
}

export async function assignDeviceLocation(
  deviceId: string,
  location: { siteId: string; parcel: number; row: number; seq: number },
) {
  const owned = await ownedDevice(deviceId)
  if ('error' in owned) return { status: 'error' as const, errors: [owned.error] }

  const { siteId, parcel, row, seq } = location
  if (![parcel, row, seq].every((n) => Number.isInteger(n) && n >= 0)) {
    return { status: 'error' as const, errors: ['Location must be whole numbers'] }
  }

  // The site must be the operator's own — a device may only point at a venue
  // its owner runs.
  const session = await auth()
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session!.user!.id },
    select: { id: true },
  })
  if (!site) return { status: 'error' as const, errors: ['Unknown site'] }

  // Refuse to assign an address that holds no unit. The device would poll,
  // resolve nothing and sit amber — a failure the operator would only discover
  // by walking out to it, so catch it here where it can still be corrected.
  //
  // Track 021: the SAME indexed lookup the HW state route resolves with. It used
  // to re-derive the address from seats independently, so this check and the
  // thing it was protecting could disagree about whether a spot existed.
  const unit = await prisma.sunbedGroup.findUnique({
    where: unitAddressWhere({ siteId, parcel, row, seq }),
    select: { items: { where: SEGMENT_SEATS, select: { id: true }, take: 1 } },
  })
  if (!unit || unit.items.length === 0) {
    return {
      status: 'error' as const,
      errors: [`No sunbed unit at ${parcel}-${row}-${seq} on that site`],
    }
  }

  await prisma.device.update({
    where: { id: deviceId },
    data: {
      assignedSiteId: siteId,
      assignedParcel: parcel,
      assignedRow: row,
      assignedSeq: seq,
      // Assigning always offers the confirmation flash: the operator is standing
      // there, and a silent re-point is the one failure that makes a light lie.
      pendingCmd: 'identify',
      pendingCmdAt: new Date(),
    },
  })
  revalidatePath('/devices')
  return { status: 'ok' as const }
}

export async function unassignDevice(deviceId: string) {
  const owned = await ownedDevice(deviceId)
  if ('error' in owned) return { status: 'error' as const, errors: [owned.error] }

  await prisma.device.update({
    where: { id: deviceId },
    data: {
      assignedSiteId: null,
      assignedParcel: null,
      assignedRow: null,
      assignedSeq: null,
      pendingCmd: null,
      pendingCmdAt: null,
    },
  })
  revalidatePath('/devices')
  return { status: 'ok' as const }
}

/**
 * Flash the bar so staff can confirm WHICH box they are looking at. Delivered on
 * the device's next poll, so it lands within a cadence rather than instantly —
 * the UI should say "watch for the flash", not pretend it is immediate.
 */
export async function identifyDevice(deviceId: string) {
  const owned = await ownedDevice(deviceId)
  if ('error' in owned) return { status: 'error' as const, errors: [owned.error] }

  await prisma.device.update({
    where: { id: deviceId },
    data: { pendingCmd: 'identify', pendingCmdAt: new Date() },
  })
  revalidatePath('/devices')
  return { status: 'ok' as const }
}

/**
 * Q2: flip which end of the bar is which, for a device mounted rotated (or a
 * row numbered right-to-left).
 *
 * Server-side on purpose. The firmware deliberately does not compensate — that
 * would put a second opinion about a physical fact on the device, the same
 * reasoning that keeps the state projection here. The operator discovers the
 * need by looking at the bar, so the control lives next to the assignment, and
 * flipping it queues an identify so they can confirm the fix without walking
 * back and forth.
 */
export async function setDeviceSegmentOrder(deviceId: string, reversed: boolean) {
  const owned = await ownedDevice(deviceId)
  if ('error' in owned) return { status: 'error' as const, errors: [owned.error] }

  await prisma.device.update({
    where: { id: deviceId },
    data: { reverseSegments: reversed, pendingCmd: 'identify', pendingCmdAt: new Date() },
  })
  revalidatePath('/devices')
  return { status: 'ok' as const }
}

/**
 * The device's own power policy (track 025), overriding the platform default an
 * admin sets in `/preferences`.
 *
 * A PAIR, always written together: the mode decides which cadences physically
 * exist, so an interval only means anything inside one. Half an override would
 * have to be resolved by clamping — a device running a number nobody chose — so
 * the pair is validated by the shared `validateDevicePolicy` (the same function
 * the admin writer calls, so a refusal reads the same on both surfaces) and the
 * database refuses a half-set row besides (`device_power_policy_pair_chk`).
 *
 * NOTE it does NOT queue an `identify`, unlike every other action here. The
 * flash exists so someone at the parasol can confirm which box they addressed —
 * a physical fact. A cadence is not visible on the bar, this is a desk
 * operation, and on a deep-sleep device the command would usually expire
 * unfired anyway (the TTL is shorter than the poll). The change reaches the
 * device on its next poll regardless: both values sit inside the state
 * response's hashed object, so it busts the ETag on its own.
 */
export async function setDevicePowerPolicy(
  deviceId: string,
  mode: string,
  intervalSec: number | string,
) {
  const owned = await ownedDevice(deviceId)
  if ('error' in owned) return { status: 'error' as const, errors: [owned.error] }

  const validated = validateDevicePolicy(mode, intervalSec)
  if (!validated.ok) return { status: 'error' as const, errors: [validated.error] }

  await prisma.device.update({
    where: { id: deviceId },
    data: { powerMode: validated.mode, pollIntervalSec: validated.pollAfterSec },
  })
  revalidatePath('/devices')
  return { status: 'ok' as const }
}

/** Drop the override, so the device follows the platform default again. */
export async function clearDevicePowerPolicy(deviceId: string) {
  const owned = await ownedDevice(deviceId)
  if ('error' in owned) return { status: 'error' as const, errors: [owned.error] }

  await prisma.device.update({
    where: { id: deviceId },
    // Both columns, never one: a half-cleared row is half a policy.
    data: { powerMode: null, pollIntervalSec: null },
  })
  revalidatePath('/devices')
  return { status: 'ok' as const }
}
