'use server'

import { revalidatePath } from 'next/cache'
import { requireRestaurantOwnerWithFlag, requireSiteOwnerWithFlag } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'
import { deriveTimeZoneFromCoords } from '@repo/data/site-day'
import {
  createRestaurant as coreCreateRestaurant,
  updateRestaurant,
  setRestaurantHours,
  setRestaurantShifts,
  createCombination,
  updateCombination,
  deleteCombination,
  uniqueRestaurantSlug,
  type RestaurantInput,
  type RestaurantHoursInput,
  type RestaurantShiftInput,
  type TableCombinationInput,
} from '@repo/table-reservations-core'

/**
 * Create a Restaurant, optionally linked to a Sunbnb site.
 *
 * - When `siteId` is supplied the site must be owned by the same user (verified
 *   via `requireSiteOwnerWithFlag`), and the soft link is set on the site.
 * - When called without `siteId` (standalone create from /restaurants/create)
 *   authentication is still required; the restaurant is created owned by the
 *   session user's PartnerAccount and can be linked to a site later.
 *
 * This single action backs both entry points:
 *   1. The "Add a restaurant" CTA on a Site page (siteId supplied).
 *   2. The /restaurants/create form (siteId optional).
 */
export async function createRestaurant({
  siteId,
  name,
}: {
  siteId?: string
  name?: string
}) {
  // When a siteId is provided, verify site ownership (also checks the flag).
  // When no siteId, we still need auth — use the flag check directly.
  let sessionUserId: string
  let resolvedName = name

  if (siteId) {
    const { session, error } = await requireSiteOwnerWithFlag(siteId, 'restaurants')
    if (error) return { status: 'error' as const, errors: [error] }

    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: {
        name: true,
        restaurantId: true,
        layoutWidth: true,
        layoutHeight: true,
        locationLat: true,
        locationLng: true,
      },
    })
    if (!site) return { status: 'error' as const, errors: ['Site not found'] }
    if (site.restaurantId) {
      return { status: 'error' as const, errors: ['Site already has a restaurant'] }
    }

    sessionUserId = session!.user.id as string
    if (!resolvedName) resolvedName = site.name

    // Inherit the site's timezone (derived from coords, track 017 P7) so a
    // newly linked restaurant doesn't silently default to Madrid when the
    // site is somewhere else.
    const inheritedTz = deriveTimeZoneFromCoords(
      site.locationLat ? parseFloat(site.locationLat) : null,
      site.locationLng ? parseFloat(site.locationLng) : null,
    )

    const slug = await uniqueRestaurantSlug(resolvedName)
    const created = await coreCreateRestaurant({
      partnerAccountId: sessionUserId,
      siteId,
      name: resolvedName,
      slug,
      layoutWidth: site.layoutWidth,
      layoutHeight: site.layoutHeight,
      timeZone: inheritedTz ?? undefined,
    })
    if (created.status === 'error' || !created.restaurant) {
      return { status: 'error' as const, errors: created.errors ?? ['Could not create restaurant'] }
    }

    // Copy Sunbnb working hours across as a helpful starting point.
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
      await setRestaurantHours(created.restaurant.id, hours, sessionUserId)
    }

    // Persist the soft link on the Sunbnb site side.
    await prisma.site.update({
      where: { id: siteId },
      data: { restaurantId: created.restaurant.id },
    })

    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/restaurants`)
    revalidatePath(`/restaurants/${created.restaurant.id}`)
    return { status: 'ok' as const, restaurantId: created.restaurant.id }
  } else {
    // Standalone create: authenticate, no site link.
    const { isFlagEnabled } = await import('@/app/flags')
    if (!(await isFlagEnabled('restaurants'))) {
      return { status: 'error' as const, errors: ['feature_disabled'] }
    }
    const { auth } = await import('@/app/auth')
    const session = await auth()
    if (!session?.user) return { status: 'error' as const, errors: ['Not authenticated'] }

    sessionUserId = session.user.id as string
    const restaurantName = resolvedName?.trim() || ''
    if (!restaurantName) {
      return { status: 'error' as const, errors: ['Name is required'] }
    }

    const slug = await uniqueRestaurantSlug(restaurantName)
    const created = await coreCreateRestaurant({
      partnerAccountId: sessionUserId,
      name: restaurantName,
      slug,
    })
    if (created.status === 'error' || !created.restaurant) {
      return { status: 'error' as const, errors: created.errors ?? ['Could not create restaurant'] }
    }

    revalidatePath(`/restaurants`)
    revalidatePath(`/restaurants/${created.restaurant.id}`)
    return { status: 'ok' as const, restaurantId: created.restaurant.id }
  }
}

/**
 * Update restaurant settings, ownership-checked by restaurantId.
 */
export async function updateRestaurantSettings(
  restaurantId: string,
  patch: Partial<RestaurantInput>,
) {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { status: 'error' as const, errors: [error] }

  const res = await updateRestaurant(restaurantId, patch, session!.user.id as string)
  if (res.status === 'ok') {
    revalidatePath(`/restaurants/${restaurantId}`)
  }
  return res
}

/**
 * Replace weekly opening hours for a Restaurant.
 */
export async function setRestaurantOpeningHours(
  restaurantId: string,
  hours: RestaurantHoursInput[],
) {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { status: 'error' as const, errors: [error] }

  const res = await setRestaurantHours(restaurantId, hours, session!.user.id as string)
  if (res.status === 'ok') {
    revalidatePath(`/restaurants/${restaurantId}`)
  }
  return res
}

/**
 * Replace the set of service shifts (with pacing) for a Restaurant.
 */
export async function setRestaurantServiceShifts(
  restaurantId: string,
  shifts: RestaurantShiftInput[],
) {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { status: 'error' as const, errors: [error] }

  const res = await setRestaurantShifts(restaurantId, shifts, session!.user.id as string)
  if (res.status === 'ok') {
    revalidatePath(`/restaurants/${restaurantId}`)
  }
  return res
}

// ─── Table combinations (large-party joins) ─────────────────────────────────

export async function createRestaurantCombination(
  restaurantId: string,
  input: TableCombinationInput,
) {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { status: 'error' as const, errors: [error] }
  const res = await createCombination(restaurantId, input, session!.user.id as string)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return res
}

export async function updateRestaurantCombination(
  restaurantId: string,
  combinationId: string,
  patch: Partial<TableCombinationInput>,
) {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { status: 'error' as const, errors: [error] }
  const res = await updateCombination(combinationId, patch, session!.user.id as string)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return res
}

export async function deleteRestaurantCombination(
  restaurantId: string,
  combinationId: string,
) {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { status: 'error' as const, errors: [error] }
  const res = await deleteCombination(combinationId, session!.user.id as string)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return res
}

function formatDateAsHHMM(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
