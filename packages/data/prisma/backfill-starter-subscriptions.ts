import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.POSTGRES_URL || ''
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  const starterPlan = await prisma.subscriptionPlan.findUnique({ where: { tier: 'STARTER' } })
  if (!starterPlan) {
    console.log('No STARTER plan found')
    return
  }

  const partners = await prisma.partnerAccount.findMany({
    where: { subscription: null },
    select: { userId: true },
  })

  console.log(`Partners without subscription: ${partners.length}`)

  for (const pa of partners) {
    await prisma.subscription.create({
      data: {
        partnerAccountId: pa.userId,
        planId: starterPlan.id,
        status: 'ACTIVE',
      },
    })
    console.log(`Created STARTER subscription for ${pa.userId}`)
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
