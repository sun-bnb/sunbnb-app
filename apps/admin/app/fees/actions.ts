'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { revalidatePath } from 'next/cache'

// ─── Auth guard ─────────────────────────────────────────────────────────────

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

// ─── Save or create a ServiceFee ────────────────────────────────────────────

export async function saveServiceFee(input: {
  id?: string
  settingsId: string
  siteId?: string | null
  accountId?: string | null
  subscriptionTier?: string | null
  chargeType: string
  feeAmount?: number | null
  percentage?: number | null
  serviceCode: string
}): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  const errors: string[] = []
  if (!input.settingsId?.trim()) errors.push('Settings is required')
  if (!input.chargeType?.trim()) errors.push('Charge type is required')
  if (!input.serviceCode?.trim()) errors.push('Service code is required')
  if (input.chargeType && !['fixed', 'percentage'].includes(input.chargeType.trim())) {
    errors.push('Charge type must be "fixed" or "percentage"')
  }
  if (input.chargeType === 'fixed' && input.feeAmount == null) {
    errors.push('Fee amount is required for fixed charge type')
  }
  if (input.chargeType === 'percentage' && input.percentage == null) {
    errors.push('Percentage is required for percentage charge type')
  }
  if (input.chargeType === 'fixed' && input.percentage != null) {
    errors.push('Percentage must not be set for fixed charge type')
  }
  if (input.chargeType === 'percentage' && input.feeAmount != null) {
    errors.push('Fee amount must not be set for percentage charge type')
  }
  if (input.feeAmount != null && input.feeAmount < 0) {
    errors.push('Fee amount must not be negative')
  }
  if (input.percentage != null && (input.percentage < 0 || input.percentage > 100)) {
    errors.push('Percentage must be between 0 and 100')
  }
  if (errors.length > 0) return { status: 'error', errors }

  const data = {
    settingsId: input.settingsId.trim(),
    siteId: input.siteId?.trim() || null,
    accountId: input.accountId?.trim() || null,
    subscriptionTier: (input.subscriptionTier as 'STARTER' | 'PRO' | 'BUSINESS' | undefined) || null,
    chargeType: input.chargeType.trim(),
    feeAmount: input.feeAmount ?? null,
    percentage: input.percentage ?? null,
    serviceCode: input.serviceCode.trim(),
  }

  if (input.id) {
    await prisma.serviceFee.update({
      where: { id: input.id },
      data,
    })
  } else {
    await prisma.serviceFee.create({ data })
  }

  revalidatePath('/fees')
  return { status: 'ok' }
}

// ─── Search sites ───────────────────────────────────────────────────────────

export async function searchSites(
  query: string
): Promise<{ id: string; name: string }[]> {
  await requireSudo()
  if (!query.trim()) return []

  const sites = await prisma.site.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { id: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true },
    take: 10,
    orderBy: { name: 'asc' },
  })
  return sites
}

// ─── Search partner accounts ────────────────────────────────────────────────

export async function searchAccounts(
  query: string
): Promise<{ userId: string; company: string; firstName: string; lastName: string }[]> {
  await requireSudo()
  if (!query.trim()) return []

  const accounts = await prisma.partnerAccount.findMany({
    where: {
      OR: [
        { company: { contains: query, mode: 'insensitive' } },
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { userId: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: { userId: true, company: true, firstName: true, lastName: true },
    take: 10,
    orderBy: { company: 'asc' },
  })
  return accounts
}

// ─── Fetch fees for a specific site ─────────────────────────────────────────

const feeInclude = {
  settings: true,
  site: { select: { id: true, name: true } },
  account: { select: { userId: true, company: true } },
} as const

export type FeeWithRelations = Awaited<ReturnType<typeof getFeesBySite>>[number]

export async function getFeesBySite(siteId: string) {
  await requireSudo()
  return prisma.serviceFee.findMany({
    where: { siteId },
    include: feeInclude,
    orderBy: { createdAt: 'desc' },
  })
}

// ─── Fetch fees for a specific account ──────────────────────────────────────

export async function getFeesByAccount(accountId: string) {
  await requireSudo()
  return prisma.serviceFee.findMany({
    where: { accountId },
    include: feeInclude,
    orderBy: { createdAt: 'desc' },
  })
}

// ─── Fetch platform-level fees ──────────────────────────────────────────────

export async function getPlatformFees() {
  await requireSudo()
  return prisma.serviceFee.findMany({
    where: { siteId: null, accountId: null },
    include: feeInclude,
    orderBy: { createdAt: 'desc' },
  })
}

// ─── Delete a ServiceFee ────────────────────────────────────────────────────

export async function deleteServiceFee(
  id: string
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  await prisma.serviceFee.delete({ where: { id } })

  revalidatePath('/fees')
  return { status: 'ok' }
}

// ─── Service Code CRUD ──────────────────────────────────────────────────────

export async function saveServiceCode(input: {
  id?: string
  code: string
  description?: string | null
}): Promise<{ status: string; id?: string; errors?: string[] }> {
  await requireSudo()

  const errors: string[] = []
  if (!input.code?.trim()) errors.push('Code is required')
  if (errors.length > 0) return { status: 'error', errors }

  const code = input.code.trim().toLowerCase()
  const description = input.description?.trim() || null

  // Check for duplicate code (on both create and update)
  const existing = await prisma.serviceCode.findUnique({ where: { code } })
  if (existing && existing.id !== input.id) {
    return { status: 'error', errors: [`Code "${code}" already exists`] }
  }

  if (input.id) {
    await prisma.serviceCode.update({
      where: { id: input.id },
      data: { code, description },
    })
    revalidatePath('/fees')
    return { status: 'ok', id: input.id }
  } else {
    const created = await prisma.serviceCode.create({ data: { code, description } })
    revalidatePath('/fees')
    return { status: 'ok', id: created.id }
  }
}

export async function deleteServiceCode(
  id: string
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  // Check for referencing service fees
  const code = await prisma.serviceCode.findUnique({ where: { id }, select: { code: true } })
  if (code) {
    const feeCount = await prisma.serviceFee.count({ where: { serviceCode: code.code } })
    if (feeCount > 0) {
      return { status: 'error', errors: [`Cannot delete: ${feeCount} service fee(s) reference this code. Remove them first.`] }
    }
  }

  await prisma.serviceCode.delete({ where: { id } })
  revalidatePath('/fees')
  return { status: 'ok' }
}