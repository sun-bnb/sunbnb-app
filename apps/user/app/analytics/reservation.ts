/**
 * Maps a reservation as the UI holds it to funnel input. The amount is the server-set
 * `paymentAmount` the payment screen already displays - never recomputed here.
 */
import type { Reservation } from '@/app/sites/types'
import type { FunnelInput } from './funnel'

export function reservationFunnelInput(reservation: Pick<Reservation, 'site' | 'paymentAmount' | 'items'>): FunnelInput | null {
  if (!reservation.site?.id) return null
  return {
    kind: 'sunbed',
    siteId: reservation.site.id,
    siteName: reservation.site.name,
    value: reservation.paymentAmount ?? 0,
    quantity: reservation.items?.length || undefined,
  }
}
