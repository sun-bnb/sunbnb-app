/**
 * Mock for `@repo/data/preferences`.
 *
 * The real module imports the Prisma client, which unit tests must not
 * instantiate. Resolution, bounds and fallback behaviour are covered where they
 * live (`packages/data/src/preferences.test.ts`); what the app-side tests assert
 * is that a route serves whatever this module resolves — so the default here is
 * the registry default, and a test that cares overrides it per call.
 */
import { vi } from 'vitest'

/** Registry defaults, keyed as in `PREFERENCE_REGISTRY`. */
const DEFAULTS: Record<string, number | boolean | string> = {
  'device-poll-interval-sec': 60,
}

export const getPreference = vi.fn(async (key: string) => DEFAULTS[key])
export const getPreferenceCached = vi.fn(async (key: string) => DEFAULTS[key])
export const getPreferences = vi.fn(async () => ({ ...DEFAULTS }))
export const setPreference = vi.fn(async () => ({ status: 'ok' as const }))
export const getPreferenceAdminRows = vi.fn(async () => [])
export const clearPreferenceCache = vi.fn()
