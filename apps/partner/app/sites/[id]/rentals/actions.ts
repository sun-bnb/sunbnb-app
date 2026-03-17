'use server'

import { revalidatePath } from 'next/cache'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { isValidRentalPaymentType } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'

// ─── Set Rental Payment Type ────────────────────────────────────────────────

export async function setRentalPaymentType(siteId: string, rentalPaymentType: string) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  if (!isValidRentalPaymentType(rentalPaymentType)) {
    return { status: 'error', errors: ['Invalid rental payment type'] }
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { rentalPaymentType },
  })

  revalidatePath(`/sites/${siteId}`)
  return { status: 'ok' }
}

// ─── Get Rental Items ───────────────────────────────────────────────────────

export async function getRentalItems(siteId: string) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const items = await prisma.rentalItem.findMany({
    where: { siteId },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { bookings: true } }
    }
  })

  return { status: 'ok', items }
}

// ─── Create Rental Item ─────────────────────────────────────────────────────

export async function createRentalItem(input: {
  siteId: string
  name: string
  description?: string
  category?: string
  pricePerHour?: number
  pricePerDay?: number
  totalQuantity: number
}) {
  const { error } = await requireSiteOwner(input.siteId)
  if (error) return { status: 'error', errors: [error] }

  const errors: string[] = []
  if (!input.name?.trim()) errors.push('Name is required')
  if (input.name && input.name.length > 200) errors.push('Name is too long (max 200)')
  if (input.description && input.description.length > 1000) errors.push('Description is too long (max 1000)')
  if (input.category && input.category.length > 100) errors.push('Category is too long (max 100)')
  if (input.totalQuantity < 1 || input.totalQuantity > 10000) errors.push('Quantity must be 1–10,000')
  if (!input.pricePerHour && !input.pricePerDay) errors.push('At least one price is required')
  if (input.pricePerHour !== undefined && input.pricePerHour !== null && (isNaN(Number(input.pricePerHour)) || Number(input.pricePerHour) < 0 || Number(input.pricePerHour) > 100000)) errors.push('Hourly price must be 0–100,000')
  if (input.pricePerDay !== undefined && input.pricePerDay !== null && (isNaN(Number(input.pricePerDay)) || Number(input.pricePerDay) < 0 || Number(input.pricePerDay) > 100000)) errors.push('Daily price must be 0–100,000')
  if (errors.length > 0) return { status: 'error', errors }

  const item = await prisma.rentalItem.create({
    data: {
      siteId: input.siteId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      pricePerHour: input.pricePerHour || null,
      pricePerDay: input.pricePerDay || null,
      totalQuantity: input.totalQuantity,
    },
  })

  revalidatePath('/sites')
  return { status: 'ok', item }
}

// ─── Update Rental Item ─────────────────────────────────────────────────────

export async function updateRentalItem(input: {
  id: string
  siteId: string
  name: string
  description?: string
  category?: string
  pricePerHour?: number
  pricePerDay?: number
  totalQuantity: number
  active: boolean
}) {
  const { error } = await requireSiteOwner(input.siteId)
  if (error) return { status: 'error', errors: [error] }

  const errors: string[] = []
  if (!input.name?.trim()) errors.push('Name is required')
  if (input.name && input.name.length > 200) errors.push('Name is too long (max 200)')
  if (input.description && input.description.length > 1000) errors.push('Description is too long (max 1000)')
  if (input.category && input.category.length > 100) errors.push('Category is too long (max 100)')
  if (input.totalQuantity < 1 || input.totalQuantity > 10000) errors.push('Quantity must be 1–10,000')
  if (!input.pricePerHour && !input.pricePerDay) errors.push('At least one price is required')
  if (input.pricePerHour !== undefined && input.pricePerHour !== null && (isNaN(Number(input.pricePerHour)) || Number(input.pricePerHour) < 0 || Number(input.pricePerHour) > 100000)) errors.push('Hourly price must be 0–100,000')
  if (input.pricePerDay !== undefined && input.pricePerDay !== null && (isNaN(Number(input.pricePerDay)) || Number(input.pricePerDay) < 0 || Number(input.pricePerDay) > 100000)) errors.push('Daily price must be 0–100,000')
  if (errors.length > 0) return { status: 'error', errors }

  // Verify item belongs to this site
  const existing = await prisma.rentalItem.findUnique({ where: { id: input.id }, select: { siteId: true } })
  if (!existing || existing.siteId !== input.siteId) {
    return { status: 'error', errors: ['Item not found'] }
  }

  const item = await prisma.rentalItem.update({
    where: { id: input.id },
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      pricePerHour: input.pricePerHour || null,
      pricePerDay: input.pricePerDay || null,
      totalQuantity: input.totalQuantity,
      active: input.active,
    },
  })

  revalidatePath('/sites')
  return { status: 'ok', item }
}

// ─── Delete Rental Item ─────────────────────────────────────────────────────

export async function deleteRentalItem(siteId: string, itemId: string) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const existing = await prisma.rentalItem.findUnique({ where: { id: itemId }, select: { siteId: true } })
  if (!existing || existing.siteId !== siteId) {
    return { status: 'error', errors: ['Item not found'] }
  }

  await prisma.rentalItem.delete({ where: { id: itemId } })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Save Rental VAT ────────────────────────────────────────────────────────

export async function saveRentalVat(siteId: string, rentalVat: string) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const value = Number(rentalVat)
  if (isNaN(value) || value < 0 || value > 100) {
    return { status: 'error', errors: ['VAT must be 0–100'] }
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { rentalVat: value > 0 ? value : null },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Toggle Site Feature ────────────────────────────────────────────────────

export async function toggleSiteFeature(siteId: string, feature: string, enabled: boolean) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const VALID_FEATURES = ['rentals']
  if (!VALID_FEATURES.includes(feature)) {
    return { status: 'error', errors: ['Invalid feature'] }
  }

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { features: true } })
  if (!site) return { status: 'error', errors: ['Site not found'] }

  let features = site.features || []
  if (enabled && !features.includes(feature)) {
    features = [...features, feature]
  } else if (!enabled) {
    features = features.filter(f => f !== feature)
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { features },
  })

  revalidatePath('/sites')
  return { status: 'ok', features }
}
