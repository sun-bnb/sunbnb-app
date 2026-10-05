/**
 * Partner promotions — DB access (track 027 D9). Pure rules live in `./promotion`.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../index'
import { isTestMode } from './env'
import {
  activeLaunchPromotion,
  isEligibleForLaunchPromotion,
  LAUNCH_PROMOTION,
  promotionEndsAt,
  startsPromotionClock,
  type PromotionState,
} from './promotion'

/**
 * Does a paid booking in THIS environment count as live? Only production takes live Mollie
 * payments; elsewhere refs are test-mode (founder decision: test payments never start the clock).
 * `PROMOTION_CLOCK_IN_TEST=1` lets QA and the integration tests exercise the clock off production.
 */
export function promotionClockRuns(): boolean {
  return !isTestMode() || process.env.PROMOTION_CLOCK_IN_TEST === '1'
}

/** Grant the launch offer to a newly created partner account if it qualifies. Idempotent. */
export async function grantLaunchPromotionIfEligible(partnerAccountId: string): Promise<boolean> {
  const account = await prisma.partnerAccount.findUnique({
    where: { userId: partnerAccountId },
    select: { createdAt: true, isTestAccount: true },
  })
  if (!account || !isEligibleForLaunchPromotion(account)) return false
  await prisma.partnerPromotion.upsert({
    where: { partnerAccountId_code: { partnerAccountId, code: LAUNCH_PROMOTION.code } },
    create: { partnerAccountId, code: LAUNCH_PROMOTION.code, grantedBy: 'signup' },
    update: {},
  })
  return true
}

export async function getLaunchPromotion(partnerAccountId: string): Promise<PromotionState | null> {
  return activeLaunchPromotion(
    await prisma.partnerPromotion.findMany({
      where: { partnerAccountId },
      select: { code: true, startedAt: true, endsAt: true, revokedAt: true },
    }),
  )
}

/**
 * Start the 30-day clock on the partner's first live paid booking. Call INSIDE the confirmation
 * transaction, after the PARTNER invoice, while `lockInvoiceSeries(tx, partnerAccountId)` is held —
 * that lock serialises a partner's invoicing, so two first bookings can't both start it; the
 * `startedAt: null` condition makes it write-once regardless.
 */
export async function stampPromotionClock(
  tx: Prisma.TransactionClient,
  partnerAccountId: string,
  paymentRef: string | null | undefined,
  at: Date = new Date(),
): Promise<boolean> {
  if (!startsPromotionClock(paymentRef, promotionClockRuns())) return false
  const { count } = await tx.partnerPromotion.updateMany({
    where: { partnerAccountId, code: LAUNCH_PROMOTION.code, startedAt: null, revokedAt: null },
    data: { startedAt: at, endsAt: promotionEndsAt(at) },
  })
  return count > 0
}

/** Admin: grant the launch offer by hand (e.g. goodwill for an existing partner). Re-activates a revoked one. */
export async function grantLaunchPromotion(partnerAccountId: string, adminId: string): Promise<void> {
  await prisma.partnerPromotion.upsert({
    where: { partnerAccountId_code: { partnerAccountId, code: LAUNCH_PROMOTION.code } },
    create: { partnerAccountId, code: LAUNCH_PROMOTION.code, grantedBy: adminId },
    update: { revokedAt: null, grantedBy: adminId },
  })
}

/** Admin: revoke the launch offer. Bookings created from now on are charged normally. */
export async function revokeLaunchPromotion(partnerAccountId: string): Promise<void> {
  await prisma.partnerPromotion.updateMany({
    where: { partnerAccountId, code: LAUNCH_PROMOTION.code, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/**
 * Partners whose plan subscription must be (re)aligned with a RUNNING promotion window — the
 * partner app's daily cron extends their Stripe trial to `endsAt`. Only windows with ≥ 48 h left
 * (Stripe's minimum trial horizon).
 */
export async function listPromotionsForPlanSync(now: Date = new Date()) {
  const rows = await prisma.partnerPromotion.findMany({
    where: {
      code: LAUNCH_PROMOTION.code,
      revokedAt: null,
      endsAt: { gt: new Date(now.getTime() + 48 * 60 * 60 * 1000) },
      partnerAccount: { subscription: { stripeSubscriptionId: { not: null } } },
    },
    select: { partnerAccountId: true, endsAt: true, partnerAccount: { select: { subscription: { select: { stripeSubscriptionId: true } } } } },
  })
  return rows.map((r) => ({
    partnerAccountId: r.partnerAccountId,
    endsAt: r.endsAt!,
    stripeSubscriptionId: r.partnerAccount.subscription!.stripeSubscriptionId!,
  }))
}
