import { describe, expect, it } from 'vitest'
import {
  canSend,
  chipReducer,
  iconFor,
  isAcceptedFile,
  mapUploadError,
  MAX_PENDING_ATTACHMENTS,
  readyAttachments,
  remainingSlots,
  type Chip,
} from './attachment-chips'

const add = (s: Chip[], key: string) => chipReducer(s, { type: 'add', key, name: `${key}.pdf`, mime: 'application/pdf' })

describe('isAcceptedFile', () => {
  it.each([
    ['a.pdf', 'application/pdf'],
    ['a.JPG', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.webp', 'image/webp'],
    ['a.docx', ''],
    ['IMG_1.HEIC', ''], // browsers often report no type for HEIC
    ['x', 'image/heic'],
  ])('accepts %s (%s)', (name, type) => expect(isAcceptedFile({ name, type })).toBe(true))
  it.each([['a.exe', 'application/x-msdownload'], ['a.doc', 'application/msword'], ['a.gif', 'image/gif'], ['noext', '']])(
    'rejects %s',
    (name, type) => expect(isAcceptedFile({ name, type })).toBe(false),
  )
})

describe('mapUploadError', () => {
  const pdf = { name: 'a.pdf', type: 'application/pdf' }
  it('maps each server code', () => {
    expect(mapUploadError(['too_large'], pdf)).toBe('tooLarge')
    expect(mapUploadError(['rate_limited'], pdf)).toBe('rateLimited')
    expect(mapUploadError(['forbidden', 'Not authorized'], pdf)).toBe('forbidden')
    expect(mapUploadError(['unavailable'], pdf)).toBe('unavailable')
    expect(mapUploadError(['unsupported_type'], pdf)).toBe('unsupported')
  })
  it('suggests JPEG/PNG when an unsupported HEIC fails decoding', () => {
    expect(mapUploadError(['unsupported_type'], { name: 'IMG.heic', type: '' })).toBe('heic')
    expect(mapUploadError(['unsupported_type'], { name: 'x', type: 'image/heif' })).toBe('heic')
  })
  it('falls back to unavailable for unknown / missing codes', () => {
    expect(mapUploadError(undefined, pdf)).toBe('unavailable')
    expect(mapUploadError(['weird'], pdf)).toBe('unavailable')
  })
})

describe('chipReducer', () => {
  it('caps pending chips at the per-turn limit and ignores duplicate keys', () => {
    let s: Chip[] = []
    for (let i = 0; i < MAX_PENDING_ATTACHMENTS + 2; i++) s = add(s, `k${i}`)
    expect(s).toHaveLength(MAX_PENDING_ATTACHMENTS)
    expect(add(s, 'k0')).toBe(s)
    expect(remainingSlots(s)).toBe(0)
  })
  it('settles uploading chips only once', () => {
    let s = add([], 'a')
    s = chipReducer(s, { type: 'done', key: 'a', id: 'u1' })
    expect(s[0]).toMatchObject({ status: 'done', id: 'u1' })
    const again = chipReducer(s, { type: 'failed', key: 'a', error: 'unavailable' })
    expect(again[0]?.status).toBe('done')
  })
  it('records the error and lets the user remove the chip', () => {
    let s = add([], 'a')
    s = chipReducer(s, { type: 'failed', key: 'a', error: 'tooLarge' })
    expect(s[0]).toMatchObject({ status: 'error', error: 'tooLarge' })
    expect(chipReducer(s, { type: 'remove', key: 'a' })).toEqual([])
  })
  it('clear empties; clearing empty is a no-op', () => {
    const s = add([], 'a')
    expect(chipReducer(s, { type: 'clear' })).toEqual([])
    const e: Chip[] = []
    expect(chipReducer(e, { type: 'clear' })).toBe(e)
  })
})

describe('canSend / readyAttachments', () => {
  it('blocks while any upload is in flight, even with text', () => {
    expect(canSend(add([], 'a'), 'hello')).toBe(false)
  })
  it('allows attachments with empty text', () => {
    const s = chipReducer(add([], 'a'), { type: 'done', key: 'a', id: 'u1' })
    expect(canSend(s, '  ')).toBe(true)
  })
  it('does not count failed chips as content, and never sends their ids', () => {
    const s = chipReducer(add([], 'a'), { type: 'failed', key: 'a', error: 'heic' })
    expect(canSend(s, '')).toBe(false)
    expect(canSend(s, 'text')).toBe(true)
    expect(readyAttachments(s)).toEqual([])
  })
  it('nothing to send with no text and no chips', () => expect(canSend([], '')).toBe(false))
})

describe('iconFor', () => {
  it('classifies by type or extension', () => {
    expect(iconFor({ name: 'a.pdf' })).toBe('pdf')
    expect(iconFor({ name: 'a.heic' })).toBe('image')
    expect(iconFor({ name: 'a', kind: 'photo' })).toBe('image')
    expect(iconFor({ name: 'a.docx' })).toBe('doc')
  })
})
