/**
 * Fleet health, derived (track 021 P5 / track 019).
 *
 * Pure: the operator-facing state of a device is a function of what it has told
 * us and what we have told it. Keeping it out of the query makes every case
 * testable without a database, and keeps the UI from inventing a second opinion.
 */

/** A device is "silent" once it has not been heard from for this long. */
export const SILENT_AFTER_MS = 24 * 60 * 60 * 1000

export type DeviceHealth =
  /** Provisioned and reporting, but no location assigned yet — it lights nothing. */
  | 'unassigned'
  /** Assigned, but the device has not confirmed it: asleep, out of range, or dead. */
  | 'pending'
  /** Assigned and confirmed running that location. */
  | 'ok'
  /** Was heard from once, but not lately. */
  | 'silent'
  /** Provisioned but never seen — flashed and not installed, or never joined Wi-Fi. */
  | 'never-seen'

export interface DeviceHealthInput {
  assignedLocation: string | null
  reportedLocation: string | null
  lastSeenAt: Date | null
}

/**
 * Order matters and encodes what an operator should look at first: silence
 * outranks assignment state, because a device nobody can hear is a fault
 * whatever its configuration says, and a "pending" badge on a dead unit would
 * suggest waiting rather than walking out to it.
 */
export function deviceHealth(device: DeviceHealthInput, now: Date = new Date()): DeviceHealth {
  if (!device.lastSeenAt) return 'never-seen'
  if (now.getTime() - device.lastSeenAt.getTime() > SILENT_AFTER_MS) return 'silent'
  if (!device.assignedLocation) return 'unassigned'
  return device.assignedLocation === device.reportedLocation ? 'ok' : 'pending'
}

/** `1-10-3` — parcel, row, unit. Null when any part is missing. */
export function formatLocation(parts: {
  assignedParcel: number | null
  assignedRow: number | null
  assignedSeq: number | null
}): string | null {
  const { assignedParcel, assignedRow, assignedSeq } = parts
  if (assignedParcel == null || assignedRow == null || assignedSeq == null) return null
  return `${assignedParcel}-${assignedRow}-${assignedSeq}`
}

/** Battery guidance: cell voltage is the one number that predicts a field failure. */
export function batteryLevel(battMv: number | null): 'ok' | 'low' | 'critical' | 'unknown' {
  if (battMv == null) return 'unknown'
  if (battMv < 3300) return 'critical'
  if (battMv < 3600) return 'low'
  return 'ok'
}
