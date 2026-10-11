import { describe, it, expect } from 'vitest'
import {
  ASSISTANT_ACTION_STATUS as S,
  ASSISTANT_ACTION_STATUSES,
  addUsage,
  canTransition,
} from './assistant'
import { FLAG_REGISTRY, resolveFlag } from './flags'

describe('canTransition', () => {
  it('allows exactly the documented edges', () => {
    const allowed = new Set([
      `${S.PROPOSED}>${S.APPLIED}`,
      `${S.PROPOSED}>${S.REJECTED}`,
      `${S.PROPOSED}>${S.EXPIRED}`,
      `${S.PROPOSED}>${S.FAILED}`,
      `${S.APPLIED}>${S.UNDONE}`,
    ])
    for (const from of ASSISTANT_ACTION_STATUSES) {
      for (const to of ASSISTANT_ACTION_STATUSES) {
        expect(canTransition(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`))
      }
    }
  })

  it('treats unknown statuses as terminal', () => {
    expect(canTransition('bogus', S.APPLIED)).toBe(false)
    expect(canTransition(S.PROPOSED, 'bogus')).toBe(false)
  })
})

describe('addUsage', () => {
  it('sums fields and treats missing as zero', () => {
    expect(addUsage({ inputTokens: 10, costEstimate: 0.01 }, { inputTokens: 5, outputTokens: 2 })).toEqual({
      inputTokens: 15,
      outputTokens: 2,
      costEstimate: 0.01,
    })
    expect(addUsage(null, undefined)).toEqual({})
  })
})

describe('assistant flag', () => {
  it('is off by default in every environment but on for sudo', () => {
    const def = FLAG_REGISTRY.assistant
    for (const environment of ['development', 'preview', 'test', 'production'] as const) {
      expect(resolveFlag(def, { environment }).enabled).toBe(false)
      expect(resolveFlag(def, { environment, isSudo: true })).toMatchObject({ enabled: true, source: 'sudo' })
    }
  })
})
