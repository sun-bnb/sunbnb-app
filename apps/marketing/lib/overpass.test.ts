import { describe, expect, it } from 'vitest'
import { parseCoastAnswer } from './overpass.ts'

describe('parseCoastAnswer — only complete answers are cached', () => {
  it('reads coastline ways with their ids, in OSM order', () => {
    const ways = parseCoastAnswer({
      elements: [
        { type: 'way', id: 7, geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
        { type: 'way', id: 8, geometry: [{ lat: 1, lon: 2 }] },
        { type: 'node', id: 9 },
      ],
    })
    expect(ways).toEqual([{ id: 7, points: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] }])
  })
  it('an empty answer is a real answer (no coast in this tile)', () => {
    expect(parseCoastAnswer({ elements: [] })).toEqual([])
  })
  it('an Overpass timeout reported as 200 + remark is NOT an answer', () => {
    expect(parseCoastAnswer({ remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.', elements: [] })).toBeNull()
    expect(parseCoastAnswer({})).toBeNull()
  })
})
