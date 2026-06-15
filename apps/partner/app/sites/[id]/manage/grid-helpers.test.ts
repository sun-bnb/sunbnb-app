import { describe, it, expect } from 'vitest'
import {
  computeChunkSize, chunkRows, groupExtraSeatLabel,
  buildDisplayColumns, chunkDisplayColumns,
} from './grid-helpers'
import type { InventoryItem } from '@/types/shared'

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeItem(number: number): InventoryItem {
  return { id: `id-${number}`, number, group: 1, status: 'active' } as InventoryItem
}

function makePositions(nums: number[]): Record<number, InventoryItem> {
  return Object.fromEntries(nums.map(n => [n, makeItem(n)]))
}

// ── computeChunkSize ─────────────────────────────────────────────────────────

describe('computeChunkSize', () => {
  it('returns 6 for a 375px phone (standard portrait size)', () => {
    // available = 375 - 36 (label) - 4 (gap) = 335
    // n = floor((335 + 4) / (44 + 4)) = floor(339 / 48) = 7
    // even = 7 - 1 = 6
    expect(computeChunkSize(375)).toBe(6)
  })

  it('returns at least 2 for very narrow containers', () => {
    expect(computeChunkSize(50)).toBe(2)
    expect(computeChunkSize(0)).toBe(2)
  })

  it('always returns an even number', () => {
    for (const w of [300, 375, 414, 768, 1024, 1280]) {
      expect(computeChunkSize(w) % 2, `width ${w}`).toBe(0)
    }
  })

  it('returns more columns on wider screens', () => {
    expect(computeChunkSize(1024)).toBeGreaterThan(computeChunkSize(375))
  })

  it('respects custom rowLabelWidth option', () => {
    // Wider label → fewer beds fit
    const narrow = computeChunkSize(375, { rowLabelWidth: 80 })
    const wide = computeChunkSize(375, { rowLabelWidth: 36 })
    expect(narrow).toBeLessThanOrEqual(wide)
  })
})

// ── chunkRows ────────────────────────────────────────────────────────────────

describe('chunkRows', () => {
  it('returns empty array for empty rowEntries', () => {
    expect(chunkRows([], 10)).toEqual([])
  })

  it('returns a single section when positions fit in one chunk', () => {
    const rows: [number, Record<number, InventoryItem>][] = [
      [1, makePositions([1, 2, 3, 4])],
      [2, makePositions([1, 2, 3, 4])],
    ]
    const sections = chunkRows(rows, 10)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.rows).toHaveLength(2)
  })

  it('produces the correct number of sections for 50 positions with chunkSize 6', () => {
    const positions = makePositions(Array.from({ length: 50 }, (_, i) => i + 1))
    const rows: [number, Record<number, InventoryItem>][] = [[1, positions]]
    // ceil(50 / 6) = 9 sections (8 full + 1 with 2 positions padded to 6)
    expect(chunkRows(rows, 6)).toHaveLength(9)
  })

  it('each section always has exactly chunkSize cells per row', () => {
    const positions = makePositions([1, 2, 3, 4, 5])
    const rows: [number, Record<number, InventoryItem>][] = [[1, positions]]
    const sections = chunkRows(rows, 4)
    for (const section of sections) {
      expect(section.rows[0]!.cells).toHaveLength(4)
    }
  })

  it('positions are ordered ASCENDING by default (smallest displayed first / leftmost)', () => {
    const positions = makePositions([1, 2, 3, 4, 5, 6, 7, 8])
    const rows: [number, Record<number, InventoryItem>][] = [[1, positions]]
    const sections = chunkRows(rows, 4)
    // Section 0 display: [1, 2, 3, 4]
    const cells0 = sections[0]!.rows[0]!.cells
    expect(cells0[0]!.number).toBe(1)
    expect(cells0[1]!.number).toBe(2)
    expect(cells0[2]!.number).toBe(3)
    expect(cells0[3]!.number).toBe(4)
    // Section 1 display: [5, 6, 7, 8]
    const cells1 = sections[1]!.rows[0]!.cells
    expect(cells1[0]!.number).toBe(5)
    expect(cells1[3]!.number).toBe(8)
  })

  it('reversed=true orders DESCENDING (largest displayed first / leftmost)', () => {
    const positions = makePositions([1, 2, 3, 4, 5, 6, 7, 8])
    const rows: [number, Record<number, InventoryItem>][] = [[1, positions]]
    const sections = chunkRows(rows, 4, true)
    // Section 0 display: [8, 7, 6, 5]
    const cells0 = sections[0]!.rows[0]!.cells
    expect(cells0[0]!.number).toBe(8)
    expect(cells0[3]!.number).toBe(5)
    // Section 1 display: [4, 3, 2, 1]
    const cells1 = sections[1]!.rows[0]!.cells
    expect(cells1[0]!.number).toBe(4)
    expect(cells1[3]!.number).toBe(1)
  })

  it('last chunk is padded to chunkSize with null spacers', () => {
    const positions = makePositions([1, 2, 3, 4, 5])
    const rows: [number, Record<number, InventoryItem>][] = [[1, positions]]
    const sections = chunkRows(rows, 4)
    // Ascending: [1,2,3,4], [5,_,_,_]
    expect(sections).toHaveLength(2)
    const last = sections[1]!.rows[0]!.cells
    expect(last[0]!.number).toBe(5) // position 5 exists
    expect(last[1]).toBeNull()       // spacer
    expect(last[2]).toBeNull()       // spacer
    expect(last[3]).toBeNull()       // spacer
  })

  it('fills missing positions with null (sparse rows)', () => {
    // Row 1: positions 1-4 all present; row 2: only positions 1 and 3
    const rows: [number, Record<number, InventoryItem>][] = [
      [1, makePositions([1, 2, 3, 4])],
      [2, makePositions([1, 3])],
    ]
    const sections = chunkRows(rows, 4)
    expect(sections).toHaveLength(1)
    // Ascending display: [1, 2, 3, 4]
    const row2cells = sections[0]!.rows[1]!.cells
    expect(row2cells[0]!.number).toBe(1)  // pos 1, present
    expect(row2cells[1]).toBeNull()       // pos 2, missing in row 2
    expect(row2cells[2]!.number).toBe(3)  // pos 3, present
    expect(row2cells[3]).toBeNull()       // pos 4, missing in row 2
  })

  it('section minPos and maxPos reflect the actual position range in display order', () => {
    const positions = makePositions(Array.from({ length: 20 }, (_, i) => i + 1))
    const rows: [number, Record<number, InventoryItem>][] = [[1, positions]]
    const sections = chunkRows(rows, 10)
    expect(sections).toHaveLength(2)
    // Section 0 covers positions 1–10 (displayed left)
    expect(sections[0]!.minPos).toBe(1)
    expect(sections[0]!.maxPos).toBe(10)
    // Section 1 covers positions 11–20 (displayed right)
    expect(sections[1]!.minPos).toBe(11)
    expect(sections[1]!.maxPos).toBe(20)
  })

  it('preserves row ordering (rowNum order matches input order)', () => {
    const rows: [number, Record<number, InventoryItem>][] = [
      [1, makePositions([1])],
      [2, makePositions([1])],
      [3, makePositions([1])],
    ]
    const sections = chunkRows(rows, 2)
    expect(sections[0]!.rows.map(r => r.rowNum)).toEqual([1, 2, 3])
  })

  it('pair boundary is never split: chunks start on a pair (odd primary, even partner)', () => {
    // Positions 1-10 ascending: 1,2,3,4,5,6,7,8,9,10
    // chunkSize=4: chunk0=[1,2,3,4], chunk1=[5,6,7,8], chunk2=[9,10,_,_]
    // 1 (odd) + 2 (even) = pair ✓, 3 (odd) + 4 (even) = pair ✓
    // No even-number starts a chunk without its odd partner before it
    const positions = makePositions(Array.from({ length: 10 }, (_, i) => i + 1))
    const rows: [number, Record<number, InventoryItem>][] = [[1, positions]]
    const sections = chunkRows(rows, 4)
    // Each chunk's first and second items should be odd+even (a visual pair start)
    for (const section of sections) {
      const cells = section.rows[0]!.cells.filter(c => c !== null)
      if (cells.length >= 2) {
        expect(cells[0]!.number % 2).toBe(1) // first is odd (pair primary)
        expect(cells[1]!.number % 2).toBe(0) // second is even (pair partner)
      }
    }
  })
})

// ── groupExtraSeatLabel ──────────────────────────────────────────────────────

describe('groupExtraSeatLabel', () => {
  // A group with regular members "1-103-1" / "1-103-2" (parcel 1, row 1, unit 03).
  const reg1 = { id: 'r1', number: 103, seatLabel: '1-103-1', status: 'active' }
  const reg2 = { id: 'r2', number: 104, seatLabel: '1-103-2', status: 'active' }
  // Group-extra pool seats live in the parcel-1 pool band (1*10000 + 9900 + seq).
  const extra1 = { id: 'e1', number: 19901, status: 'pool' }
  const extra2 = { id: 'e2', number: 19902, status: 'pool' }

  it('labels the first extra as the next group member (103-3)', () => {
    expect(groupExtraSeatLabel(extra1, [reg1, reg2])).toBe('103-3')
  })

  it('numbers multiple extras sequentially by ascending seat number', () => {
    expect(groupExtraSeatLabel(extra1, [reg1, reg2, extra2])).toBe('103-3')
    expect(groupExtraSeatLabel(extra2, [reg1, reg2, extra1])).toBe('103-4')
  })

  it('derives the member offset from the highest labeled regular member, not the count', () => {
    // A single labeled member "1-103-2" (member 2) → next extra is member 3, not 2.
    expect(groupExtraSeatLabel(extra1, [reg2])).toBe('103-3')
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

// ── chunkDisplayColumns ──────────────────────────────────────────────────────

describe('chunkDisplayColumns', () => {
  it('keeps everything in one section when it fits (padded to chunkSize)', () => {
    const cols = buildDisplayColumns([1, 2, 3, 4], new Map([[4, 1]]))
    const sections = chunkDisplayColumns(cols, 10)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.minPos).toBe(1)
    expect(sections[0]!.maxPos).toBe(4)
    // 4 seats + 1 extra = 5 seat columns → padded with 5 'pad' columns up to 10.
    expect(sections[0]!.columns.filter(c => c.kind === 'pad')).toHaveLength(5)
  })

  it('derives min/max position from pos columns only, ignoring extras', () => {
    const cols = buildDisplayColumns([1, 2, 3, 4, 5, 6], new Map([[6, 2]]))
    const [s] = chunkDisplayColumns(cols, 10)
    expect(s!.maxPos).toBe(6) // extra columns do not bump maxPos past position 6
  })

  it('counts only seat columns toward chunkSize, trims edge gaps, pads the short last section', () => {
    const cols = buildDisplayColumns([1, 2, 3, 4, 5, 6], new Map())
    const sections = chunkDisplayColumns(cols, 4)
    expect(sections).toHaveLength(2)
    // First section: positions 1–4, exactly chunkSize seats, no padding needed.
    expect(sections[0]!.columns.filter(c => c.kind === 'pos')).toHaveLength(4)
    expect(sections[0]!.columns.filter(c => c.kind === 'pad')).toHaveLength(0)
    // No section begins or ends on a gap separator.
    expect(sections[0]!.columns[0]!.kind).not.toBe('gap')
    expect(sections[0]!.columns[sections[0]!.columns.length - 1]!.kind).not.toBe('gap')
    // Last section: 2 real seats padded up to chunkSize (4) with 2 'pad' columns.
    expect(sections[1]!.columns.filter(c => c.kind === 'pos')).toHaveLength(2)
    expect(sections[1]!.columns.filter(c => c.kind === 'pad')).toHaveLength(2)
  })
})
