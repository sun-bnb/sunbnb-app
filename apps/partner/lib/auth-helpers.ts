'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { isFlagEnabled } from '@/app/flags'
import type { FlagName } from '@repo/data/flags'

/**
 * Verify the current user is authenticated and owns the given site.
 * Returns the session on success, or an error message.
 */
export async function requireSiteOwner(
  siteId: string
): Promise<{ session: any; error: string | null }> {
  const session = await auth()
  if (!session?.user) return { session: null, error: 'Not authenticated' }

  // Sudo users bypass ownership check
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (user?.sudo) return { session, error: null }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) {
    return { session, error: 'Not authorized' }
  }

  return { session, error: null }
}

/**
 * Verify the caller may act on the given site, accepting either a SecurityToken
 * access key (for staff/integration use without login) or a signed-in session
 * that owns the site. When an access key is supplied, the token must include
 * `all` OR `manage_site` in its `resources` and its owner must own the site.
 *
 * This is the single canonical token-gate for all token-or-session actions,
 * covering both the orders dashboard and the manage page. `manage_site`-scoped
 * staff tokens are accepted on both surfaces.
 */
export async function verifySiteAccess(
  siteId: string,
  accessKey?: string
): Promise<{ userId: string | null; error: string | null }> {
  if (accessKey) {
    const token = await prisma.securityToken.findUnique({
      where: {
        id: accessKey,
        expires: { gt: new Date() },
        resources: { hasSome: ['all', 'manage_site'] },
      },
    })
    if (!token) return { userId: null, error: 'Invalid or expired access key' }
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { userId: true },
    })
    if (!site || site.userId !== token.userId) {
      return { userId: null, error: 'Not authorized' }
    }
    return { userId: site.userId, error: null }
  }

  const { session, error } = await requireSiteOwner(siteId)
  if (error) return { userId: null, error }
  return { userId: session.user.id, error: null }
}

/**
 * Stricter admin gate for the manage page's till-summary actions.
 *
 * Access is granted when:
 *   - An accessKey is supplied: the token must exist, be unexpired, have
 *     `'admin'` in its resources (hasSome: ['admin']), AND its owner must
 *     own the site. A plain `['all']` or `['manage_site']` token is NOT
 *     sufficient — the caller must be an explicitly provisioned admin token.
 *   - No accessKey: falls back to `requireSiteOwner(siteId)` so the site
 *     owner and sudo users can always reach the till summary.
 *
 * Returns the same `{ userId, error }` shape as `verifySiteAccess`.
 */
export async function verifySiteAdmin(
  siteId: string,
  accessKey?: string,
): Promise<{ userId: string | null; error: string | null }> {
  if (accessKey) {
    // The token must carry the 'admin' resource — a plain 'all'/'manage_site'
    // token is deliberately rejected here. 'admin' implies 'all' so we only
    // need to check for 'admin' in resources.
    const token = await prisma.securityToken.findUnique({
      where: {
        id: accessKey,
        expires: { gt: new Date() },
        resources: { hasSome: ['admin'] },
      },
    })
    if (!token) return { userId: null, error: 'Invalid or expired access key' }
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { userId: true },
    })
    if (!site || site.userId !== token.userId) {
      return { userId: null, error: 'Not authorized' }
    }
    return { userId: site.userId, error: null }
  }

  // Session path: owner or sudo passes.
  const { session, error } = await requireSiteOwner(siteId)
  if (error) return { userId: null, error }
  return { userId: session.user.id, error: null }
}

/**
 * Verify the current user is authenticated and owns the given restaurant.
 * Ownership is checked via restaurant.partnerAccountId === session.user.id
 * (PartnerAccount is keyed by userId, so this is a direct userId comparison).
 * Sudo users bypass the ownership check.
 */
export async function requireRestaurantOwner(
  restaurantId: string
): Promise<{ session: any; error: string | null }> {
  const session = await auth()
  if (!session?.user) return { session: null, error: 'Not authenticated' }

  // Sudo users bypass ownership check
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (user?.sudo) return { session, error: null }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { partnerAccountId: true },
  })
  if (!restaurant || restaurant.partnerAccountId !== session.user.id) {
    return { session, error: 'Not authorized' }
  }

  return { session, error: null }
}

/**
 * Verify the caller may act on the given restaurant, accepting either a
 * SecurityToken access key (for staff/integration use without login) or a
 * signed-in session that owns the restaurant. When an access key is
 * supplied, the token must include `all` OR `manage_site` in its `resources`
 * and its owner must own the restaurant (`restaurant.partnerAccountId ===
 * token.userId`).
 *
 * Near-copy of `verifySiteAccess` — deliberately reuses the same `'all'` /
 * `'manage_site'` resource vocabulary so existing staff tokens (provisioned
 * for the site manage/orders surfaces) work against the restaurant-scoped
 * kitchen dashboard with zero re-provisioning. This is the canonical
 * token-gate for the restaurant orders dashboard (mirrors verifySiteAccess
 * for the site orders dashboard).
 */
export async function verifyRestaurantAccess(
  restaurantId: string,
  accessKey?: string
): Promise<{ userId: string | null; error: string | null }> {
  if (accessKey) {
    const token = await prisma.securityToken.findUnique({
      where: {
        id: accessKey,
        expires: { gt: new Date() },
        resources: { hasSome: ['all', 'manage_site'] },
      },
    })
    if (!token) return { userId: null, error: 'Invalid or expired access key' }
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { partnerAccountId: true },
    })
    if (!restaurant || restaurant.partnerAccountId !== token.userId) {
      return { userId: null, error: 'Not authorized' }
    }
    return { userId: restaurant.partnerAccountId, error: null }
  }

  const { session, error } = await requireRestaurantOwner(restaurantId)
  if (error) return { userId: null, error }
  return { userId: session.user.id, error: null }
}

/**
 * Require both site ownership AND that the named feature flag is enabled.
 * Sudo bypass is built into `isFlagEnabled`, so sudo users always pass.
 * Use this in server actions for features that are runtime-gated.
 */
export async function requireSiteOwnerWithFlag(
  siteId: string,
  flag: FlagName,
): Promise<{ session: any; error: string | null }> {
  if (!(await isFlagEnabled(flag))) {
    return { session: null, error: 'feature_disabled' }
  }
  return requireSiteOwner(siteId)
}

/**
 * Require both restaurant ownership AND that the named feature flag is enabled.
 * Mirrors `requireSiteOwnerWithFlag` but uses restaurant-keyed ownership.
 */
export async function requireRestaurantOwnerWithFlag(
  restaurantId: string,
  flag: FlagName,
): Promise<{ session: any; error: string | null }> {
  if (!(await isFlagEnabled(flag))) {
    return { session: null, error: 'feature_disabled' }
  }
  return requireRestaurantOwner(restaurantId)
}
