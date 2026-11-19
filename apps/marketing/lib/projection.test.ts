import { describe, expect, it } from 'vitest'
import { PRICING_TIERS } from '@repo/data/pricing-tiers'
import { parseProjectionInput, project } from './projection.ts'

describe('project — only the catalogue and their own numbers', () => {
  it('projects only plans with a public online price — Temporada, not Gratis or Grupo', () => {
    const p = project({ price: 20, sunbeds: 60 })
    expect(p.tiers.map((t) => t.tier)).toEqual(['TEMPORADA'])
  })

  it('commission per online sunbed-day comes straight from the plan catalogue', () => {
    const t = project({ price: 20, sunbeds: 60 }).tiers.find((l) => l.tier === 'TEMPORADA')!
    expect(t.commissionPerBed).toBe((20 * PRICING_TIERS.TEMPORADA.commissionPercent['sunbed-rental']) / 100)
    expect(t.keepPerBed + t.commissionPerBed).toBe(20)
    expect(t.breakEvenBedDays).toBeNull()
  })

  it('the month figure respects the per-venue monthly cap', () => {
    const cap = PRICING_TIERS.TEMPORADA.monthlyCommissionCapPerSite
    const small = project({ price: 20, sunbeds: 60, onlinePerDay: 10 }).tiers[0]!
    expect(small.monthlyCost).toBe((10 * 20 * 30 * 2) / 100)
    const big = project({ price: 30, sunbeds: 500, onlinePerDay: 400 }).tiers[0]!
    expect(big.monthlyCost).toBe(cap)
    expect(big.trace.join(' ')).toMatch(/capped/)
  })

  it('without their own online estimate there are NO monthly figures', () => {
    const p = project({ price: 25, sunbeds: 80 })
    expect(p.monthlyOnline).toBeNull()
    expect(p.cheapest).toBeNull()
    expect(p.tiers.every((t) => t.monthlyCost === null)).toBe(true)
    expect(p.trace).toEqual([])
  })

  it('with it: monthly cost per plan, and the cheapest one', () => {
    const many = project({ price: 20, sunbeds: 200, onlinePerDay: 100 })
    expect(many.cheapest).toBe('TEMPORADA')
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
