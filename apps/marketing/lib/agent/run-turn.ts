/**
 * One prospect turn: send the conversation to the model, validate and execute any tool calls,
 * feed the results back, and repeat until the model answers in text (or the step cap is hit).
 *
 * Shared by the eval harness and, from P5, the `/api/chat` route — so what the eval measures is
 * the loop that ships.
 */
import type { ChatMessage, ChatResult, LeadAgentModel, ToolCall } from './model.ts'
import { extractContact } from './contact-capture.ts'
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
  /** Executed by the server (contact capture), not proposed by the model. */
  auto?: boolean
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

export interface RunTurnOptions {
  /**
   * Book the demo SERVER-SIDE when the prospect's latest message contains an email or phone
   * (`contact-capture.ts`), before the model replies. On in production and in the eval.
   */
  autoCapture?: boolean
}

export async function runTurn(
  model: LeadAgentModel,
  history: ChatMessage[],
  lead: LeadState,
  options: RunTurnOptions = {},
): Promise<TurnResult> {
  const appended: ChatMessage[] = []
  const toolEvents: ToolEvent[] = []
  const modelCalls: ChatResult['timing'][] = []
  let state = lead
  const userText = history.flatMap((m) => (m.role === 'user' ? [m.content] : [])).join('\n')
  // A model may answer AND call a tool in the same step ("Yes, guests can order… " + update_lead),
  // then add nothing after the tool result. The prospect's reply is every step's text, not only the
  // last step's — reporting just the last one dropped real answers (haiku-4-5, 2026-10-04).
  const texts: string[] = []

  // Executes a tool call (model-proposed or server-made), records it, and feeds the result back.
  const execute = (call: ToolCall, auto = false) => {
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
    toolEvents.push({ call, args, accepted: validation.ok, errors, ...(auto ? { auto: true } : {}) })
    appended.push({
      role: 'tool',
      toolCallId: call.id,
      content: JSON.stringify(
        !validation.ok
          ? { ok: false, errors }
          : auto
            ? // The model didn't make this call, so it would otherwise skip the rest of the message.
              { ok: true, note: 'Saved their contact and requested the demo for them. Still save any name, business name, business type or sunbed count from their message with update_lead.' }
            : { ok: true },
      ),
    })
  }

  if (options.autoCapture) {
    const latest = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
    const found = extractContact(latest)
    const fresh: Record<string, string> = {}
    if (found.email && found.email !== state.email) fresh.email = found.email
    if (found.phone && found.phone !== state.phone) fresh.phone = found.phone
    if (Object.keys(fresh).length) {
      // Shown to the model as its own completed call, so its reply matches what happened.
      const call: ToolCall = {
        id: `auto_${toolEvents.length}_${Date.now()}`,
        name: state.demoRequested ? 'update_lead' : 'request_demo',
        arguments: JSON.stringify(fresh),
      }
      appended.push({ role: 'assistant', content: '', toolCalls: [call] })
      execute(call, true)
    }
  }

  for (let step = 0; step < MAX_STEPS_PER_TURN; step++) {
    const result = await model.chat([...history, ...appended], TOOLS)
    modelCalls.push(result.timing)

    if (result.content) texts.push(result.content)
    if (!result.toolCalls.length) {
      appended.push({ role: 'assistant', content: result.content, providerContent: result.providerContent })
      return { messages: appended, reply: texts.join('\n\n'), toolEvents, lead: state, modelCalls, exhausted: false }
    }

    appended.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls, providerContent: result.providerContent })
    for (const call of result.toolCalls) execute(call)
  }

  return { messages: appended, reply: texts.join('\n\n'), toolEvents, lead: state, modelCalls, exhausted: true }
}
