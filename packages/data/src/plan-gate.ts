/**
 * Plan gating and hamaca limits (CR-002) — SERVER-ONLY.
 *
 * Gratis: guests pay on site only, so no online card payment and no food-and-drink
 * ordering. "Pay on site" (an unpaid site, cash or card at the venue) is the normal
 * Gratis mode and is never blocked here. Temporada / Grupo: allowed. A per-partner
 * `CustomSubscription.featureOverrides` wins over the plan default.
 *
 * The UI hides gated options, but the guest UI is not a security boundary: every
 * charge-creating path (Mollie routes, `createOnlineCheckout` for Stripe / Viva) calls
 * `checkChargeAllowed` itself, resolving the partner from the payable's site or, for
 * tabs and table deposits, from `Restaurant.partnerAccountId` (a User.id).
 *
 * Hamacas: one `InventoryItem` row = one lounger (a balinese bed is one row). Parasols
 * are `SunbedGroup` units and never count. A venue already over its limit keeps every
 * sunbed (grandfathered, founder decision M-65); it only cannot add more.
 */
import prisma from '../index'
import { resolveEffectiveSubscription, type SubscriptionFeatureKey } from './subscription'

/** What a charge of each kind needs from the plan. */
export const CHARGE_GATES = {
  reservation: ['ONLINE_PAYMENTS'],
  rental: ['ONLINE_PAYMENTS'],
  order: ['ONLINE_PAYMENTS', 'FOOD_AND_BEVERAGE'],
  tab: ['ONLINE_PAYMENTS', 'FOOD_AND_BEVERAGE'],
  'table-deposit': ['ONLINE_PAYMENTS', 'FOOD_AND_BEVERAGE'],
} as const satisfies Record<string, readonly SubscriptionFeatureKey[]>

export type ChargeKind = keyof typeof CHARGE_GATES

export type GateResult = { allowed: true } | { allowed: false; feature: SubscriptionFeatureKey; message: string }

/** Guest-facing refusal copy (API error strings; the guest UI already hides the option). */
export const PLAN_GATE_MESSAGES: Record<SubscriptionFeatureKey, string> = {
  ONLINE_PAYMENTS: 'This venue takes payment on site only',
  FOOD_AND_BEVERAGE: 'Food and drink ordering is not available at this venue',
  OFF_PLATFORM_BILLING: 'Pay-on-site mode is not available for this venue',
}

/** Pure: does a feature map satisfy every listed gate? */
export function gateFor(
  features: Record<SubscriptionFeatureKey, boolean>,
  needs: readonly SubscriptionFeatureKey[],
): GateResult {
  for (const feature of needs) {
    if (!features[feature]) return { allowed: false, feature, message: PLAN_GATE_MESSAGES[feature] }
  }
  return { allowed: true }
}

/** Effective subscription of the partner whose User.id owns a site / restaurant. */
export async function effectiveSubscriptionForPartnerUser(userId: string) {
  const account = await prisma.partnerAccount.findUnique({
    where: { userId },
    select: { customSubscription: true, subscription: { include: { plan: true } } },
  })
  return resolveEffectiveSubscription(
    account?.subscription?.plan ?? null,
    (account?.customSubscription as never) ?? null,
  )
}

async function partnerUserIdFor(scope: { siteId?: string | null; restaurantId?: string | null }): Promise<string | null> {
  if (scope.siteId) {
    const site = await prisma.site.findUnique({ where: { id: scope.siteId }, select: { userId: true } })
    if (site) return site.userId
  }
  if (scope.restaurantId) {
    const r = await prisma.restaurant.findUnique({ where: { id: scope.restaurantId }, select: { partnerAccountId: true } })
    if (r) return r.partnerAccountId
  }
  return null
}

/**
 * Server-side plan gate for a charge. `scope` is the payable's site, or its restaurant
 * for tabs / table deposits. An unknown owner fails closed.
 */
export async function checkChargeAllowed(
  kind: ChargeKind,
  scope: { siteId?: string | null; restaurantId?: string | null },
): Promise<GateResult> {
  const userId = await partnerUserIdFor(scope)
  if (!userId) return { allowed: false, feature: 'ONLINE_PAYMENTS', message: PLAN_GATE_MESSAGES.ONLINE_PAYMENTS }
  const effective = await effectiveSubscriptionForPartnerUser(userId)
  return gateFor(effective.features, CHARGE_GATES[kind])
}

/** Server-side gate for placing a food-and-drink order (with or without online payment). */
export async function checkFoodOrderingAllowed(scope: {
  siteId?: string | null
  restaurantId?: string | null
}): Promise<GateResult> {
  const userId = await partnerUserIdFor(scope)
  if (!userId) return { allowed: false, feature: 'FOOD_AND_BEVERAGE', message: PLAN_GATE_MESSAGES.FOOD_AND_BEVERAGE }
  const effective = await effectiveSubscriptionForPartnerUser(userId)
  return gateFor(effective.features, ['FOOD_AND_BEVERAGE'])
}

// ─── Hamaca limit ──────────────────────────────────────────────────────────

/**
 * Pure: may `adding` hamacas join a site holding `current`, under `limit` (null = none)?
 * Removing or keeping (adding <= 0) is always allowed, so an over-limit venue keeps
 * everything it has.
 */
export function canAddHamacas(limit: number | null, current: number, adding: number): boolean {
  if (adding <= 0 || limit == null) return true
  return current + adding <= limit
}

export type HamacaLimitResult = {
  allowed: boolean
  current: number
  limit: number | null
  adding: number
  tier: string
}

/** Hamacas on a site: every InventoryItem row (parasols are SunbedGroup units, not rows). */
export async function countHamacas(siteId: string): Promise<number> {
  return prisma.inventoryItem.count({ where: { siteId } })
}

/**
 * Check adding `adding` hamacas to an existing site against its owner's plan
 * (Gratis 100, Temporada 300, Grupo from CustomSubscription.maxHamacasPerSite).
 */
export async function checkHamacaLimit(siteId: string, adding: number): Promise<HamacaLimitResult> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site) return { allowed: false, current: 0, limit: 0, adding, tier: 'GRATIS' }
  const [effective, current] = await Promise.all([
    effectiveSubscriptionForPartnerUser(site.userId),
    countHamacas(siteId),
  ])
  const limit = effective.maxHamacasPerSite ?? null
  return { allowed: canAddHamacas(limit, current, adding), current, limit, adding, tier: effective.tier }
}

/**
 * Check a NEW site of `count` hamacas (copy site, import into an empty site) for a
 * partner User.id.
 */
export async function checkNewSiteHamacas(userId: string, count: number): Promise<HamacaLimitResult> {
  const effective = await effectiveSubscriptionForPartnerUser(userId)
  const limit = effective.maxHamacasPerSite ?? null
  return { allowed: canAddHamacas(limit, 0, count), current: 0, limit, adding: count, tier: effective.tier }
}

/** Plain-language refusal for the partner UI (server action error string). */
export function hamacaLimitMessage(r: Pick<HamacaLimitResult, 'current' | 'limit'>): string {
  return `Your plan allows ${r.limit} hamacas per site and this site has ${r.current}. Existing sunbeds stay; upgrade your plan to add more.`
}

// ─── Online checkout (Stripe / Viva) ───────────────────────────────────────

export type CheckoutGateInput = {
  kind: ChargeKind
  reservationId?: string
  orderId?: string
  rentalBookingIds?: string[]
  tabId?: string
  tableReservationId?: string
}

/** The payable's site (or restaurant, for tabs and table deposits) — the plan-gate scope. */
async function checkoutGateScope(
  input: CheckoutGateInput,
): Promise<{ siteId?: string | null; restaurantId?: string | null } | null> {
  switch (input.kind) {
    case 'reservation': {
      if (!input.reservationId) return null
      const r = await prisma.reservation.findUnique({ where: { id: input.reservationId }, select: { siteId: true } })
      return r ? { siteId: r.siteId } : null
    }
    case 'order': {
      if (!input.orderId) return null
      const o = await prisma.order.findUnique({ where: { id: input.orderId }, select: { siteId: true } })
      return o ? { siteId: o.siteId } : null
    }
    case 'rental': {
      const id = input.rentalBookingIds?.[0]
      if (!id) return null
      const b = await prisma.rentalBooking.findUnique({ where: { id }, select: { siteId: true } })
      return b ? { siteId: b.siteId } : null
    }
    case 'tab': {
      if (!input.tabId) return null
      const t = await prisma.tableTab.findUnique({ where: { id: input.tabId }, select: { siteId: true, restaurantId: true } })
      return t ? { siteId: t.siteId, restaurantId: t.restaurantId } : null
    }
    case 'table-deposit': {
      if (!input.tableReservationId) return null
      const tr = await prisma.tableReservation.findUnique({
        where: { id: input.tableReservationId },
        select: { restaurantId: true },
      })
      return tr ? { restaurantId: tr.restaurantId } : null
    }
  }
}

/** Gate for `createOnlineCheckout`: resolves the payable's scope, then `checkChargeAllowed`. */
export async function checkCheckoutAllowed(input: CheckoutGateInput): Promise<GateResult | 'not_found'> {
  const scope = await checkoutGateScope(input)
  if (!scope) return 'not_found'
  return checkChargeAllowed(input.kind, scope)
}
