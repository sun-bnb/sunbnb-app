/**
 * Viva.com Cloud Terminal ISV client — entry point (track 024, W8, packet A1).
 *
 * `getVivaClient()` is the ONE place that decides stub vs real HTTP, so
 * callers (packet A2's `collect.start` card effect, and any dev/admin tooling)
 * never branch on env themselves.
 *
 * Mode resolution:
 *  - `VIVA_MODE=stub`            → stub, always.
 *  - `VIVA_MODE=http`            → real client, always (throws if creds missing).
 *  - unset, `VIVA_ISV_CLIENT_ID` set     → real client.
 *  - unset, no `VIVA_ISV_CLIENT_ID`      → stub (the whole-team-can-develop-
 *    without-credentials default).
 *
 * Real-client config, only read when mode resolves to `http`:
 *  - `VIVA_ENV`               → `'demo'` (default) | `'production'`.
 *  - `VIVA_ISV_CLIENT_ID`, `VIVA_ISV_CLIENT_SECRET` → client-credentials pair.
 *  - `VIVA_ISV_SOURCE_CODE`   → ISV Partner source code applied to every sale.
 *
 * `getVivaAccountsClient()` (packet A2) follows the identical mode/env
 * resolution for the ISV connected-accounts client (`accounts.ts`) — the
 * merchant-onboarding leg, separate from the sale-session leg above.
 */

import { createStubVivaClient } from './stub-client'
import { createVivaHttpClient } from './http-client'
import { createStubVivaAccountsClient, createVivaAccountsHttpClient } from './accounts'
import type { VivaClient, VivaEnv, VivaIsvConfig } from './types'
import type { VivaAccountsClient } from './accounts'

export * from './types'
export * from './refs'
export { createVivaHttpClient, VivaApiError, toCents, resetVivaTokenCacheForTests } from './http-client'
export { createStubVivaClient, stubState, DEFAULT_RESOLVE_AFTER_MS } from './stub-client'
export * from './accounts'

type VivaMode = 'stub' | 'http'

function resolveMode(): VivaMode {
  const explicit = process.env.VIVA_MODE
  if (explicit === 'stub') return 'stub'
  if (explicit === 'http') return 'http'
  return process.env.VIVA_ISV_CLIENT_ID ? 'http' : 'stub'
}

function configFromEnv(): VivaIsvConfig {
  const clientId = process.env.VIVA_ISV_CLIENT_ID
  const clientSecret = process.env.VIVA_ISV_CLIENT_SECRET
  const sourceCode = process.env.VIVA_ISV_SOURCE_CODE
  if (!clientId || !clientSecret || !sourceCode) {
    throw new Error(
      'VIVA_ISV_CLIENT_ID, VIVA_ISV_CLIENT_SECRET and VIVA_ISV_SOURCE_CODE are all required to build the real Viva client. Set VIVA_MODE=stub to develop without Viva credentials.',
    )
  }
  const env: VivaEnv = process.env.VIVA_ENV === 'production' ? 'production' : 'demo'
  return { clientId, clientSecret, sourceCode, env }
}

/**
 * Get a `VivaClient` for the current process's configuration. Cheap to call
 * repeatedly — the token cache (http) and session store (stub) are both
 * module-level, so this never needs to be memoized by the caller.
 */
export function getVivaClient(): VivaClient {
  if (resolveMode() === 'stub') {
    const resolveAfterMs = process.env.VIVA_STUB_RESOLVE_AFTER_MS
      ? Number(process.env.VIVA_STUB_RESOLVE_AFTER_MS)
      : undefined
    return createStubVivaClient(resolveAfterMs !== undefined ? { resolveAfterMs } : undefined)
  }
  return createVivaHttpClient(configFromEnv())
}

/**
 * Get a `VivaAccountsClient` (ISV connected-accounts — merchant onboarding,
 * packet A2) for the current process's configuration. Same mode resolution
 * and env vars as `getVivaClient()` — there is deliberately only ONE Viva
 * mode switch, not two, so a dev/test session can't end up with the sale
 * client stubbed and the accounts client hitting the real API (or vice
 * versa) by forgetting to set a second flag.
 */
export function getVivaAccountsClient(): VivaAccountsClient {
  if (resolveMode() === 'stub') {
    return createStubVivaAccountsClient()
  }
  return createVivaAccountsHttpClient(configFromEnv())
}
