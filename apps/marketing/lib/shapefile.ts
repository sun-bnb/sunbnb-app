/**
 * A minimal streaming ESRI shapefile (.shp) reader for the coastline import (track 027): polyline
 * (type 3) and polygon (type 5) records only — what osmdata.openstreetmap.de publishes. Every
 * record carries its bounding box, so a region import skips the rest of the world without
 * decoding it. No dependency; the format is fixed (ESRI Shapefile Technical Description, 1998).
 *
 * Record numbers are stable within one file version and are what the import derives ids from.
 */
import { closeSync, openSync, readSync } from 'node:fs'

export interface Box {
  south: number
  west: number
  north: number
  east: number
}

export interface ShapeRecord {
  /** 1-based record number in the file. */
  n: number
  type: 3 | 5
  box: Box
  /** Parts (polyline pieces or polygon rings) as [lng, lat] points. */
  parts: [number, number][][]
}

export const intersects = (a: Box, b: Box) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south

/** Parse one record's content (after its 8-byte header). Exported for tests. */
export function parseRecord(n: number, buf: Buffer): ShapeRecord | null {
  const type = buf.readInt32LE(0)
  if (type !== 3 && type !== 5) return null
  const box = { west: buf.readDoubleLE(4), south: buf.readDoubleLE(12), east: buf.readDoubleLE(20), north: buf.readDoubleLE(28) }
  const numParts = buf.readInt32LE(36)
  const numPoints = buf.readInt32LE(40)
  const starts: number[] = []
  for (let i = 0; i < numParts; i++) starts.push(buf.readInt32LE(44 + i * 4))
  const pts = 44 + numParts * 4
  const parts: [number, number][][] = []
  for (let p = 0; p < numParts; p++) {
    const from = starts[p]!
    const to = p + 1 < numParts ? starts[p + 1]! : numPoints
    const part: [number, number][] = []
    for (let i = from; i < to; i++) part.push([buf.readDoubleLE(pts + i * 16), buf.readDoubleLE(pts + i * 16 + 8)])
    parts.push(part)
  }
  return { n, type, box, parts }
}

/**
 * Yield the records whose bounding box intersects `filter` (all records when omitted). Reads the
 * file sequentially in fixed chunks — a 1 GB world file streams in constant memory.
 */
export function* readShapes(path: string, filter?: Box): Generator<ShapeRecord> {
  const fd = openSync(path, 'r')
  try {
    const header = Buffer.alloc(100)
    readSync(fd, header, 0, 100, 0)
    if (header.readInt32BE(0) !== 9994) throw new Error(`${path}: not a shapefile`)
    const fileBytes = header.readInt32BE(24) * 2
    let pos = 100
    const head = Buffer.alloc(8)
    const bbox = Buffer.alloc(36)
    while (pos + 8 <= fileBytes) {
      readSync(fd, head, 0, 8, pos)
      const n = head.readInt32BE(0)
      const len = head.readInt32BE(4) * 2
      if (filter) {
        readSync(fd, bbox, 0, 36, pos + 8)
        const type = bbox.readInt32LE(0)
        const box = { west: bbox.readDoubleLE(4), south: bbox.readDoubleLE(12), east: bbox.readDoubleLE(20), north: bbox.readDoubleLE(28) }
        if ((type !== 3 && type !== 5) || !intersects(box, filter)) {
          pos += 8 + len
          continue
        }
      }
      const body = Buffer.alloc(len)
      readSync(fd, body, 0, len, pos + 8)
      const rec = parseRecord(n, body)
      if (rec) yield rec
      pos += 8 + len
    }
  } finally {
    closeSync(fd)
  }
}

/** Shapefile polygons: outer rings are clockwise, holes counter-clockwise (signed area). */
export function isClockwise(ring: [number, number][]): boolean {
  let s = 0
  for (let i = 0; i < ring.length - 1; i++) s += (ring[i + 1]![0] - ring[i]![0]) * (ring[i + 1]![1] + ring[i]![1])
  return s > 0
}

const pt = ([x, y]: [number, number]) => `${x} ${y}`

/** WKT for a record: LINESTRING / MULTILINESTRING, or MULTIPOLYGON with holes under their outer ring. */
export function toWkt(rec: ShapeRecord): string {
  if (rec.type === 3) {
    const lines = rec.parts.filter((p) => p.length >= 2)
    return lines.length === 1 ? `LINESTRING(${lines[0]!.map(pt).join(',')})` : `MULTILINESTRING(${lines.map((l) => `(${l.map(pt).join(',')})`).join(',')})`
  }
  const polys: [number, number][][][] = []
  for (const ring of rec.parts) {
    if (ring.length < 4) continue
    if (isClockwise(ring) || !polys.length) polys.push([ring])
    else polys[polys.length - 1]!.push(ring)
  }
  return `MULTIPOLYGON(${polys.map((p) => `(${p.map((r) => `(${r.map(pt).join(',')})`).join(',')})`).join(',')})`
}

// ── .dbf attributes (dBASE III, as written next to a .shp) ─────────────────────────────────────

export interface DbfTable {
  fields: string[]
  records: number
  /** Field values of record `n` (1-based, the .shp record number), trimmed. */
  read(n: number): Record<string, string>
  close(): void
}

/**
 * Random access to a shapefile's attribute table — record `n` of the .dbf belongs to record `n`
 * of the .shp, so a region-filtered `readShapes` can look up only the records it keeps. Text is
 * read as UTF-8 (what Geofabrik writes; its .cpg says so).
 */
export function openDbf(path: string): DbfTable {
  const fd = openSync(path, 'r')
  const head = Buffer.alloc(32)
  readSync(fd, head, 0, 32, 0)
  const records = head.readUInt32LE(4)
  const headerLength = head.readUInt16LE(8)
  const recordLength = head.readUInt16LE(10)
  const desc = Buffer.alloc(headerLength - 32)
  readSync(fd, desc, 0, desc.length, 32)
  const cols: { name: string; offset: number; length: number }[] = []
  let offset = 1 // byte 0 of each record is the deletion flag
  for (let i = 0; i + 32 <= desc.length && desc[i] !== 0x0d; i += 32) {
    const name = desc.subarray(i, i + 11).toString('latin1').replace(/\0.*$/, '')
    const length = desc[i + 16]!
    cols.push({ name, offset, length })
    offset += length
  }
  const rec = Buffer.alloc(recordLength)
  return {
    fields: cols.map((c) => c.name),
    records,
    read(n) {
      if (n < 1 || n > records) throw new Error(`${path}: no record ${n}`)
      readSync(fd, rec, 0, recordLength, headerLength + (n - 1) * recordLength)
      return Object.fromEntries(cols.map((c) => [c.name, rec.subarray(c.offset, c.offset + c.length).toString('utf8').trim()]))
    },
    close: () => closeSync(fd),
  }
}
