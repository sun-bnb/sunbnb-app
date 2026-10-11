/**
 * Shared plumbing for the assistant's tools (track 030 S2).
 *
 * The context is bound by the ROUTE, never by the model: `siteId` comes from the authenticated
 * request, so no tool input can name another site. Every tool re-checks ownership per call
 * (`requireSiteOwner`, sudo-aware) and resolves every model-supplied handle (parcel number, seat
 * id, element short id, product name) WITHIN that site.
 */
import type { AgentTool } from '@repo/agent/loop'
import { requireSiteOwner } from '@/lib/auth-helpers'
import type { ClientContext } from '../context'

export interface AssistantToolCtx {
  session: unknown
  /** The site owner's account id (== PartnerAccount.userId). */
  accountId: string
  siteId: string
  locale: string
  /** The conversation the turn belongs to (bound by the route). Write tools attach proposals to it. */
  conversationId?: string
  /** Push an SSE event to the client mid-turn (`proposal` card, `qr_print`). */
  emit?: (event: string, data: unknown) => void
  /** Tokens a tool spent on its OWN model call (e.g. plan extraction); the route adds them to the conversation's usage. */
  recordUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  /** The sanitised page context the client sent this turn (selection, viewport). Ids are UNVERIFIED until resolved in-site. */
  pageContext?: ClientContext
}

export interface AssistantTool extends AgentTool<AssistantToolCtx> {
  /** Short, language-neutral phrase shown while the tool runs (`tool_start.label`). */
  label: string
}

type PropertySchema = Record<string, unknown>

export function defineTool(def: {
  name: string
  label: string
  description: string
  properties?: Record<string, PropertySchema>
  required?: string[]
  run: (input: Record<string, unknown>, ctx: AssistantToolCtx) => unknown | Promise<unknown>
}): AssistantTool {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    inputSchema: {
      type: 'object',
      properties: def.properties ?? {},
      required: def.required ?? [],
      additionalProperties: false,
    },
    async run(input, ctx) {
      const { error } = await requireSiteOwner(ctx.siteId)
      if (error) return { ok: false, error: 'forbidden' }
      try {
        return await def.run(input, ctx)
      } catch (err) {
        console.error(`[assistant] tool ${def.name} failed`, err)
        return { ok: false, error: 'tool_failed' }
      }
    },
  }
}

/** Longest list any tool returns; beyond it the result says `truncated: true` with the real `total`. */
export const MAX_LIST = 50

export function capList<T>(rows: T[], max = MAX_LIST): { rows: T[]; truncated: boolean; total: number } {
  return { rows: rows.slice(0, max), truncated: rows.length > max, total: rows.length }
}

export const round2 = (n: number): number => Math.round(n * 100) / 100

/** A layout element's model-facing handle: the last 6 characters of its id (random part of a cuid). */
export function elementHandle(id: string): string {
  return id.slice(-6)
}

/** `1-2-3-1` (parcel-row-unit-member) -> the stored seat label `1-203-1`; null when not in that form. */
export function storedSeatLabel(seatId: string): { label: string; unitPrefix: string } | null {
  const m = /^(\d{1,4})-(\d{1,3})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(seatId.trim())
  if (!m) return null
  const [, parcel, row, seq, member] = m
  const middle = `${Number(row)}${String(Number(seq)).padStart(2, '0')}`
  const unitPrefix = `${Number(parcel)}-${middle}-`
  return { unitPrefix, label: member ? `${unitPrefix}${Number(member)}` : unitPrefix }
}

/** Mask a bank account: keep the first 2 characters (country) and the last 4. */
export function maskIban(value: string | null | undefined): string | null {
  if (!value) return null
  const compact = value.replace(/\s+/g, '')
  if (compact.length <= 6) return '••••'
  return `${compact.slice(0, 2)}••••${compact.slice(-4)}`
}
