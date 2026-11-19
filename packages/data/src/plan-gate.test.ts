import { describe, it, expect } from 'vitest'
import { canAddHamacas, gateFor, CHARGE_GATES, hamacaLimitMessage } from './plan-gate'
import { TIER_FEATURE_DEFAULTS } from './subscription'

describe('canAddHamacas (CR-002)', () => {
  it('Gratis: 100 is the last hamaca, the 101st is refused', () => {
    expect(canAddHamacas(100, 99, 1)).toBe(true)
    expect(canAddHamacas(100, 100, 1)).toBe(false)
  })
  it('Temporada: stops at 300', () => {
    expect(canAddHamacas(300, 290, 10)).toBe(true)
    expect(canAddHamacas(300, 290, 11)).toBe(false)
  })
  it('an over-limit venue keeps everything: removing or saving without adding is allowed', () => {
    expect(canAddHamacas(100, 195, 0)).toBe(true)
    expect(canAddHamacas(100, 195, -5)).toBe(true)
    expect(canAddHamacas(100, 195, 1)).toBe(false)
  })
  it('null limit = set per agreement and none recorded: no limit', () => {
    expect(canAddHamacas(null, 5000, 100)).toBe(true)
  })
  it('message names the limit and says existing sunbeds stay', () => {
    expect(hamacaLimitMessage({ current: 100, limit: 100 })).toMatch(/100 hamacas.*Existing sunbeds stay/)
  })
})

describe('gateFor / CHARGE_GATES (CR-002)', () => {
  const kinds = Object.keys(CHARGE_GATES) as (keyof typeof CHARGE_GATES)[]
  it('Gratis refuses every online charge kind', () => {
    for (const k of kinds) expect(gateFor(TIER_FEATURE_DEFAULTS.GRATIS, CHARGE_GATES[k]).allowed).toBe(false)
  })
  it('Temporada and Grupo allow every charge kind', () => {
    for (const k of kinds) {
      expect(gateFor(TIER_FEATURE_DEFAULTS.TEMPORADA, CHARGE_GATES[k]).allowed).toBe(true)
      expect(gateFor(TIER_FEATURE_DEFAULTS.GRUPO, CHARGE_GATES[k]).allowed).toBe(true)
    }
  })
  it('F&B kinds need FOOD_AND_BEVERAGE even when online payments are on', () => {
    const f = { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: true, FOOD_AND_BEVERAGE: false }
    expect(gateFor(f, CHARGE_GATES.reservation).allowed).toBe(true)
    for (const k of ['order', 'tab', 'table-deposit'] as const) {
      expect(gateFor(f, CHARGE_GATES[k])).toMatchObject({ allowed: false, feature: 'FOOD_AND_BEVERAGE' })
    }
  })
})
