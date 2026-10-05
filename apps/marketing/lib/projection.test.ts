import { describe, expect, it } from 'vitest'
import { PRICING_TIERS } from '@repo/data/pricing-tiers'
import { parseProjectionInput, project } from './projection.ts'

describe('project — only the catalogue and their own numbers', () => {
  it('commission per online sunbed-day comes straight from the plan catalogue', () => {
    const p = project({ price: 20, sunbeds: 60 })
    const starter = p.tiers.find((t) => t.tier === 'STARTER')!
    expect(starter.commissionPerBed).toBe((20 * PRICING_TIERS.STARTER.commissionPercent) / 100)
    expect(starter.keepPerBed + starter.commissionPerBed).toBe(20)
  })

  it('break-even vs Starter: the paid plan fee ÷ the commission it saves per sunbed-day', () => {
    // Pro at €20: €29 ÷ (6% − 3%) × €20 = 29 ÷ 0.6 = 48.3 → 49 sunbed-days
    const pro = project({ price: 20, sunbeds: 60 }).tiers.find((t) => t.tier === 'PRO')!
    const expected = Math.ceil(PRICING_TIERS.PRO.monthlyPrice / ((20 * (PRICING_TIERS.STARTER.commissionPercent - PRICING_TIERS.PRO.commissionPercent)) / 100))
    expect(pro.breakEvenBedDays).toBe(expected)
    expect(project({ price: 20, sunbeds: 60 }).tiers.find((t) => t.tier === 'STARTER')!.breakEvenBedDays).toBeNull()
  })

  it('without their own online estimate there are NO monthly figures', () => {
    const p = project({ price: 25, sunbeds: 80 })
    expect(p.monthlyOnline).toBeNull()
    expect(p.cheapest).toBeNull()
    expect(p.tiers.every((t) => t.monthlyCost === null)).toBe(true)
    expect(p.trace).toEqual([])
  })

  it('with it: monthly cost per plan, and the cheapest one', () => {
    const few = project({ price: 20, sunbeds: 60, onlinePerDay: 1 })
    expect(few.cheapest).toBe('STARTER')
    const many = project({ price: 20, sunbeds: 200, onlinePerDay: 100 })
    expect(many.cheapest).toBe('BUSINESS')
    expect(many.monthlyOnline).toBe(100 * 20 * 30)
  })

  it('every output carries a trace that shows its inputs', () => {
    const p = project({ price: 22, sunbeds: 60, onlinePerDay: 10 })
    for (const t of p.tiers) {
      expect(t.trace.length).toBeGreaterThan(0)
      expect(t.trace.join(' ')).toContain('€22')
    }
    expect(p.trace.join(' ')).toMatch(/your estimate/)
  })

  it('never produces NaN or negatives across the input range', () => {
    for (const price of [1, 7.5, 20, 99, 500]) {
      for (const online of [null, 0, 1, 60]) {
        const p = project({ price, sunbeds: 60, onlinePerDay: online })
        for (const t of p.tiers) {
          for (const v of [t.commissionPerBed, t.keepPerBed, t.breakEvenBedDays ?? 0, t.monthlyCost ?? 0]) {
            expect(Number.isFinite(v)).toBe(true)
            expect(v).toBeGreaterThanOrEqual(0)
          }
        }
      }
    }
  })
})

describe('parseProjectionInput — public input', () => {
  it('accepts their price and count, with or without the online estimate', () => {
    expect(parseProjectionInput({ price: 20, sunbeds: 60 })).toEqual({ price: 20, sunbeds: 60, onlinePerDay: null })
    expect(parseProjectionInput({ price: 20, sunbeds: 60, onlinePerDay: 12 })?.onlinePerDay).toBe(12)
  })
  it('rejects nonsense', () => {
    for (const bad of [null, { price: 0, sunbeds: 60 }, { price: 20, sunbeds: 0 }, { price: 20, sunbeds: 60, onlinePerDay: 61 }, { price: 'x', sunbeds: 60 }, { price: 20, sunbeds: 6.5 }])
      expect(parseProjectionInput(bad)).toBeNull()
  })
})
