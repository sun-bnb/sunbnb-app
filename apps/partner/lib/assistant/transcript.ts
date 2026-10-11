/**
 * Stored transcript <-> model messages <-> what the drawer renders (track 030 S2).
 *
 * The stored transcript is the provider transcript (`ChatMessage[]`, thinking blocks included) and is
 * append-only. The GET endpoint must not leak it: it renders user/assistant text plus the tool
 * labels, nothing else.
 */
import type { ChatMessage } from '@repo/agent/model'
import { CONTEXT_CLOSE, CONTEXT_OPEN } from './context'
import { readPreview } from './proposals/create'
import type { Diff } from './proposals/types'
import { toolLabel } from './tools'

export type RenderProposalStatus = 'proposed' | 'applied' | 'rejected' | 'undone' | 'expired' | 'failed'

/** A proposal card as the drawer renders it on reload (current state, not the state at proposal time). */
export interface RenderProposal {
  actionId: string
  kind: string
  summary: string
  preview: Diff
  status: RenderProposalStatus
  /** ISO time the proposal was applied (lets the card offer Undo only inside the 24 h window). */
  appliedAt?: string
}

export interface RenderMessage {
  role: 'user' | 'assistant'
  text: string
  /** Files the user attached to this message (names only; the bytes are never replayed to the browser). */
  attachments?: { id: string; name: string; kind: 'document' | 'photo' }[]
  tools?: { name: string; label: string }[]
  proposals?: RenderProposal[]
}

type ProposalRow = { id: string; kind: string; preview: unknown; status: string; expiresAt: Date; appliedAt?: Date | null }

/** actionId -> card, built from the conversation's (account-scoped) `AssistantAction` rows. */
export function proposalLookup(rows: ProposalRow[], now: Date = new Date()): Map<string, RenderProposal> {
  const out = new Map<string, RenderProposal>()
  for (const r of rows) {
    const { summary, preview } = readPreview(r.preview)
    // A proposal nobody applied in time reads as expired even before the sweeper flips the row.
    const status = (r.status === 'proposed' && r.expiresAt.getTime() <= now.getTime() ? 'expired' : r.status) as RenderProposalStatus
    out.set(r.id, { actionId: r.id, kind: r.kind, summary, preview, status, ...(r.appliedAt ? { appliedAt: r.appliedAt.toISOString() } : {}) })
  }
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

type Attachment = NonNullable<RenderMessage['attachments']>[number]

function readAttachments(v: unknown): Attachment[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter(
    (a): a is Attachment => isObj(a) && typeof a.id === 'string' && typeof a.name === 'string' && (a.kind === 'document' || a.kind === 'photo'),
  ).map((a) => ({ id: a.id, name: a.name, kind: a.kind }))
  return out.length ? out : undefined
}

/** Defensive read of the stored JSON: only well-formed entries are replayed. */
export function toChatMessages(stored: unknown): ChatMessage[] {
  return parseStored(stored).map((e) => e.msg)
}

function parseStored(stored: unknown): { msg: ChatMessage; attachments?: Attachment[] }[] {
  if (!Array.isArray(stored)) return []
  const out: { msg: ChatMessage; attachments?: Attachment[] }[] = []
  for (const m of stored) {
    if (!isObj(m) || typeof m.content !== 'string') continue
    // Stored attachment metadata is for rendering only; the model never sees it as content.
    if (m.role === 'user') out.push({ msg: { role: 'user', content: m.content }, attachments: readAttachments(m.attachments) })
    else if (m.role === 'assistant') out.push({ msg: m as unknown as ChatMessage })
    else if (m.role === 'tool' && typeof m.toolCallId === 'string') out.push({ msg: { role: 'tool', toolCallId: m.toolCallId, content: m.content } })
  }
  return out
}

/** The user's text with the server-attached page context removed. */
export function userContent(message: string, contextBlock: string): string {
  // A user cannot forge the block: the tags are stripped from what they typed.
  const clean = message.replaceAll(CONTEXT_OPEN, '').replaceAll(CONTEXT_CLOSE, '')
  return contextBlock ? `${contextBlock}\n\n${clean}` : clean
}

export function stripContext(content: string): string {
  if (!content.startsWith(CONTEXT_OPEN)) return content
  const end = content.indexOf(CONTEXT_CLOSE)
  return end === -1 ? content : content.slice(end + CONTEXT_CLOSE.length).replace(/^\n\n/, '')
}

/** Server-written outcome notes ("[applied] ...") are for the model only; the cards show state. */
function withoutNotes(stored: unknown): unknown {
  return Array.isArray(stored) ? stored.filter((m) => !(isObj(m) && m.note === true)) : stored
}

/** The proposal a tool result created (`{ ok: true, actionId }`), if any. */
function proposalIdOf(toolContent: string): string | null {
  try {
    const v: unknown = JSON.parse(toolContent)
    return isObj(v) && v.ok === true && v.status === 'proposed' && typeof v.actionId === 'string' ? v.actionId : null
  } catch {
    return null
  }
}

export function toRenderMessages(stored: unknown, proposals?: Map<string, RenderProposal>): RenderMessage[] {
  const out: RenderMessage[] = []
  let lastWasAssistant = false
  for (const { msg: m, attachments } of parseStored(withoutNotes(stored))) {
    if (m.role === 'tool') {
      const id = proposals ? proposalIdOf(m.content) : null
      const card = id ? proposals!.get(id) : undefined
      const bubble = lastWasAssistant ? out[out.length - 1] : undefined
      if (card && bubble) bubble.proposals = [...(bubble.proposals ?? []), card]
      continue
    }
    if (m.role === 'user') {
      out.push({ role: 'user', text: stripContext(m.content), ...(attachments ? { attachments } : {}) })
      lastWasAssistant = false
    } else if (m.role === 'assistant') {
      const tools = (m.toolCalls ?? []).map((c) => ({ name: c.name, label: toolLabel(c.name) }))
      if (!m.content && tools.length === 0) continue
      // One user turn can span several assistant steps (tool round-trips): render them as one bubble.
      const prev = lastWasAssistant ? out[out.length - 1] : undefined
      if (prev) {
        prev.text = [prev.text, m.content].filter(Boolean).join('\n\n')
        if (tools.length) prev.tools = [...(prev.tools ?? []), ...tools]
      } else {
        out.push({ role: 'assistant', text: m.content, ...(tools.length ? { tools } : {}) })
      }
      lastWasAssistant = true
    }
  }
  return out
}
