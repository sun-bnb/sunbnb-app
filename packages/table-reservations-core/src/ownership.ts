import prisma from '@repo/data/PrismaCient'

/**
 * Verify a user owns a given Restaurant. Matches `Restaurant.partnerAccountId`
 * against the caller's userId. Sudo users bypass the check.
 *
 * Brand/Sunbnb-agnostic: takes the userId explicitly, so this helper can be
 * called from thin wrappers in any app (Phase 1 sunbnb integration or Phase 2
 * standalone apps).
 */
export async function requireRestaurantOwner(
  restaurantId: string,
  userId: string | null | undefined,
): Promise<
  | { restaurant: { id: string; partnerAccountId: string; siteId: string | null }; error: null }
  | { restaurant: null; error: string }
> {
  if (!userId) return { restaurant: null, error: 'Not authenticated' }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sudo: true } })

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, partnerAccountId: true, siteId: true },
  })
  if (!restaurant) return { restaurant: null, error: 'Not authorized' }
  if (user?.sudo) return { restaurant, error: null }
  if (restaurant.partnerAccountId !== userId) {
    return { restaurant: null, error: 'Not authorized' }
  }
  return { restaurant, error: null }
}
