/**
 * Unit tests for the pair-preselection pure helpers exported from SunbedSelection.tsx.
 * These are requirements-driven: they fail when the bug exists (wrong pair resolution),
 * not merely validations of the current implementation.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveSelectionSet,
  pickFirstAvailablePair,
  pickRandomAvailablePair,
  selectionCenter,
  inventoryAnchor,
} from '@/app/sites/[id]/sunbed-preselection'
import type { InventoryItem } from '@/app/sites/types'

// Minimal factory for InventoryItem — only fields the helpers use.
function makeItem(overrides: Partial<InventoryItem> & { id: string }): InventoryItem {
  return {
    number: 1,
    group: 1,
    status: 'active',
    reservations: [],
    sunbedGroupId: null,
    sunbedGroup: null,
    ...overrides,
  }
}

/**
 * Two seats forming one UNIT — sharing a SunbedGroup, which is how every row in
 * dev, test and production is actually shaped (track 021 P0/P1). The legacy
 * pair/pairedBy self-relation it replaced is gone from the type entirely.
 */
function makeUnit(idA: string, idB: string): [InventoryItem, InventoryItem] {
  const group = { id: `grp-${idA}`, items: [{ id: idA }, { id: idB }] }
  return [
    makeItem({ id: idA, sunbedGroupId: group.id, sunbedGroup: group }),
    makeItem({ id: idB, sunbedGroupId: group.id, sunbedGroup: group }),
  ]
}

// ────────────────────────────────────────────────────────────────────────────
// resolveSelectionSet
// ────────────────────────────────────────────────────────────────────────────

describe('resolveSelectionSet', () => {
  it('returns single item when unpaired and no group', () => {
    const item = makeItem({ id: 'a' })
    const result = resolveSelectionSet(item, [item])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('selecting either seat of a unit selects BOTH (from the first member)', () => {
    const [a, b] = makeUnit('a', 'b')
    const result = resolveSelectionSet(a, [a, b])
    expect(result.map((i) => i.id).sort()).toEqual(['a', 'b'])
  })

  it('selecting either seat of a unit selects BOTH (from the second member)', () => {
    const [a, b] = makeUnit('a', 'b')
    const result = resolveSelectionSet(b, [a, b])
    expect(result.map((i) => i.id).sort()).toEqual(['a', 'b'])
  })

  // Track 021: two tests here asserted that a legacy `pair`/`pairedBy` pointer
  // was IGNORED in favour of the group. The fields are gone from InventoryItem,
  // so that is now structural — there is nothing left to ignore, and a test
  // constructing one would not compile.

  it('resolves via sunbedGroup when group is present', () => {
    const itemA = makeItem({
      id: 'a',
      sunbedGroupId: 'g1',
      sunbedGroup: { items: [{ id: 'a' }, { id: 'b' }] },
    })
    const itemB = makeItem({ id: 'b', sunbedGroupId: 'g1', sunbedGroup: { items: [{ id: 'a' }, { id: 'b' }] } })
    // 'c' is intentionally absent from inventory
    const inventory = [itemA, itemB]

    const result = resolveSelectionSet(itemA, inventory)
    const ids = result.map((i) => i.id).sort()
    expect(ids).toEqual(['a', 'b'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// pickFirstAvailablePair
// ────────────────────────────────────────────────────────────────────────────

describe('pickFirstAvailablePair', () => {
  it('returns [] when availability list is empty', () => {
    const result = pickFirstAvailablePair([], [makeItem({ id: 'a' })])
    expect(result).toEqual([])
  })

  it('returns [] when all items are unavailable', () => {
    const item = makeItem({ id: 'a' })
    const result = pickFirstAvailablePair(
      [{ itemId: 'a', available: false }],
      [item],
    )
    expect(result).toEqual([])
  })

  it('returns [] when availability list references unknown item ids', () => {
    const item = makeItem({ id: 'a' })
    const result = pickFirstAvailablePair(
      [{ itemId: 'unknown', available: true }],
      [item],
    )
    expect(result).toEqual([])
  })

  it('returns the single available item when unpaired', () => {
    const item = makeItem({ id: 'a' })
    const result = pickFirstAvailablePair(
      [{ itemId: 'a', available: true }],
      [item],
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('respects availability-list order — picks first available, skipping unavailable entries', () => {
    const itemA = makeItem({ id: 'a' })
    const itemB = makeItem({ id: 'b' })
    const result = pickFirstAvailablePair(
      [
        { itemId: 'a', available: false },
        { itemId: 'b', available: true },
      ],
      [itemA, itemB],
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('picks the first available seat and preselects its whole unit', () => {
    const [primary, secondary] = makeUnit('a', 'b')
    const inventory = [primary, secondary]

    // Availability lists the first member first
    const result = pickFirstAvailablePair(
      [
        { itemId: 'a', available: true },
        { itemId: 'b', available: true },
      ],
      inventory,
    )
    const ids = result.map((i) => i.id).sort()
    expect(ids).toEqual(['a', 'b'])
  })

  it('preselects only the FREE seats of a partly-booked unit', () => {
    // With partial group booking a unit can be half-taken (and the venue can
    // block one bed from the manage grid regardless of the flag). Preselecting
    // the booked sibling puts the flow in a state the server rejects on Reserve.
    const [a, b] = makeUnit('a', 'b')
    const result = pickFirstAvailablePair(
      [
        { itemId: 'a', available: true },
        { itemId: 'b', available: false },
      ],
      [a, b],
    )
    expect(result.map((i) => i.id)).toEqual(['a'])
  })

  it('picks the first available seat and preselects its unit (second member first)', () => {
    const [a, b] = makeUnit('a', 'b')
    const result = pickFirstAvailablePair(
      [
        { itemId: 'b', available: true },
        { itemId: 'a', available: true },
      ],
      [a, b],
    )
    expect(result.map((i) => i.id).sort()).toEqual(['a', 'b'])
  })
})

describe('inventoryAnchor', () => {
  const seat = (lat: number, lng: number) => ({ locationLat: String(lat), locationLng: String(lng) })

  it('lands on a REAL seat, not the bounding-box centre, when the beach curves', () => {
    // A crescent: seats along an arc, bbox centre in the empty middle (the sea).
    // This is the Alcúdia shape — the old bbox-centre answer opened the map at
    // seat-level zoom over open water with every seat culled.
    const arc = Array.from({ length: 9 }, (_, i) => {
      const a = (i / 8) * Math.PI
      return seat(39.8 + 0.02 * Math.sin(a), 3.1 + 0.02 * Math.cos(a))
    })

    const anchor = inventoryAnchor(arc)!
    const isRealSeat = arc.some(
      (s) => Number(s.locationLat) === anchor.lat && Number(s.locationLng) === anchor.lng,
    )

    expect(isRealSeat).toBe(true)
    // And it picks a mid-arc seat, not an end: the "middle of the site" intent survives.
    expect(anchor.lat).toBeCloseTo(39.82, 2)
  })

  it('returns the centre seat of a compact grid — behaviour the common site keeps', () => {
    const grid = [seat(39.8, 3.1), seat(39.8004, 3.1), seat(39.8002, 3.1002)]

    expect(inventoryAnchor(grid)).toEqual({ lat: 39.8002, lng: 3.1002 })
  })

  it('ignores seats with unparseable coordinates rather than poisoning the centre', () => {
    const items = [seat(39.8, 3.1), { locationLat: undefined, locationLng: undefined }]

    expect(inventoryAnchor(items)).toEqual({ lat: 39.8, lng: 3.1 })
  })

  it('returns null for an empty inventory so the caller can fall back to the site pin', () => {
    expect(inventoryAnchor([])).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// pickRandomAvailablePair — the on-open preselection
// ────────────────────────────────────────────────────────────────────────────
describe('pickRandomAvailablePair', () => {
  const avail = (ids: string[], booked: string[] = []) =>
    ids.map((itemId) => ({ itemId, available: !booked.includes(itemId) }))
  const [a1, a2] = makeUnit('a1', 'a2')
  const [b1, b2] = makeUnit('b1', 'b2')
  const [c1, c2] = makeUnit('c1', 'c2')
  const inventory = [a1, a2, b1, b2, c1, c2]
  const ids = inventory.map((i) => i.id)

  it('selects a whole free pair — both beds of one unit', () => {
    const pick = pickRandomAvailablePair(avail(ids), inventory, () => 0.5)
    expect(pick).toHaveLength(2)
    expect(new Set(pick.map((i) => i.sunbedGroupId)).size).toBe(1)
  })

  it('spreads picks across units instead of always offering the first one', () => {
    const picked = new Set(
      [0, 0.4, 0.8].map((r) => pickRandomAvailablePair(avail(ids), inventory, () => r)[0]!.sunbedGroupId),
    )
    expect(picked.size).toBe(3)
  })

  it('prefers a fully free pair over a half-booked unit', () => {
    // a and b are half booked; c is the only whole pair — every roll must land on it
    for (const r of [0, 0.5, 0.99]) {
      const pick = pickRandomAvailablePair(avail(ids, ['a2', 'b1']), inventory, () => r)
      expect(pick.map((i) => i.id).sort()).toEqual(['c1', 'c2'])
    }
  })

  it('falls back to the free bed of a half-booked unit — never a bed someone holds', () => {
    const pick = pickRandomAvailablePair(avail(['a1', 'a2'], ['a2']), [a1, a2], () => 0)
    expect(pick.map((i) => i.id)).toEqual(['a1'])
  })

  it('returns nothing when the beach is full', () => {
    expect(pickRandomAvailablePair(avail(ids, ids), inventory, () => 0)).toEqual([])
  })

  it('stays in range for a random source that returns its upper bound', () => {
    expect(pickRandomAvailablePair(avail(ids), inventory, () => 1)).toHaveLength(2)
  })
})

describe('selectionCenter', () => {
  it('is the midpoint of the selected beds, ignoring unplaced ones', () => {
    expect(
      selectionCenter([
        { locationLat: '36.0', locationLng: '-4.0' },
        { locationLat: '36.2', locationLng: '-4.2' },
        {},
      ]),
    ).toEqual({ lat: 36.1, lng: -4.1 })
  })

  it('is null when nothing is placed', () => {
    expect(selectionCenter([{}])).toBeNull()
  })
})
