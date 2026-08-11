/**
 * Shared Payment Processing Service
 *
 * Centralizes all payment business logic: service fee resolution, VAT calculation,
 * and idempotent invoice creation for both reservations and orders.
 *
 * Billing model: AGENT / MARKETPLACE
 *   The partner is the merchant of record for the consumer sale; Sunbnb is a
 *   disclosed intermediary that charges the partner a commission. Two invoices
 *   per transaction:
 *   1. PARTNER invoice — product/service lines at the FULL price the consumer
 *      paid (GROSS), taxed at the partner site's VAT rate. The partner's revenue
 *      is the whole consumer payment, not net of commission.
 *   2. PLATFORM (commission) invoice — a B2B invoice FROM Sunbnb TO the partner
 *      for the service fee (recipient = partner). It is NOT a slice of the
 *      consumer's payment. Local VAT applies, or reverse charge for cross-border
 *      EU B2B (0 VAT, partner self-accounts). The commission is collected via
 *      Mollie's applicationFee routing, not added to the consumer total.
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
  ORDER_PENDING,
  ORDER_PROCESSING,
  ORDER_CANCELED,
  ORDER_REJECTED,
  ORDER_DISCARDED,
  ORDER_REFUNDED,
  TAB_PAID,
  TAB_SETTLED_CASH,
} from './reservation-status'

// Tab orders live in KITCHEN states while unpaid (complete → accepted → … →
// delivered); paid-ness is tracked on the TAB, not the order status. An order
// belongs to the tab bill unless it was voided. Shared by calculateTabTotal
// and processConfirmedTabPayment so the charged amount always matches the
// invoiced amount.
const TAB_ORDER_VOID_STATUSES = [
  ORDER_CANCELED,
  ORDER_REJECTED,
  ORDER_DISCARDED,
  ORDER_REFUNDED,
]
import { resolveEffectiveFeatures, type SubscriptionFeatureKey } from './subscription'

// ─── Financial Utilities ────────────────────────────────────────────────────
// Pure math lives in ./payment-math (client-safe, no prisma); re-exported here
// so existing `@repo/data/payment` imports keep working.

import { round, computeVatAndBaseAmounts } from './payment-math'
export { round, computeVatAndBaseAmounts }

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

// ─── Commission (PLATFORM) invoice helpers ──────────────────────────────────

/**
 * Bill-to fields for the B2B commission invoice — the partner is the recipient.
 * (Agent model: the platform sells an intermediation service to the partner.)
 */
function commissionRecipientFields(partnerAccount: FeeContext['partnerAccount']) {
  return {
    recipientCompanyName: partnerAccount?.company ?? null,
    recipientVatNumber: partnerAccount?.businessId ?? null,
    recipientCompanyAddress: partnerAccount?.address ?? null,
  }
}

/**
 * VAT treatment of the platform commission charged to the partner.
 *
 * Cross-border EU B2B (partner VAT-registered in a different country than the
 * platform) → reverse charge: the issuer charges 0 VAT and the partner
 * self-accounts. Otherwise the platform's local VAT rate applies (reverse-VAT
 * split of the VAT-inclusive fee).
 *
 * Note: this treats "different country" as the reverse-charge trigger; both
 * parties are assumed EU. A non-EU partner (outside-scope) is not yet modelled.
 */
function computeCommissionVat(
  feeAmount: number,
  platformVatRate: number,
  partnerCountry: string | null | undefined,
  partnerVatNumber: string | null | undefined,
  platformCountry: string | null | undefined
): { base: number; vat: number; vatRate: number; reverseCharge: boolean } {
  const reverseCharge =
    !!partnerVatNumber &&
    !!partnerCountry &&
    !!platformCountry &&
    partnerCountry !== platformCountry
  if (reverseCharge) {
    return { base: round(feeAmount), vat: 0, vatRate: 0, reverseCharge: true }
  }
  const { baseAmount, vatAmount } = computeVatAndBaseAmounts(feeAmount, platformVatRate)
  return { base: baseAmount, vat: vatAmount, vatRate: platformVatRate, reverseCharge: false }
}

// ─── Invoice Numbering & Hashing (Veri*factu) ───────────────────────────────

/**
 * Generate the next sequential invoice number for a given issuer type.
 * Format: PARTNER-YYYY-NNNNN or PLATFORM-YYYY-NNNNN
 *
 * Uses a raw query with FOR UPDATE to lock the row and prevent concurrent
 * transactions from generating duplicate numbers. The invoiceNumber column
 * also has a unique constraint as a safety net.
 *
 * @param year - The invoice year to use for numbering. Defaults to the
 *   current year. Pass `invoicedAt.getFullYear()` when back-dating so that
 *   a historical receipt is numbered in its sale year, not the current year.
 */
async function nextInvoiceNumber(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  issuerType: string,
  year: number = new Date().getFullYear(),
  /**
   * Optional sub-series discriminator. Credit notes number in their own series
   * (`PARTNER-CN-YYYY-NNNNN`) — the CN prefix keeps them out of the plain
   * `PARTNER-YYYY-%` LIKE window, so both sequences stay dense and independent
   * while sharing the issuer's hash chain.
   */
  series?: string
): Promise<string> {
  const prefix = `${issuerType}-${series ? `${series}-` : ''}${year}-`

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

export interface FeeContext {
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

export interface SiteFeeContext extends FeeContext {
  tier: SubscriptionTier | null
  features: Record<SubscriptionFeatureKey, boolean>
}

export interface PartnerFeeContext {
  partnerAccount: FeeContext['partnerAccount']
  settings: FeeContext['settings']
  tier: SubscriptionTier | null
  features: Record<SubscriptionFeatureKey, boolean>
}

/**
 * Fee context for a dine-in tab (dine-in v2). Site-agnostic: for a linked
 * venue `siteFees` carries the site's fee tier (resolution byte-identical to
 * the site rail); for a standalone restaurant it is empty and the cascade
 * starts at the partner-account tier.
 */
export interface TabFeeContext {
  siteFees: ServiceFee[]
  partnerAccount: FeeContext['partnerAccount']
  settings: FeeContext['settings']
  tier: SubscriptionTier | null
}

const SETTINGS_INCLUDE = {
  serviceFees: {
    where: { siteId: null, accountId: null },
  },
} as const

/**
 * Resolve the Settings row for a country, preferring an exact match and
 * falling back to the first available row if none matches. Returns null only
 * when no Settings exist in the DB at all.
 */
async function findCountryMatchedSettings(country: string | null | undefined) {
  if (country) {
    const match = await prisma.settings.findFirst({
      where: { country },
      include: SETTINGS_INCLUDE,
    })
    if (match) return match
  }
  return prisma.settings.findFirst({ include: SETTINGS_INCLUDE })
}

/**
 * Read-only fee resolution context for a site. Settings are matched by the
 * partner's country; falls back to any Settings row when no country match
 * exists. No bootstrap side effects — use for display and read paths.
 *
 * For payment processing (which must guarantee a fee exists), use
 * `loadFeeContext` — it wraps this and adds bootstrap logic.
 */
export async function getSiteFeeContext(siteId: string): Promise<SiteFeeContext> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { serviceFees: true },
  })
  if (!site) throw new Error(`Site not found: ${siteId}`)

  const partnerAccount = await prisma.partnerAccount.findUnique({
    where: { userId: site.userId },
    include: {
      serviceFees: true,
      subscription: { include: { plan: { select: { tier: true } } } },
      customSubscription: true,
    },
  })

  const settings = await findCountryMatchedSettings(partnerAccount?.country)
  const tier = partnerAccount?.subscription?.plan?.tier ?? null
  const featureOverrides = (partnerAccount?.customSubscription?.featureOverrides as any) ?? null

  return {
    site: site as FeeContext['site'],
    partnerAccount,
    settings,
    tier,
    features: resolveEffectiveFeatures(tier, featureOverrides),
  }
}

/**
 * Read-only fee resolution context for a partner who has no site yet (e.g. the
 * site-creation wizard). Settings are matched by the partner's country with
 * the same fallback as `getSiteFeeContext`.
 */
export async function getPartnerFeeContext(userId: string): Promise<PartnerFeeContext> {
  const partnerAccount = await prisma.partnerAccount.findUnique({
    where: { userId },
    include: {
      serviceFees: true,
      subscription: { include: { plan: { select: { tier: true } } } },
      customSubscription: true,
    },
  })
  const settings = await findCountryMatchedSettings(partnerAccount?.country)
  const tier = partnerAccount?.subscription?.plan?.tier ?? null
  const featureOverrides = (partnerAccount?.customSubscription?.featureOverrides as any) ?? null
  return {
    partnerAccount,
    settings,
    tier,
    features: resolveEffectiveFeatures(tier, featureOverrides),
  }
}

/**
 * Convenience: resolve a list of service codes for a site in one call. Codes
 * with no resolved fee are omitted from the result. Read-only — no bootstrap.
 */
export async function resolveSiteFees(
  siteId: string,
  serviceCodes: string[]
): Promise<ServiceFee[]> {
  const ctx = await getSiteFeeContext(siteId)
  return serviceCodes
    .map((code) =>
      resolveServiceFee(
        ctx.site.serviceFees,
        ctx.partnerAccount?.serviceFees ?? [],
        ctx.settings?.serviceFees ?? [],
        code,
        ctx.tier
      )
    )
    .filter((f): f is ServiceFee => Boolean(f))
}

/**
 * Load the full fee resolution context for a site, bootstrapping default
 * Settings and a default ServiceFee for the requested code if none exist.
 * For display/read paths, prefer `getSiteFeeContext` or `resolveSiteFees`.
 *
 * Bootstrap is idempotent and uses transactions to prevent duplicates from
 * concurrent requests.
 */
export async function loadFeeContext(
  siteId: string,
  serviceCode: string
): Promise<FeeContext> {
  const baseCtx = await getSiteFeeContext(siteId)
  const { site, partnerAccount, tier } = baseCtx

  const settings = await ensureSettingsAndFee(
    serviceCode,
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    baseCtx.settings,
    tier
  )

  return { site, partnerAccount, settings }
}

/**
 * Shared bootstrap for the fee-context loaders: guarantee that Settings exist
 * and that the requested service code resolves at some cascade level, creating
 * defaults transactionally when missing. Single-sourced so the site and
 * restaurant loaders can never drift.
 */
async function ensureSettingsAndFee(
  serviceCode: string,
  siteFees: ServiceFee[],
  partnerFees: ServiceFee[],
  initialSettings: FeeContext['settings'],
  tier: SubscriptionTier | null
): Promise<FeeContext['settings']> {
  let settings = initialSettings

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
    settings = await prisma.settings.findFirst({ include: SETTINGS_INCLUDE })
  }

  // Bootstrap: create default service fee if not found at any level
  if (settings) {
    const existingFee = resolveServiceFee(
      siteFees,
      partnerFees,
      settings.serviceFees,
      serviceCode,
      tier
    )
    if (!existingFee) {
      const settingsId = settings.id
      await prisma.$transaction(async (tx) => {
        const currentSettings = await tx.settings.findUnique({
          where: { id: settingsId },
          include: SETTINGS_INCLUDE,
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
      settings = await prisma.settings.findUnique({
        where: { id: settingsId },
        include: SETTINGS_INCLUDE,
      })
    }
  }

  return settings
}

/**
 * Fee resolution context for a standalone restaurant (dine-in v2). Resolves
 * the partner directly via `Restaurant.partnerAccountId` (a User.id — the
 * PartnerAccount key), with an EMPTY site tier: the cascade is
 * partnerAccount → settings. Same bootstrap guarantees as `loadFeeContext`.
 */
export async function loadRestaurantFeeContext(
  restaurantId: string,
  serviceCode: string
): Promise<TabFeeContext> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, partnerAccountId: true },
  })
  if (!restaurant) throw new Error(`Restaurant not found: ${restaurantId}`)

  const base = await getPartnerFeeContext(restaurant.partnerAccountId)
  const settings = await ensureSettingsAndFee(
    serviceCode,
    [],
    base.partnerAccount?.serviceFees ?? [],
    base.settings,
    base.tier
  )

  return { siteFees: [], partnerAccount: base.partnerAccount, settings, tier: base.tier }
}

/**
 * Fee context for a dine-in tab: linked venues (siteId set) resolve through
 * the site rail (`loadFeeContext` — byte-identical fee resolution, site fee
 * tier included); standalone tabs resolve through the restaurant.
 */
export async function loadTabFeeContext(
  tab: { siteId: string | null; restaurantId: string },
  serviceCode: string
): Promise<TabFeeContext> {
  if (tab.siteId) {
    const { site, partnerAccount, settings } = await loadFeeContext(tab.siteId, serviceCode)
    return {
      siteFees: site.serviceFees,
      partnerAccount,
      settings,
      tier: partnerAccount?.subscription?.plan?.tier ?? null,
    }
  }
  return loadRestaurantFeeContext(tab.restaurantId, serviceCode)
}

// ─── Idempotent Reservation Processing ──────────────────────────────────────

export interface ProcessReservationOpts {
  /**
   * Skip the PLATFORM commission invoice. Use for cash/walk-in receipts where
   * the partner is the sole merchant and no Mollie application fee was routed.
   * When true: only a PARTNER invoice is created; reservation.status is NOT
   * updated (it remains 'paid-in-cash').
   */
  skipCommission?: boolean
  /**
   * Override the invoice date. Defaults to `new Date()`. When set, the invoice
   * number's year segment is derived from this date's year so that a back-dated
   * receipt (e.g. a June sale) is numbered in its sale year, not the current year.
   */
  invoicedAt?: Date
  /**
   * Suppress the customer confirmation email. Use for cash receipts (an accounting
   * artifact, not a customer notification) and ESPECIALLY when backfilling historical
   * sales — otherwise customers get "reservation confirmed" emails for sales that
   * happened weeks/months ago. Defaults to false (the online path emails as before).
   */
  skipEmail?: boolean
}

/**
 * Process a confirmed reservation payment: create invoices atomically.
 *
 * Default (no opts) — SPLIT MERCHANT model, behaviour unchanged:
 *   1. PARTNER invoice — product lines (sunbed rental per item)
 *      Taxed at the partner site's VAT rate.
 *      Merchant of record: partner company.
 *   2. PLATFORM invoice — service fee line
 *      Taxed at the VAT rate from the fee's associated Settings entry.
 *      Merchant of record: Sunbnb business entity.
 *   Status is set to RESERVATION_COMPLETE.
 *
 * With { skipCommission: true } — PARTNER-only receipt for cash/walk-in sales:
 *   1. PARTNER invoice only — same product lines as above.
 *   No PLATFORM invoice is created.
 *   Status is NOT mutated (stays 'paid-in-cash').
 *
 * Safe to call multiple times — skips if already processed.
 */
export async function processConfirmedReservation(
  reservationId: string,
  opts?: ProcessReservationOpts
): Promise<void> {
  const skipCommission = opts?.skipCommission ?? false
  const skipEmail = opts?.skipEmail ?? false
  const invoicedAtOverride = opts?.invoicedAt

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

  // Calculate total service fee across all items (needed for PLATFORM invoice;
  // computed regardless of skipCommission — harmless and keeps the path uniform).
  let totalServiceFee = 0
  for (const item of reservation.items) {
    const itemPrice = round(item.price ?? site.price ?? 0)
    totalServiceFee += calculateServiceFeeAmount(matchedFee, itemPrice)
  }
  totalServiceFee = round(totalServiceFee)

  // Agent model: the partner sells the full listed price to the consumer, so
  // the PARTNER (revenue) invoice is booked GROSS. The commission is billed
  // separately to the partner via the PLATFORM invoice (it is NOT a slice of
  // the consumer's payment).
  const partnerAmount = totalPayment

  // Load platform business entity for the PLATFORM invoice (only needed when
  // creating the commission invoice, but load outside the transaction to keep
  // the transaction short and avoid blocking on an external read).
  const businessEntity = skipCommission ? null : await getBusinessEntity()

  // Use the VAT rate & country from the fee's associated settings
  const feeSettings =
    !skipCommission && matchedFee
      ? await prisma.settings.findUnique({
          where: { id: matchedFee.settingsId },
          select: { vat: true, country: true },
        })
      : null
  const platformVatRate = feeSettings?.vat ?? businessEntity?.vatRate ?? 0
  const feeCountry = feeSettings?.country ?? ''

  await prisma.$transaction(async (tx) => {
    // Double-check idempotency inside transaction (race-safe)
    const current = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { invoices: true },
    })
    if (current?.status === RESERVATION_COMPLETE || (current?.invoices?.length ?? 0) > 0) return

    const invoicedAt = invoicedAtOverride ?? new Date()
    // Invoice number year comes from invoicedAt so that backfilled receipts
    // are numbered in their sale year, not the current calendar year.
    const invoiceYear = invoicedAt.getFullYear()

    // ── 1. PARTNER Invoice (product lines) ──

    const { baseAmount: partnerBase, vatAmount: partnerVat } =
      computeVatAndBaseAmounts(partnerAmount, siteVatRate)

    const partnerInvoiceNumber = await nextInvoiceNumber(tx, 'PARTNER', invoiceYear)
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

    // Product lines — one per sunbed item, at the full listed price (gross).
    const partnerLines = reservation.items.map((item) => {
      const itemPrice = round(item.price ?? site.price ?? 0)
      const { baseAmount: lineBase, vatAmount: lineVat } =
        computeVatAndBaseAmounts(itemPrice, siteVatRate)

      return {
        charge: lineBase,
        tax: lineVat,
        amount: itemPrice,
        vatRate: siteVatRate,
        invoiceId: partnerInvoice.id,
        productCode: 'sunbed-rental',
        description: `Sunbed ${item.number} (${item.category})`,
      }
    })

    if (partnerLines.length > 0) {
      await tx.invoiceLine.createMany({ data: partnerLines })
    }

    // ── 2. PLATFORM Invoice (service fee) — skipped for cash/walk-in receipts ──

    if (!skipCommission && totalServiceFee > 0 && businessEntity) {
      const commission = computeCommissionVat(
        totalServiceFee, platformVatRate,
        partnerAccount?.country, partnerAccount?.businessId, feeCountry
      )

      const platformInvoiceNumber = await nextInvoiceNumber(tx, 'PLATFORM', invoiceYear)
      const platformPrevHash = await getLastHash(tx, 'PLATFORM')

      const platformInvoice = await tx.invoice.create({
        data: {
          accountId: partnerAccount?.userId ?? '',
          reservationId,
          totalCharge: commission.base,
          totalTax: commission.vat,
          totalAmount: totalServiceFee,
          invoicedAt,
          issuerType: 'PLATFORM',
          issuerVatNumber: businessEntity.vatId || null,
          issuerCompanyName: businessEntity.companyName,
          issuerCompanyAddress: businessEntity.companyAddress || null,
          ...commissionRecipientFields(partnerAccount),
          reverseCharge: commission.reverseCharge,
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
          charge: commission.base,
          tax: commission.vat,
          amount: totalServiceFee,
          vatRate: commission.vatRate,
          invoiceId: platformInvoice.id,
          productCode: 'sunbnb-service-fee',
          description: `Reservation service fee${feeCountry ? ` (${feeCountry})` : ''}`,
        },
      })
    }

    // Only advance the payment status for online payments. Cash walk-ins stay
    // at 'paid-in-cash' — the receipt is a separate accounting artifact.
    if (!skipCommission) {
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: RESERVATION_COMPLETE },
      })
    }
  })

  // Send confirmation email (non-blocking, non-throwing). Suppressed for cash
  // receipts / backfills via skipEmail — see ProcessReservationOpts.skipEmail.
  if (!skipEmail) {
    try {
      const { sendConfirmationEmail } = await import('./reservation-emails')
      sendConfirmationEmail(reservationId).catch(() => {})
    } catch {
      // best-effort: a confirmation-email failure must not block invoice creation
    }
  }
}

// ─── Cash Credit Note (rectificative receipt) ───────────────────────────────

export interface CashCreditNoteOpts {
  /**
   * Cash amount returned to the guest (positive euros). Defaults to the full
   * remaining creditable amount of the receipt. Always capped at
   * (receipt total − already-credited sum) so a lineage of partial refunds can
   * never over-credit the original document.
   */
  amount?: number
  /** Back-date the credit note (mirrors ProcessReservationOpts.invoicedAt). */
  invoicedAt?: Date
}

export type CashCreditNoteResult =
  | { status: 'created'; invoiceId: string; invoiceNumber: string; amount: number }
  | { status: 'skipped'; reason: 'no-receipt' | 'fully-credited' | 'zero-amount' }

/**
 * Issue a credit note against a reservation's PARTNER cash receipt (track 018
 * P2d — the machine's `creditNoteIssue` effect; closes track 015's deferred
 * "cash refund → credit-note").
 *
 * Model: a credit note is an Invoice with NEGATIVE totals/lines, issuerType
 * 'PARTNER' (it participates in the partner's Veri*factu hash chain), its own
 * number series `PARTNER-CN-YYYY-NNNNN`, and `creditsInvoiceId` pointing at the
 * receipt it rectifies. Invoices are immutable (hash chain) — money returned is
 * recorded forward, never by editing or deleting the receipt (I2: over a
 * lineage, Σ receipts − Σ credit notes ≡ Σ non-voided till entries).
 *
 * Negative amounts mean existing PARTNER revenue aggregations net refunds out
 * automatically. VAT is reverse-computed at the receipt's own effective rate
 * (totalTax/totalCharge), so partial credits stay proportional even if the
 * site's configured VAT has changed since the sale.
 *
 * Idempotent per remaining balance: re-running with the same amount after a
 * full credit is a no-op ('fully-credited'). Race-safe: the FOR UPDATE
 * invoice-number lock serialises concurrent issuers, and the balance re-check
 * runs inside the transaction.
 */
export async function issueCashCreditNote(
  reservationId: string,
  opts?: CashCreditNoteOpts,
): Promise<CashCreditNoteResult> {
  // The receipt: the reservation's positive PARTNER invoice (cash receipts and
  // online PARTNER invoices share the shape; credit notes exclude themselves).
  const receipt = await prisma.invoice.findFirst({
    where: {
      reservationId,
      issuerType: 'PARTNER',
      creditsInvoiceId: null,
      totalAmount: { gt: 0 },
    },
    orderBy: { invoicedAt: 'asc' },
  })
  if (!receipt) return { status: 'skipped', reason: 'no-receipt' }

  const invoicedAt = opts?.invoicedAt ?? new Date()
  const invoiceYear = invoicedAt.getFullYear()

  const result = await prisma.$transaction(async (tx) => {
    // Balance check INSIDE the tx (serialised by the number lock below for
    // concurrent credit issuers on the same issuer series).
    const credited = await tx.invoice.aggregate({
      where: { creditsInvoiceId: receipt.id },
      _sum: { totalAmount: true },
    })
    const alreadyCredited = round(Math.abs(credited._sum.totalAmount ?? 0))
    const creditable = round(receipt.totalAmount - alreadyCredited)
    if (creditable <= 0) return { status: 'skipped' as const, reason: 'fully-credited' as const }

    const requested = opts?.amount !== undefined ? round(opts.amount) : creditable
    if (requested <= 0) return { status: 'skipped' as const, reason: 'zero-amount' as const }
    const amount = Math.min(requested, creditable)

    // VAT at the receipt's own effective rate — proportional to the original.
    const effectiveVatRate =
      receipt.totalCharge > 0 ? (receipt.totalTax / receipt.totalCharge) * 100 : 0
    const { baseAmount, vatAmount } = computeVatAndBaseAmounts(amount, effectiveVatRate)

    const invoiceNumber = await nextInvoiceNumber(tx, 'PARTNER', invoiceYear, 'CN')
    const previousHash = await getLastHash(tx, 'PARTNER')

    const creditNote = await tx.invoice.create({
      data: {
        accountId: receipt.accountId,
        reservationId,
        creditsInvoiceId: receipt.id,
        totalCharge: -baseAmount,
        totalTax: -vatAmount,
        totalAmount: -amount,
        invoicedAt,
        issuerType: 'PARTNER',
        issuerVatNumber: receipt.issuerVatNumber,
        issuerCompanyName: receipt.issuerCompanyName,
        issuerCompanyAddress: receipt.issuerCompanyAddress,
        product: receipt.product,
        invoiceNumber,
        previousHash,
        hash: computeInvoiceHash(
          invoiceNumber, invoicedAt, -amount,
          receipt.issuerVatNumber, previousHash,
        ),
      },
    })

    await tx.invoiceLine.create({
      data: {
        invoiceId: creditNote.id,
        charge: -baseAmount,
        tax: -vatAmount,
        amount: -amount,
        vatRate: round(effectiveVatRate),
        productCode: 'cash-refund-credit',
        description: `Credit note for ${receipt.invoiceNumber ?? receipt.id} — cash refund`,
      },
    })

    return { status: 'created' as const, invoiceId: creditNote.id, invoiceNumber, amount }
  })

  return result
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

  // Agent model: PARTNER invoice booked GROSS; commission billed separately.
  const partnerAmount = totalPayment

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

    // One line per booking, at the full price (gross).
    const partnerLines = bookings.map((booking) => {
      const bookingPrice = round(booking.paymentAmount ?? booking.totalPrice ?? 0)
      const { baseAmount: lineBase, vatAmount: lineVat } =
        computeVatAndBaseAmounts(bookingPrice, siteVatRate)

      return {
        charge: lineBase,
        tax: lineVat,
        amount: bookingPrice,
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
      const commission = computeCommissionVat(
        totalServiceFee, platformVatRate,
        partnerAccount?.country, partnerAccount?.businessId, feeCountry
      )

      const platformInvoiceNumber = await nextInvoiceNumber(tx, 'PLATFORM')
      const platformPrevHash = await getLastHash(tx, 'PLATFORM')

      const platformInvoice = await tx.invoice.create({
        data: {
          accountId: partnerAccount?.userId ?? '',
          paymentRef,
          totalCharge: commission.base,
          totalTax: commission.vat,
          totalAmount: totalServiceFee,
          invoicedAt,
          issuerType: 'PLATFORM',
          issuerVatNumber: businessEntity.vatId || null,
          issuerCompanyName: businessEntity.companyName,
          issuerCompanyAddress: businessEntity.companyAddress || null,
          ...commissionRecipientFields(partnerAccount),
          reverseCharge: commission.reverseCharge,
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
          charge: commission.base,
          tax: commission.vat,
          amount: totalServiceFee,
          vatRate: commission.vatRate,
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

  // Send confirmation email to the first booking's recipient (non-blocking, non-throwing).
  // The first booking is a representative for the paymentRef group — site, item, and
  // time window are shared for typical single-item rentals. Multi-item groups use the
  // first booking's data (matches the paymentRef's primary booking).
  const firstBookingId = bookings[0]!.id
  try {
    const { sendRentalConfirmationEmail } = await import('./rental-emails')
    sendRentalConfirmationEmail(firstBookingId).catch(() => {})
  } catch {
    // best-effort: a confirmation-email failure must not block invoice creation
  }
}

// ─── Cash Rental Booking Receipt ────────────────────────────────────────────

export interface ProcessCashRentalOpts {
  /**
   * Override the invoice date. Defaults to `new Date()`. When set, the invoice
   * number's year segment is derived from this date's year so that a back-dated
   * receipt (e.g. a June sale) is numbered in its sale year, not the current year.
   */
  invoicedAt?: Date
}

/**
 * Create a PARTNER-only receipt for a single cash/walk-in rental booking.
 *
 * Design rationale: `processConfirmedRentalBooking` is keyed on `paymentRef`
 * (the Mollie shared payment reference for an online group of bookings). Cash
 * walk-in rentals created via `createWalkInRental` have `paymentRef: null`, so
 * the paymentRef-keyed function cannot serve them. This companion function
 * accepts a single `rentalBookingId` and creates a PARTNER-only invoice for
 * that one booking — no PLATFORM commission (no Mollie routing occurred), no
 * status mutation (the booking stays in its current operational state).
 *
 * VAT: uses `site.rentalVat` with fallback to `site.vat`, matching the VAT
 * rate used by `processConfirmedRentalBooking`.
 *
 * Idempotent: if the booking already has an invoice, returns immediately.
 * Safe to call multiple times (webhook + polling convergence patterns).
 */
export async function processCashRentalBooking(
  rentalBookingId: string,
  opts?: ProcessCashRentalOpts
): Promise<void> {
  const invoicedAtOverride = opts?.invoicedAt

  const booking = await prisma.rentalBooking.findUnique({
    where: { id: rentalBookingId },
    include: { rentalItem: true },
  })

  if (!booking) {
    throw new Error(`RentalBooking not found: ${rentalBookingId}`)
  }

  // The Invoice model has NO rentalBookingId FK — rental invoices link via
  // `paymentRef` (that's how the online grouped path works). Cash walk-in rentals
  // have a null paymentRef, so we derive a deterministic per-booking ref for both
  // linkage and idempotency. (If the booking already has a paymentRef, reuse it.)
  const cashRef = booking.paymentRef ?? `cash-rental-${rentalBookingId}`

  // Idempotency guard: a receipt for this booking already exists.
  const existingInvoices = await prisma.invoice.count({
    where: { paymentRef: cashRef },
  })
  if (existingInvoices > 0) {
    return
  }

  const { site, partnerAccount } = await loadFeeContext(
    booking.siteId,
    'equipment-rental'
  )

  const bookingPrice = round(booking.paymentAmount ?? booking.totalPrice ?? 0)
  const siteVatRate = site.rentalVat ?? site.vat ?? 0

  await prisma.$transaction(async (tx) => {
    // Double-check idempotency inside transaction (race-safe) — by paymentRef.
    const invoiceCount = await tx.invoice.count({ where: { paymentRef: cashRef } })
    if (invoiceCount > 0) return

    const invoicedAt = invoicedAtOverride ?? new Date()
    // Invoice number year comes from invoicedAt so that backfilled receipts
    // are numbered in their sale year, not the current calendar year.
    const invoiceYear = invoicedAt.getFullYear()

    // ── PARTNER Invoice (single equipment line) ──

    const { baseAmount: partnerBase, vatAmount: partnerVat } =
      computeVatAndBaseAmounts(bookingPrice, siteVatRate)

    const partnerInvoiceNumber = await nextInvoiceNumber(tx, 'PARTNER', invoiceYear)
    const partnerPrevHash = await getLastHash(tx, 'PARTNER')

    const partnerInvoice = await tx.invoice.create({
      data: {
        accountId: partnerAccount?.userId ?? '',
        paymentRef: cashRef,
        totalCharge: partnerBase,
        totalTax: partnerVat,
        totalAmount: bookingPrice,
        invoicedAt,
        issuerType: 'PARTNER',
        issuerVatNumber: partnerAccount?.businessId ?? null,
        issuerCompanyName: partnerAccount?.company ?? null,
        issuerCompanyAddress: partnerAccount?.address ?? null,
        invoiceNumber: partnerInvoiceNumber,
        previousHash: partnerPrevHash,
        hash: computeInvoiceHash(
          partnerInvoiceNumber, invoicedAt, bookingPrice,
          partnerAccount?.businessId ?? null, partnerPrevHash
        ),
      },
    })

    // Single line: one booking at the full listed price (gross)
    await tx.invoiceLine.create({
      data: {
        charge: partnerBase,
        tax: partnerVat,
        amount: bookingPrice,
        vatRate: siteVatRate,
        invoiceId: partnerInvoice.id,
        productCode: 'equipment-rental',
        description: `${booking.rentalItem?.name ?? 'Equipment'} × ${booking.quantity}`,
      },
    })

    // Status is NOT mutated — cash walk-in rental stays in its operational state.
  })
}

// ─── Idempotent Order Processing ────────────────────────────────────────────

export interface ProcessOrderOpts {
  /**
   * Skip the PLATFORM commission invoice. Use for cash/walk-in orders where
   * the partner is the sole merchant and no Mollie application fee was routed.
   * When true: only a PARTNER invoice is created; order.status is NOT updated
   * (it remains in its current state, e.g. 'complete' after the counter staff
   * marks it delivered).
   */
  skipCommission?: boolean
  /**
   * Override the invoice date. Defaults to `new Date()`. When set, the invoice
   * number's year segment is derived from this date's year so that a back-dated
   * receipt (e.g. a June sale) is numbered in its sale year, not the current year.
   */
  invoicedAt?: Date
}

/**
 * Process a confirmed order payment: create invoices atomically.
 *
 * Default (no opts) — SPLIT MERCHANT model, behaviour unchanged:
 *   1. PARTNER invoice — product item lines (food & beverage)
 *      Taxed at the partner site's VAT rate.
 *      Merchant of record: partner company.
 *   2. PLATFORM invoice — service fee line
 *      Taxed at the VAT rate from the fee's associated Settings entry.
 *      Merchant of record: Sunbnb business entity.
 *   Status is set to ORDER_COMPLETE.
 *
 * With { skipCommission: true } — PARTNER-only receipt for cash/walk-in sales:
 *   1. PARTNER invoice only — same product lines with per-item VAT.
 *   No PLATFORM invoice is created.
 *   Status is NOT mutated (stays in its current state).
 *
 * Fee model: fees are INCLUDED in the product price.
 * Customer pays exactly order.paymentAmount (the product total).
 * Service fee is deducted and invoiced separately by the platform.
 *
 * Safe to call multiple times — skips if already processed.
 */
export async function processConfirmedOrder(
  orderId: string,
  opts?: ProcessOrderOpts
): Promise<void> {
  const skipCommission = opts?.skipCommission ?? false
  const invoicedAtOverride = opts?.invoicedAt

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true, invoices: true },
  })

  if (!order) {
    throw new Error(`Order not found: ${orderId}`)
  }

  // Idempotency guard: already processed.
  // The status check (ORDER_COMPLETE) is only meaningful for the online path —
  // cash orders may already be at status 'complete' (operators mark them
  // delivered before the receipt is generated), so for the cash path we rely
  // solely on invoice existence.
  if (order.invoices.length > 0) {
    return
  }
  if (!skipCommission && order.status === ORDER_COMPLETE) {
    return
  }

  // Dine-tab orders (restaurant-anchored, siteId possibly null) are invoiced
  // as a group via processConfirmedTabPayment, never individually here.
  if (!order.siteId) {
    throw new Error(`Order ${order.id} has no siteId — not processable on the site order rail`)
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

  // Agent model: partner lines are booked GROSS (full per-item price). The
  // commission is billed separately to the partner on the PLATFORM invoice.
  let totalPartnerCharge = 0
  let totalPartnerVat = 0
  let totalPartnerAmount = 0

  const itemCalcs = order.orderItems.map((item) => {
    const itemGross = round(item.totalPrice)
    const { baseAmount: lineBase, vatAmount: lineVat } =
      computeVatAndBaseAmounts(itemGross, item.tax)
    totalPartnerCharge += lineBase
    totalPartnerVat += lineVat
    totalPartnerAmount += itemGross
    return { lineBase, lineVat, itemGross, item }
  })

  totalPartnerCharge = round(totalPartnerCharge)
  totalPartnerVat = round(totalPartnerVat)
  totalPartnerAmount = round(totalPartnerAmount)

  // Load platform business entity for the PLATFORM invoice (only needed when
  // creating the commission invoice, but load outside the transaction to keep
  // the transaction short and avoid blocking on an external read).
  const businessEntity = skipCommission ? null : await getBusinessEntity()

  // Use the VAT rate & country from the fee's associated settings
  const feeSettings =
    !skipCommission && matchedFee
      ? await prisma.settings.findUnique({
          where: { id: matchedFee.settingsId },
          select: { vat: true, country: true },
        })
      : null
  const platformVatRate = feeSettings?.vat ?? businessEntity?.vatRate ?? 0
  const feeCountry = feeSettings?.country ?? ''

  await prisma.$transaction(async (tx) => {
    // Double-check idempotency inside transaction (race-safe).
    // Same logic as the outer guard: cash path checks invoice existence only.
    const current = await tx.order.findUnique({
      where: { id: orderId },
      include: { invoices: true },
    })
    if ((current?.invoices?.length ?? 0) > 0) return
    if (!skipCommission && current?.status === ORDER_COMPLETE) return

    const invoicedAt = invoicedAtOverride ?? new Date()
    // Invoice number year comes from invoicedAt so that backfilled receipts
    // are numbered in their sale year, not the current calendar year.
    const invoiceYear = invoicedAt.getFullYear()

    // ── 1. PARTNER Invoice (product lines) ──

    const partnerInvoiceNumber = await nextInvoiceNumber(tx, 'PARTNER', invoiceYear)
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

    const itemLines = itemCalcs.map(({ lineBase, lineVat, itemGross, item }) => {
      return {
        charge: lineBase,
        tax: lineVat,
        amount: itemGross,
        vatRate: item.tax,
        invoiceId: partnerInvoice.id,
        productCode: 'food-and-beverage',
        description: `${item.name} x (${item.quantity})`,
      }
    })

    if (itemLines.length > 0) {
      await tx.invoiceLine.createMany({ data: itemLines })
    }

    // ── 2. PLATFORM Invoice (service fee) — skipped for cash/walk-in receipts ──

    if (!skipCommission && serviceFeeAmount > 0 && businessEntity) {
      const commission = computeCommissionVat(
        serviceFeeAmount, platformVatRate,
        partnerAccount?.country, partnerAccount?.businessId, feeCountry
      )

      const platformInvoiceNumber = await nextInvoiceNumber(tx, 'PLATFORM', invoiceYear)
      const platformPrevHash = await getLastHash(tx, 'PLATFORM')

      const platformInvoice = await tx.invoice.create({
        data: {
          accountId: partnerAccount?.userId ?? '',
          orderId,
          totalCharge: commission.base,
          totalTax: commission.vat,
          totalAmount: serviceFeeAmount,
          invoicedAt,
          issuerType: 'PLATFORM',
          issuerVatNumber: businessEntity.vatId || null,
          issuerCompanyName: businessEntity.companyName,
          issuerCompanyAddress: businessEntity.companyAddress || null,
          ...commissionRecipientFields(partnerAccount),
          reverseCharge: commission.reverseCharge,
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
          charge: commission.base,
          tax: commission.vat,
          amount: serviceFeeAmount,
          vatRate: commission.vatRate,
          invoiceId: platformInvoice.id,
          productCode: 'sunbnb-service-fee',
          description: `Order service fee${feeCountry ? ` (${feeCountry})` : ''}`,
        },
      })
    }

    // Only advance the payment status for online payments. Cash walk-in orders
    // stay at their current state — the receipt is a separate accounting artifact.
    if (!skipCommission) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: ORDER_COMPLETE },
      })
    }
  })
}

// ─── Idempotent Table-Reservation Deposit Processing ────────────────────────

/**
 * Process a kept no-show deposit: create two invoices atomically.
 *
 * Called when `chargeNoShowDeposit` transitions depositStatus HELD → CHARGED.
 * The deposit amount is already collected; this function records the revenue
 * split for accounting and Veri*factu chain purposes.
 *
 * SPLIT MERCHANT model (mirrors processConfirmedReservation):
 *   1. PARTNER invoice — one line for the kept deposit amount
 *      Taxed at the linked Site's vat rate (same source as sunbed reservations).
 *      Merchant of record: partner company.
 *   2. PLATFORM invoice — service fee line (deducted from partner revenue)
 *      Taxed at the VAT rate from the fee's associated Settings entry.
 *      Merchant of record: Sunbnb business entity.
 *
 * Service code: 'no-show-deposit'. Fee is DEDUCTED from partner revenue
 * (reservation convention) — customer already paid the deposit amount in full.
 *
 * Scope constraint: requires a site-linked restaurant (restaurant.siteId must
 * be non-null). Throws if the restaurant has no site link.
 *
 * Safe to call multiple times — skips if invoices already exist for this
 * tableReservationId.
 */
export async function processChargedTableDeposit(
  tableReservationId: string
): Promise<void> {
  const tableReservation = await prisma.tableReservation.findUnique({
    where: { id: tableReservationId },
    include: { restaurant: true, invoices: true },
  })

  if (!tableReservation) {
    throw new Error(`TableReservation not found: ${tableReservationId}`)
  }

  // Idempotency guard: bail if invoices already exist
  if (tableReservation.invoices.length > 0) {
    return
  }

  if (!tableReservation.depositAmount || tableReservation.depositAmount <= 0) {
    throw new Error(
      `TableReservation ${tableReservationId} has no deposit amount to process`
    )
  }

  const { restaurant } = tableReservation
  if (!restaurant.siteId) {
    throw new Error('Deposit cascade requires a site-linked restaurant')
  }

  const siteId = restaurant.siteId

  const { site, partnerAccount, settings } = await loadFeeContext(
    siteId,
    'no-show-deposit'
  )

  const tier = partnerAccount?.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'no-show-deposit',
    tier
  )

  const totalDeposit = round(tableReservation.depositAmount)
  const siteVatRate = site.vat ?? 0

  const totalServiceFee = calculateServiceFeeAmount(matchedFee, totalDeposit)
  // Agent model: PARTNER invoice booked GROSS (full kept deposit); commission
  // billed separately to the partner on the PLATFORM invoice.
  const partnerAmount = totalDeposit

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
    // Double-check idempotency inside transaction (race-safe)
    const current = await tx.tableReservation.findUnique({
      where: { id: tableReservationId },
      include: { invoices: true },
    })
    if ((current?.invoices?.length ?? 0) > 0) return

    const invoicedAt = new Date()

    // ── 1. PARTNER Invoice (kept deposit line) ──

    const { baseAmount: partnerBase, vatAmount: partnerVat } =
      computeVatAndBaseAmounts(partnerAmount, siteVatRate)

    const partnerInvoiceNumber = await nextInvoiceNumber(tx, 'PARTNER')
    const partnerPrevHash = await getLastHash(tx, 'PARTNER')

    const partnerInvoice = await tx.invoice.create({
      data: {
        accountId: partnerAccount?.userId ?? '',
        tableReservationId,
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
        product: 'restaurant',
      },
    })

    // Single line: the kept no-show deposit
    await tx.invoiceLine.create({
      data: {
        charge: partnerBase,
        tax: partnerVat,
        amount: partnerAmount,
        vatRate: siteVatRate,
        invoiceId: partnerInvoice.id,
        productCode: 'no-show-deposit',
        description: `No-show deposit — ${tableReservation.guestName} (party of ${tableReservation.partySize})`,
      },
    })

    // ── 2. PLATFORM Invoice (service fee) ──

    if (totalServiceFee > 0) {
      const commission = computeCommissionVat(
        totalServiceFee, platformVatRate,
        partnerAccount?.country, partnerAccount?.businessId, feeCountry
      )

      const platformInvoiceNumber = await nextInvoiceNumber(tx, 'PLATFORM')
      const platformPrevHash = await getLastHash(tx, 'PLATFORM')

      const platformInvoice = await tx.invoice.create({
        data: {
          accountId: partnerAccount?.userId ?? '',
          tableReservationId,
          totalCharge: commission.base,
          totalTax: commission.vat,
          totalAmount: totalServiceFee,
          invoicedAt,
          issuerType: 'PLATFORM',
          issuerVatNumber: businessEntity.vatId || null,
          issuerCompanyName: businessEntity.companyName,
          issuerCompanyAddress: businessEntity.companyAddress || null,
          ...commissionRecipientFields(partnerAccount),
          reverseCharge: commission.reverseCharge,
          invoiceNumber: platformInvoiceNumber,
          previousHash: platformPrevHash,
          hash: computeInvoiceHash(
            platformInvoiceNumber, invoicedAt, totalServiceFee,
            businessEntity.vatId || null, platformPrevHash
          ),
          product: 'restaurant',
        },
      })

      await tx.invoiceLine.create({
        data: {
          charge: commission.base,
          tax: commission.vat,
          amount: totalServiceFee,
          vatRate: commission.vatRate,
          invoiceId: platformInvoice.id,
          productCode: 'sunbnb-service-fee',
          description: `No-show deposit service fee${feeCountry ? ` (${feeCountry})` : ''}`,
        },
      })
    }
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
  if (!order.siteId) {
    throw new Error(`Order ${order.id} has no siteId — tab orders use calculateTabTotal`)
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

  const amount = order.paymentAmount ?? 0
  return calculateServiceFeeAmount(matchedFee, amount)
}

// ─── Dine-In Tab: Total Calculation ─────────────────────────────────────────

export interface TabTotalResult {
  /** Sum of paymentAmount across all not-yet-paid orders on the tab. */
  ordersTotal: number
  /**
   * Platform commission on the tab total — NOT added to the customer total.
   * Computed in parallel for the Mollie applicationFee and the PLATFORM
   * commission invoice; comes out of partner revenue (payments.md).
   */
  serviceFee: number
  /** What the customer pays: exactly the sum of menu prices (= ordersTotal). */
  payableTotal: number
  /** IDs of the orders included in this calculation. */
  orderIds: string[]
}

/**
 * Read-only. Sum the tab's unpaid orders to derive the amount the customer
 * must pay, and compute the platform commission in parallel.
 *
 * Fee model (founder-decided 2026-07-25, all F&B): the consumer sees and pays
 * MENU PRICES ONLY — one price, one VAT. The service fee is never added to
 * the customer total; it is deducted from partner revenue via the Mollie
 * applicationFee and billed as the PLATFORM commission invoice, exactly like
 * sunbed reservations and sunbed F&B orders. (v1 dine-in tabs added the fee
 * on top — that model is retired.)
 *
 * "Unpaid orders" = orders on the tab whose status is not yet ORDER_COMPLETE
 * and which have a paymentAmount (i.e. the price has been confirmed by the
 * kitchen flow). In practice for tab ordering, all orders on an open tab are
 * candidates since the tab is paid once at the end.
 */
export async function calculateTabTotal(tabId: string): Promise<TabTotalResult> {
  const tab = await prisma.tableTab.findUnique({
    where: { id: tabId },
    include: {
      orders: {
        where: { status: { notIn: TAB_ORDER_VOID_STATUSES } },
        select: { id: true, paymentAmount: true, totalPrice: true },
      },
    },
  })

  if (!tab) throw new Error(`TableTab not found: ${tabId}`)

  const orders = tab.orders
  const ordersTotal = round(
    orders.reduce((sum, o) => sum + (o.paymentAmount ?? o.totalPrice ?? 0), 0)
  )
  const orderIds = orders.map((o) => o.id)

  const { siteFees, partnerAccount, settings, tier } = await loadTabFeeContext(
    tab,
    'food-and-beverage'
  )

  const matchedFee = resolveServiceFee(
    siteFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'food-and-beverage',
    tier
  )

  const serviceFee = calculateServiceFeeAmount(matchedFee, ordersTotal)
  // Customer pays menu prices only; the fee rides in parallel (applicationFee
  // + PLATFORM invoice), never on top.
  const payableTotal = ordersTotal

  return { ordersTotal, serviceFee, payableTotal, orderIds }
}

// ─── Dine-In Tab: Idempotent Payment Processing ──────────────────────────────

export interface ProcessTabPaymentOpts {
  /**
   * When true, this is a staff cash settlement (track 015 cash-receipt
   * precedent): only a PARTNER invoice is created — no PLATFORM commission
   * invoice. Terminal status becomes TAB_SETTLED_CASH (not TAB_PAID).
   * `tab.paymentRef` may be null; it is NOT required or fabricated for cash.
   *
   * When false/absent (default): full online path — PARTNER + PLATFORM
   * invoices, status = TAB_PAID.
   */
  cash?: boolean
}

/**
 * Process a confirmed tab payment: create invoices atomically across all
 * order rounds of the tab, then mark every order paid and close the tab.
 *
 * Default (no opts / cash: false) — SPLIT MERCHANT model:
 *   1. PARTNER invoice — one InvoiceLine per OrderItem across all rounds,
 *      each line taxed at its own item.tax rate (per-item VAT, like
 *      processConfirmedOrder). Linked via tableTabId.
 *   2. PLATFORM invoice — single service-fee line, B2B commission billed to
 *      the partner. Linked via tableTabId.
 *   Tab closed with status = TAB_PAID.
 *
 * With { cash: true } — PARTNER-only receipt (mirrors processConfirmedReservation
 * skipCommission path, track 015):
 *   1. PARTNER invoice only — same per-item lines as above. No PLATFORM invoice.
 *   `tab.paymentRef` is null / may be absent; no paymentRef written to orders.
 *   Tab closed with status = TAB_SETTLED_CASH.
 *
 * Fee model: `food-and-beverage`. Orders ADD the fee to the customer total
 * (payments.md) — the fee is NOT netted from the PARTNER invoice amount.
 *
 * Idempotency: existing-invoice check on tableTabId AND terminal-status check
 * both before AND inside the transaction. Both TAB_PAID and TAB_SETTLED_CASH
 * are treated as terminal — a cash-settled tab cannot be re-processed by a
 * late webhook (online path), and vice versa.
 *
 * On completion (inside the transaction):
 *   - Each billed order: paymentRef stamped only when present (null for cash).
 *     Kitchen lifecycle states are preserved (payment happens AFTER the kitchen
 *     for tab orders — only pending/processing stragglers are normalized to
 *     ORDER_COMPLETE). Voided orders (canceled/rejected/discarded/refunded) are
 *     neither charged nor invoiced.
 *   - Tab: status = TAB_PAID or TAB_SETTLED_CASH, closedAt = now(),
 *     openTableId = null (MANDATORY — releases the concurrency guard so a new
 *     tab can be opened on the same table).
 *
 * Safe to call multiple times — skips if already processed (idempotent).
 */
export async function processConfirmedTabPayment(
  tabId: string,
  opts?: ProcessTabPaymentOpts,
): Promise<void> {
  const skipCommission = opts?.cash ?? false

  const tab = await prisma.tableTab.findUnique({
    where: { id: tabId },
    include: {
      orders: {
        // Same void-exclusion as calculateTabTotal: a discarded/canceled
        // round is neither charged nor invoiced.
        where: { status: { notIn: TAB_ORDER_VOID_STATUSES } },
        include: { orderItems: true },
      },
      invoices: true,
    },
  })

  if (!tab) throw new Error(`TableTab not found: ${tabId}`)

  // Idempotency guard: already processed (both terminal outcomes are final)
  if (tab.invoices.length > 0) return
  if (tab.status === TAB_PAID || tab.status === TAB_SETTLED_CASH) return

  const orders = tab.orders

  const { siteFees, partnerAccount, settings, tier } = await loadTabFeeContext(
    tab,
    'food-and-beverage'
  )

  const matchedFee = resolveServiceFee(
    siteFees,
    partnerAccount?.serviceFees ?? [],
    settings?.serviceFees ?? [],
    'food-and-beverage',
    tier
  )

  // Accumulate per-item lines (per-item VAT like processConfirmedOrder).
  let totalPartnerCharge = 0
  let totalPartnerVat = 0
  let totalPartnerAmount = 0

  const allItemCalcs: Array<{
    lineBase: number
    lineVat: number
    itemGross: number
    item: { name: string; quantity: number; totalPrice: number; tax: number }
  }> = []

  for (const order of orders) {
    for (const item of order.orderItems) {
      const itemGross = round(item.totalPrice)
      const { baseAmount: lineBase, vatAmount: lineVat } =
        computeVatAndBaseAmounts(itemGross, item.tax)
      totalPartnerCharge += lineBase
      totalPartnerVat += lineVat
      totalPartnerAmount += itemGross
      allItemCalcs.push({ lineBase, lineVat, itemGross, item })
    }
  }

  totalPartnerCharge = round(totalPartnerCharge)
  totalPartnerVat = round(totalPartnerVat)
  totalPartnerAmount = round(totalPartnerAmount)

  // Fee is calculated on the gross orders total (payments.md: orders add to
  // customer total — fee on top, not netted from partner amount).
  // For cash settlements no commission invoice is created — skip fee/entity loads.
  const serviceFeeAmount = skipCommission
    ? 0
    : calculateServiceFeeAmount(matchedFee, totalPartnerAmount)

  const businessEntity = skipCommission ? null : await getBusinessEntity()

  const feeSettings =
    !skipCommission && matchedFee
      ? await prisma.settings.findUnique({
          where: { id: matchedFee.settingsId },
          select: { vat: true, country: true },
        })
      : null
  const platformVatRate = feeSettings?.vat ?? businessEntity?.vatRate ?? 0
  const feeCountry = feeSettings?.country ?? ''

  const paymentRef = tab.paymentRef

  await prisma.$transaction(async (tx) => {
    // Double-check idempotency inside transaction (race-safe).
    // Both TAB_PAID and TAB_SETTLED_CASH are terminal — a cash-settled tab
    // must not be re-processable by a late online webhook, and vice versa.
    const current = await tx.tableTab.findUnique({
      where: { id: tabId },
      include: { invoices: true },
    })
    if ((current?.invoices?.length ?? 0) > 0) return
    if (current?.status === TAB_PAID || current?.status === TAB_SETTLED_CASH) return

    const invoicedAt = new Date()

    // ── 1. PARTNER Invoice (all order item lines) ──

    const partnerInvoiceNumber = await nextInvoiceNumber(tx, 'PARTNER')
    const partnerPrevHash = await getLastHash(tx, 'PARTNER')

    const partnerInvoice = await tx.invoice.create({
      data: {
        accountId: partnerAccount?.userId ?? '',
        tableTabId: tabId,
        paymentRef: paymentRef ?? undefined,
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
        product: 'restaurant',
      },
    })

    const itemLines = allItemCalcs.map(({ lineBase, lineVat, itemGross, item }) => ({
      charge: lineBase,
      tax: lineVat,
      amount: itemGross,
      vatRate: item.tax,
      invoiceId: partnerInvoice.id,
      productCode: 'food-and-beverage',
      description: `${item.name} x (${item.quantity})`,
    }))

    if (itemLines.length > 0) {
      await tx.invoiceLine.createMany({ data: itemLines })
    }

    // ── 2. PLATFORM Invoice (service fee) — skipped for cash settlements ──

    if (!skipCommission && serviceFeeAmount > 0 && businessEntity) {
      const commission = computeCommissionVat(
        serviceFeeAmount, platformVatRate,
        partnerAccount?.country, partnerAccount?.businessId, feeCountry
      )

      const platformInvoiceNumber = await nextInvoiceNumber(tx, 'PLATFORM')
      const platformPrevHash = await getLastHash(tx, 'PLATFORM')

      const platformInvoice = await tx.invoice.create({
        data: {
          accountId: partnerAccount?.userId ?? '',
          tableTabId: tabId,
          paymentRef: paymentRef ?? undefined,
          totalCharge: commission.base,
          totalTax: commission.vat,
          totalAmount: serviceFeeAmount,
          invoicedAt,
          issuerType: 'PLATFORM',
          issuerVatNumber: businessEntity.vatId || null,
          issuerCompanyName: businessEntity.companyName,
          issuerCompanyAddress: businessEntity.companyAddress || null,
          ...commissionRecipientFields(partnerAccount),
          reverseCharge: commission.reverseCharge,
          invoiceNumber: platformInvoiceNumber,
          previousHash: platformPrevHash,
          hash: computeInvoiceHash(
            platformInvoiceNumber, invoicedAt, serviceFeeAmount,
            businessEntity.vatId || null, platformPrevHash
          ),
          product: 'restaurant',
        },
      })

      await tx.invoiceLine.create({
        data: {
          charge: commission.base,
          tax: commission.vat,
          amount: serviceFeeAmount,
          vatRate: commission.vatRate,
          invoiceId: platformInvoice.id,
          productCode: 'sunbnb-service-fee',
          description: `Dine-in tab service fee${feeCountry ? ` (${feeCountry})` : ''}`,
        },
      })
    }

    // ── 3. Mark all orders paid and close the tab ──

    const orderIds = orders.map((o) => o.id)

    // Stamp the tab's paymentRef on every billed order (only when present —
    // cash settlements have no paymentRef). Do NOT touch kitchen lifecycle
    // states (accepted/preparing/ready/delivered) — tab orders reach the
    // kitchen BEFORE payment, so overwriting status here would regress a
    // delivered round back to 'complete'. Paid-ness is carried by the tab
    // status (TAB_PAID or TAB_SETTLED_CASH), not by order.status.
    if (paymentRef != null) {
      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: { paymentRef },
      })
    }

    // Only normalize stragglers that never entered the kitchen flow.
    await tx.order.updateMany({
      where: { id: { in: orderIds }, status: { in: [ORDER_PENDING, ORDER_PROCESSING] } },
      data: { status: ORDER_COMPLETE },
    })

    // Close the tab: set status, closedAt, and MUST null openTableId to release
    // the one-open-tab-per-table concurrency guard. Status is TAB_PAID for
    // online payments, TAB_SETTLED_CASH for staff cash settlements.
    await tx.tableTab.update({
      where: { id: tabId },
      data: {
        status: skipCommission ? TAB_SETTLED_CASH : TAB_PAID,
        closedAt: invoicedAt,
        openTableId: null,
      },
    })
  })
}
