'use server'

import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'
import {
  getRestaurantById,
  listTablesForRestaurant,
  listLayoutElementsForRestaurant,
  listMenuItemsForRestaurant,
  type TableRecord,
  type LayoutElementRecord,
  type MenuItemRecord,
} from '@repo/table-reservations-core'

export interface LinkedRestaurant {
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
  workingHours: Array<{ day: number; openTime: string; closeTime: string }>
}

/**
 * Fetch the Restaurant linked to a Sunbnb site. Sunbnb-side ownership check
 * first; delegates to the core query once authorized.
 */
export async function getLinkedRestaurant(
  siteId: string,
): Promise<LinkedRestaurant | null> {
  const { error } = await requireSiteOwner(siteId)
  if (error) return null

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { restaurantId: true },
  })
  if (!site?.restaurantId) return null

  const r = await getRestaurantById(site.restaurantId)
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
    workingHours: r.workingHours.map((h) => ({
      day: h.day,
      openTime: h.openTime,
      closeTime: h.closeTime,
    })),
  }
}

export interface LinkedRestaurantLayout {
  restaurantId: string
  layoutWidth: number
  layoutHeight: number
  tables: TableRecord[]
  elements: LayoutElementRecord[]
}

/**
 * Fetch the full layout (tables + background elements) for the Restaurant
 * linked to a Sunbnb site. Ownership-checked via the Sunbnb site.
 */
export async function getLinkedRestaurantLayout(
  siteId: string,
): Promise<LinkedRestaurantLayout | null> {
  const { error } = await requireSiteOwner(siteId)
  if (error) return null

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { restaurantId: true },
  })
  if (!site?.restaurantId) return null

  const r = await getRestaurantById(site.restaurantId)
  if (!r) return null

  const [tables, elements] = await Promise.all([
    listTablesForRestaurant(site.restaurantId),
    listLayoutElementsForRestaurant(site.restaurantId),
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
 * Fetch the menu for the Restaurant linked to a Sunbnb site. Partner-side:
 * includes inactive items by default — set `activeOnly: true` for a
 * customer-facing surface.
 */
export async function getLinkedRestaurantMenu(
  siteId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<MenuItemRecord[] | null> {
  const { error } = await requireSiteOwner(siteId)
  if (error) return null

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { restaurantId: true },
  })
  if (!site?.restaurantId) return null

  return listMenuItemsForRestaurant(site.restaurantId, {
    includeInactive: !opts.activeOnly,
  })
}
