'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { revalidatePath } from 'next/cache'

async function requireSudo() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) throw new Error('Unauthorized — sudo required')
}

// ─── Update Payment Provider ───────────────────────────────────────────────

export async function updatePaymentProvider(
  siteId: string,
  paymentProvider: string,
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  if (!siteId?.trim()) {
    return { status: 'error', errors: ['Site ID is required'] }
  }

  if (!['stripe', 'mollie'].includes(paymentProvider)) {
    return { status: 'error', errors: ['Invalid payment provider'] }
  }

  // If switching to Mollie, verify the site owner has connected Mollie
  if (paymentProvider === 'mollie') {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: {
        user: {
          select: {
            partnerAccount: {
              select: { mollieAccessToken: true },
            },
          },
        },
      },
    })
    if (!site?.user?.partnerAccount?.mollieAccessToken) {
      return { status: 'error', errors: ['Partner has not connected Mollie'] }
    }
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { paymentProvider },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}
