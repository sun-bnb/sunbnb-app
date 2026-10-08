import { useEffect, useState } from 'react'
import { getManageContext, isManageContext, type CardPresent, type PaymentProvider } from './api'
import type { Pairing } from './pairing'

/**
 * The venue's payment rails, from GET /api/manage/context — fetched once per
 * pairing and shared (tabs layout gates the Tap to Pay provider, the beds tab
 * gates the Viva terminal list). Until it arrives, or if it fails, the app
 * behaves as 'none' (QR only) — never guess a card rail.
 */
export interface SitePayments {
  paymentProvider: PaymentProvider | null
  cardPresent: CardPresent
}

const NONE: SitePayments = { paymentProvider: null, cardPresent: 'none' }
let cache: { key: string; promise: Promise<SitePayments> } | null = null

function fetchSitePayments(siteId: string, accessKey: string): Promise<SitePayments> {
  const key = `${siteId}:${accessKey}`
  if (cache?.key === key) return cache.promise
  const promise = getManageContext(siteId, accessKey)
    .then(res => {
      if (!isManageContext(res)) throw new Error('context unavailable')
      return { paymentProvider: res.paymentProvider ?? null, cardPresent: res.cardPresent ?? 'none' }
    })
    .catch(() => {
      cache = null // retry on the next mount
      return NONE
    })
  cache = { key, promise }
  return promise
}

export function useSitePayments(pairing: Pick<Pairing, 'siteId' | 'accessKey'> | null): SitePayments {
  const [value, setValue] = useState<SitePayments>(NONE)
  const siteId = pairing?.siteId ?? null
  const accessKey = pairing?.accessKey ?? null

  useEffect(() => {
    if (!siteId || !accessKey) return
    let alive = true
    void fetchSitePayments(siteId, accessKey).then(v => {
      if (alive) setValue(v)
    })
    return () => {
      alive = false
    }
  }, [siteId, accessKey])

  return value
}

/**
 * The card rail the floor app can actually drive. Stripe Tap to Pay needs a
 * Stripe site — Mollie also reports 'tap-to-pay' for some countries, but that
 * is Mollie's own iPhone app, not this SDK, and the server rejects it.
 */
export function floorCardPresent(p: SitePayments): CardPresent {
  if (p.cardPresent === 'tap-to-pay') return p.paymentProvider === 'stripe' ? 'tap-to-pay' : 'none'
  return p.cardPresent
}
