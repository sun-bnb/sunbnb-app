import prisma from '@repo/data/PrismaCient'

const menuItemSelect = {
  id: true,
  restaurantId: true,
  name: true,
  description: true,
  price: true,
  tax: true,
  totalPrice: true,
  imageUrl: true,
  category: true,
  soldOut: true,
  active: true,
  displayOrder: true,
} as const

export interface MenuItemRecord {
  id: string
  restaurantId: string
  name: string
  description: string | null
  price: number
  tax: number
  totalPrice: number
  imageUrl: string | null
  category: string
  soldOut: boolean
  active: boolean
  displayOrder: number
}

/**
 * List menu items for a restaurant, ordered by displayOrder then name.
 * By default only active items are returned; pass `includeInactive: true`
 * from the partner-side context to show archived items.
 */
export async function listMenuItemsForRestaurant(
  restaurantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<MenuItemRecord[]> {
  return prisma.menuItem.findMany({
    where: {
      restaurantId,
      ...(opts.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    select: menuItemSelect,
  })
}

export async function getMenuItemById(id: string): Promise<MenuItemRecord | null> {
  return prisma.menuItem.findUnique({ where: { id }, select: menuItemSelect })
}
