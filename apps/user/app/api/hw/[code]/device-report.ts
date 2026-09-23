/**
 * HW API — the device's self-report, carried on every poll (track 019, wire v2).
 *
 * Tracking used to be a separate `POST /telemetry` the firmware was meant to fire
 * every few hours. It never did — the fleet list went blind ("silent, 25d ago")
 * on a device that was polling every minute. The lesson is that a second request
 * on a battery-constrained device is a request that gets dropped, so the report
 * now rides the poll it was always going to accompany, as ONE request header:
 *
 *   x-sunbnb-telemetry: fw=d334d38;batt=3174;rssi=-36;up=412;polls=27;temp=24;
 *                       cur=25100;chg=-1852;rst=poweron;mode=light_sleep;
 *                       heap=241088;fails=0;loc=1-1-1
 *
 * `key=value` pairs, `;`-separated, every key optional, unknown keys ignored — a
 * firmware that gains a field never breaks an older server, and one that drops a
 * field never wipes the last known value (the writer OMITS rather than nulls).
 * A header rather than a body because the poll is a GET, and rather than the
 * query string so the URL — potted into the device — stays exactly what it is.
 *
 * The field set grew on 2026-09-22 (`../sunbnb-hw/docs/telemetry-fields.md`,
 * firmware `907f228`) from five keys to eighteen. Eleven earn a last-value
 * column; the diagnostic counters (`polls` `slp` `wake` `wjoin` `drops` `retry`)
 * are still accepted and dropped — they are useful in a log line and do not earn
 * a schema. Three of the new ones change what an operator can see at all:
 * `chg` is the solar energy balance and the real state-of-charge signal (a
 * LiFePO4 cell rests 3.2–3.3 V on a flat curve, so `batt` alone barely ranks a
 * fleet), `rst=brownout` is the only attribution a field reboot ever gets, and
 * `mode` is the APPLIED power mode — the half of track 025's declarative loop
 * the server could not see, so the fleet UI could show an assigned-vs-applied
 * gap for location but not for power.
 *
 * Both directions are now DECLARATIVE: the device says what it is running on
 * every poll, the server says what it should run on every 200. The fleet UI's
 * assigned-vs-applied gap falls out of that with no acknowledgement protocol,
 * which is simpler than the "reported only once the POST returned 2xx" rule the
 * firmware used to carry.
 *
 * Every recorded report is ALSO appended to `device_telemetry` in the same
 * transaction (track 019 P6). The Device columns answer "how is this unit now",
 * which is what the fleet list needs; the series answers the questions that are
 * trends — energy balance per day, what a power mode really costs, a cell
 * ageing — and a trend cannot be backfilled, so it is collected before anything
 * reads it. Retention is the `device-telemetry-retention-days` preference,
 * swept daily; `@repo/data/device-telemetry` carries the arithmetic.
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

/**
 * What a device reports about itself. Every field optional, and that is the
 * load-bearing part of the contract: **an absent field means "I don't know" and
 * must leave the stored value alone — it does not mean zero.** The firmware
 * omits rather than sending 0 precisely so the writer can omit rather than null.
 *
 * `currentUa` and `chargeUah` sharpen the same rule from the other side: both
 * can legitimately BE zero (an idle cell, an exactly balanced day), so the
 * firmware carries validity flags for them instead of using 0 as a sentinel.
 * `cur=0` is a measurement, and `undefined` is the only gap.
 */
export interface DeviceReport {
  fw?: string
  battMv?: number
  rssiDbm?: number
  upSec?: number
  tempC?: number
  /** Signed µA: positive = discharging, negative = charging. */
  currentUa?: number
  /** Signed µAh since the device's counter was zeroed. A reboot does NOT reset it. */
  chargeUah?: number
  resetReason?: string
  /** The mode actually in force, which is not necessarily the one we assigned. */
  reportedPowerMode?: string
  heapFreeBytes?: number
  pollFails?: number
  /** INA228 die temperature — the CELL's, where `tempC` is the ESP32's. */
  cellTempC?: number
  /** The face the disc is actually showing, in the server's state vocabulary. */
  reportedFace?: string
  /** The poll interval in force, which the connectivity ladder can move on its own. */
  reportedIntervalSec?: number
  wifiChannel?: number
  /** Lowest cell voltage in the last poll window — read as `battMv - vminMv`. */
  vminMv?: number
  /** Highest cell current in that window, signed as `currentUa` is. */
  imaxUa?: number
  /** Charge-complete firings: a STEP means `chargeUah`'s zero point moved. */
  fullCount?: number
  reportedLocation?: string
}

/** The last-values columns the writer compares against and updates. */
export interface DeviceLastValues {
  fw: string | null
  battMv: number | null
  rssiDbm: number | null
  upSec: number | null
  tempC: number | null
  currentUa: number | null
  chargeUah: number | null
  resetReason: string | null
  reportedPowerMode: string | null
  heapFreeBytes: number | null
  pollFails: number | null
  cellTempC: number | null
  reportedFace: string | null
  reportedIntervalSec: number | null
  wifiChannel: number | null
  vminMv: number | null
  imaxUa: number | null
  fullCount: number | null
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
/** On-die chip temperature wanders with the sun and the duty cycle; 5 °C is a trend. */
export const TEMP_DELTA_C = 5
/**
 * 5 mAh of net charge. Sized against the cell, not the sample: a 1500 mAh cell
 * running deep sleep spends ~11 mAh a DAY, so this is a couple of hours of the
 * energy story — while continuous (~20 mA) crosses it every ~15 min, which is
 * still cheaper than the `lastSeenAt` floor would have been anyway.
 */
export const CHG_DELTA_UAH = 5000
/** 8 KiB of min-free heap. A leak shows as a decline across days, not a poll. */
export const HEAP_DELTA_BYTES = 8192
/** How stale `lastSeenAt` may get before a poll refreshes it regardless. */
export const LAST_SEEN_FLOOR_MS = 5 * 60 * 1000

const FW_MAX = 64
const LOC_MAX = 64
/**
 * Enum-word fields (`rst`, `mode`) are length- and shape-checked, never checked
 * against a list of known words. A firmware that gains a reset cause must be
 * able to report it: dropping an unknown value would leave the PREVIOUS reason
 * standing, and a stale `poweron` next to a fresh crash is worse than a word the
 * UI has to render verbatim.
 */
const WORD_MAX = 32
/**
 * Case-SENSITIVE on purpose, and deliberately not lowercase-only: the firmware's
 * enum words come from two different vocabularies. `rst`/`mode` are lower snake
 * (`brownout`, `light_sleep`) while `disc` carries the SERVER's own seat-state
 * spelling back to it in caps (`FREE`, `STALE`) — `seat_state_name()` returns
 * exactly the tokens our projection emits. Folding the case here would break the
 * comparison the field exists for, since `disc` is only ever read against the
 * state we served.
 */
const WORD_RE = /^[A-Za-z0-9_]+$/
/**
 * The firmware's own "I don't know" sentinel for an enum word. `power_mode_name`
 * returns `"?"` for a mode outside its table, so `mode=?` is a real thing the
 * device can put on the wire — and it means unknown, not a new mode. Dropped
 * rather than stored, which is the ONE case where leaving the last known value
 * alone is right: the device is not telling us it changed mode, it is telling us
 * it cannot name the one it is in.
 */
const WORD_UNKNOWN = '?'

/**
 * Sentinel floors, mirroring the guards in the firmware's own formatter
 * (`../sunbnb-hw` `api.c` `api_format_report`): it omits `batt` unless `> 0`,
 * `rssi` unless `!= 0`, `temp` unless `> -999`, `heap` unless `> 0` and `fails`
 * unless `>= 0`. We re-check rather than trust, for two reasons.
 *
 * First, the LEGACY POST body does not apply those guards at all — it sends
 * `{"battMv":0,"rssiDbm":0}` unconditionally (`api_post_telemetry`), so the one
 * path that is supposed to mean the same thing as the header means something
 * different. That is not hypothetical: it is how `battMv: 0` reached the fleet
 * list and forced the "a zero reading is the ABSENCE of a measurement" branch in
 * `apps/partner/app/devices/device-health.ts`. Applying the rule HERE means both
 * paths agree and the workaround downstream has nothing left to catch.
 *
 * Second, a 0 mV cell is the difference between "the sensor did not answer" and
 * "walk out to that parasol". `up`, `cur` and `chg` are deliberately absent from
 * this table: the firmware always sends `up`, and zero is a legitimate reading
 * for the two energy fields (an idle cell, an exactly balanced day), which is
 * why they carry validity FLAGS on the device rather than using 0 as a sentinel.
 */
const SENTINEL_FLOOR: Partial<Record<IntField, number>> = {
  battMv: 1,
  tempC: -998,
  heapFreeBytes: 1,
  pollFails: 0,
  cellTempC: -998,
  reportedIntervalSec: 1,
  wifiChannel: 1,
  vminMv: 1,
  fullCount: 0,
  // `imaxUa` has no floor on purpose: like `cur` and `chg` it carries a validity
  // FLAG on the device, so 0 is a reading rather than a gap.
}

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
      case 'temp':
        assignInt(report, 'tempC', raw)
        break
      case 'cur':
        assignInt(report, 'currentUa', raw)
        break
      case 'chg':
        assignInt(report, 'chargeUah', raw)
        break
      case 'heap':
        assignInt(report, 'heapFreeBytes', raw)
        break
      case 'fails':
        assignInt(report, 'pollFails', raw)
        break
      case 'vmin':
        assignInt(report, 'vminMv', raw)
        break
      case 'imax':
        assignInt(report, 'imaxUa', raw)
        break
      case 'full':
        assignInt(report, 'fullCount', raw)
        break
      case 'ctemp':
        assignInt(report, 'cellTempC', raw)
        break
      case 'iv':
        assignInt(report, 'reportedIntervalSec', raw)
        break
      case 'chan':
        assignInt(report, 'wifiChannel', raw)
        break
      case 'rst':
        assignWord(report, 'resetReason', raw)
        break
      case 'disc':
        assignWord(report, 'reportedFace', raw)
        break
      case 'mode':
        assignWord(report, 'reportedPowerMode', raw)
        break
      // `polls` `slp` `wake` `wjoin` `drops` `retry`, and anything newer:
      // accepted and dropped. They are diagnostic detail that reads well in a
      // log line and does not earn a column.
      default:
        break
    }
  }
  return report
}

type IntField =
  | 'battMv' | 'rssiDbm' | 'upSec' | 'tempC' | 'currentUa' | 'chargeUah' | 'heapFreeBytes'
  | 'pollFails' | 'cellTempC' | 'reportedIntervalSec' | 'wifiChannel'
  | 'vminMv' | 'imaxUa' | 'fullCount'
type WordField = 'resetReason' | 'reportedPowerMode' | 'reportedFace'

function assignInt(report: DeviceReport, key: IntField, raw: string) {
  if (!/^-?\d+$/.test(raw)) return
  const n = Number(raw)
  if (Number.isSafeInteger(n)) assignNumber(report, key, n)
}

/** The one place a numeric field is accepted, so header and body cannot drift. */
export function assignNumber(report: DeviceReport, key: IntField, value: number) {
  const n = Math.trunc(value)
  // `rssi` has no floor, it has a HOLE: 0 dBm is the firmware's "no link"
  // sentinel, while -36 and -80 are both real.
  if (key === 'rssiDbm' && n === 0) return
  const floor = SENTINEL_FLOOR[key]
  if (floor !== undefined && n < floor) return
  report[key] = n
}

function assignWord(report: DeviceReport, key: WordField, raw: string) {
  if (raw === WORD_UNKNOWN) return
  if (raw.length <= WORD_MAX && WORD_RE.test(raw)) report[key] = raw
}

/**
 * The same shape, read from the legacy JSON body of `POST /telemetry`. The body
 * names the COLUMNS (`battMv`) where the header names the wire keys (`batt`);
 * that has been true since the POST predated the header and is kept, because a
 * boot dump is written by hand against this file, not by the poll loop.
 */
export function reportFromBody(payload: Record<string, unknown>): DeviceReport {
  const report: DeviceReport = {}
  const fw = payload.fw
  if (typeof fw === 'string' && fw.length > 0 && fw.length <= FW_MAX) report.fw = fw
  const loc = payload.loc
  if (typeof loc === 'string' && loc.length > 0 && loc.length <= LOC_MAX) report.reportedLocation = loc
  for (const key of ['resetReason', 'reportedPowerMode', 'reportedFace'] as const) {
    const v = payload[key]
    if (typeof v === 'string' && v !== WORD_UNKNOWN && v.length <= WORD_MAX && WORD_RE.test(v)) report[key] = v
  }
  for (const key of [
    'battMv', 'rssiDbm', 'upSec', 'tempC', 'currentUa', 'chargeUah', 'heapFreeBytes',
    'pollFails', 'cellTempC', 'reportedIntervalSec', 'wifiChannel',
    'vminMv', 'imaxUa', 'fullCount',
  ] as const) {
    const v = payload[key]
    // Same sentinel rules as the header — the body is the path that actually
    // sends `battMv: 0`, so this is where the rule earns its keep.
    if (typeof v === 'number' && Number.isFinite(v)) assignNumber(report, key, v)
  }
  return report
}

/**
 * Does this report earn a row write? True when a value an operator reads has
 * moved past its threshold, when uptime DROPPED (the cheapest reboot signal
 * there is — a rising counter is expected and never a reason to write), or when
 * the row has not been touched for the floor. `null` last values always count
 * as changed: a first report is worth recording.
 *
 * Adding eight fields to the report did NOT mean adding eight triggers. The
 * throttle is what keeps a 1 s continuous cadence affordable, so a field earns a
 * trigger only if a person would act on the change sooner than the 5 min floor:
 *
 *   - `rst` and `mode` — discrete and rare. A `brownout` or a device that
 *     dropped out of its assigned mode should surface on the poll it appears on.
 *   - `fails` — on the ZERO↔NON-ZERO edge only. A device being declined every
 *     poll would otherwise write every poll, which is exactly the traffic
 *     shape the throttle exists for; "is it being rejected" is the state an
 *     operator acts on, not the count.
 *   - `disc`, `iv`, `chan` — discrete and rare, so change-triggered like `mode`.
 *     `disc` is the APPLIED SEAT STATE, the third of these loops after location
 *     and power mode, and the only way to catch a device that polls happily and
 *     renders the wrong face; it moves a few times a day per seat, not per poll.
 *     `iv` completes the power pair, and moves on its own during the ladder.
 *   - `full` — ANY change, including a decrease. It is the anchor counter for
 *     `chg`: a step means the charge counter was ZEROED, so a `chg` delta taken
 *     across it is not a discharge. Rare (a charge completion), and load-bearing
 *     for the one field the whole solar path exists to read.
 *   - `temp`, `ctemp`, `chg`, `vmin` — thresholded like battery and RSSI.
 *     `vmin` earns its trigger rather than riding along, because the extreme IS
 *     the alarm — `batt − vmin` is the sag under load, and a deepening sag is
 *     the earliest warning that bursts are about to brown the chip out.
 *   - `cur`, `imax` — NO trigger. It swings between ~3.5 mA asleep and ~20 mA awake
 *     within one poll, so any threshold degenerates into a write per poll. It
 *     rides along on writes earned by something else, which is all a last value
 *     of an instantaneous current is worth; `chg` integrates it and is the
 *     number that actually answers "are the panels winning". `imax` is the same
 *     measurement's window peak: trendable in aggregate but dominated by whether
 *     that window held a Wi-Fi join, and explicitly "not a headline number".
 *
 * **A window value in a throttled store is a SAMPLE, and callers must know it.**
 * The device resets its extremes every poll, so each report's `vmin`/`imax`
 * covers one poll interval — but we write on a throttled subset, so what lands
 * in the row is *the window ending at the last write*, not *the worst since the
 * last write*. That is honest for the trend these fields are for (the sampling
 * point is fixed in the poll cycle, so two reports are comparable), and it is
 * why `vmin` triggers: without it a 60 s cadence under a 5-minute floor would
 * sample one window in five and systematically miss the bad ones. It is also the
 * strongest argument for the deferred time series — a series would keep every
 * window instead of a sample of them.
 *
 * **The connectivity ladder is not a fault, and this is where that starts.** A
 * device that cannot reach us degrades ITSELF — `light_sleep`/15 s while it
 * retries, `deep_sleep`/3600 s once it gives up (`../sunbnb-hw` `1b6c00b`). It
 * cannot report while that is happening, so the whole episode arrives on the
 * ONE poll that recovers, carrying `fails` ≫ 0 beside a `mode`/`iv` that
 * disagree with what we assigned. All three trigger, so the recovery is recorded
 * — and the next poll, after the device has taken the mode from our 200 and
 * zeroed its counter, triggers again and records the return to normal. Two rows
 * for an outage of any length is the right price. What must NOT happen is a
 * consumer reading that first row as disobedience: `fails > 0` with `iv = 3600`
 * is a unit that backed off deliberately and is costing almost nothing.
 */
export function reportIsDue(last: DeviceLastValues, report: DeviceReport, now: Date): boolean {
  if (!last.lastSeenAt || now.getTime() - last.lastSeenAt.getTime() >= LAST_SEEN_FLOOR_MS) return true
  if (report.fw !== undefined && report.fw !== last.fw) return true
  if (report.reportedLocation !== undefined && report.reportedLocation !== last.reportedLocation) return true
  if (report.resetReason !== undefined && report.resetReason !== last.resetReason) return true
  if (report.reportedPowerMode !== undefined && report.reportedPowerMode !== last.reportedPowerMode) return true
  if (report.reportedFace !== undefined && report.reportedFace !== last.reportedFace) return true
  if (report.reportedIntervalSec !== undefined && report.reportedIntervalSec !== last.reportedIntervalSec) return true
  if (report.wifiChannel !== undefined && report.wifiChannel !== last.wifiChannel) return true
  // Any change, a DECREASE included: `full` lives in RTC memory and drops to 0
  // on a power cut, which also clears the INA228's accumulator — so a decrease
  // invalidates a `chargeUah` baseline exactly as a step does.
  if (report.fullCount !== undefined && report.fullCount !== last.fullCount) return true
  if (report.pollFails !== undefined && report.pollFails > 0 !== (last.pollFails != null && last.pollFails > 0)) return true
  if (movedPast(report.battMv, last.battMv, BATT_DELTA_MV)) return true
  if (movedPast(report.rssiDbm, last.rssiDbm, RSSI_DELTA_DB)) return true
  if (movedPast(report.tempC, last.tempC, TEMP_DELTA_C)) return true
  if (movedPast(report.cellTempC, last.cellTempC, TEMP_DELTA_C)) return true
  // Same band as `batt`: it is the same physical quantity, read at the window's
  // worst instead of at rest.
  if (movedPast(report.vminMv, last.vminMv, BATT_DELTA_MV)) return true
  if (movedPast(report.chargeUah, last.chargeUah, CHG_DELTA_UAH)) return true
  if (movedPast(report.heapFreeBytes, last.heapFreeBytes, HEAP_DELTA_BYTES)) return true
  if (report.upSec !== undefined && last.upSec != null && report.upSec < last.upSec) return true
  return false
}

/** Reported and moved at least `delta` from the stored value — or never stored. */
function movedPast(reported: number | undefined, stored: number | null, delta: number): boolean {
  if (reported === undefined) return false
  return stored == null || Math.abs(reported - stored) >= delta
}

/**
 * The measurements alone, keyed by column — the ONE list of telemetry fields in
 * this module, shared by the last-value write and the history append so the two
 * can never end up carrying different sets.
 *
 * Every field is spread conditionally — OMITTED when absent, never nulled —
 * which is the server half of "absent means I don't know". A reported `0` IS
 * written, because for `cur`, `chg` and `fails` zero is an answer.
 */
function measurementData(report: DeviceReport) {
  return {
    ...(report.fw !== undefined ? { fw: report.fw } : {}),
    ...(report.reportedLocation !== undefined ? { reportedLocation: report.reportedLocation } : {}),
    ...(report.battMv !== undefined ? { battMv: report.battMv } : {}),
    ...(report.rssiDbm !== undefined ? { rssiDbm: report.rssiDbm } : {}),
    ...(report.upSec !== undefined ? { upSec: report.upSec } : {}),
    ...(report.tempC !== undefined ? { tempC: report.tempC } : {}),
    ...(report.currentUa !== undefined ? { currentUa: report.currentUa } : {}),
    ...(report.chargeUah !== undefined ? { chargeUah: report.chargeUah } : {}),
    ...(report.resetReason !== undefined ? { resetReason: report.resetReason } : {}),
    ...(report.reportedPowerMode !== undefined ? { reportedPowerMode: report.reportedPowerMode } : {}),
    ...(report.heapFreeBytes !== undefined ? { heapFreeBytes: report.heapFreeBytes } : {}),
    ...(report.pollFails !== undefined ? { pollFails: report.pollFails } : {}),
    ...(report.cellTempC !== undefined ? { cellTempC: report.cellTempC } : {}),
    ...(report.reportedFace !== undefined ? { reportedFace: report.reportedFace } : {}),
    ...(report.reportedIntervalSec !== undefined ? { reportedIntervalSec: report.reportedIntervalSec } : {}),
    ...(report.wifiChannel !== undefined ? { wifiChannel: report.wifiChannel } : {}),
    ...(report.vminMv !== undefined ? { vminMv: report.vminMv } : {}),
    ...(report.imaxUa !== undefined ? { imaxUa: report.imaxUa } : {}),
    ...(report.fullCount !== undefined ? { fullCount: report.fullCount } : {}),
  }
}

/** The `data` for the last-value row write: the measurements, plus the stamp. */
export function reportData(report: DeviceReport, now: Date) {
  return { lastSeenAt: now, ...measurementData(report) }
}

/**
 * The HISTORY row for this report — the same measurements without the
 * last-value bookkeeping. `lastSeenAt` is the Device row's "when did we last
 * hear anything from this unit"; the series carries `recordedAt`, the same
 * instant said about one READING rather than about the unit.
 *
 * Absent stays absent here for a stronger reason than on the Device row: a null
 * in the series means "not reported in this reading", and a series that invented
 * zeros would make every average and every delta taken across it wrong.
 */
export function telemetryRowData(report: DeviceReport, now: Date) {
  return { recordedAt: now, ...measurementData(report) }
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
    // ONE transaction, so the last-value row and the series cannot disagree
    // about what this device reported — and one round trip, because this sits
    // on the poll path. The series row is appended for every recorded report,
    // which is what makes the history exactly the sequence of readings we kept
    // (`@repo/data/device-telemetry` has the volume arithmetic).
    //
    // `connect` by `code` resolves the device without a lookup of our own. For
    // an unknown code the connect fails and the whole transaction rolls back —
    // which matches the old behaviour exactly, since `updateMany` on a code
    // with no row wrote nothing either.
    await prisma.$transaction([
      prisma.device.updateMany({ where: { code }, data: reportData(report, now) }),
      prisma.deviceTelemetry.create({
        data: { device: { connect: { code } }, ...telemetryRowData(report, now) },
      }),
    ])
    return true
  } catch {
    return false
  }
}
