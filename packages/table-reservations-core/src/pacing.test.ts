import { describe, it, expect } from 'vitest'
import {
  pacingWindowStartMs,
  coversStartingInWindow,
  wouldExceedPacing,
} from './pacing'

const at = (h: number, m: number) => Date.UTC(2026, 0, 1, h, m)

describe('pacingWindowStartMs', () => {
  it('floors to the 15-minute bucket', () => {
    expect(pacingWindowStartMs(at(12, 7), 15)).toBe(at(12, 0))
    expect(pacingWindowStartMs(at(12, 20), 15)).toBe(at(12, 15))
    expect(pacingWindowStartMs(at(12, 15), 15)).toBe(at(12, 15))
  })
  it('handles a 30-minute window', () => {
    expect(pacingWindowStartMs(at(12, 29), 30)).toBe(at(12, 0))
    expect(pacingWindowStartMs(at(12, 30), 30)).toBe(at(12, 30))
  })
})

describe('coversStartingInWindow', () => {
  const items = [
    { fromMs: at(12, 0), partySize: 2 },
    { fromMs: at(12, 10), partySize: 4 },
    { fromMs: at(12, 15), partySize: 3 }, // next bucket
    { fromMs: at(11, 59), partySize: 5 }, // prior bucket
  ]
  it('sums only starts within the window', () => {
    expect(coversStartingInWindow(items, at(12, 0), 15)).toBe(6) // 2 + 4
    expect(coversStartingInWindow(items, at(12, 15), 15)).toBe(3)
    expect(coversStartingInWindow(items, at(11, 45), 15)).toBe(5)
  })
})

describe('wouldExceedPacing', () => {
  it('null cap never exceeds', () => {
    expect(wouldExceedPacing(100, 10, null)).toBe(false)
    expect(wouldExceedPacing(100, 10, undefined)).toBe(false)
  })
  it('allows reaching the cap exactly', () => {
    expect(wouldExceedPacing(6, 2, 8)).toBe(false)
  })
  it('blocks going over', () => {
    expect(wouldExceedPacing(7, 2, 8)).toBe(true)
  })
})
