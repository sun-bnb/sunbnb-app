/**
 * Pure SSE parser for the partner assistant stream (`POST /api/assistant`).
 *
 * Kept free of React / fetch so chunk-boundary behaviour is unit-testable
 * (partner vitest has no jsdom). Feed it decoded text chunks as they arrive;
 * it returns the complete, typed events found so far and buffers the rest.
 */

import type { ImageSize, SimilarityGeoref } from '@repo/agent/geo/georef'

export type AssistantErrorCode =
  | 'unavailable'
  | 'rate_limited'
  | 'budget'
  | 'forbidden'
  | 'bad_request'

const ERROR_CODES: readonly AssistantErrorCode[] = [
  'unavailable',
  'rate_limited',
  'budget',
  'forbidden',
  'bad_request',
]

export function toErrorCode(value: unknown): AssistantErrorCode {
  return ERROR_CODES.includes(value as AssistantErrorCode)
    ? (value as AssistantErrorCode)
    : 'unavailable'
}

export type AssistantEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; name: string; label: string }
  | { type: 'tool_result'; name: string; ok: boolean }
  | {
      type: 'proposal'
      actionId: string
      kind: string
      summary: string
      preview: unknown
      /** `applied` when the assistant acted immediately (act-immediately, track 030); absent = waiting for the user. */
      status?: 'applied'
      /** Epoch ms the server applied it. */
      appliedAt?: number
    }
  | { type: 'qr_print'; parcel?: number; seatLabels?: string[] }
  | { type: 'align_photo'; uploadId: string; seed: SimilarityGeoref; image: ImageSize }
  | { type: 'done'; conversationId?: string }
  | { type: 'error'; code: AssistantErrorCode; message: string }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Strict check of the MVP seed; anything else (homography, garbage) drops the event. */
export function parseSimilaritySeed(v: unknown): SimilarityGeoref | null {
  if (typeof v !== 'object' || v === null) return null
  const g = v as Record<string, unknown>
  if (g.kind !== 'similarity') return null
  const ap = g.anchorPx as Record<string, unknown> | undefined
  const an = g.anchor as Record<string, unknown> | undefined
  const x = num(ap?.x), y = num(ap?.y), lat = num(an?.lat), lng = num(an?.lng)
  const mpp = num(g.metersPerPx), rot = num(g.rotationDeg)
  if (x === null || y === null || lat === null || lng === null || mpp === null || rot === null) return null
  if (!(mpp > 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { kind: 'similarity', anchorPx: { x, y }, anchor: { lat, lng }, metersPerPx: mpp, rotationDeg: rot }
}

/** Maps one raw `event:` + parsed `data:` pair to a typed event; unknown/invalid -> null. */
export function toAssistantEvent(name: string, data: unknown): AssistantEvent | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  switch (name) {
    case 'conversation': {
      const conversationId = str(d.conversationId)
      return conversationId ? { type: 'conversation', conversationId } : null
    }
    case 'text': {
      const delta = str(d.delta)
      return delta !== null ? { type: 'text', delta } : null
    }
    case 'tool_start': {
      const n = str(d.name)
      return n ? { type: 'tool_start', name: n, label: str(d.label) ?? n } : null
    }
    case 'tool_result': {
      const n = str(d.name)
      return n ? { type: 'tool_result', name: n, ok: d.ok !== false } : null
    }
    case 'proposal': {
      const actionId = str(d.actionId)
      if (!actionId) return null
      return {
        type: 'proposal',
        actionId,
        kind: str(d.kind) ?? '',
        summary: str(d.summary) ?? '',
        preview: d.preview,
        ...(d.status === 'applied' ? { status: 'applied' as const, appliedAt: num(d.appliedAt) ?? Date.now() } : {}),
      }
    }
    case 'qr_print': {
      const parcel = typeof d.parcel === 'number' && Number.isFinite(d.parcel) ? d.parcel : undefined
      const seatLabels = Array.isArray(d.seatLabels)
        ? d.seatLabels.filter((l): l is string => typeof l === 'string' && l !== '')
        : undefined
      if (parcel === undefined && !seatLabels?.length) return null
      return { type: 'qr_print', ...(parcel !== undefined ? { parcel } : {}), ...(seatLabels?.length ? { seatLabels } : {}) }
    }
    case 'align_photo': {
      const uploadId = str(d.uploadId)
      const seed = parseSimilaritySeed(d.seed)
      const im = d.image as Record<string, unknown> | undefined
      const w = num(im?.w), h = num(im?.h)
      if (!uploadId || !seed || w === null || h === null || !(w > 0 && h > 0)) return null
      return { type: 'align_photo', uploadId, seed, image: { w, h } }
    }
    case 'done':
      return { type: 'done', conversationId: str(d.conversationId) ?? undefined }
    case 'error':
      return { type: 'error', code: toErrorCode(d.code), message: str(d.message) ?? '' }
    default:
      return null
  }
}

function parseBlock(block: string): AssistantEvent | null {
  let name = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue // blank / comment (keep-alive)
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') name = value
    else if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length === 0) return null
  try {
    return toAssistantEvent(name, JSON.parse(dataLines.join('\n')))
  } catch {
    return null
  }
}

export interface SseParser {
  /** Feed a decoded chunk; returns every event completed by it. */
  push(chunk: string): AssistantEvent[]
  /** End of stream: parse a final event the server left without a blank line. */
  flush(): AssistantEvent[]
}

export function createSseParser(): SseParser {
  let buffer = ''

  const drain = (final: boolean): AssistantEvent[] => {
    // A trailing "\r" may be the first half of "\r\n" split across chunks.
    let held = ''
    if (!final && buffer.endsWith('\r')) {
      held = '\r'
      buffer = buffer.slice(0, -1)
    }
    buffer = buffer.replace(/\r\n|\r/g, '\n')
    const parts = buffer.split('\n\n')
    buffer = final ? '' : parts.pop() ?? ''
    buffer += held
    const events: AssistantEvent[] = []
    for (const part of parts) {
      const ev = parseBlock(part)
      if (ev) events.push(ev)
    }
    return events
  }

  return {
    push(chunk) {
      buffer += chunk
      return drain(false)
    },
    flush() {
      return drain(true)
    },
  }
}
