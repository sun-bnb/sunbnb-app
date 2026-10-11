/** Request parsing + response helpers for `/api/assistant` (track 030 S2). */
import { MAX_MESSAGE_CHARS } from './config'
import { MAX_ATTACHMENTS_PER_TURN } from './uploads'
import { parseClientContext, type ClientContext } from './context'

export type AssistantErrorCode = 'unavailable' | 'rate_limited' | 'budget' | 'forbidden' | 'bad_request'

export interface AssistantRequest {
  conversationId?: string
  siteId: string
  message: string
  context: ClientContext
  /** Upload ids (<= MAX_ATTACHMENTS_PER_TURN, deduplicated); verified account-scoped by the route. */
  attachments: string[]
}

export const ID = /^[A-Za-z0-9_-]{1,64}$/

/** Null = malformed. */
export function parseAssistantRequest(body: unknown): AssistantRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  if (typeof b.siteId !== 'string' || !ID.test(b.siteId)) return null
  if (typeof b.message !== 'string') return null
  const message = b.message.trim()
  if (!message || message.length > MAX_MESSAGE_CHARS) return null
  let conversationId: string | undefined
  if (b.conversationId !== undefined && b.conversationId !== null) {
    if (typeof b.conversationId !== 'string' || !ID.test(b.conversationId)) return null
    conversationId = b.conversationId
  }
  let attachments: string[] = []
  if (b.attachments !== undefined && b.attachments !== null) {
    if (!Array.isArray(b.attachments) || b.attachments.length > MAX_ATTACHMENTS_PER_TURN) return null
    if (!b.attachments.every((a) => typeof a === 'string' && ID.test(a))) return null
    attachments = [...new Set(b.attachments as string[])]
  }
  return { ...(conversationId ? { conversationId } : {}), siteId: b.siteId, message, context: parseClientContext(b.context), attachments }
}

const STATUS: Record<AssistantErrorCode, number> = {
  unavailable: 503,
  rate_limited: 429,
  budget: 503,
  forbidden: 403,
  bad_request: 400,
}

/** Pre-stream failure: JSON `{ status: 'error', code, message }`. 401 is `unauthenticated`. */
export function failure(code: AssistantErrorCode | 'unauthenticated', message: string): Response {
  const status = code === 'unauthenticated' ? 401 : STATUS[code]
  return Response.json({ status: 'error', code: code === 'unauthenticated' ? 'forbidden' : code, message }, { status })
}

const encoder = new TextEncoder()

/** One server-sent event. */
export function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}
