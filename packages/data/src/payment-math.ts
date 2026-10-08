// Pure financial math — NO prisma, NO side effects. Client-safe and safe to
// import from shared packages with strict (node16) module resolution, which
// cannot pull in the full ./payment module (it has extensionless dynamic
// imports and a prisma dependency). ./payment re-exports these so existing
// `@repo/data/payment` imports keep working; this file is the single source.

/** Round to 2 decimal places (cents precision). */
export function round(amount: number): number {
  return Math.round(amount * 100) / 100
}

/**
 * Convert a EUR float amount to integer cents for the Viva API boundary.
 *
 * Rounds through `round()` FIRST (2-decimal financial rounding, the same
 * function every other money computation in `@repo/data` goes through — see
 * `.claude/rules/payments.md`) and only then multiplies by 100 and rounds
 * again. In practice `Math.round(x * 100)` alone lands on the same cent value
 * for realistic amounts (double-rounding to the same precision rarely crosses
 * a boundary twice) — this is not a float-precision fix. The reason to route
 * through `round()` regardless: it is the ONE authoritative rounding decision
 * for money everywhere else in this codebase, and an unrounded value (e.g. a
 * raw division result with 10+ trailing digits from an upstream computation
 * that skipped `round()`) must land on the exact same cents a caller would get
 * from `round()`-ing it and reading the result — `toCents` must never become a
 * second, independent place a money value gets its final digit decided.
 */
export function toCents(eurAmount: number): number {
  return Math.round(round(eurAmount) * 100)
}

/**
 * Extract base amount and VAT from a VAT-inclusive price.
 * Example: vatInclusiveAmount=12.55, vatRate=25.5 → base=10.00, vat=2.55
 */
export function computeVatAndBaseAmounts(
  vatInclusiveAmount: number,
  vatRate: number
): { baseAmount: number; vatAmount: number } {
  const baseAmount = round(vatInclusiveAmount / (1 + vatRate / 100))
  const vatAmount = round(vatInclusiveAmount - baseAmount)
  return { baseAmount, vatAmount }
}
