/**
 * Example prices for the demo's feature modules (track 027). Illustrative only — every card that
 * shows them is labelled "Example", and the day close sums exactly what the visitor played.
 * Kept in code, not in the translated copy (copy-claims.test.ts keeps messages free of figures).
 * The sunbed price is never here: it is the one the visitor sets themselves.
 */
export const DEMO_PRICES = {
  /** Two lemonades and a sparkling water, ordered to the sunbed. */
  drinks: { lemonade: 4, water: 2.5, lemonades: 2 },
  /** One paddleboard for an hour. */
  paddleboardHour: 15,
} as const

export const drinksTotal = () => DEMO_PRICES.drinks.lemonade * DEMO_PRICES.drinks.lemonades + DEMO_PRICES.drinks.water

/** Money in the visitor's notation; whole euros without decimals ("€79", "€10.50"). */
export function formatEur(locale: string, n: number): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n)
}
