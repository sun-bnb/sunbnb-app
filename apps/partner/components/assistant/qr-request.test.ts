import { describe, it, expect } from 'vitest'
import { qrButtonTarget, selectQrItems } from './qr-request'

const items = [
  { group: 1, seatLabel: 'A1', number: 1 },
  { group: 1, seatLabel: 'A2', number: 2 },
  { group: 2, seatLabel: 'A1', number: 1 },
  { group: 1, seatLabel: 'P', number: 3, status: 'pool' },
]
describe('selectQrItems', () => {
  it('parcel only: all seats of that parcel, never pool seats', () => {
    expect(selectQrItems(items, { parcel: 1 })).toHaveLength(2)
  })
  it('labels narrow within the parcel, case-insensitively', () => {
    expect(selectQrItems(items, { parcel: 2, seatLabels: ['a1'] })).toEqual([items[2]])
  })
  it('labels without a parcel match across parcels', () => {
    expect(selectQrItems(items, { seatLabels: ['A1'] })).toHaveLength(2)
  })
  it('an empty request selects nothing', () => {
    expect(selectQrItems(items, {})).toEqual([])
  })
})
describe('qrButtonTarget', () => {
  it('parcel vs seats', () => {
    expect(qrButtonTarget({ parcel: 4 })).toEqual({ kind: 'parcel', parcel: 4 })
    expect(qrButtonTarget({ parcel: 4, seatLabels: ['A'] })).toEqual({ kind: 'seats', count: 1 })
  })
})
