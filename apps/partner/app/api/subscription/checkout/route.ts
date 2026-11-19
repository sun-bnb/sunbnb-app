/**
 * POST /api/subscription/checkout
 *
 * Retired by CR-002: no plan bills a monthly price, so no tier is purchasable
 * through Stripe Checkout. Temporada is commission-only (nothing recurring),
 * Grupo is a quote request, Gratis is free. The route stays so a stale client or
 * a leftover `stripePriceId` can never start a paid subscription: every
 * authenticated call gets a clear 400. Existing subscribers still manage billing
 * through /api/subscription/portal.
 *
 * Expects JSON body: { planId: string }
 */

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { PRICING_TIERS } from '@repo/data/pricing-tiers'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { planId } = await request.json()
  if (!planId) {
    return Response.json({ error: 'planId is required' }, { status: 400 })
  }

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } })
  if (!plan) {
    return Response.json({ error: 'Plan not available for purchase' }, { status: 400 })
  }

  // Derived from the catalogue (every tier is monthlyPrice 0), so a future paid
  // tier is a deliberate change to PRICING_TIERS plus this route.
  if (!(PRICING_TIERS[plan.tier].monthlyPrice > 0)) {
    return Response.json(
      { error: 'This plan has no monthly subscription: Gratis is free, Temporada is commission-only and Grupo is by quote.' },
      { status: 400 },
    )
  }

  return Response.json({ error: 'Plan not available for purchase' }, { status: 400 })
}
