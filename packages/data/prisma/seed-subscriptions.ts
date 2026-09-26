/**
 * Pricing-tier seed.
 *
 * Projects the published ladder (`PRICING_TIERS` in src/subscription.ts) onto
 * the database:
 *
 *   1. `SubscriptionPlan` — one row per tier (name, monthly price, site cap).
 *   2. `ServiceFee`       — the platform commission, one row per
 *                           tier × commissioned service code, on EVERY
 *                           `Settings` row. Settings are matched by country at
 *                           charge time (`findCountryMatchedSettings`), so a
 *                           country entity without tier rows would silently
 *                           fall back to the tier-null default instead of the
 *                           advertised rate.
 *   3. Backfill           — partners with no subscription get STARTER.
 *
 * Idempotent: re-running updates the catalog fields in place. Stripe product /
 * price IDs are deliberately NOT touched — they are per-environment and set out
 * of band. Negotiated site- or account-level fees are never touched either;
 * this only writes platform-level rows (siteId = NULL, accountId = NULL).
 *
 * Run with POSTGRES_URL pointing at the target DB:
 *   source .env.local && npx tsx prisma/seed-subscriptions.ts
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  PRICING_TIERS,
  PRICING_TIER_ORDER,
  COMMISSIONED_SERVICE_CODES,
} from '../src/subscription'

const connectionString = process.env.POSTGRES_URL || ''
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function seedPlans() {
  console.log('Subscription plans')
  for (const tier of PRICING_TIER_ORDER) {
    const spec = PRICING_TIERS[tier]
    const plan = await prisma.subscriptionPlan.upsert({
      where: { tier },
      // Catalog fields are owned by PRICING_TIERS and re-applied on every run;
      // stripeProductId / stripePriceId stay whatever the environment set.
      update: {
        name: spec.name,
        monthlyPrice: spec.monthlyPrice,
        maxSites: spec.maxSites,
      },
      create: {
        tier,
        name: spec.name,
        monthlyPrice: spec.monthlyPrice,
        maxSites: spec.maxSites,
      },
    })
    console.log(
      `  ✓ ${spec.name.padEnd(8)} €${String(spec.monthlyPrice).padStart(2)}/mo  ` +
        `${spec.maxSites} site(s)  ${spec.commissionPercent}% commission  (${plan.id})`,
    )
  }
}

async function seedCommissionFees() {
  const settingsRows = await prisma.settings.findMany({ select: { id: true, country: true } })

  if (settingsRows.length === 0) {
    console.log('\n! No Settings rows — skipping commission fees.')
    console.log('  Create the platform business entity first, then re-run this seed.')
    return
  }

  console.log('\nPlatform commission (per Settings entity)')
  for (const settings of settingsRows) {
    console.log(`  ${settings.country ?? '—'} (${settings.id})`)
    for (const serviceCode of COMMISSIONED_SERVICE_CODES) {
      for (const tier of PRICING_TIER_ORDER) {
        const percentage = PRICING_TIERS[tier].commissionPercent

        // No unique constraint covers (settingsId, serviceCode, subscriptionTier),
        // so upsert-by-key isn't available — find the platform-level row and
        // update it, or create it. Site/account rows are excluded by the NULL
        // filters so a negotiated fee is never overwritten.
        const existing = await prisma.serviceFee.findFirst({
          where: {
            settingsId: settings.id,
            siteId: null,
            accountId: null,
            serviceCode,
            subscriptionTier: tier,
          },
          select: { id: true },
        })

        if (existing) {
          await prisma.serviceFee.update({
            where: { id: existing.id },
            data: { chargeType: 'percentage', percentage, feeAmount: null },
          })
        } else {
          await prisma.serviceFee.create({
            data: {
              settingsId: settings.id,
              serviceCode,
              subscriptionTier: tier,
              chargeType: 'percentage',
              percentage,
              feeAmount: null,
            },
          })
        }
      }
      const rates = PRICING_TIER_ORDER.map((t) => `${PRICING_TIERS[t].commissionPercent}%`).join(' / ')
      console.log(`    ✓ ${serviceCode.padEnd(18)} ${rates}`)
    }
  }
}

async function backfillStarterSubscriptions() {
  const starterPlan = await prisma.subscriptionPlan.findUnique({ where: { tier: 'STARTER' } })
  if (!starterPlan) throw new Error('STARTER plan missing after seed')

  const partnersWithoutSub = await prisma.partnerAccount.findMany({
    where: { subscription: null },
    select: { userId: true },
  })

  if (partnersWithoutSub.length === 0) {
    console.log('\nAll partners already have subscriptions.')
    return
  }

  console.log(`\nBackfilling ${partnersWithoutSub.length} partner(s) to Starter…`)
  for (const partner of partnersWithoutSub) {
    await prisma.subscription.create({
      data: {
        partnerAccountId: partner.userId,
        planId: starterPlan.id,
        status: 'ACTIVE',
      },
    })
    console.log(`  ✓ ${partner.userId}`)
  }
}

async function main() {
  await seedPlans()
  await seedCommissionFees()
  await backfillStarterSubscriptions()
  console.log('\nDone!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
