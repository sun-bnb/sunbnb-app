/**
 * POST /api/subscription/portal
 *
 * Creates a Stripe Customer Portal session for managing billing,
 * plan changes, and cancellation.
 */

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getStripeClient } from '@/app/api/_lib/stripe'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const subscription = await prisma.subscription.findUnique({
    where: { partnerAccountId: session.user.id! },
  })

  if (!subscription?.stripeCustomerId) {
    return Response.json({ error: 'No billing account found' }, { status: 400 })
  }

  const stripe = getStripeClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${appUrl}/account/subscription`,
  })

  return Response.json({ url: portalSession.url })
}
