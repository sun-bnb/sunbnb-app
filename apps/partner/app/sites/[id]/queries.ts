'use server'

import prisma from '@repo/data/PrismaCient'

// ─── Service Fee Resolution (private) ───────────────────────────────────────

// Mirrors loadFeeContext + resolveServiceFee in @repo/data/payment, but
// read-only (no bootstrap side effects on page load). Settings are matched by
// the partner's country, falling back to any Settings row if no match — keep
// this in sync with packages/data/src/payment.ts:loadFeeContext.
async function resolveServiceFees(siteId: string, userId: string) {
  const [site, partnerAccount] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, include: { serviceFees: true } }),
    prisma.partnerAccount.findUnique({
      where: { userId },
      include: {
        serviceFees: true,
        subscription: { include: { plan: { select: { tier: true } } } },
      },
    }),
  ])

  const settingsInclude = {
    serviceFees: {
      where: { siteId: null, accountId: null },
    },
  } as const

  const country = partnerAccount?.country
  let settings = country
    ? await prisma.settings.findFirst({ where: { country }, include: settingsInclude })
    : null
  if (!settings) {
    settings = await prisma.settings.findFirst({ include: settingsInclude })
  }

  const tier = partnerAccount?.subscription?.plan?.tier ?? null
  const serviceCodes = ['sunbed-rental', 'food-and-beverage']
  return serviceCodes
    .map((code) => {
      const siteFee = site?.serviceFees?.find((f) => f.serviceCode === code)
      if (siteFee) return siteFee

      const accountFee = partnerAccount?.serviceFees?.find((f) => f.serviceCode === code)
      if (accountFee) return accountFee

      // Platform fees: prefer tier-specific, fall back to default
      if (tier) {
        const tierFee = settings?.serviceFees?.find(
          (f) => f.serviceCode === code && f.subscriptionTier === tier
        )
        if (tierFee) return tierFee
      }

      return settings?.serviceFees?.find(
        (f) => f.serviceCode === code && f.subscriptionTier === null
      )
    })
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
    const resolvedFees = await resolveServiceFees(siteId, site.userId)
    ;(site as any).serviceFees = resolvedFees
  }

  return site
}
