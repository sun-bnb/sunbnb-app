/**
 * Turn the upload ids of a chat request into model content (track 030 S5).
 *
 *   resolveAttachments -- account-scoped + site-matched lookup (a foreign / purged / other-site id is
 *                         indistinguishable from a missing one)
 *   buildAttachmentContent -- PDF -> `document` block, image -> `image` block (normalised for the
 *                         vision limits), DOCX -> plain text extracted here and inlined as quoted data.
 *
 * Dependencies are injectable so the type-mapping is testable without Blob / sharp / mammoth.
 */
import type { ChatMedia } from '@repo/agent/model'
import { getUploadForAccount } from '@repo/data/assistant'
import { DOCX_MIME, MAX_ATTACHMENT_BYTES_PER_TURN, MAX_ATTACHMENTS_PER_TURN, nameFromBlobKey, readUploadBlob } from './uploads'

export interface ResolvedUpload {
  id: string
  name: string
  kind: 'document' | 'photo'
  mime: string
  url: string
  sizeBytes: number
}

export type ResolveResult =
  | { ok: true; uploads: ResolvedUpload[] }
  | { ok: false; reason: 'forbidden' | 'too_many' | 'too_large' }

export async function resolveAttachments(ids: readonly string[], accountId: string, siteId: string): Promise<ResolveResult> {
  if (ids.length > MAX_ATTACHMENTS_PER_TURN) return { ok: false, reason: 'too_many' }
  const uploads: ResolvedUpload[] = []
  for (const id of new Set(ids)) {
    const row = await getUploadForAccount(id, accountId)
    // Same answer for missing, foreign, purged, expired and other-site uploads.
    if (!row || row.siteId !== siteId || row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'forbidden' }
    uploads.push({
      id: row.id,
      name: nameFromBlobKey(row.blobKey),
      kind: row.purpose === 'photo' ? 'photo' : 'document',
      mime: row.mime,
      url: row.url,
      sizeBytes: row.sizeBytes,
    })
  }
  if (uploads.reduce((n, u) => n + u.sizeBytes, 0) > MAX_ATTACHMENT_BYTES_PER_TURN) return { ok: false, reason: 'too_large' }
  return { ok: true, uploads }
}

export interface AttachmentDeps {
  read: (url: string) => Promise<Buffer>
  docxToText: (buf: Buffer) => Promise<string>
  /** Returns bytes + media type the vision API accepts (<= 5 MB, jpeg/png/webp). */
  prepareImage: (buf: Buffer, mime: string) => Promise<{ data: Buffer; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }>
}

const MAX_DOCX_CHARS = 60_000
const IMAGE_PASSTHROUGH_BYTES = 3 * 1024 * 1024

export async function defaultDocxToText(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const r = await mammoth.extractRawText({ buffer: buf })
  return r.value
}

export async function defaultPrepareImage(buf: Buffer, mime: string) {
  if ((mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') && buf.length <= IMAGE_PASSTHROUGH_BYTES) {
    return { data: buf, mediaType: mime as 'image/jpeg' | 'image/png' | 'image/webp' }
  }
  // HEIC/HEIF, large photos: honour EXIF rotation, cap the long edge (the API downsizes beyond ~1568 px anyway).
  const sharp = (await import('sharp')).default
  const data = await sharp(buf).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  return { data, mediaType: 'image/jpeg' as const }
}

const tagSafe = (s: string) => s.replace(/[<>"]/g, '_')

export interface AttachmentContent {
  media: ChatMedia[]
  /** DOCX text, quoted as DATA. Appended to the user message for THIS turn only (not stored). */
  textBlock: string
}

export async function buildAttachmentContent(
  uploads: readonly ResolvedUpload[],
  deps: Partial<AttachmentDeps> = {},
): Promise<AttachmentContent> {
  const read = deps.read ?? readUploadBlob
  const docxToText = deps.docxToText ?? defaultDocxToText
  const prepareImage = deps.prepareImage ?? defaultPrepareImage
  const media: ChatMedia[] = []
  const texts: string[] = []
  for (const u of uploads) {
    const buf = await read(u.url)
    if (u.mime === 'application/pdf') {
      media.push({ type: 'document', mediaType: 'application/pdf', data: buf.toString('base64'), title: u.name })
    } else if (u.mime === DOCX_MIME) {
      let text = (await docxToText(buf)).trim()
      const truncated = text.length > MAX_DOCX_CHARS
      if (truncated) text = text.slice(0, MAX_DOCX_CHARS)
      // A document can't close our wrapper and speak as the system.
      text = text.replaceAll('</attached_document>', '')
      texts.push(`<attached_document name="${tagSafe(u.name)}">\n${text || '(no text found)'}${truncated ? '\n[truncated]' : ''}\n</attached_document>`)
    } else if (u.mime.startsWith('image/')) {
      const img = await prepareImage(buf, u.mime)
      media.push({ type: 'image', mediaType: img.mediaType, data: img.data.toString('base64') })
    } else {
      throw new Error(`unsupported attachment type ${u.mime}`)
    }
  }
  return { media, textBlock: texts.join('\n\n') }
}

export interface AttachmentMeta {
  id: string
  name: string
  kind: 'document' | 'photo'
}

export const attachmentMeta = (uploads: readonly ResolvedUpload[]): AttachmentMeta[] =>
  uploads.map((u) => ({ id: u.id, name: u.name, kind: u.kind }))
