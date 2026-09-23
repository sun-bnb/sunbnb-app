/**
 * Platform preferences — global tunables the platform operator sets in the
 * admin app instead of shipping them as constants in a deployed source file.
 *
 * The sibling of `flags.ts`, deliberately: feature flags answer "does this
 * feature exist yet", preferences answer "with what value does it run". Same
 * shape, same resolution discipline, same tolerance for a missing table.
 *
 * `PREFERENCE_REGISTRY` below is the single source of truth for which
 * preferences exist, their type, their bounds and their default. Each is
 * resolved in this order (first match wins):
 *
 *   1. Environment variable override — `PREF_<UPPER_SNAKE_KEY>`. Forces a value
 *      in one deployment without a DB row, and lets an operator recover from a
 *      bad DB value without database access.
 *   2. Row in `platform_preference`, set in the admin app.
 *   3. The registry default.
 *
 * A DB row is only ever an OVERRIDE, never the definition. That is what makes a
 * removed registry entry inert rather than load-bearing, and it is why the
 * default lives in code: a database that has never been written to must still
 * produce the value the code was written against.
 *
 * VALUES ARE VALIDATED TWICE, on the way in and on the way out. The setter
 * rejects an out-of-range value so the admin sees the error; the reader falls
 * back to the default when it reads one anyway. The second check is not
 * redundant — a row can outlive a bounds change, be written by a direct SQL
 * edit, or be left behind by an older release, and the consumers of this module
 * (the hardware poll cadence first among them) are not in a position to argue
 * with a bad number in the field.
 *
 * Import as `@repo/data/preferences`.
 */

import prisma from '../index'
import {
  DEVICE_POWER_MODES,
  POLL_INTERVAL_MAX,
  POLL_INTERVAL_MIN,
  clampPollInterval,
  devicePowerModeLabel,
  isDevicePowerMode,
  validateDevicePolicy,
  validatePollInterval,
  type DevicePowerMode,
} from './device-power'

// ─── Registry ───────────────────────────────────────────────────────────────

interface BasePreference {
  /** Stable identifier — used in code, env vars, and the DB primary key. */
  key: string
  /** Short human label for the admin UI. */
  label: string
  /** What it does and what changing it costs — shown in the admin UI. */
  description: string
  /** Grouping header in the admin UI. */
  group: string
}

export interface NumberPreference extends BasePreference {
  type: 'number'
  default: number
  /** Inclusive bounds. Both are enforced on write AND on read. */
  min: number
  max: number
  /** Rendered after the input (e.g. `seconds`). */
  unit?: string
}

export interface BooleanPreference extends BasePreference {
  type: 'boolean'
  default: boolean
}

export interface StringPreference extends BasePreference {
  type: 'string'
  default: string
  maxLength: number
}

/**
 * A closed set of values — rendered as a dropdown, never a free-text box. The
 * stored value is the wire id (`light_sleep`), not the label: the id travels to
 * a potted device and must never change when someone rewords the UI.
 */
export interface EnumPreference extends BasePreference {
  type: 'enum'
  default: string
  options: readonly { value: string; label: string }[]
}

export type PreferenceDefinition =
  | NumberPreference
  | BooleanPreference
  | StringPreference
  | EnumPreference

/**
 * The canonical list of platform preferences. Add new entries here — the admin
 * UI lists them automatically, grouped by `group`.
 *
 * Naming: lowercase, hyphen-separated. The env override looks for
 * `PREF_<UPPER_SNAKE_CASE>` — e.g. `device-poll-interval-sec` →
 * `PREF_DEVICE_POLL_INTERVAL_SEC`.
 */
export const PREFERENCE_REGISTRY = {
  'device-power-mode': {
    key: 'device-power-mode',
    type: 'enum',
    label: 'Device power mode',
    group: 'Hardware',
    description:
      'How a sunbed indicator spends the gap between polls. THE FLEET DEFAULT — served as `powerMode` on every 200 from /api/hw/{code}/state to every device that does not carry its own override (set per device by the operator in the partner fleet page), so the fleet is switched centrally rather than reflashed. CONTINUOUS keeps the CPU up (~1 s response, ~3 days on a cell) — for a demo or a busy afternoon. LIGHT SLEEP clock-gates the chip but HOLDS the Wi-Fi association, so a poll costs a request rather than a rejoin (~9 days); its cost is AP-side beacon upkeep and is roughly flat with cadence. DEEP SLEEP powers the chip down and pays a full Wi-Fi join per wake (~4.5 months at 60 s); its cost scales with cadence. The two cross at about 27 s, which is why each mode accepts a different range of poll intervals — pick the mode first, then a cadence inside its band.',
    default: 'deep_sleep',
    options: DEVICE_POWER_MODES.map((m) => ({ value: m, label: devicePowerModeLabel(m) })),
  },
  'device-poll-interval-sec': {
    key: 'device-poll-interval-sec',
    type: 'number',
    label: 'Device poll interval',
    group: 'Hardware',
    description:
      'How often a sunbed indicator device asks the server for seat state, in seconds. THE FLEET DEFAULT — served as `pollAfterSec` on every 200 from /api/hw/{code}/state to every device without its own override; firmware obeys it and never hardcodes an interval. Lower = a light that flips sooner, more serverless invocations and more battery; higher = the reverse. A change reaches a device on its next poll (the value is part of the response ETag, so it busts the 304 that would otherwise hide it). THE ALLOWED RANGE DEPENDS ON THE POWER MODE — continuous 1–15 s, light sleep 10–45 s, deep sleep 30–300 s — because a mode that physically cannot keep a cadence must not be told to (deep sleep pays a full Wi-Fi join per wake, so it has a floor around 30 s). An interval the selected mode cannot keep is refused — in the admin form as you type, and on every other write path.',
    default: 60,
    min: POLL_INTERVAL_MIN,
    max: POLL_INTERVAL_MAX,
    unit: 'seconds',
  },
  'device-telemetry-retention-days': {
    key: 'device-telemetry-retention-days',
    type: 'number',
    label: 'Telemetry history retention',
    group: 'Hardware',
    description:
      'How long a telemetry reading is kept, in days. EVERY reading a device reports is appended to a history (device_telemetry) — one row per poll, unthrottled — so the questions that are TRENDS rather than states can be answered later: is this unit energy-positive, what does each power mode actually cost on real hardware, is the cell ageing, is one unit faulty against the fleet. Nothing reads that history yet; it is collected at full fidelity now because a trend cannot be backfilled. The sweep runs daily and deletes the OLDEST rows past this age — it is the ONLY thing bounding the table, so treat it as a storage budget rather than a nicety. Rough arithmetic, because unthrottled means the poll interval sets the row rate: one device at the 60 s default writes 1440 rows/day, and at 15 s it writes 5760. A single unit under bring-up is therefore trivial, but a 1500-unit fleet at 60 s is ~2.2 M rows/DAY — about 8 x 10^8 rows and well over 100 GB at the default 365 days. Shorten this well before the fleet grows, and note that shortening it DELETES history on the next sweep, which cannot be undone.',
    default: 365,
    min: 1,
    max: 3650,
    unit: 'days',
  },
} as const satisfies Record<string, PreferenceDefinition>

export type PreferenceKey = keyof typeof PREFERENCE_REGISTRY

/** The value type of one registry entry, so callers keep number/boolean/string. */
export type PreferenceValue<K extends PreferenceKey> =
  (typeof PREFERENCE_REGISTRY)[K] extends { type: 'enum' }
    ? string
    : (typeof PREFERENCE_REGISTRY)[K]['default']

export type PreferenceSource = 'env' | 'db' | 'default'

export function isPreferenceKey(key: string): key is PreferenceKey {
  return key in PREFERENCE_REGISTRY
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

export function envVarForPreference(key: string): string {
  return `PREF_${key.toUpperCase().replace(/-/g, '_')}`
}

/**
 * Parse a stored/env string against a definition. Returns `undefined` for
 * anything the definition does not accept — an unparseable number, one outside
 * the bounds, an over-long string, an unrecognised boolean. `undefined` means
 * "no opinion", so the caller falls through to the next source and ultimately
 * to the default. Nothing here ever throws: this runs on the read path of a
 * device poll.
 */
export function parsePreferenceValue(
  def: PreferenceDefinition,
  raw: string | null | undefined,
): number | boolean | string | undefined {
  if (raw === null || raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined

  if (def.type === 'number') {
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return undefined
    if (n < def.min || n > def.max) return undefined
    return n
  }
  if (def.type === 'boolean') {
    const v = trimmed.toLowerCase()
    if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true
    if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false
    return undefined
  }
  if (def.type === 'enum') {
    // Fold case and separators so `Light Sleep`, `light-sleep` and `light_sleep`
    // all land — an operator types a label, the wire carries an id.
    const v = trimmed.toLowerCase().replace(/[\s-]+/g, '_')
    return def.options.some((o) => o.value === v) ? v : undefined
  }
  if (trimmed.length > def.maxLength) return undefined
  return trimmed
}

/** Serialize a value for storage. The inverse of `parsePreferenceValue`. */
export function serializePreferenceValue(value: number | boolean | string): string {
  return typeof value === 'boolean' ? String(value) : String(value)
}

/**
 * Validate a candidate value on the WRITE path. Unlike the reader, this
 * explains itself: the admin needs to know why the number was refused.
 */
export function validatePreferenceValue(
  def: PreferenceDefinition,
  raw: string,
): { ok: true; value: number | boolean | string } | { ok: false; error: string } {
  const parsed = parsePreferenceValue(def, raw)
  if (parsed !== undefined) return { ok: true, value: parsed }

  if (def.type === 'number') {
    const n = Number(String(raw).trim())
    if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number` }
    return {
      ok: false,
      error: `${def.label} must be between ${def.min} and ${def.max}${def.unit ? ` ${def.unit}` : ''}`,
    }
  }
  if (def.type === 'boolean') {
    return { ok: false, error: `${def.label} must be true or false` }
  }
  if (def.type === 'enum') {
    return {
      ok: false,
      error: `${def.label} must be one of: ${def.options.map((o) => o.value).join(', ')}`,
    }
  }
  return { ok: false, error: `${def.label} must be 1–${def.maxLength} characters` }
}

/**
 * Resolve one preference from the inputs. Pure — pass the DB string in, get the
 * value and its provenance out. Exposed for testing and used by everything
 * below.
 */
export function resolvePreference(
  def: PreferenceDefinition,
  dbValue?: string | null,
): { value: number | boolean | string; source: PreferenceSource } {
  const fromEnv = parsePreferenceValue(def, process.env[envVarForPreference(def.key)])
  if (fromEnv !== undefined) return { value: fromEnv, source: 'env' }

  const fromDb = parsePreferenceValue(def, dbValue)
  if (fromDb !== undefined) return { value: fromDb, source: 'db' }

  return { value: def.default, source: 'default' }
}

// ─── DB-aware API ───────────────────────────────────────────────────────────

/**
 * Same tolerance as the flags loader: a missing table (a DB that has not run
 * this migration) falls back to defaults rather than crashing the caller. The
 * consumers here include a route a fielded device polls — it must degrade to
 * the shipped default, never to an error.
 */
async function loadOverrides(): Promise<Map<string, string>> {
  try {
    const rows = await prisma.platformPreference.findMany({
      select: { key: true, value: true },
    })
    return new Map(rows.map((r) => [r.key, r.value]))
  } catch {
    return new Map()
  }
}

/** Read one preference. One primary-key lookup; see `getPreferenceCached`. */
export async function getPreference<K extends PreferenceKey>(
  key: K,
): Promise<PreferenceValue<K>> {
  const def = PREFERENCE_REGISTRY[key] as PreferenceDefinition
  let row: { value: string } | null = null
  try {
    row = await prisma.platformPreference.findUnique({
      where: { key },
      select: { value: true },
    })
  } catch {
    row = null
  }
  return resolvePreference(def, row?.value).value as PreferenceValue<K>
}

/**
 * A process-local cached read, for callers on a hot path where a DB round trip
 * per request is the actual cost being managed — the hardware state route runs
 * at roughly 1.3 M polls/day at fleet scale, and this value changes a few times
 * a year. The cache is per serverless instance, so a change propagates within
 * `ttlMs` (plus one poll), which is the trade being made deliberately: nothing
 * here is worth a synchronous read on every poll.
 */
const cache = new Map<string, { value: number | boolean | string; at: number }>()

export async function getPreferenceCached<K extends PreferenceKey>(
  key: K,
  ttlMs = 5 * 60 * 1000,
): Promise<PreferenceValue<K>> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as PreferenceValue<K>

  const value = await getPreference(key)
  cache.set(key, { value, at: Date.now() })
  return value
}

/** Drop the cache. For tests, and for the admin write path in the same process. */
export function clearPreferenceCache(): void {
  cache.clear()
}

// ─── The one cross-key rule: power mode constrains poll interval ────────────
//
// Preferences are otherwise independent, and keeping them so is what lets the
// registry stay a flat list. These two are not: a poll interval is only
// meaningful inside a power mode's band, because a mode that physically cannot
// keep a cadence must never be told to try (track 025). The coupling is
// therefore handled HERE, in the module that owns validation, rather than in
// the admin form — a script or a future API must obey the same rule.

const MODE_KEY = 'device-power-mode'
const POLL_KEY = 'device-poll-interval-sec'

/**
 * The PLATFORM pair — the policy every device runs unless it carries its own
 * override (`Device.powerMode` / `Device.pollIntervalSec`, track 025).
 *
 * Raw on purpose: the caller feeds these to `resolveDevicePolicyForDevice`
 * together with the device's override, and resolution/clamping happens once, in
 * the pure module, rather than twice with a chance of disagreeing.
 *
 * Read through the 5-minute per-instance cache because the first caller is the
 * hardware poll route (~1.3 M/day at fleet scale) and these values change a
 * handful of times a year. The consequence is an asymmetry worth knowing: a
 * PLATFORM change reaches a device within the TTL plus one poll, while a
 * per-device override reaches it on the very next poll — the override rides the
 * device row the route already reads, and must never be moved behind a cache to
 * "match".
 */
export async function getPlatformDevicePolicy(): Promise<{ mode: string; intervalSec: number }> {
  const [mode, intervalSec] = await Promise.all([
    getPreferenceCached(MODE_KEY),
    getPreferenceCached(POLL_KEY),
  ])
  return { mode: String(mode), intervalSec: intervalSec as number }
}

/** The mode currently in effect, resolved through env → DB → default. */
export async function getDevicePowerMode(): Promise<DevicePowerMode> {
  const mode = await getPreference(MODE_KEY)
  // `deep_sleep` is the safe fallback, not the fast one: a device polling every
  // second on a misread value empties its cell in days.
  return isDevicePowerMode(mode) ? mode : 'deep_sleep'
}

/**
 * Re-fit the stored poll interval after a mode change, so the admin never sees
 * a number the fleet is not actually being given. Writes only when the stored
 * value is out of band; silent when there is nothing to do.
 */
async function refitPollInterval(mode: DevicePowerMode, adminUserId?: string): Promise<void> {
  const current = (await getPreference(POLL_KEY)) as number
  const fitted = clampPollInterval(mode, current)
  if (fitted === current) return
  const value = serializePreferenceValue(fitted)
  await prisma.platformPreference.upsert({
    where: { key: POLL_KEY },
    create: { key: POLL_KEY, value, updatedBy: adminUserId ?? null },
    update: { value, updatedBy: adminUserId ?? null },
  })
  clearPreferenceCache()
}

/**
 * Write an override. Admin app only.
 *
 * - `raw = null` deletes the row, so the preference falls back to env/default.
 * - Rejects a value the registry does not accept, with a message for the admin.
 * - Enforces the power-mode band on the poll interval, and re-fits the interval
 *   when the mode changes (see the block above).
 */
export async function setPreference(
  key: PreferenceKey,
  raw: string | null,
  adminUserId?: string,
): Promise<{ status: 'ok' } | { status: 'error'; errors: string[] }> {
  const def = PREFERENCE_REGISTRY[key] as PreferenceDefinition | undefined
  if (!def) return { status: 'error', errors: [`Unknown preference: ${key}`] }

  if (raw === null) {
    await prisma.platformPreference.deleteMany({ where: { key } })
    clearPreferenceCache()
    // Resetting the mode can widen or narrow the band under a stored interval.
    if (key === MODE_KEY) await refitPollInterval(await getDevicePowerMode(), adminUserId)
    return { status: 'ok' }
  }

  const validated = validatePreferenceValue(def, raw)
  if (!validated.ok) return { status: 'error', errors: [validated.error] }

  // Refused rather than silently clamped: the admin asked for a specific
  // cadence, and quietly serving a different one is how a fleet ends up running
  // something nobody chose.
  if (key === POLL_KEY) {
    const mode = await getDevicePowerMode()
    const fits = validatePollInterval(mode, validated.value as number)
    if (!fits.ok) {
      return {
        status: 'error',
        errors: [`${fits.error} Change the power mode first, or save both together.`],
      }
    }
  }

  const value = serializePreferenceValue(validated.value)
  await prisma.platformPreference.upsert({
    where: { key },
    create: { key, value, updatedBy: adminUserId ?? null },
    update: { value, updatedBy: adminUserId ?? null },
  })
  clearPreferenceCache()

  if (key === MODE_KEY && isDevicePowerMode(validated.value)) {
    await refitPollInterval(validated.value, adminUserId)
  }

  return { status: 'ok' }
}

/**
 * Write the device power policy as ONE unit — the mode, and the cadence that has
 * to fit inside it.
 *
 * `setPreference` can still write either key alone (a script, a future API) and
 * re-fits the interval when the mode moves under it. That silent re-fit is right
 * for a caller that only knows about one key, and wrong for the admin form, where
 * the operator can see both: there a mode change that invalidates the cadence must
 * be REFUSED and shown, not quietly corrected to a number nobody chose. The pair is
 * therefore validated together and written in one transaction, so the stored pair
 * is never momentarily inconsistent — the hardware state route reads the two keys
 * independently and could otherwise catch a switched mode beside the old interval.
 */
export async function setDevicePolicy(
  rawMode: string,
  rawInterval: string,
  adminUserId?: string,
): Promise<{ status: 'ok' } | { status: 'error'; errors: string[] }> {
  const modeDef = PREFERENCE_REGISTRY[MODE_KEY] as PreferenceDefinition
  const pollDef = PREFERENCE_REGISTRY[POLL_KEY] as PreferenceDefinition

  // The registry parse comes FIRST and stays lenient — it folds case and
  // separators, so `Light Sleep` from an env var or a script lands on the wire
  // id. The partner surface has no such need (its <select> carries wire ids),
  // which is why only the BAND check below is shared between the two writers,
  // not the parsing. Don't "unify" them.
  const modeResult = validatePreferenceValue(modeDef, rawMode)
  if (!modeResult.ok) return { status: 'error', errors: [modeResult.error] }
  const intervalResult = validatePreferenceValue(pollDef, rawInterval)
  if (!intervalResult.ok) return { status: 'error', errors: [intervalResult.error] }

  // Then the one shared pair rule: this mode, with this cadence — judged against
  // the mode being SAVED, not the stored one, which is the point of the paired
  // write. Same function the partner per-device writer calls, so a refusal reads
  // the same wherever it is triggered.
  const validated = validateDevicePolicy(modeResult.value, intervalResult.value as number)
  if (!validated.ok) return { status: 'error', errors: [validated.error] }
  const { mode, pollAfterSec } = validated

  const modeValue = serializePreferenceValue(mode)
  const pollValue = serializePreferenceValue(pollAfterSec)
  await prisma.$transaction([
    prisma.platformPreference.upsert({
      where: { key: MODE_KEY },
      create: { key: MODE_KEY, value: modeValue, updatedBy: adminUserId ?? null },
      update: { value: modeValue, updatedBy: adminUserId ?? null },
    }),
    prisma.platformPreference.upsert({
      where: { key: POLL_KEY },
      create: { key: POLL_KEY, value: pollValue, updatedBy: adminUserId ?? null },
      update: { value: pollValue, updatedBy: adminUserId ?? null },
    }),
  ])
  clearPreferenceCache()
  return { status: 'ok' }
}

/**
 * Drop both overrides together, so the policy falls back to env/default as a pair.
 * Clearing one alone could leave a stored interval outside the band of the default
 * mode — legal for the reader, which clamps, but a lie on the admin page.
 */
export async function resetDevicePolicy(): Promise<{ status: 'ok' }> {
  await prisma.platformPreference.deleteMany({
    where: { key: { in: [MODE_KEY, POLL_KEY] } },
  })
  clearPreferenceCache()
  return { status: 'ok' }
}

/** Everything the admin UI renders for one preference. */
export interface PreferenceAdminRow {
  key: PreferenceKey
  type: PreferenceDefinition['type']
  label: string
  description: string
  group: string
  unit: string | null
  /** Bounds for a number preference, for the input and the hint text. */
  min: number | null
  max: number | null
  maxLength: number | null
  /** Choices for an enum preference, in registry order. */
  options: readonly { value: string; label: string }[] | null
  default: number | boolean | string
  /** The raw stored override, or null when no row exists. */
  dbValue: string | null
  /** The env override in effect, or null. Wins over the DB row. */
  envValue: string | null
  resolved: number | boolean | string
  source: PreferenceSource
  updatedAt: Date | null
  updatedBy: string | null
}

export async function getPreferenceAdminRows(): Promise<PreferenceAdminRow[]> {
  let rows: { key: string; value: string; updatedAt: Date; updatedBy: string | null }[] = []
  try {
    rows = await prisma.platformPreference.findMany({
      select: { key: true, value: true, updatedAt: true, updatedBy: true },
    })
  } catch {
    rows = []
  }
  const byKey = new Map(rows.map((r) => [r.key, r]))

  // Resolved once up front: the poll interval's `resolved` is reported as what
  // a DEVICE would actually be served, which the band can move. An admin page
  // showing 60 while the fleet runs 30 would be a lie in the one place an
  // operator goes to find out what the fleet is doing.
  const modeRaw = resolvePreference(
    PREFERENCE_REGISTRY[MODE_KEY] as PreferenceDefinition,
    byKey.get(MODE_KEY)?.value ?? null,
  ).value
  const activeMode: DevicePowerMode = isDevicePowerMode(modeRaw) ? modeRaw : 'deep_sleep'

  return Object.values(PREFERENCE_REGISTRY).map((raw) => {
    const def = raw as PreferenceDefinition
    const row = byKey.get(def.key)
    const envRaw = process.env[envVarForPreference(def.key)]
    const envAccepted = parsePreferenceValue(def, envRaw)
    const resolvedRaw = resolvePreference(def, row?.value ?? null)
    const source = resolvedRaw.source
    const value =
      def.key === POLL_KEY
        ? clampPollInterval(activeMode, resolvedRaw.value as number)
        : resolvedRaw.value

    return {
      key: def.key as PreferenceKey,
      type: def.type,
      label: def.label,
      description: def.description,
      group: def.group,
      unit: def.type === 'number' ? (def.unit ?? null) : null,
      min: def.type === 'number' ? def.min : null,
      max: def.type === 'number' ? def.max : null,
      maxLength: def.type === 'string' ? def.maxLength : null,
      options: def.type === 'enum' ? def.options : null,
      default: def.default,
      dbValue: row?.value ?? null,
      envValue: envAccepted === undefined ? null : String(envRaw).trim(),
      resolved: value,
      source,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    }
  })
}

/** For the loader path that wants every value at once (rare — most want one). */
export async function getPreferences(): Promise<
  Record<PreferenceKey, number | boolean | string>
> {
  const overrides = await loadOverrides()
  const out = {} as Record<PreferenceKey, number | boolean | string>
  for (const raw of Object.values(PREFERENCE_REGISTRY)) {
    const def = raw as PreferenceDefinition
    out[def.key as PreferenceKey] = resolvePreference(def, overrides.get(def.key)).value
  }
  return out
}
