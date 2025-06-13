'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function getInvoicesByMonth(
  accountId: string,
  year: number,
  month: number // 1-based (Jan = 1)
) {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  
  const userId = session.user.id
  const partnerAccount = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id }
  })
  
  const startDate = new Date(Date.UTC(year, month - 1, 1))
  const endDate = new Date(Date.UTC(year, month, 1)) // first day of next month

  console.log(`Fetching invoices for account ${accountId} from ${startDate.toISOString()} to ${endDate.toISOString()}`)

  const invoices = await prisma.invoice.findMany({
    where: {
      accountId: userId,
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

  return invoices
}

export async function getPaidItemsByMonth(siteId: string, year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

  const [orders, reservations] = await Promise.all([
    prisma.order.findMany({
      where: {
        siteId,
        status: 'paid',
        invoice: {
          invoicedAt: {
            gte: start,
            lt: end,
          }
        }
      },
      include: { invoice: true }
    }),
    prisma.reservation.findMany({
      where: {
        siteId,
        status: 'paid',
        invoice: {
          invoicedAt: {
            gte: start,
            lt: end,
          }
        }
      },
      include: { invoice: true }
    }),
  ])

  return { orders, reservations }
}


