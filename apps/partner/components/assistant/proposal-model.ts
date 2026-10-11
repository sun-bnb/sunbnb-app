/**
 * Pure helpers for rendering assistant proposals (track 030 S3b). No React, no
 * I/O: value formatting, defensive preview parsing, the typed-delete gate and
 * the server-error-code mapping all live here so they are unit-testable.
 */

export type ProposalStatus = 'proposed' | 'applied' | 'rejected' | 'undone' | 'expired' | 'failed'
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'proposed',
  'applied',
  'rejected',
  'undone',
  'expired',
  'failed',
]

export type PreviewScalar = string | number | boolean | null

export interface PreviewChange {
  target: string
  field: string
  label: string
  before: PreviewScalar
  after: PreviewScalar
}
export interface PreviewCreate {
  target: string
  fields: Record<string, PreviewScalar>
}
export interface PreviewDelete {
  target: string
  label: string
}
export interface ProposalPreview {
  changes: PreviewChange[]
  creates: PreviewCreate[]
  deletes: PreviewDelete[]
  warnings: string[]
}

/** Server undo window (D10). The server is authoritative; this only hides a dead button. */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000
/** Text the user must type before a proposal containing deletes can be applied. */
export const DELETE_CONFIRM_WORD = 'DELETE'
/** Long text collapses beyond this many characters until expanded. */
export const TRUNCATE_AT = 60

export const toStatus = (v: unknown): ProposalStatus =>
  PROPOSAL_STATUSES.includes(v as ProposalStatus) ? (v as ProposalStatus) : 'proposed'

const isScalar = (v: unknown): v is PreviewScalar =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v)
const scalar = (v: unknown): PreviewScalar => (isScalar(v) ? v : v === undefined ? null : String(v))
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Tolerant parse: the preview crosses a network/JSON boundary, never trust its shape. */
export function parsePreview(raw: unknown): ProposalPreview {
  const o = isObj(raw) ? raw : {}
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  return {
    changes: arr(o.changes)
      .filter(isObj)
      .map((c) => ({
        target: str(c.target),
        field: str(c.field),
        label: str(c.label) || str(c.field),
        before: scalar(c.before),
        after: scalar(c.after),
      })),
    creates: arr(o.creates)
      .filter(isObj)
      .map((c) => ({
        target: str(c.target),
        fields: isObj(c.fields)
          ? Object.fromEntries(Object.entries(c.fields).map(([k, v]) => [k, scalar(v)]))
          : {},
      })),
    deletes: arr(o.deletes)
      .filter(isObj)
      .map((d) => ({ target: str(d.target), label: str(d.label) })),
    warnings: arr(o.warnings).filter((w): w is string => typeof w === 'string' && w !== ''),
  }
}

export type FormattedValue =
  | { kind: 'empty' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'text'; text: string; full: string; truncated: boolean }

/** Booleans become on/off (rendered translated), null/'' an em dash, long text is cut. */
export function formatValue(v: PreviewScalar | undefined, expanded = false, max = TRUNCATE_AT): FormattedValue {
  if (v === null || v === undefined || v === '') return { kind: 'empty' }
  if (typeof v === 'boolean') return { kind: 'bool', value: v }
  const full = String(v)
  if (!expanded && full.length > max) {
    return { kind: 'text', text: `${full.slice(0, max).trimEnd()}…`, full, truncated: true }
  }
  return { kind: 'text', text: full, full, truncated: false }
}

export const hasDeletes = (p: ProposalPreview) => p.deletes.length > 0

/** Apply is blocked until the exact word is typed when the proposal deletes anything. */
export function canApply(preview: ProposalPreview, typed: string): boolean {
  return !hasDeletes(preview) || typed.trim().toUpperCase() === DELETE_CONFIRM_WORD
}

/** Deletes are not undoable (D10); undo only within 24h when we know when it was applied. */
export function canUndo(
  status: ProposalStatus,
  preview: ProposalPreview,
  appliedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  if (status !== 'applied' || hasDeletes(preview)) return false
  return appliedAt === undefined || now - appliedAt < UNDO_WINDOW_MS
}

export const KNOWN_ERRORS = [
  'not_found',
  'forbidden',
  'expired',
  'stale',
  'already_resolved',
  'undo_window',
  'apply_failed',
] as const
export type ProposalErrorCode = (typeof KNOWN_ERRORS)[number] | 'unknown'

export const toErrorCode = (errors?: string[]): ProposalErrorCode =>
  KNOWN_ERRORS.find((c) => c === errors?.[0]) ?? 'unknown'

/** Status the proposal should take after an action failed with this code. */
export function statusAfterError(code: ProposalErrorCode): ProposalStatus | null {
  if (code === 'expired') return 'expired'
  if (code === 'apply_failed') return 'failed'
  return null
}

/** Keeps the 'Proposal' badge tone in one place (green/red/amber/blue palette). */
export const STATUS_TONE: Record<ProposalStatus, string> = {
  proposed: 'border-blue-200 bg-blue-50 text-blue-700',
  applied: 'border-green-200 bg-green-50 text-green-700',
  rejected: 'border-gray-200 bg-gray-50 text-gray-600',
  undone: 'border-amber-200 bg-amber-50 text-amber-700',
  expired: 'border-amber-200 bg-amber-50 text-amber-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
}

// ─── Photo placement (kind `place_image`) ───────────────────────────────────

export const IMAGE_TARGETS = ['cover', 'product', 'rental_item', 'brand_logo', 'brand_background', 'schematic_underlay'] as const
export type ImageTarget = (typeof IMAGE_TARGETS)[number]

export interface ImagePreview {
  target: ImageTarget
  fileName: string
  /** Product / rental item name, when the target has one. */
  itemName: string
  /** The upload id: the new photo is fetched through `uploadThumbSrc` (the blob may be private). */
  uploadId: string | null
  /** The slot's current public image URL, or null when the slot is empty. */
  previousUrl: string | null
}

/** Tolerant parse of `preview.image`; null for anything but a known placement target. */
export function parseImagePreview(raw: unknown): ImagePreview | null {
  const o = isObj(raw) && isObj(raw.image) ? raw.image : null
  if (!o || !IMAGE_TARGETS.includes(o.target as ImageTarget)) return null
  return {
    target: o.target as ImageTarget,
    fileName: str(o.fileName),
    itemName: str(o.itemName),
    uploadId: typeof o.uploadId === 'string' && o.uploadId ? o.uploadId : null,
    previousUrl: typeof o.previousUrl === 'string' && o.previousUrl ? o.previousUrl : null,
  }
}

/** Same-origin, session-authenticated thumbnail of an assistant upload. */
export const uploadThumbSrc = (uploadId: string): string => `/api/assistant/uploads/${encodeURIComponent(uploadId)}`

/** Attachments that get a thumbnail in the transcript: uploaded photos (documents stay chips). */
export const hasThumbnail = (a: { id?: string; kind?: 'document' | 'photo' }): boolean => !!a.id && a.kind === 'photo'

// ─── Human-readable "will be created" rows (track 030 polish) ───────────────
// The server ships raw `fields` (rows, seatsPerRow, width ...). Parcels and layout elements are
// recognised by their field signature (not the proposal kind, so every kind that emits them
// benefits) and turned into a structured view the card translates; anything else stays generic.

/** camelCase / snake_case key -> "Sentence case words" (the fallback label for unknown keys). */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

const num = (v: PreviewScalar | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Where a created parcel goes: schematic metres, a geo point (shown as "on the map"), or unknown. */
export type ParcelPosition =
  | { kind: 'schematic'; x: string; y: string }
  | { kind: 'geo'; text: string }
  | null

export function parsePosition(v: PreviewScalar | undefined): ParcelPosition {
  if (typeof v !== 'string' || !v.trim()) return null
  const m = /^x\s*(-?\d+(?:\.\d+)?)\s*,\s*y\s*(-?\d+(?:\.\d+)?)$/i.exec(v.trim())
  return m ? { kind: 'schematic', x: m[1]!, y: m[2]! } : { kind: 'geo', text: v.trim() }
}

export interface FieldRow {
  key: string
  /** Humanized fallback label; the card prefers a translated `fields.<key>` when one exists. */
  fallbackLabel: string
  value: PreviewScalar
}

export type CreateView =
  | {
      kind: 'parcel'
      rows: number
      perRow: number
      total: number | null
      paired: boolean
      /** Degrees; null when 0 / absent (nothing worth saying). */
      rotation: number | null
      position: ParcelPosition
      extras: FieldRow[]
    }
  | {
      kind: 'element'
      type: string
      label: string | null
      width: number
      height: number
      x: number
      y: number
      rotation: number | null
      extras: FieldRow[]
    }
  | { kind: 'generic'; fields: FieldRow[] }

const PARCEL_KEYS = ['rows', 'seatsPerRow', 'sunbeds', 'paired', 'rotation', 'position']
const ELEMENT_KEYS = ['type', 'x', 'y', 'width', 'height', 'rotation', 'label']
const rowsOf = (fields: Record<string, PreviewScalar>, skip: string[]): FieldRow[] =>
  Object.entries(fields)
    .filter(([k]) => !skip.includes(k))
    .map(([key, value]) => ({ key, fallbackLabel: humanizeKey(key), value }))
const nonZero = (n: number | null) => (n === null || n === 0 ? null : n)

export function describeCreate(fields: Record<string, PreviewScalar>): CreateView {
  const rows = num(fields.rows)
  const perRow = num(fields.seatsPerRow)
  if (rows !== null && perRow !== null) {
    return {
      kind: 'parcel',
      rows,
      perRow,
      total: num(fields.sunbeds),
      paired: fields.paired === true,
      rotation: nonZero(num(fields.rotation)),
      position: parsePosition(fields.position),
      extras: rowsOf(fields, PARCEL_KEYS),
    }
  }
  const [w, h, x, y] = [num(fields.width), num(fields.height), num(fields.x), num(fields.y)]
  if (typeof fields.type === 'string' && fields.type && w !== null && h !== null && x !== null && y !== null) {
    return {
      kind: 'element',
      type: fields.type,
      label: typeof fields.label === 'string' && fields.label ? fields.label : null,
      width: w,
      height: h,
      x,
      y,
      rotation: nonZero(num(fields.rotation)),
      extras: rowsOf(fields, ELEMENT_KEYS),
    }
  }
  return { kind: 'generic', fields: rowsOf(fields, []) }
}
