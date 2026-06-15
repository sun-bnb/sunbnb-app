import { describe, it, expect } from 'vitest'
import { computeChunkSize, chunkRows } from './grid-helpers'
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
