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
  TEMP_DELTA_C,
  CHG_DELTA_UAH,
  HEAP_DELTA_BYTES,
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
    tempC: 24,
    currentUa: 25100,
    chargeUah: -1852,
    resetReason: 'poweron',
    reportedPowerMode: 'light_sleep',
    heapFreeBytes: 241088,
    pollFails: 0,
    cellTempC: 31,
    reportedFace: 'FREE',
    reportedIntervalSec: 60,
    wifiChannel: 6,
    vminMv: 3102,
    imaxUa: 82700,
    fullCount: 2,
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

  it('reads a full report in the order api_format_report actually emits it', () => {
    // Built from ../sunbnb-hw firmware/device/main/api.c `api_format_report`
    // (907f228), NOT from the prose example in telemetry-fields.md — the doc's
    // sample omits `slp` on a light_sleep device and shows `fw` as a git hash,
    // while FW_VERSION is the literal "0.1.0". This is a LIGHT-sleep unit, so
    // it carries `slp` and no `wake`/`wjoin`.
    expect(
      parseTelemetryHeader(
        'fw=0.1.0;batt=3174;vmin=3102;rssi=-36;up=412;polls=27;slp=850;temp=24;drops=2;retry=5;' +
          'cur=25100;imax=82700;chg=-1852;rst=poweron;mode=light_sleep;heap=241088;fails=0;' +
          'ctemp=31;disc=FREE;iv=60;chan=6;full=2;loc=1-1-1',
      ),
    ).toEqual({
      fw: '0.1.0',
      battMv: 3174,
      rssiDbm: -36,
      upSec: 412,
      tempC: 24,
      currentUa: 25100,
      chargeUah: -1852,
      resetReason: 'poweron',
      reportedPowerMode: 'light_sleep',
      heapFreeBytes: 241088,
      pollFails: 0,
      cellTempC: 31,
      reportedFace: 'FREE',
      reportedIntervalSec: 60,
      wifiChannel: 6,
      vminMv: 3102,
      imaxUa: 82700,
      fullCount: 2,
      reportedLocation: '1-1-1',
    })
  })

  it('reads a DEEP-sleep report — a different key set, same twelve columns', () => {
    // Deep sleep reports `wake`/`wjoin` (its whole energy bill) and no `slp`.
    // Both are dropped; the point is that the mode swap changes which keys
    // arrive and changes nothing about what we store.
    expect(
      parseTelemetryHeader(
        'fw=0.1.0;batt=3174;rssi=-36;up=412;polls=27;temp=24;wake=4560;wjoin=3100;' +
          'cur=3500;chg=120;rst=deepsleep;mode=deep_sleep;heap=241088;fails=0;loc=1-1-1',
      ),
    ).toMatchObject({
      resetReason: 'deepsleep',
      reportedPowerMode: 'deep_sleep',
      currentUa: 3500,
      chargeUah: 120,
    })
  })

  it('reads the bring-up shape: no ADC and no link, so batt and rssi are absent', () => {
    // What a board in the field actually sends today — `batt_mv` is omitted
    // until the ADC lands, and `rssi` is 0 (omitted) when not associated.
    expect(parseTelemetryHeader('fw=0.1.0;up=412;polls=27;rst=poweron;mode=continuous;fails=0')).toEqual({
      fw: '0.1.0',
      upSec: 412,
      resetReason: 'poweron',
      reportedPowerMode: 'continuous',
      pollFails: 0,
    })
  })

  it('tolerates an EMPTY fw, which the formatter emits for a NULL version', () => {
    // `snprintf(out, cap, "fw=%s", t->fw ? t->fw : "")` — the key is always
    // written, value or not, so `fw=` is on the wire whenever fw is NULL.
    expect(parseTelemetryHeader('fw=;up=412')).toEqual({ upSec: 412 })
  })

  it('keeps a reported ZERO for the fields where zero is a measurement', () => {
    // `cur` and `chg` can legitimately BE zero — an idle cell, an exactly
    // balanced day — so the firmware carries validity flags rather than using 0
    // as a sentinel. Dropping them here would turn a reading into a gap.
    expect(parseTelemetryHeader('cur=0;chg=0;fails=0')).toEqual({
      currentUa: 0,
      chargeUah: 0,
      pollFails: 0,
    })
  })

  it('reads the signed energy fields in both directions', () => {
    // Negative current = charging, which is the whole point of the field: it
    // answers "are the panels winning" with no instrument on site.
    expect(parseTelemetryHeader('cur=-3500;chg=12000;imax=-41000')).toEqual({
      currentUa: -3500, chargeUah: 12000, imaxUa: -41000,
    })
  })

  it('accepts an UNKNOWN enum word rather than leaving a stale one standing', () => {
    // A firmware that gains a reset cause must be able to report it. Dropping
    // the value would keep the previous `rst` in the column next to a fresh
    // crash, which reads as an attribution nobody made.
    expect(parseTelemetryHeader('rst=usb;mode=hibernate')).toEqual({
      resetReason: 'usb',
      reportedPowerMode: 'hibernate',
    })
  })

  it('reads the UPPERCASE disc faces — they are the server\'s own state vocabulary', () => {
    // `seat_state_name()` returns FREE/RESERVED/OCCUPIED/UNAVAILABLE/STALE, the
    // exact tokens our projection emits. A lowercase-only word rule would drop
    // every one of them, and case-folding would break the only comparison the
    // field exists for — `disc` is read against the state we served.
    for (const face of ['FREE', 'RESERVED', 'OCCUPIED', 'UNAVAILABLE', 'STALE']) {
      expect(parseTelemetryHeader(`disc=${face}`)).toEqual({ reportedFace: face })
    }
  })

  it("drops the firmware's `?` — it names an unknown mode, not a new one", () => {
    // `power_mode_name()` returns "?" for a mode outside its table, so this is
    // a real thing the wire can carry. Leaving the last known mode standing is
    // right here: the device is not reporting a change, it is reporting that it
    // cannot name what it is in.
    expect(parseTelemetryHeader('mode=?;fw=0.1.0')).toEqual({ fw: '0.1.0' })
    // `seat_state_name()` has the same escape hatch.
    expect(parseTelemetryHeader('disc=?;fw=0.1.0')).toEqual({ fw: '0.1.0' })
  })

  it('drops the sentinel values the firmware uses for "no reading"', () => {
    // Mirrors api_format_report's own guards: batt > 0, rssi != 0,
    // temp > -999, heap > 0, fails >= 0. A 0 mV cell is the difference between
    // "the sensor did not answer" and "walk out to that parasol".
    expect(
      parseTelemetryHeader('batt=0;rssi=0;temp=-999;heap=0;fails=-1;ctemp=-999;iv=0;chan=0;vmin=0;full=-1'),
    ).toEqual({})
    expect(parseTelemetryHeader('batt=-5')).toEqual({})
    // The real readings on the other side of each sentinel still land.
    expect(
      parseTelemetryHeader('batt=1;rssi=-1;temp=-998;heap=1;fails=0;ctemp=-998;iv=1;chan=1;vmin=1;full=0'),
    ).toEqual({
      battMv: 1, rssiDbm: -1, tempC: -998, heapFreeBytes: 1, pollFails: 0,
      cellTempC: -998, reportedIntervalSec: 1, wifiChannel: 1, vminMv: 1, fullCount: 0,
    })
    // `imax` carries a validity FLAG on the device like `cur` and `chg`, so 0 is
    // a reading and has no floor.
    expect(parseTelemetryHeader('imax=0')).toEqual({ imaxUa: 0 })
  })

  it('rejects an enum word that is not a bare token, or is too long', () => {
    // The rule is SHAPE, not case: `disc` arrives in caps and `mode` in lower
    // snake, so an unexpected case is stored verbatim rather than dropped —
    // same reasoning as an unknown `rst`, since leaving a stale value standing
    // is the worse failure. A space or a symbol is still not a token.
    expect(parseTelemetryHeader('rst=power on;mode=deep-sleep')).toEqual({})
    expect(parseTelemetryHeader(`rst=${'x'.repeat(33)}`)).toEqual({})
    expect(parseTelemetryHeader('mode=DEEP')).toEqual({ reportedPowerMode: 'DEEP' })
  })

  it('returns an empty report for a missing header', () => {
    expect(parseTelemetryHeader(null)).toEqual({})
    expect(parseTelemetryHeader('')).toEqual({})
  })

  it('skips a malformed pair without dropping the rest', () => {
    expect(parseTelemetryHeader('fw=0.1.0;garbage;=5;rssi=abc;up=12')).toEqual({ fw: '0.1.0', upSec: 12 })
  })

  it('ignores an unknown key — a newer firmware never breaks an older server', () => {
    expect(parseTelemetryHeader('fw=0.1.0;pressure=1013')).toEqual({ fw: '0.1.0' })
  })

  it('drops the diagnostic counters that earn no column', () => {
    // `polls` `slp` `wake` `wjoin` `drops` `retry` are accepted and dropped:
    // useful in a log line, not worth a schema (telemetry-fields.md agrees).
    expect(parseTelemetryHeader('polls=27;slp=850;wake=4560;wjoin=3100;drops=2;retry=5;fw=0.1.0')).toEqual({
      fw: '0.1.0',
    })
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

  it('carries the v2 fields too, by COLUMN name — the body is not the wire', () => {
    expect(
      reportFromBody({
        tempC: 24,
        currentUa: -3500,
        chargeUah: 0,
        resetReason: 'brownout',
        reportedPowerMode: 'deep_sleep',
        heapFreeBytes: 241088,
        pollFails: 3,
      }),
    ).toEqual({
      tempC: 24,
      currentUa: -3500,
      chargeUah: 0,
      resetReason: 'brownout',
      reportedPowerMode: 'deep_sleep',
      heapFreeBytes: 241088,
      pollFails: 3,
    })
  })

  it('applies the same word shape to the body as to the header', () => {
    expect(reportFromBody({ resetReason: 'power on', reportedPowerMode: 7 })).toEqual({})
    expect(reportFromBody({ reportedPowerMode: '?' })).toEqual({})
  })

  it('applies the sentinel rules to the body — this is the path that sends battMv: 0', () => {
    // VERBATIM the payload api_post_telemetry builds for a device with no ADC
    // fitted and no link: unlike the header formatter, it applies no guards and
    // sends the zeros. That is how `battMv: 0` reached the fleet list and forced
    // the "a zero reading is the ABSENCE of a measurement" branch in
    // apps/partner/app/devices/device-health.ts. It stops here now.
    expect(reportFromBody({ fw: '0.1.0', battMv: 0, rssiDbm: 0, upSec: 412, polls: 27 })).toEqual({
      fw: '0.1.0',
      upSec: 412,
    })
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

  it('is due the poll a reset cause changes — brownout is the alert', () => {
    expect(reportIsDue(last(), { resetReason: 'poweron' }, NOW)).toBe(false)
    expect(reportIsDue(last({ resetReason: 'poweron' }), { resetReason: 'brownout' }, NOW)).toBe(true)
  })

  it('is due the poll the APPLIED power mode changes', () => {
    // Track 025's assigned-vs-applied gap: a unit held in continuous by a
    // console cable must show up as a gap, not on the 5-minute floor.
    expect(reportIsDue(last(), { reportedPowerMode: 'light_sleep' }, NOW)).toBe(false)
    expect(reportIsDue(last(), { reportedPowerMode: 'continuous' }, NOW)).toBe(true)
  })

  it('is due on the zero-to-non-zero edge of consecutive failures, not on the count', () => {
    // A device being DECLINED every poll still reports; triggering on every
    // increment would write every poll, which is the traffic the throttle exists
    // for. "Is it being rejected" is the state; the count is detail.
    expect(reportIsDue(last({ pollFails: 0 }), { pollFails: 1 }, NOW)).toBe(true)
    expect(reportIsDue(last({ pollFails: 3 }), { pollFails: 9 }, NOW)).toBe(false)
    expect(reportIsDue(last({ pollFails: 4 }), { pollFails: 0 }, NOW)).toBe(true)
  })

  it('is due the poll the DISC FACE changes — the applied seat state', () => {
    // The third assigned-vs-applied loop after location and power mode, and the
    // only way to catch a device that polls happily and renders the wrong face.
    expect(reportIsDue(last(), { reportedFace: 'FREE' }, NOW)).toBe(false)
    expect(reportIsDue(last(), { reportedFace: 'RESERVED' }, NOW)).toBe(true)
    expect(reportIsDue(last({ reportedFace: 'FREE' }), { reportedFace: 'STALE' }, NOW)).toBe(true)
  })

  it('is due when the in-force poll interval or the Wi-Fi channel moves', () => {
    expect(reportIsDue(last(), { reportedIntervalSec: 60, wifiChannel: 6 }, NOW)).toBe(false)
    expect(reportIsDue(last(), { reportedIntervalSec: 15 }, NOW)).toBe(true)
    expect(reportIsDue(last(), { wifiChannel: 11 }, NOW)).toBe(true)
  })

  it('records a CONNECTIVITY LADDER recovery, then the return to normal', () => {
    // The device degrades itself when it cannot reach us and cannot report
    // while that is happening, so the whole outage arrives on the ONE poll that
    // recovers: fails >> 0 beside a mode/iv that disagree with the assignment.
    const ladderReport = {
      fw: '0.1.0', reportedPowerMode: 'deep_sleep', reportedIntervalSec: 3600, pollFails: 24,
      reportedFace: 'STALE',
    }
    const healthy = last({ reportedPowerMode: 'light_sleep', reportedIntervalSec: 60, pollFails: 0 })
    expect(reportIsDue(healthy, ladderReport, NOW)).toBe(true)

    // The 200 that recovered it restores the served mode and zeroes the counter,
    // so the NEXT poll records the return — two rows for an outage of any length.
    const recorded = last({
      reportedPowerMode: 'deep_sleep', reportedIntervalSec: 3600, pollFails: 24, reportedFace: 'STALE',
    })
    expect(
      reportIsDue(recorded, {
        reportedPowerMode: 'light_sleep', reportedIntervalSec: 60, pollFails: 0, reportedFace: 'FREE',
      }, NOW),
    ).toBe(true)
  })

  it('is due on ANY change in the charge ANCHOR, a decrease included', () => {
    // `full` is what makes `chargeUah` readable: a step means the counter was
    // zeroed at charge-complete, so a chg delta across it is not a discharge.
    // A DECREASE is a power cut, which clears the INA228's accumulator too —
    // it invalidates a chg baseline exactly as a step does.
    expect(reportIsDue(last(), { fullCount: 2 }, NOW)).toBe(false)
    expect(reportIsDue(last({ fullCount: 2 }), { fullCount: 3 }, NOW)).toBe(true)
    expect(reportIsDue(last({ fullCount: 2 }), { fullCount: 0 }, NOW)).toBe(true)
  })

  it('is due when the SAG deepens — the earliest ageing signal there is', () => {
    // `batt - vmin` is the sag under load. vmin is thresholded on batt's own
    // band because it is the same quantity read at the window's worst; without
    // a trigger, a 60 s cadence under the 5-min floor would sample one window
    // in five and systematically miss the bad ones.
    expect(reportIsDue(last(), { vminMv: 3102 - BATT_DELTA_MV + 1 }, NOW)).toBe(false)
    expect(reportIsDue(last(), { vminMv: 3102 - BATT_DELTA_MV }, NOW)).toBe(true)
  })

  it('NEVER triggers on the burst peak — it is a trend, not a headline', () => {
    // `imax` is dominated by whether the window held a Wi-Fi join (82.7 mA
    // mid-join against ~25 mA idle), so a threshold on it fires on the join
    // schedule rather than on anything an operator can act on. It rides along.
    expect(reportIsDue(last({ imaxUa: 82700 }), { imaxUa: 25000 }, NOW)).toBe(false)
    expect(reportIsDue(last({ imaxUa: null }), { imaxUa: 120000 }, NOW)).toBe(false)
  })

  it('thresholds temperature, net charge and free heap', () => {
    expect(reportIsDue(last(), { tempC: 24 + TEMP_DELTA_C - 1 }, NOW)).toBe(false)
    expect(reportIsDue(last(), { tempC: 24 + TEMP_DELTA_C }, NOW)).toBe(true)
    // The CELL's temperature is thresholded on the same band as the chip's.
    expect(reportIsDue(last(), { cellTempC: 31 + TEMP_DELTA_C - 1 }, NOW)).toBe(false)
    expect(reportIsDue(last(), { cellTempC: 31 + TEMP_DELTA_C }, NOW)).toBe(true)
    expect(reportIsDue(last(), { chargeUah: -1852 - CHG_DELTA_UAH + 1 }, NOW)).toBe(false)
    expect(reportIsDue(last(), { chargeUah: -1852 - CHG_DELTA_UAH }, NOW)).toBe(true)
    expect(reportIsDue(last(), { heapFreeBytes: 241088 - HEAP_DELTA_BYTES + 1 }, NOW)).toBe(false)
    expect(reportIsDue(last(), { heapFreeBytes: 241088 - HEAP_DELTA_BYTES }, NOW)).toBe(true)
  })

  it('NEVER triggers on instantaneous current, however far it swings', () => {
    // `cur` moves between ~3.5 mA asleep and ~20 mA awake within one poll, so
    // any threshold on it degenerates into a write per poll. It rides along on
    // writes earned by something else; `chg` integrates it and carries the story.
    expect(reportIsDue(last({ currentUa: 25100 }), { currentUa: 3500 }, NOW)).toBe(false)
    expect(reportIsDue(last({ currentUa: null }), { currentUa: -40000 }, NOW)).toBe(false)
  })

  it('a first reading of any thresholded field is due, but a first current is not', () => {
    expect(reportIsDue(last({ tempC: null }), { tempC: 24 }, NOW)).toBe(true)
    expect(reportIsDue(last({ chargeUah: null }), { chargeUah: 0 }, NOW)).toBe(true)
    expect(reportIsDue(last({ heapFreeBytes: null }), { heapFreeBytes: 1 }, NOW)).toBe(true)
    expect(reportIsDue(last({ currentUa: null }), { currentUa: 0 }, NOW)).toBe(false)
  })

  it('is NOT due for a full v2 report that only drifted within every threshold', () => {
    // The shape that matters for the bill: a device polling every second sends
    // all eighteen keys and earns nothing.
    expect(
      reportIsDue(
        last(),
        {
          fw: '0.1.0', battMv: 3290, rssiDbm: -63, upSec: 1001, tempC: 26,
          currentUa: 3500, chargeUah: -1900, resetReason: 'poweron',
          reportedPowerMode: 'light_sleep', heapFreeBytes: 240000, pollFails: 0,
          cellTempC: 33, reportedFace: 'FREE', reportedIntervalSec: 60, wifiChannel: 6,
          vminMv: 3090, imaxUa: 31000, fullCount: 2,
          reportedLocation: '1-1-1',
        },
        NOW,
      ),
    ).toBe(false)
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
    expect(
      reportData(
        {
          fw: '1', battMv: 1, rssiDbm: -1, upSec: 2, tempC: 24, currentUa: -3500,
          chargeUah: 12000, resetReason: 'brownout', reportedPowerMode: 'continuous',
          heapFreeBytes: 241088, pollFails: 3, cellTempC: 31, reportedFace: 'STALE',
          reportedIntervalSec: 3600, wifiChannel: 11, vminMv: 3102, imaxUa: 82700,
          fullCount: 2, reportedLocation: '1-1-1',
        },
        NOW,
      ),
    ).toEqual({
      lastSeenAt: NOW, fw: '1', battMv: 1, rssiDbm: -1, upSec: 2, tempC: 24, currentUa: -3500,
      chargeUah: 12000, resetReason: 'brownout', reportedPowerMode: 'continuous',
      heapFreeBytes: 241088, pollFails: 3, cellTempC: 31, reportedFace: 'STALE',
      reportedIntervalSec: 3600, wifiChannel: 11, vminMv: 3102, imaxUa: 82700,
      fullCount: 2, reportedLocation: '1-1-1',
    })
  })

  it('writes a reported ZERO — for cur, chg and fails it is an answer', () => {
    expect(reportData({ currentUa: 0, chargeUah: 0, pollFails: 0, imaxUa: 0, fullCount: 0 }, NOW)).toEqual({
      lastSeenAt: NOW, currentUa: 0, chargeUah: 0, pollFails: 0, imaxUa: 0, fullCount: 0,
    })
  })
})
