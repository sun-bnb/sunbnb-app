'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
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
    ? await prisma.inventoryItem.findUnique({ where: { id: inventoryItem.pairId } })
    : undefined

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
  return items
}
