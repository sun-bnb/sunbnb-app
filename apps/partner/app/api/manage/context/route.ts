/**
 * GET /api/manage/context?siteId=...&key=... — thin token-verification route
 * (track 024 P6.5). This is what the mobile pairing screen calls to confirm a
 * scanned access key is valid before storing it, without pulling the whole
 * manage grid payload.
 */

import { NextRequest } from 'next/server'
import prisma from '@repo/data/PrismaCient'
import { validateManageToken } from '@/app/sites/[id]/manage/token'
import { availabilityFor } from '@repo/data/payment-providers/availability'
import { isSelectableProvider } from '@repo/data/payment-providers/readiness'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const siteId = searchParams.get('siteId')
  const key = searchParams.get('key') ?? undefined

  if (!siteId) {
    return Response.json(
      { status: 'error', errors: ['`siteId` query parameter is required'] },
      { status: 400 },
    )
  }

  const result = await validateManageToken(siteId, key)
  if (!result.ok) {
    return Response.json(
      { status: 'error', errors: [result.error.message] },
      { status: 401 },
    )
  }

  // Effective provider (Site.paymentProvider; legacy null → mollie) + how this
  // venue's staff can take a card in person — the floor app gates Tap to Pay on it.
  const siteRow = await prisma.site.findUnique({
    where: { id: siteId },
    select: { paymentProvider: true, userId: true },
  })
  const account = siteRow
    ? await prisma.partnerAccount.findUnique({
        where: { userId: siteRow.userId },
        select: { country: true },
      })
    : null
  const paymentProvider = isSelectableProvider(siteRow?.paymentProvider) ? siteRow.paymentProvider : 'mollie'
  const cardPresent = availabilityFor(paymentProvider, account?.country).cardPresent

  return Response.json(
    {
      status: 'ok',
      site: result.site,
      isAdmin: result.isAdmin,
      paymentProvider,
      cardPresent,
    },
    { status: 200 },
  )
}
