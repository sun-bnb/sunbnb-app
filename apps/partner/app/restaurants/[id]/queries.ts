'use server'

import { requireRestaurantOwner } from '@/lib/auth-helpers'
import {
  getRestaurantById,
  listTablesForRestaurant,
  listLayoutElementsForRestaurant,
  listMenuItemsForRestaurant,
  type TableRecord,
  type LayoutElementRecord,
  type MenuItemRecord,
} from '@repo/table-reservations-core'

export interface RestaurantDetail {
  id: string
  slug: string
  name: string
  tagline: string | null
  description: string | null
  cuisineType: string | null
  priceRange: number | null
  averageMealDuration: number
  reservationWindow: number
  layoutWidth: number | null
  layoutHeight: number | null
  publicOnStandaloneApp: boolean
  siteId: string | null
  workingHours: Array<{ day: number; openTime: string; closeTime: string }>
}

/**
 * Fetch a Restaurant by its own id, with restaurant-keyed ownership check.
 */
export async function getRestaurant(
  restaurantId: string,
): Promise<RestaurantDetail | null> {
  const { error } = await requireRestaurantOwner(restaurantId)
  if (error) return null

  const r = await getRestaurantById(restaurantId)
  if (!r) return null

  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    tagline: r.tagline,
    description: r.description,
    cuisineType: r.cuisineType,
    priceRange: r.priceRange,
    averageMealDuration: r.averageMealDuration,
    reservationWindow: r.reservationWindow,
    layoutWidth: r.layoutWidth,
    layoutHeight: r.layoutHeight,
    publicOnStandaloneApp: r.publicOnStandaloneApp,
    siteId: r.siteId ?? null,
    workingHours: r.workingHours.map((h) => ({
      day: h.day,
      openTime: h.openTime,
      closeTime: h.closeTime,
    })),
  }
}

export interface RestaurantLayout {
  restaurantId: string
  layoutWidth: number
  layoutHeight: number
  tables: TableRecord[]
  elements: LayoutElementRecord[]
}

/**
 * Fetch the full layout (tables + background elements) for a Restaurant.
 * Ownership-checked directly via restaurantId.
 */
export async function getRestaurantLayout(
  restaurantId: string,
): Promise<RestaurantLayout | null> {
  const { error } = await requireRestaurantOwner(restaurantId)
  if (error) return null

  const r = await getRestaurantById(restaurantId)
  if (!r) return null

  const [tables, elements] = await Promise.all([
    listTablesForRestaurant(restaurantId),
    listLayoutElementsForRestaurant(restaurantId),
  ])

  return {
    restaurantId: r.id,
    layoutWidth: r.layoutWidth ?? 15,
    layoutHeight: r.layoutHeight ?? 10,
    tables,
    elements,
  }
}

/**
 * Fetch the menu for a Restaurant. Partner-side: includes inactive items by
 * default — set `activeOnly: true` for a customer-facing surface.
 */
export async function getRestaurantMenu(
  restaurantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<MenuItemRecord[] | null> {
  const { error } = await requireRestaurantOwner(restaurantId)
  if (error) return null

  return listMenuItemsForRestaurant(restaurantId, {
    includeInactive: !opts.activeOnly,
  })
}
