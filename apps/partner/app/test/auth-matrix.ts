/**
 * Auth-matrix runner — Phase 0.2 of the partner test-architecture track.
 *
 * `SCENARIOS` maps each GateType to a list of named scenarios with an
 * apply() function (drives mocks) and a shouldReject flag.
 *
 * `runAuthMatrix(entry)` emits one it() per scenario, calling entry.invoke()
 * and asserting the result shape.
 *
 * Reject/ok predicate for 'action' kind:
 *   reject → result.status === 'error'
 *   ok     → result.status === 'ok' (or anything that is NOT 'error')
 *
 * For 'route' kind (registered for completeness; no entries this packet):
 *   reject → response.status >= 400
 *   ok     → response.status < 400
 *
 * IMPORTANT: the matrix drives prisma + auth mocks directly (no mock of
 * lib/auth-helpers) so the real gate implementations execute — that is what
 * allows the matrix to surface divergences between verifySiteOwnership and
 * verifySiteAccess.
 *
 * Unit-mode blind spot: the Prisma where clause filter (hasSome / has) is
 * NOT executed in unit-mode — prisma.securityToken.findUnique is a vi.fn()
 * that returns whatever we tell it to. applyExpiredToken / applyWrongScopeToken
 * therefore return null from findUnique (simulating Prisma filtering them out)
 * rather than returning the row and trusting the where clause. This is the
 * documented unit-mode blind spot; closed in Phase 0.2b via an integration test.
 */

import { it, expect } from 'vitest'
import type { GatedAction, GateType } from './gated-actions'
import {
  applyUnauthenticated,
  applyNonOwnerSession,
  applyOwnerSession,
  applyValidToken,
  applyExpiredToken,
  applyWrongScopeToken,
  applyForeignSiteToken,
  applyRestaurantNonOwnerSession,
  applyRestaurantOwnerSession,
  TOKENS,
} from './token-fixtures'

// ─── Scenario type ────────────────────────────────────────────────────────────

interface Scenario {
  /** Human label — appears in the it() description */
  label: string
  /** Apply mocks for this scenario */
  apply: () => void
  /** Expected outcome */
  shouldReject: boolean
  /**
   * For token-or-session actions: the accessKey to pass into invoke().
   * Undefined means the session path (no accessKey argument).
   */
  accessKey?: string
}

// ─── Scenario sets ────────────────────────────────────────────────────────────

export const SCENARIOS: Record<GateType, Scenario[]> = {
  'session-owner': [
    {
      label: 'unauthenticated → reject',
      apply: applyUnauthenticated,
      shouldReject: true,
    },
    {
      label: 'non-owner session → reject',
      apply: applyNonOwnerSession,
      shouldReject: true,
    },
    {
      label: 'owner session → ok',
      apply: applyOwnerSession,
      shouldReject: false,
    },
  ],

  'token-or-session': [
    // Session-path scenarios (no accessKey)
    {
      label: 'unauthenticated (no token, no session) → reject',
      apply: applyUnauthenticated,
      shouldReject: true,
      accessKey: undefined,
    },
    {
      label: 'non-owner session (no token) → reject',
      apply: applyNonOwnerSession,
      shouldReject: true,
      accessKey: undefined,
    },
    {
      label: 'owner session (no token) → ok',
      apply: applyOwnerSession,
      shouldReject: false,
      accessKey: undefined,
    },
    // Token-path scenarios (accessKey supplied)
    {
      label: 'valid token → ok',
      apply: applyValidToken,
      shouldReject: false,
      accessKey: TOKENS.valid.key,
    },
    {
      label: 'expired token → reject',
      apply: applyExpiredToken,
      shouldReject: true,
      accessKey: TOKENS.expired.key,
    },
    {
      label: 'wrong-scope token → reject',
      apply: applyWrongScopeToken,
      shouldReject: true,
      accessKey: TOKENS.wrongScope.key,
    },
    {
      label: 'foreign-site token (wrong owner) → reject',
      apply: applyForeignSiteToken,
      shouldReject: true,
      accessKey: TOKENS.foreign.key,
    },
  ],

  'restaurant-owner': [
    {
      label: 'unauthenticated → reject',
      apply: applyUnauthenticated,
      shouldReject: true,
    },
    {
      label: 'non-owner session → reject',
      // applyRestaurantNonOwnerSession: authenticated as OWNER_ID but restaurant
      // is owned by OTHER_USER_ID — requireRestaurantOwner rejects via partnerAccountId check.
      apply: applyRestaurantNonOwnerSession,
      shouldReject: true,
    },
    {
      label: 'owner session → ok',
      // applyRestaurantOwnerSession: authenticated as OWNER_ID and restaurant is
      // owned by OWNER_ID. Uses mockResolvedValue (persistent) so that both the
      // partner-level and core-level requireRestaurantOwner calls are satisfied.
      // FF_RESTAURANTS flag is enabled globally in auth-matrix.test.ts setup.
      apply: applyRestaurantOwnerSession,
      shouldReject: false,
    },
  ],

  // cron and signature gates: leave as registry-only gate types.
  // Their existing route tests are adequate (per Phase 0.2 settled design).
  // The matrix runner does not emit it() for these; they are in the type for
  // completeness and will be read by the 0.3 coverage-contract.
  cron: [],
  signature: [],
}

// ─── Auth error messages ──────────────────────────────────────────────────────

/**
 * The set of error messages emitted by the auth-gate helpers.
 * Used to distinguish auth rejections from downstream (post-auth) errors.
 *
 * verifySiteOwnership / verifySiteAccess / requireSiteOwner emit:
 *   'Not authenticated' — no session, no token
 *   'Not authorized'    — session exists but wrong owner
 *   'Invalid or expired access key' — token not found / expired / wrong scope
 *
 * requireRestaurantOwner / requireRestaurantOwnerWithFlag emit the same messages.
 * 'feature_disabled' is also an auth-gate outcome (flag off before ownership check)
 * but is excluded from this set since the flag is always enabled in the matrix setup.
 */
const AUTH_ERROR_MESSAGES = new Set([
  'Not authenticated',
  'Not authorized',
  'Invalid or expired access key',
])

// ─── Predicate helpers ────────────────────────────────────────────────────────

/**
 * Assert the action was rejected by the auth gate.
 * We check both that status='error' AND that at least one auth error message
 * appears in the errors array. This prevents a downstream error (e.g. "Booking
 * not found") from falsely satisfying the reject assertion.
 */
function assertReject(result: unknown, label: string): void {
  const r = result as { status?: string; errors?: string[] }
  expect(
    r?.status,
    `[${label}] expected status 'error' but got '${r?.status}'`
  ).toBe('error')

  const hasAuthError = (r?.errors ?? []).some((e) => AUTH_ERROR_MESSAGES.has(e))
  expect(
    hasAuthError,
    `[${label}] status is 'error' but no auth error message found in errors: ${JSON.stringify(r?.errors)}. ` +
      `This may be a downstream error, not an auth rejection.`
  ).toBe(true)
}

/**
 * Assert the action was NOT rejected by the auth gate.
 * We check that no auth error message appears in the errors array.
 * The action may still return status='error' for downstream reasons (e.g.
 * "Reservation not found") — those are not auth failures and don't fail this.
 */
function assertOk(result: unknown, label: string): void {
  const r = result as { status?: string; errors?: string[] }
  const hasAuthError = (r?.errors ?? []).some((e) => AUTH_ERROR_MESSAGES.has(e))
  expect(
    hasAuthError,
    `[${label}] auth gate rejected the request — errors: ${JSON.stringify(r?.errors)}`
  ).toBe(false)
}

// ─── Matrix runner ────────────────────────────────────────────────────────────

/**
 * Emit one `it()` per scenario for the given registry entry.
 *
 * Call this inside a `describe(entry.name, () => runAuthMatrix(entry))` block.
 * The vitest mock environment is already set up by the test file's global
 * vi.mock() calls; apply() drives the per-scenario mock state.
 */
export function runAuthMatrix(entry: GatedAction): void {
  const scenarios = SCENARIOS[entry.gate]

  for (const scenario of scenarios) {
    it(scenario.label, async () => {
      scenario.apply()
      const result = await entry.invoke(scenario.accessKey)

      if (scenario.shouldReject) {
        assertReject(result, `${entry.name} / ${scenario.label}`)
      } else {
        assertOk(result, `${entry.name} / ${scenario.label}`)
      }
    })
  }
}
