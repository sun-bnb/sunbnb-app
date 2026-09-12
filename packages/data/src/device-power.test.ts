/**
 * Device power modes — unit tests.
 *
 * The load-bearing property: a device is never told to keep a cadence its mode
 * physically cannot keep. A potted device obeys what it is given for the rest
 * of the season, and the two directions fail differently — too slow is a light
 * that lags, too fast is a flat cell and a dark parasol.
 */

import { describe, it, expect } from 'vitest'

import {
  DEVICE_POWER_MODES,
  POLL_BANDS,
  POLL_INTERVAL_MIN,
  POLL_INTERVAL_MAX,
  clampPollInterval,
  devicePowerModeLabel,
  isDevicePowerMode,
  pollBandFor,
  resolveDevicePolicy,
} from './device-power'

describe('bands', () => {
  it('carries the measured bands from exp 005', () => {
    expect(POLL_BANDS).toEqual({
      continuous: { min: 1, max: 15 },
      light_sleep: { min: 10, max: 30 },
      deep_sleep: { min: 30, max: 300 },
    })
  })

  it('spans the union of every band', () => {
    expect(POLL_INTERVAL_MIN).toBe(1)
    expect(POLL_INTERVAL_MAX).toBe(300)
  })

  it('OVERLAPS between adjacent modes — the overlap is the point', () => {
    // 10–15 s is reachable by continuous and light sleep both, 30 s by light
    // and deep. "60 s but stay associated" is not expressible as a number,
    // which is why the mode is a field rather than an inference from cadence.
    expect(POLL_BANDS.continuous.max).toBeGreaterThanOrEqual(POLL_BANDS.light_sleep.min)
    expect(POLL_BANDS.light_sleep.max).toBeGreaterThanOrEqual(POLL_BANDS.deep_sleep.min)
  })

  it('leaves no gap a legal interval could fall into', () => {
    for (let s = POLL_INTERVAL_MIN; s <= POLL_INTERVAL_MAX; s++) {
      const servable = DEVICE_POWER_MODES.some((m) => s >= POLL_BANDS[m].min && s <= POLL_BANDS[m].max)
      expect(servable).toBe(true)
    }
  })
})

describe('isDevicePowerMode', () => {
  it('accepts every registered mode and nothing else', () => {
    for (const m of DEVICE_POWER_MODES) expect(isDevicePowerMode(m)).toBe(true)
    for (const junk of ['stow', 'DEEP_SLEEP', '', null, undefined, 60]) {
      expect(isDevicePowerMode(junk)).toBe(false)
    }
  })
})

describe('clampPollInterval', () => {
  it('leaves an in-band interval untouched', () => {
    expect(clampPollInterval('continuous', 5)).toBe(5)
    expect(clampPollInterval('light_sleep', 20)).toBe(20)
    expect(clampPollInterval('deep_sleep', 120)).toBe(120)
  })

  it('pulls an interval up to the mode floor', () => {
    // Deep sleep pays a full Wi-Fi join per wake; below its floor the join
    // costs more than staying associated would have.
    expect(clampPollInterval('deep_sleep', 5)).toBe(30)
    expect(clampPollInterval('light_sleep', 1)).toBe(10)
  })

  it('pulls an interval down to the mode ceiling', () => {
    expect(clampPollInterval('continuous', 900)).toBe(15)
    expect(clampPollInterval('light_sleep', 60)).toBe(30)
  })

  it('keeps the boundaries themselves', () => {
    for (const mode of DEVICE_POWER_MODES) {
      const band = pollBandFor(mode)
      expect(clampPollInterval(mode, band.min)).toBe(band.min)
      expect(clampPollInterval(mode, band.max)).toBe(band.max)
    }
  })

  it('rounds a fractional interval rather than sending one down the wire', () => {
    expect(clampPollInterval('deep_sleep', 60.4)).toBe(60)
    expect(clampPollInterval('deep_sleep', 60.6)).toBe(61)
  })

  it('answers the CHEAP end for a number that is not one', () => {
    // Same fail-safe direction as the mode fallback: garbage costs response
    // time, never a flat cell.
    expect(clampPollInterval('continuous', Number.NaN)).toBe(15)
    expect(clampPollInterval('deep_sleep', Number.POSITIVE_INFINITY)).toBe(300)
    expect(clampPollInterval('light_sleep', Number.NEGATIVE_INFINITY)).toBe(30)
  })
})

describe('resolveDevicePolicy', () => {
  it('passes a legal pair straight through', () => {
    expect(resolveDevicePolicy('light_sleep', 20)).toEqual({
      mode: 'light_sleep',
      pollAfterSec: 20,
      clamped: false,
    })
  })

  it('flags the clamp, so a caller can tell the operator', () => {
    expect(resolveDevicePolicy('light_sleep', 300)).toEqual({
      mode: 'light_sleep',
      pollAfterSec: 30,
      clamped: true,
    })
  })

  it('falls back to DEEP SLEEP on an unrecognised mode, never to continuous', () => {
    // The fallback direction is the whole point: a wrong deep_sleep costs
    // response time, a wrong continuous costs the battery in days.
    for (const junk of ['hibernate', '', null, undefined, 3]) {
      expect(resolveDevicePolicy(junk, 60).mode).toBe('deep_sleep')
    }
  })

  it('clamps against the FALLBACK band when the mode is junk', () => {
    expect(resolveDevicePolicy('hibernate', 2)).toEqual({
      mode: 'deep_sleep',
      pollAfterSec: 30,
      clamped: true,
    })
  })
})

describe('devicePowerModeLabel', () => {
  it('labels every mode', () => {
    expect(DEVICE_POWER_MODES.map(devicePowerModeLabel)).toEqual([
      'Continuous',
      'Light sleep',
      'Deep sleep',
    ])
  })
})
