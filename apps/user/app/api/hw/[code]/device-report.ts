/**
 * HW API — the device's self-report, carried on every poll (track 019, wire v2).
 *
 * Tracking used to be a separate `POST /telemetry` the firmware was meant to fire
 * every few hours. It never did — the fleet list went blind ("silent, 25d ago")
 * on a device that was polling every minute. The lesson is that a second request
 * on a battery-constrained device is a request that gets dropped, so the report
 * now rides the poll it was always going to accompany, as ONE request header:
 *
 *   x-sunbnb-telemetry: fw=0.1.0;rssi=-61;up=8812;polls=42;loc=3-1-2;batt=3312
 *
 * `key=value` pairs, `;`-separated, every key optional, unknown keys ignored — a
 * firmware that gains a field never breaks an older server, and one that drops a
 * field never wipes the last known value (the writer OMITS rather than nulls).
 * A header rather than a body because the poll is a GET, and rather than the
 * query string so the URL — potted into the device — stays exactly what it is.
 *
 * Both directions are now DECLARATIVE: the device says what it is running on
 * every poll, the server says what it should run on every 200. The fleet UI's
 * assigned-vs-applied gap falls out of that with no acknowledgement protocol,
 * which is simpler than the "reported only once the POST returned 2xx" rule the
 * firmware used to carry.
 *
 * The write is THROTTLED, and that is the one thing that makes this affordable:
 * at the continuous cadence track 025 introduces (1–15 s) a row write per poll
 * would multiply Q3's invocation arithmetic by the poll rate. The screen step
 * already reads the Device row, so the writer compares against it and touches
 * the DB only when something an operator would notice has changed, or when
 * `lastSeenAt` has aged past a floor — about what a periodic POST would have
 * cost anyway.
 */

import prisma from '@repo/data/PrismaCient'
import { applyDeviceClaim } from '@repo/data/device-claim'

export const TELEMETRY_HEADER = 'x-sunbnb-telemetry'

/** What a device reports about itself. Every field optional. */
export interface DeviceReport {
  fw?: string
  battMv?: number
  rssiDbm?: number
  upSec?: number
  reportedLocation?: string
}

/** The last-values columns the writer compares against and updates. */
export interface DeviceLastValues {
  fw: string | null
  battMv: number | null
  rssiDbm: number | null
  upSec: number | null
  reportedLocation: string | null
  lastSeenAt: Date | null
}

/**
 * Write thresholds. Below these a change is noise an operator cannot act on:
 * a LiFePO4 cell sits within a few tens of mV across most of its capacity, and
 * RSSI wanders several dB between beacons on a still parasol.
 */
export const BATT_DELTA_MV = 50
export const RSSI_DELTA_DB = 6
/** How stale `lastSeenAt` may get before a poll refreshes it regardless. */
export const LAST_SEEN_FLOOR_MS = 5 * 60 * 1000

const FW_MAX = 64
const LOC_MAX = 64

/**
 * Parse the report header. Tolerant by design: a malformed pair is skipped, not
 * fatal — a report must never cost the device its poll. Returns an empty report
 * for a missing header.
 */
export function parseTelemetryHeader(value: string | null): DeviceReport {
  const report: DeviceReport = {}
  if (!value) return report
  for (const pair of value.split(';')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const key = pair.slice(0, eq).trim()
    const raw = pair.slice(eq + 1).trim()
    if (!raw) continue
    switch (key) {
      case 'fw':
        if (raw.length <= FW_MAX) report.fw = raw
        break
      case 'loc':
        if (raw.length <= LOC_MAX) report.reportedLocation = raw
        break
      case 'batt':
        assignInt(report, 'battMv', raw)
        break
      case 'rssi':
        assignInt(report, 'rssiDbm', raw)
        break
      case 'up':
        assignInt(report, 'upSec', raw)
        break
      // `polls` and anything newer: accepted and dropped, no column earns it yet.
      default:
        break
    }
  }
  return report
}

function assignInt(report: DeviceReport, key: 'battMv' | 'rssiDbm' | 'upSec', raw: string) {
  if (!/^-?\d+$/.test(raw)) return
  const n = Number(raw)
  if (Number.isSafeInteger(n)) report[key] = n
}

/** The same shape, read from the legacy JSON body of `POST /telemetry`. */
export function reportFromBody(payload: Record<string, unknown>): DeviceReport {
  const report: DeviceReport = {}
  const fw = payload.fw
  if (typeof fw === 'string' && fw.length > 0 && fw.length <= FW_MAX) report.fw = fw
  const loc = payload.loc
  if (typeof loc === 'string' && loc.length > 0 && loc.length <= LOC_MAX) report.reportedLocation = loc
  for (const key of ['battMv', 'rssiDbm', 'upSec'] as const) {
    const v = payload[key]
    if (typeof v === 'number' && Number.isFinite(v)) report[key] = Math.trunc(v)
  }
  return report
}

/**
 * Does this report earn a row write? True when a value an operator reads has
 * moved past its threshold, when uptime DROPPED (the cheapest reboot signal
 * there is — a rising counter is expected and never a reason to write), or when
 * the row has not been touched for the floor. `null` last values always count
 * as changed: a first report is worth recording.
 */
export function reportIsDue(last: DeviceLastValues, report: DeviceReport, now: Date): boolean {
  if (!last.lastSeenAt || now.getTime() - last.lastSeenAt.getTime() >= LAST_SEEN_FLOOR_MS) return true
  if (report.fw !== undefined && report.fw !== last.fw) return true
  if (report.reportedLocation !== undefined && report.reportedLocation !== last.reportedLocation) return true
  if (report.battMv !== undefined && (last.battMv == null || Math.abs(report.battMv - last.battMv) >= BATT_DELTA_MV)) return true
  if (report.rssiDbm !== undefined && (last.rssiDbm == null || Math.abs(report.rssiDbm - last.rssiDbm) >= RSSI_DELTA_DB)) return true
  if (report.upSec !== undefined && last.upSec != null && report.upSec < last.upSec) return true
  return false
}

/** The `data` for the row write: everything reported, plus the timestamp. */
export function reportData(report: DeviceReport, now: Date) {
  return {
    lastSeenAt: now,
    ...(report.fw !== undefined ? { fw: report.fw } : {}),
    ...(report.reportedLocation !== undefined ? { reportedLocation: report.reportedLocation } : {}),
    ...(report.battMv !== undefined ? { battMv: report.battMv } : {}),
    ...(report.rssiDbm !== undefined ? { rssiDbm: report.rssiDbm } : {}),
    ...(report.upSec !== undefined ? { upSec: report.upSec } : {}),
  }
}

export interface RecordOptions {
  /** The `x-sunbnb-partner` header, applied as a CLAIM (see `applyDeviceClaim`). */
  partnerClaim: string | null
  /**
   * The row as already read by the caller, or null when no row carries the code.
   * Null is the self-registration case: the claim creates the row and the
   * report is written onto it.
   */
  last: DeviceLastValues | null
  /** Skip the throttle — the legacy POST is rare and explicit, so it always writes. */
  force?: boolean
}

/**
 * Record a device's report. BEST-EFFORT AND SWALLOWING: nothing here may cost
 * the device its poll, so a DB failure is logged nowhere and returns false.
 *
 * The partner claim runs on the same throttle as the write — it costs a
 * partner lookup, which is too much per poll and plenty once per floor.
 */
export async function recordDeviceReport(
  code: string,
  report: DeviceReport,
  options: RecordOptions,
  now = new Date(),
): Promise<boolean> {
  try {
    const due = options.force || !options.last || reportIsDue(options.last, report, now)
    if (!due) return false
    await applyDeviceClaim(code, options.partnerClaim)
    await prisma.device.updateMany({ where: { code }, data: reportData(report, now) })
    return true
  } catch {
    return false
  }
}
