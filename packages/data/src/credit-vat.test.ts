import { describe, it, expect } from 'vitest'
import { apportionCreditByVatRate } from './payment'

// The rounding is the part worth pinning: a credit that does not sum back to
// the refund shows up later as an unexplained balance nobody can trace.

const line = (vatRate: number | null, gross: number, rate = vatRate ?? 0) => {
  const base = Math.round((gross / (1 + rate / 100)) * 100) / 100
  return { vatRate, charge: base, tax: Math.round((gross - base) * 100) / 100, amount: gross }
}

describe('apportionCreditByVatRate', () => {
  it('carries the ORIGINAL rate rather than deriving a blended one', () => {
    // The defect: totalTax/totalCharge*100 yields 20.98 on real data, which is
    // not a legal TipoImpositivo and is rejected outright.
    const buckets = apportionCreditByVatRate([line(21, 121)], 121)
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.vatRate).toBe(21)
    expect(buckets[0]!.gross).toBe(121)
  })

  it('splits a partial credit proportionally across two rates', () => {
    // 100 at 21% and 100 at 10% → half each.
    const buckets = apportionCreditByVatRate([line(21, 100), line(10, 100)], 50)
    expect(buckets.map((b) => b.vatRate).sort()).toEqual([10, 21])
    expect(buckets.reduce((s, b) => s + b.gross, 0)).toBe(50)
    for (const b of buckets) expect(b.gross).toBe(25)
  })

  it('always sums back to the credit amount, to the cent', () => {
    // A 3-way split of 10.00 cannot divide evenly; the remainder must land
    // somewhere rather than vanish.
    const buckets = apportionCreditByVatRate(
      [line(21, 100), line(10, 100), line(4, 100)],
      10,
    )
    const total = buckets.reduce((s, b) => s + b.gross, 0)
    expect(Math.round(total * 100)).toBe(1000)
  })

  it('puts the rounding remainder on the LARGEST bucket', () => {
    // Least visible there, and deterministic — not wherever iteration lands.
    const buckets = apportionCreditByVatRate([line(21, 900), line(10, 100)], 10)
    const biggest = buckets.find((b) => b.vatRate === 21)!
    const smallest = buckets.find((b) => b.vatRate === 10)!
    expect(biggest.gross).toBeGreaterThan(smallest.gross)
    expect(Math.round((biggest.gross + smallest.gross) * 100)).toBe(1000)
  })

  it('reverse-computes base and VAT at each bucket\'s own rate', () => {
    const buckets = apportionCreditByVatRate([line(21, 121)], 121)
    expect(buckets[0]!.base).toBe(100)
    expect(buckets[0]!.vat).toBe(21)
  })

  it('emits only legal rates when the original carried legal rates', () => {
    // Which is the whole point: whatever comes out is something AEAT accepts.
    const buckets = apportionCreditByVatRate([line(21, 100), line(10, 50)], 75)
    for (const b of buckets) expect([0, 4, 10, 21]).toContain(b.vatRate)
  })

  it('drops a bucket that rounds to nothing', () => {
    // A 0.01 credit against a 99/1 split must not emit a zero-value line.
    const buckets = apportionCreditByVatRate([line(21, 9900), line(10, 100)], 0.01)
    expect(buckets.every((b) => b.gross !== 0)).toBe(true)
  })

  it('handles an original with no usable total', () => {
    const buckets = apportionCreditByVatRate([], 50)
    expect(buckets).toHaveLength(1)
    expect(Math.round(buckets[0]!.gross * 100)).toBe(5000)
  })
})
