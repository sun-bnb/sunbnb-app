/**
 * Company-document / photo uploads for the assistant (track 030 S5): type sniffing, key layout and the
 * Blob read/write seam. Pure where possible so the validation rules are unit-testable.
 *
 * The file type is decided by the BYTES, never by the client's `file.type` or extension: a renamed
 * executable or an SVG-with-script is "unsupported_type" however it is labelled.
 */
import { del, get, put } from '@vercel/blob'

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
/** Per-account upload cap (D7-style). */
export const UPLOADS_PER_DAY = 30
export const MAX_ATTACHMENTS_PER_TURN = 5
/** Sum of attachment bytes the model is sent in ONE turn (PDF requests top out at 32 MB incl. base64). */
export const MAX_ATTACHMENT_BYTES_PER_TURN = 20 * 1024 * 1024

export type UploadErrorCode = 'too_large' | 'unsupported_type' | 'forbidden' | 'rate_limited' | 'unavailable'
export type UploadKind = 'document' | 'photo'

export type SniffedMime =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** The real type from the leading bytes, or null when it is not one we accept. */
export function sniffMime(bytes: Uint8Array): SniffedMime | null {
  if (bytes.length < 12) return null
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp'
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12)
    if (HEIF_BRANDS.has(brand)) return brand === 'mif1' || brand === 'msf1' ? 'image/heif' : 'image/heic'
  }
  // DOCX is a zip: local-file-header magic + the Word main part's name (a plain zip / xlsx is rejected).
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return Buffer.from(bytes).toString('latin1').includes('word/document.xml') ? DOCX_MIME : null
  }
  return null
}

export function kindOfMime(mime: string, requested?: unknown): UploadKind {
  if (mime.startsWith('image/')) return requested === 'document' ? 'document' : 'photo'
  return 'document'
}

export type ValidatedUpload =
  | { ok: true; mime: SniffedMime; kind: UploadKind; sizeBytes: number }
  | { ok: false; code: 'too_large' | 'unsupported_type' }

/** Size first (cheap, no read needed), then the bytes. Empty files are an unsupported type. */
export function validateUpload(input: { size: number; bytes?: Uint8Array }, requestedKind?: unknown): ValidatedUpload {
  if (input.size > MAX_UPLOAD_BYTES) return { ok: false, code: 'too_large' }
  if (input.size === 0 || !input.bytes) return { ok: false, code: 'unsupported_type' }
  if (input.bytes.length > MAX_UPLOAD_BYTES) return { ok: false, code: 'too_large' }
  const mime = sniffMime(input.bytes)
  if (!mime) return { ok: false, code: 'unsupported_type' }
  return { ok: true, mime, kind: kindOfMime(mime, requestedKind), sizeBytes: input.bytes.length }
}

// ─── Keys ───────────────────────────────────────────────────────────────────

/** Filename safe to embed in a key and to show back: no path parts, control chars or leading dots. */
export function safeDisplayName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const clean = base.replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/^\.+/, '').trim().slice(0, 80)
  return clean || 'file'
}

/**
 * `assistant/{accountId}/{uuid}/{name}`: unguessable (random uuid segment), account-namespaced, and
 * carries the original name so the row needs no extra column (the name is read back from the key).
 */
export function uploadBlobKey(accountId: string, name: string, uuid: string = crypto.randomUUID()): string {
  return `assistant/${accountId}/${uuid}/${safeDisplayName(name)}`
}

export function nameFromBlobKey(blobKey: string): string {
  return blobKey.split('/').pop() || 'file'
}

// ─── Blob seam ──────────────────────────────────────────────────────────────

/**
 * Uploads live in the PRIVATE store (`ASSISTANT_BLOB_READ_WRITE_TOKEN`, Vercel store
 * `sunbnb-private-blob`) — company documents must not be reachable by URL. Without that token
 * (local dev before setup) they fall back to the default store: private when it allows it, else
 * public with the same unguessable key (never listed to users).
 */
function privateToken(): string | undefined {
  return process.env.ASSISTANT_BLOB_READ_WRITE_TOKEN || undefined
}

export async function storeUploadBlob(key: string, bytes: Buffer, contentType: string): Promise<{ url: string; access: 'private' | 'public' }> {
  const token = privateToken()
  if (token) {
    const b = await put(key, bytes, { access: 'private', addRandomSuffix: false, contentType, token })
    return { url: b.url, access: 'private' }
  }
  try {
    const b = await put(key, bytes, { access: 'private', addRandomSuffix: false, contentType })
    return { url: b.url, access: 'private' }
  } catch {
    const b = await put(key, bytes, { access: 'public', addRandomSuffix: false, contentType })
    return { url: b.url, access: 'public' }
  }
}

function isPrivateUrl(url: string): boolean {
  return url.includes('.private.blob.')
}

export async function readUploadBlob(url: string): Promise<Buffer> {
  if (!isPrivateUrl(url)) {
    try {
      const res = await fetch(url)
      if (res.ok) return Buffer.from(await res.arrayBuffer())
    } catch {
      /* fall through to the authenticated read */
    }
  }
  const token = privateToken()
  const r = await get(url, { access: 'private', ...(token ? { token } : {}) })
  if (!r || r.statusCode !== 200) throw new Error('upload blob unreadable')
  return Buffer.from(await new Response(r.stream).arrayBuffer())
}

export async function deleteUploadBlob(url: string): Promise<void> {
  const token = isPrivateUrl(url) ? privateToken() : undefined
  await del(url, token ? { token } : undefined)
}
