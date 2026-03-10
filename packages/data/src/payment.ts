/**
 * Shared Payment Processing Service
 *
 * Centralizes all payment business logic: service fee resolution, VAT calculation,
 * and idempotent invoice creation for both reservations and orders.
 *
 * Billing model: SPLIT MERCHANT
 *   Two invoices per transaction:
 *   1. PARTNER invoice — product/service lines, taxed at the partner site's VAT rate.
 *      Merchant of record: the partner company.
 *   2. PLATFORM invoice — service fee line, taxed at the platform's default VAT rate.
 *      Merchant of record: Sunbnb (business entity from Settings).
 *
 * Key design principles:
 * - Idempotent: safe to call multiple times (webhook + polling convergence)
 * - Transactional: invoices + lines + status update in a single $transaction
 * - Three-tier fee cascade: site → partnerAccount → global settings
 * - Veri*factu ready: sequential invoice numbering and hash chaining per issuer
 */

import crypto from 'crypto'
import prisma from '../index'
import { ServiceFee, SubscriptionTier } from '@prisma/client'
import { getBusinessEntity } from './business-entity'
import {
  RESERVATION_COMPLETE,
  RENTAL_COMPLETE,
  ORDER_COMPLETE,
} from './reservation-status'

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

// ─── Invoice Numbering & Hashing (Veri*factu) ───────────────────────────────

/**
 * Generate the next sequential invoice number for a given issuer type.
 * Format: PARTNER-YYYY-NNNNN or PLATFORM-YYYY-NNNNN
 *
 * Uses a raw query with FOR UPDATE to lock the row and prevent concurrent
 * transactions from generating duplicate numbers. The invoiceNumber column
 * also has a unique constraint as a safety net.
 */
async function nextInvoiceNumber(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  issuerType: string
): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `${issuerType}-${year}-`

  // Lock the latest row for this issuer type to serialise number generation
  const rows = await tx.$queryRawUnsafe<{ invoice_number: string | null }[]>(
    `SELECT invoice_number FROM "Invoice"
     WHERE issuer_type = $1 AND invoice_number LIKE $2
     ORDER BY invoice_number DESC
     LIMIT 1
     FOR UPDATE`,
    issuerType,
    `${prefix}%`
  )

  let seq = 1
  const lastNumber = rows[0]?.invoice_number
  if (lastNumber) {
    const parts = lastNumber.split('-')
    const lastSeq = parseInt(parts[parts.length - 1] ?? '0', 10)
    if (!isNaN(lastSeq)) seq = lastSeq + 1
  }

  return `${prefix}${String(seq).padStart(5, '0')}`
}

/**
 * Compute SHA-256 hash for Veri*factu chain.
 * Hash input: invoiceNumber|invoicedAt|totalAmount|issuerVatNumber|previousHash
 */
function computeInvoiceHash(
  invoiceNumber: string,
  invoicedAt: Date,
  totalAmount: number,
  issuerVatNumber: string | null,
  previousHash: string | null
): string {
  const input = [
    invoiceNumber,
    invoicedAt.toISOString(),
    totalAmount.toFixed(2),
    issuerVatNumber ?? '',
    previousHash ?? '',
  ].join('|')
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Get the hash of the last invoice in the chain for this issuer type.
 */
async function getLastHash(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  issuerType: string
): Promise<string | null> {
  const last = await tx.invoice.findFirst({
    where: { issuerType, hash: { not: null } },
    orderBy: { invoicedAt: 'desc' },
    select: { hash: true },
  })
  return last?.hash ?? null
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

  return { site: site as FeeContext['site'], partnerAccount, settings }
}

// ─── Idempotent Reservation Processing ──────────────────────────────────────

/**
 * Process a confirmed reservation payment: create two invoices atomically.
 *
 * SPLIT MERCHANT model:
 *   1. PARTNER invoice — product lines (sunbed rental per item)
 *      Taxed at the partner site's VAT rate.
 *      Merchant of record: partner company.
 *   2. PLATFORM invoice — service fee line
 *      Taxed at the VAT rate from the fee's associated Settings entry.
 *      Merchant of record: Sunbnb business entity.
 *
 * Safe to call multiple times — skips if already processed.
 */
export async function processConfirmedReservation(
  reservationId: string
): Promise<void> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true, invoices: true },
  })

  if (!reservation) {
    throw new Error(`Reservation not found: ${reservationId}`)
  }

  // Idempotency guard: already processed
  if (reservation.status === RESERVATION_COMPLETE || reservation.invoices.length > 0) {
    return
  }

  const { site, partnerAccount, settings } = await loadFeeContext(
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

  const totalPayment = round(reservation.paymentAmount ?? 0)
  const siteVatRate = site.vat ?? 0

  // Calculate total service fee across all items
  let totalServiceFee = 0
  for (const item of reservation.items) {
    const itemPrice = round(item.price ?? site.price ?? 0)
    totalServiceFee += calculateServiceFeeAmount(matchedFee, itemPrice)
  }
  totalServiceFee = round(totalServiceFee)

  // Partner amount = total payment minus service fee
  const partnerAmount = round(totalPayment - totalServiceFee)

  // Load platform business entity for the PLATFORM invoice
  const businessEntity = await getBusinessEntity()

  // Use the VAT rate & country from the fee's associated settings
  const feeSettings = matchedFee
    ? await prisma.settings.findUnique({
        where: { id: matchedFee.settingsId },
        select: { vat: true, country: true },
      })
    : null
  const platformVatRate = feeSettings?.vat ?? businessEntity.vatRate
  const feeCountry = feeSettings?.country ?? ''

  await prisma.$transaction(async (tx) => {
    // Double-check idempotency inside transaction (race-safe)
    const current = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { invoices: true },
    })
    if (current?.status === RESERVATION_COMPLETE || (current?.invoices?.length ?? 0) > 0) return

    const invoicedAt = new Date()

    // ── 1. PARTNER Invoice (product lines) ──

    const { baseAmount: partnerBase, vatAmount: partnerVat } =
      computeVatAndBaseAmounts(partnerAmount, siteVatRate)

    const partnerInvoiceNumber = await nextInvoiceNumber(tx, 'PARTNER')
    const partnerPrevHash = await getLastHash(tx, 'PARTNER')

    const partnerInvoice = await tx.invoice.create({
      data: {
        accountId: partnerAccount?.userId ?? '',
        reservationId,
        totalCharge: partnerBase,
        totalTax: partnerVat,
        totalAmount: partnerAmount,
        invoicedAt,
        issuerType: 'PARTNER',
        issuerVatNumber: partnerAccount?.businessId ?? null,
        issuerCompanyName: partnerAccount?.company ?? null,
        issuerCompanyAddress: partnerAccount?.address ?? null,
        invoiceNumber: partnerInvoiceNumber,
        previousHash: partnerPrevHash,
        hash: computeInvoiceHash(
          partnerInvoiceNumber, invoicedAt, partnerAmount,
          partnerAccount?.businessId ?? null, partnerPrevHash
        ),
      },
    })

    // Product lines — one per sunbed item
    const partnerLines = reservation.items.map((item) => {
      const itemPrice = round(item.price ?? site.price ?? 0)
      const itemFee = calculateServiceFeeAmount(matchedFee, itemPrice)
      const itemPartnerAmount = round(itemPrice - itemFee)
      const { baseAmount: lineBase, vatAmount: lineVat } =
        computeVatAndBaseAmounts(itemPartnerAmount, siteVatRate)

      return {
        charge: lineBase,
        tax: lineVat,
        amount: itemPartnerAmount,
        vatRate: siteVatRate,
        invoiceId: partnerInvoice.id,
        productCode: 'sunbed-rental',
        description: `Sunbed ${item.number} (${item.category})`,
      }
    })

    if (partnerLines.length > 0) {
      await tx.invoiceLine.createMany({ data: partnerLines })
    }

    // ── 2. PLATFORM Invoice (service fee) ──

    if (totalServiceFee > 0) {
      const { baseAmount: feeBase, vatAmount: feeVat } =
        computeVatAndBaseAmounts(totalServiceFee, platformVatRate)

      const platformInvoiceNumber = await nextInvoiceNumber(tx, 'PLATFORM')
      const platformPrevHash = await getLastHash(tx, 'PLATFORM')

      const platformInvoice = await tx.invoice.create({
        data: {
          accountId: partnerAccount?.userId ?? '',
          reservationId,
          totalCharge: feeBase,
          totalTax: feeVat,
          totalAmount: totalServiceFee,
          invoicedAt,
          issuerType: 'PLATFORM',
          issuerVatNumber: businessEntity.vatId || null,
          issuerCompanyName: businessEntity.companyName,
          issuerCompanyAddress: businessEntity.companyAddress || null,
          invoiceNumber: platformInvoiceNumber,
          previousHash: platformPrevHash,
          hash: computeInvoiceHash(
            platformInvoiceNumber, invoicedAt, totalServiceFee,
            businessEntity.vatId || null, platformPrevHash
          ),
        },
      })

      await tx.invoiceLine.create({
        data: {
          charge: feeBase,
          tax: feeVat,
          amount: totalServiceFee,
          vatRate: platformVatRate,
          invoiceId: platformInvoice.id,
          productCode: 'sunbnb-service-fee',
          description: `Reservation service fee${feeCountry ? ` (${feeCountry})` : ''}`,
        },
      })
    }

    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: RESERVATION_COMPLETE },
    })
  })

  // Send confirmation email (non-blocking, non-throwing)
  try {
    const { sendConfirmationEmail } = await import('./reservation-emails')
    sendConfirmationEmail(reservationId).catch(() => {})
  } catch {}
}

// ─── Idempotent Rental Booking Processing ───────────────────────────────────

/**
 * Process confirmed payment for a group of rental bookings (shared paymentRef).
 *
 * SPLIT MERCHANT model (same as reservations):
 *   1. PARTNER invoice — one line per booking (equipment rental items)
 *      Taxed at the partner site's rentalVat rate.
 *   2. PLATFORM invoice — service fee line
 *      Taxed at the VAT rate from the fee's associated Settings entry.
 *
 * Fee model: fees are INCLUDED in the item price.
 *
 * Safe to call multiple times — skips if already processed.
 *
 * @param paymentRef - The shared payment reference across all bookings in this payment
 */
export async function processConfirmedRentalBooking(
  paymentRef: string
): Promise<void> {
  const bookings = await prisma.rentalBooking.findMany({
    where: { paymentRef },
    include: { rentalItem: true },
  })

  if (bookings.length === 0) {
    throw new Error(`No rental bookings found for paymentRef: ${paymentRef}`)
  }

  // Idempotency guard: if all bookings are already complete, skip
  if (bookings.every(b => b.status === RENTAL_COMPLETE)) {
    return
  }

  const siteId = bookings[0]!.siteId

  const { site, partnerAccount, settings } = await loadFeeContext(
    siteId,
    'equipment-rental'
  )

  const tier = partnerAccount?.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'equipment-rental',
    tier
  )

  const totalPayment = round(
    bookings.reduce((sum, b) => sum + (b.paymentAmount ?? b.totalPrice ?? 0), 0)
  )
  const siteVatRate = site.rentalVat ?? site.vat ?? 0

  // Calculate total service fee across all bookings
  let totalServiceFee = 0
  for (const booking of bookings) {
    const bookingPrice = round(booking.paymentAmount ?? booking.totalPrice ?? 0)
    totalServiceFee += calculateServiceFeeAmount(matchedFee, bookingPrice)
  }
  totalServiceFee = round(totalServiceFee)

  const partnerAmount = round(totalPayment - totalServiceFee)

  const businessEntity = await getBusinessEntity()

  const feeSettings = matchedFee
    ? await prisma.settings.findUnique({
        where: { id: matchedFee.settingsId },
        select: { vat: true, country: true },
      })
    : null
  const platformVatRate = feeSettings?.vat ?? businessEntity.vatRate
  const feeCountry = feeSettings?.country ?? ''

  await prisma.$transaction(async (tx) => {
    // Double-check idempotency inside transaction
    const current = await tx.rentalBooking.findMany({
      where: { paymentRef },
    })
    if (current.every(b => b.status === RENTAL_COMPLETE)) return

    const invoicedAt = new Date()

    // ── 1. PARTNER Invoice (equipment lines) ──

    const { baseAmount: partnerBase, vatAmount: partnerVat } =
      computeVatAndBaseAmounts(partnerAmount, siteVatRate)

    const partnerInvoiceNumber = await nextInvoiceNumber(tx, 'PARTNER')
    const partnerPrevHash = await getLastHash(tx, 'PARTNER')

    const partnerInvoice = await tx.invoice.create({
      data: {
        accountId: partnerAccount?.userId ?? '',
        paymentRef,
        totalCharge: partnerBase,
        totalTax: partnerVat,
        totalAmount: partnerAmount,
        invoicedAt,
        issuerType: 'PARTNER',
        issuerVatNumber: partnerAccount?.businessId ?? null,
        issuerCompanyName: partnerAccount?.company ?? null,
        issuerCompanyAddress: partnerAccount?.address ?? null,
        invoiceNumber: partnerInvoiceNumber,
        previousHash: partnerPrevHash,
        hash: computeInvoiceHash(
          partnerInvoiceNumber, invoicedAt, partnerAmount,
          partnerAccount?.businessId ?? null, partnerPrevHash
        ),
      },
    })

    // One line per booking
    const partnerLines = bookings.map((booking) => {
      const bookingPrice = round(booking.paymentAmount ?? booking.totalPrice ?? 0)
      const itemFee = calculateServiceFeeAmount(matchedFee, bookingPrice)
      const itemPartnerAmount = round(bookingPrice - itemFee)
      const { baseAmount: lineBase, vatAmount: lineVat } =
        computeVatAndBaseAmounts(itemPartnerAmount, siteVatRate)

      return {
        charge: lineBase,
        tax: lineVat,
        amount: itemPartnerAmount,
        vatRate: siteVatRate,
        invoiceId: partnerInvoice.id,
        productCode: 'equipment-rental',
        description: `${booking.rentalItem?.name ?? 'Equipment'} × ${booking.quantity}`,
      }
    })

    if (partnerLines.length > 0) {
      await tx.invoiceLine.createMany({ data: partnerLines })
    }

    // ── 2. PLATFORM Invoice (service fee) ──

    if (totalServiceFee > 0) {
      const { baseAmount: feeBase, vatAmount: feeVat } =
        computeVatAndBaseAmounts(totalServiceFee, platformVatRate)

      const platformInvoiceNumber = await nextInvoiceNumber(tx, 'PLATFORM')
      const platformPrevHash = await getLastHash(tx, 'PLATFORM')

      const platformInvoice = await tx.invoice.create({
        data: {
          accountId: partnerAccount?.userId ?? '',
          paymentRef,
          totalCharge: feeBase,
          totalTax: feeVat,
          totalAmount: totalServiceFee,
          invoicedAt,
          issuerType: 'PLATFORM',
          issuerVatNumber: businessEntity.vatId || null,
          issuerCompanyName: businessEntity.companyName,
          issuerCompanyAddress: businessEntity.companyAddress || null,
          invoiceNumber: platformInvoiceNumber,
          previousHash: platformPrevHash,
          hash: computeInvoiceHash(
            platformInvoiceNumber, invoicedAt, totalServiceFee,
            businessEntity.vatId || null, platformPrevHash
          ),
        },
      })

      await tx.invoiceLine.create({
        data: {
          charge: feeBase,
          tax: feeVat,
          amount: totalServiceFee,
          vatRate: platformVatRate,
          invoiceId: platformInvoice.id,
          productCode: 'sunbnb-service-fee',
          description: `Equipment rental service fee${feeCountry ? ` (${feeCountry})` : ''}`,
        },
      })
    }

    // Mark all bookings as complete
    await tx.rentalBooking.updateMany({
      where: { paymentRef },
      data: { status: RENTAL_COMPLETE },
    })
  })
}

// ─── Idempotent Order Processing ────────────────────────────────────────────

/**
 * Process a confirmed order payment: create two invoices atomically.
 *
 * SPLIT MERCHANT model:
 *   1. PARTNER invoice — product item lines (food & beverage)
 *      Taxed at the partner site's VAT rate.
 *      Merchant of record: partner company.
 *   2. PLATFORM invoice — service fee line
 *      Taxed at the VAT rate from the fee's associated Settings entry.
 *      Merchant of record: Sunbnb business entity.
 *
 * Fee model: fees are INCLUDED in the product price.
 * Customer pays exactly order.paymentAmount (the product total).
 * Service fee is deducted and invoiced separately by the platform.
 *
 * Safe to call multiple times — skips if already processed.
 */
export async function processConfirmedOrder(
  orderId: string
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true, invoices: true },
  })

  if (!order) {
    throw new Error(`Order not found: ${orderId}`)
  }

  // Idempotency guard: already processed
  if (order.status === ORDER_COMPLETE || order.invoices.length > 0) {
    return
  }

  const { site, partnerAccount, settings } = await loadFeeContext(
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
  const serviceFeeAmount = calculateServiceFeeAmount(matchedFee, totalProductAmount)

  // Compute per-item fee distribution and partner line amounts
  // (mirrors reservation processing: fee deducted per line)
  let totalPartnerCharge = 0
  let totalPartnerVat = 0
  let totalPartnerAmount = 0

  const itemCalcs = order.orderItems.map((item) => {
    const itemFee = calculateServiceFeeAmount(matchedFee, item.totalPrice)
    const itemPartnerAmount = round(item.totalPrice - itemFee)
    const { baseAmount: lineBase, vatAmount: lineVat } =
      computeVatAndBaseAmounts(itemPartnerAmount, item.tax)
    totalPartnerCharge += lineBase
    totalPartnerVat += lineVat
    totalPartnerAmount += itemPartnerAmount
    return { lineBase, lineVat, itemPartnerAmount, item }
  })

  totalPartnerCharge = round(totalPartnerCharge)
  totalPartnerVat = round(totalPartnerVat)
  totalPartnerAmount = round(totalPartnerAmount)

  // Load platform business entity for the PLATFORM invoice
  const businessEntity = await getBusinessEntity()

  // Use the VAT rate & country from the fee's associated settings
  const feeSettings = matchedFee
    ? await prisma.settings.findUnique({
        where: { id: matchedFee.settingsId },
        select: { vat: true, country: true },
      })
    : null
  const platformVatRate = feeSettings?.vat ?? businessEntity.vatRate
  const feeCountry = feeSettings?.country ?? ''

  await prisma.$transaction(async (tx) => {
    // Double-check idempotency inside transaction (race-safe)
    const current = await tx.order.findUnique({
      where: { id: orderId },
      include: { invoices: true },
    })
    if (current?.status === ORDER_COMPLETE || (current?.invoices?.length ?? 0) > 0) return

    const invoicedAt = new Date()

    // ── 1. PARTNER Invoice (product lines) ──

    const partnerInvoiceNumber = await nextInvoiceNumber(tx, 'PARTNER')
    const partnerPrevHash = await getLastHash(tx, 'PARTNER')

    const partnerInvoice = await tx.invoice.create({
      data: {
        accountId: partnerAccount?.userId ?? '',
        orderId,
        totalCharge: totalPartnerCharge,
        totalTax: totalPartnerVat,
        totalAmount: totalPartnerAmount,
        invoicedAt,
        issuerType: 'PARTNER',
        issuerVatNumber: partnerAccount?.businessId ?? null,
        issuerCompanyName: partnerAccount?.company ?? null,
        issuerCompanyAddress: partnerAccount?.address ?? null,
        invoiceNumber: partnerInvoiceNumber,
        previousHash: partnerPrevHash,
        hash: computeInvoiceHash(
          partnerInvoiceNumber, invoicedAt, totalPartnerAmount,
          partnerAccount?.businessId ?? null, partnerPrevHash
        ),
      },
    })

    const itemLines = itemCalcs.map(({ lineBase, lineVat, itemPartnerAmount, item }) => {
      return {
        charge: lineBase,
        tax: lineVat,
        amount: itemPartnerAmount,
        vatRate: item.tax,
        invoiceId: partnerInvoice.id,
        productCode: 'food-and-beverage',
        description: `${item.name} x (${item.quantity})`,
      }
    })

    if (itemLines.length > 0) {
      await tx.invoiceLine.createMany({ data: itemLines })
    }

    // ── 2. PLATFORM Invoice (service fee) ──

    if (serviceFeeAmount > 0) {
      const { baseAmount: feeBase, vatAmount: feeVat } =
        computeVatAndBaseAmounts(serviceFeeAmount, platformVatRate)

      const platformInvoiceNumber = await nextInvoiceNumber(tx, 'PLATFORM')
      const platformPrevHash = await getLastHash(tx, 'PLATFORM')

      const platformInvoice = await tx.invoice.create({
        data: {
          accountId: partnerAccount?.userId ?? '',
          orderId,
          totalCharge: feeBase,
          totalTax: feeVat,
          totalAmount: serviceFeeAmount,
          invoicedAt,
          issuerType: 'PLATFORM',
          issuerVatNumber: businessEntity.vatId || null,
          issuerCompanyName: businessEntity.companyName,
          issuerCompanyAddress: businessEntity.companyAddress || null,
          invoiceNumber: platformInvoiceNumber,
          previousHash: platformPrevHash,
          hash: computeInvoiceHash(
            platformInvoiceNumber, invoicedAt, serviceFeeAmount,
            businessEntity.vatId || null, platformPrevHash
          ),
        },
      })

      await tx.invoiceLine.create({
        data: {
          charge: feeBase,
          tax: feeVat,
          amount: serviceFeeAmount,
          vatRate: platformVatRate,
          invoiceId: platformInvoice.id,
          productCode: 'sunbnb-service-fee',
          description: `Order service fee${feeCountry ? ` (${feeCountry})` : ''}`,
        },
      })
    }

    await tx.order.update({
      where: { id: orderId },
      data: { status: ORDER_COMPLETE },
    })
  })
}

// ─── Order Service Fee Calculation ──────────────────────────────────────────

/**
 * Calculate the service fee for an order (used for settlement/accounting).
 * Returns the service fee deducted from the merchant's share.
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

  const tier = partnerAccount?.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'food-and-beverage',
    tier
  )

  const amount = order.paymentAmount ?? 0
  return calculateServiceFeeAmount(matchedFee, amount)
}
