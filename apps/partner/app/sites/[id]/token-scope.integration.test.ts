/**
 * Integration test: SecurityToken scope-filter divergence (Phase 0.2b)
 *
 * PURPOSE
 * -------
 * Unit-mode mocks (PrismaCient mock) return a canned row regardless of the
 * `where` clause, so they cannot distinguish:
 *   - verifySiteOwnership (manage/actions.ts): resources: { hasSome: ['all', 'manage_site'] }
 *   - verifySiteAccess    (lib/auth-helpers.ts): resources: { has: 'all' }
 *
 * A `manage_site`-only token satisfies hasSome but NOT has, so it is accepted
 * by manage actions and rejected by orders actions. This file exercises the
 * real Prisma query against sunbnb_test to confirm the Postgres array operators
 * behave as expected — giving the query-side filter the real DB coverage that
 * unit-mode mocks cannot provide.
 *
 * REPRESENTATIVE ACTIONS CHOSEN
 * ------------------------------
 * - manage gate: `blockBed` from app/sites/[id]/manage/actions.ts
 *     Uses verifySiteOwnership (resources: { hasSome: ['all', 'manage_site'] })
 *     Cheap: needs a site + 1 inventory item; creates a blocked reservation on success.
 *
 * - orders gate: `getOrders` from app/sites/[id]/orders/actions.ts
 *     Uses verifySiteAccess (resources: { has: 'all' })
 *     Trivially cheap: read-only, returns [] when no orders exist.
 *
 * Both accept an optional `accessKey` parameter whose only gate is the token check
 * (auth is mocked to null so the session path is never taken).
 *
 * GREEN TESTS (must pass — query-side filter coverage)
 * -----------------------------------------------------
 * 1. ['all']-scoped unexpired token → accepted by BOTH manage AND orders gates.
 * 2. Expired token (past expires)   → rejected by BOTH gates.
 * 3. Foreign-site token (valid scope, but owner mismatch) → rejected by BOTH gates.
 *
 * RED TEST (bug-revealing consistency check — expected to FAIL until Phase 3)
 * ---------------------------------------------------------------------------
 * 4. ['manage_site']-only unexpired token → manage accepts, orders rejects.
 *    Assertion: both gates must reach the SAME authorization outcome (both ok
 *    or both error). Currently FAILS because manage uses hasSome and orders
 *    uses has — they disagree on manage_site-only scope. The test is direction-
 *    agnostic: it fails on the MISMATCH, not on a specific expected value.
 *
 *    RED until Phase 3 reconciles verifySiteOwnership.hasSome vs
 *    verifySiteAccess.has — direction is an open domain decision.
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
 * that verifySiteOwnership / verifySiteAccess emits.
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
// GREEN: query-side filter coverage (must pass)
// ---------------------------------------------------------------------------

describe('SecurityToken scope filter — real DB coverage', () => {
  it("['all']-scoped unexpired token is accepted by both manage gate (hasSome) and orders gate (has)", async () => {
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
})

// ---------------------------------------------------------------------------
// RED: bug-revealing consistency check (EXPECTED TO FAIL until Phase 3)
// ---------------------------------------------------------------------------

describe('SecurityToken scope divergence — consistency check', () => {
  it(
    // RED until Phase 3 reconciles verifySiteOwnership.hasSome vs verifySiteAccess.has
    // — direction is an open domain decision.
    "[manage_site]-only token: manage gate (hasSome) and orders gate (has) must reach the same authorization outcome",
    async () => {
      const owner = await createTestUser()
      const site = await createTestSite(owner.id)
      const item = await createTestInventoryItem(owner.id, site.id)
      // ['manage_site'] only — satisfies hasSome ['all','manage_site'] but NOT has 'all'
      const token = await createTestSecurityToken(owner.id, ['manage_site'])

      const manageResult = await blockBed(site.id, item.id, 'scope test', token.id, false)
      const ordersResult = await getOrders(site.id, 'incoming', token.id)

      const manageAccepted = wasAccepted(manageResult)
      const ordersAccepted = wasAccepted(ordersResult)

      // Direction-agnostic: the two gates must agree. Whether the fix tightens
      // manage or loosens orders is a domain decision for Phase 3. This assertion
      // fails on the MISMATCH, not on which direction is correct.
      expect(manageAccepted).toBe(ordersAccepted)
    }
  )
})
