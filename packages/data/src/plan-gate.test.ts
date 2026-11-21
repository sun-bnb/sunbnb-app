import { describe, it, expect } from 'vitest'
import { canAddHamacas, gateFor, CHARGE_GATES, hamacaLimitMessage } from './plan-gate'
import { TIER_FEATURE_DEFAULTS } from './subscription'

describe('canAddHamacas', () => {
  it('a limit of 100: the 101st hamaca is refused', () => {
    expect(canAddHamacas(100, 99, 1)).toBe(true)
    expect(canAddHamacas(100, 100, 1)).toBe(false)
  })
  it('a limit of 300 stops at 300', () => {
    expect(canAddHamacas(300, 290, 10)).toBe(true)
    expect(canAddHamacas(300, 290, 11)).toBe(false)
  })
  it('an over-limit venue keeps everything: removing or saving without adding is allowed', () => {
    expect(canAddHamacas(100, 195, 0)).toBe(true)
    expect(canAddHamacas(100, 195, -5)).toBe(true)
    expect(canAddHamacas(100, 195, 1)).toBe(false)
  })
  it('null limit (every plan today) = no limit', () => {
    expect(canAddHamacas(null, 5000, 100)).toBe(true)
  })
  it('message names the limit and says existing sunbeds stay', () => {
    expect(hamacaLimitMessage({ current: 100, limit: 100 })).toMatch(/100 hamacas.*Existing sunbeds stay/)
  })
})

describe('gateFor / CHARGE_GATES', () => {
  const kinds = Object.keys(CHARGE_GATES) as (keyof typeof CHARGE_GATES)[]
  it('every plan allows every charge kind', () => {
    for (const k of kinds) {
      expect(gateFor(TIER_FEATURE_DEFAULTS.STARTER, CHARGE_GATES[k]).allowed).toBe(true)
      expect(gateFor(TIER_FEATURE_DEFAULTS.PRO, CHARGE_GATES[k]).allowed).toBe(true)
      expect(gateFor(TIER_FEATURE_DEFAULTS.BUSINESS, CHARGE_GATES[k]).allowed).toBe(true)
    }
  })
  it('an agreement that switches online payments off refuses every charge kind', () => {
    const f = { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: false, FOOD_AND_BEVERAGE: true }
    for (const k of kinds) expect(gateFor(f, CHARGE_GATES[k])).toMatchObject({ allowed: false, feature: 'ONLINE_PAYMENTS' })
  })
  it('F&B kinds need FOOD_AND_BEVERAGE even when online payments are on', () => {
    const f = { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: true, FOOD_AND_BEVERAGE: false }
    expect(gateFor(f, CHARGE_GATES.reservation).allowed).toBe(true)
    for (const k of ['order', 'tab', 'table-deposit'] as const) {
      expect(gateFor(f, CHARGE_GATES[k])).toMatchObject({ allowed: false, feature: 'FOOD_AND_BEVERAGE' })
    }
  })
})
