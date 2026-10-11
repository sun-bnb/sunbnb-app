/**
 * Pure state machine for one site's assistant conversation. The module store
 * (`assistant-store.ts`) owns I/O and feeds actions in; this file has none, so
 * every transition is unit-testable.
 */
import type { ImageSize, SimilarityGeoref } from '@repo/agent/geo/georef'
import { toStatus, type ProposalStatus } from './proposal-model'
import type { AssistantErrorCode, AssistantEvent } from './sse-parser'

export interface ToolActivity {
  name: string
  label: string
  status: 'running' | 'done' | 'failed'
}

export interface ProposalInfo {
  actionId: string
  kind: string
  summary: string
  preview?: unknown
  status: ProposalStatus
  /** Epoch ms of a local apply; undefined for restored transcripts. */
  appliedAt?: number
  /** The assistant applied it itself during this turn (act-immediately); the card is a done card from the start. */
  auto?: boolean
}

/** A `qr_print` request: print QR cards for a whole parcel and/or specific seats. */
export interface QrPrintRequest {
  parcel?: number
  seatLabels?: string[]
}

/** An `align_photo` request: the assistant wants the user to georeference an uploaded aerial photo. */
export interface AlignPhotoRequest {
  uploadId: string
  seed: SimilarityGeoref
  image: ImageSize
}

/** A file shown on a user message. Names only: the bytes live server-side. */
export interface AttachmentInfo {
  id?: string
  name: string
  kind?: 'document' | 'photo'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolActivity[]
  proposals: ProposalInfo[]
  /** QR print requests the assistant made this turn (rendered as buttons; needs a user gesture). */
  qrPrints?: QrPrintRequest[]
  /** Photo-alignment requests this turn (rendered as a button that opens the map alignment mode). */
  alignPhotos?: AlignPhotoRequest[]
  /** Files attached to a user message. */
  attachments?: AttachmentInfo[]
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  text: string
  attachments?: AttachmentInfo[]
  tools?: { name: string; label: string }[]
  proposals?: {
    actionId: string
    kind: string
    summary: string
    preview?: unknown
    status?: string
  }[]
}

/** unknown = not probed yet; hidden = forbidden (no button at all). */
export type Availability = 'unknown' | 'available' | 'unavailable' | 'hidden'
export type StreamStatus = 'idle' | 'streaming'

export interface AssistantState {
  open: boolean
  availability: Availability
  messages: ChatMessage[]
  conversationId: string | null
  status: StreamStatus
  error: AssistantErrorCode | null
}

export const INITIAL_STATE: AssistantState = {
  open: false,
  availability: 'unknown',
  messages: [],
  conversationId: null,
  status: 'idle',
  error: null,
}

export type AssistantAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'toggle' }
  | {
      type: 'probed'
      availability: Availability
      conversationId?: string | null
      history?: HistoryMessage[]
    }
  | { type: 'user_sent'; userId: string; assistantId: string; text: string; attachments?: AttachmentInfo[] }
  | { type: 'event'; event: AssistantEvent }
  | { type: 'failed'; code: AssistantErrorCode }
  | { type: 'stopped' }
  | { type: 'ended' }
  | { type: 'proposal_status'; actionId: string; status: ProposalStatus; appliedAt?: number }
  | { type: 'reset' }

const isEmptyAssistant = (m: ChatMessage | undefined) =>
  !!m && m.role === 'assistant' && m.text === '' && m.tools.length === 0 && m.proposals.length === 0 && !m.qrPrints?.length && !m.alignPhotos?.length

/** Drops an empty trailing assistant placeholder and settles still-running tools. */
function settle(messages: ChatMessage[]): ChatMessage[] {
  let out = messages
  if (isEmptyAssistant(out[out.length - 1])) out = out.slice(0, -1)
  const last = out[out.length - 1]
  if (last?.role === 'assistant' && last.tools.some((t) => t.status === 'running')) {
    out = [
      ...out.slice(0, -1),
      {
        ...last,
        tools: last.tools.map((t) => (t.status === 'running' ? { ...t, status: 'failed' as const } : t)),
      },
    ]
  }
  return out
}

function updateLastAssistant(
  messages: ChatMessage[],
  fn: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const i = messages.length - 1
  const last = messages[i]
  if (!last || last.role !== 'assistant') return messages
  return [...messages.slice(0, i), fn(last)]
}

function applyEvent(state: AssistantState, ev: AssistantEvent): AssistantState {
  switch (ev.type) {
    case 'conversation':
      return { ...state, conversationId: ev.conversationId }
    case 'done':
      return {
        ...state,
        conversationId: ev.conversationId ?? state.conversationId,
        status: 'idle',
        messages: settle(state.messages),
      }
    case 'text':
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (m) => ({ ...m, text: m.text + ev.delta })),
      }
    case 'tool_start':
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (m) => ({
          ...m,
          tools: [...m.tools, { name: ev.name, label: ev.label, status: 'running' }],
        })),
      }
    case 'tool_result':
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (m) => {
          // Settle the most recent still-running call of that tool.
          let idx = -1
          for (let i = m.tools.length - 1; i >= 0; i--) {
            const tool = m.tools[i]
            if (tool && tool.name === ev.name && tool.status === 'running') {
              idx = i
              break
            }
          }
          if (idx === -1) return m
          const tools = m.tools.slice()
          tools[idx] = { ...tools[idx]!, status: ev.ok ? 'done' : 'failed' }
          return { ...m, tools }
        }),
      }
    case 'proposal':
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (m) => ({
          ...m,
          proposals: [
            ...m.proposals,
            {
              actionId: ev.actionId,
              kind: ev.kind,
              summary: ev.summary,
              preview: ev.preview,
              ...(ev.status === 'applied'
                ? { status: 'applied' as const, appliedAt: ev.appliedAt, auto: true }
                : { status: 'proposed' as const }),
            },
          ],
        })),
      }
    case 'qr_print':
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (m) => ({
          ...m,
          qrPrints: [...(m.qrPrints ?? []), { parcel: ev.parcel, seatLabels: ev.seatLabels }],
        })),
      }
    case 'align_photo':
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (m) => ({
          ...m,
          alignPhotos: [...(m.alignPhotos ?? []), { uploadId: ev.uploadId, seed: ev.seed, image: ev.image }],
        })),
      }
    case 'error':
      return fail(state, ev.code)
  }
}

function fail(state: AssistantState, code: AssistantErrorCode): AssistantState {
  return {
    ...state,
    status: 'idle',
    error: code,
    availability: code === 'forbidden' ? 'hidden' : state.availability,
    messages: settle(state.messages),
  }
}

export function reduce(state: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case 'open':
      return state.open ? state : { ...state, open: true }
    case 'close':
      return state.open ? { ...state, open: false } : state
    case 'toggle':
      return { ...state, open: !state.open }
    case 'probed': {
      const canAdopt = state.status === 'idle' && state.messages.length === 0
      return {
        ...state,
        availability: action.availability,
        conversationId: canAdopt ? action.conversationId ?? null : state.conversationId,
        messages:
          canAdopt && action.history
            ? action.history.map((h, i) => ({
                id: `h${i}`,
                role: h.role,
                text: h.text,
                ...(h.attachments?.length ? { attachments: h.attachments } : {}),
                tools: (h.tools ?? []).map((t) => ({ ...t, status: 'done' as const })),
                proposals: (h.proposals ?? []).map((p) => ({ ...p, status: toStatus(p.status) })),
              }))
            : state.messages,
      }
    }
    case 'user_sent':
      return {
        ...state,
        status: 'streaming',
        error: null,
        messages: [
          ...state.messages,
          {
            id: action.userId,
            role: 'user',
            text: action.text,
            tools: [],
            proposals: [],
            ...(action.attachments?.length ? { attachments: action.attachments } : {}),
          },
          { id: action.assistantId, role: 'assistant', text: '', tools: [], proposals: [] },
        ],
      }
    case 'event':
      return applyEvent(state, action.event)
    case 'failed':
      return fail(state, action.code)
    case 'stopped':
    case 'ended':
      return state.status === 'idle' && action.type === 'ended'
        ? state
        : { ...state, status: 'idle', messages: settle(state.messages) }
    case 'proposal_status': {
      let changed = false
      const messages = state.messages.map((m) => {
        if (!m.proposals.some((p) => p.actionId === action.actionId && (p.status !== action.status || p.appliedAt !== action.appliedAt))) return m
        changed = true
        return {
          ...m,
          proposals: m.proposals.map((p) =>
            p.actionId === action.actionId
              ? { ...p, status: action.status, appliedAt: action.appliedAt ?? p.appliedAt }
              : p,
          ),
        }
      })
      return changed ? { ...state, messages } : state
    }
    case 'reset':
      return { ...state, messages: [], conversationId: null, status: 'idle', error: null }
  }
}
