'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import type { SelectableProvider } from '@repo/data/payment-refs'
import { availabilityFor } from '@repo/data/payment-providers/availability'
import { isSelectableProvider } from '@repo/data/payment-providers/readiness'
import { syncEffectiveProvider } from '@repo/data/payment-providers/selection'

/**
 * Select which payment provider guests use for this partner's venues. Stores the
 * SELECTED provider; the EFFECTIVE one (Site.paymentProvider) only flips once the
 * selection is ready — `syncEffectiveProvider` decides.
 */
export async function selectPaymentProvider(
  provider: string
): Promise<
  | { status: 'ok'; selected: SelectableProvider; effective: SelectableProvider }
  | { status: 'error'; errors: string[] }
> {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  if (!isSelectableProvider(provider)) return { status: 'error', errors: ['Invalid payment provider'] }

  const userId = session.user.id
  const account = await prisma.partnerAccount.findUnique({
    where: { userId },
    select: { country: true },
  })
  if (!account) return { status: 'error', errors: ['No partner account found'] }

  if (!availabilityFor(provider, account.country).online) {
    return { status: 'error', errors: ['Not available in your country'] }
  }

  await prisma.partnerAccount.update({
    where: { userId },
    data: { paymentProvider: provider },
  })
  const { selected, effective } = await syncEffectiveProvider(userId)

  revalidatePath('/account/payments')
  revalidatePath('/sites')
  return { status: 'ok', selected, effective }
}
