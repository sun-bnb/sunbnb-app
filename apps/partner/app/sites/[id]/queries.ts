'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { resolveSiteFees } from '@repo/data/payment'
import { INVENTORY_ITEM_SELECT } from './item-select'

// ─── Scoped Item Refresh ────────────────────────────────────────────────────

/**
 * Re-fetch ONLY the given inventory items, with the exact per-item include
 * shape `getSite` ships, so a mutation handler can merge them into the site
 * context instead of re-downloading the whole site (track 020 — on a
 * 4,436-item site the full-site refresh after a parcel rotation measured
 * 951ms server + a 5.8MB response, dominating the click regardless of parcel
 * size).
 *
 * Ownership enforced the same way as getSite: unauthenticated and non-owners
 * get null (callers fall back to a full refresh on null).
 */
export async function getInventoryItems(siteId: string, itemIds: string[]) {
  const session = await auth()
  if (!session?.user) return null

  const owned = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { id: true },
  })
  if (!owned) return null
  if (itemIds.length === 0) return []

  return prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    orderBy: { number: 'asc' },
    select: {
      ...INVENTORY_ITEM_SELECT,
      sunbedGroup: { select: { id: true, items: { select: { id: true } } } },
    },
  })
}

/**
 * Seats for specific parcels (track 020 C2 slice 2) — the streaming half of
 * the parcel tier: the overview ships ~12 ParcelSummary rows, and these load
 * only when a parcel is opened or scrolls into the seat-zoom viewport.
 * Served by the P1 `(site_id, group)` index. Same gate and same projection as
 * `getInventoryItems`, so merged rows stay shape-identical.
 */
export async function getItemsByGroups(siteId: string, groups: number[]) {
  const session = await auth()
  if (!session?.user) return null

  const owned = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { id: true },
  })
  if (!owned) return null
  if (groups.length === 0) return []

  return prisma.inventoryItem.findMany({
    where: { siteId, group: { in: groups } },
    orderBy: { number: 'asc' },
    select: {
      ...INVENTORY_ITEM_SELECT,
      sunbedGroup: { select: { id: true, items: { select: { id: true } } } },
    },
  })
}

// ─── Full Site Query ────────────────────────────────────────────────────────

export async function getSite(siteId: string) {
  const session = await auth()
  if (!session?.user) return null

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    include: {
      workingHours: true,
      inventoryItems: {
        orderBy: { number: 'asc' },
        select: {
          ...INVENTORY_ITEM_SELECT,
          sunbedGroup: { select: { id: true, items: { select: { id: true } } } },
        },
      },
      layoutElements: true,
      products: {
        where: { active: true },
      },
    },
  })

  if (site?.userId) {
    ;(site as any).serviceFees = await resolveSiteFees(siteId, [
      'sunbed-rental',
      'food-and-beverage',
    ])
  }

  return site
}
