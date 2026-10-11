import { describe, expect, it, vi } from 'vitest'
import { allowAiTurn, parseTurnBudget, type CounterStore, type LimitPolicy } from './limits.ts'

/** In-memory fixed-window counter; records every hit. */
function memoryStore() {
  const counts = new Map<string, number>()
  const hits: string[] = []
  const store: CounterStore = {
    async hit(key: string, policy: LimitPolicy) {
      hits.push(key)
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { allowed: count <= policy.maxAttempts, count }
    },
  }
  return { store, hits }
}

const gate = (maxTurns: number, onBudgetReached?: (b: number) => void) => ({
  checks: [
    { key: 'chat:1.2.3.4', policy: { maxAttempts: 2, windowMs: 1000 } },
    { key: 'aiPerIp:1.2.3.4', policy: { maxAttempts: 3, windowMs: 1000 } },
  ],
  budget: { key: 'ai-budget:global', maxTurns, windowMs: 1000 },
  ...(onBudgetReached ? { onBudgetReached } : {}),
})

describe('allowAiTurn', () => {
  it('rejects on the first failing per-key check without touching the budget', async () => {
    const { store, hits } = memoryStore()
    expect(await allowAiTurn(store, gate(10))).toBe('ok')
    expect(await allowAiTurn(store, gate(10))).toBe('ok')
    hits.length = 0
    expect(await allowAiTurn(store, gate(10))).toBe('rate_limited')
    expect(hits).toEqual(['chat:1.2.3.4'])
  })

  it('a daily per-key cap applies after the burst passes', async () => {
    const { store } = memoryStore()
    const g = { ...gate(10), checks: [{ key: 'b', policy: { maxAttempts: 99, windowMs: 1 } }, { key: 'd', policy: { maxAttempts: 1, windowMs: 1 } }] }
    expect(await allowAiTurn(store, g)).toBe('ok')
    expect(await allowAiTurn(store, g)).toBe('rate_limited')
  })

  it('notifies exactly once when the global budget trips', async () => {
    const { store } = memoryStore()
    const notify = vi.fn()
    const keys = ['a', 'b', 'c', 'd']
    const results = []
    for (const k of keys) results.push(await allowAiTurn(store, { ...gate(2, notify), checks: [{ key: k, policy: { maxAttempts: 9, windowMs: 1 } }] }))
    expect(results).toEqual(['ok', 'ok', 'budget', 'budget'])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(2)
  })

  it('budget 0 turns the AI off (and still notifies once)', async () => {
    const { store } = memoryStore()
    const notify = vi.fn()
    expect(await allowAiTurn(store, { checks: [], budget: { key: 'g', maxTurns: 0, windowMs: 1 }, onBudgetReached: notify })).toBe('budget')
    expect(await allowAiTurn(store, { checks: [], budget: { key: 'g', maxTurns: 0, windowMs: 1 }, onBudgetReached: notify })).toBe('budget')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('a store that fails open (count 0) never notifies', async () => {
    const notify = vi.fn()
    const store: CounterStore = { hit: async () => ({ allowed: false, count: 0 }) }
    expect(await allowAiTurn(store, { checks: [], budget: { key: 'g', maxTurns: 5, windowMs: 1 }, onBudgetReached: notify })).toBe('budget')
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('parseTurnBudget', () => {
  it('uses a configured whole number, including 0', () => {
    expect(parseTurnBudget('500', 7)).toBe(500)
    expect(parseTurnBudget(' 0 ', 7)).toBe(0)
  })
  it('falls back — never to unlimited — when unset or malformed', () => {
    for (const raw of [undefined, '', 'abc', '-5', '1e9', 'Infinity', '12.5', '12345678']) expect(parseTurnBudget(raw, 7)).toBe(7)
  })
})
