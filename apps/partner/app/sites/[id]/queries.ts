'use server'

import prisma from '@repo/data/PrismaCient'
import { resolveSiteFees } from '@repo/data/payment'

// ─── Full Site Query ────────────────────────────────────────────────────────

export async function getSite(siteId: string) {
  const site = await prisma.site.findFirst({
    where: { id: siteId },
    include: {
      workingHours: true,
      inventoryItems: {
        orderBy: { number: 'asc' },
        include: {
          reservations: {
            include: { user: { select: { id: true, email: true } } },
            orderBy: { from: 'asc' },
          },
          pair: true,
          pairedBy: true,
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
