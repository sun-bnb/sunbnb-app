'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function setOrderStatus(siteId: string, orderId: string, status: string) {

  const session = await auth();
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] };
  }

  await prisma.order.update({
    where: {
      id: orderId
    },
    data: {
      status: status
    }
  });
  revalidatePath(`/sites/${siteId}/orders`);

  return { status: 'ok' };
}

export async function getOrders(siteId: string): Promise<{ status: string, errors?: string[], orders?: any[] }> {

  const session = await auth();
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] };
  }

  const orders = await prisma.order.findMany({ 
    where: { 
      siteId: siteId,
      status: { in: [ 'paid', 'complete' ] }
    },
    include: {
      seat: true,
      orderItems: true
    }
  })

  return { status: 'ok', orders }

}