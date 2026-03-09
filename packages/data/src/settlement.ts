/**
 * Settlement Service
 *
 * Manages the outbound payment lifecycle for partner invoices.
 *
 * SPLIT MERCHANT model:
 *   Each transaction produces two invoices:
 *   - PARTNER invoice: product/service revenue (partner is merchant of record)
 *   - PLATFORM invoice: service fee (Sunbnb is merchant of record)
 *
 *   Sunbnb collects full payment and owes the partner the net payout.
 *   Net payout = grossRevenue (PARTNER invoices) − commission (PLATFORM invoices)
 *
 * Settlement lifecycle:  DRAFT → CLOSED → APPROVED → PAID
 *
 * - DRAFT:    Generated from unsettled invoices for a period.
 * - CLOSED:   Period finalized, amounts locked. No more invoices can be added.
 * - APPROVED: Reviewed by admin, ready for bank transfer.
 * - PAID:     Bank transfer executed, reference recorded.
 *
 * SECURITY / TRUST BOUNDARY:
 *   All functions in this module accept raw IDs and perform no caller
 *   authorisation. They are designed to be called exclusively from the
 *   admin app which already enforces admin-session authentication.
 *   If any of these functions are ever exposed to partner- or user-facing
 *   surfaces, each call MUST verify that the authenticated user owns the
 *   referenced settlement / account.
 */

import prisma from '../index'
import { SettlementStatus } from '@prisma/client'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SettlementSummary {
  id: string
  accountId: string
  siteId: string
  siteName: string
  partnerCompany: string
  partnerBankAccount: string | null
  periodStart: Date
  periodEnd: Date
  grossRevenue: number
  totalTax: number
  commission: number
  netPayout: number
  currency: string
  status: SettlementStatus
  bankReference: string | null
  paidAt: Date | null
  notes: string | null
  invoiceCount: number
  createdAt: Date
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round(amount: number): number {
  return Math.round(amount * 100) / 100
}

// ─── Preview Settlement ─────────────────────────────────────────────────────

export interface SettlementPreview {
  invoiceCount: number
  grossRevenue: number
  totalTax: number
  commission: number
  netPayout: number
  invoices: {
    id: string
    invoicedAt: Date
    totalAmount: number
    totalTax: number
    description: string
    type: 'reservation' | 'order'
    issuerType: string
  }[]
}

/**
 * Compute a settlement preview without writing anything to the database.
 * Returns the same totals that generateSettlement would produce, plus an
 * itemised list of the invoices that would be included.
 */
export async function previewSettlement(input: {
  accountId: string
  siteId: string
  periodStart: Date
  periodEnd: Date
}): Promise<SettlementPreview | null> {
  const { accountId, siteId, periodStart, periodEnd } = input

  const invoices = await prisma.invoice.findMany({
    where: {
      accountId,
      settlementBatchId: null,
      invoicedAt: {
        gte: periodStart,
        lt: periodEnd,
      },
      OR: [
        { reservation: { siteId } },
        { order: { siteId } },
      ],
    },
    include: {
      invoiceLines: true,
      reservation: { select: { id: true, from: true, to: true } },
      order: { select: { id: true } },
    },
  })

  if (invoices.length === 0) return null

  // Split by issuer type for clean accounting
  const partnerInvoices = invoices.filter(inv => inv.issuerType === 'PARTNER')
  const platformInvoices = invoices.filter(inv => inv.issuerType === 'PLATFORM')

  const grossRevenue = round(
    partnerInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)
  )
  const totalTax = round(
    partnerInvoices.reduce((sum, inv) => sum + inv.totalTax, 0)
  )
  const commission = round(
    platformInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)
  )
  const netPayout = round(grossRevenue - commission)

  const previewInvoices = invoices.map((inv) => {
    const productLines = inv.invoiceLines.filter(
      (l) => l.productCode !== 'sunbnb-service-fee'
    )
    const description = productLines.map((l) => l.description).filter(Boolean).join(', ') || 'Invoice'
    const type: 'reservation' | 'order' = inv.reservation ? 'reservation' : 'order'

    return {
      id: inv.id,
      invoicedAt: inv.invoicedAt,
      totalAmount: inv.totalAmount,
      totalTax: inv.totalTax,
      description,
      type,
      issuerType: inv.issuerType,
    }
  })

  return {
    invoiceCount: invoices.length,
    grossRevenue,
    totalTax,
    commission,
    netPayout,
    invoices: previewInvoices,
  }
}

// ─── Generate Settlement ────────────────────────────────────────────────────

/**
 * Generate a DRAFT settlement for a partner + site over a given period.
 *
 * Finds all invoices (both PARTNER and PLATFORM) that:
 * - belong to the given account + site
 * - fall within the period (by invoicedAt)
 * - are not yet assigned to any settlement batch
 *
 * Computes gross revenue (PARTNER invoices), commission (PLATFORM invoices),
 * tax, and net payout. Creates a Settlement record and links the invoices.
 *
 * Returns null if no unsettled invoices exist for the period.
 */
export async function generateSettlement(input: {
  accountId: string
  siteId: string
  periodStart: Date
  periodEnd: Date
}): Promise<{ id: string; invoiceCount: number } | null> {
  const { accountId, siteId, periodStart, periodEnd } = input

  // Find unsettled invoices in the period
  const invoices = await prisma.invoice.findMany({
    where: {
      accountId,
      settlementBatchId: null,
      invoicedAt: {
        gte: periodStart,
        lt: periodEnd,
      },
      OR: [
        { reservation: { siteId } },
        { order: { siteId } },
      ],
    },
    include: {
      invoiceLines: true,
    },
  })

  if (invoices.length === 0) return null

  // Split by issuer type
  const partnerInvoices = invoices.filter(inv => inv.issuerType === 'PARTNER')
  const platformInvoices = invoices.filter(inv => inv.issuerType === 'PLATFORM')

  const grossRevenue = round(
    partnerInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)
  )
  const totalTax = round(
    partnerInvoices.reduce((sum, inv) => sum + inv.totalTax, 0)
  )
  const commission = round(
    platformInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)
  )
  const netPayout = round(grossRevenue - commission)

  // Create settlement and link invoices atomically
  const invoiceIds = invoices.map((inv) => inv.id)

  const settlement = await prisma.$transaction(async (tx) => {
    const created = await tx.settlement.create({
      data: {
        accountId,
        siteId,
        periodStart,
        periodEnd,
        grossRevenue,
        totalTax,
        commission,
        netPayout,
        status: 'DRAFT',
      },
    })

    await tx.invoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: { settlementBatchId: created.id },
    })

    return created
  })

  return { id: settlement.id, invoiceCount: invoices.length }
}

// ─── Status Transitions ────────────────────────────────────────────────────

/**
 * Close a DRAFT settlement — locks the period, no more invoices can be added.
 */
export async function closeSettlement(
  settlementId: string
): Promise<void> {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
  })
  if (!settlement) throw new Error(`Settlement not found: ${settlementId}`)
  if (settlement.status !== 'DRAFT') {
    throw new Error(`Cannot close settlement in ${settlement.status} status`)
  }

  await prisma.settlement.update({
    where: { id: settlementId },
    data: { status: 'CLOSED' },
  })
}

/**
 * Approve a CLOSED settlement — marks it ready for bank transfer.
 */
export async function approveSettlement(
  settlementId: string
): Promise<void> {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
  })
  if (!settlement) throw new Error(`Settlement not found: ${settlementId}`)
  if (settlement.status !== 'CLOSED') {
    throw new Error(`Cannot approve settlement in ${settlement.status} status`)
  }

  await prisma.settlement.update({
    where: { id: settlementId },
    data: { status: 'APPROVED' },
  })
}

/**
 * Record a bank transfer for an APPROVED settlement.
 */
export async function markSettlementPaid(
  settlementId: string,
  bankReference: string,
  notes?: string
): Promise<void> {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
  })
  if (!settlement) throw new Error(`Settlement not found: ${settlementId}`)
  if (settlement.status !== 'APPROVED') {
    throw new Error(`Cannot mark as paid — settlement is in ${settlement.status} status`)
  }
  if (!bankReference.trim()) {
    throw new Error('Bank reference is required')
  }

  await prisma.settlement.update({
    where: { id: settlementId },
    data: {
      status: 'PAID',
      bankReference: bankReference.trim(),
      paidAt: new Date(),
      notes: notes?.trim() || null,
    },
  })
}

/**
 * Revert a settlement back to the previous status.
 * PAID → APPROVED, APPROVED → CLOSED, CLOSED → DRAFT.
 * When reverting from DRAFT, unlinks invoices and deletes the settlement.
 */
export async function revertSettlement(
  settlementId: string
): Promise<{ deleted: boolean }> {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
  })
  if (!settlement) throw new Error(`Settlement not found: ${settlementId}`)

  const revertMap: Record<string, SettlementStatus | 'DELETE'> = {
    PAID: 'APPROVED',
    APPROVED: 'CLOSED',
    CLOSED: 'DRAFT',
    DRAFT: 'DELETE',
  }

  const target = revertMap[settlement.status]
  if (!target) throw new Error(`Cannot revert settlement in ${settlement.status} status`)

  if (target === 'DELETE') {
    // Unlink invoices and delete
    await prisma.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: { settlementBatchId: settlementId },
        data: { settlementBatchId: null },
      })
      await tx.settlement.delete({ where: { id: settlementId } })
    })
    return { deleted: true }
  }

  const updateData: Record<string, unknown> = { status: target }
  if (target === 'APPROVED') {
    // Clear payment info when reverting from PAID
    updateData.bankReference = null
    updateData.paidAt = null
  }

  await prisma.settlement.update({
    where: { id: settlementId },
    data: updateData,
  })
  return { deleted: false }
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all settlements with summary info, ordered by period descending.
 */
export async function listSettlements(filters?: {
  status?: SettlementStatus
  accountId?: string
  siteId?: string
}): Promise<SettlementSummary[]> {
  const settlements = await prisma.settlement.findMany({
    where: {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.accountId ? { accountId: filters.accountId } : {}),
      ...(filters?.siteId ? { siteId: filters.siteId } : {}),
    },
    include: {
      account: { select: { company: true, bankAccount: true } },
      site: { select: { name: true } },
      _count: { select: { invoices: true } },
    },
    orderBy: { periodEnd: 'desc' },
  })

  return settlements.map((s) => ({
    id: s.id,
    accountId: s.accountId,
    siteId: s.siteId,
    siteName: s.site.name,
    partnerCompany: s.account.company,
    partnerBankAccount: s.account.bankAccount,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    grossRevenue: s.grossRevenue,
    totalTax: s.totalTax,
    commission: s.commission,
    netPayout: s.netPayout,
    currency: s.currency,
    status: s.status,
    bankReference: s.bankReference,
    paidAt: s.paidAt,
    notes: s.notes,
    invoiceCount: s._count.invoices,
    createdAt: s.createdAt,
  }))
}

/**
 * List partner+site combinations that have unsettled invoices.
 * Used by the admin UI to show which partners need a settlement generated.
 * Only counts PARTNER invoices (the revenue side) to avoid double-counting.
 */
export async function listUnsettledPartners(): Promise<
  {
    accountId: string
    company: string
    siteId: string
    siteName: string
    invoiceCount: number
    totalAmount: number
    oldestInvoice: Date
    newestInvoice: Date
  }[]
> {
  // Find all PARTNER invoices not yet assigned to a settlement batch
  const unsettled = await prisma.invoice.findMany({
    where: {
      settlementBatchId: null,
      issuerType: 'PARTNER',
    },
    include: {
      account: { select: { company: true } },
      reservation: { select: { siteId: true, site: { select: { name: true } } } },
      order: { select: { siteId: true, site: { select: { name: true } } } },
    },
    orderBy: { invoicedAt: 'asc' },
  })

  // Group by accountId + siteId
  const grouped = new Map<
    string,
    {
      accountId: string
      company: string
      siteId: string
      siteName: string
      invoiceCount: number
      totalAmount: number
      oldestInvoice: Date
      newestInvoice: Date
    }
  >()

  for (const inv of unsettled) {
    const siteId = inv.reservation?.siteId ?? inv.order?.siteId
    const siteName =
      inv.reservation?.site?.name ?? inv.order?.site?.name ?? 'Unknown'
    if (!siteId) continue

    const key = `${inv.accountId}:${siteId}`
    const existing = grouped.get(key)

    if (existing) {
      existing.invoiceCount++
      existing.totalAmount = round(existing.totalAmount + inv.totalAmount)
      if (inv.invoicedAt < existing.oldestInvoice) {
        existing.oldestInvoice = inv.invoicedAt
      }
      if (inv.invoicedAt > existing.newestInvoice) {
        existing.newestInvoice = inv.invoicedAt
      }
    } else {
      grouped.set(key, {
        accountId: inv.accountId,
        company: inv.account.company,
        siteId,
        siteName,
        invoiceCount: 1,
        totalAmount: inv.totalAmount,
        oldestInvoice: inv.invoicedAt,
        newestInvoice: inv.invoicedAt,
      })
    }
  }

  return Array.from(grouped.values()).sort(
    (a, b) => b.totalAmount - a.totalAmount
  )
}
