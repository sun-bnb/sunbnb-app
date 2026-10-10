import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getStripeClient } from '@/app/api/_lib/stripe'
import { TrackEvent } from '@/components/Analytics'
import { getSubscriptionData } from './actions'
import SubscriptionView from './view'

/**
 * GA4 `purchase` for the Checkout return (`?checkout=success&session_id=cs_...`). Everything is
 * re-read from Stripe server-side — the query string only names the session; we require it to
 * belong to this partner and be complete, and take value/currency from Stripe, never the client.
 * Note: a launch-offer plan starts as a trial, so amount_total (and thus value) is 0 then.
 */
async function purchaseEvent(sessionId: string | undefined, userId: string) {
  if (!sessionId || !/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) return null
  try {
    const cs = await getStripeClient().checkout.sessions.retrieve(sessionId)
    if (cs.status !== 'complete' || cs.metadata?.partnerAccountId !== userId) return null
    const plan = cs.metadata?.planId
      ? await prisma.subscriptionPlan.findUnique({ where: { id: cs.metadata.planId }, select: { id: true, name: true } })
      : null
    return {
      transaction_id: cs.id,
      value: (cs.amount_total ?? 0) / 100,
      currency: (cs.currency ?? 'eur').toUpperCase(),
      items: plan ? [{ item_id: plan.id, item_name: plan.name }] : undefined,
    }
  } catch {
    return null
  }
}

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const session = await auth()
  if (!session?.user) return null

  const { checkout, session_id } = await searchParams
  const purchase = checkout === 'success' ? await purchaseEvent(session_id, session.user.id) : null

  const data = await getSubscriptionData()
  if (!data) return null

  return (
    <>
      {purchase && <TrackEvent name="purchase" params={purchase} onceKey={`purchase:${purchase.transaction_id}`} />}
      <SubscriptionView data={data} />
    </>
  )
}
