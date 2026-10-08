import { syncEffectiveProvider } from '@repo/data/payment-providers/selection'

/**
 * Best-effort `syncEffectiveProvider`: connection state just changed, so the sites'
 * EFFECTIVE provider may need to follow. Never throws — a sync failure must not fail
 * the request that already persisted the connection change (the next status poll
 * or the payments hub re-syncs).
 */
export async function syncEffectiveProviderSafe(userId: string | null | undefined): Promise<void> {
  if (!userId) return
  try {
    await syncEffectiveProvider(userId)
  } catch (err) {
    console.error('[PaymentProvider] effective-provider sync failed:', err)
  }
}
