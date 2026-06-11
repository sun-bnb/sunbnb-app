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
 * `all` in its `resources` and its owner must own the site.
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
        resources: { has: 'all' },
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
