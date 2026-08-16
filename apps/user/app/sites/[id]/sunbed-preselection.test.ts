/**
 * Unit tests for the pair-preselection pure helpers exported from SunbedSelection.tsx.
 * These are requirements-driven: they fail when the bug exists (wrong pair resolution),
 * not merely validations of the current implementation.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveSelectionSet,
  pickFirstAvailablePair,
} from '@/app/sites/[id]/sunbed-preselection'
import type { InventoryItem } from '@/app/sites/types'

// Minimal factory for InventoryItem — only fields the helpers use.
function makeItem(overrides: Partial<InventoryItem> & { id: string }): InventoryItem {
  return {
    number: 1,
    group: 1,
    status: 'active',
    reservations: [],
    pair: null,
    pairedBy: null,
    sunbedGroupId: null,
    sunbedGroup: null,
    ...overrides,
  }
}

/**
 * Two seats forming one UNIT — sharing a SunbedGroup, which is how every row in
 * dev, test and production is actually shaped (track 021 P0/P1). The legacy
 * pair/pairedBy self-relation it replaces is retired.
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

  // Track 021 P1 contract: grouping is the ONLY pairing representation. A row
  // carrying only the retired self-relation resolves to itself — verified safe
  // because no such row exists in dev, test or production.
  it('does NOT resolve a legacy pair/pairedBy without a group', () => {
    const secondary = makeItem({ id: 'b' })
    const primary = makeItem({ id: 'a', pair: { id: 'b' } })
    const result = resolveSelectionSet(primary, [primary, secondary])
    expect(result.map((i) => i.id)).toEqual(['a'])
  })

  it('returns only the item when pair pointer exists but partner is missing from inventory', () => {
    const item = makeItem({ id: 'a', pair: { id: 'missing' } })
    const result = resolveSelectionSet(item, [item])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('resolves via sunbedGroup when group is present (supersedes pair pointer)', () => {
    const itemA = makeItem({
      id: 'a',
      sunbedGroupId: 'g1',
      sunbedGroup: { items: [{ id: 'a' }, { id: 'b' }] },
      pair: { id: 'c' }, // pair pointer present but should be ignored
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
