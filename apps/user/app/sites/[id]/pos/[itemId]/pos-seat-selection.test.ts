/**
 * The POS (QR) picking rules, stated as requirements:
 *
 *   - The unit opens fully selected — but only its FREE beds.
 *   - A click is about the bed that was tapped, never the unit.
 *   - The price follows the pick, seat by seat, at the price the server will
 *     actually charge.
 *   - Nothing selected is a legal state: no price, nothing to reserve.
 *   - Picking is offered only where there is a choice to make.
 */
import { describe, it, expect } from 'vitest'
import {
  canPickSeats,
  initialSeatSelection,
  seatPrice,
  selectionPrice,
  toggleSeatId,
  unitIsSellable,
} from './pos-seat-selection'
import type { InventoryItem, SiteProps } from '@/app/sites/types'

function makeItem(id: string, price: number | null = null): InventoryItem {
  return { id, number: 1, group: 1, status: 'active', price }
}

const site = (over: Partial<SiteProps> = {}): SiteProps =>
  ({ services: [], ...over }) as SiteProps

// ────────────────────────────────────────────────────────────────────────────

describe('canPickSeats', () => {
  const pair = [makeItem('a'), makeItem('b')]

  it('is off unless the site allows partial group booking', () => {
    expect(canPickSeats(site(), pair)).toBe(false)
    expect(canPickSeats(site({ partialGroupBookingEnabled: false }), pair)).toBe(false)
  })

  it('is on for a multi-bed unit when the site allows it', () => {
    expect(canPickSeats(site({ partialGroupBookingEnabled: true }), pair)).toBe(true)
  })

  it('stays off for a single-bed unit — deselecting the only bed books nothing', () => {
    expect(canPickSeats(site({ partialGroupBookingEnabled: true }), [makeItem('a')])).toBe(false)
  })
})

describe('initialSeatSelection', () => {
  it('opens with the whole unit selected', () => {
    const unit = [makeItem('a'), makeItem('b')]
    expect(initialSeatSelection(unit, ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('never preselects a bed somebody else holds', () => {
    const unit = [makeItem('a'), makeItem('b')]
    expect(initialSeatSelection(unit, ['a'])).toEqual(['a'])
  })

  it('selects nothing when the whole unit is taken', () => {
    expect(initialSeatSelection([makeItem('a'), makeItem('b')], [])).toEqual([])
  })
})

describe('toggleSeatId', () => {
  it('removes only the tapped bed, leaving the rest of the unit selected', () => {
    expect(toggleSeatId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('adds a bed back without re-taking the unit', () => {
    // The online map re-takes the whole unit on a click into an empty unit;
    // here the guest is standing at the beds and means only the one they tapped.
    expect(toggleSeatId([], 'a')).toEqual(['a'])
  })

  it('can empty the unit', () => {
    expect(toggleSeatId(toggleSeatId(['a', 'b'], 'a'), 'b')).toEqual([])
  })
})

describe('price', () => {
  it('follows the number of beds picked', () => {
    const unit = [makeItem('a', 9), makeItem('b', 9)]
    expect(selectionPrice(unit, 8)).toBe(18)
    expect(selectionPrice([unit[0]!], 8)).toBe(9)
  })

  it('is zero when nothing is picked — not the price of the unit', () => {
    expect(selectionPrice([], 8)).toBe(0)
  })

  it('falls back to the site price for a seat that has none, as the server does', () => {
    // The POS strip used to sum `item.price` alone and showed 0 € on a site
    // whose seats carry no per-seat price — while the server charged the site
    // price at Reserve.
    expect(seatPrice(makeItem('a', null), 12.95)).toBe(12.95)
    expect(seatPrice(makeItem('a', 0), 12.95)).toBe(12.95)
    expect(selectionPrice([makeItem('a'), makeItem('b')], 12.95)).toBeCloseTo(25.9)
  })

  it('prefers the seat price over the site price', () => {
    expect(seatPrice(makeItem('a', 20), 8)).toBe(20)
  })

  it('is zero when neither the seat nor the site has a price', () => {
    expect(seatPrice(makeItem('a'), null)).toBe(0)
  })
})

describe('unitIsSellable', () => {
  const unit = [makeItem('a'), makeItem('b')]

  it('needs every bed free when the unit is sold whole', () => {
    expect(unitIsSellable(unit, ['a', 'b'], false)).toBe(true)
    expect(unitIsSellable(unit, ['a'], false)).toBe(false)
  })

  it('needs only one free bed when the guest may pick', () => {
    expect(unitIsSellable(unit, ['a'], true)).toBe(true)
  })

  it('is false when the whole unit is taken, either way', () => {
    expect(unitIsSellable(unit, [], true)).toBe(false)
    expect(unitIsSellable(unit, [], false)).toBe(false)
  })

  it('is false for an empty unit rather than vacuously true', () => {
    expect(unitIsSellable([], [], false)).toBe(false)
  })
})
