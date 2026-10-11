/**
 * Claude implementation of `LeadAgentModel` (`@repo/agent`, track 030 S0 — moved from
 * apps/marketing/lib/agent/claude-model.ts; marketing's requests are unchanged).
 *
 * Translates the provider-neutral messages (`model.ts`) to the Messages API:
 *   - the system prompt becomes top-level `system`, cached (it is the large, stable part);
 *   - an assistant turn is replayed from `providerContent` — Claude's own blocks, thinking
 *     included — never rebuilt from text, because Opus 5.5 / Sonnet 5.5 thinking blocks are bound
 *     to the conversation and an edited turn invalidates them;
 *   - consecutive tool results go back in ONE user message (splitting them teaches the model to
 *     stop calling tools in parallel).
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ChatMessage, ChatOptions, ChatResult, LeadAgentModel, ToolCall, ToolDefinition } from './model.ts'

type Beta = Anthropic.Beta.Messages.BetaMessageParam
type BetaContent = Anthropic.Beta.Messages.BetaContentBlockParam

export interface ClaudeCapabilities {
  /** Accepts `output_config.effort` (the adapter sends `low` unless configured). */
  effort: boolean
  /** Offers the server-side refusal fallback (`fallbacks: 'default'`, beta server-side-fallback-2026-07-01). */
  fallbacks: boolean
}

/** Unknown ids send neither parameter: the API defaults apply, which every model accepts. */
const DEFAULT_CAPABILITIES: ClaudeCapabilities = { effort: false, fallbacks: false }

/**
 * Per-model request capabilities, keyed by model id prefix (the longest matching prefix wins, so
 * `claude-opus-5-5` is not read as `claude-opus-5`; a dated snapshot `<id>-YYYYMMDD` matches its
 * id). Source: the claude-api reference, 2026-10 — effort is GA on the 4.6+ generation and Haiku
 * 5.5, never on Haiku 4.5; the `'default'` server-side fallback is offered for Fable 5.1, Opus 5.5,
 * Opus 5 and Sonnet 5.5 only (Haiku 5.5 has no server-side refusal fallback). Add new ids here
 * rather than widening a pattern: a wrong guess is a 400 on every turn.
 */
export const CLAUDE_CAPABILITIES: Readonly<Record<string, ClaudeCapabilities>> = {
  'claude-fable-5-1': { effort: true, fallbacks: true },
  'claude-fable-5': { effort: true, fallbacks: false },
  'claude-opus-5-5': { effort: true, fallbacks: true },
  'claude-opus-5': { effort: true, fallbacks: true },
  'claude-opus-4-8': { effort: true, fallbacks: false },
  'claude-opus-4-7': { effort: true, fallbacks: false },
  'claude-opus-4-6': { effort: true, fallbacks: false },
  'claude-sonnet-5-5': { effort: true, fallbacks: true },
  'claude-sonnet-5': { effort: true, fallbacks: false },
  'claude-sonnet-4-6': { effort: true, fallbacks: false },
  'claude-haiku-5-5': { effort: true, fallbacks: false },
  'claude-haiku-4-5': { effort: false, fallbacks: false },
}

/** Capabilities for a model id — explicit table, longest-prefix match, safe default. */
export function claudeCapabilities(model: string): ClaudeCapabilities {
  let best: string | null = null
  for (const id of Object.keys(CLAUDE_CAPABILITIES)) {
    const matches = model === id || model.startsWith(`${id}-`) || model.startsWith(`${id}@`)
    if (matches && (best === null || id.length > best.length)) best = id
  }
  return best ? CLAUDE_CAPABILITIES[best]! : DEFAULT_CAPABILITIES
}

export function toClaudeMessages(messages: ChatMessage[]): { system: string; messages: Beta[] } {
  let system = ''
  const out: Beta[] = []
  let pendingResults: BetaContent[] = []
  const flushResults = () => {
    if (pendingResults.length) out.push({ role: 'user', content: pendingResults })
    pendingResults = []
  }

  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + m.content
      continue
    }
    if (m.role === 'tool') {
      pendingResults.push({ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content })
      continue
    }
    flushResults()
    // (`system` was handled above; the union member is `'system' | 'user'`, so narrow on assistant.)
    if (m.role !== 'assistant') {
      if (m.role === 'user' && m.media?.length) {
        // Media first, then the text: the model reads the document before the question about it.
        const blocks: BetaContent[] = m.media.map((x) =>
          x.type === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: x.mediaType, data: x.data } }
            : { type: 'document', source: { type: 'base64', media_type: x.mediaType, data: x.data }, ...(x.title ? { title: x.title } : {}) },
        )
        blocks.push({ type: 'text', text: m.content })
        out.push({ role: 'user', content: blocks })
      } else {
        out.push({ role: 'user', content: m.content })
      }
      continue
    }
    if (Array.isArray(m.providerContent)) {
      out.push({ role: 'assistant', content: m.providerContent as BetaContent[] })
    } else {
      // A turn produced by another provider (or a test fixture): rebuild what we can.
      const blocks: BetaContent[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls ?? []) {
        let input: unknown = {}
        try {
          input = JSON.parse(c.arguments || '{}')
        } catch {
          /* replayed as empty input */
        }
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input })
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] })
    }
  }
  flushResults()
  return { system, messages: out }
}

/** The request body `createClaudeModel` sends — exported so tests can pin it without the network. */
export function buildClaudeRequest(
  config: { model: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; maxTokens?: number },
  messages: ChatMessage[],
  tools: ToolDefinition[],
) {
  const caps = claudeCapabilities(config.model)
  const { system, messages: wire } = toClaudeMessages(messages)
  return {
    model: config.model,
    // Room for adaptive thinking ahead of a short reply; a reply's length is held by the prompt.
    max_tokens: config.maxTokens ?? 16000,
    system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
    messages: wire,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Beta.Messages.BetaTool.InputSchema,
      ...(t.strict !== undefined ? { strict: t.strict } : {}),
      // Stream tool input as it is generated. The API then no longer validates it — fine,
      // because every call is validated server-side (marketing tools.ts / loop.ts) before it runs.
      eager_input_streaming: true,
    })),
    ...(caps.effort ? { output_config: { effort: config.effort ?? ('low' as const) } } : {}),
    ...(caps.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  }
}

export function createClaudeModel(config: {
  model: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTokens?: number
  client?: Anthropic
}): LeadAgentModel {
  const client = config.client ?? new Anthropic()

  return {
    name: config.model,
    async chat(messages: ChatMessage[], tools: ToolDefinition[], opts: ChatOptions = {}): Promise<ChatResult> {
      const started = performance.now()
      const stream = client.beta.messages.stream(
        buildClaudeRequest(config, messages, tools),
        opts.signal ? { signal: opts.signal } : undefined,
      )

      let firstTokenMs: number | null = null
      for await (const event of stream) {
        const isText = event.type === 'content_block_delta' && event.delta.type === 'text_delta'
        const isToolStart = event.type === 'content_block_start' && event.content_block.type === 'tool_use'
        if (firstTokenMs === null && (isText || isToolStart)) firstTokenMs = performance.now() - started
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') opts.onTextDelta?.(event.delta.text)
        else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') opts.onToolStart?.(event.content_block.name)
      }
      const message = await stream.finalMessage()

      const toolCalls: ToolCall[] = []
      let text = ''
      for (const block of message.content) {
        if (block.type === 'text') text += block.text
        else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) })
      }

      return {
        // A refusal or a cut-off turn must not reach the user as half a sentence.
        content: message.stop_reason === 'refusal' ? '' : text.trim(),
        toolCalls: message.stop_reason === 'max_tokens' || message.stop_reason === 'refusal' ? [] : toolCalls,
        providerContent: message.content,
        stopReason: message.stop_reason ?? undefined,
        timing: { firstTokenMs, totalMs: performance.now() - started },
        usage: { promptTokens: message.usage.input_tokens, completionTokens: message.usage.output_tokens },
      }
    },
  }
}
