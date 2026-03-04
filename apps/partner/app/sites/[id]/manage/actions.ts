'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import dayjs from 'dayjs'

// ─── Reserve Item (walk-in / cash) ──────────────────────────────────────────

export async function reserveItem(
  siteId: string,
  itemId: string
) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  // Verify the partner owns this site
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    include: { pairedBy: true },
  })

  if (!item) {
    return { status: 'error', errors: ['Item not found'] }
  }

  // Include paired item if applicable
  let pairItem = item.pairedBy
  if (!pairItem && item.pairId) {
    pairItem = await prisma.inventoryItem.findUnique({
      where: { id: item.pairId },
    })
  }

  const itemIds = [{ id: item.id }]
  if (pairItem) {
    itemIds.push({ id: pairItem.id })
  }

  // Create a same-day walk-in reservation owned by the partner
  await prisma.reservation.create({
    data: {
      userId: session.user.id,
      type: 'days',
      from: dayjs().startOf('day').toDate(),
      to: dayjs().endOf('day').toDate(),
      siteId,
      status: 'paid-in-cash',
      items: { connect: itemIds },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Unreserve Item ─────────────────────────────────────────────────────────

export async function unreserveItem(siteId: string, itemId: string) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  // Verify the partner owns this site
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  // Only delete today's walk-in reservations for this item
  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  await prisma.reservation.deleteMany({
    where: {
      siteId,
      status: 'paid-in-cash',
      from: { gte: todayStart },
      to: { lte: todayEnd },
      items: { some: { id: itemId } },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}