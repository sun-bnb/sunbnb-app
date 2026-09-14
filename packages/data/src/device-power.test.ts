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
  describePollBand,
  devicePowerModeLabel,
  isDevicePowerMode,
  pollBandFor,
  resolveDevicePolicy,
  resolveDevicePolicyForDevice,
  validateDevicePolicy,
  validatePollInterval,
} from './device-power'

describe('bands', () => {
  it('carries the bands the fleet can be switched to', () => {
    expect(POLL_BANDS).toEqual({
      continuous: { min: 1, max: 15 },
      light_sleep: { min: 10, max: 45 },
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
    expect(clampPollInterval('light_sleep', 60)).toBe(45)
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
    expect(clampPollInterval('light_sleep', Number.NEGATIVE_INFINITY)).toBe(45)
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
      pollAfterSec: 45,
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

describe('validatePollInterval', () => {
  // The counterpart of clampPollInterval, for a PERSON: the admin form and the
  // write path both call it, so the message shown while typing is the message the
  // server would have answered with.
  it('accepts an interval inside the mode band', () => {
    expect(validatePollInterval('continuous', '5')).toEqual({ ok: true, seconds: 5 })
    expect(validatePollInterval('light_sleep', 45)).toEqual({ ok: true, seconds: 45 })
    expect(validatePollInterval('deep_sleep', '300')).toEqual({ ok: true, seconds: 300 })
  })

  it('REFUSES rather than clamps, and names the mode and its band', () => {
    const result = validatePollInterval('deep_sleep', 5)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Deep sleep')
      expect(result.error).toContain('30–300 seconds')
      expect(result.error).toContain('5 s')
    }
  })

  it('refuses the interval a MODE CHANGE invalidates — the admin-form case', () => {
    // 60 s is legal under deep sleep and under neither other mode; switching the
    // mode with the old number still in the box must fail, not re-fit silently.
    expect(validatePollInterval('deep_sleep', 60).ok).toBe(true)
    expect(validatePollInterval('light_sleep', 60).ok).toBe(false)
    expect(validatePollInterval('continuous', 60).ok).toBe(false)
  })

  it('refuses a blank, a non-number and a fraction', () => {
    for (const raw of ['', '   ', 'soon', '12s', '1e', '20.5']) {
      expect(validatePollInterval('light_sleep', raw).ok).toBe(false)
    }
  })

  it('agrees with the bands at both boundaries of every mode', () => {
    for (const mode of DEVICE_POWER_MODES) {
      const band = pollBandFor(mode)
      expect(validatePollInterval(mode, band.min).ok).toBe(true)
      expect(validatePollInterval(mode, band.max).ok).toBe(true)
      expect(validatePollInterval(mode, band.min - 1).ok).toBe(false)
      expect(validatePollInterval(mode, band.max + 1).ok).toBe(false)
    }
  })
})

describe('describePollBand', () => {
  it('reads the way the band is written in the UI', () => {
    expect(describePollBand('continuous')).toBe('1–15 seconds')
    expect(describePollBand('light_sleep')).toBe('10–45 seconds')
    expect(describePollBand('deep_sleep')).toBe('30–300 seconds')
  })
})

describe('validateDevicePolicy — the one write-path check', () => {
  it('accepts a legal pair and hands back the wire values', () => {
    expect(validateDevicePolicy('light_sleep', '20')).toEqual({
      ok: true,
      mode: 'light_sleep',
      pollAfterSec: 20,
    })
  })

  it('refuses an interval the chosen mode cannot keep, naming the band', () => {
    const result = validateDevicePolicy('continuous', 60)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('1–15 seconds')
  })

  it('refuses a mode by WIRE ID only — a label is not a mode here', () => {
    // The lenient folding (`Light Sleep` → `light_sleep`) belongs to the
    // preference registry, where an env var or a script types labels. A form
    // whose <select> carries wire ids must not get a second parser.
    for (const junk of ['Light Sleep', 'light-sleep', 'hibernate', '', null, 3]) {
      expect(validateDevicePolicy(junk, 20).ok).toBe(false)
    }
  })

  it('accepts every mode at both ends of its own band', () => {
    for (const mode of DEVICE_POWER_MODES) {
      const band = pollBandFor(mode)
      expect(validateDevicePolicy(mode, band.min).ok).toBe(true)
      expect(validateDevicePolicy(mode, band.max).ok).toBe(true)
    }
  })
})

describe('resolveDevicePolicyForDevice — device over platform', () => {
  const PLATFORM = { mode: 'deep_sleep', intervalSec: 60 }

  it('serves the platform pair verbatim to a device with no override', () => {
    expect(resolveDevicePolicyForDevice({ mode: null, intervalSec: null }, PLATFORM)).toEqual({
      mode: 'deep_sleep',
      pollAfterSec: 60,
      clamped: false,
      source: 'platform',
    })
  })

  it('lets a complete override win, and says where the policy came from', () => {
    expect(
      resolveDevicePolicyForDevice({ mode: 'continuous', intervalSec: 5 }, PLATFORM),
    ).toEqual({ mode: 'continuous', pollAfterSec: 5, clamped: false, source: 'device' })
  })

  it('inherits when only ONE half is set — half a policy is not a policy', () => {
    expect(
      resolveDevicePolicyForDevice({ mode: 'continuous', intervalSec: null }, PLATFORM).source,
    ).toBe('platform')
    expect(
      resolveDevicePolicyForDevice({ mode: null, intervalSec: 5 }, PLATFORM).source,
    ).toBe('platform')
    expect(
      resolveDevicePolicyForDevice({ mode: undefined, intervalSec: undefined }, PLATFORM).source,
    ).toBe('platform')
  })

  it('inherits on an unreadable mode — there is no band left to clamp against', () => {
    for (const junk of ['hibernate', '', 7, {}]) {
      const policy = resolveDevicePolicyForDevice({ mode: junk, intervalSec: 20 }, PLATFORM)
      expect(policy).toMatchObject({ mode: 'deep_sleep', pollAfterSec: 60, source: 'platform' })
    }
  })

  it('CLAMPS an out-of-band override inside its own mode rather than inheriting', () => {
    // The flat-cell case. Bands are code-owned and have moved once already; if a
    // narrowing bounced a device from deep_sleep/300 to "inherit" while the
    // platform happened to be continuous/5, that device would go from five polls
    // an hour to one a second and be dead in three days.
    const fast = { mode: 'continuous', intervalSec: 5 }
    const policy = resolveDevicePolicyForDevice({ mode: 'light_sleep', intervalSec: 300 }, fast)
    expect(policy).toEqual({
      mode: 'light_sleep',
      pollAfterSec: 45,
      clamped: true,
      source: 'device',
    })
  })

  it('never serves a cadence outside the band of the mode it reports', () => {
    for (const mode of DEVICE_POWER_MODES) {
      for (const seconds of [-10, 0, 1, 27, 60, 300, 5000, Number.NaN]) {
        const policy = resolveDevicePolicyForDevice({ mode, intervalSec: seconds }, PLATFORM)
        const band = pollBandFor(policy.mode)
        expect(policy.pollAfterSec).toBeGreaterThanOrEqual(band.min)
        expect(policy.pollAfterSec).toBeLessThanOrEqual(band.max)
      }
    }
  })

  it('clamps a junk PLATFORM pair too, so an inheriting device is still safe', () => {
    expect(
      resolveDevicePolicyForDevice(
        { mode: null, intervalSec: null },
        { mode: 'hibernate', intervalSec: 2 },
      ),
    ).toEqual({ mode: 'deep_sleep', pollAfterSec: 30, clamped: true, source: 'platform' })
  })
})
