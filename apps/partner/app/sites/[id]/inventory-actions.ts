'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { isValidItemStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
import { recomputeSeatLabels } from '@repo/data/seat-label-db'

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

  await recomputeSeatLabels(inventoryItem.siteId)
  revalidatePath('/sites')
  return { status: 'ok', item }
}

// ─── Delete Inventory Item ──────────────────────────────────────────────────

export async function deleteInventoryItem(id: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { siteId: true, site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const deletedSiteId = item.siteId

  // Load item to get its sunbedGroupId before deletion
  const itemForGroup = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { sunbedGroupId: true },
  })

  await prisma.$transaction([
    // Clear sunbedGroupId on all siblings so they are detached from this group
    ...(itemForGroup?.sunbedGroupId
      ? [prisma.inventoryItem.updateMany({
          where: { sunbedGroupId: itemForGroup.sunbedGroupId },
          data: { sunbedGroupId: null },
        })]
      : []),
    prisma.inventoryItem.updateMany({ where: { pairId: id }, data: { pairId: null } }),
    prisma.inventoryItem.delete({ where: { id } }),
  ])

  // Delete the now-empty SunbedGroup (must be outside $transaction so the item
  // deletion FK is already committed before we check emptiness).
  if (itemForGroup?.sunbedGroupId) {
    const remaining = await prisma.inventoryItem.count({
      where: { sunbedGroupId: itemForGroup.sunbedGroupId },
    })
    if (remaining === 0) {
      await prisma.sunbedGroup.delete({ where: { id: itemForGroup.sunbedGroupId } })
    }
  }

  await recomputeSeatLabels(deletedSiteId)
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
    select: { siteId: true, site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const itemSiteId = item.siteId

  const pairItem = inventoryItem.pairId
    ? await prisma.inventoryItem.findUnique({ where: { id: inventoryItem.pairId }, select: { id: true, siteId: true } })
    : undefined

  if (pairItem) {
    // Verify the pair item belongs to the same site
    if (pairItem.siteId !== itemSiteId) {
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

  // Dual-write: when a pair is being connected, also assign a 2-member SunbedGroup.
  if (pairItem && inventoryItem.pairId) {
    // Fetch current sunbedGroupIds for both items
    const [currentItem, currentPair] = await Promise.all([
      prisma.inventoryItem.findUnique({ where: { id }, select: { sunbedGroupId: true } }),
      prisma.inventoryItem.findUnique({ where: { id: inventoryItem.pairId }, select: { sunbedGroupId: true } }),
    ])

    // Detach both from any prior groups and delete groups that become empty
    const priorGroupIds = new Set(
      [currentItem?.sunbedGroupId, currentPair?.sunbedGroupId].filter(Boolean) as string[]
    )
    if (priorGroupIds.size > 0) {
      await prisma.inventoryItem.updateMany({
        where: { sunbedGroupId: { in: [...priorGroupIds] } },
        data: { sunbedGroupId: null },
      })
      for (const gid of priorGroupIds) {
        const cnt = await prisma.inventoryItem.count({ where: { sunbedGroupId: gid } })
        if (cnt === 0) await prisma.sunbedGroup.delete({ where: { id: gid } })
      }
    }

    const newGroup = await prisma.sunbedGroup.create({
      data: {
        siteId: itemSiteId,
        items: { connect: [{ id }, { id: inventoryItem.pairId }] },
      },
    })
    // Explicitly set sunbedGroupId on both items (connect above sets it via relation)
    await prisma.inventoryItem.updateMany({
      where: { id: { in: [id, inventoryItem.pairId] } },
      data: { sunbedGroupId: newGroup.id },
    })
  }

  await recomputeSeatLabels(itemSiteId)
  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Pair / Depair Items ─────────────────────────────────────────────────────

export async function pairInventoryItems(id1: string, id2: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const [item1, item2] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id: id1 }, select: { siteId: true, site: { select: { userId: true } } } }),
    prisma.inventoryItem.findUnique({ where: { id: id2 }, select: { siteId: true } }),
  ])
  if (!item1 || item1.site.userId !== session.user.id) return { status: 'error', errors: ['Not authorized'] }
  if (!item2 || item2.siteId !== item1.siteId) return { status: 'error', errors: ['Items must belong to the same site'] }

  // Fetch current sunbedGroupIds for both items so we can clean up prior groups
  const [prior1, prior2] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id: id1 }, select: { sunbedGroupId: true } }),
    prisma.inventoryItem.findUnique({ where: { id: id2 }, select: { sunbedGroupId: true } }),
  ])
  const priorGroupIds = new Set(
    [prior1?.sunbedGroupId, prior2?.sunbedGroupId].filter(Boolean) as string[]
  )

  await prisma.$transaction([
    // Detach both items from any prior SunbedGroups
    ...(priorGroupIds.size > 0
      ? [prisma.inventoryItem.updateMany({
          where: { sunbedGroupId: { in: [...priorGroupIds] } },
          data: { sunbedGroupId: null },
        })]
      : []),
    prisma.inventoryItem.update({ where: { id: id1 }, data: { pairId: id2 } }),
    prisma.inventoryItem.update({ where: { id: id2 }, data: { pairId: id1 } }),
  ])

  // Delete prior groups now empty (outside transaction so FK is committed first)
  for (const gid of priorGroupIds) {
    const cnt = await prisma.inventoryItem.count({ where: { sunbedGroupId: gid } })
    if (cnt === 0) await prisma.sunbedGroup.delete({ where: { id: gid } })
  }

  // Create new 2-member SunbedGroup and assign both items to it
  const newGroup = await prisma.sunbedGroup.create({
    data: {
      siteId: item1.siteId,
      items: { connect: [{ id: id1 }, { id: id2 }] },
    },
  })
  await prisma.inventoryItem.updateMany({
    where: { id: { in: [id1, id2] } },
    data: { sunbedGroupId: newGroup.id },
  })

  await recomputeSeatLabels(item1.siteId)
  revalidatePath('/sites')
  return { status: 'ok' }
}

export async function depairInventoryItem(id: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { siteId: true, pairId: true, sunbedGroupId: true, site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) return { status: 'error', errors: ['Not authorized'] }

  // Clear sunbedGroupId on all members of this item's group, then delete the group
  if (item.sunbedGroupId) {
    await prisma.inventoryItem.updateMany({
      where: { sunbedGroupId: item.sunbedGroupId },
      data: { sunbedGroupId: null },
    })
    const remaining = await prisma.inventoryItem.count({
      where: { sunbedGroupId: item.sunbedGroupId },
    })
    if (remaining === 0) {
      await prisma.sunbedGroup.delete({ where: { id: item.sunbedGroupId } })
    }
  }

  // Clear the legacy pairId mirror in BOTH directions. Bulk-generated pairs are
  // one-directional (only the primary holds pairId; the secondary is linked
  // solely via the pairedBy reverse-relation). Clearing only `id` and its
  // forward `pairId` target would leave the primary still pointing at a depaired
  // secondary, so the pair (and the pairedBy-driven UI state) would survive.
  // Clear the item, whatever it points to, and whatever points to it.
  await prisma.inventoryItem.updateMany({
    where: {
      OR: [
        { id },
        { pairId: id },
        ...(item.pairId ? [{ id: item.pairId }] : []),
      ],
    },
    data: { pairId: null },
  })

  await recomputeSeatLabels(item.siteId)
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
