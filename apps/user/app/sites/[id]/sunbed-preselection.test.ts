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

  it('resolves pair from the PRIMARY (forward direction: item.pair)', () => {
    // Primary 'a' → pair → secondary 'b'
    const secondary = makeItem({ id: 'b' })
    const primary = makeItem({ id: 'a', pair: { id: 'b' } })
    const inventory = [primary, secondary]

    const result = resolveSelectionSet(primary, inventory)
    const ids = result.map((i) => i.id).sort()
    expect(ids).toEqual(['a', 'b'])
  })

  it('resolves pair from the SECONDARY (back direction: item.pairedBy)', () => {
    // Secondary 'b' holds pairedBy → primary 'a'
    const primary = makeItem({ id: 'a' })
    const secondary = makeItem({ id: 'b', pairedBy: { id: 'a' } })
    const inventory = [primary, secondary]

    // Starting from the secondary should still give both items.
    const result = resolveSelectionSet(secondary, inventory)
    const ids = result.map((i) => i.id).sort()
    expect(ids).toEqual(['a', 'b'])
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

  it('picks first available PRIMARY and resolves both pair sides (forward direction)', () => {
    const secondary = makeItem({ id: 'b' })
    const primary = makeItem({ id: 'a', pair: { id: 'b' } })
    const inventory = [primary, secondary]

    // Availability lists primary first
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

  it('picks first available SECONDARY and resolves both pair sides (back direction)', () => {
    const primary = makeItem({ id: 'a' })
    const secondary = makeItem({ id: 'b', pairedBy: { id: 'a' } })
    const inventory = [primary, secondary]

    // Availability lists secondary first (primary is unavailable)
    const result = pickFirstAvailablePair(
      [
        { itemId: 'a', available: false },
        { itemId: 'b', available: true },
      ],
      inventory,
    )
    const ids = result.map((i) => i.id).sort()
    // Should include BOTH even though we found secondary first
    expect(ids).toEqual(['a', 'b'])
  })
})
