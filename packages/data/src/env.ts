/**
 * Shared environment helpers.
 *
 * Single source of truth for determining which environment the app is
 * running in.  Works on both server and client:
 *
 *   Server  → reads VERCEL_ENV directly (set by Vercel at runtime/build)
 *   Client  → reads NEXT_PUBLIC_APP_ENV (wired in each app's next.config.mjs
 *             to mirror VERCEL_ENV, falling back to 'development' locally)
 *
 * Values: 'production' | 'preview' | 'development'
 */

export type AppEnv = 'production' | 'preview' | 'development'

/**
 * Return the current application environment.
 *
 *   - 'production'  – Vercel production deployment
 *   - 'preview'     – Vercel preview deployment (test)
 *   - 'development' – local dev (default)
 */
export function getAppEnv(): AppEnv {
  const raw =
    process.env.VERCEL_ENV ||            // available server-side on Vercel
    process.env.NEXT_PUBLIC_APP_ENV ||    // available client-side (set in next.config.mjs)
    'development'
  return raw as AppEnv
}

/**
 * True for every environment except production.
 * Used to toggle Mollie testmode, feature flags, etc.
 */
export function isTestMode(): boolean {
  return getAppEnv() !== 'production'
}

/** Short badge labels shown in the app header for non-production envs. */
const ENV_LABELS: Record<string, string> = {
  development: 'DEV',
  preview: 'TEST',
}

/**
 * Return a short label for the current environment, or `null` in production
 * (where no badge should be displayed).
 */
export function getEnvLabel(): string | null {
  return ENV_LABELS[getAppEnv()] ?? null
}
