/**
 * Pure rules for the /api/chat route (track 027 P5): request validation and the mapping between
 * the agent's `LeadState` and the lead's columns. Tested without Next or a database.
 */
import { LEAD_TOKEN_RE } from '@repo/data/lead-model'
import type { LeadState } from './agent/run-turn.ts'

export const MAX_CHAT_MESSAGE_CHARS = 1000
const SESSION_RE = /^[0-9a-f-]{36}$/

export interface ChatRequest {
  token: string
  sessionId: string
  message: string
}

export function parseChatRequest(body: unknown): ChatRequest | null {
  if (!body || typeof body !== 'object') return null
  const { token, sessionId, message } = body as Record<string, unknown>
  if (typeof token !== 'string' || !LEAD_TOKEN_RE.test(token)) return null
  if (typeof sessionId !== 'string' || !SESSION_RE.test(sessionId)) return null
  if (typeof message !== 'string') return null
  const trimmed = message.trim()
  if (!trimmed || trimmed.length > MAX_CHAT_MESSAGE_CHARS) return null
  return { token, sessionId, message: trimmed }
}

/** What the lead row already knows, as the agent's starting state for a turn. */
export function leadStateFromRow(row: {
  status: string
  sunbedCount: number
  contactName: string | null
  email: string | null
  phone: string | null
  businessName: string | null
  businessType: string | null
}): LeadState {
  const s: LeadState = { mockupSunbedCount: row.sunbedCount, demoRequested: row.status !== 'mockup' }
  if (row.contactName) s.name = row.contactName
  if (row.email) s.email = row.email
  if (row.phone) s.phone = row.phone
  if (row.businessName) s.business_name = row.businessName
  if (row.businessType) s.business_type = row.businessType
  return s
}

/**
 * The effects of one turn, as a column patch: only fields that CHANGED, so a turn that touched
 * nothing writes nothing. A sunbed count the prospect states about their own beach also resizes
 * the mockup — it is the same number.
 */
export function turnEffects(before: LeadState, after: LeadState) {
  const contact: { contactName?: string; email?: string; phone?: string; businessName?: string; businessType?: string } = {}
  if (after.name && after.name !== before.name) contact.contactName = after.name
  if (after.email && after.email !== before.email) contact.email = after.email
  if (after.phone && after.phone !== before.phone) contact.phone = after.phone
  if (after.business_name && after.business_name !== before.business_name) contact.businessName = after.business_name
  if (after.business_type && after.business_type !== before.business_type) contact.businessType = after.business_type

  const newCount =
    after.mockupSunbedCount !== before.mockupSunbedCount
      ? after.mockupSunbedCount
      : after.sunbed_count !== undefined && after.sunbed_count !== before.sunbed_count
        ? after.sunbed_count
        : undefined

  return {
    contact,
    sunbedCount: newCount,
    demoRequested: Boolean(after.demoRequested && !before.demoRequested),
  }
}
