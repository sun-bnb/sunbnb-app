'use server'

import prisma from '@repo/data/PrismaCient'

// ── Admin users ─────────────────────────────────────────────

export async function getAdminUsers() {
  return prisma.adminUser.findMany({
    orderBy: { createdAt: 'desc' },
  })
}

export async function addAdminUser(email: string) {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) {
    return { status: 'error', error: 'Please enter a valid email address' }
  }

  const existing = await prisma.adminUser.findUnique({ where: { email: trimmed } })
  if (existing) {
    return { status: 'error', error: 'This email is already in the admin list' }
  }

  const user = await prisma.adminUser.create({
    data: { email: trimmed },
  })

  return { status: 'ok', user }
}

export async function removeAdminUser(id: string) {
  await prisma.adminUser.delete({ where: { id } })
  return { status: 'ok' }
}

// ── User search & deletion ──────────────────────────────────

export interface UserSearchResult {
  id: string
  name: string | null
  email: string
  createdAt: Date
  _count: {
    reservations: number
    orders: number
    sites: number
  }
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: trimmed, mode: 'insensitive' } },
        { name: { contains: trimmed, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      _count: {
        select: {
          reservations: true,
          orders: true,
          sites: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return users
}

export async function deleteUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      partnerAccount: { select: { userId: true } },
      sites: { select: { id: true } },
      accounts: { select: { provider: true, providerAccountId: true } },
    },
  })

  if (!user) {
    return { status: 'error', error: 'User not found' }
  }

  // Prevent deleting sudo users
  const sudoUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { sudo: true },
  })
  if (sudoUser?.sudo) {
    return { status: 'error', error: 'Cannot delete a sudo user' }
  }

  const siteIds = user.sites.map((s) => s.id)
  const partnerAccountId = user.partnerAccount?.userId

  // 1. Delete Settlements (no cascade from PartnerAccount or Site)
  if (partnerAccountId) {
    await prisma.settlement.deleteMany({ where: { accountId: partnerAccountId } })
  }
  if (siteIds.length > 0) {
    await prisma.settlement.deleteMany({ where: { siteId: { in: siteIds } } })
  }

  // 2. Delete SecurityTokens (no FK relation to User)
  await prisma.securityToken.deleteMany({ where: { userId } })

  // 3. For each OAuth account, check if other users share it
  //    (Account uses @@id([provider, providerAccountId]) and userId FK with cascade)
  //    The Account model cascades on user delete, so it will be cleaned up automatically.

  // 4. Delete the User — cascading deletes handle:
  //    Account, Authenticator, InventoryItem, Order, PartnerAccount (+ Invoice, Subscription, ServiceFee),
  //    Reservation, Session, Site (+ SiteBrand, SiteWorkingHours, Product, etc.)
  await prisma.user.delete({ where: { id: userId } })

  return { status: 'ok', email: user.email }
}
