import { describe, it, expect } from 'vitest'
import { computeSeatLabels, formatSeatLabel, type SeatLabelItem } from './seat-label'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a (parcel, row, seat) triple into the InventoryItem.number format.
 * number = parcel * 10000 + row * 100 + seatIdx
 */
function encodeNumber(parcel: number, row: number, seatIdx: number): number {
  return parcel * 10000 + row * 100 + seatIdx
}

function item(
  id: string,
  parcel: number,
  row: number,
  seatIdx: number,
  sunbedGroupId: string | null = null,
): SeatLabelItem {
  return {
    id,
    number: encodeNumber(parcel, row, seatIdx),
    group: parcel,
    sunbedGroupId,
  }
}

// ---------------------------------------------------------------------------
// computeSeatLabels
// ---------------------------------------------------------------------------

describe('computeSeatLabels — two 2-member groups in one row', () => {
  // Parcel 1, row 3: group A (seats 1,2) and group B (seats 3,4)
  const items: SeatLabelItem[] = [
    item('a1', 1, 3, 1, 'grpA'),
    item('a2', 1, 3, 2, 'grpA'),
    item('b1', 1, 3, 3, 'grpB'),
    item('b2', 1, 3, 4, 'grpB'),
  ]

  it('assigns group A as groupSeq 1 with members 1 and 2', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('a1')).toBe('1-301-1')
    expect(labels.get('a2')).toBe('1-301-2')
  })

  it('assigns group B as groupSeq 2 with members 1 and 2', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('b1')).toBe('1-302-1')
    expect(labels.get('b2')).toBe('1-302-2')
  })
})

describe('computeSeatLabels — singleton among groups', () => {
  // Parcel 2, row 1: a 2-member group (seats 1,2), a solo ungrouped seat
  // (seat 3), and another 2-member group (seats 4,5)
  const items: SeatLabelItem[] = [
    item('g1a', 2, 1, 1, 'grp1'),
    item('g1b', 2, 1, 2, 'grp1'),
    item('solo', 2, 1, 3, null),  // ungrouped — should get its own groupSeq
    item('g2a', 2, 1, 4, 'grp2'),
    item('g2b', 2, 1, 5, 'grp2'),
  ]

  it('first group is groupSeq 1', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('g1a')).toBe('2-101-1')
    expect(labels.get('g1b')).toBe('2-101-2')
  })

  it('singleton gets its own groupSeq slot (2), member 1', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('solo')).toBe('2-102-1')
  })

  it('second group is groupSeq 3', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('g2a')).toBe('2-103-1')
    expect(labels.get('g2b')).toBe('2-103-2')
  })
})

describe('computeSeatLabels — multiple rows', () => {
  // Parcel 1, rows 1 and 2 — each with a single 2-member group
  const items: SeatLabelItem[] = [
    item('r1a', 1, 1, 1, 'grpRow1'),
    item('r1b', 1, 1, 2, 'grpRow1'),
    item('r2a', 1, 2, 1, 'grpRow2'),
    item('r2b', 1, 2, 2, 'grpRow2'),
  ]

  it('row 1 items get row component 1', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('r1a')).toBe('1-101-1')
    expect(labels.get('r1b')).toBe('1-101-2')
  })

  it('row 2 items get row component 2', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('r2a')).toBe('1-201-1')
    expect(labels.get('r2b')).toBe('1-201-2')
  })
})

describe('computeSeatLabels — multiple parcels', () => {
  // Parcel 1 and parcel 2, each with one item in row 1
  const items: SeatLabelItem[] = [
    item('p1', 1, 1, 1, null),
    item('p2', 2, 1, 1, null),
  ]

  it('parcel 1 item carries parcel 1 prefix', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('p1')).toBe('1-101-1')
  })

  it('parcel 2 item carries parcel 2 prefix', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('p2')).toBe('2-101-1')
  })
})

describe('computeSeatLabels — groupSeq ordered by min seatIdx not insertion order', () => {
  // Present items in reverse seat order; group ordering must still be left→right
  const items: SeatLabelItem[] = [
    item('b2', 3, 5, 4, 'grpB'),
    item('b1', 3, 5, 3, 'grpB'),
    item('a2', 3, 5, 2, 'grpA'),
    item('a1', 3, 5, 1, 'grpA'),
  ]

  it('grpA (min seatIdx 1) is groupSeq 1 regardless of insertion order', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('a1')).toBe('3-501-1')
    expect(labels.get('a2')).toBe('3-501-2')
  })

  it('grpB (min seatIdx 3) is groupSeq 2', () => {
    const labels = computeSeatLabels(items)
    expect(labels.get('b1')).toBe('3-502-1')
    expect(labels.get('b2')).toBe('3-502-2')
  })
})

describe('computeSeatLabels — empty input', () => {
  it('returns an empty map', () => {
    const labels = computeSeatLabels([])
    expect(labels.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// formatSeatLabel
// ---------------------------------------------------------------------------

describe('formatSeatLabel', () => {
  it('returns the full label by default (parcel: true)', () => {
    expect(formatSeatLabel('2-302-1')).toBe('2-302-1')
  })

  it('strips the parcel prefix when parcel: false', () => {
    expect(formatSeatLabel('2-302-1', { parcel: false })).toBe('302-1')
  })

  it('strips single-digit parcel prefix', () => {
    expect(formatSeatLabel('1-101-2', { parcel: false })).toBe('101-2')
  })

  it('returns empty string for null label', () => {
    expect(formatSeatLabel(null)).toBe('')
    expect(formatSeatLabel(null, { parcel: false })).toBe('')
  })

  it('returns empty string for empty string label', () => {
    expect(formatSeatLabel('')).toBe('')
    expect(formatSeatLabel('', { parcel: false })).toBe('')
  })

  it('returns empty string for undefined label', () => {
    expect(formatSeatLabel(undefined)).toBe('')
  })

  it('handles label with no dash gracefully', () => {
    expect(formatSeatLabel('nodash', { parcel: false })).toBe('nodash')
  })
})
