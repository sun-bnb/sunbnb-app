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
