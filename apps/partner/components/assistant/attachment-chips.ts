/**
 * Pure logic for composer attachments (track 030 S5b): which files are accepted, the pending-chip
 * state machine, and the mapping from `uploadAssistantFile` error codes to localized message keys.
 * No I/O here -- the Composer owns the uploads and feeds results in as actions.
 */

export const MAX_PENDING_ATTACHMENTS = 5
export const MAX_UPLOAD_MB = 20

/** `accept` attribute for the hidden file input. */
export const ACCEPT_ATTR =
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', DOCX_MIME])
const EXTS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'docx'])

const extOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** Cheap client-side pre-check (the server sniffs magic bytes and is the authority). Browsers often give HEIC an empty type, so the extension counts too. */
export function isAcceptedFile(file: { name: string; type: string }): boolean {
  return MIMES.has(file.type.toLowerCase()) || EXTS.has(extOf(file.name))
}

export function isHeic(file: { name: string; type: string }): boolean {
  return /^image\/hei[cf]$/i.test(file.type) || ['heic', 'heif'].includes(extOf(file.name))
}

export type AttachmentIcon = 'pdf' | 'image' | 'doc'

export function iconFor(file: { name: string; type?: string; kind?: 'document' | 'photo' }): AttachmentIcon {
  if (file.type === 'application/pdf' || extOf(file.name) === 'pdf') return 'pdf'
  if (file.kind === 'photo' || file.type?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(extOf(file.name))) return 'image'
  return 'doc'
}

/** Keys under `Assistant.attachments.errors`. */
export type AttachmentErrorKey = 'tooLarge' | 'unsupported' | 'heic' | 'rateLimited' | 'forbidden' | 'unavailable' | 'limit'

export function mapUploadError(errors: readonly string[] | undefined, file: { name: string; type: string }): AttachmentErrorKey {
  switch (errors?.[0]) {
    case 'too_large':
      return 'tooLarge'
    case 'unsupported_type':
      return isHeic(file) ? 'heic' : 'unsupported'
    case 'rate_limited':
      return 'rateLimited'
    case 'forbidden':
      return 'forbidden'
    default:
      return 'unavailable'
  }
}

export interface Chip {
  key: string
  name: string
  mime: string
  status: 'uploading' | 'done' | 'error'
  /** Server upload id once `done`. */
  id?: string
  kind?: 'document' | 'photo'
  error?: AttachmentErrorKey
}

export type ChipAction =
  | { type: 'add'; key: string; name: string; mime: string }
  | { type: 'done'; key: string; id: string; kind?: 'document' | 'photo' }
  | { type: 'failed'; key: string; error: AttachmentErrorKey }
  | { type: 'remove'; key: string }
  | { type: 'clear' }

export function chipReducer(state: Chip[], a: ChipAction): Chip[] {
  switch (a.type) {
    case 'add':
      if (state.length >= MAX_PENDING_ATTACHMENTS || state.some((c) => c.key === a.key)) return state
      return [...state, { key: a.key, name: a.name, mime: a.mime, status: 'uploading' }]
    case 'done':
      return state.map((c) => (c.key === a.key && c.status === 'uploading' ? { ...c, status: 'done', id: a.id, kind: a.kind } : c))
    case 'failed':
      return state.map((c) => (c.key === a.key && c.status === 'uploading' ? { ...c, status: 'error', error: a.error } : c))
    case 'remove':
      return state.filter((c) => c.key !== a.key)
    case 'clear':
      return state.length ? [] : state
  }
}

/** How many more files fit. Failed chips still hold a slot until removed. */
export const remainingSlots = (chips: readonly Chip[]) => Math.max(0, MAX_PENDING_ATTACHMENTS - chips.length)

export const uploadInFlight = (chips: readonly Chip[]) => chips.some((c) => c.status === 'uploading')

export const readyAttachments = (chips: readonly Chip[]) =>
  chips.filter((c): c is Chip & { id: string } => c.status === 'done' && !!c.id)

/** Send needs: no upload in flight, and either text or at least one uploaded file. */
export function canSend(chips: readonly Chip[], text: string): boolean {
  if (uploadInFlight(chips)) return false
  return text.trim() !== '' || readyAttachments(chips).length > 0
}
