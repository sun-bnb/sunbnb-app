import { describe, it, expect } from 'vitest'
import {
  round,
  computeVatAndBaseAmounts,
  resolveServiceFee,
  calculateServiceFeeAmount,
} from './payment'

// ─── round() ────────────────────────────────────────────────────────────────

describe('round', () => {
  it('rounds to 2 decimal places', () => {
    expect(round(2.555)).toBe(2.56)
    expect(round(1.234)).toBe(1.23)
    expect(round(1.235)).toBe(1.24)
  })

  it('handles zero', () => {
    expect(round(0)).toBe(0)
  })

  it('handles negative numbers', () => {
    expect(round(-1.555)).toBe(-1.55)
    expect(round(-2.999)).toBe(-3)
  })

  it('handles tiny amounts', () => {
    expect(round(0.001)).toBe(0)
    expect(round(0.004)).toBe(0)
    expect(round(0.005)).toBe(0.01)
  })

  it('handles large numbers', () => {
    expect(round(999999.999)).toBe(1000000)
    expect(round(123456.781)).toBe(123456.78)
  })

  it('returns exact value when already 2 decimals', () => {
    expect(round(10.50)).toBe(10.50)
    expect(round(99.99)).toBe(99.99)
  })
})

// ─── computeVatAndBaseAmounts() ─────────────────────────────────────────────

describe('computeVatAndBaseAmounts', () => {
  it('computes reverse VAT at 24%', () => {
    const { baseAmount, vatAmount } = computeVatAndBaseAmounts(12.40, 24)
    expect(baseAmount).toBe(10.0)
    expect(vatAmount).toBe(2.40)
  })

  it('computes reverse VAT at 14%', () => {
    const { baseAmount, vatAmount } = computeVatAndBaseAmounts(11.40, 14)
    expect(baseAmount).toBe(10.0)
    expect(vatAmount).toBe(1.40)
  })

  it('computes reverse VAT at 10%', () => {
    const { baseAmount, vatAmount } = computeVatAndBaseAmounts(11.00, 10)
    expect(baseAmount).toBe(10.0)
    expect(vatAmount).toBe(1.00)
  })

  it('handles zero VAT rate (base equals gross)', () => {
    const { baseAmount, vatAmount } = computeVatAndBaseAmounts(50.00, 0)
    expect(baseAmount).toBe(50.00)
    expect(vatAmount).toBe(0)
  })

  it('handles fractional VAT rate (25.5%)', () => {
    const { baseAmount, vatAmount } = computeVatAndBaseAmounts(12.55, 25.5)
    expect(baseAmount).toBe(10.0)
    expect(vatAmount).toBe(2.55)
  })

  it('ensures base + vat equals the original gross', () => {
    const gross = 99.99
    const { baseAmount, vatAmount } = computeVatAndBaseAmounts(gross, 24)
    expect(baseAmount + vatAmount).toBeCloseTo(gross, 2)
  })

  it('handles high VAT rate', () => {
    const { baseAmount, vatAmount } = computeVatAndBaseAmounts(100, 100)
    expect(baseAmount).toBe(50)
    expect(vatAmount).toBe(50)
  })
})

// ─── resolveServiceFee() ────────────────────────────────────────────────────

describe('resolveServiceFee', () => {
  const makeFee = (overrides: Partial<{
    id: string
    serviceCode: string
    chargeType: string
    feeAmount: number | null
    percentage: number | null
    subscriptionTier: string | null
    siteId: string | null
    accountId: string | null
    settingsId: string | null
  }> = {}) => ({
    id: 'fee-1',
    serviceCode: 'sunbed-rental',
    chargeType: 'fixed',
    feeAmount: 1.0,
    percentage: null,
    subscriptionTier: null,
    siteId: null,
    accountId: null,
    settingsId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  })

  it('site fee wins over account and platform fees', () => {
    const siteFee = makeFee({ id: 'site', siteId: 'site-1', feeAmount: 2.0 })
    const accountFee = makeFee({ id: 'account', accountId: 'acc-1', feeAmount: 1.5 })
    const platformFee = makeFee({ id: 'platform', settingsId: 'set-1', feeAmount: 1.0 })

    const result = resolveServiceFee([siteFee], [accountFee], [platformFee], 'sunbed-rental')
    expect(result?.id).toBe('site')
  })

  it('account fee wins over platform fee when no site fee', () => {
    const accountFee = makeFee({ id: 'account', accountId: 'acc-1', feeAmount: 1.5 })
    const platformFee = makeFee({ id: 'platform', settingsId: 'set-1', feeAmount: 1.0 })

    const result = resolveServiceFee([], [accountFee], [platformFee], 'sunbed-rental')
    expect(result?.id).toBe('account')
  })

  it('tier-specific platform fee preferred over null-tier', () => {
    const tierFee = makeFee({ id: 'tier', settingsId: 'set-1', subscriptionTier: 'STARTER' })
    const defaultFee = makeFee({ id: 'default', settingsId: 'set-1', subscriptionTier: null })

    const result = resolveServiceFee([], [], [tierFee, defaultFee], 'sunbed-rental', 'STARTER' as any)
    expect(result?.id).toBe('tier')
  })

  it('falls back to null-tier platform fee when tier does not match', () => {
    const tierFee = makeFee({ id: 'tier', settingsId: 'set-1', subscriptionTier: 'PRO' })
    const defaultFee = makeFee({ id: 'default', settingsId: 'set-1', subscriptionTier: null })

    const result = resolveServiceFee([], [], [tierFee, defaultFee], 'sunbed-rental', 'STARTER' as any)
    expect(result?.id).toBe('default')
  })

  it('returns undefined when no fees match the service code', () => {
    const fee = makeFee({ serviceCode: 'food-and-beverage' })
    const result = resolveServiceFee([fee], [], [], 'sunbed-rental')
    expect(result).toBeUndefined()
  })

  it('returns undefined with empty arrays', () => {
    const result = resolveServiceFee([], [], [], 'sunbed-rental')
    expect(result).toBeUndefined()
  })

  it('falls back to null-tier when no tier is provided', () => {
    const defaultFee = makeFee({ id: 'default', settingsId: 'set-1', subscriptionTier: null })
    const result = resolveServiceFee([], [], [defaultFee], 'sunbed-rental')
    expect(result?.id).toBe('default')
  })
})

// ─── calculateServiceFeeAmount() ────────────────────────────────────────────

describe('calculateServiceFeeAmount', () => {
  const makeFee = (overrides: Partial<{
    chargeType: string
    feeAmount: number | null
    percentage: number | null
  }> = {}) => ({
    id: 'fee-1',
    serviceCode: 'sunbed-rental',
    chargeType: 'fixed',
    feeAmount: 1.0,
    percentage: null,
    subscriptionTier: null,
    siteId: null,
    accountId: null,
    settingsId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  })

  it('returns fixed fee amount', () => {
    const fee = makeFee({ chargeType: 'fixed', feeAmount: 2.50 })
    expect(calculateServiceFeeAmount(fee, 100)).toBe(2.50)
  })

  it('calculates percentage fee', () => {
    const fee = makeFee({ chargeType: 'percentage', percentage: 10 })
    expect(calculateServiceFeeAmount(fee, 100)).toBe(10)
  })

  it('rounds percentage fee result', () => {
    const fee = makeFee({ chargeType: 'percentage', percentage: 15 })
    expect(calculateServiceFeeAmount(fee, 33.33)).toBe(5.0)
  })

  it('returns 0 when fee is undefined', () => {
    expect(calculateServiceFeeAmount(undefined, 100)).toBe(0)
  })

  it('returns 0 for fixed fee with zero reference amount', () => {
    const fee = makeFee({ chargeType: 'fixed', feeAmount: 1.0 })
    expect(calculateServiceFeeAmount(fee, 0)).toBe(1.0)
  })

  it('returns 0 for percentage fee with zero reference amount', () => {
    const fee = makeFee({ chargeType: 'percentage', percentage: 10 })
    expect(calculateServiceFeeAmount(fee, 0)).toBe(0)
  })

  it('handles null feeAmount for fixed fee', () => {
    const fee = makeFee({ chargeType: 'fixed', feeAmount: null })
    expect(calculateServiceFeeAmount(fee, 100)).toBe(0)
  })

  it('handles null percentage for percentage fee', () => {
    const fee = makeFee({ chargeType: 'percentage', percentage: null })
    expect(calculateServiceFeeAmount(fee, 100)).toBe(0)
  })
})
