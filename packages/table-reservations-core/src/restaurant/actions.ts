import prisma from '@repo/data/PrismaCient'
import type { ActionResult, RestaurantInput } from '../types'
import { getRestaurantById, type RestaurantRecord } from './queries'
import { slugify, uniqueRestaurantSlug } from './slug'
import { requireRestaurantOwner } from '../ownership'
import { isValidTimeZone } from '../tz'

function validateRestaurantInput(input: Partial<RestaurantInput>): string[] {
  const errors: string[] = []
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
      errors.push('Name is required')
    } else if (input.name.length > 200) {
      errors.push('Name is too long (max 200)')
    }
  }
  if (input.slug !== undefined) {
    if (typeof input.slug !== 'string') errors.push('Slug is invalid')
    else if (input.slug !== slugify(input.slug)) errors.push('Slug must be URL-safe lowercase-dashes')
    else if (input.slug.length < 2) errors.push('Slug is too short')
  }
  if (input.tagline !== undefined && input.tagline !== null && input.tagline.length > 200) {
    errors.push('Tagline is too long (max 200)')
  }
  if (input.description !== undefined && input.description !== null && input.description.length > 2000) {
    errors.push('Description is too long (max 2000)')
  }
  if (input.cuisineType !== undefined && input.cuisineType !== null && input.cuisineType.length > 50) {
    errors.push('Cuisine type is too long (max 50)')
  }
  if (
    input.priceRange !== undefined && input.priceRange !== null &&
    (!Number.isInteger(input.priceRange) || input.priceRange < 1 || input.priceRange > 4)
  ) {
    errors.push('Price range must be 1–4')
  }
  if (
    input.averageMealDuration !== undefined &&
    (!Number.isFinite(input.averageMealDuration) ||
      input.averageMealDuration < 15 ||
      input.averageMealDuration > 600)
  ) {
    errors.push('Average meal duration must be 15–600 minutes')
  }
  if (
    input.reservationWindow !== undefined &&
    (!Number.isInteger(input.reservationWindow) ||
      input.reservationWindow < 1 ||
      input.reservationWindow > 365)
  ) {
    errors.push('Reservation window must be 1–365 days')
  }
  if (
    input.timeZone !== undefined && input.timeZone !== null &&
    !isValidTimeZone(input.timeZone)
  ) {
    errors.push('Invalid timezone')
  }
  if (
    input.noShowPolicy !== undefined &&
    input.noShowPolicy !== 'none' &&
    input.noShowPolicy !== 'deposit'
  ) {
    errors.push('Invalid no-show policy')
  }
  if (
    input.depositPerGuest !== undefined && input.depositPerGuest !== null &&
    (!Number.isFinite(input.depositPerGuest) || input.depositPerGuest < 0 || input.depositPerGuest > 1000)
  ) {
    errors.push('Deposit per guest must be 0–1000')
  }
  if (
    input.layoutWidth !== undefined && input.layoutWidth !== null &&
    (!Number.isFinite(input.layoutWidth) || input.layoutWidth <= 0 || input.layoutWidth > 500)
  ) {
    errors.push('Layout width must be 1–500 m')
  }
  if (
    input.layoutHeight !== undefined && input.layoutHeight !== null &&
    (!Number.isFinite(input.layoutHeight) || input.layoutHeight <= 0 || input.layoutHeight > 500)
  ) {
    errors.push('Layout height must be 1–500 m')
  }
  return errors
}

/**
 * Create a Restaurant owned by a PartnerAccount. `siteId` is optional — set it
 * for chiringuitos (Phase 1 Sunbnb integration); leave null for pure-restaurant
 * partners (Phase 2 standalone app).
 *
 * If `slug` is omitted, a unique slug is derived from the name.
 */
export async function createRestaurant(
  input: RestaurantInput & { partnerAccountId: string; siteId?: string | null },
): Promise<ActionResult & { restaurant?: RestaurantRecord }> {
  const errors = validateRestaurantInput(input)
  if (errors.length > 0) return { status: 'error', errors }
  if (!input.partnerAccountId) return { status: 'error', errors: ['partnerAccountId is required'] }

  const slug = input.slug ?? (await uniqueRestaurantSlug(input.name))
  // Confirm the slug is still free (paranoia against concurrent creates).
  const existing = await prisma.restaurant.findUnique({ where: { slug }, select: { id: true } })
  if (existing) return { status: 'error', errors: ['Slug already in use'] }

  // If a site is being linked, make sure no other Restaurant claims it.
  if (input.siteId) {
    const linked = await prisma.restaurant.findUnique({
      where: { siteId: input.siteId },
      select: { id: true },
    })
    if (linked) return { status: 'error', errors: ['Site already linked to a restaurant'] }
  }

  const created = await prisma.restaurant.create({
    data: {
      slug,
      name: input.name.trim(),
      tagline: input.tagline ?? null,
      description: input.description ?? null,
      partnerAccountId: input.partnerAccountId,
      siteId: input.siteId ?? null,
      cuisineType: input.cuisineType ?? null,
      priceRange: input.priceRange ?? null,
      averageMealDuration: input.averageMealDuration ?? 120,
      reservationWindow: input.reservationWindow ?? 60,
      timeZone: input.timeZone ?? null,
      noShowPolicy: input.noShowPolicy ?? 'none',
      depositPerGuest: input.depositPerGuest ?? null,
      layoutWidth: input.layoutWidth ?? null,
      layoutHeight: input.layoutHeight ?? null,
      publicOnStandaloneApp: input.publicOnStandaloneApp ?? true,
      guestSelectionEnabled: input.guestSelectionEnabled ?? false,
    },
    select: { id: true },
  })
  const restaurant = await getRestaurantById(created.id)
  return { status: 'ok', ...(restaurant ? { restaurant } : {}) }
}

/** Update restaurant settings. Ownership-checked. */
export async function updateRestaurant(
  restaurantId: string,
  input: Partial<RestaurantInput>,
  userId: string | null | undefined,
): Promise<ActionResult & { restaurant?: RestaurantRecord }> {
  const { error } = await requireRestaurantOwner(restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  const errors = validateRestaurantInput(input)
  if (errors.length > 0) return { status: 'error', errors }

  // If slug is being changed, enforce uniqueness (ignoring the current row).
  if (input.slug !== undefined) {
    const other = await prisma.restaurant.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    })
    if (other && other.id !== restaurantId) {
      return { status: 'error', errors: ['Slug already in use'] }
    }
  }

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name.trim()
  if (input.slug !== undefined) data.slug = input.slug
  if (input.tagline !== undefined) data.tagline = input.tagline
  if (input.description !== undefined) data.description = input.description
  if (input.cuisineType !== undefined) data.cuisineType = input.cuisineType
  if (input.priceRange !== undefined) data.priceRange = input.priceRange
  if (input.averageMealDuration !== undefined) data.averageMealDuration = input.averageMealDuration
  if (input.reservationWindow !== undefined) data.reservationWindow = input.reservationWindow
  if (input.timeZone !== undefined) data.timeZone = input.timeZone
  if (input.noShowPolicy !== undefined) data.noShowPolicy = input.noShowPolicy
  if (input.depositPerGuest !== undefined) data.depositPerGuest = input.depositPerGuest
  if (input.cancellationDeadlineHours !== undefined) data.cancellationDeadlineHours = input.cancellationDeadlineHours
  if (input.layoutWidth !== undefined) data.layoutWidth = input.layoutWidth
  if (input.layoutHeight !== undefined) data.layoutHeight = input.layoutHeight
  if (input.publicOnStandaloneApp !== undefined) data.publicOnStandaloneApp = input.publicOnStandaloneApp
  if (input.guestSelectionEnabled !== undefined) data.guestSelectionEnabled = input.guestSelectionEnabled

  await prisma.restaurant.update({ where: { id: restaurantId }, data })
  const restaurant = await getRestaurantById(restaurantId)
  return { status: 'ok', ...(restaurant ? { restaurant } : {}) }
}
