'use server'

import prisma from '@repo/data/PrismaCient'

// ─── Service Fee Resolution (private) ───────────────────────────────────────

async function resolveServiceFees(siteId: string, userId: string) {
  const [site, partnerAccount, settings] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, include: { serviceFees: true } }),
    prisma.partnerAccount.findUnique({ where: { userId }, include: { serviceFees: true } }),
    prisma.settings.findFirst({ include: { serviceFees: true } }),
  ])

  const serviceCodes = ['sunbed-rental', 'food-and-beverage']
  return serviceCodes
    .map(
      (code) =>
        site?.serviceFees?.find((f) => f.serviceCode === code) ||
        partnerAccount?.serviceFees?.find((f) => f.serviceCode === code) ||
        settings?.serviceFees?.find((f) => f.serviceCode === code)
    )
    .filter(Boolean)
}

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
            include: { user: true },
            orderBy: { from: 'asc' },
          },
          pair: true,
          pairedBy: true,
        },
      },
      products: {
        where: { active: true },
      },
    },
  })

  if (site?.userId) {
    const resolvedFees = await resolveServiceFees(siteId, site.userId)
    ;(site as any).serviceFees = resolvedFees
  }

  return site
}
