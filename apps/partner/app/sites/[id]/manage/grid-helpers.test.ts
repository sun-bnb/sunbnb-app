import { describe, it, expect } from 'vitest'
import {
  groupExtraSeatLabel,
  buildDisplayColumns,
} from './grid-helpers'
import type { InventoryItem } from '@/types/shared'

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeItem(number: number): InventoryItem {
  return { id: `id-${number}`, number, group: 1, status: 'active' } as InventoryItem
}

// ── groupExtraSeatLabel ──────────────────────────────────────────────────────

describe('groupExtraSeatLabel', () => {
  // A group with regular members "1-103-1" / "1-103-2" (parcel 1, row 1, unit 03).
  const reg1 = { id: 'r1', number: 103, seatLabel: '1-103-1', status: 'active' }
  const reg2 = { id: 'r2', number: 104, seatLabel: '1-103-2', status: 'active' }
  // Group-extra pool seats live in the parcel-1 pool band (1*10000 + 9900 + seq).
  const extra1 = { id: 'e1', number: 19901, status: 'pool' }
  const extra2 = { id: 'e2', number: 19902, status: 'pool' }

  // Displayed parcel-stripped, so the unit reads `{row}-{seq}` and the extra
  // takes the next member: regulars 1-3-1 / 1-3-2 → first extra 1-3-3.
  it('labels the first extra as the next group member (1-3-3)', () => {
    expect(groupExtraSeatLabel(extra1, [reg1, reg2])).toBe('1-3-3')
  })

  it('numbers multiple extras sequentially by ascending seat number', () => {
    expect(groupExtraSeatLabel(extra1, [reg1, reg2, extra2])).toBe('1-3-3')
    expect(groupExtraSeatLabel(extra2, [reg1, reg2, extra1])).toBe('1-3-4')
  })

  it('derives the member offset from the highest labeled regular member, not the count', () => {
    // A single labeled member "1-103-2" (member 2) → next extra is member 3, not 2.
    expect(groupExtraSeatLabel(extra1, [reg2])).toBe('1-3-3')
  })

  it('falls back to "+N" when the group has no labeled regular member', () => {
    const unlabeled = { id: 'r3', number: 105, seatLabel: null, status: 'active' }
    expect(groupExtraSeatLabel(extra1, [unlabeled])).toBe('+1')
    expect(groupExtraSeatLabel(extra2, [unlabeled, extra1])).toBe('+2')
  })
})

// ── buildDisplayColumns ──────────────────────────────────────────────────────

describe('buildDisplayColumns', () => {
  it('inserts a gap separator after each pair (even position), but not trailing', () => {
    const cols = buildDisplayColumns([1, 2, 3, 4], new Map())
    expect(cols).toEqual([
      { kind: 'pos', pos: 1 },
      { kind: 'pos', pos: 2 },
      { kind: 'gap' },
      { kind: 'pos', pos: 3 },
      { kind: 'pos', pos: 4 },
    ])
  })

  it('inserts extra columns after the position, before the group gap', () => {
    // Group at positions 3,4 has 2 extras → 2 extra columns after position 4,
    // and (since position 4 is not the last) no trailing gap here.
    const cols = buildDisplayColumns([1, 2, 3, 4], new Map([[4, 2]]))
    expect(cols).toEqual([
      { kind: 'pos', pos: 1 },
      { kind: 'pos', pos: 2 },
      { kind: 'gap' },
      { kind: 'pos', pos: 3 },
      { kind: 'pos', pos: 4 },
      { kind: 'extra', afterPos: 4, slot: 0 },
      { kind: 'extra', afterPos: 4, slot: 1 },
    ])
  })

  it('places the group gap AFTER a group\'s extras', () => {
    // 6 positions, group at 3,4 has 1 extra → extra then gap before position 5.
    const cols = buildDisplayColumns([1, 2, 3, 4, 5, 6], new Map([[4, 1]]))
    expect(cols).toEqual([
      { kind: 'pos', pos: 1 },
      { kind: 'pos', pos: 2 },
      { kind: 'gap' },
      { kind: 'pos', pos: 3 },
      { kind: 'pos', pos: 4 },
      { kind: 'extra', afterPos: 4, slot: 0 },
      { kind: 'gap' },
      { kind: 'pos', pos: 5 },
      { kind: 'pos', pos: 6 },
    ])
  })

  it('dedupes and sorts positions before building', () => {
    const cols = buildDisplayColumns([4, 1, 2, 2, 3], new Map())
    expect(cols.filter(c => c.kind === 'pos').map(c => (c as { pos: number }).pos)).toEqual([1, 2, 3, 4])
  })

  it('reverses the whole column list (extras + gaps stay with their group) when reversed', () => {
    const cols = buildDisplayColumns([1, 2, 3, 4], new Map([[4, 1]]), true)
    expect(cols).toEqual([
      { kind: 'extra', afterPos: 4, slot: 0 },
      { kind: 'pos', pos: 4 },
      { kind: 'pos', pos: 3 },
      { kind: 'gap' },
      { kind: 'pos', pos: 2 },
      { kind: 'pos', pos: 1 },
    ])
  })
})
