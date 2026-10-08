// Pure sunbed reservation pricing — NO prisma, NO side effects.
//
// One formula for every surface that states a reservation's price: the
// booking server action (what an online payment charges), the confirmation
// page and the confirmation email (what a guest of an off-platform-billing
// site — Site.type 'unpaid' — owes at the venue). They used to be one inline
// computation in the action only, so an unpaid booking had no price anywhere.

import { round } from './payment-math'

const DAY_MS = 1000 * 60 * 60 * 24

/**
 * Whole days a reservation covers. A one-day booking runs from the start to the
 * end of the day (~24 h minus 1 ms) and rounds to 1.
 */
export function reservationDays(from: Date | string, to: Date | string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS)
}

/**
 * The listed price of a sunbed reservation: each seat's own price, falling
 * back to the site price, times the number of days. Seat prices come from the
 * database — never pass client-supplied values.
 */
export function reservationListPrice(input: {
  sitePrice: number | null | undefined
  itemPrices: Array<number | null | undefined>
  from: Date | string
  to: Date | string
}): number {
  const perDay = input.itemPrices.reduce<number>((sum, p) => sum + (p || input.sitePrice || 0), 0)
  return round(perDay * reservationDays(input.from, input.to))
}
