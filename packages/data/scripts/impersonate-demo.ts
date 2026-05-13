/**
 * One-off: generate impersonation URLs for testing the Phase 2 receiving
 * endpoints. Picks the first sudo user as admin, finds a non-sudo target
 * with a partnerAccount (for the partner URL) and one with reservations or
 * orders (for the user URL).
 *
 * Run: `source ../../apps/partner/.env.local && source .env.local && npx tsx scripts/impersonate-demo.ts`
 *
 * Tokens are valid for 5 minutes. Keep them out of chat logs.
 */
import prisma from '../index'
import { createImpersonationToken } from '../src/impersonation'

const PARTNER_BASE = process.env.PARTNER_APP_URL ?? 'https://local.sunbnb.app:3001'
const USER_BASE = process.env.USER_APP_URL ?? 'https://local.sunbnb.app:3002'

async function main() {
  if (!process.env.AUTH_SECRET) {
    throw new Error(
      'AUTH_SECRET is not set. Source one of the apps\' .env.local first.',
    )
  }

  const admin = await prisma.user.findFirst({
    where: { sudo: true },
    select: { id: true, email: true },
  })
  if (!admin) {
    throw new Error('No sudo user found in this database.')
  }

  const partnerTarget = await prisma.user.findFirst({
    where: { sudo: false, partnerAccount: { isNot: null } },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  })

  const userTarget = await prisma.user.findFirst({
    where: {
      sudo: false,
      OR: [
        { reservations: { some: {} } },
        { orders: { some: {} } },
      ],
    },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  })

  const fallbackTarget = partnerTarget ?? userTarget
  if (!fallbackTarget) {
    throw new Error('No suitable non-sudo target user found.')
  }

  console.log(`Admin (impersonator): ${admin.email} (${admin.id})`)
  console.log()

  if (partnerTarget) {
    const { token, tokenId, expiresAt } = createImpersonationToken({
      adminId: admin.id,
      targetUserId: partnerTarget.id,
      app: 'partner',
    })
    console.log('── PARTNER ──────────────────────────────────────')
    console.log(`Target: ${partnerTarget.email} (${partnerTarget.id})`)
    console.log(`JTI:    ${tokenId}`)
    console.log(`Expires: ${expiresAt.toISOString()}`)
    console.log(`URL:`)
    console.log(`${PARTNER_BASE}/api/auth/impersonate?token=${token}`)
    console.log()
  } else {
    console.log('── PARTNER: no eligible target (no non-sudo user has a partnerAccount)')
    console.log()
  }

  if (userTarget) {
    const { token, tokenId, expiresAt } = createImpersonationToken({
      adminId: admin.id,
      targetUserId: userTarget.id,
      app: 'user',
    })
    console.log('── USER ─────────────────────────────────────────')
    console.log(`Target: ${userTarget.email} (${userTarget.id})`)
    console.log(`JTI:    ${tokenId}`)
    console.log(`Expires: ${expiresAt.toISOString()}`)
    console.log(`URL:`)
    console.log(`${USER_BASE}/api/auth/impersonate?token=${token}`)
    console.log()
  } else {
    console.log('── USER: no eligible target (no non-sudo user has reservations or orders)')
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
