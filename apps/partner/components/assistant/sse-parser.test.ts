import { describe, it, expect } from 'vitest'
import { createSseParser } from './sse-parser'

const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

describe('createSseParser', () => {
  it('parses several events delivered in one chunk', () => {
    const p = createSseParser()
    const out = p.push(
      ev('conversation', { conversationId: 'c1' }) + ev('text', { delta: 'Hi' }) + ev('done', { conversationId: 'c1' }),
    )
    expect(out).toEqual([
      { type: 'conversation', conversationId: 'c1' },
      { type: 'text', delta: 'Hi' },
      { type: 'done', conversationId: 'c1' },
    ])
  })

  it('reassembles an event split mid-field and mid-JSON across chunks', () => {
    const p = createSseParser()
    const full = ev('text', { delta: 'héllo wörld' })
    const out: unknown[] = []
    for (const part of [full.slice(0, 5), full.slice(5, 22), full.slice(22, full.length - 1), full.slice(-1)]) {
      out.push(...p.push(part))
    }
    expect(out).toEqual([{ type: 'text', delta: 'héllo wörld' }])
  })

  it('emits nothing until the blank line terminates the event', () => {
    const p = createSseParser()
    expect(p.push('event: text\ndata: {"delta":"a"}\n')).toEqual([])
    expect(p.push('\n')).toEqual([{ type: 'text', delta: 'a' }])
  })

  it('handles CRLF, including a \\r\\n split between chunks', () => {
    const p = createSseParser()
    const out = [
      ...p.push('event: text\r\ndata: {"delta":"x"}\r'),
      ...p.push('\n\r'),
      ...p.push('\n'),
    ]
    expect(out).toEqual([{ type: 'text', delta: 'x' }])
  })

  it('ignores unknown events, comments, malformed JSON and invalid payloads', () => {
    const p = createSseParser()
    const out = p.push(
      ': keep-alive\n\n' +
        ev('mystery', { a: 1 }) +
        'event: text\ndata: {not json}\n\n' +
        ev('text', { nope: true }) +
        ev('text', { delta: 'ok' }),
    )
    expect(out).toEqual([{ type: 'text', delta: 'ok' }])
  })

  it('maps tool, proposal and error events; unknown error codes become unavailable', () => {
    const p = createSseParser()
    const out = p.push(
      ev('tool_start', { name: 'list_parcels', label: 'Reading parcels…' }) +
        ev('tool_result', { name: 'list_parcels', ok: false }) +
        ev('proposal', { actionId: 'a1', kind: 'rotate', summary: 'Rotate', preview: { x: 1 } }) +
        ev('error', { code: 'budget', message: 'm' }) +
        ev('error', { code: 'weird', message: 'm' }),
    )
    expect(out).toEqual([
      { type: 'tool_start', name: 'list_parcels', label: 'Reading parcels…' },
      { type: 'tool_result', name: 'list_parcels', ok: false },
      { type: 'proposal', actionId: 'a1', kind: 'rotate', summary: 'Rotate', preview: { x: 1 } },
      { type: 'error', code: 'budget', message: 'm' },
      { type: 'error', code: 'unavailable', message: 'm' },
    ])
  })

  it('flush() parses a final event the server left unterminated', () => {
    const p = createSseParser()
    expect(p.push('event: done\ndata: {"conversationId":"c9"}')).toEqual([])
    expect(p.flush()).toEqual([{ type: 'done', conversationId: 'c9' }])
    expect(p.flush()).toEqual([])
  })

  it('supports multi-line data fields', () => {
    const p = createSseParser()
    expect(p.push('event: text\ndata: {"delta":\ndata: "a"}\n\n')).toEqual([{ type: 'text', delta: 'a' }])
  })
})

describe('qr_print event', () => {
  it('parses a parcel and/or seat labels', () => {
    const p = createSseParser()
    expect(p.push(ev('qr_print', { parcel: 3 }) + ev('qr_print', { seatLabels: ['A1', 7, ''] }))).toEqual([
      { type: 'qr_print', parcel: 3 },
      { type: 'qr_print', seatLabels: ['A1'] },
    ])
  })
  it('drops a request with no target', () => {
    expect(createSseParser().push(ev('qr_print', { seatLabels: [] }))).toEqual([])
  })
})

describe('align_photo event', () => {
  const seed = { kind: 'similarity', anchorPx: { x: 10, y: 20 }, anchor: { lat: 35.5, lng: 24 }, metersPerPx: 0.05, rotationDeg: 90 }
  const data = { uploadId: 'u1', seed, image: { w: 2000, h: 1000 } }

  it('parses uploadId, a similarity seed and the image size', () => {
    expect(createSseParser().push(ev('align_photo', data))).toEqual([{ type: 'align_photo', ...data }])
  })
  it('survives a chunk boundary mid-event', () => {
    const raw = ev('align_photo', data)
    const p = createSseParser()
    expect(p.push(raw.slice(0, 40))).toEqual([])
    expect(p.push(raw.slice(40))).toHaveLength(1)
  })
  it.each([
    ['missing uploadId', { ...data, uploadId: undefined }],
    ['homography seed (not supported yet)', { ...data, seed: { kind: 'homography', anchor: seed.anchor, h: [1, 0, 0, 0, 1, 0, 0, 0, 1] } }],
    ['non-positive scale', { ...data, seed: { ...seed, metersPerPx: 0 } }],
    ['non-finite anchor', { ...data, seed: { ...seed, anchor: { lat: 'x', lng: 1 } } }],
    ['zero-size image', { ...data, image: { w: 0, h: 10 } }],
  ])('drops %s', (_n, bad) => {
    expect(createSseParser().push(ev('align_photo', bad))).toEqual([])
  })
})

describe('act-immediately proposal events', () => {
  it('keeps status applied + appliedAt, and stays pending without a status', () => {
    const p = createSseParser()
    const evs = p.push(
      `event: proposal\ndata: ${JSON.stringify({ actionId: 'a1', kind: 'k', summary: 'S', preview: {}, status: 'applied', appliedAt: 99 })}\n\n` +
        `event: proposal\ndata: ${JSON.stringify({ actionId: 'a2', kind: 'k', summary: 'S', preview: {} })}\n\n` +
        `event: proposal\ndata: ${JSON.stringify({ actionId: 'a3', kind: 'k', summary: 'S', preview: {}, status: 'bogus' })}\n\n`,
    )
    expect(evs[0]).toMatchObject({ type: 'proposal', actionId: 'a1', status: 'applied', appliedAt: 99 })
    expect(evs[1]).not.toHaveProperty('status')
    expect(evs[2]).not.toHaveProperty('status') // only 'applied' is honoured
  })
})
