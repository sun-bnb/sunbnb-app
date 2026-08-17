/**
 * Fleet health derivation (track 021 P5). Requirements-driven: each case is a
 * state an operator has to act on differently, so a wrong answer sends someone
 * to the wrong parasol — or worse, nowhere.
 */

import { describe, it, expect } from 'vitest'
import { deviceHealth, formatLocation, batteryLevel, SILENT_AFTER_MS } from './device-health'

const NOW = new Date('2026-08-16T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('deviceHealth', () => {
  it('never reported → never-seen (flashed but not installed)', () => {
    expect(deviceHealth({ assignedLocation: null, reportedLocation: null, lastSeenAt: null }, NOW))
      .toBe('never-seen')
  })

  it('reporting, no location yet → unassigned (it lights nothing)', () => {
    expect(deviceHealth(
      { assignedLocation: null, reportedLocation: null, lastSeenAt: ago(60_000) }, NOW,
    )).toBe('unassigned')
  })

  it('assigned and confirmed → ok', () => {
    expect(deviceHealth(
      { assignedLocation: '1-1-1', reportedLocation: '1-1-1', lastSeenAt: ago(60_000) }, NOW,
    )).toBe('ok')
  })

  it('assigned but running something else → pending (the assign/apply gap)', () => {
    expect(deviceHealth(
      { assignedLocation: '1-1-2', reportedLocation: '1-1-1', lastSeenAt: ago(60_000) }, NOW,
    )).toBe('pending')
  })

  it('assigned but has never confirmed anything → pending', () => {
    expect(deviceHealth(
      { assignedLocation: '1-1-2', reportedLocation: null, lastSeenAt: ago(60_000) }, NOW,
    )).toBe('pending')
  })

  // Silence outranks configuration: a device nobody can hear is a fault whatever
  // its assignment says, and a "not applied" badge on a dead unit would suggest
  // waiting rather than walking out to it.
  it('silence outranks BOTH pending and unassigned', () => {
    const silent = ago(SILENT_AFTER_MS + 1000)
    expect(deviceHealth({ assignedLocation: '1-1-2', reportedLocation: '1-1-1', lastSeenAt: silent }, NOW))
      .toBe('silent')
    expect(deviceHealth({ assignedLocation: null, reportedLocation: null, lastSeenAt: silent }, NOW))
      .toBe('silent')
  })

  it('is not silent one second inside the window', () => {
    expect(deviceHealth(
      { assignedLocation: '1-1-1', reportedLocation: '1-1-1', lastSeenAt: ago(SILENT_AFTER_MS - 1000) },
      NOW,
    )).toBe('ok')
  })
})

describe('formatLocation', () => {
  it('formats parcel-row-unit', () => {
    expect(formatLocation({ assignedParcel: 1, assignedRow: 10, assignedSeq: 3 })).toBe('1-10-3')
  })

  it('is null unless every part is present — a partial address is not an address', () => {
    expect(formatLocation({ assignedParcel: 1, assignedRow: null, assignedSeq: 3 })).toBeNull()
    expect(formatLocation({ assignedParcel: null, assignedRow: null, assignedSeq: null })).toBeNull()
  })

  it('keeps a zero parcel/row (the 0-0-N scheme for unparcelled units)', () => {
    expect(formatLocation({ assignedParcel: 0, assignedRow: 0, assignedSeq: 7 })).toBe('0-0-7')
  })
})

describe('batteryLevel', () => {
  it('treats a ZERO reading as no measurement, not a flat cell', () => {
    // The first real firmware capture (0.1.0) reports battMv: 0 because the
    // board has no fuel gauge yet. Classifying that as critical would raise a
    // false alarm on every healthy device in the fleet.
    expect(batteryLevel(0)).toBe('unknown')
    expect(batteryLevel(-1)).toBe('unknown')
  })

  it('classifies cell voltage — the one number that predicts a field failure', () => {
    expect(batteryLevel(4100)).toBe('ok')
    expect(batteryLevel(3599)).toBe('low')
    expect(batteryLevel(3299)).toBe('critical')
    expect(batteryLevel(null)).toBe('unknown')
  })
})
