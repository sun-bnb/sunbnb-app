import prisma from '@repo/data/PrismaCient'

const restaurantSelect = {
  id: true,
  slug: true,
  name: true,
  tagline: true,
  description: true,
  partnerAccountId: true,
  siteId: true,
  cuisineType: true,
  priceRange: true,
  averageMealDuration: true,
  reservationWindow: true,
  timeZone: true,
  noShowPolicy: true,
  depositPerGuest: true,
  layoutWidth: true,
  layoutHeight: true,
  publicOnStandaloneApp: true,
  workingHours: {
    orderBy: { day: 'asc' as const },
    select: { id: true, day: true, openTime: true, closeTime: true },
  },
} as const

export type RestaurantRecord = {
  id: string
  slug: string
  name: string
  tagline: string | null
  description: string | null
  partnerAccountId: string
  siteId: string | null
  cuisineType: string | null
  priceRange: number | null
  averageMealDuration: number
  reservationWindow: number
  timeZone: string | null
  noShowPolicy: string
  depositPerGuest: number | null
  layoutWidth: number | null
  layoutHeight: number | null
  publicOnStandaloneApp: boolean
  workingHours: Array<{ id: string; day: number; openTime: string; closeTime: string }>
}

export async function getRestaurantById(id: string): Promise<RestaurantRecord | null> {
  return prisma.restaurant.findUnique({ where: { id }, select: restaurantSelect })
}

export async function getRestaurantBySlug(slug: string): Promise<RestaurantRecord | null> {
  return prisma.restaurant.findUnique({ where: { slug }, select: restaurantSelect })
}

export async function getRestaurantBySiteId(siteId: string): Promise<RestaurantRecord | null> {
  return prisma.restaurant.findUnique({ where: { siteId }, select: restaurantSelect })
}

export async function listRestaurantsForPartner(
  partnerAccountId: string,
): Promise<RestaurantRecord[]> {
  return prisma.restaurant.findMany({
    where: { partnerAccountId },
    orderBy: { createdAt: 'asc' },
    select: restaurantSelect,
  })
}
