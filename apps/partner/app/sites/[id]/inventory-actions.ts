'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { isValidItemStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'

// ─── Create Inventory Item ──────────────────────────────────────────────────

export async function createInventoryItem(inventoryItem: { siteId: string }) {
  const { session, error } = await requireSiteOwner(inventoryItem.siteId)
  if (error) return { status: 'error', errors: [error] }

  const lastItem = await prisma.inventoryItem.findFirst({
    where: { siteId: inventoryItem.siteId },
    orderBy: { number: 'desc' },
  })

  const item = await prisma.inventoryItem.create({
    data: {
      number: (lastItem?.number || 0) + 1,
      siteId: inventoryItem.siteId,
      userId: session.user.id,
      status: 'new',
      locationLat: '0',
      locationLng: '0',
    },
  })

  revalidatePath('/sites')
  return { status: 'ok', item }
}

// ─── Delete Inventory Item ──────────────────────────────────────────────────

export async function deleteInventoryItem(id: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  await prisma.inventoryItem.delete({ where: { id } })
  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Update Item Location ───────────────────────────────────────────────────

export async function saveInventoryItemLocation(
  id: string,
  inventoryItem: { locationLat: string; locationLng: string }
) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  await prisma.inventoryItem.update({
    where: { id },
    data: {
      status: 'active',
      locationLat: inventoryItem.locationLat,
      locationLng: inventoryItem.locationLng,
    },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Update Item Schematic Location ─────────────────────────────────────────

export async function saveInventoryItemSchematicLocation(
  id: string,
  x: number,
  y: number,
) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { status: 'error', errors: ['Invalid coordinates'] }
  }
  if (x < -10000 || x > 10000 || y < -10000 || y > 10000) {
    return { status: 'error', errors: ['Coordinates out of range'] }
  }

  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  await prisma.inventoryItem.update({
    where: { id },
    data: {
      status: 'active',
      schematicX: x,
      schematicY: y,
    },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Update Item Properties ─────────────────────────────────────────────────

export async function saveInventoryItemProperties(
  id: string,
  inventoryItem: {
    category?: string
    price?: number
    rotation?: number
    number?: number
    group?: number
    label?: string
    pairId?: string
    status?: string
  }
) {
  // Input validation
  if (inventoryItem.label !== undefined && typeof inventoryItem.label === 'string' && inventoryItem.label.length > 100) {
    return { status: 'error', errors: ['Label is too long (max 100)'] }
  }
  if (inventoryItem.category !== undefined && typeof inventoryItem.category === 'string' && inventoryItem.category.length > 50) {
    return { status: 'error', errors: ['Category is too long (max 50)'] }
  }
  if (inventoryItem.price !== undefined && inventoryItem.price !== null && (isNaN(Number(inventoryItem.price)) || Number(inventoryItem.price) < 0 || Number(inventoryItem.price) > 100000)) {
    return { status: 'error', errors: ['Price must be 0–100,000'] }
  }
  if (inventoryItem.rotation !== undefined && inventoryItem.rotation !== null && (isNaN(Number(inventoryItem.rotation)) || Number(inventoryItem.rotation) < 0 || Number(inventoryItem.rotation) > 360)) {
    return { status: 'error', errors: ['Rotation must be 0–360'] }
  }
  if (inventoryItem.number !== undefined && inventoryItem.number !== null && (isNaN(Number(inventoryItem.number)) || Number(inventoryItem.number) < 0 || Number(inventoryItem.number) > 99999)) {
    return { status: 'error', errors: ['Item number must be 0–99,999'] }
  }
  if (inventoryItem.group !== undefined && inventoryItem.group !== null && (isNaN(Number(inventoryItem.group)) || Number(inventoryItem.group) < 0 || Number(inventoryItem.group) > 9999)) {
    return { status: 'error', errors: ['Group must be 0–9,999'] }
  }
  if (inventoryItem.status !== undefined && !isValidItemStatus(inventoryItem.status)) {
    return { status: 'error', errors: ['Invalid item status'] }
  }

  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const pairItem = inventoryItem.pairId
    ? await prisma.inventoryItem.findUnique({ where: { id: inventoryItem.pairId }, select: { id: true, siteId: true } })
    : undefined

  if (pairItem) {
    // Verify the pair item belongs to the same site
    const currentItem = await prisma.inventoryItem.findUnique({
      where: { id },
      select: { siteId: true },
    })
    if (pairItem.siteId !== currentItem?.siteId) {
      return { status: 'error', errors: ['Pair item must belong to the same site'] }
    }
  }

  await prisma.inventoryItem.update({
    where: { id },
    data: {
      category: inventoryItem.category,
      price: inventoryItem.price,
      rotation: inventoryItem.rotation,
      number: inventoryItem.number,
      group: inventoryItem.group,
      label: inventoryItem.label,
      status: inventoryItem.status,
      pair: pairItem ? { connect: { id: inventoryItem.pairId } } : undefined,
    },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Delete Parcel (all items in a group) ───────────────────────────────────

export async function deleteItemsByGroup(siteId: string, group: number) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const items = await prisma.inventoryItem.deleteMany({
    where: { siteId, group },
  })

  revalidatePath(`/sites/${siteId}/inventory`)
  return { status: 'ok' }
}
