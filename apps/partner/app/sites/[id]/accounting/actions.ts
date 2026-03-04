'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function getInvoicesByMonth(
  accountId: string,
  year: number,
  month: number
) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const startDate = new Date(Date.UTC(year, month - 1, 1))
  const endDate = new Date(Date.UTC(year, month, 1))

  return prisma.invoice.findMany({
    where: {
      accountId: session.user.id,
      invoicedAt: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      invoiceLines: true,
    },
    orderBy: { invoicedAt: 'desc' },
  })
  // Note: issuerType, issuerVatNumber, settlementId are scalar fields on Invoice,
  // so they are included by default in all invoice queries.
}

export async function getPaidItemsByMonth(siteId: string, year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

  const [orders, reservations] = await Promise.all([
    prisma.order.findMany({
      where: {
        siteId,
        status: { in: ['paid', 'complete'] },
        invoice: {
          invoicedAt: { gte: start, lt: end },
        },
      },
      include: {
        invoice: {
          include: { invoiceLines: true },
        },
        orderItems: true,
        seat: { select: { number: true } },
        user: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.reservation.findMany({
      where: {
        siteId,
        status: { in: ['paid', 'complete'] },
        invoice: {
          invoicedAt: { gte: start, lt: end },
        },
      },
      include: {
        invoice: {
          include: { invoiceLines: true },
        },
        user: { select: { email: true } },
        items: { select: { number: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return { orders, reservations }
}