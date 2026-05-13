'use server'

import { revalidatePath } from 'next/cache'
import { requireSiteOwnerWithFlag } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'
import {
  createRestaurant,
  updateRestaurant,
  setRestaurantHours,
  uniqueRestaurantSlug,
  type RestaurantInput,
  type RestaurantHoursInput,
} from '@repo/table-reservations-core'

/**
 * Create a Restaurant for a chiringuito's Sunbnb site and link it to the site.
 * The Restaurant inherits the Sunbnb site's name and is owned by the same
 * PartnerAccount. The Sunbnb partner can then edit settings separately.
 *
 * Thin wrapper: ownership guard is the Sunbnb-side `requireSiteOwner`; the
 * actual restaurant creation lives in @repo/table-reservations-core.
 */
export async function enableTableReservations(siteId: string) {
  const { session, error } = await requireSiteOwnerWithFlag(siteId, 'restaurants')
  if (error) return { status: 'error' as const, errors: [error] }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { name: true, restaurantId: true, userId: true, layoutWidth: true, layoutHeight: true },
  })
  if (!site) return { status: 'error' as const, errors: ['Site not found'] }
  if (site.restaurantId) {
    return { status: 'error' as const, errors: ['Site already has a restaurant'] }
  }

  const slug = await uniqueRestaurantSlug(site.name)

  const created = await createRestaurant({
    partnerAccountId: session!.user.id as string,
    siteId,
    name: site.name,
    slug,
    layoutWidth: site.layoutWidth,
    layoutHeight: site.layoutHeight,
  })
  if (created.status === 'error' || !created.restaurant) {
    return { status: 'error' as const, errors: created.errors ?? ['Could not create restaurant'] }
  }

  // Copy Sunbnb working hours across, if any, as a helpful starting point.
  const siteHours = await prisma.siteWorkingHours.findMany({
    where: { siteId },
    select: { day: true, openTime: true, closeTime: true },
  })
  if (siteHours.length > 0) {
    const hours: RestaurantHoursInput[] = siteHours.map((h) => ({
      day: h.day,
      openTime: formatDateAsHHMM(h.openTime),
      closeTime: formatDateAsHHMM(h.closeTime),
    }))
    await setRestaurantHours(created.restaurant.id, hours, session!.user.id as string)
  }

  // Persist the soft link on the Sunbnb side.
  await prisma.site.update({
    where: { id: siteId },
    data: { restaurantId: created.restaurant.id },
  })

  revalidatePath(`/sites/${siteId}`)
  revalidatePath(`/sites/${siteId}/restaurant`)
  return { status: 'ok' as const, restaurantId: created.restaurant.id }
}

/**
 * Update restaurant settings for the Restaurant linked to a Sunbnb site.
 * Sunbnb-side ownership check first, then delegates to the core package.
 */
export async function updateLinkedRestaurant(
  siteId: string,
  patch: Partial<RestaurantInput>,
) {
  const { session, error } = await requireSiteOwnerWithFlag(siteId, 'restaurants')
  if (error) return { status: 'error' as const, errors: [error] }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { restaurantId: true },
  })
  if (!site?.restaurantId) {
    return { status: 'error' as const, errors: ['Site has no linked restaurant'] }
  }

  const res = await updateRestaurant(site.restaurantId, patch, session!.user.id as string)
  if (res.status === 'ok') {
    revalidatePath(`/sites/${siteId}/restaurant`)
  }
  return res
}

/**
 * Replace weekly opening hours for the Restaurant linked to a Sunbnb site.
 */
export async function setLinkedRestaurantHours(
  siteId: string,
  hours: RestaurantHoursInput[],
) {
  const { session, error } = await requireSiteOwnerWithFlag(siteId, 'restaurants')
  if (error) return { status: 'error' as const, errors: [error] }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { restaurantId: true },
  })
  if (!site?.restaurantId) {
    return { status: 'error' as const, errors: ['Site has no linked restaurant'] }
  }

  const res = await setRestaurantHours(site.restaurantId, hours, session!.user.id as string)
  if (res.status === 'ok') {
    revalidatePath(`/sites/${siteId}/restaurant`)
  }
  return res
}

function formatDateAsHHMM(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
