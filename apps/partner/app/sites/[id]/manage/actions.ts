'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import dayjs from 'dayjs'

export async function reserveItem(
  siteId: string,
  itemId: string
) {
  
  const session = await auth()
  console.log('RESERVE ITEM', itemId, session)

  // if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const adminUser = await prisma.user.findFirst({
    where: {
      email: 'vhalme@gmail.com'
    }
  })

  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    include: {
      pairedBy: true
    }
  })

  if (!item) {
    return { status: 'error', errors: ['Item not found'] }
  }

  let pairItem = item.pairedBy
  if (!pairItem && item.pairId) {
    pairItem = await prisma.inventoryItem.findUnique({
      where: { id: item.pairId }
    })
  }

  const itemIds = [{ id: item.id }]
  if (pairItem) {
    itemIds.push({ id: pairItem.id })
  }

  const reservation = await prisma.reservation.create({
    data: {
      userId: adminUser!.id,
      type: 'days',
      from: dayjs().startOf('day').toDate(),
      to: dayjs().endOf('day').toDate(),
      siteId,
      status: 'paid-in-cash',
      items: {
        connect: itemIds
      }
    }
  })
  

  console.log('RESERVATION', reservation.to, reservation.from)
  
  revalidatePath(`/sites/${reservation?.siteId}/manage`)

  return { status: 'ok' }
  
}

export async function unreserveItem(siteId: string, itemId: string) {

  const session = await auth();
  console.log('UNRESERVE ITEM', itemId, session);

  // if (!session?.user) {
  //  return { status: 'error', errors: ['Not authenticated'] };
  //}

  // Example: remove today's reservation for that item
  // Adjust logic to match your schema (maybe just delete the row, or set status)
  const result = await prisma.reservation.deleteMany({
    where: {
      status: 'paid-in-cash',
      items: {
        some: {
          id: itemId
        }
      },
      siteId
    }
  });

  console.log('UNRESERVE RESULT', result.count)
  revalidatePath(`/sites/${siteId}/manage`);

  return { status: 'ok' };
}