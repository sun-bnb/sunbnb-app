/**
 * Unit ADDRESSES (track 021) — `{parcel}-{row}-{seq}`, the position that IS the
 * unit's identity, derived in `computeSeatLabelsWithUnits`.
 *
 * These test the rules that are NOT visible in the labels, which is why they
 * live apart from `seat-label.test.ts`: which seats a unit's position may be
 * read from, when the position must be refused rather than guessed, and that
 * two units in one row can never end up claiming a single ordinal.
 */

import { describe, it, expect } from 'vitest'
import {
  computeSeatLabelsWithUnits,
  parseSeatLabel,
  formatSeatId,
  type SeatLabelItem,
} from './seat-label'

/** number = parcel * 10000 + row * 100 + seatIdx */
function encodeNumber(parcel: number, row: number, seatIdx: number): number {
  return parcel * 10000 + row * 100 + seatIdx
}

function seat(
  id: string,
  parcel: number,
  row: number,
  seatIdx: number,
  sunbedGroupId: string | null,
  extra: Partial<SeatLabelItem> = {},
): SeatLabelItem {
  return {
    id,
    number: encodeNumber(parcel, row, seatIdx),
    group: parcel,
    sunbedGroupId,
    ...extra,
  }
}

const addressesOf = (items: SeatLabelItem[]) => computeSeatLabelsWithUnits(items).unitAddresses

describe('unit address — the ordinary case', () => {
  it('names the spot its seats stand on', () => {
    const addrs = addressesOf([
      seat('a1', 1, 3, 1, 'grpA'),
      seat('a2', 1, 3, 2, 'grpA'),
      seat('b1', 1, 3, 3, 'grpB'),
      seat('b2', 1, 3, 4, 'grpB'),
    ])

    expect(addrs.get('grpA')).toEqual({ parcel: 1, row: 3, seq: 1 })
    expect(addrs.get('grpB')).toEqual({ parcel: 1, row: 3, seq: 2 })
  })

  it('agrees with the seq embedded in the seat labels', () => {
    const items = [
      seat('a1', 2, 7, 1, 'grpA'),
      seat('b1', 2, 7, 2, 'grpB'),
      seat('b2', 2, 7, 3, 'grpB'),
    ]
    const { labels, unitAddresses } = computeSeatLabelsWithUnits(items)

    // Label format is `{parcel}-{row}{seq:02}-{member}` — the address must not
    // be able to disagree with the number painted on the bed.
    expect(labels.get('b1')).toBe('2-702-1')
    expect(unitAddresses.get('grpB')).toEqual({ parcel: 2, row: 7, seq: 2 })
  })

  it('gives unparcelled seats parcel 0 and their own row', () => {
    // The `0-N-N` scheme for seats that belong to no parcel.
    const addrs = addressesOf([seat('s1', 0, 0, 1, 'grpA'), seat('s2', 0, 0, 2, 'grpB')])

    expect(addrs.get('grpA')).toEqual({ parcel: 0, row: 0, seq: 1 })
    expect(addrs.get('grpB')).toEqual({ parcel: 0, row: 0, seq: 2 })
  })

  it('has no address for a seat belonging to no unit', () => {
    const addrs = addressesOf([seat('solo', 1, 1, 1, null)])
    expect(addrs.size).toBe(0)
  })
})

describe('unit address — pool extras do not move the unit', () => {
  /**
   * `addSeatToGroup` attaches an extra seat to a unit with a number from
   * `nextPoolNumber`, which decodes to a DIFFERENT row than the unit stands in.
   * Reading the address off every member would therefore relocate the unit the
   * first time a partner added an extra on the floor. Three such units already
   * existed in the dev database when this was written.
   */
  it('reads the position from placed seats only', () => {
    const addrs = addressesOf([
      seat('a1', 1, 3, 1, 'grpA'),
      seat('a2', 1, 3, 2, 'grpA'),
      seat('extra', 1, 90, 1, 'grpA', { status: 'pool' }),
    ])

    expect(addrs.get('grpA')).toEqual({ parcel: 1, row: 3, seq: 1 })
  })

  it('treats a seat with no status as placed', () => {
    // Callers that only want labels omit `status`; absent must not mean pool,
    // or every one of them would silently lose its address.
    const addrs = addressesOf([seat('a1', 4, 2, 1, 'grpA')])
    expect(addrs.get('grpA')).toEqual({ parcel: 4, row: 2, seq: 1 })
  })

  it('gives no address to a unit holding nothing but extras', () => {
    // Nothing physical to name — and an address kept here would block the
    // unique index against a real unit later built on that spot.
    const addrs = addressesOf([seat('extra', 1, 90, 1, 'grpA', { status: 'pool' })])
    expect(addrs.has('grpA')).toBe(false)
  })

  it('still counts a disabled seat — a broken bed is still standing there', () => {
    const addrs = addressesOf([
      seat('a1', 1, 3, 1, 'grpA', { status: 'disabled' }),
      seat('a2', 1, 3, 2, 'grpA', { status: 'active' }),
    ])
    expect(addrs.get('grpA')).toEqual({ parcel: 1, row: 3, seq: 1 })
  })
})

describe('unit address — refuses to guess', () => {
  it('declines when the unit’s placed seats disagree about the row', () => {
    const addrs = addressesOf([seat('a1', 1, 3, 1, 'grpA'), seat('a2', 1, 4, 1, 'grpA')])
    expect(addrs.has('grpA')).toBe(false)
  })

  it('declines when they disagree about the parcel', () => {
    const addrs = addressesOf([seat('a1', 1, 3, 1, 'grpA'), seat('a2', 2, 3, 1, 'grpA')])
    expect(addrs.has('grpA')).toBe(false)
  })

  it('declining one unit does not cost its neighbours their address', () => {
    const addrs = addressesOf([
      seat('a1', 1, 3, 1, 'grpA'),
      seat('a2', 1, 4, 1, 'grpA'), // grpA straddles two rows
      seat('b1', 1, 3, 2, 'grpB'),
    ])

    expect(addrs.has('grpA')).toBe(false)
    expect(addrs.get('grpB')).toEqual({ parcel: 1, row: 3, seq: 2 })
  })
})

describe('unit address — one ordinal cannot be claimed twice', () => {
  /**
   * A persisted `seq` is normally honoured verbatim so inserting a neighbour
   * cannot rename a bed. But two units in one row holding the SAME persisted
   * seq — which a rearrange can produce by moving a unit into a row where its
   * ordinal is already taken — used to both keep it: identical labels, and now
   * a violated UNIQUE(site, parcel, row, seq).
   */
  it('lets the first unit keep the contested seq and moves the other on', () => {
    const addrs = addressesOf([
      seat('a1', 1, 3, 1, 'grpA', { unitSeq: 2 }),
      seat('b1', 1, 3, 2, 'grpB', { unitSeq: 2 }),
    ])

    expect(addrs.get('grpA')).toEqual({ parcel: 1, row: 3, seq: 2 })
    expect(addrs.get('grpB')?.seq).not.toBe(2)
    expect(new Set([addrs.get('grpA')!.seq, addrs.get('grpB')!.seq]).size).toBe(2)
  })

  it('never emits the same address for two units in a row', () => {
    // Every unit in one row persisted as seq 1 — the worst case.
    const items = ['A', 'B', 'C', 'D'].flatMap((g, i) => [
      seat(`${g}1`, 1, 3, i * 2 + 1, `grp${g}`, { unitSeq: 1 }),
      seat(`${g}2`, 1, 3, i * 2 + 2, `grp${g}`, { unitSeq: 1 }),
    ])
    const addrs = addressesOf(items)

    const keys = [...addrs.values()].map((a) => `${a.parcel}-${a.row}-${a.seq}`)
    expect(keys).toHaveLength(4)
    expect(new Set(keys).size).toBe(4)
  })

  it('leaves an uncontested persisted seq exactly where it was', () => {
    // The P3 guarantee: a unit's number does not move because a neighbour
    // appeared. Seat 1 is new (no seq); the existing unit keeps 1.
    const addrs = addressesOf([
      seat('new', 1, 3, 1, 'grpNew'),
      seat('old', 1, 3, 2, 'grpOld', { unitSeq: 1 }),
    ])

    expect(addrs.get('grpOld')?.seq).toBe(1)
    expect(addrs.get('grpNew')?.seq).toBe(2)
  })

  it('keeps ordinals separate per row', () => {
    const addrs = addressesOf([
      seat('a1', 1, 3, 1, 'grpA'),
      seat('b1', 1, 4, 1, 'grpB'),
    ])

    // Same ordinal, different rows — not a collision.
    expect(addrs.get('grpA')).toEqual({ parcel: 1, row: 3, seq: 1 })
    expect(addrs.get('grpB')).toEqual({ parcel: 1, row: 4, seq: 1 })
  })
})

describe('the displayed seat id and the unit address cannot drift apart', () => {
  /**
   * The editor shows `{parcel}-{row}-{seq}-{member}` by UNPACKING the stored
   * label, while a device is assigned the unit address computed separately. If
   * the two ever disagree, staff read one id off the screen and the device
   * answers for another — so pin them to each other rather than to constants.
   */
  it('unpacks every generated label back to its unit address', () => {
    const items = [
      seat('a1', 1, 3, 1, 'grpA'),
      seat('a2', 1, 3, 2, 'grpA'),
      seat('b1', 1, 3, 3, 'grpB'),
      seat('c1', 2, 12, 1, 'grpC'), // two-digit row
      seat('d1', 0, 0, 1, 'grpD'), // unparcelled
    ]
    const { labels, unitAddresses } = computeSeatLabelsWithUnits(items)

    for (const item of items) {
      const parsed = parseSeatLabel(labels.get(item.id))
      const address = unitAddresses.get(item.sunbedGroupId!)!
      expect({ parcel: parsed!.parcel, row: parsed!.row, seq: parsed!.seq }).toEqual(address)
    }
  })

  it('renders the unit address as a literal prefix of the seat id', () => {
    // What the packed form hides: which beds belong to the parasol a device is
    // assigned to. `1-1-1` must be readable off `1-1-1-2` at a glance.
    const { labels, unitAddresses } = computeSeatLabelsWithUnits([
      seat('a1', 1, 1, 1, 'grpA'),
      seat('a2', 1, 1, 2, 'grpA'),
    ])
    const address = unitAddresses.get('grpA')!
    const prefix = `${address.parcel}-${address.row}-${address.seq}`

    for (const id of ['a1', 'a2']) {
      const shown = formatSeatId({ seatLabel: labels.get(id)!, number: 0 })
      expect(shown.startsWith(`${prefix}-`)).toBe(true)
    }
    expect(formatSeatId({ seatLabel: labels.get('a2')!, number: 0 })).toBe('1-1-1-2')
  })

  it('splits a two-digit row from the ordinal correctly', () => {
    // `seq` is zero-padded to exactly two digits, which is the only reason
    // `1203` can be read as row 12 unit 3 rather than row 120 unit 3.
    expect(parseSeatLabel('1-1203-2')).toEqual({ parcel: 1, row: 12, seq: 3, member: 2 })
  })

  it('reads an unparcelled seat as 0-0', () => {
    expect(parseSeatLabel('0-001-1')).toEqual({ parcel: 0, row: 0, seq: 1, member: 1 })
    expect(formatSeatId({ seatLabel: '0-001-1', number: 12 })).toBe('0-0-1-1')
  })

  it('omits the parcel when the context already scopes to one', () => {
    expect(formatSeatId({ seatLabel: '1-101-2', number: 0 }, { parcel: false })).toBe('1-1-2')
  })

  it.each([
    ['no label', null],
    ['empty', ''],
  ])('falls back to the legacy number when there is %s', (_l, label) => {
    expect(parseSeatLabel(label)).toBeNull()
    expect(formatSeatId({ seatLabel: label, number: 42 })).toBe('0042')
  })

  it.each([
    ['too few segments', '101-1'],
    ['middle too short', '1-11-1'],
    ['non-numeric', '1-abc-1'],
  ])('passes an unrecognised label (%s) through untouched', (_l, label) => {
    // Never invent an id: a stored label we cannot unpack is still the id this
    // seat is known by, and showing a mangled or substituted one would send
    // someone to the wrong bed.
    expect(parseSeatLabel(label)).toBeNull()
    expect(formatSeatId({ seatLabel: label, number: 42 })).toBe(label)
  })
})
