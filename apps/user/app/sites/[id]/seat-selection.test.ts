/**
 * Requirements-driven tests for the click-to-select policy shared by the geo
 * map and the schematic canvas.
 *
 * The requirement (as specified, not as implemented):
 *   - partial OFF → a click always moves the WHOLE unit, select and deselect.
 *   - partial ON  → the first click on an untouched unit takes the whole unit;
 *     from then on, clicks select and deselect ONE seat at a time; emptying a
 *     unit returns it to untouched.
 *   - a seat somebody else holds is never selectable, in either mode.
 */
import { describe, it, expect } from 'vitest'
import { toggleSeatSelection } from '@/app/sites/[id]/seat-selection'
import type { InventoryItem } from '@/app/sites/types'

function makeItem(overrides: Partial<InventoryItem> & { id: string }): InventoryItem {
  return {
    number: 1,
    group: 1,
    status: 'active',
    sunbedGroupId: null,
    sunbedGroup: null,
    ...overrides,
  }
}

/** A unit of `ids.length` seats sharing one SunbedGroup. */
function makeUnit(...ids: string[]): InventoryItem[] {
  const group = { id: `grp-${ids[0]}`, items: ids.map(id => ({ id })) }
  return ids.map(id => makeItem({ id, sunbedGroupId: group.id, sunbedGroup: group }))
}

function opts(
  partialGroupBooking: boolean,
  inventory: InventoryItem[],
  unavailableIds: string[] = [],
) {
  const byId = new Map(inventory.map(i => [i.id, i]))
  const blocked = new Set(unavailableIds)
  return {
    partialGroupBooking,
    isAvailable: (item: InventoryItem) => !blocked.has(item.id),
    resolveItem: (id: string) => byId.get(id),
  }
}

const ids = (items: InventoryItem[]) => items.map(i => i.id).sort()

// ────────────────────────────────────────────────────────────────────────────
// Whole-unit policy (partial group booking OFF) — today's behaviour
// ────────────────────────────────────────────────────────────────────────────

describe('toggleSeatSelection — whole-unit policy', () => {
  it('selects the whole unit from a click on one seat', () => {
    const unit = makeUnit('a', 'b')
    const result = toggleSeatSelection(unit[0]!, [], opts(false, unit))
    expect(ids(result)).toEqual(['a', 'b'])
  })

  it('deselects the whole unit from a click on any of its selected seats', () => {
    const unit = makeUnit('a', 'b')
    const result = toggleSeatSelection(unit[1]!, unit, opts(false, unit))
    expect(result).toEqual([])
  })

  it('never selects a single seat of a unit — the second click undoes the first', () => {
    const unit = makeUnit('a', 'b')
    const o = opts(false, unit)
    const selected = toggleSeatSelection(unit[0]!, [], o)
    const cleared = toggleSeatSelection(unit[1]!, selected, o)
    expect(ids(selected)).toEqual(['a', 'b'])
    expect(cleared).toEqual([])
  })

  it('toggles a seat that belongs to no unit on its own', () => {
    const solo = makeItem({ id: 'solo' })
    const selected = toggleSeatSelection(solo, [], opts(false, [solo]))
    expect(ids(selected)).toEqual(['solo'])
    expect(toggleSeatSelection(solo, selected, opts(false, [solo]))).toEqual([])
  })

  it('leaves other units alone', () => {
    const one = makeUnit('a', 'b')
    const two = makeUnit('c', 'd')
    const inventory = [...one, ...two]
    const result = toggleSeatSelection(two[0]!, one, opts(false, inventory))
    expect(ids(result)).toEqual(['a', 'b', 'c', 'd'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Partial policy (partial group booking ON)
// ────────────────────────────────────────────────────────────────────────────

describe('toggleSeatSelection — partial policy', () => {
  it('takes the whole unit on the first click, as with the flag off', () => {
    const unit = makeUnit('a', 'b')
    const result = toggleSeatSelection(unit[0]!, [], opts(true, unit))
    expect(ids(result)).toEqual(['a', 'b'])
  })

  it('drops ONLY the clicked seat once the unit is in play', () => {
    const unit = makeUnit('a', 'b', 'c')
    const o = opts(true, unit)
    const whole = toggleSeatSelection(unit[0]!, [], o)
    const trimmed = toggleSeatSelection(unit[2]!, whole, o)
    expect(ids(trimmed)).toEqual(['a', 'b'])
  })

  it('reaches a single-seat booking by deselecting the rest', () => {
    const unit = makeUnit('a', 'b', 'c')
    const o = opts(true, unit)
    let selection = toggleSeatSelection(unit[0]!, [], o)
    selection = toggleSeatSelection(unit[1]!, selection, o)
    selection = toggleSeatSelection(unit[2]!, selection, o)
    expect(ids(selection)).toEqual(['a'])
  })

  it('adds a single seat back without re-taking the whole unit', () => {
    const unit = makeUnit('a', 'b', 'c')
    const o = opts(true, unit)
    const oneLeft = [unit[0]!]
    const twoNow = toggleSeatSelection(unit[2]!, oneLeft, o)
    expect(ids(twoNow)).toEqual(['a', 'c'])
  })

  it('re-takes the whole unit once the last seat has been deselected', () => {
    const unit = makeUnit('a', 'b')
    const o = opts(true, unit)
    const emptied = toggleSeatSelection(unit[0]!, [unit[0]!], o)
    expect(emptied).toEqual([])
    expect(ids(toggleSeatSelection(unit[1]!, emptied, o))).toEqual(['a', 'b'])
  })

  it('treats each unit independently — a second unit still arrives whole', () => {
    const one = makeUnit('a', 'b')
    const two = makeUnit('c', 'd')
    const inventory = [...one, ...two]
    const o = opts(true, inventory)
    const partialFirstUnit = [one[0]!]
    const result = toggleSeatSelection(two[0]!, partialFirstUnit, o)
    expect(ids(result)).toEqual(['a', 'c', 'd'])
  })

  it('toggles an ungrouped seat one at a time, same as with the flag off', () => {
    const solo = makeItem({ id: 'solo' })
    const o = opts(true, [solo])
    const selected = toggleSeatSelection(solo, [], o)
    expect(ids(selected)).toEqual(['solo'])
    expect(toggleSeatSelection(solo, selected, o)).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Availability — the selection must never contain a seat someone else holds
// ────────────────────────────────────────────────────────────────────────────

describe('toggleSeatSelection — availability', () => {
  it('ignores a click on an unavailable seat', () => {
    const unit = makeUnit('a', 'b')
    const selection: InventoryItem[] = []
    expect(toggleSeatSelection(unit[0]!, selection, opts(true, unit, ['a']))).toBe(selection)
  })

  it('takes only the free seats of a partly-booked unit (partial ON)', () => {
    const unit = makeUnit('a', 'b', 'c')
    const result = toggleSeatSelection(unit[0]!, [], opts(true, unit, ['b']))
    expect(ids(result)).toEqual(['a', 'c'])
  })

  it('takes only the free seats of a partly-booked unit with the flag OFF too', () => {
    // A venue can block one bed of a unit from the manage grid at any time.
    // Co-selecting it would only earn a server-side rejection of the whole
    // reservation when the guest presses Reserve.
    const unit = makeUnit('a', 'b')
    const result = toggleSeatSelection(unit[0]!, [], opts(false, unit, ['b']))
    expect(ids(result)).toEqual(['a'])
  })

  it('returns the same array when nothing can be added, so the caller can skip the dispatch', () => {
    const unit = makeUnit('a', 'b')
    const selection = [unit[0]!, unit[1]!]
    // Both already selected: the clicked seat is selected, so this is a deselect —
    // use a click on an unavailable seat instead to hit the no-op path.
    expect(toggleSeatSelection(unit[0]!, selection, opts(true, unit, ['a']))).toBe(selection)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Member resolution
// ────────────────────────────────────────────────────────────────────────────

describe('toggleSeatSelection — member resolution', () => {
  it('selects full inventory rows for co-selected members, not id-only stubs', () => {
    const unit = makeUnit('a', 'b')
    const result = toggleSeatSelection(unit[0]!, [], opts(false, unit))
    const b = result.find(i => i.id === 'b')!
    expect(b.status).toBe('active')
  })

  it('still selects a member that is missing from the loaded inventory', () => {
    // The map streams seats by viewport; a sibling can be absent from the
    // client-side list. Dropping it would book half a unit under a policy that
    // forbids exactly that.
    const [a] = makeUnit('a', 'b')
    const result = toggleSeatSelection(a!, [], {
      partialGroupBooking: false,
      isAvailable: () => true,
      resolveItem: (id: string) => (id === 'a' ? a : undefined),
    })
    expect(ids(result)).toEqual(['a', 'b'])
  })
})
