/**
 * Decoding `InventoryItem.number` (manage grid).
 *
 * The encoding is `parcel * 10000 + row * 100 + seatIdx`. It exists to be read
 * with ARITHMETIC — the manage grid instead read it by slicing the string
 * (`str[0]` as the parcel, `str[1..3]` as the row), which is correct only while
 * a site has fewer than ten parcels. On a 43-parcel beach it showed nine
 * parcels, each polluted with seats from other parcels carrying misread rows
 * and positions. These cases are the ones that were failing.
 */

import { describe, it, expect } from 'vitest'

import { decodeSeatNumber } from './seat-label'

describe('decodeSeatNumber', () => {
  it('decodes a single-digit parcel', () => {
    expect(decodeSeatNumber(10101)).toEqual({ parcel: 1, row: 1, seatIdx: 1 })
    expect(decodeSeatNumber(90412)).toEqual({ parcel: 9, row: 4, seatIdx: 12 })
  })

  it('decodes a TWO-digit parcel — the case string slicing got wrong', () => {
    // 430101 sliced gives parcel 4, row 30, position 101. All three are wrong,
    // and the parcel collides with the real parcel 4.
    expect(decodeSeatNumber(430101)).toEqual({ parcel: 43, row: 1, seatIdx: 1 })
    expect(decodeSeatNumber(101204)).toEqual({ parcel: 10, row: 12, seatIdx: 4 })
  })

  it('keeps every parcel of a 43-parcel site distinct', () => {
    // The headline symptom: 43 parcels rendering as 9. One seat per parcel,
    // and each must land in its own bucket.
    const parcels = Array.from({ length: 43 }, (_, i) => i + 1)
    const decoded = parcels.map((p) => decodeSeatNumber(p * 10000 + 101).parcel)

    expect(new Set(decoded).size).toBe(43)
    expect(decoded).toEqual(parcels)
  })

  it('attributes a pool extra to the parcel that owns its band', () => {
    // Pool numbers are parcel*10000 + 9900 + seq (`nextPoolNumber`). Slicing
    // put parcel 12's spare in parcel 1; arithmetic puts it where it belongs.
    expect(decodeSeatNumber(19901)).toMatchObject({ parcel: 1, row: 99 })
    expect(decodeSeatNumber(129901)).toMatchObject({ parcel: 12, row: 99 })
  })

  it('round-trips any position the encoder can produce', () => {
    for (const parcel of [1, 9, 10, 43, 99]) {
      for (const row of [1, 11, 99]) {
        for (const seatIdx of [1, 50, 99]) {
          expect(decodeSeatNumber(parcel * 10000 + row * 100 + seatIdx))
            .toEqual({ parcel, row, seatIdx })
        }
      }
    }
  })
})
