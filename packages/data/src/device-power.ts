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
 * **The bands come from measurement** (`../sunbnb-hw` exp 005 §9). Deep sleep and
 * staying associated cross at about 27 s on the measured 4.56 s wake, which is why
 * light sleep owns the middle. Deep sleep cannot reach below ~30 s at all: the join
 * is the floor. Continuous exists for the range below that, where neither sleeping
 * mode can go.
 *
 * Light sleep's CEILING (45 s) deliberately sits past the 27 s crossover rather than
 * on it. Crossing it is not a cliff — light sleep is roughly flat with cadence, so
 * 45 s costs about what 27 s does; deep sleep is merely cheaper there. Holding the
 * association is worth that on a venue whose AP is fussy about rejoins, or where
 * deep sleep's reset-per-wake is not wanted yet. The FLOOR of each band is physics
 * and must not be widened; light sleep's ceiling is an operating choice.
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
  light_sleep: { min: 10, max: 45 },
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

/** "1–15 seconds" — the band as the admin UI and the error messages say it. */
export function describePollBand(mode: DevicePowerMode): string {
  const band = POLL_BANDS[mode]
  return `${band.min}–${band.max} seconds`
}

/**
 * Validate a candidate interval AGAINST A MODE, with an explanation.
 *
 * PURE and client-safe on purpose: the admin form validates the pair as the
 * operator types (changing the mode has to invalidate an interval the new mode
 * cannot keep, before a save is attempted), and the server validates the same pair
 * on the write path. Both call this, so the message the admin reads while typing is
 * the message the server would have answered with.
 *
 * Note this REFUSES rather than clamps — the opposite of `clampPollInterval`, and
 * the difference is who is asking. A person choosing a cadence must be told their
 * number is not available in this mode; a device already in the field must be given
 * the nearest legal number rather than an error it cannot read.
 */
export function validatePollInterval(
  mode: DevicePowerMode,
  raw: string | number,
): { ok: true; seconds: number } | { ok: false; error: string } {
  const trimmed = typeof raw === 'string' ? raw.trim() : raw
  if (trimmed === '') return { ok: false, error: 'Poll interval is required' }

  const n = Number(trimmed)
  if (!Number.isFinite(n)) return { ok: false, error: 'Poll interval must be a number' }
  if (!Number.isInteger(n)) {
    return { ok: false, error: 'Poll interval must be a whole number of seconds' }
  }

  const band = POLL_BANDS[mode]
  if (n < band.min || n > band.max) {
    return {
      ok: false,
      error: `${devicePowerModeLabel(mode)} accepts ${describePollBand(mode)} — ${n} s is outside that range.`,
    }
  }
  return { ok: true, seconds: n }
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

/**
 * Validate a mode + interval as ONE policy, the way a person sets it.
 *
 * The single write-path check, shared by the admin preferences writer
 * (`setDevicePolicy`) and the partner per-device writer, so a refusal reads the
 * same wherever it is triggered. Bounds live in `POLL_BANDS`, never in a form.
 */
export function validateDevicePolicy(
  rawMode: unknown,
  rawInterval: string | number,
):
  | { ok: true; mode: DevicePowerMode; pollAfterSec: number }
  | { ok: false; error: string } {
  if (!isDevicePowerMode(rawMode)) {
    return { ok: false, error: `Power mode must be one of: ${DEVICE_POWER_MODES.join(', ')}` }
  }
  const interval = validatePollInterval(rawMode, rawInterval)
  if (!interval.ok) return { ok: false, error: interval.error }
  return { ok: true, mode: rawMode, pollAfterSec: interval.seconds }
}

/** Where the policy a device is being served actually came from. */
export type DevicePolicySource = 'device' | 'platform'

export interface ResolvedDevicePolicy extends DevicePolicy {
  source: DevicePolicySource
}

/**
 * The policy one device runs: its own override when it has a usable one, the
 * platform pair otherwise. A tier cascade in the shape of `resolveServiceFee`
 * (`./payment`) — first match wins, tiers arrive as arguments, so this stays
 * pure and testable without a database.
 *
 * The decision table, and it is deliberate in every row:
 *
 *   both columns null      → platform policy verbatim            (`platform`)
 *   exactly one set        → platform policy                     (`platform`)
 *   both set, mode illegal → platform policy                     (`platform`)
 *   both set, mode legal   → that mode, interval CLAMPED into it  (`device`)
 *
 * A HALF-SET override inherits because half a policy is not a policy anyone
 * chose, and the platform pair is known-good. An ILLEGAL MODE inherits for the
 * same reason plus a sharper one: there is no band to clamp against, so nothing
 * of the operator's intent survives to preserve.
 *
 * An OUT-OF-BAND interval, though, is clamped inside the device's OWN mode
 * rather than bounced to the platform pair — and the difference is a flat cell.
 * Bands are code-owned policy and have already moved once (light sleep's
 * ceiling, track 025). If a narrowing turned a device overridden to
 * `deep_sleep`/300 s into "inherit", and the platform happened to be
 * `continuous`/5 s, that device would go from polling five times an hour to
 * once a second and be dead in three days. Clamping keeps the operator's intent
 * — this mode, roughly this cadence — and keeps the module's fail-safe
 * direction intact: garbage costs response time, never the battery.
 */
export function resolveDevicePolicyForDevice(
  override: { mode: unknown; intervalSec: number | null | undefined },
  platform: { mode: unknown; intervalSec: number },
): ResolvedDevicePolicy {
  if (override.intervalSec != null && isDevicePowerMode(override.mode)) {
    return { ...resolveDevicePolicy(override.mode, override.intervalSec), source: 'device' }
  }
  return { ...resolveDevicePolicy(platform.mode, platform.intervalSec), source: 'platform' }
}
