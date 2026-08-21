/**
 * Mobile drawer peek height (track 023 P2).
 *
 * This arithmetic shipped inline in `SiteView` and had no test. It is worth one
 * now that it is a supported contract: a custom brand shell mounts the same
 * drawer, and a wrong peek is a phone-only defect — the guest sees a clipped
 * date field or a slab of empty panel, neither of which any desktop check or
 * type error would catch.
 */

import { describe, it, expect } from 'vitest'

import { peekHeight, type PeekInput } from './peek-height'

const base: PeekInput = {
  viewMode: 'sunbeds',
  reservationMode: 'days',
  hasHourlyEquipment: false,
  hasViewModeTabs: false,
}

describe('peekHeight', () => {
  it('shows the date range on the sunbeds tab', () => {
    expect(peekHeight(base)).toBe(66)
  })

  it('adds room for the hours/days toggle and time picker on hourly equipment', () => {
    expect(peekHeight({ ...base, viewMode: 'equipment', hasHourlyEquipment: true, reservationMode: 'hours' })).toBe(100)
  })

  it('is TALLER in days mode than hours mode — the date range needs more room than the time picker', () => {
    const hours = peekHeight({ ...base, viewMode: 'equipment', hasHourlyEquipment: true, reservationMode: 'hours' })
    const days = peekHeight({ ...base, viewMode: 'equipment', hasHourlyEquipment: true, reservationMode: 'days' })

    expect(days).toBe(108)
    expect(days).toBeGreaterThan(hours)
  })

  it('falls back to the sunbeds height on an equipment tab with no hourly pricing', () => {
    // No hourly rentals means no hours/days toggle, so the equipment tab carries
    // the same controls as the sunbeds one. Easy branch to lose in a rewrite,
    // and losing it leaves a 40px gap under the drawer on those sites.
    expect(peekHeight({ ...base, viewMode: 'equipment', hasHourlyEquipment: false })).toBe(66)
    expect(peekHeight({ ...base, viewMode: 'equipment', hasHourlyEquipment: false, reservationMode: 'hours' })).toBe(66)
  })

  it('reserves the tab strip whenever both tabs are shown, in every mode', () => {
    const cases: PeekInput[] = [
      { ...base },
      { ...base, viewMode: 'equipment', hasHourlyEquipment: true, reservationMode: 'hours' },
      { ...base, viewMode: 'equipment', hasHourlyEquipment: true, reservationMode: 'days' },
      { ...base, viewMode: 'equipment', hasHourlyEquipment: false },
    ]

    for (const input of cases) {
      expect(peekHeight({ ...input, hasViewModeTabs: true })).toBe(peekHeight(input) + 52)
    }
  })

  it('ignores the hours/days mode entirely on the sunbeds tab', () => {
    // Sunbeds are sold by the day; the mode belongs to equipment. A peek that
    // moved with it would jump when the guest switched tabs and back.
    expect(peekHeight({ ...base, reservationMode: 'hours' })).toBe(peekHeight(base))
    expect(peekHeight({ ...base, reservationMode: 'hours', hasHourlyEquipment: true })).toBe(peekHeight(base))
  })
})
