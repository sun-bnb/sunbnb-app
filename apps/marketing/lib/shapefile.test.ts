import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isClockwise, readShapes, toWkt } from './shapefile.ts'

/** Build a .shp in memory: records of [type, parts] (parts = arrays of [x, y]). */
function shp(records: [3 | 5, [number, number][][]][]): Buffer {
  const bodies = records.map(([type, parts]) => {
    const pts = parts.flat()
    const b = Buffer.alloc(44 + parts.length * 4 + pts.length * 16)
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    b.writeInt32LE(type, 0)
    b.writeDoubleLE(Math.min(...xs), 4); b.writeDoubleLE(Math.min(...ys), 12)
    b.writeDoubleLE(Math.max(...xs), 20); b.writeDoubleLE(Math.max(...ys), 28)
    b.writeInt32LE(parts.length, 36); b.writeInt32LE(pts.length, 40)
    let start = 0
    parts.forEach((p, i) => { b.writeInt32LE(start, 44 + i * 4); start += p.length })
    pts.forEach(([x, y], i) => { b.writeDoubleLE(x, 44 + parts.length * 4 + i * 16); b.writeDoubleLE(y, 44 + parts.length * 4 + i * 16 + 8) })
    return b
  })
  const total = 100 + bodies.reduce((s, b) => s + 8 + b.length, 0)
  const header = Buffer.alloc(100)
  header.writeInt32BE(9994, 0)
  header.writeInt32BE(total / 2, 24)
  return Buffer.concat([header, ...bodies.flatMap((b, i) => { const h = Buffer.alloc(8); h.writeInt32BE(i + 1, 0); h.writeInt32BE(b.length / 2, 4); return [h, b] })])
}

const file = (buf: Buffer) => { const p = join(mkdtempSync(join(tmpdir(), 'shp-')), 'x.shp'); writeFileSync(p, buf); return p }

describe('readShapes — streaming, region-filtered', () => {
  const path = file(shp([
    [3, [[[3.1, 39.8], [3.2, 39.9]]]], // Mallorca
    [3, [[[-43.2, -22.9], [-43.1, -22.8]]]], // Rio
    [5, [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]], [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]]],
  ]))
  it('reads every record with its number, parts and box', () => {
    const all = [...readShapes(path)]
    expect(all.map((r) => r.n)).toEqual([1, 2, 3])
    expect(all[0]!.parts).toEqual([[[3.1, 39.8], [3.2, 39.9]]])
    expect(all[2]!.parts).toHaveLength(2)
  })
  it('skips records outside the region without decoding them', () => {
    expect([...readShapes(path, { south: 39, west: 2, north: 40, east: 4 })].map((r) => r.n)).toEqual([1])
  })
})

describe('toWkt', () => {
  it('lines keep their point order (the OSM water-on-the-right direction)', () => {
    expect(toWkt({ n: 1, type: 3, box: { south: 0, west: 0, north: 1, east: 1 }, parts: [[[0, 0], [1, 1]]] })).toBe('LINESTRING(0 0,1 1)')
  })
  it('a counter-clockwise ring is a hole of the preceding clockwise outer ring', () => {
    const outer: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]
    const hole: [number, number][] = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]
    expect(isClockwise(outer)).toBe(true)
    expect(isClockwise(hole)).toBe(false)
    expect(toWkt({ n: 1, type: 5, box: { south: 0, west: 0, north: 1, east: 1 }, parts: [outer, hole] })).toMatch(/^MULTIPOLYGON\(\(\(0 0,.*\),\(0\.2 0\.2,.*\)\)\)$/)
  })
})
