/**
 * Device power modes and their poll bands (track 025).
 *
 * A sunbed indicator can run in one of three power modes, and the mode is the
 * thing cadence alone cannot express. `poll_after_sec` already tunes how
 * responsive a device is WITHIN a mode; it cannot cross between them, because
 * each mode is a different physical arrangement of the radio and the CPU:
 *
 *   continuous  CPU awake between polls, association held. Reacts in ~1 s.
 *               ~20 mA — about three days on a 1500 mAh cell with no sun.
 *   light_sleep Chip clock-gated between polls, association HELD, so a poll is
 *               a request rather than a rejoin. ~6.55 mA, ~9 days. Its cost is
 *               AP-side beacon upkeep, so it is roughly FLAT with cadence.
 *   deep_sleep  Chip off between polls; every wake pays a full Wi-Fi join, so
 *               the cost SCALES with cadence. ~11 mAh/day at 60 s, ~4.5 months.
 *
 * **The bands are measured, not chosen** (`../sunbnb-hw` exp 005 §9). Deep sleep
 * and staying associated cross at about 27 s on the measured 4.56 s wake, which
 * is why light sleep owns the middle and deep sleep everything above. Deep sleep
 * cannot reach below ~30 s at all: the join is the floor. Continuous exists for
 * the range below that, where neither sleeping mode can go.
 *
 * PURE — no Prisma import, so a client component may import it (the admin
 * preferences UI does). The preference plumbing lives in `./preferences`.
 */

export const DEVICE_POWER_MODES = ['continuous', 'light_sleep', 'deep_sleep'] as const

export type DevicePowerMode = (typeof DEVICE_POWER_MODES)[number]

export interface PollBand {
  /** Inclusive, seconds. */
  min: number
  max: number
}

/**
 * The poll cadences each mode can actually serve. The bands OVERLAP on purpose
 * — at 10–15 s both continuous and light sleep are physically possible, and at
 * 30 s both light and deep are. The overlap is where the interesting decisions
 * live ("60 s, but stay associated because a change is expected"), and it is
 * exactly why the mode is a field of its own rather than something inferred
 * from the number.
 */
export const POLL_BANDS: Record<DevicePowerMode, PollBand> = {
  continuous: { min: 1, max: 15 },
  light_sleep: { min: 10, max: 30 },
  deep_sleep: { min: 30, max: 300 },
}

/** The widest interval any mode accepts — the bounds of the stored preference. */
export const POLL_INTERVAL_MIN = Math.min(...Object.values(POLL_BANDS).map((b) => b.min))
export const POLL_INTERVAL_MAX = Math.max(...Object.values(POLL_BANDS).map((b) => b.max))

export function isDevicePowerMode(value: unknown): value is DevicePowerMode {
  return typeof value === 'string' && (DEVICE_POWER_MODES as readonly string[]).includes(value)
}

export function pollBandFor(mode: DevicePowerMode): PollBand {
  return POLL_BANDS[mode]
}

/** Human label for the admin UI. Kept here so the wire value stays the id. */
export function devicePowerModeLabel(mode: DevicePowerMode): string {
  return { continuous: 'Continuous', light_sleep: 'Light sleep', deep_sleep: 'Deep sleep' }[mode]
}

/**
 * Force an interval into a mode's band.
 *
 * The admin write path refuses an out-of-band number and re-clamps the stored
 * interval when the mode changes, so in practice this never fires. It is the
 * SECOND check, in the same spirit as `parsePreferenceValue`'s bounds: an env
 * override, a direct SQL edit or a row left by an older release can all present
 * a number no mode can serve, and the consumer is a potted device that will
 * obey whatever it is told for the rest of the season. Serving the nearest
 * legal cadence beats serving one the mode physically cannot keep.
 */
export function clampPollInterval(mode: DevicePowerMode, seconds: number): number {
  const band = POLL_BANDS[mode]
  // Not a number at all (NaN, either infinity) → the CHEAP end of the band, in
  // the same fail-safe direction as the mode fallback below: garbage must cost
  // response time, never a flat cell on a parasol nobody is watching.
  if (!Number.isFinite(seconds)) return band.max
  return Math.min(band.max, Math.max(band.min, Math.round(seconds)))
}

export interface DevicePolicy {
  mode: DevicePowerMode
  /** The cadence actually served, always inside the mode's band. */
  pollAfterSec: number
  /** True when the stored interval had to be moved to fit the band. */
  clamped: boolean
}

/**
 * What a device should be told to do. One place, so the state route, the admin
 * UI and any future per-site policy cannot disagree about what a stored pair of
 * values means.
 */
export function resolveDevicePolicy(
  rawMode: unknown,
  rawInterval: number,
): DevicePolicy {
  // An unrecognised mode is the safe one, not the fast one: a device polling
  // every second on a wrong value empties a cell in days.
  const mode = isDevicePowerMode(rawMode) ? rawMode : 'deep_sleep'
  const pollAfterSec = clampPollInterval(mode, rawInterval)
  return { mode, pollAfterSec, clamped: pollAfterSec !== rawInterval }
}
