'use server'

import { revalidatePath } from 'next/cache'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { isValidOrderStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'

export async function setOrderStatus(siteId: string, orderId: string, status: string) {

  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  if (!isValidOrderStatus(status)) {
    return { status: 'error', errors: ['Invalid order status'] }
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

  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

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