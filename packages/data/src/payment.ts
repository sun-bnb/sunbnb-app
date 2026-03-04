/**
 * Shared Payment Processing Service
 *
 * Centralizes all payment business logic: service fee resolution, VAT calculation,
 * and idempotent invoice creation for both reservations and orders.
 *
 * Supports two billing models (per-site):
 * - INTERMEDIARY (default): Partner is seller of record. SunBnB earns a service fee.
 * - DEEMED_PROVIDER: SunBnB is seller of record (merchant of record). Partner
 *   receives a settlement payout. Invoices are issued in the platform's name.
 *
 * Key design principles:
 * - Idempotent: safe to call multiple times (webhook + polling convergence)
 * - Transactional: invoice + lines + status update in a single $transaction
 * - Three-tier fee cascade: site → partnerAccount → global settings
 */

import prisma from '../index'
import { BillingModel, PlatformVatConfig, ServiceFee } from '@prisma/client'

// ─── Financial Utilities ────────────────────────────────────────────────────

/** Round to 2 decimal places (cents precision). */
export function round(amount: number): number {
  return Math.round(amount * 100) / 100
}

/**
 * Extract base amount and VAT from a VAT-inclusive price.
 * Example: vatInclusiveAmount=12.55, vatRate=25.5 → base=10.00, vat=2.55
 */
export function computeVatAndBaseAmounts(
  vatInclusiveAmount: number,
  vatRate: number
): { baseAmount: number; vatAmount: number } {
  const baseAmount = round(vatInclusiveAmount / (1 + vatRate / 100))
  const vatAmount = round(vatInclusiveAmount - baseAmount)
  return { baseAmount, vatAmount }
}

// ─── Service Fee Resolution ─────────────────────────────────────────────────

/**
 * Resolve a service fee using three-tier cascade:
 * 1. Site-specific fee (highest priority)
 * 2. Partner account fee
 * 3. Global settings fee (lowest priority / default)
 */
export function resolveServiceFee(
  siteFees: ServiceFee[],
  accountFees: ServiceFee[],
  settingsFees: ServiceFee[],
  serviceCode: string
): ServiceFee | undefined {
  return (
    siteFees.find(f => f.serviceCode === serviceCode) ||
    accountFees.find(f => f.serviceCode === serviceCode) ||
    settingsFees.find(f => f.serviceCode === serviceCode)
  )
}

/**
 * Calculate the actual fee amount from a ServiceFee definition.
 * - Fixed: returns the flat fee amount
 * - Percentage: returns percentage × referenceAmount
 */
export function calculateServiceFeeAmount(
  fee: ServiceFee | undefined,
  referenceAmount: number
): number {
  if (!fee) return 0
  return round(
    fee.chargeType === 'fixed'
      ? (fee.feeAmount ?? 0)
      : (fee.percentage ?? 0) * referenceAmount
  )
}

// ─── Fee Context Loading ────────────────────────────────────────────────────

interface FeeContext {
  site: NonNullable<Awaited<ReturnType<typeof prisma.site.findUnique>>> & {
    serviceFees: ServiceFee[]
    platformVatConfig: PlatformVatConfig | null
  }
  partnerAccount: (Awaited<ReturnType<typeof prisma.partnerAccount.findUnique>> & {
    serviceFees: ServiceFee[]
  }) | null
  settings: (Awaited<ReturnType<typeof prisma.settings.findFirst>> & {
    serviceFees: ServiceFee[]
  }) | null
}

/**
 * Load the full fee resolution context for a site.
 * Creates default settings and service fee if none exist (bootstrapping).
 * Uses a transaction to prevent duplicate settings from concurrent requests.
 */
async function loadFeeContext(
  siteId: string,
  serviceCode: string
): Promise<FeeContext> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      serviceFees: true,
      platformVatConfig: true,
    },
  })
  if (!site) throw new Error(`Site not found: ${siteId}`)

  const [partnerAccount, existingSettings] = await Promise.all([
    prisma.partnerAccount.findUnique({
      where: { userId: site.userId },
      include: { serviceFees: true },
    }),
    prisma.settings.findFirst({
      include: { serviceFees: true },
    }),
  ])

  let settings = existingSettings

  // Bootstrap: create default settings + fee in a transaction to prevent duplicates
  if (!settings) {
    await prisma.$transaction(async (tx) => {
      // Re-check inside transaction to avoid race condition
      const existing = await tx.settings.findFirst()
      if (existing) return

      const created = await tx.settings.create({
        data: { country: 'FI', currency: 'EUR', vat: 25.5 },
      })
      await tx.serviceFee.create({
        data: {
          settingsId: created.id,
          serviceCode,
          chargeType: 'fixed',
          feeAmount: 1.0,
        },
      })
    })
    settings = await prisma.settings.findFirst({
      include: { serviceFees: true },
    })
  }

  // Bootstrap: create default service fee if not found at any level
  if (settings) {
    const existingFee = resolveServiceFee(
      site.serviceFees,
      partnerAccount?.serviceFees ?? [],
      settings.serviceFees,
      serviceCode
    )
    if (!existingFee) {
      await prisma.$transaction(async (tx) => {
        // Re-check inside transaction to avoid duplicate fees
        const currentSettings = await tx.settings.findFirst({
          include: { serviceFees: true },
        })
        if (!currentSettings) return
        const alreadyExists = currentSettings.serviceFees.some(
          (f) => f.serviceCode === serviceCode
        )
        if (alreadyExists) return

        await tx.serviceFee.create({
          data: {
            settingsId: currentSettings.id,
            serviceCode,
            chargeType: 'fixed',
            feeAmount: 1.0,
          },
        })
      })
      settings = await prisma.settings.findFirst({
        include: { serviceFees: true },
      })
    }
  }

  return { site: site as FeeContext['site'], partnerAccount, settings }
}

// ─── Platform VAT Config ────────────────────────────────────────────────────

interface PlatformIssuer {
  vatNumber: string
  companyName: string
  companyAddress: string
}

/**
 * Load the platform's VAT registration for deemed-provider invoicing.
 * Prefers the direct PlatformVatConfig linked to the site.
 * Falls back to country match, then OSS-registered config, then any config.
 */
async function loadPlatformIssuer(
  directConfig?: { vatNumber: string; companyName: string; companyAddress: string } | null,
  countryCode?: string,
): Promise<PlatformIssuer | null> {
  // Use the direct link from Site.platformVatConfig if available
  if (directConfig) {
    return {
      vatNumber: directConfig.vatNumber,
      companyName: directConfig.companyName,
      companyAddress: directConfig.companyAddress,
    }
  }

  // Fallback: try exact country match, then OSS-registered, then any config
  const config = countryCode
    ? await prisma.platformVatConfig.findUnique({ where: { countryCode } })
    : null

  const resolved =
    config ??
    (await prisma.platformVatConfig.findFirst({
      where: { ossRegistered: true },
    })) ??
    (await prisma.platformVatConfig.findFirst())

  if (!resolved) return null

  return {
    vatNumber: resolved.vatNumber,
    companyName: resolved.companyName,
    companyAddress: resolved.companyAddress,
  }
}

// ─── Idempotent Reservation Processing ──────────────────────────────────────

/**
 * Process a confirmed reservation payment: create invoice + lines atomically.
 *
 * Billing model branching:
 *
 * INTERMEDIARY (default):
 *   Fee is DEDUCTED from the partner's share.
 *   Customer pays: reservation.paymentAmount (VAT-inclusive, includes fee)
 *   Partner receives: paymentAmount − serviceFee per item
 *   Invoice issued by: Partner (issuerType = PARTNER)
 *
 * DEEMED_PROVIDER:
 *   SunBnB is the seller of record. Fee is embedded as platform commission.
 *   Customer pays: reservation.paymentAmount (same)
 *   Invoice issued by: Platform (issuerType = PLATFORM, with platform VAT number)
 *   Partner receives: settlement = paymentAmount − commission (per item)
 *   Invoice lines show full item prices (no fee deduction from line amounts)
 *
 * Safe to call multiple times — skips if invoice already exists.
 */
export async function processConfirmedReservation(
  reservationId: string
): Promise<void> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  })

  if (!reservation) {
    throw new Error(`Reservation not found: ${reservationId}`)
  }

  // Idempotency guard: already processed
  if (reservation.invoiceId || reservation.status === 'complete') {
    return
  }

  const { site, partnerAccount, settings } = await loadFeeContext(
    reservation.siteId,
    'sunbed-rental'
  )

  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'sunbed-rental'
  )

  const totalFinalAmount = round(reservation.paymentAmount ?? 0)
  const vatRate = site.vat ?? 0
  const { baseAmount: totalBase, vatAmount: totalVat } =
    computeVatAndBaseAmounts(totalFinalAmount, vatRate)

  const billingModel = site.billingModel

  // Load platform issuer info for deemed-provider invoices
  const platformIssuer =
    billingModel === BillingModel.DEEMED_PROVIDER
      ? await loadPlatformIssuer(site.platformVatConfig, settings?.country ?? undefined)
      : null

  await prisma.$transaction(async (tx) => {
    // Double-check idempotency inside transaction (race-safe)
    const current = await tx.reservation.findUnique({
      where: { id: reservationId },
    })
    if (current?.invoiceId || current?.status === 'complete') return

    const invoice = await tx.invoice.create({
      data: {
        accountId: partnerAccount?.userId ?? '',
        totalCharge: totalBase,
        totalTax: totalVat,
        totalAmount: totalFinalAmount,
        // Billing model fields
        issuerType:
          billingModel === BillingModel.DEEMED_PROVIDER ? 'PLATFORM' : 'PARTNER',
        issuerVatNumber: platformIssuer?.vatNumber ?? null,
        settlementId:
          billingModel === BillingModel.DEEMED_PROVIDER
            ? `STL-R-${reservationId}`
            : null,
      },
    })

    let invoiceLines: {
      charge: number
      tax: number
      amount: number
      invoiceId: string
      productCode: string
      description: string
    }[]

    if (billingModel === BillingModel.DEEMED_PROVIDER) {
      // ── Deemed Provider: lines show full item prices, commission as separate line ──
      invoiceLines = reservation.items.flatMap((item) => {
        const itemPrice = round(item.price ?? site.price ?? 0)
        const { baseAmount: itemBase, vatAmount: itemVat } =
          computeVatAndBaseAmounts(itemPrice, vatRate)

        return [
          {
            charge: itemBase,
            tax: itemVat,
            amount: itemPrice,
            invoiceId: invoice.id,
            productCode: 'sunbed-rental',
            description: `Sunbed ${item.number} (${item.category})`,
          },
        ]
      })

      // Add a single commission line summarizing the platform's take
      const totalItemPrices = reservation.items.reduce(
        (sum, item) => sum + round(item.price ?? site.price ?? 0),
        0
      )
      const totalCommission = round(
        calculateServiceFeeAmount(matchedFee, totalItemPrices)
      )
      if (totalCommission > 0) {
        const { baseAmount: commBase, vatAmount: commVat } =
          computeVatAndBaseAmounts(totalCommission, vatRate)
        invoiceLines.push({
          charge: commBase,
          tax: commVat,
          amount: totalCommission,
          invoiceId: invoice.id,
          productCode: 'sunbnb-platform-commission',
          description: 'Platform commission',
        })
      }
    } else {
      // ── Intermediary (default): fee deducted from partner revenue ──
      invoiceLines = reservation.items.flatMap((item) => {
        const itemPrice = round(item.price ?? site.price ?? 0)
        const feeAmount = round(
          calculateServiceFeeAmount(matchedFee, itemPrice)
        )
        const partnerAmount = round(itemPrice - feeAmount)

        const { baseAmount: itemBase, vatAmount: itemVat } =
          computeVatAndBaseAmounts(partnerAmount, vatRate)
        const { baseAmount: feeBase, vatAmount: feeVat } =
          computeVatAndBaseAmounts(feeAmount, vatRate)

        return [
          {
            charge: itemBase,
            tax: itemVat,
            amount: partnerAmount,
            invoiceId: invoice.id,
            productCode: 'sunbed-rental',
            description: `Sunbed ${item.number} (${item.category})`,
          },
          {
            charge: feeBase,
            tax: feeVat,
            amount: feeAmount,
            invoiceId: invoice.id,
            productCode: 'sunbnb-service-fee',
            description: 'Res. fee',
          },
        ]
      })
    }

    if (invoiceLines.length > 0) {
      await tx.invoiceLine.createMany({ data: invoiceLines })
    }

    await tx.reservation.update({
      where: { id: reservationId },
      data: { invoiceId: invoice.id, status: 'complete' },
    })
  })
}

// ─── Idempotent Order Processing ────────────────────────────────────────────

/**
 * Process a confirmed order payment: create invoice + lines atomically.
 *
 * Billing model branching:
 *
 * INTERMEDIARY (default):
 *   Fee is ADDED ON TOP of the product total.
 *   Customer pays: order.paymentAmount + serviceFee
 *   Partner receives: order.paymentAmount (full product amount)
 *   Invoice issued by: Partner (issuerType = PARTNER)
 *
 * DEEMED_PROVIDER:
 *   SunBnB is the seller of record.
 *   Customer pays: order.paymentAmount + serviceFee (same total)
 *   Invoice issued by: Platform (issuerType = PLATFORM, with platform VAT number)
 *   Partner receives: settlement = product amount − commission
 *   Invoice lines show full product prices; commission as separate line
 *
 * Safe to call multiple times — skips if invoice already exists.
 */
export async function processConfirmedOrder(
  orderId: string
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  })

  if (!order) {
    throw new Error(`Order not found: ${orderId}`)
  }

  // Idempotency guard: already processed
  if (order.invoiceId || order.status === 'complete') {
    return
  }

  const { site, partnerAccount, settings } = await loadFeeContext(
    order.siteId,
    'food-and-beverage'
  )

  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'food-and-beverage'
  )

  const totalProductAmount = order.paymentAmount ?? 0
  const vatRate = site.vat ?? 0
  const serviceFeeAmount = calculateServiceFeeAmount(matchedFee, totalProductAmount)
  const totalAmount = round(totalProductAmount + serviceFeeAmount)

  // Compute VAT split for products AND service fee
  const { baseAmount: productBase, vatAmount: productVat } =
    computeVatAndBaseAmounts(totalProductAmount, vatRate)
  const { baseAmount: feeBase, vatAmount: feeVat } =
    computeVatAndBaseAmounts(serviceFeeAmount, vatRate)

  // Invoice header must reflect the full amount (products + service fee)
  const invoiceTotalCharge = round(productBase + feeBase)
  const invoiceTotalTax = round(productVat + feeVat)

  const billingModel = site.billingModel

  // Load platform issuer info for deemed-provider invoices
  const platformIssuer =
    billingModel === BillingModel.DEEMED_PROVIDER
      ? await loadPlatformIssuer(site.platformVatConfig, settings?.country ?? undefined)
      : null

  await prisma.$transaction(async (tx) => {
    // Double-check idempotency inside transaction (race-safe)
    const current = await tx.order.findUnique({ where: { id: orderId } })
    if (current?.invoiceId || current?.status === 'complete') return

    const invoice = await tx.invoice.create({
      data: {
        accountId: partnerAccount?.userId ?? '',
        totalCharge: invoiceTotalCharge,
        totalTax: invoiceTotalTax,
        totalAmount,
        // Billing model fields
        issuerType:
          billingModel === BillingModel.DEEMED_PROVIDER ? 'PLATFORM' : 'PARTNER',
        issuerVatNumber: platformIssuer?.vatNumber ?? null,
        settlementId:
          billingModel === BillingModel.DEEMED_PROVIDER
            ? `STL-O-${orderId}`
            : null,
      },
    })

    const itemLines = order.orderItems.map((item) => {
      const { baseAmount: itemBase, vatAmount: itemVat } =
        computeVatAndBaseAmounts(item.totalPrice, item.tax)
      return {
        charge: itemBase,
        tax: itemVat,
        amount: item.totalPrice,
        invoiceId: invoice.id,
        productCode: 'food-and-beverage',
        description: `${item.name} x (${item.quantity})`,
      }
    })

    let commissionLine: typeof itemLines[number] | null = null

    if (billingModel === BillingModel.DEEMED_PROVIDER) {
      // ── Deemed Provider: commission line instead of service fee ──
      const commissionAmount = serviceFeeAmount
      if (commissionAmount > 0) {
        const { baseAmount: commBase, vatAmount: commVat } =
          computeVatAndBaseAmounts(commissionAmount, vatRate)
        commissionLine = {
          charge: commBase,
          tax: commVat,
          amount: commissionAmount,
          invoiceId: invoice.id,
          productCode: 'sunbnb-platform-commission',
          description: 'Platform commission',
        }
      }
    }

    // Intermediary service fee line (unchanged from original)
    const serviceFeeLine =
      billingModel !== BillingModel.DEEMED_PROVIDER
        ? {
            charge: feeBase,
            tax: feeVat,
            amount: serviceFeeAmount,
            invoiceId: invoice.id,
            productCode: 'sunbnb-service-fee',
            description: 'Srv. fee',
          }
        : null

    const allLines = [
      ...itemLines,
      ...(commissionLine ? [commissionLine] : []),
      ...(serviceFeeLine ? [serviceFeeLine] : []),
    ]

    await tx.invoiceLine.createMany({ data: allLines })

    await tx.order.update({
      where: { id: orderId },
      data: { invoiceId: invoice.id, status: 'complete' },
    })
  })
}

// ─── Order Service Fee Calculation ──────────────────────────────────────────

/**
 * Calculate the service fee for an order (used during payment-intent creation).
 * Returns the fee amount to add on top of order.paymentAmount.
 */
export async function calculateOrderServiceFee(
  orderId: string
): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  })
  if (!order) throw new Error(`Order not found: ${orderId}`)

  const { site, partnerAccount, settings } = await loadFeeContext(
    order.siteId,
    'food-and-beverage'
  )

  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'food-and-beverage'
  )

  return calculateServiceFeeAmount(matchedFee, order.paymentAmount ?? 0)
}
