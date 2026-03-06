import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.POSTGRES_URL || ''
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Upsert subscription plans
  const starterPlan = await prisma.subscriptionPlan.upsert({
    where: { tier: 'STARTER' },
    update: {},
    create: {
      tier: 'STARTER',
      name: 'Starter',
      monthlyPrice: 0,
      maxSites: 1,
    },
  })
  console.log(`✓ Starter plan: ${starterPlan.id}`)

  const proPlan = await prisma.subscriptionPlan.upsert({
    where: { tier: 'PRO' },
    update: {},
    create: {
      tier: 'PRO',
      name: 'Pro',
      monthlyPrice: 29,
      maxSites: 1,
    },
  })
  console.log(`✓ Pro plan: ${proPlan.id}`)

  const businessPlan = await prisma.subscriptionPlan.upsert({
    where: { tier: 'BUSINESS' },
    update: {},
    create: {
      tier: 'BUSINESS',
      name: 'Business',
      monthlyPrice: 79,
      maxSites: 999,
    },
  })
  console.log(`✓ Business plan: ${businessPlan.id}`)

  // Backfill: assign STARTER to all partners without a subscription
  const partnersWithoutSub = await prisma.partnerAccount.findMany({
    where: { subscription: null },
    select: { userId: true },
  })

  if (partnersWithoutSub.length > 0) {
    console.log(`\nBackfilling ${partnersWithoutSub.length} partner(s) to Starter plan...`)
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
  } else {
    console.log('\nAll partners already have subscriptions.')
  }

  console.log('\nDone!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
