/**
 * One prospect turn: send the conversation to the model, validate and execute any tool calls,
 * feed the results back, and repeat until the model answers in text (or the step cap is hit).
 *
 * Shared by the eval harness and, from P5, the `/api/chat` route — so what the eval measures is
 * the loop that ships.
 */
import type { ChatMessage, ChatResult, LeadAgentModel, ToolCall } from './model.ts'
import { TOOLS, validateToolCall } from './tools.ts'

export interface LeadState {
  name?: string
  email?: string
  phone?: string
  business_name?: string
  business_type?: string
  sunbed_count?: number
  demoRequested?: boolean
  mockupSunbedCount?: number
}

export interface ToolEvent {
  call: ToolCall
  /** Parsed arguments, or null when the model emitted invalid JSON. */
  args: Record<string, unknown> | null
  accepted: boolean
  errors: string[]
}

export interface TurnResult {
  /** Messages appended this turn (assistant + tool), in order. */
  messages: ChatMessage[]
  reply: string
  toolEvents: ToolEvent[]
  lead: LeadState
  modelCalls: ChatResult['timing'][]
  /** True when the step cap was reached without a text reply. */
  exhausted: boolean
}

export const MAX_STEPS_PER_TURN = 4

function applyTool(lead: LeadState, name: string, args: Record<string, unknown>): LeadState {
  switch (name) {
    case 'update_lead': {
      const next = { ...lead }
      for (const [k, v] of Object.entries(args)) {
        ;(next as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() : v
      }
      return next
    }
    case 'adjust_mockup':
      return { ...lead, mockupSunbedCount: args.sunbed_count as number }
    case 'request_demo': {
      const next: LeadState = { ...lead, demoRequested: true }
      for (const key of ['name', 'email', 'phone'] as const) {
        if (typeof args[key] === 'string') next[key] = (args[key] as string).trim()
      }
      return next
    }
    default:
      return lead
  }
}

export async function runTurn(
  model: LeadAgentModel,
  history: ChatMessage[],
  lead: LeadState,
): Promise<TurnResult> {
  const appended: ChatMessage[] = []
  const toolEvents: ToolEvent[] = []
  const modelCalls: ChatResult['timing'][] = []
  let state = lead
  const userText = history.flatMap((m) => (m.role === 'user' ? [m.content] : [])).join('\n')

  for (let step = 0; step < MAX_STEPS_PER_TURN; step++) {
    const result = await model.chat([...history, ...appended], TOOLS)
    modelCalls.push(result.timing)

    if (!result.toolCalls.length) {
      appended.push({ role: 'assistant', content: result.content, providerContent: result.providerContent })
      return { messages: appended, reply: result.content, toolEvents, lead: state, modelCalls, exhausted: false }
    }

    appended.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls, providerContent: result.providerContent })
    for (const call of result.toolCalls) {
      let args: Record<string, unknown> | null = null
      try {
        const parsed: unknown = JSON.parse(call.arguments || '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
      } catch {
        /* reported below */
      }
      const validation = args
        ? validateToolCall(call.name, args, { email: state.email, phone: state.phone, userText })
        : { ok: false as const, errors: ['arguments were not valid JSON'] }

      if (validation.ok && args) state = applyTool(state, call.name, args)
      const errors = validation.ok ? [] : validation.errors
      toolEvents.push({ call, args, accepted: validation.ok, errors })
      appended.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify(validation.ok ? { ok: true } : { ok: false, errors }),
      })
    }
  }

  return { messages: appended, reply: '', toolEvents, lead: state, modelCalls, exhausted: true }
}
