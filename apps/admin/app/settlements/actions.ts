'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  previewSettlement,
  generateSettlement,
  closeSettlement,
  approveSettlement,
  markSettlementPaid,
  revertSettlement,
} from '@repo/data/settlement'
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

// ─── Preview a settlement (read-only) ───────────────────────────────────────

export async function previewSettlementAction(input: {
  accountId: string
  siteId: string
  periodStart: string
  periodEnd: string
}): Promise<{
  status: string
  errors?: string[]
  preview?: {
    invoiceCount: number
    grossRevenue: number
    totalTax: number
    commission: number
    netPayout: number
    invoices: {
      id: string
      invoicedAt: string
      totalAmount: number
      totalTax: number
      description: string
      type: 'reservation' | 'order'
    }[]
  }
}> {
  await requireSudo()

  const errors: string[] = []
  if (!input.accountId) errors.push('Partner account is required')
  if (!input.siteId) errors.push('Site is required')
  if (!input.periodStart) errors.push('Period start is required')
  if (!input.periodEnd) errors.push('Period end is required')

  const periodStart = new Date(input.periodStart)
  const periodEnd = new Date(input.periodEnd)
  if (isNaN(periodStart.getTime())) errors.push('Invalid period start date')
  if (isNaN(periodEnd.getTime())) errors.push('Invalid period end date')
  if (periodStart >= periodEnd) errors.push('Period start must be before period end')
  if (errors.length > 0) return { status: 'error', errors }

  try {
    const result = await previewSettlement({
      accountId: input.accountId,
      siteId: input.siteId,
      periodStart,
      periodEnd,
    })

    if (!result) {
      return { status: 'error', errors: ['No unsettled invoices found for the selected period'] }
    }

    return {
      status: 'ok',
      preview: {
        ...result,
        invoices: result.invoices.map((inv) => ({
          ...inv,
          invoicedAt: inv.invoicedAt.toISOString(),
        })),
      },
    }
  } catch (err) {
    return { status: 'error', errors: [(err as Error).message] }
  }
}

// ─── Generate a new settlement ──────────────────────────────────────────────

export async function generateSettlementAction(input: {
  accountId: string
  siteId: string
  periodStart: string // ISO date
  periodEnd: string   // ISO date
}): Promise<{ status: string; errors?: string[]; settlementId?: string; invoiceCount?: number }> {
  await requireSudo()

  const errors: string[] = []
  if (!input.accountId) errors.push('Partner account is required')
  if (!input.siteId) errors.push('Site is required')
  if (!input.periodStart) errors.push('Period start is required')
  if (!input.periodEnd) errors.push('Period end is required')

  const periodStart = new Date(input.periodStart)
  const periodEnd = new Date(input.periodEnd)
  if (isNaN(periodStart.getTime())) errors.push('Invalid period start date')
  if (isNaN(periodEnd.getTime())) errors.push('Invalid period end date')
  if (periodStart >= periodEnd) errors.push('Period start must be before period end')
  if (errors.length > 0) return { status: 'error', errors }

  try {
    const result = await generateSettlement({
      accountId: input.accountId,
      siteId: input.siteId,
      periodStart,
      periodEnd,
    })

    if (!result) {
      return { status: 'error', errors: ['No unsettled invoices found for the selected period'] }
    }

    revalidatePath('/settlements')
    return { status: 'ok', settlementId: result.id, invoiceCount: result.invoiceCount }
  } catch (err) {
    return { status: 'error', errors: [(err as Error).message] }
  }
}

// ─── Transition actions ─────────────────────────────────────────────────────

export async function closeSettlementAction(
  settlementId: string
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()
  try {
    await closeSettlement(settlementId)
    revalidatePath('/settlements')
    return { status: 'ok' }
  } catch (err) {
    return { status: 'error', errors: [(err as Error).message] }
  }
}

export async function approveSettlementAction(
  settlementId: string
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()
  try {
    await approveSettlement(settlementId)
    revalidatePath('/settlements')
    return { status: 'ok' }
  } catch (err) {
    return { status: 'error', errors: [(err as Error).message] }
  }
}

export async function markSettlementPaidAction(input: {
  settlementId: string
  bankReference: string
  notes?: string
}): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  if (!input.bankReference?.trim()) {
    return { status: 'error', errors: ['Bank reference is required'] }
  }

  try {
    await markSettlementPaid(input.settlementId, input.bankReference, input.notes)
    revalidatePath('/settlements')
    return { status: 'ok' }
  } catch (err) {
    return { status: 'error', errors: [(err as Error).message] }
  }
}

export async function revertSettlementAction(
  settlementId: string
): Promise<{ status: string; errors?: string[]; deleted?: boolean }> {
  await requireSudo()
  try {
    const result = await revertSettlement(settlementId)
    revalidatePath('/settlements')
    return { status: 'ok', deleted: result.deleted }
  } catch (err) {
    return { status: 'error', errors: [(err as Error).message] }
  }
}
