import { describe, it, expect } from 'vitest'

import { clampSlot, fmtHour, hourBounds } from './equipment-time'

describe('hourBounds', () => {
  it('opens at the opening hour on a future day', () => {
    expect(hourBounds(10, 19, false, 15)).toEqual({ minStart: 10, closeHour: 19 })
  })

  it('starts today at the next full hour, never in the past', () => {
    expect(hourBounds(10, 19, true, 13)).toEqual({ minStart: 14, closeHour: 19 })
    expect(hourBounds(10, 19, true, 7)).toEqual({ minStart: 10, closeHour: 19 })
  })

  it('has nothing bookable today once the last start has passed', () => {
    expect(hourBounds(10, 19, true, 18)).toBeNull()
    expect(hourBounds(10, 19, true, 22)).toBeNull()
  })
})

describe('clampSlot', () => {
  const b = { minStart: 10, closeHour: 19 }

  it('defaults to the first start for 2 hours', () => {
    expect(clampSlot(b)).toEqual({ start: 10, duration: 2 })
  })

  it('pulls a start outside the day back inside it', () => {
    expect(clampSlot(b, { start: 8, duration: 2 })).toEqual({ start: 10, duration: 2 })
    expect(clampSlot(b, { start: 22, duration: 2 })).toEqual({ start: 18, duration: 1 })
  })

  it('shortens a duration that would run past closing', () => {
    expect(clampSlot(b, { start: 17, duration: 4 })).toEqual({ start: 17, duration: 2 })
  })

  it('never goes below one hour', () => {
    expect(clampSlot(b, { start: 12, duration: 0 })).toEqual({ start: 12, duration: 1 })
  })
})

describe('fmtHour', () => {
  it('pads to HH:00', () => {
    expect(fmtHour(9)).toBe('09:00')
    expect(fmtHour(14)).toBe('14:00')
  })
})
