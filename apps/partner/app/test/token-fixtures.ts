/**
 * Token fixtures for the auth-matrix test (Phase 0.2 / Phase 3).
 *
 * Each fixture is a `{ key, row }` pair where `row` mirrors the shape that
 * `prisma.securityToken.findUnique` would return. The `apply*` helpers drive
 * the mocked prisma + auth into the named scenario so that the matrix runner
 * can call them unconditionally.
 *
 * SecurityToken shape (read from lib/auth-helpers.ts verifySiteAccess — the
 * single canonical gate for all token-or-session actions):
 *   id: string               — the accessKey itself
 *   userId: string           — the token owner (must match site.userId)
 *   expires: Date            — checked as { gt: new Date() }
 *   resources: string[]      — unified gate uses hasSome ['all', 'manage_site']
 *                              (both the manage page AND the orders dashboard accept
 *                              either scope; manage/actions.ts verifySiteOwnership
 *                              delegates to verifySiteAccess — Phase 3 consolidation)
 */

import { vi } from 'vitest'
import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'

// ─── Shared fixture identities ───────────────────────────────────────────────

export const OWNER_ID = 'matrix-owner-1'
export const OTHER_USER_ID = 'matrix-other-1'
export const SITE_ID = 'matrix-site-1'
export const ITEM_ID = 'matrix-item-1'
export const RES_ID = 'matrix-res-1'
export const BOOKING_ID = 'matrix-booking-1'
export const ORDER_ID = 'matrix-order-1'
export const PRODUCT_ID = 'matrix-product-1'
export const RENTAL_ITEM_ID = 'matrix-rental-item-1'
export const RESTAURANT_ID = 'matrix-restaurant-1'
export const TABLE_ID = 'matrix-table-1'
export const MENU_ITEM_ID = 'matrix-menu-item-1'
export const TABLE_RES_ID = 'matrix-table-res-1'
export const WAITLIST_ENTRY_ID = 'matrix-waitlist-1'
export const COMBINATION_ID = 'matrix-combination-1'
export const RESTAURANT_ELEMENT_ID = 'matrix-restaurant-element-1'

// ─── Token definitions ────────────────────────────────────────────────────────

export interface TokenFixture {
  key: string
  row: {
    id: string
    userId: string
    expires: Date
    resources: string[]
  }
}

/** Valid token: not expired, resources includes both 'all' and 'manage_site', owned by OWNER_ID */
export const TOKENS = {
  valid: {
    key: 'token-valid-1',
    row: {
      id: 'token-valid-1',
      userId: OWNER_ID,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      resources: ['all', 'manage_site'],
    },
  } satisfies TokenFixture,

  expired: {
    key: 'token-expired-1',
    row: {
      id: 'token-expired-1',
      userId: OWNER_ID,
      expires: new Date(Date.now() - 60 * 1000),
      resources: ['all', 'manage_site'],
    },
  } satisfies TokenFixture,

  /**
   * Wrong-scope: not expired, but resources = ['read_only'] only.
   * This should be rejected by the unified verifySiteAccess gate
   * (hasSome ['all', 'manage_site']).
   */
  wrongScope: {
    key: 'token-wrong-scope-1',
    row: {
      id: 'token-wrong-scope-1',
      userId: OWNER_ID,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      resources: ['read_only'],
    },
  } satisfies TokenFixture,

  /**
   * Foreign-site token: valid scope and not expired, but userId = OTHER_USER_ID.
   * When site.userId = OWNER_ID, this token should be rejected at the ownership
   * linkage check (site.userId !== token.userId).
   */
  foreign: {
    key: 'token-foreign-1',
    row: {
      id: 'token-foreign-1',
      userId: OTHER_USER_ID,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      resources: ['all', 'manage_site'],
    },
  } satisfies TokenFixture,
}

// ─── Shared site stub ─────────────────────────────────────────────────────────

/** Set prisma.site.findUnique to return a site owned by OWNER_ID. */
export function stubOwnerSite() {
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: SITE_ID, userId: OWNER_ID } as any)
}

/**
 * Set prisma.restaurant.findUnique to return a restaurant owned by OWNER_ID.
 * Used by requireRestaurantOwner (both the partner-app wrapper and the core
 * ownership helper) which check restaurant.partnerAccountId === session.user.id.
 */
export function stubOwnerRestaurant() {
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
    id: RESTAURANT_ID,
    partnerAccountId: OWNER_ID,
    siteId: SITE_ID,
  } as any)
}

/**
 * Set prisma.restaurant.findUnique to return a restaurant owned by OTHER_USER_ID
 * (not the current session user). This causes the ownership check to reject.
 */
export function stubNonOwnerRestaurant() {
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
    id: RESTAURANT_ID,
    partnerAccountId: OTHER_USER_ID,
    siteId: SITE_ID,
  } as any)
}

// ─── Session helpers ──────────────────────────────────────────────────────────

/** Drive auth into unauthenticated state. */
export function applyUnauthenticated() {
  vi.mocked(auth).mockResolvedValue(null)
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
}

/** Drive auth into an authenticated non-owner session. */
export function applyNonOwnerSession() {
  vi.mocked(auth).mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  stubOwnerSite()
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)
}

/** Drive auth into an authenticated owner session. */
export function applyOwnerSession() {
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  stubOwnerSite()
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)
}

// ─── Token helpers ────────────────────────────────────────────────────────────

/**
 * Apply a valid, correctly-scoped, same-owner token.
 * Auth is null (token path; no session involved).
 */
export function applyValidToken() {
  vi.mocked(auth).mockResolvedValue(null)
  stubOwnerSite()
  // The token-gate prisma query uses findUnique with compound where —
  // in unit mode we just make it return (or not) the token row.
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(TOKENS.valid.row as any)
}

/**
 * Apply an expired token. In practice the Prisma where clause filters it out
 * (expires: { gt: new Date() }), so the mock returns null.
 */
export function applyExpiredToken() {
  vi.mocked(auth).mockResolvedValue(null)
  stubOwnerSite()
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)
}

/**
 * Apply a wrong-scope token. Resources don't include 'all' or 'manage_site',
 * so the Prisma query (hasSome / has filter) returns null in reality.
 */
export function applyWrongScopeToken() {
  vi.mocked(auth).mockResolvedValue(null)
  stubOwnerSite()
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)
}

/**
 * Apply a token whose userId does not match the site's userId.
 * The token is found (valid scope + not expired) but the ownership linkage
 * check (site.userId !== token.userId) should reject it.
 */
export function applyForeignSiteToken() {
  vi.mocked(auth).mockResolvedValue(null)
  stubOwnerSite()
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(TOKENS.foreign.row as any)
}

// ─── Restaurant-owner session helpers ────────────────────────────────────────

/**
 * Drive auth into an authenticated non-owner session for restaurant actions.
 * The restaurant is owned by OTHER_USER_ID, so the current user (OWNER_ID)
 * is rejected by requireRestaurantOwner.
 *
 * Note: We authenticate as OWNER_ID but make the restaurant owned by OTHER_USER_ID
 * — that way "non-owner" means a valid user who doesn't own this restaurant.
 */
export function applyRestaurantNonOwnerSession() {
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)
  stubNonOwnerRestaurant()
}

/**
 * Drive auth into an authenticated owner session for restaurant actions.
 * The restaurant is owned by OWNER_ID, matching the session user.
 *
 * Uses mockResolvedValue (not Once) so that sequential core ownership checks
 * (the partner-level requireRestaurantOwnerWithFlag → core requireRestaurantOwner)
 * both get the same owned-restaurant response without consuming the mock.
 */
export function applyRestaurantOwnerSession() {
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)
  stubOwnerRestaurant()
}
