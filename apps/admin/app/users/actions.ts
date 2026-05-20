'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  createImpersonationToken,
  type ImpersonationApp,
} from '@repo/data/impersonation'
import { LIST_USERS_PAGE_SIZE } from './constants'

// ─── Auth guard ─────────────────────────────────────────────

async function requireSudo() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) throw new Error('Unauthorized — sudo required')
  return session
}

// ── Admin users ─────────────────────────────────────────────

export async function getAdminUsers() {
  await requireSudo()
  return prisma.adminUser.findMany({
    orderBy: { createdAt: 'desc' },
  })
}

export async function addAdminUser(email: string) {
  await requireSudo()
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { status: 'error', errors: ['Please enter a valid email address'] }
  }

  const existing = await prisma.adminUser.findUnique({ where: { email: trimmed } })
  if (existing) {
    return { status: 'error', errors: ['This email is already in the admin list'] }
  }

  const user = await prisma.adminUser.create({
    data: { email: trimmed },
  })

  return { status: 'ok', user }
}

export async function removeAdminUser(id: string) {
  const session = await requireSudo()

  // Self-removal protection
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  })
  const target = await prisma.adminUser.findUnique({ where: { id } })
  if (currentUser?.email && target?.email &&
      currentUser.email.toLowerCase() === target.email.toLowerCase()) {
    return { status: 'error', errors: ['Cannot remove your own admin access'] }
  }

  await prisma.adminUser.delete({ where: { id } })
  return { status: 'ok' }
}

// ── User search & deletion ──────────────────────────────────

export type UserAppRole = 'partner' | 'user' | 'both' | 'none'

export interface UserSearchResult {
  id: string
  name: string | null
  email: string
  createdAt: Date
  appRole: UserAppRole
  partnerAccountId: string | null
  _count: {
    reservations: number
    orders: number
    sites: number
  }
}

const USER_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  partnerAccount: { select: { userId: true } },
  _count: {
    select: {
      reservations: true,
      orders: true,
      sites: true,
    },
  },
} as const

interface UserRowWithRelations {
  id: string
  name: string | null
  email: string
  createdAt: Date
  partnerAccount: { userId: string } | null
  _count: { reservations: number; orders: number; sites: number }
}

/**
 * Derive which app(s) a user is active in.
 * - Partner: has a PartnerAccount (defensively, also if they own sites).
 * - User: has any reservations or orders.
 */
function deriveAppRole(u: UserRowWithRelations): UserAppRole {
  const isPartner = !!u.partnerAccount || u._count.sites > 0
  const isConsumer = u._count.reservations > 0 || u._count.orders > 0
  if (isPartner && isConsumer) return 'both'
  if (isPartner) return 'partner'
  if (isConsumer) return 'user'
  return 'none'
}

function toSearchResult(u: UserRowWithRelations): UserSearchResult {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.createdAt,
    appRole: deriveAppRole(u),
    partnerAccountId: u.partnerAccount?.userId ?? null,
    _count: u._count,
  }
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  await requireSudo()
  const trimmed = query.trim()
  if (!trimmed) return []

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: trimmed, mode: 'insensitive' } },
        { name: { contains: trimmed, mode: 'insensitive' } },
      ],
    },
    select: USER_LIST_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return users.map(toSearchResult)
}

export interface ListUsersPage {
  users: UserSearchResult[]
  total: number
  page: number
  pageSize: number
}

/**
 * Paged list of all users, newest first. Page is 1-indexed. Pages past the
 * end return an empty `users` array; the client uses `total` to disable Next.
 */
export async function listUsers(page = 1): Promise<ListUsersPage> {
  await requireSudo()
  const pageSize = LIST_USERS_PAGE_SIZE
  const safePage = Math.max(1, Math.floor(Number(page) || 1))

  const [total, users] = await Promise.all([
    prisma.user.count(),
    prisma.user.findMany({
      select: USER_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return { users: users.map(toSearchResult), total, page: safePage, pageSize }
}

// ── Impersonation ──────────────────────────────────────────────────────────

const PARTNER_APP_URL =
  process.env.PARTNER_APP_URL ?? 'https://local.sunbnb.app:3001'
const USER_APP_URL =
  process.env.USER_APP_URL ?? 'https://local.sunbnb.app:3002'

export type StartImpersonationResult =
  | { status: 'ok'; url: string }
  | { status: 'error'; errors: string[] }

/**
 * Generate a single-use impersonation token for the given user and return the
 * URL the admin's browser should be sent to. The token replay-protection +
 * audit log are enforced inside `consumeImpersonationToken` in the target app.
 *
 * Refuses:
 *  - non-sudo callers (throws via requireSudo)
 *  - target is sudo
 *  - target is the admin themselves
 *  - target lacks the role for the requested app (e.g. no partnerAccount for
 *    `app: 'partner'`)
 */
export async function startImpersonation(
  targetUserId: string,
  app: ImpersonationApp,
): Promise<StartImpersonationResult> {
  const session = await requireSudo()

  if (app !== 'partner' && app !== 'user') {
    return { status: 'error', errors: [`Invalid app: ${app}`] }
  }
  if (!targetUserId) {
    return { status: 'error', errors: ['Missing target user id'] }
  }
  if (targetUserId === session.user.id) {
    return {
      status: 'error',
      errors: ['Cannot impersonate yourself — use a real login instead.'],
    }
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      sudo: true,
      partnerAccount: { select: { userId: true } },
      _count: {
        select: { sites: true, reservations: true, orders: true },
      },
    },
  })

  if (!target) {
    return { status: 'error', errors: ['User not found'] }
  }
  if (target.sudo) {
    return {
      status: 'error',
      errors: ['Cannot impersonate a sudo user — privilege-escalation guard.'],
    }
  }

  const isPartner = !!target.partnerAccount || target._count.sites > 0
  const isConsumer = target._count.reservations > 0 || target._count.orders > 0
  if (app === 'partner' && !isPartner) {
    return {
      status: 'error',
      errors: ['Target user has no partner activity.'],
    }
  }
  if (app === 'user' && !isConsumer) {
    return {
      status: 'error',
      errors: ['Target user has no consumer activity.'],
    }
  }

  const { token } = createImpersonationToken({
    adminId: session.user.id,
    targetUserId,
    app,
  })
  const base = app === 'partner' ? PARTNER_APP_URL : USER_APP_URL
  return { status: 'ok', url: `${base}/api/auth/impersonate?token=${token}` }
}

export async function deleteUser(userId: string) {
  await requireSudo()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      sudo: true,
      partnerAccount: { select: { userId: true } },
      sites: { select: { id: true } },
      accounts: { select: { provider: true, providerAccountId: true } },
    },
  })

  if (!user) {
    return { status: 'error', errors: ['User not found'] }
  }

  // Prevent deleting sudo users
  if (user.sudo) {
    return { status: 'error', errors: ['Cannot delete a sudo user'] }
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
