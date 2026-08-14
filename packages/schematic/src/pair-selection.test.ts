/**
 * Requirements tests for buildPairedSelectedIds (track 020 P3).
 *
 * These encode the semantics of the ORIGINAL inline expression in
 * SchematicRenderer —
 *
 *   item.groupId && items.some(o =>
 *     o.id !== item.id && o.groupId === item.groupId &&
 *     (editingItemId === o.id || selectedItemIds.has(o.id)))
 *
 * — so the O(n) replacement can be proven equivalent, including the
 * self-exclusion subtlety that makes the naive "group has any selected
 * member" precompute WRONG. A property check at the end compares the two
 * implementations directly over a generated fixture.
 */

import { describe, it, expect } from 'vitest'
import { buildPairedSelectedIds } from './pair-selection'

type Item = { id: string; groupId?: string | null }

/** The original O(n²) expression, verbatim, as the oracle. */
function oracle(items: Item[], selected: Set<string>, editing: string | null): Set<string> {
  const out = new Set<string>()
  for (const item of items) {
    const paired = !!(
      item.groupId &&
      items.some(
        (o) =>
          o.id !== item.id &&
          o.groupId === item.groupId &&
          (editing === o.id || selected.has(o.id)),
      )
    )
    if (paired) out.add(item.id)
  }
  return out
}

const pair = (g: string, a: string, b: string): Item[] => [
  { id: a, groupId: g },
  { id: b, groupId: g },
]

describe('buildPairedSelectedIds', () => {
  it('selecting one member marks its partner, not itself', () => {
    const items = pair('g1', 'a', 'b')
    const result = buildPairedSelectedIds(items, new Set(['a']), null)
    expect(result.has('b')).toBe(true)
    expect(result.has('a')).toBe(false)
  })

  it('selecting both members marks both (each has another selected member)', () => {
    const items = pair('g1', 'a', 'b')
    const result = buildPairedSelectedIds(items, new Set(['a', 'b']), null)
    expect(result).toEqual(new Set(['a', 'b']))
  })

  it('an editing member counts like a selected one', () => {
    const items = pair('g1', 'a', 'b')
    const result = buildPairedSelectedIds(items, new Set(), 'a')
    expect(result.has('b')).toBe(true)
    expect(result.has('a')).toBe(false)
  })

  it('ungrouped items are never paired-selected, even when selected', () => {
    const items: Item[] = [{ id: 'solo' }, { id: 'solo2', groupId: null }]
    const result = buildPairedSelectedIds(items, new Set(['solo', 'solo2']), 'solo')
    expect(result.size).toBe(0)
  })

  it('groups are isolated — selection in one group does not leak into another', () => {
    const items = [...pair('g1', 'a', 'b'), ...pair('g2', 'c', 'd')]
    const result = buildPairedSelectedIds(items, new Set(['a']), null)
    expect(result).toEqual(new Set(['b']))
  })

  it('a single-member group never pairs with itself', () => {
    const items: Item[] = [{ id: 'only', groupId: 'g1' }]
    const result = buildPairedSelectedIds(items, new Set(['only']), 'only')
    expect(result.size).toBe(0)
  })

  it('selection ids not present in items are ignored', () => {
    const items = pair('g1', 'a', 'b')
    const result = buildPairedSelectedIds(items, new Set(['ghost']), null)
    expect(result.size).toBe(0)
  })

  it('matches the original O(n²) expression over a generated fixture', () => {
    // Deterministic pseudo-random fixture: 200 items, ~40 groups of 1-4
    // members, varying selection/editing states. No Math.random — the fixture
    // must be identical on every run.
    const items: Item[] = []
    for (let i = 0; i < 200; i++) {
      const grouped = i % 5 !== 0
      items.push({ id: `i${i}`, groupId: grouped ? `g${i % 40}` : null })
    }
    const selected = new Set(items.filter((_, i) => i % 3 === 0).map((x) => x.id))
    for (const editing of [null, 'i7', 'i0', 'i199']) {
      expect(buildPairedSelectedIds(items, selected, editing)).toEqual(
        oracle(items, selected, editing),
      )
    }
  })
})
