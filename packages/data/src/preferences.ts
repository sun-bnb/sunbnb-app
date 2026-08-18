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

export type PreferenceDefinition =
  | NumberPreference
  | BooleanPreference
  | StringPreference

/**
 * The canonical list of platform preferences. Add new entries here — the admin
 * UI lists them automatically, grouped by `group`.
 *
 * Naming: lowercase, hyphen-separated. The env override looks for
 * `PREF_<UPPER_SNAKE_CASE>` — e.g. `device-poll-interval-sec` →
 * `PREF_DEVICE_POLL_INTERVAL_SEC`.
 */
export const PREFERENCE_REGISTRY = {
  'device-poll-interval-sec': {
    key: 'device-poll-interval-sec',
    type: 'number',
    label: 'Device poll interval',
    group: 'Hardware',
    description:
      'How often a sunbed indicator device asks the server for seat state, in seconds. Served as `pollAfterSec` on every 200 from /api/hw/{code}/state; firmware obeys it and never hardcodes an interval. Lower = a light that flips sooner, more serverless invocations and more battery; higher = the reverse. A change reaches a device on its next poll (the value is part of the response ETag, so it busts the 304 that would otherwise hide it).',
    default: 60,
    min: 10,
    max: 3600,
    unit: 'seconds',
  },
} as const satisfies Record<string, PreferenceDefinition>

export type PreferenceKey = keyof typeof PREFERENCE_REGISTRY

/** The value type of one registry entry, so callers keep number/boolean/string. */
export type PreferenceValue<K extends PreferenceKey> =
  (typeof PREFERENCE_REGISTRY)[K]['default']

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

/**
 * Write an override. Admin app only.
 *
 * - `raw = null` deletes the row, so the preference falls back to env/default.
 * - Rejects a value the registry does not accept, with a message for the admin.
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
    return { status: 'ok' }
  }

  const validated = validatePreferenceValue(def, raw)
  if (!validated.ok) return { status: 'error', errors: [validated.error] }

  const value = serializePreferenceValue(validated.value)
  await prisma.platformPreference.upsert({
    where: { key },
    create: { key, value, updatedBy: adminUserId ?? null },
    update: { value, updatedBy: adminUserId ?? null },
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

  return Object.values(PREFERENCE_REGISTRY).map((raw) => {
    const def = raw as PreferenceDefinition
    const row = byKey.get(def.key)
    const envRaw = process.env[envVarForPreference(def.key)]
    const envAccepted = parsePreferenceValue(def, envRaw)
    const { value, source } = resolvePreference(def, row?.value ?? null)

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
