import { describe, it, expect } from 'vitest'
import { computeChairPositions } from './chair-glyphs'

// We classify a chair as belonging to a "side" by which axis dominates its
// offset from the table centre. Tolerance handles the chair half-width that's
// added on the perpendicular axis.
type Side = 'top' | 'bottom' | 'left' | 'right'

function classify(p: { x: number; y: number }): Side {
  if (Math.abs(p.x) > Math.abs(p.y)) return p.x > 0 ? 'right' : 'left'
  return p.y > 0 ? 'bottom' : 'top'
}

function tally(positions: { x: number; y: number }[]) {
  const counts: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const p of positions) counts[classify(p)]++
  return counts
}

describe('computeChairPositions', () => {
  it('returns no chairs for bar tables', () => {
    expect(computeChairPositions('bar', 0.6, 0.6, 4)).toEqual([])
  })

  it('returns no chairs for zero capacity', () => {
    expect(computeChairPositions('round', 1.2, 1.2, 0)).toEqual([])
  })

  it('places one chair per side on a square 4-top', () => {
    const positions = computeChairPositions('square', 1.2, 1.2, 4)
    expect(positions).toHaveLength(4)
    const counts = tally(positions)
    expect(counts).toEqual({ top: 1, right: 1, bottom: 1, left: 1 })
  })

  it('doubles up evenly on a square 8-top', () => {
    const positions = computeChairPositions('square', 1.2, 1.2, 8)
    const counts = tally(positions)
    expect(counts).toEqual({ top: 2, right: 2, bottom: 2, left: 2 })
  })

  it('puts both pairs on long sides for a 4-top horizontal rect', () => {
    const positions = computeChairPositions('rect', 1.6, 0.8, 4)
    const counts = tally(positions)
    expect(counts.top).toBe(2)
    expect(counts.bottom).toBe(2)
    expect(counts.left + counts.right).toBe(0)
  })

  it('adds a head chair for an odd-capacity rect', () => {
    const positions = computeChairPositions('rect', 1.6, 0.8, 5)
    const counts = tally(positions)
    expect(counts.top).toBe(2)
    expect(counts.bottom).toBe(2)
    // Single head seat on one short side — left or right, doesn't matter which
    expect(counts.left + counts.right).toBe(1)
  })

  it('places all booth chairs on the open long side (horizontal)', () => {
    const positions = computeChairPositions('booth', 1.6, 0.8, 4)
    const counts = tally(positions)
    // Wall is on bottom; chairs should be on top
    expect(counts.top).toBe(4)
    expect(counts.bottom).toBe(0)
    expect(counts.left + counts.right).toBe(0)
  })

  it('places all booth chairs on the open long side (vertical)', () => {
    const positions = computeChairPositions('booth', 0.8, 1.6, 4)
    const counts = tally(positions)
    expect(counts.left).toBe(4)
    expect(counts.right).toBe(0)
    expect(counts.top + counts.bottom).toBe(0)
  })

  it('distributes a 6-top oval evenly around the perimeter', () => {
    const positions = computeChairPositions('oval', 1.6, 1.0, 6)
    expect(positions).toHaveLength(6)
    // The angular distribution should have one chair within ~30° of each
    // 60° step (no clustering). Sanity check: angles span the full circle.
    const angles = positions.map((p) => Math.atan2(p.y, p.x)).sort((a, b) => a - b)
    for (let i = 1; i < angles.length; i++) {
      const gap = angles[i]! - angles[i - 1]!
      expect(gap).toBeGreaterThan(Math.PI / 6) // > 30°
      expect(gap).toBeLessThan(Math.PI) // < 180°
    }
  })
})
