'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { AUDIT_PAGE_SIZE } from './constants'

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

export interface AuditRow {
  id: string
  adminId: string
  adminEmail: string | null
  targetUserId: string
  targetEmail: string | null
  app: string
  startedAt: Date
  endedAt: Date | null
  durationSeconds: number | null
  ip: string | null
  userAgent: string | null
}

export interface AuditPage {
  logs: AuditRow[]
  total: number
  page: number
  pageSize: number
}

export interface AuditFilters {
  targetUserId?: string
  adminId?: string
}

/**
 * Paginated impersonation history, newest first. ImpersonationLog has no
 * Prisma relations declared (deliberate — the log is independent of user
 * lifecycle), so admin + target emails are resolved via a single batch
 * `user.findMany` after the audit query.
 */
export async function listImpersonationAudit(
  page = 1,
  filters: AuditFilters = {},
): Promise<AuditPage> {
  await requireSudo()
  const safePage = Math.max(1, Math.floor(Number(page) || 1))

  const where: { targetUserId?: string; adminId?: string } = {}
  if (filters.targetUserId) where.targetUserId = filters.targetUserId
  if (filters.adminId) where.adminId = filters.adminId

  const [total, rows] = await Promise.all([
    prisma.impersonationLog.count({ where }),
    prisma.impersonationLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (safePage - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
    }),
  ])

  const userIds = new Set<string>()
  for (const r of rows) {
    userIds.add(r.adminId)
    userIds.add(r.targetUserId)
  }
  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: Array.from(userIds) } },
        select: { id: true, email: true },
      })
    : []
  const emailById = new Map(users.map((u) => [u.id, u.email]))

  const logs: AuditRow[] = rows.map((r) => ({
    id: r.id,
    adminId: r.adminId,
    adminEmail: emailById.get(r.adminId) ?? null,
    targetUserId: r.targetUserId,
    targetEmail: emailById.get(r.targetUserId) ?? null,
    app: r.app,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationSeconds: r.endedAt
      ? Math.max(0, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000))
      : null,
    ip: r.ip,
    userAgent: r.userAgent,
  }))

  return { logs, total, page: safePage, pageSize: AUDIT_PAGE_SIZE }
}
