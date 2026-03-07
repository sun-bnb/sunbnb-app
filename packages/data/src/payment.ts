/**
 * Shared Payment Processing Service
 *
 * Centralizes all payment business logic: service fee resolution, VAT calculation,
 * and idempotent invoice creation for both reservations and orders.
 *
 * Billing model: INTERMEDIARY
 *   Partner is the seller of record. SunBnB collects payment and forwards
 *   revenue minus a service fee. Invoices are issued in the partner's name.
 *
 * Key design principles:
 * - Idempotent: safe to call multiple times (webhook + polling convergence)
 * - Transactional: invoice + lines + status update in a single $transaction
 * - Three-tier fee cascade: site → partnerAccount → global settings
 */

import prisma from '../index'
import { PaymentProcessingFee, ServiceFee, SubscriptionTier } from '@prisma/client'

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
 * 3. Global settings fee with tier preference (lowest priority / default)
 *    - Prefers tier-specific platform fee, falls back to tier-null default
 */
export function resolveServiceFee(
  siteFees: ServiceFee[],
  accountFees: ServiceFee[],
  settingsFees: ServiceFee[],
  serviceCode: string,
  tier?: SubscriptionTier | null
): ServiceFee | undefined {
  const siteFee = siteFees.find(f => f.serviceCode === serviceCode)
  if (siteFee) return siteFee

  const accountFee = accountFees.find(f => f.serviceCode === serviceCode)
  if (accountFee) return accountFee

  // Platform fees: prefer tier-specific, fall back to tier-null default
  if (tier) {
    const tierFee = settingsFees.find(
      f => f.serviceCode === serviceCode && f.subscriptionTier === tier
    )
    if (tierFee) return tierFee
  }

  return settingsFees.find(
    f => f.serviceCode === serviceCode && f.subscriptionTier === null
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
      : ((fee.percentage ?? 0) / 100) * referenceAmount
  )
}

/**
 * Calculate the payment processing fee from the PaymentProcessingFee singleton.
 * Combines a fixed amount + a percentage of the reference amount.
 */
export function calculateProcessingFeeAmount(
  ppf: PaymentProcessingFee | null | undefined,
  referenceAmount: number
): number {
  if (!ppf) return 0
  const fixed = ppf.fixedAmount ?? 0
  const pct = ppf.percentage ?? 0
  return round(fixed + (pct / 100) * referenceAmount)
}

// ─── Fee Context Loading ────────────────────────────────────────────────────

interface FeeContext {
  site: NonNullable<Awaited<ReturnType<typeof prisma.site.findUnique>>> & {
    serviceFees: ServiceFee[]
  }
  partnerAccount: (Awaited<ReturnType<typeof prisma.partnerAccount.findUnique>> & {
    serviceFees: ServiceFee[]
    subscription: { plan: { tier: SubscriptionTier } } | null
  }) | null
  settings: (Awaited<ReturnType<typeof prisma.settings.findFirst>> & {
    serviceFees: ServiceFee[]
  }) | null
  processingFee: PaymentProcessingFee | null
}

/**
 * Load the full fee resolution context for a site.
 * Creates default settings and service fee if none exist (bootstrapping).
 * Uses a transaction to prevent duplicate settings from concurrent requests.
 */
export async function loadFeeContext(
  siteId: string,
  serviceCode: string
): Promise<FeeContext> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      serviceFees: true,
    },
  })
  if (!site) throw new Error(`Site not found: ${siteId}`)

  const [partnerAccount, existingSettings] = await Promise.all([
    prisma.partnerAccount.findUnique({
      where: { userId: site.userId },
      include: {
        serviceFees: true,
        subscription: { include: { plan: { select: { tier: true } } } },
      },
    }),
    prisma.settings.findFirst({
      include: {
        serviceFees: {
          where: { siteId: null, accountId: null },
        },
      },
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
      include: {
        serviceFees: {
          where: { siteId: null, accountId: null },
        },
      },
    })
  }

  // Bootstrap: create default service fee if not found at any level
  if (settings) {
    const tier = partnerAccount?.subscription?.plan?.tier ?? null
    const existingFee = resolveServiceFee(
      site.serviceFees,
      partnerAccount?.serviceFees ?? [],
      settings.serviceFees,
      serviceCode,
      tier
    )
    if (!existingFee) {
      await prisma.$transaction(async (tx) => {
        // Re-check inside transaction to avoid duplicate fees
        const currentSettings = await tx.settings.findFirst({
          include: {
            serviceFees: {
              where: { siteId: null, accountId: null },
            },
          },
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
        include: {
          serviceFees: {
            where: { siteId: null, accountId: null },
          },
        },
      })
    }
  }

  // Load global payment processing fee (singleton)
  const processingFee = await prisma.paymentProcessingFee.findFirst()

  return { site: site as FeeContext['site'], partnerAccount, settings, processingFee }
}

// ─── Idempotent Reservation Processing ──────────────────────────────────────

/**
 * Process a confirmed reservation payment: create invoice + lines atomically.
 *
 * INTERMEDIARY model:
 *   Fee is DEDUCTED from the partner's share.
 *   Customer pays: reservation.paymentAmount (VAT-inclusive, includes fee)
 *   Partner receives: paymentAmount − serviceFee per item
 *   Invoice issued by: Partner (issuerType = PARTNER)
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

  const { site, partnerAccount, settings, processingFee } = await loadFeeContext(
    reservation.siteId,
    'sunbed-rental'
  )

  const tier = partnerAccount?.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'sunbed-rental',
    tier
  )

  const totalFinalAmount = round(reservation.paymentAmount ?? 0)
  const vatRate = site.vat ?? 0
  const { baseAmount: totalBase, vatAmount: totalVat } =
    computeVatAndBaseAmounts(totalFinalAmount, vatRate)

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
        issuerType: 'PARTNER',
        issuerVatNumber: partnerAccount?.businessId ?? null,
        issuerCompanyName: partnerAccount?.company ?? null,
        issuerCompanyAddress: partnerAccount?.address ?? null,
      },
    })

    // ── Intermediary: fee deducted from partner revenue ──
    const invoiceLines = reservation.items.flatMap((item) => {
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

    // Add payment processing fee line
    const procFeeAmount = round(
      calculateProcessingFeeAmount(processingFee, totalFinalAmount)
    )
    if (procFeeAmount > 0) {
      const { baseAmount: procBase, vatAmount: procVat } =
        computeVatAndBaseAmounts(procFeeAmount, vatRate)
      invoiceLines.push({
        charge: procBase,
        tax: procVat,
        amount: procFeeAmount,
        invoiceId: invoice.id,
        productCode: 'payment-processing-fee',
        description: 'Processing fee',
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
 * Fee model: fees are INCLUDED in the product price.
 * Customer pays exactly order.paymentAmount (the product total).
 * Service fee + processing fee are deducted from the merchant's share at settlement.
 *
 * INTERMEDIARY model:
 *   Customer pays: order.paymentAmount
 *   Partner receives: order.paymentAmount − serviceFee − processingFee
 *   Invoice issued by: Partner (issuerType = PARTNER)
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

  const { site, partnerAccount, settings, processingFee } = await loadFeeContext(
    order.siteId,
    'food-and-beverage'
  )

  const tier = partnerAccount?.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'food-and-beverage',
    tier
  )

  const totalProductAmount = order.paymentAmount ?? 0
  const vatRate = site.vat ?? 0
  const serviceFeeAmount = calculateServiceFeeAmount(matchedFee, totalProductAmount)
  const procFeeAmount = round(calculateProcessingFeeAmount(processingFee, totalProductAmount))

  // Fees are INCLUDED in the product price — customer pays exactly totalProductAmount.
  // Fees are deducted from the merchant's share at settlement.
  const totalAmount = totalProductAmount

  // Compute VAT split for products (customer-facing total)
  const { baseAmount: productBase, vatAmount: productVat } =
    computeVatAndBaseAmounts(totalProductAmount, vatRate)

  // Fee VAT splits — for internal settlement accounting only
  const { baseAmount: feeBase, vatAmount: feeVat } =
    computeVatAndBaseAmounts(serviceFeeAmount, vatRate)
  const { baseAmount: procBase, vatAmount: procVat } =
    computeVatAndBaseAmounts(procFeeAmount, vatRate)

  // Invoice header reflects what the customer paid (product total only)
  const invoiceTotalCharge = productBase
  const invoiceTotalTax = productVat

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
        issuerType: 'PARTNER',
        issuerVatNumber: partnerAccount?.businessId ?? null,
        issuerCompanyName: partnerAccount?.company ?? null,
        issuerCompanyAddress: partnerAccount?.address ?? null,
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

    // Service fee line
    const serviceFeeLine = {
      charge: feeBase,
      tax: feeVat,
      amount: serviceFeeAmount,
      invoiceId: invoice.id,
      productCode: 'sunbnb-service-fee',
      description: 'Srv. fee',
    }

    // Payment processing fee line
    const procFeeLine = procFeeAmount > 0
      ? {
          charge: procBase,
          tax: procVat,
          amount: procFeeAmount,
          invoiceId: invoice.id,
          productCode: 'payment-processing-fee',
          description: 'Processing fee',
        }
      : null

    const allLines = [
      ...itemLines,
      serviceFeeLine,
      ...(procFeeLine ? [procFeeLine] : []),
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
 * Calculate the total fee for an order (used for settlement/accounting).
 * Returns service fee + payment processing fee deducted from the merchant's share.
 * NOT added on top of order.paymentAmount — fees are included in the product price.
 */
export async function calculateOrderServiceFee(
  orderId: string
): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  })
  if (!order) throw new Error(`Order not found: ${orderId}`)

  const { site, partnerAccount, settings, processingFee } = await loadFeeContext(
    order.siteId,
    'food-and-beverage'
  )

  const tier = partnerAccount?.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'food-and-beverage',
    tier
  )

  const amount = order.paymentAmount ?? 0
  const serviceFee = calculateServiceFeeAmount(matchedFee, amount)
  const procFee = calculateProcessingFeeAmount(processingFee, amount)
  return round(serviceFee + procFee)
}
