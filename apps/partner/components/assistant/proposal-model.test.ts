import { describe, it, expect } from 'vitest'
import {
  UNDO_WINDOW_MS,
  canApply,
  canUndo,
  compactPreview,
  needsReview,
  formatValue,
  parsePreview,
  parseImagePreview,
  uploadThumbSrc,
  hasThumbnail,
  statusAfterError,
  toErrorCode,
  toStatus,
  describeCreate,
  humanizeKey,
  parsePosition,
} from './proposal-model'

describe('formatValue', () => {
  it('renders null / undefined / empty string as empty', () => {
    expect(formatValue(null)).toEqual({ kind: 'empty' })
    expect(formatValue(undefined)).toEqual({ kind: 'empty' })
    expect(formatValue('')).toEqual({ kind: 'empty' })
  })
  it('keeps false and 0 as real values (not empty)', () => {
    expect(formatValue(false)).toEqual({ kind: 'bool', value: false })
    expect(formatValue(0)).toMatchObject({ kind: 'text', text: '0' })
  })
  it('truncates long text until expanded', () => {
    const long = 'x'.repeat(100)
    const f = formatValue(long)
    expect(f).toMatchObject({ kind: 'text', truncated: true, full: long })
    expect((f as { text: string }).text.length).toBeLessThan(long.length)
    expect(formatValue(long, true)).toMatchObject({ truncated: false, text: long })
  })
})

describe('parsePreview', () => {
  it('survives garbage', () => {
    for (const bad of [null, undefined, 'x', 3, [], { changes: 'no', deletes: [1, null] }]) {
      expect(parsePreview(bad)).toEqual({ changes: [], creates: [], deletes: [], warnings: [] })
    }
  })
  it('normalises entries and falls back label to field', () => {
    const p = parsePreview({
      changes: [{ target: 'Parcel 3', field: 'rotation', before: 0, after: 10 }, 'junk'],
      creates: [{ target: 'Bed', fields: { n: 1, o: { a: 1 } } }],
      deletes: [{ target: 'Bed', label: 'B7' }],
      warnings: ['w', 4],
    })
    expect(p.changes).toEqual([{ target: 'Parcel 3', field: 'rotation', label: 'rotation', before: 0, after: 10 }])
    expect(p.creates[0]!.fields.n).toBe(1)
    expect(typeof p.creates[0]!.fields.o).toBe('string')
    expect(p.deletes).toHaveLength(1)
    expect(p.warnings).toEqual(['w'])
  })
})

describe('typed-delete gate', () => {
  const del = parsePreview({ deletes: [{ target: 'Bed', label: 'B1' }] })
  const plain = parsePreview({ changes: [{ target: 'a', field: 'f', label: 'f', before: 1, after: 2 }] })
  it('blocks Apply for deletes until DELETE is typed', () => {
    expect(canApply(del, '')).toBe(false)
    expect(canApply(del, 'DELET')).toBe(false)
    expect(canApply(del, 'delete')).toBe(true)
    expect(canApply(del, ' DELETE ')).toBe(true)
  })
  it('never gates proposals without deletes', () => {
    expect(canApply(plain, '')).toBe(true)
  })
})

describe('canUndo', () => {
  const plain = parsePreview({})
  const del = parsePreview({ deletes: [{ target: 'x', label: 'y' }] })
  const now = 10 * UNDO_WINDOW_MS
  it('only for applied proposals inside 24h', () => {
    expect(canUndo('applied', plain, now - 1000, now)).toBe(true)
    expect(canUndo('applied', plain, now - UNDO_WINDOW_MS - 1, now)).toBe(false)
    expect(canUndo('proposed', plain, undefined, now)).toBe(false)
    expect(canUndo('undone', plain, now, now)).toBe(false)
  })
  it('offers undo for restored transcripts (unknown time); server enforces window', () => {
    expect(canUndo('applied', plain, undefined, now)).toBe(true)
  })
  it('deletes are not undoable', () => {
    expect(canUndo('applied', del, now, now)).toBe(false)
  })
})

describe('error mapping', () => {
  it('maps known codes and defaults to unknown', () => {
    expect(toErrorCode(['stale'])).toBe('stale')
    expect(toErrorCode(['boom'])).toBe('unknown')
    expect(toErrorCode(undefined)).toBe('unknown')
  })
  it('expired / apply_failed flip the card status, others do not', () => {
    expect(statusAfterError('expired')).toBe('expired')
    expect(statusAfterError('apply_failed')).toBe('failed')
    expect(statusAfterError('stale')).toBeNull()
  })
  it('toStatus falls back to proposed', () => {
    expect(toStatus('applied')).toBe('applied')
    expect(toStatus('weird')).toBe('proposed')
  })
})

describe('parseImagePreview', () => {
  it('reads a placement preview', () => {
    expect(
      parseImagePreview({ image: { target: 'product', uploadId: 'u1', fileName: 'a.jpg', itemName: 'Mojito', previousUrl: 'https://x/y.jpg', imageUrl: 'https://private' } }),
    ).toEqual({ target: 'product', uploadId: 'u1', fileName: 'a.jpg', itemName: 'Mojito', previousUrl: 'https://x/y.jpg' })
  })
  it('an empty slot has no previous url (rendered as "no image")', () => {
    expect(parseImagePreview({ image: { target: 'cover', uploadId: 'u1', fileName: 'a.jpg', previousUrl: null } })?.previousUrl).toBeNull()
    expect(parseImagePreview({ image: { target: 'cover', previousUrl: '' } })?.previousUrl).toBeNull()
  })
  it('is null for non-placement previews and unknown targets', () => {
    for (const bad of [null, {}, { image: null }, { image: { target: 'moon' } }, 'x']) expect(parseImagePreview(bad)).toBeNull()
  })
  it('the new photo is always fetched through the account-scoped route, never the stored (maybe private) url', () => {
    expect(uploadThumbSrc('a/b')).toBe('/api/assistant/uploads/a%2Fb')
  })
})

describe('hasThumbnail', () => {
  it('only uploaded photos with an id; documents and unsaved files stay chips', () => {
    expect(hasThumbnail({ id: 'u', kind: 'photo' })).toBe(true)
    expect(hasThumbnail({ id: 'u', kind: 'document' })).toBe(false)
    expect(hasThumbnail({ kind: 'photo' })).toBe(false)
  })
})

describe('humanizeKey', () => {
  it('turns camelCase and snake_case into words', () => {
    expect(humanizeKey('seatsPerRow')).toBe('Seats per row')
    expect(humanizeKey('sold_out')).toBe('Sold out')
    expect(humanizeKey('vat')).toBe('Vat')
  })
})

describe('parsePosition', () => {
  it('reads schematic metres and treats anything else as a geo point', () => {
    expect(parsePosition('x 5.3, y 14.1')).toEqual({ kind: 'schematic', x: '5.3', y: '14.1' })
    expect(parsePosition('39.833613, 3.121066')).toEqual({ kind: 'geo', text: '39.833613, 3.121066' })
    expect(parsePosition(null)).toBeNull()
    expect(parsePosition('')).toBeNull()
  })
})

describe('describeCreate', () => {
  it('recognises a parcel and keeps every number', () => {
    const v = describeCreate({ rows: 3, seatsPerRow: 16, sunbeds: 48, paired: true, rotation: 180, position: '39.833613, 3.121066' })
    expect(v).toMatchObject({ kind: 'parcel', rows: 3, perRow: 16, total: 48, paired: true, rotation: 180, extras: [] })
    expect((v as { position: unknown }).position).toEqual({ kind: 'geo', text: '39.833613, 3.121066' })
  })
  it('drops a zero rotation and surfaces extra parcel fields (category, price) humanized', () => {
    const v = describeCreate({ rows: 1, seatsPerRow: 2, sunbeds: 2, paired: false, rotation: 0, position: 'x 1, y 2', category: 'vip', price: 12 })
    expect(v).toMatchObject({ kind: 'parcel', paired: false, rotation: null })
    expect((v as { extras: unknown[] }).extras).toEqual([
      { key: 'category', fallbackLabel: 'Category', value: 'vip' },
      { key: 'price', fallbackLabel: 'Price', value: 12 },
    ])
  })
  it('recognises a layout element, with and without a label', () => {
    expect(describeCreate({ type: 'water', x: 0, y: 0, width: 60, height: 8, rotation: 0, label: 'SEA' })).toEqual({
      kind: 'element', type: 'water', label: 'SEA', width: 60, height: 8, x: 0, y: 0, rotation: null, extras: [],
    })
    expect(describeCreate({ type: 'path', x: 1, y: 2, width: 3, height: 4, rotation: 90, label: null })).toMatchObject({ label: null, rotation: 90 })
  })
  it('falls back to humanized generic rows for product-like creates', () => {
    const v = describeCreate({ name: 'Mojito', price: 9, soldOut: false })
    expect(v).toEqual({
      kind: 'generic',
      fields: [
        { key: 'name', fallbackLabel: 'Name', value: 'Mojito' },
        { key: 'price', fallbackLabel: 'Price', value: 9 },
        { key: 'soldOut', fallbackLabel: 'Sold out', value: false },
      ],
    })
  })
  it('does not mistake a partial signature for a parcel or element', () => {
    expect(describeCreate({ rows: 3 }).kind).toBe('generic')
    expect(describeCreate({ type: 'water', x: 0 }).kind).toBe('generic')
  })
})

describe('done card (act-immediately)', () => {
  const change = (i: number) => ({ target: `Seat ${i}`, field: 'position', label: 'Position', before: i, after: i + 1 })
  const base = { changes: [], creates: [], deletes: [], warnings: ['QR cards for 8 seats need reprinting'] }

  it('compactPreview lists at most 5 rows (changes first) and counts the rest; warnings stay', () => {
    const p = { ...base, changes: Array.from({ length: 3 }, (_, i) => change(i)), creates: Array.from({ length: 4 }, (_, i) => ({ target: `P${i}`, fields: {} })) }
    const { preview, hidden } = compactPreview(p)
    expect(preview.changes).toHaveLength(3)
    expect(preview.creates).toHaveLength(2)
    expect(hidden).toBe(2)
    expect(preview.warnings).toEqual(base.warnings)
  })
  it('a short list is untouched', () => {
    const p = { ...base, changes: [change(1)] }
    expect(compactPreview(p)).toEqual({ preview: p, hidden: 0 })
  })
  it('only a pending (delete) proposal needs review; an applied card offers Undo within 24 h and nothing else', () => {
    expect(needsReview('proposed')).toBe(true)
    expect(needsReview('applied')).toBe(false)
    expect(canUndo('applied', base, Date.now() - 1000)).toBe(true)
    expect(canUndo('applied', base, Date.now() - 25 * 3600_000)).toBe(false)
  })
  it('a pending delete still demands the typed word before Apply', () => {
    const del = { ...base, deletes: [{ target: 'Parcel 3', label: 'removed' }] }
    expect(canApply(del, '')).toBe(false)
    expect(canApply(del, 'delete')).toBe(true)
  })
})
