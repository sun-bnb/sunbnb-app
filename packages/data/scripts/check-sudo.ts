/**
 * One-off: print whether the given email is sudo in the connected DB.
 * Choose env via POSTGRES_URL — pass POSTGRES_URL_TEST in for the test DB.
 *
 * Usage:
 *   POSTGRES_URL=$POSTGRES_URL_TEST npx tsx scripts/check-sudo.ts tiaisenposti@gmail.com
 */
import prisma from '../index'

const email = process.argv[2]
if (!email) {
  console.error('Usage: tsx scripts/check-sudo.ts <email>')
  process.exit(2)
}

async function main() {
  const u = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      sudo: true,
      createdAt: true,
      partnerAccount: { select: { userId: true } },
      _count: { select: { sites: true, reservations: true, orders: true } },
    },
  })
  if (!u) {
    console.log(`No user with email ${email} found in this database.`)
  } else {
    console.log(JSON.stringify(u, null, 2))
  }
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
