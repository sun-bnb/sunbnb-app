/**
 * Provider-neutral online checkout (track 028, packet P1b).
 *
 * `resolveCheckoutIntent` loads the entity and computes amount + platform commission
 * EXACTLY the way the Mollie-specific paths do (reservation-payment.ts,
 * rental-payment.ts, and the user app's order / tab / table-deposit create-payment
 * routes) — same fee context loaders, same three-tier cascade, same launch-offer
 * waiver, same `round()`. `createOnlineCheckout` then hands the intent to the
 * provider adapter and records the returned ref through the sanctioned writers.
 *
 * Mollie keeps its own paths for now; this module serves the new Stripe / Viva
 * online providers. Amounts always come from the DB (payments.md), never the client.
 *
 * Reservation status writes happen ONLY via `markReservationCheckout*` in
 * reservation-payment.ts (single-writer guard) — never inline here.
 */

import prisma from '../index'
import {
  loadFeeContext,
  loadTabFeeContext,
  calculateTabTotal,
  chargeableServiceFee,
  resolveServiceFee,
  serviceFeeForUnits,
  round,
} from './payment'
import {
  markReservationCheckoutStarted,
  markReservationCheckoutFailed,
} from './reservation-payment'
import { markRentalCheckoutStarted, markRentalCheckoutFailed } from './rental-payment'
import { getOnlineAdapter } from './payment-providers'
import {
  ProviderNotReadyError,
  ProviderNotWiredError,
  type CheckoutIntent,
  type PaymentMeta,
  type ProviderAccount,
} from './payment-providers/types'
import {
  RESERVATION_PENDING,
  RESERVATION_PAID_IN_CASH,
  RENTAL_PENDING,
  ORDER_PENDING,
  ORDER_PROCESSING,
  ORDER_PAYMENT_FAILED,
  TAB_OPEN,
  TAB_PENDING_PAYMENT,
  TAB_TERMINAL_STATUSES,
} from './reservation-status'

export type CheckoutKind = 'reservation' | 'order' | 'rental' | 'tab' | 'table-deposit'

export interface CheckoutInput {
  kind: CheckoutKind
  reservationId?: string
  orderId?: string
  rentalBookingIds?: string[]
  tabId?: string
  tableReservationId?: string
  provider: 'stripe' | 'viva'
  redirectUrl: string
  webhookUrl: string
  metadataExtra?: Record<string, unknown>
}

export type CheckoutFailure = {
  status: 'error'
  error: string
  reason:
    | 'invalid_amount'
    | 'not_found'
    | 'bad_state'
    | 'provider_not_ready'
    | 'provider_unavailable'
    | 'provider_error'
    | 'no_checkout'
}

type ResolveResult =
  | { status: 'ok'; intent: CheckoutIntent; account: ProviderAccount }
  | CheckoutFailure

// `@repo/table-reservations-core` depends on `@repo/data`, so its status constants can't
// be imported here without a cycle. These mirror TABLE_RESERVATION_STATUS.PENDING_PAYMENT
// and DEPOSIT_STATUS.PENDING in packages/table-reservations-core/src/status.ts.
const TABLE_RESERVATION_PENDING_PAYMENT = 'pending_payment'
const DEPOSIT_PENDING = 'pending'

const fail = (reason: CheckoutFailure['reason'], error: string): CheckoutFailure => ({
  status: 'error',
  error,
  reason,
})

/** A fresh online payment starts from `pending`; a partner QR collect starts from a cash walk-in. */
const COLLECTABLE_RESERVATION_STATUSES: readonly string[] = [RESERVATION_PENDING, RESERVATION_PAID_IN_CASH]
const COLLECTABLE_RENTAL_STATUSES: readonly string[] = [RENTAL_PENDING, RESERVATION_PAID_IN_CASH]

interface FeeCtxLike {
  siteFees: Parameters<typeof resolveServiceFee>[0]
  partnerAccount: (Parameters<typeof chargeableServiceFee>[1] & {
    serviceFees: Parameters<typeof resolveServiceFee>[1]
  }) | null
  settingsFees: Parameters<typeof resolveServiceFee>[2]
  tier: Parameters<typeof resolveServiceFee>[4]
}

/** The three-tier cascade + launch-offer waiver, identical to every Mollie path. */
function commissionFor(
  ctx: FeeCtxLike,
  serviceCode: string,
  amount: number,
  bookingCreatedAt: Date,
  units = 1,
): number {
  const matchedFee = chargeableServiceFee(
    resolveServiceFee(
      ctx.siteFees,
      ctx.partnerAccount?.serviceFees ?? [],
      ctx.settingsFees,
      serviceCode,
      ctx.tier,
    ),
    ctx.partnerAccount,
    bookingCreatedAt,
  )
  // Commission rule: serviceFeeForUnits (fixed per unit, percentage once on the total).
  return serviceFeeForUnits(matchedFee, { total: amount, units })
}

interface PartnerLike {
  userId: string
  stripeConnectAccountId?: string | null
  stripeConnectChargesEnabled?: boolean
  vivaMerchantId?: string | null
  vivaSourceCode?: string | null
  vivaVerificationStatus?: string | null
}

function accountFor(partnerAccount: PartnerLike): ProviderAccount {
  return {
    partnerAccountId: partnerAccount.userId,
    stripeConnectAccountId: partnerAccount.stripeConnectAccountId ?? null,
    stripeConnectChargesEnabled: partnerAccount.stripeConnectChargesEnabled ?? false,
    vivaMerchantId: partnerAccount.vivaMerchantId ?? null,
    vivaSourceCode: partnerAccount.vivaSourceCode ?? null,
    vivaVerificationStatus: partnerAccount.vivaVerificationStatus ?? null,
  }
}

function withExtra(meta: PaymentMeta, extra?: Record<string, unknown>): PaymentMeta {
  return { ...meta, ...(extra as Partial<PaymentMeta> | undefined) }
}

function feeCtxFromSite(ctx: Awaited<ReturnType<typeof loadFeeContext>>): FeeCtxLike {
  return {
    siteFees: ctx.site.serviceFees,
    partnerAccount: ctx.partnerAccount as FeeCtxLike['partnerAccount'],
    settingsFees: ctx.settings?.serviceFees ?? [],
    tier: ctx.partnerAccount?.subscription?.plan?.tier ?? null,
  }
}

export async function resolveCheckoutIntent(input: CheckoutInput): Promise<ResolveResult> {
  switch (input.kind) {
    case 'reservation': {
      if (!input.reservationId) return fail('not_found', 'Reservation not found')
      const reservation = await prisma.reservation.findUnique({
        where: { id: input.reservationId },
        include: { _count: { select: { items: true } } },
      })
      if (!reservation) return fail('not_found', 'Reservation not found')
      if (reservation.paymentRef) return fail('bad_state', 'Payment already created')
      if (!COLLECTABLE_RESERVATION_STATUSES.includes(reservation.status)) {
        return fail('bad_state', 'Reservation is not in a payable state')
      }
      const amount = reservation.paymentAmount ?? 0
      if (amount <= 0) return fail('invalid_amount', 'Invalid payment amount')

      const ctx = await loadFeeContext(reservation.siteId, 'sunbed-rental')
      if (!ctx.partnerAccount) return fail('provider_not_ready', 'Partner account not found')
      return {
        status: 'ok',
        account: accountFor(ctx.partnerAccount),
        intent: {
          amount,
          currency: 'EUR',
          serviceCode: 'sunbed-rental',
          applicationFee: commissionFor(feeCtxFromSite(ctx), 'sunbed-rental', amount, reservation.createdAt, reservation._count.items),
          description: `Reservation ${reservation.id}`,
          meta: withExtra(
            { type: 'reservation', entityId: reservation.id, siteId: reservation.siteId },
            input.metadataExtra,
          ),
          partnerAccountId: ctx.partnerAccount.userId,
          createdAt: reservation.createdAt,
        },
      }
    }

    case 'rental': {
      const bookingIds = input.rentalBookingIds ?? []
      if (bookingIds.length === 0 || bookingIds.length > 20) {
        return fail('invalid_amount', 'Booking list must contain between 1 and 20 ids')
      }
      const bookings = await prisma.rentalBooking.findMany({ where: { id: { in: bookingIds } } })
      if (bookings.length !== bookingIds.length) {
        return fail('not_found', 'One or more rental bookings not found')
      }
      const first = bookings[0]!
      if (bookings.some((b) => b.siteId !== first.siteId)) {
        return fail('invalid_amount', 'All bookings must belong to the same site')
      }
      if (bookings.some((b) => b.paymentRef)) return fail('bad_state', 'Payment already created')
      if (bookings.some((b) => !COLLECTABLE_RENTAL_STATUSES.includes(b.status))) {
        return fail('bad_state', 'Rental booking is not in a payable state')
      }
      const amount = round(bookings.reduce((sum, b) => sum + (b.paymentAmount ?? 0), 0))
      if (amount <= 0) return fail('invalid_amount', 'Invalid payment amount')

      const ctx = await loadFeeContext(first.siteId, 'equipment-rental')
      if (!ctx.partnerAccount) return fail('provider_not_ready', 'Partner account not found')
      return {
        status: 'ok',
        account: accountFor(ctx.partnerAccount),
        intent: {
          amount,
          currency: 'EUR',
          serviceCode: 'equipment-rental',
          applicationFee: commissionFor(feeCtxFromSite(ctx), 'equipment-rental', amount, first.createdAt, bookings.length),
          description: `Equipment rental ${first.id}`,
          meta: withExtra(
            { type: 'rental-booking', entityId: first.id, bookingIds, siteId: first.siteId },
            input.metadataExtra,
          ),
          partnerAccountId: ctx.partnerAccount.userId,
          createdAt: first.createdAt,
        },
      }
    }

    case 'order': {
      if (!input.orderId) return fail('not_found', 'Order not found')
      const order = await prisma.order.findUnique({ where: { id: input.orderId } })
      // Sunbed F&B orders are site-anchored; tab orders pay through the tab.
      if (!order || !order.siteId) return fail('not_found', 'Order not found')
      if (order.paymentRef) return fail('bad_state', 'Payment already created')
      if (order.status !== ORDER_PENDING) return fail('bad_state', 'Order is not in a payable state')
      const amount = order.paymentAmount ?? 0
      if (amount <= 0) return fail('invalid_amount', 'Invalid payment amount')

      const ctx = await loadFeeContext(order.siteId, 'food-and-beverage')
      if (!ctx.partnerAccount) return fail('provider_not_ready', 'Partner account not found')
      return {
        status: 'ok',
        account: accountFor(ctx.partnerAccount),
        intent: {
          amount,
          currency: 'EUR',
          serviceCode: 'food-and-beverage',
          applicationFee: commissionFor(feeCtxFromSite(ctx), 'food-and-beverage', amount, order.createdAt),
          description: `Order ${order.id}`,
          meta: withExtra({ type: 'order', entityId: order.id, siteId: order.siteId }, input.metadataExtra),
          partnerAccountId: ctx.partnerAccount.userId,
          createdAt: order.createdAt,
        },
      }
    }

    case 'tab': {
      if (!input.tabId) return fail('not_found', 'Tab not found')
      const tab = await prisma.tableTab.findUnique({
        where: { id: input.tabId },
        select: { id: true, siteId: true, restaurantId: true, createdAt: true, status: true, paymentRef: true },
      })
      if (!tab) return fail('not_found', 'Tab not found')
      if (tab.paymentRef) return fail('bad_state', 'Payment already created')
      // `open` (not yet claimed) or `pending_payment` (claimed by this payer).
      if (tab.status !== TAB_OPEN && tab.status !== TAB_PENDING_PAYMENT) {
        return fail('bad_state', 'Tab cannot be paid in its current state')
      }
      const totals = await calculateTabTotal(tab.id)
      const amount = totals.payableTotal
      if (amount <= 0) return fail('invalid_amount', 'Invalid payment amount')

      const ctx = await loadTabFeeContext(
        { siteId: tab.siteId, restaurantId: tab.restaurantId },
        'food-and-beverage',
      )
      if (!ctx.partnerAccount) return fail('provider_not_ready', 'Partner account not found')
      return {
        status: 'ok',
        account: accountFor(ctx.partnerAccount),
        intent: {
          amount,
          currency: 'EUR',
          serviceCode: 'food-and-beverage',
          applicationFee: commissionFor(
            {
              siteFees: ctx.siteFees,
              partnerAccount: ctx.partnerAccount as FeeCtxLike['partnerAccount'],
              settingsFees: ctx.settings?.serviceFees ?? [],
              tier: ctx.tier,
            },
            'food-and-beverage',
            amount,
            tab.createdAt,
          ),
          description: `Tab ${tab.id}`,
          meta: withExtra(
            {
              type: 'tab',
              entityId: tab.id,
              restaurantId: tab.restaurantId,
              ...(tab.siteId ? { siteId: tab.siteId } : {}),
            },
            input.metadataExtra,
          ),
          partnerAccountId: ctx.partnerAccount.userId,
          createdAt: tab.createdAt,
        },
      }
    }

    case 'table-deposit': {
      if (!input.tableReservationId) return fail('not_found', 'Reservation not found')
      const tr = await prisma.tableReservation.findUnique({
        where: { id: input.tableReservationId },
        select: {
          id: true,
          status: true,
          depositAmount: true,
          depositStatus: true,
          paymentRef: true,
          restaurantId: true,
          createdAt: true,
          restaurant: {
            select: {
              partnerAccount: {
                select: {
                  userId: true,
                  vivaMerchantId: true,
                  vivaSourceCode: true,
                  vivaVerificationStatus: true,
                  stripeConnectAccountId: true,
                  stripeConnectChargesEnabled: true,
                },
              },
            },
          },
        },
      })
      if (!tr) return fail('not_found', 'Reservation not found')
      if (tr.paymentRef) return fail('bad_state', 'Payment already created')
      if (tr.status !== TABLE_RESERVATION_PENDING_PAYMENT || tr.depositStatus !== DEPOSIT_PENDING) {
        return fail('bad_state', 'Reservation is not awaiting deposit payment')
      }
      const amount = tr.depositAmount ?? 0
      if (amount <= 0) return fail('invalid_amount', 'Invalid deposit amount')
      const partnerAccount = tr.restaurant.partnerAccount
      if (!partnerAccount) return fail('provider_not_ready', 'Partner account not found')
      return {
        status: 'ok',
        account: accountFor(partnerAccount),
        intent: {
          amount,
          currency: 'EUR',
          // A deposit is a consumer-to-partner guarantee: no platform commission at charge time.
          serviceCode: null,
          applicationFee: 0,
          description: `Deposit for table reservation ${tr.id}`,
          meta: withExtra(
            { type: 'table-deposit', entityId: tr.id, restaurantId: tr.restaurantId },
            input.metadataExtra,
          ),
          partnerAccountId: partnerAccount.userId,
          createdAt: tr.createdAt,
        },
      }
    }

    default:
      return fail('not_found', 'Unknown checkout kind')
  }
}

async function recordStarted(input: CheckoutInput, intent: CheckoutIntent, paymentRef: string) {
  switch (input.kind) {
    case 'reservation':
      return markReservationCheckoutStarted(intent.meta.entityId, paymentRef)
    case 'rental':
      return markRentalCheckoutStarted(intent.meta.bookingIds ?? [], paymentRef)
    case 'order':
      await prisma.order.update({
        where: { id: intent.meta.entityId },
        data: { paymentRef, status: ORDER_PROCESSING },
      })
      return
    case 'tab':
      // Status stays pending_payment, as the Mollie route does.
      await prisma.tableTab.update({ where: { id: intent.meta.entityId }, data: { paymentRef } })
      return
    case 'table-deposit':
      await prisma.tableReservation.update({ where: { id: intent.meta.entityId }, data: { paymentRef } })
      return
  }
}

async function recordFailed(input: CheckoutInput, intent: CheckoutIntent) {
  switch (input.kind) {
    case 'reservation':
      return markReservationCheckoutFailed(intent.meta.entityId)
    case 'rental':
      return markRentalCheckoutFailed(intent.meta.bookingIds ?? [])
    case 'order':
      await prisma.order.update({
        where: { id: intent.meta.entityId },
        data: { status: ORDER_PAYMENT_FAILED },
      })
      return
    case 'tab':
      return releaseTabClaim(intent.meta.entityId)
    case 'table-deposit':
      return // the Mollie deposit route leaves the reservation untouched on provider failure
  }
}

export async function createOnlineCheckout(
  input: CheckoutInput,
): Promise<{ status: 'ok'; checkoutUrl: string; paymentRef: string } | CheckoutFailure> {
  const resolved = await resolveCheckoutIntent(input)
  if (resolved.status === 'error') return resolved
  const { intent, account } = resolved

  if (input.provider === 'viva' && !account.vivaMerchantId) {
    return fail('provider_not_ready', 'Venue has not connected Viva')
  }
  if (input.provider === 'viva' && account.vivaVerificationStatus !== 'verified') {
    return fail('provider_not_ready', 'Venue has not finished Viva verification')
  }
  if (input.provider === 'stripe' && !(account.stripeConnectChargesEnabled && account.stripeConnectAccountId)) {
    return fail('provider_not_ready', 'Venue has not finished connecting Stripe')
  }

  let created: { checkoutUrl: string; paymentRef: string }
  try {
    created = await getOnlineAdapter(input.provider).createCheckout(
      intent,
      { redirectUrl: input.redirectUrl, webhookUrl: input.webhookUrl },
      account,
    )
  } catch (err) {
    if (err instanceof ProviderNotReadyError) {
      return fail('provider_not_ready', err.message)
    }
    if (err instanceof ProviderNotWiredError) {
      return fail('provider_unavailable', err.message)
    }
    console.error('[checkout] provider create failed:', err)
    await recordFailed(input, intent)
    return fail('provider_error', 'Failed to create payment')
  }

  if (!created.checkoutUrl || !created.paymentRef) {
    console.error('[checkout] provider returned no checkout url/ref')
    return fail('no_checkout', 'Failed to get checkout URL')
  }

  await recordStarted(input, intent, created.paymentRef)
  return { status: 'ok', checkoutUrl: created.checkoutUrl, paymentRef: created.paymentRef }
}

/**
 * Atomically claim a dine-in tab for payment (TAB_OPEN → TAB_PENDING_PAYMENT). Blocks
 * concurrent second payers and freezes ordering so the total cannot drift. Ported from the
 * user app's tab-payment Mollie route, which keeps its inline copy.
 */
export async function claimTabForPayment(
  tabId: string,
): Promise<'claimed' | 'in_progress' | 'closed' | 'not_found' | 'invalid'> {
  const claim = await prisma.tableTab.updateMany({
    where: { id: tabId, status: TAB_OPEN },
    data: { status: TAB_PENDING_PAYMENT },
  })
  if (claim.count > 0) return 'claimed'

  const tab = await prisma.tableTab.findUnique({
    where: { id: tabId },
    select: { id: true, status: true },
  })
  if (!tab) return 'not_found'
  if (tab.status === TAB_PENDING_PAYMENT) return 'in_progress'
  if ((TAB_TERMINAL_STATUSES as readonly string[]).includes(tab.status)) return 'closed'
  return 'invalid'
}

/** Revert a claim after a failure so the tab never wedges in pending_payment. */
export async function releaseTabClaim(tabId: string): Promise<void> {
  await prisma.tableTab.updateMany({
    where: { id: tabId, status: TAB_PENDING_PAYMENT },
    data: { status: TAB_OPEN, paymentRef: null },
  })
}
