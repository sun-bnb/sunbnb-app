/**
 * Tests for the device self-report that rides the state poll (track 019, wire v2).
 *
 * Two things matter more than the happy path:
 *
 *   - **The parser is tolerant.** A malformed pair, an unknown key or a missing
 *     header must never cost the device its poll — the report is a passenger.
 *   - **The write is throttled.** At track 025's continuous cadence (1–15 s) a row
 *     write per poll would multiply the invocation bill by the poll rate. Only
 *     a change an operator can read, a reboot, or an aged `lastSeenAt` earns one.
 */

import { describe, it, expect } from 'vitest'

import {
  parseTelemetryHeader,
  reportFromBody,
  reportIsDue,
  reportData,
  BATT_DELTA_MV,
  RSSI_DELTA_DB,
  LAST_SEEN_FLOOR_MS,
  type DeviceLastValues,
} from './device-report'

const NOW = new Date('2026-09-12T10:00:00Z')

function last(overrides: Partial<DeviceLastValues> = {}): DeviceLastValues {
  return {
    fw: '0.1.0',
    battMv: 3300,
    rssiDbm: -60,
    upSec: 1000,
    reportedLocation: '1-1-1',
    // Fresh: one second ago, so nothing is due unless a value moved.
    lastSeenAt: new Date(NOW.getTime() - 1000),
    ...overrides,
  }
}

describe('parseTelemetryHeader', () => {
  it('reads every documented key', () => {
    expect(parseTelemetryHeader('fw=0.1.0;rssi=-61;up=8812;polls=42;loc=3-1-2;batt=3312')).toEqual({
      fw: '0.1.0',
      rssiDbm: -61,
      upSec: 8812,
      reportedLocation: '3-1-2',
      battMv: 3312,
    })
  })

  it('returns an empty report for a missing header', () => {
    expect(parseTelemetryHeader(null)).toEqual({})
    expect(parseTelemetryHeader('')).toEqual({})
  })

  it('skips a malformed pair without dropping the rest', () => {
    expect(parseTelemetryHeader('fw=0.1.0;garbage;=5;rssi=abc;up=12')).toEqual({ fw: '0.1.0', upSec: 12 })
  })

  it('ignores an unknown key — a newer firmware never breaks an older server', () => {
    expect(parseTelemetryHeader('fw=0.1.0;temp=31')).toEqual({ fw: '0.1.0' })
  })

  it('tolerates whitespace around pairs', () => {
    expect(parseTelemetryHeader(' fw=0.1.0 ; rssi = -61 ')).toEqual({ fw: '0.1.0', rssiDbm: -61 })
  })

  it('omits an empty value rather than recording an empty string', () => {
    // "" would be indistinguishable from "I do not know", and the fleet UI
    // reads the assigned-vs-reported gap.
    expect(parseTelemetryHeader('loc=;fw=0.1.0')).toEqual({ fw: '0.1.0' })
  })

  it('caps string lengths at the column width', () => {
    expect(parseTelemetryHeader(`fw=${'x'.repeat(65)}`)).toEqual({})
    expect(parseTelemetryHeader(`fw=${'x'.repeat(64)}`)).toEqual({ fw: 'x'.repeat(64) })
  })
})

describe('reportFromBody', () => {
  it('maps the legacy JSON body onto the same shape', () => {
    expect(reportFromBody({ fw: '1.4.2', battMv: 3980.7, rssiDbm: -67, upSec: 91234, loc: '1-1-1', polls: 9 })).toEqual({
      fw: '1.4.2',
      battMv: 3980,
      rssiDbm: -67,
      upSec: 91234,
      reportedLocation: '1-1-1',
    })
  })

  it('drops wrongly typed fields', () => {
    expect(reportFromBody({ fw: 5, battMv: '3980', rssiDbm: NaN })).toEqual({})
  })
})

describe('reportIsDue — the throttle', () => {
  it('is NOT due when nothing moved and the row is fresh', () => {
    expect(reportIsDue(last(), { fw: '0.1.0', battMv: 3310, rssiDbm: -62, upSec: 1001, reportedLocation: '1-1-1' }, NOW)).toBe(false)
  })

  it('is NOT due for an empty report on a fresh row', () => {
    expect(reportIsDue(last(), {}, NOW)).toBe(false)
  })

  it('is due when lastSeenAt has aged past the floor', () => {
    expect(reportIsDue(last({ lastSeenAt: new Date(NOW.getTime() - LAST_SEEN_FLOOR_MS) }), {}, NOW)).toBe(true)
  })

  it('is due when the row has never been seen', () => {
    expect(reportIsDue(last({ lastSeenAt: null }), {}, NOW)).toBe(true)
  })

  it('is due on a firmware change', () => {
    expect(reportIsDue(last(), { fw: '0.2.0' }, NOW)).toBe(true)
  })

  it('is due when the running location changes — the assigned-vs-applied gap', () => {
    expect(reportIsDue(last(), { reportedLocation: '2-1-1' }, NOW)).toBe(true)
  })

  it('is due when the battery moves past the threshold, not below it', () => {
    expect(reportIsDue(last(), { battMv: 3300 - BATT_DELTA_MV + 1 }, NOW)).toBe(false)
    expect(reportIsDue(last(), { battMv: 3300 - BATT_DELTA_MV }, NOW)).toBe(true)
  })

  it('is due when RSSI moves past the threshold, not below it', () => {
    expect(reportIsDue(last(), { rssiDbm: -60 - RSSI_DELTA_DB + 1 }, NOW)).toBe(false)
    expect(reportIsDue(last(), { rssiDbm: -60 - RSSI_DELTA_DB }, NOW)).toBe(true)
  })

  it('a first battery or RSSI reading is always due', () => {
    expect(reportIsDue(last({ battMv: null }), { battMv: 3300 }, NOW)).toBe(true)
    expect(reportIsDue(last({ rssiDbm: null }), { rssiDbm: -60 }, NOW)).toBe(true)
  })

  it('is due when uptime DROPS (a reboot), never when it merely rises', () => {
    expect(reportIsDue(last(), { upSec: 5000 }, NOW)).toBe(false)
    expect(reportIsDue(last(), { upSec: 12 }, NOW)).toBe(true)
  })
})

describe('reportData', () => {
  it('OMITS fields the device did not send rather than nulling them', () => {
    // "We have not heard a battery reading lately" and "the battery is
    // unknown" are different things to an operator.
    const data = reportData({ fw: '0.1.0' }, NOW)
    expect(data).toEqual({ lastSeenAt: NOW, fw: '0.1.0' })
    expect(data).not.toHaveProperty('battMv')
  })

  it('writes every reported field plus the timestamp', () => {
    expect(reportData({ fw: '1', battMv: 1, rssiDbm: -1, upSec: 2, reportedLocation: '1-1-1' }, NOW)).toEqual({
      lastSeenAt: NOW, fw: '1', battMv: 1, rssiDbm: -1, upSec: 2, reportedLocation: '1-1-1',
    })
  })
})
