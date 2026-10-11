import { describe, expect, it } from 'vitest'
import { DOCX_MIME, MAX_UPLOAD_BYTES, nameFromBlobKey, safeDisplayName, sniffMime, uploadBlobKey, validateUpload } from './uploads'

const bytes = (...head: (number | string)[]) => {
  const a: number[] = []
  for (const h of head) typeof h === 'string' ? a.push(...[...h].map((c) => c.charCodeAt(0))) : a.push(h)
  while (a.length < 32) a.push(0)
  return new Uint8Array(a)
}
const PDF = bytes('%PDF-1.7')
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0)
const PNG = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)
const WEBP = bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 ')
const HEIC = bytes(0, 0, 0, 24, 'ftypheic')
const docx = (inner: string) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...[...`....[Content_Types].xml ${inner}`].map((c) => c.charCodeAt(0))])

describe('sniffMime (bytes, not extension)', () => {
  it.each([
    ['pdf', PDF, 'application/pdf'],
    ['jpeg', JPEG, 'image/jpeg'],
    ['png', PNG, 'image/png'],
    ['webp', WEBP, 'image/webp'],
    ['heic', HEIC, 'image/heic'],
    ['docx', docx('word/document.xml'), DOCX_MIME],
  ])('recognises %s', (_n, b, mime) => expect(sniffMime(b)).toBe(mime))

  it.each([
    ['html', bytes('<!doctype html>')],
    ['svg with script', bytes('<svg xmlns=...><script>')],
    ['windows exe', bytes('MZ', 0x90)],
    ['gif', bytes('GIF89a')],
    ['xlsx / plain zip (no word/document.xml)', docx('xl/workbook.xml')],
    ['too short', new Uint8Array([0x25, 0x50])],
  ])('rejects %s', (_n, b) => expect(sniffMime(b)).toBeNull())
})

describe('validateUpload', () => {
  it('rejects by CONTENT even when the client calls an HTML file a .pdf', () => {
    expect(validateUpload({ size: 40, bytes: bytes('<html><body>') })).toEqual({ ok: false, code: 'unsupported_type' })
  })
  it('too_large above 20 MB without needing the bytes; exactly 20 MB passes', () => {
    expect(validateUpload({ size: MAX_UPLOAD_BYTES + 1 })).toEqual({ ok: false, code: 'too_large' })
    expect(validateUpload({ size: MAX_UPLOAD_BYTES, bytes: PDF })).toMatchObject({ ok: true })
  })
  it('empty file is unsupported', () => {
    expect(validateUpload({ size: 0, bytes: new Uint8Array() })).toEqual({ ok: false, code: 'unsupported_type' })
  })
  it('kind: pdf/docx are documents, images are photos unless declared a document scan', () => {
    expect(validateUpload({ size: 32, bytes: PDF })).toMatchObject({ kind: 'document' })
    expect(validateUpload({ size: 32, bytes: JPEG })).toMatchObject({ kind: 'photo' })
    expect(validateUpload({ size: 32, bytes: JPEG }, 'document')).toMatchObject({ kind: 'document' })
  })
})

describe('blob keys', () => {
  it('is account-namespaced, unguessable per upload, and never carries path parts from the filename', () => {
    const a = uploadBlobKey('acc-1', '../../etc/passwd')
    const b = uploadBlobKey('acc-1', '../../etc/passwd')
    expect(a.startsWith('assistant/acc-1/')).toBe(true)
    expect(a).not.toBe(b)
    expect(a.split('/')).toHaveLength(4)
    expect(a.endsWith('/passwd')).toBe(true)
  })
  it('round-trips a display name; hostile characters are neutralised', () => {
    expect(nameFromBlobKey(uploadBlobKey('a', 'Tarifas 2026.pdf', 'u'))).toBe('Tarifas 2026.pdf')
    expect(safeDisplayName('<script>.pdf')).toBe('_script_.pdf')
    expect(safeDisplayName('')).toBe('file')
  })
})
