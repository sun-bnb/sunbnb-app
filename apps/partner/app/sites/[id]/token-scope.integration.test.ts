/**
 * Integration test: SecurityToken scope-filter unified policy (Phase 3 fix)
 *
 * PURPOSE
 * -------
 * Unit-mode mocks (PrismaCient mock) return a canned row regardless of the
 * `where` clause, so they cannot distinguish the Postgres array operators used
 * by the token gate. This file exercises the real Prisma query against
 * sunbnb_test to confirm the unified policy holds end-to-end.
 *
 * UNIFIED POLICY (decided Phase 3)
 * ---------------------------------
 * `manage_site` authorises BOTH the manage page AND the orders dashboard.
 * There is now one canonical gate: `verifySiteAccess` in `lib/auth-helpers.ts`,
 * using `resources: { hasSome: ['all', 'manage_site'] }`.
 *
 * `manage/actions.ts` `verifySiteOwnership` is a thin wrapper that delegates to
 * `verifySiteAccess` — there is no longer a second independent implementation.
 *
 * REPRESENTATIVE ACTIONS CHOSEN
 * ------------------------------
 * - manage gate: `blockBed` from app/sites/[id]/manage/actions.ts
 *     Delegates to verifySiteAccess (hasSome ['all', 'manage_site'])
 *     Creates a blocked reservation on success.
 *
 * - orders gate: `getOrders` from app/sites/[id]/orders/actions.ts
 *     Uses verifySiteAccess directly (hasSome ['all', 'manage_site'])
 *     Read-only, returns [] when no orders exist.
 *
 * TESTS
 * -----
 * GREEN — ['all']-scoped token accepted by BOTH gates.
 * GREEN — Expired token rejected by BOTH gates.
 * GREEN — Foreign-site token (owner mismatch) rejected by BOTH gates.
 * GREEN — ['manage_site']-only token ACCEPTED by BOTH gates (unified policy).
 * GREEN — ['orders_only']-scoped token (wrong scope) rejected by BOTH gates.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestSecurityToken,
} from '@/app/test/fixtures'

// ---------------------------------------------------------------------------
// Mocks — auth null (token path only) + next/cache
// ---------------------------------------------------------------------------

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import actions AFTER mocks so vi.mock hoisting takes effect
// ---------------------------------------------------------------------------

import { blockBed } from './manage/actions'
import { getOrders } from './orders/actions'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await cleanDatabase()
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns whether a gate call succeeded (token accepted) or was rejected.
 * manage: blockBed returns { status: 'ok' } on success; { status: 'error' } on auth failure.
 * orders: getOrders returns { status: 'ok' } on success; { status: 'error' } on auth failure.
 *
 * We distinguish auth errors from downstream errors via the error message set
 * that verifySiteAccess emits.
 */
const AUTH_ERROR_MESSAGES = new Set([
  'Invalid or expired access key',
  'Not authorized',
  'Not authenticated',
])

function wasAccepted(result: { status: string; errors?: string[] }): boolean {
  if (result.status === 'ok') return true
  if (result.errors?.some((e) => AUTH_ERROR_MESSAGES.has(e))) return false
  // Non-auth error (e.g. downstream) — treat as accepted (gate passed)
  return true
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecurityToken scope filter — unified policy (real DB)', () => {
  it("['all']-scoped unexpired token is accepted by both manage gate and orders gate", async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    const token = await createTestSecurityToken(owner.id, ['all'])

    const manageResult = await blockBed(site.id, item.id, 'scope test', token.id, false)
    const ordersResult = await getOrders(site.id, 'incoming', token.id)

    expect(wasAccepted(manageResult)).toBe(true)
    expect(wasAccepted(ordersResult)).toBe(true)
  })

  it('expired token is rejected by both gates', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    // expiresOffsetMs negative = already expired
    const token = await createTestSecurityToken(owner.id, ['all'], -60_000)

    const manageResult = await blockBed(site.id, item.id, 'scope test', token.id, false)
    const ordersResult = await getOrders(site.id, 'incoming', token.id)

    expect(wasAccepted(manageResult)).toBe(false)
    expect(wasAccepted(ordersResult)).toBe(false)
  })

  it('foreign-site token (owner mismatch) is rejected by both gates', async () => {
    const owner = await createTestUser()
    const stranger = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    // Token belongs to stranger, not owner — ownership linkage check should reject
    const token = await createTestSecurityToken(stranger.id, ['all'])

    const manageResult = await blockBed(site.id, item.id, 'scope test', token.id, false)
    const ordersResult = await getOrders(site.id, 'incoming', token.id)

    expect(wasAccepted(manageResult)).toBe(false)
    expect(wasAccepted(ordersResult)).toBe(false)
  })

  it("['manage_site']-only token is accepted by BOTH manage gate AND orders gate (unified policy)", async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    // manage_site scope only — must now be accepted by both gates under the unified policy
    const token = await createTestSecurityToken(owner.id, ['manage_site'])

    const manageResult = await blockBed(site.id, item.id, 'scope test', token.id, false)
    const ordersResult = await getOrders(site.id, 'incoming', token.id)

    expect(wasAccepted(manageResult)).toBe(true)
    expect(wasAccepted(ordersResult)).toBe(true)
  })

  it("['orders_only']-scoped token (wrong scope) is rejected by both gates", async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    // A scope that is neither 'all' nor 'manage_site' — rejected by hasSome filter
    const token = await createTestSecurityToken(owner.id, ['orders_only'])

    const manageResult = await blockBed(site.id, item.id, 'scope test', token.id, false)
    const ordersResult = await getOrders(site.id, 'incoming', token.id)

    expect(wasAccepted(manageResult)).toBe(false)
    expect(wasAccepted(ordersResult)).toBe(false)
  })
})
