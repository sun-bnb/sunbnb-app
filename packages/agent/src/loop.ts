/**
 * The generic agent loop (`@repo/agent`, track 030 S0): send the conversation to the model,
 * validate and run any tool calls, feed the results back, and repeat until the model answers in
 * text, stops (refusal / max_tokens), or the step cap is hit.
 *
 * Extracted from the marketing lead agent's `runTurn`, keeping the properties that mattered there:
 *   - the model's own content (`providerContent`, thinking blocks included) is replayed verbatim —
 *     the loop never rebuilds an assistant turn;
 *   - every tool result of a step is appended in order, so the Claude adapter returns them in ONE
 *     user message;
 *   - the reply is the text of EVERY step, not only the last (a model may answer alongside a tool
 *     call and add nothing after the result);
 *   - a hard step cap; on `refusal` / `max_tokens` the step's tool calls are dropped and the loop
 *     ends — a cut-off call must never run.
 *
 * Tools run SEQUENTIALLY in the order the model emitted them, so a later call's validation sees
 * the effects of an earlier one (e.g. a contact saved, then a demo requested in the same step).
 *
 * The model never writes anything itself: it PROPOSES a call; `validate` (default: the tool's
 * JSON schema) checks the arguments and only a valid call runs. An invalid call goes back to the
 * model as `{ ok: false, errors }` so it can correct itself.
 */
import type { ChatMessage, ChatResult, LeadAgentModel, ToolCall, ToolDefinition } from './model.ts'
import { validateJsonSchema } from './schema.ts'

export interface AgentTool<Ctx = unknown> {
  name: string
  description: string
  /** JSON schema for the input — `type: 'object'`, ideally `additionalProperties: false` + `required`. */
  inputSchema: Record<string, unknown>
  /** Ask the provider for schema-valid arguments (Claude `strict: true`). */
  strict?: boolean
  /**
   * Errors for this input; empty = valid. Replaces the default JSON-schema check — a tool with
   * richer rules (grounding, cross-field) owns its whole validation.
   */
  validate?: (input: Record<string, unknown>, ctx: Ctx) => string[]
  /** Runs a validated call. The return value is JSON-serialised as the tool result (default `{ ok: true }`). */
  run: (input: Record<string, unknown>, ctx: Ctx) => unknown | Promise<unknown>
}

export type ToolRegistry<Ctx = unknown> = readonly AgentTool<Ctx>[]

export interface ToolExecution {
  call: ToolCall
  /** Parsed arguments, or null when the model emitted invalid JSON. */
  args: Record<string, unknown> | null
  accepted: boolean
  errors: string[]
  /** What `run` returned (accepted calls only). */
  result?: unknown
  /** The tool message to append (feed back to the model). */
  message: Extract<ChatMessage, { role: 'tool' }>
}

export type AgentEvent =
  | { type: 'text_delta'; step: number; text: string }
  | { type: 'tool_start'; step: number; name: string }
  | { type: 'model_result'; step: number; result: ChatResult }
  | { type: 'tool_result'; step: number; execution: ToolExecution }

export interface AgentLoopResult {
  /** Messages appended by the loop (assistant + tool), in order. */
  messages: ChatMessage[]
  /** Text of every step, joined by a blank line. */
  reply: string
  executions: ToolExecution[]
  modelCalls: ChatResult['timing'][]
  usage: { promptTokens: number; completionTokens: number }
  /** True when the step cap was reached without a final text reply. */
  exhausted: boolean
  /** The last model call's stop reason. */
  stopReason?: string
}

/** Stop reasons whose tool calls must not run (cut off, or declined). */
const DROP_TOOLS_ON = new Set(['refusal', 'max_tokens'])

/** The registry as provider-neutral tool definitions (order preserved). */
export function toolDefinitions<Ctx>(tools: ToolRegistry<Ctx>): ToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
    ...(t.strict !== undefined ? { strict: t.strict } : {}),
  }))
}

/** Parse a call's raw arguments: a plain JSON object, or null. */
export function parseToolArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    /* reported by the caller */
  }
  return null
}

/** Validate and (if valid) run one call. Exported so callers can execute server-made calls the same way. */
export async function executeToolCall<Ctx>(tools: ToolRegistry<Ctx>, call: ToolCall, ctx: Ctx): Promise<ToolExecution> {
  const args = parseToolArguments(call.arguments)
  const tool = tools.find((t) => t.name === call.name)
  let errors: string[]
  if (!args) errors = ['arguments were not valid JSON']
  else if (!tool) errors = [`unknown tool: ${call.name}`]
  else errors = tool.validate ? tool.validate(args, ctx) : validateJsonSchema(tool.inputSchema, args)

  const accepted = errors.length === 0
  let result: unknown
  if (accepted && tool && args) result = (await tool.run(args, ctx)) ?? { ok: true }
  return {
    call,
    args,
    accepted,
    errors,
    ...(accepted ? { result } : {}),
    message: { role: 'tool', toolCallId: call.id, content: JSON.stringify(accepted ? result : { ok: false, errors }) },
  }
}

export interface AgentLoopOptions<Ctx> {
  model: LeadAgentModel
  /** Prepended as a system message when given (callers may also put it in `messages`). */
  system?: string
  /** The conversation so far, ending with the user's message. */
  messages: ChatMessage[]
  tools: ToolRegistry<Ctx>
  /** Context handed to every `validate` / `run` (bound server-side — never from the model). */
  ctx: Ctx
  maxSteps: number
  onEvent?: (event: AgentEvent) => void
  signal?: AbortSignal
  temperature?: number
}

export async function runAgentLoop<Ctx>(opts: AgentLoopOptions<Ctx>): Promise<AgentLoopResult> {
  const { model, tools, ctx, maxSteps, onEvent, signal } = opts
  const base: ChatMessage[] = opts.system ? [{ role: 'system', content: opts.system }, ...opts.messages] : opts.messages
  const definitions = toolDefinitions(tools)
  const appended: ChatMessage[] = []
  const executions: ToolExecution[] = []
  const modelCalls: ChatResult['timing'][] = []
  const usage = { promptTokens: 0, completionTokens: 0 }
  const texts: string[] = []
  let stopReason: string | undefined

  const done = (exhausted: boolean): AgentLoopResult => ({
    messages: appended,
    reply: texts.join('\n\n'),
    executions,
    modelCalls,
    usage,
    exhausted,
    ...(stopReason !== undefined ? { stopReason } : {}),
  })

  for (let step = 0; step < maxSteps; step++) {
    signal?.throwIfAborted()
    const result = await model.chat([...base, ...appended], definitions, {
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(onEvent
        ? {
            onTextDelta: (text: string) => onEvent({ type: 'text_delta', step, text }),
            onToolStart: (name: string) => onEvent({ type: 'tool_start', step, name }),
          }
        : {}),
      ...(signal ? { signal } : {}),
    })
    modelCalls.push(result.timing)
    if (result.usage) {
      usage.promptTokens += result.usage.promptTokens
      usage.completionTokens += result.usage.completionTokens
    }
    stopReason = result.stopReason
    onEvent?.({ type: 'model_result', step, result })

    if (result.content) texts.push(result.content)
    const calls = result.stopReason && DROP_TOOLS_ON.has(result.stopReason) ? [] : result.toolCalls
    if (!calls.length) {
      appended.push({ role: 'assistant', content: result.content, providerContent: result.providerContent })
      return done(false)
    }

    appended.push({ role: 'assistant', content: result.content, toolCalls: calls, providerContent: result.providerContent })
    for (const call of calls) {
      const execution = await executeToolCall(tools, call, ctx)
      executions.push(execution)
      appended.push(execution.message)
      onEvent?.({ type: 'tool_result', step, execution })
    }
  }

  return done(true)
}
