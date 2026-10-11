/**
 * One prospect turn: send the conversation to the model, validate and execute any tool calls,
 * feed the results back, and repeat until the model answers in text (or the step cap is hit).
 *
 * Shared by the eval harness and, from P5, the `/api/chat` route — so what the eval measures is
 * the loop that ships.
 *
 * The loop itself is `runAgentLoop` from `@repo/agent/loop` (track 030 S0); this file keeps what is
 * lead-specific: the tool registry over `TOOLS` + `validateToolCall`, `applyTool`, and the
 * server-side contact capture (`autoCapture`).
 */
import { executeToolCall, runAgentLoop, type AgentTool, type ToolExecution } from '@repo/agent/loop'
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

/** Mutable per-turn context the lead tools validate against and write to. */
interface LeadCtx {
  state: LeadState
  /** Everything the prospect has written — contact details must be found in it. */
  userText: string
}

/** The lead tools as an `@repo/agent` registry: same definitions, same validation, same effects. */
const LEAD_TOOLS: AgentTool<LeadCtx>[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.parameters,
  validate: (args, ctx) => {
    const v = validateToolCall(t.name, args, { email: ctx.state.email, phone: ctx.state.phone, userText: ctx.userText })
    return v.ok ? [] : v.errors
  },
  run: (args, ctx) => {
    ctx.state = applyTool(ctx.state, t.name, args)
    return { ok: true }
  },
}))

const toToolEvent = (e: ToolExecution, auto = false): ToolEvent => ({
  call: e.call,
  args: e.args,
  accepted: e.accepted,
  errors: e.errors,
  ...(auto ? { auto: true } : {}),
})

export async function runTurn(
  model: LeadAgentModel,
  history: ChatMessage[],
  lead: LeadState,
  options: RunTurnOptions = {},
): Promise<TurnResult> {
  const ctx: LeadCtx = {
    state: lead,
    userText: history.flatMap((m) => (m.role === 'user' ? [m.content] : [])).join('\n'),
  }
  const pre: ChatMessage[] = []
  const toolEvents: ToolEvent[] = []

  if (options.autoCapture) {
    const latest = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
    const found = extractContact(latest)
    const fresh: Record<string, string> = {}
    if (found.email && found.email !== ctx.state.email) fresh.email = found.email
    if (found.phone && found.phone !== ctx.state.phone) fresh.phone = found.phone
    if (Object.keys(fresh).length) {
      // Shown to the model as its own completed call, so its reply matches what happened.
      const call: ToolCall = {
        id: `auto_${toolEvents.length}_${Date.now()}`,
        name: ctx.state.demoRequested ? 'update_lead' : 'request_demo',
        arguments: JSON.stringify(fresh),
      }
      pre.push({ role: 'assistant', content: '', toolCalls: [call] })
      const e = await executeToolCall(LEAD_TOOLS, call, ctx)
      toolEvents.push(toToolEvent(e, true))
      pre.push(
        e.accepted
          ? {
              ...e.message,
              // The model didn't make this call, so it would otherwise skip the rest of the message.
              content: JSON.stringify({ ok: true, note: 'Saved their contact and requested the demo for them. Still save any name, business name, business type or sunbed count from their message with update_lead.' }),
            }
          : e.message,
      )
    }
  }

  // A model may answer AND call a tool in the same step ("Yes, guests can order… " + update_lead),
  // then add nothing after the tool result. The prospect's reply is every step's text, not only the
  // last step's — reporting just the last one dropped real answers (haiku-4-5, 2026-10-04). The
  // loop joins every step's text.
  const r = await runAgentLoop({ model, messages: [...history, ...pre], tools: LEAD_TOOLS, ctx, maxSteps: MAX_STEPS_PER_TURN })
  toolEvents.push(...r.executions.map((e) => toToolEvent(e)))

  return {
    messages: [...pre, ...r.messages],
    reply: r.reply,
    toolEvents,
    lead: ctx.state,
    modelCalls: r.modelCalls,
    exhausted: r.exhausted,
  }
}
