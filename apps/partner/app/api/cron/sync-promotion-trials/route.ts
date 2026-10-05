/**
 * GET /api/cron/sync-promotion-trials — daily (vercel.json). Launch offer (track 027 D9): once a
 * partner's first live paid booking starts the 30-day clock, their Pro/Business plan must cost
 * nothing until the promotion ends. Stripe lets us set `trial_end` on an existing subscription
 * (even an active one) with no proration, so this aligns every running promotion's subscription
 * with `endsAt`. Idempotent: it compares with Stripe's own trial_end and only ever EXTENDS.
 * Fails closed without CRON_SECRET, like every cron in this repo.
 */
import { listPromotionsForPlanSync } from '@repo/data/promotion-db'
import { getStripeClient } from '@/app/api/_lib/stripe'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const stripe = getStripeClient()
  const rows = await listPromotionsForPlanSync()
  let extended = 0
  const failures: string[] = []
  for (const row of rows) {
    try {
      const sub = await stripe.subscriptions.retrieve(row.stripeSubscriptionId)
      if (sub.status !== 'active' && sub.status !== 'trialing') continue
      const wanted = Math.floor(row.endsAt.getTime() / 1000)
      if ((sub.trial_end ?? 0) >= wanted) continue
      await stripe.subscriptions.update(row.stripeSubscriptionId, { trial_end: wanted, proration_behavior: 'none' })
      extended++
    } catch (err) {
      // One partner's Stripe error must not stop the others; it is retried tomorrow.
      failures.push(row.partnerAccountId)
      console.error('[promotion-trials] sync failed', row.partnerAccountId, err)
    }
  }
  return Response.json({ checked: rows.length, extended, failures: failures.length })
}
