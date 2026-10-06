import { describe, expect, it } from 'vitest'
import { aiDailyBudget, DEFAULT_AI_DAILY_TURNS, LIMITS } from './limit-policy.ts'

describe('aiDailyBudget', () => {
  it('uses a configured whole number, including 0 (AI off)', () => {
    expect(aiDailyBudget('500')).toBe(500)
    expect(aiDailyBudget(' 0 ')).toBe(0)
  })
  it('falls back to the default — never to unlimited — when unset or malformed', () => {
    for (const raw of [undefined, '', 'abc', '-5', '1e9', 'Infinity', '12.5']) expect(aiDailyBudget(raw)).toBe(DEFAULT_AI_DAILY_TURNS)
  })
})

describe('LIMITS', () => {
  it('every policy is a positive count over a positive window', () => {
    for (const l of Object.values(LIMITS)) {
      expect(Number.isInteger(l.maxAttempts) && l.maxAttempts > 0).toBe(true)
      expect(l.windowMs).toBeGreaterThan(0)
    }
  })
  it('one IP cannot take more than a small share of the default daily AI budget', () => {
    expect(LIMITS.aiPerIp.maxAttempts).toBeLessThanOrEqual(DEFAULT_AI_DAILY_TURNS / 10)
  })
  it('a recipient gets at most a couple of "your beach" emails a day', () => {
    expect(LIMITS.prospectEmail.maxAttempts).toBeLessThanOrEqual(2)
  })
})
