/**
 * Feature Flags
 *
 * The `FLAG_REGISTRY` below is the single source of truth for which flags
 * exist and their per-environment defaults. Each flag is resolved in this
 * order (first match wins):
 *
 *   1. Sudo bypass — sudo users always see flagged features (off by default;
 *      enable per call via `getFlagStates({ isSudo: true })`).
 *   2. Environment variable override — `FF_<UPPER_SNAKE_NAME>=true|false`.
 *      Useful for forcing a state in a specific deployment without a DB row.
 *   3. PER-CUSTOMER row in `account_feature_flag` — the answer to "does THIS
 *      operator have it", set in the admin app. Beats the global row, because a
 *      customer-specific decision is more specific than a platform-wide one.
 *   4. Database row in `feature_flag` table — toggled at runtime via the
 *      admin app.
 *   5. Static default for the current environment (production/test/preview/
 *      development), determined from `VERCEL_ENV` (with `NODE_ENV` fallback).
 *
 * Adding a flag: append an entry to `FLAG_REGISTRY`. That's it. The admin UI
 * will list it automatically.
 *
 * Removing a flag: delete the entry. The DB row (if any) is harmless and
 * will be ignored. Clean it up if you want.
 *
 * Import as `@repo/data/flags`.
 */

import prisma from '../index'

export type FlagEnvironment = 'development' | 'preview' | 'test' | 'production'

export interface FlagDefinition {
  /** Stable identifier — used in code, env vars, and DB rows. */
  name: string
  /** Human description shown in the admin UI. */
  description: string
  /** Per-environment defaults if no DB or env override is set. */
  defaults: Record<FlagEnvironment, boolean>
}

/**
 * The canonical list of feature flags. Add new flags here.
 *
 * Naming: lowercase, hyphen-separated. The env-var override looks for
 * `FF_<UPPER_SNAKE_CASE>` — e.g. `restaurants` → `FF_RESTAURANTS`,
 * `new-checkout-flow` → `FF_NEW_CHECKOUT_FLOW`.
 */
export const FLAG_REGISTRY = {
  devices: {
    name: 'devices',
    description:
      'Sunbed indicator devices (partner /devices fleet list, location assignment). Per-customer: enable for operators who actually have hardware.',
    defaults: {
      development: true,
      preview: true,
      test: false,
      production: false,
    },
  },
  restaurants: {
    name: 'restaurants',
    description:
      'Restaurant table reservations (partner menu/tables/reservations pages, user table booking, restaurant availability API).',
    defaults: {
      development: true,
      preview: true,
      test: false,
      production: false,
    },
  },
} as const satisfies Record<string, FlagDefinition>

export type FlagName = keyof typeof FLAG_REGISTRY

/**
 * Possible reasons a flag resolved to its current value. Useful for the
 * admin UI to show why a flag is on/off.
 */
export type FlagSource = 'sudo' | 'env' | 'account' | 'db' | 'default'

export interface FlagState {
  name: FlagName
  enabled: boolean
  source: FlagSource
}

export type FlagStates = Record<FlagName, FlagState>

// ─── Pure helpers ───────────────────────────────────────────────────────────

export function currentFlagEnvironment(): FlagEnvironment {
  const vercel = process.env.VERCEL_ENV
  if (vercel === 'production') return 'production'
  if (vercel === 'preview') return 'preview'
  if (vercel === 'development') return 'development'

  const node = process.env.NODE_ENV
  if (node === 'production') return 'production'
  if (node === 'test') return 'test'
  return 'development'
}

export function envVarForFlag(name: string): string {
  return `FF_${name.toUpperCase().replace(/-/g, '_')}`
}

export function readEnvOverride(name: string): boolean | undefined {
  const raw = process.env[envVarForFlag(name)]
  if (raw === undefined) return undefined
  const v = raw.trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false
  return undefined
}

export function defaultForEnvironment(
  def: FlagDefinition,
  env: FlagEnvironment = currentFlagEnvironment(),
): boolean {
  return def.defaults[env]
}

/**
 * Resolve a single flag given the available inputs. Pure — pass DB rows in,
 * get a state out. Used internally by `getFlagStates`; exposed for testing.
 */
export function resolveFlag(
  def: FlagDefinition,
  options: {
    accountOverride?: boolean
    dbOverride?: boolean
    isSudo?: boolean
    environment?: FlagEnvironment
  } = {},
): FlagState {
  const { accountOverride, dbOverride, isSudo, environment } = options

  if (isSudo) {
    return { name: def.name as FlagName, enabled: true, source: 'sudo' }
  }
  const envOverride = readEnvOverride(def.name)
  if (envOverride !== undefined) {
    return { name: def.name as FlagName, enabled: envOverride, source: 'env' }
  }
  // A per-customer decision is more specific than a platform-wide one.
  if (accountOverride !== undefined) {
    return { name: def.name as FlagName, enabled: accountOverride, source: 'account' }
  }
  if (dbOverride !== undefined) {
    return { name: def.name as FlagName, enabled: dbOverride, source: 'db' }
  }
  return {
    name: def.name as FlagName,
    enabled: defaultForEnvironment(def, environment),
    source: 'default',
  }
}

// ─── DB-aware API ───────────────────────────────────────────────────────────

/**
 * Fetch all flags from the DB at once. Returns a map of name → enabled.
 * The DB call is small and indexed by primary key, so this is one cheap
 * query per request. Wrap with `React.cache` at the app layer to dedupe
 * across server components in a single render.
 */
async function loadDbOverrides(): Promise<Map<string, boolean>> {
  try {
    const rows = await prisma.featureFlag.findMany({
      select: { name: true, enabled: true },
    })
    return new Map(rows.map((r) => [r.name, r.enabled]))
  } catch {
    // If the table doesn't exist yet (e.g. local DB without migrations) fall
    // back to defaults rather than crashing the page.
    return new Map()
  }
}

/** Per-customer overrides. Same tolerance as the global loader: a missing table
 *  (a DB without this migration) falls back to defaults rather than crashing. */
async function loadAccountOverrides(accountId: string): Promise<Map<string, boolean>> {
  try {
    const rows = await prisma.accountFeatureFlag.findMany({
      where: { accountId },
      select: { name: true, enabled: true },
    })
    return new Map(rows.map((r) => [r.name, r.enabled]))
  } catch {
    return new Map()
  }
}

export async function getFlagStates(
  options: { isSudo?: boolean; accountId?: string } = {},
): Promise<FlagStates> {
  const env = currentFlagEnvironment()
  const [overrides, accountOverrides] = await Promise.all([
    loadDbOverrides(),
    options.accountId ? loadAccountOverrides(options.accountId) : Promise.resolve(new Map()),
  ])
  const result = {} as FlagStates
  for (const def of Object.values(FLAG_REGISTRY)) {
    result[def.name as FlagName] = resolveFlag(def, {
      accountOverride: accountOverrides.get(def.name),
      dbOverride: overrides.get(def.name),
      isSudo: options.isSudo,
      environment: env,
    })
  }
  return result
}

export async function isFlagEnabled(
  name: FlagName,
  options: { isSudo?: boolean } = {},
): Promise<boolean> {
  const states = await getFlagStates(options)
  return states[name]?.enabled ?? false
}

/**
 * Upsert a runtime override for a flag. Use from the admin app only.
 *
 * - `enabled = null` removes the row so the flag falls back to env/default.
 * - `adminUserId` is recorded for audit; pass the session user id.
 */
export async function setFlagOverride(
  name: FlagName,
  enabled: boolean | null,
  adminUserId?: string,
): Promise<void> {
  const def = FLAG_REGISTRY[name]
  if (!def) throw new Error(`Unknown flag: ${name}`)

  if (enabled === null) {
    await prisma.featureFlag.deleteMany({ where: { name } })
    return
  }

  await prisma.featureFlag.upsert({
    where: { name },
    create: {
      name,
      description: def.description,
      enabled,
      updatedBy: adminUserId ?? null,
    },
    update: {
      enabled,
      description: def.description,
      updatedBy: adminUserId ?? null,
    },
  })
}

/**
 * For the admin UI: combine the static registry, current DB rows, and
 * resolved state into a single payload that's easy to render.
 */
export interface FlagAdminRow {
  name: FlagName
  description: string
  defaults: Record<FlagEnvironment, boolean>
  currentEnvironment: FlagEnvironment
  dbOverride: boolean | null
  envOverride: boolean | null
  resolved: boolean
  source: FlagSource
  updatedAt: Date | null
  updatedBy: string | null
}

export async function getFlagAdminRows(): Promise<FlagAdminRow[]> {
  const env = currentFlagEnvironment()
  let rows: { name: string; enabled: boolean; updatedAt: Date; updatedBy: string | null }[] = []
  try {
    rows = await prisma.featureFlag.findMany({
      select: { name: true, enabled: true, updatedAt: true, updatedBy: true },
    })
  } catch {
    rows = []
  }
  const byName = new Map(rows.map((r) => [r.name, r]))

  return Object.values(FLAG_REGISTRY).map((def) => {
    const dbRow = byName.get(def.name)
    const dbOverride = dbRow?.enabled ?? null
    const envOverrideRaw = readEnvOverride(def.name)
    const envOverride = envOverrideRaw === undefined ? null : envOverrideRaw
    const state = resolveFlag(def, {
      dbOverride: dbOverride ?? undefined,
      environment: env,
    })
    return {
      name: def.name as FlagName,
      description: def.description,
      defaults: def.defaults,
      currentEnvironment: env,
      dbOverride,
      envOverride,
      resolved: state.enabled,
      source: state.source,
      updatedAt: dbRow?.updatedAt ?? null,
      updatedBy: dbRow?.updatedBy ?? null,
    }
  })
}

// ─── Per-customer overrides (admin) ─────────────────────────────────────────

/** Every per-customer override for one account — what the admin UI edits. */
export async function listAccountFlags(accountId: string) {
  return prisma.accountFeatureFlag.findMany({
    where: { accountId },
    select: { name: true, enabled: true, updatedAt: true, updatedBy: true },
    orderBy: { name: 'asc' },
  })
}

/**
 * Turn a flag on or off FOR ONE CUSTOMER. Upsert rather than insert: setting it
 * twice is the same as setting it once, which is what an admin toggling a
 * switch expects.
 */
export async function setAccountFlag(
  accountId: string,
  name: string,
  enabled: boolean,
  updatedBy?: string,
) {
  return prisma.accountFeatureFlag.upsert({
    where: { accountId_name: { accountId, name } },
    create: { accountId, name, enabled, updatedBy },
    update: { enabled, updatedBy },
  })
}

/**
 * Drop the per-customer decision so the account falls back to the global flag.
 * Deliberately distinct from setting it to `false`: "no opinion" and "explicitly
 * off for this customer" resolve the same today but mean different things, and
 * only one of them survives a change to the global default.
 */
export async function clearAccountFlag(accountId: string, name: string) {
  await prisma.accountFeatureFlag.deleteMany({ where: { accountId, name } })
}
