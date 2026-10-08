/**
 * Keeps `Site.paymentProvider` (the EFFECTIVE provider) in sync with the partner's
 * SELECTED provider + readiness (track 028, packet P2a). Server-only (prisma).
 * Idempotent: a second call with unchanged state updates nothing.
 */
import prisma from '../../index'
import type { SelectableProvider } from '../payment-refs'
import { READINESS_SELECT, effectiveProviderFor, selectedProvider, toReadinessAccount } from './readiness'

export async function syncEffectiveProvider(
  partnerAccountId: string
): Promise<{ selected: SelectableProvider; effective: SelectableProvider; changed: number }> {
  const row = await prisma.partnerAccount.findUnique({
    where: { userId: partnerAccountId },
    select: READINESS_SELECT,
  })
  if (!row) return { selected: 'mollie', effective: 'mollie', changed: 0 }

  const account = toReadinessAccount(row)
  const firstSite = await prisma.site.findFirst({
    where: { userId: partnerAccountId },
    orderBy: { createdAt: 'asc' },
    select: { paymentProvider: true },
  })

  const selected = selectedProvider(account)
  const effective = effectiveProviderFor(account, firstSite?.paymentProvider ?? null)
  const { count } = await prisma.site.updateMany({
    where: { userId: partnerAccountId, NOT: { paymentProvider: effective } },
    data: { paymentProvider: effective },
  })
  return { selected, effective, changed: count }
}
