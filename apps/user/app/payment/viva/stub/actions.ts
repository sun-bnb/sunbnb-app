'use server'

import { redirect } from 'next/navigation'
import { checkoutStubState } from '@repo/data/viva'

// Stub store is in-process module state (see page.tsx): only valid when VIVA_MODE=stub.
export async function resolveStubCheckout(ref: string, outcome: 'pay' | 'fail'): Promise<void> {
  if (process.env.VIVA_MODE !== 'stub') throw new Error('Viva stub is disabled')
  if (!/^\d{10,20}$/.test(ref)) throw new Error('Invalid order code')
  if (outcome === 'pay') checkoutStubState.pay(ref)
  else checkoutStubState.fail(ref)
  redirect(`/api/payment/viva/return?t=stubtx_${ref}&s=${ref}`)
}
