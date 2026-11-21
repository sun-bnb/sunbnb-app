/**
 * Pricing-plan seed (Starter / Pro / Business).
 *
 * Projects the published catalogue (`PRICING_TIERS` in src/pricing-tiers.ts)
 * onto the database:
 *
 *   1. `SubscriptionPlan` — exactly one row per plan (name, monthly price, site
 *                           and hamaca limits, monthly commission cap).
 *   2. `ServiceFee`       — the platform commission, one row per
 *                           tier × commissioned service code, on EVERY
 *                           `Settings` row. Settings are matched by country at
 *                           charge time (`findCountryMatchedSettings`), so a
 *                           country entity without tier rows would silently
 *                           fall back to the tier-null default instead of the
 *                           advertised rate.
 *   3. Backfill           — partners with no subscription get Starter.
 *
 * Idempotent: re-running changes nothing (rows are only written when a catalog
 * field differs). Stripe product / price IDs are per environment and set on the
 * Pro and Business rows out of band (admin or SQL), never here. Negotiated
 * site- or account-level fees are never touched either; this only writes
 * platform-level rows (siteId = NULL, accountId = NULL).
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
  DEFAULT_TIER,
  planRowMaxSites,
} from '../src/pricing-tiers'

const connectionString = process.env.POSTGRES_URL || ''
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

let changed = 0

async function seedPlans() {
  console.log('Subscription plans')
  for (const tier of PRICING_TIER_ORDER) {
    const spec = PRICING_TIERS[tier]
    const fields = {
      name: spec.name,
      monthlyPrice: spec.monthlyPrice,
      maxSites: planRowMaxSites(tier),
      maxHamacasPerSite: spec.maxHamacasPerSite,
      monthlyCommissionCapPerSite: spec.monthlyCommissionCapPerSite,
    }
    const existing = await prisma.subscriptionPlan.findUnique({ where: { tier } })
    let action = 'unchanged'
    let id = existing?.id
    if (!existing) {
      id = (await prisma.subscriptionPlan.create({ data: { tier, ...fields } })).id
      action = 'created'
    } else if (
      (Object.keys(fields) as (keyof typeof fields)[]).some((k) => existing[k] !== fields[k])
    ) {
      await prisma.subscriptionPlan.update({ where: { tier }, data: fields })
      action = 'updated'
    }
    if (action !== 'unchanged') changed++
    const pct = COMMISSIONED_SERVICE_CODES.map((c) => `${c} ${spec.commissionPercent[c]}%`).join(', ')
    console.log(
      `  ${action.padEnd(9)} ${spec.name.padEnd(9)} sites ${fields.maxSites}  ` +
        `hamacas ${spec.maxHamacasPerSite ?? 'custom'}  cap ${spec.monthlyCommissionCapPerSite ?? '—'}  (${pct})  (${id})`,
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
        const percentage = PRICING_TIERS[tier].commissionPercent[serviceCode]

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
          select: { id: true, chargeType: true, percentage: true, feeAmount: true },
        })

        if (existing) {
          if (
            existing.chargeType !== 'percentage' ||
            existing.percentage !== percentage ||
            existing.feeAmount !== null
          ) {
            await prisma.serviceFee.update({
              where: { id: existing.id },
              data: { chargeType: 'percentage', percentage, feeAmount: null },
            })
            changed++
          }
        } else {
          changed++
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
      const rates = PRICING_TIER_ORDER.map((t) => `${PRICING_TIERS[t].commissionPercent[serviceCode]}%`).join(' / ')
      console.log(`    ✓ ${serviceCode.padEnd(18)} ${rates}`)
    }
  }
}

async function backfillDefaultSubscriptions() {
  const defaultPlan = await prisma.subscriptionPlan.findUnique({ where: { tier: DEFAULT_TIER } })
  if (!defaultPlan) throw new Error(`${DEFAULT_TIER} plan missing after seed`)

  const partnersWithoutSub = await prisma.partnerAccount.findMany({
    where: { subscription: null },
    select: { userId: true },
  })

  if (partnersWithoutSub.length === 0) {
    console.log('\nAll partners already have subscriptions.')
    return
  }

  console.log(`\nBackfilling ${partnersWithoutSub.length} partner(s) to ${PRICING_TIERS[DEFAULT_TIER].name}…`)
  for (const partner of partnersWithoutSub) {
    await prisma.subscription.create({
      data: {
        partnerAccountId: partner.userId,
        planId: defaultPlan.id,
        status: 'ACTIVE',
      },
    })
    changed++
    console.log(`  ✓ ${partner.userId}`)
  }
}

async function main() {
  await seedPlans()
  await seedCommissionFees()
  await backfillDefaultSubscriptions()
  const plans = await prisma.subscriptionPlan.count()
  console.log(`\nDone! ${plans} plan row(s); ${changed} row(s) written this run.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
