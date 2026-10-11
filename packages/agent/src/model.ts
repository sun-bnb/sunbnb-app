/**
 * Provider-neutral seam for an agent's language model (`@repo/agent`, track 030 S0 — moved from
 * apps/marketing/lib/agent/model.ts, behaviour unchanged).
 *
 * Two adapters implement `LeadAgentModel` (alias `AgentModel`):
 *   - `createOpenAICompatibleModel` (here) — the OpenAI-compatible `/v1/chat/completions` protocol:
 *     Ollama in development, llama.cpp-server or vLLM on an inference host;
 *   - `createClaudeModel` (`claude-model.ts`) — the Anthropic Messages API.
 *
 * Responses are streamed so time-to-first-token can be measured; that is what a user waiting on a
 * chat bubble feels.
 */

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  /**
   * Ask the provider to guarantee schema-valid arguments (Claude `strict: true`; the schema needs
   * `additionalProperties: false` + `required`). Omitted = the provider default. Ignored by the
   * OpenAI-compatible adapter.
   */
  strict?: boolean
}

export interface ToolCall {
  id: string
  name: string
  /** Raw JSON as the model produced it — may be malformed, which is itself an eval signal. */
  arguments: string
}

/**
 * Binary media attached to a user turn (base64, no data: prefix). Only the Claude adapter sends it
 * (image / PDF `document` content blocks); the OpenAI-compatible adapter ignores it. Never persisted
 * by callers that care about transcript size: it is a per-request payload.
 */
export type ChatMedia =
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }
  | { type: 'document'; mediaType: 'application/pdf'; data: string; title?: string }

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; media?: ChatMedia[] }
  | {
      role: 'assistant'
      content: string
      toolCalls?: ToolCall[]
      /**
       * The provider's own content blocks for this turn, echoed back verbatim on the next request.
       * Claude needs this: its thinking blocks are bound to the conversation, and rebuilding a turn
       * from text + tool calls alone would drop them ("preserved thinking"). Opaque to everything
       * else.
       */
      providerContent?: unknown
    }
  | { role: 'tool'; toolCallId: string; content: string }

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  /** See ChatMessage['providerContent']. */
  providerContent?: unknown
  /** Provider stop reason when it matters to the caller (e.g. 'refusal', 'max_tokens'). */
  stopReason?: string
  timing: {
    /** Request start → first content or tool-call token. */
    firstTokenMs: number | null
    totalMs: number
  }
  usage: { promptTokens: number; completionTokens: number } | null
}

/** Per-call options. Every field is optional; an adapter ignores what it does not support. */
export interface ChatOptions {
  temperature?: number
  /** Streamed reply text as it is generated (Claude adapter). May include text a refusal later voids. */
  onTextDelta?: (text: string) => void
  /** A tool call has started streaming — its name is known, its arguments are not yet (Claude adapter). */
  onToolStart?: (name: string) => void
  /** Aborts the provider request (Claude adapter). */
  signal?: AbortSignal
}

export interface LeadAgentModel {
  readonly name: string
  chat(messages: ChatMessage[], tools: ToolDefinition[], opts?: ChatOptions): Promise<ChatResult>
}

/** Generic name for the model seam; `LeadAgentModel` is kept for the marketing lead agent. */
export type AgentModel = LeadAgentModel

/** Reasoning models (e.g. Qwen3) can emit a <think> block in the content; the prospect must never see it. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim()
}

function toWire(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    }
  }
  return { role: m.role, content: m.content }
}

interface StreamDelta {
  content?: string | null
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
}

export function createOpenAICompatibleModel(config: {
  baseUrl: string
  model: string
  apiKey?: string
  timeoutMs?: number
  /**
   * Thinking budget for reasoning models. 'none' disables thinking: on Qwen3 14B it cut a
   * reply from ~10 s to under 1 s, and a prospect waiting on a chat bubble won't sit
   * through a silent think.
   */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  /**
   * Hard cap on generated tokens per call. A reply is ≤ 3 sentences, so this only bites on a
   * degenerate repetition loop — which qwen3:14b fell into once without thinking, holding the
   * request for over 2 minutes.
   */
  maxTokens?: number
}): LeadAgentModel {
  return {
    name: config.model,
    async chat(messages, tools, opts = {}) {
      const started = performance.now()
      const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map(toWire),
          tools: tools.map((t) => ({ type: 'function', function: t })),
          temperature: opts.temperature ?? 0.3,
          max_tokens: config.maxTokens ?? 400,
          stream: true,
          stream_options: { include_usage: true },
          ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 120_000),
      })
      if (!res.ok || !res.body) {
        throw new Error(`model ${config.model}: HTTP ${res.status} ${await res.text().catch(() => '')}`)
      }

      let content = ''
      let firstTokenMs: number | null = null
      let usage: ChatResult['usage'] = null
      const calls = new Map<number, ToolCall>()

      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          const event = JSON.parse(data) as {
            choices?: { delta?: StreamDelta }[]
            usage?: { prompt_tokens: number; completion_tokens: number }
          }
          if (event.usage) usage = { promptTokens: event.usage.prompt_tokens, completionTokens: event.usage.completion_tokens }
          const delta = event.choices?.[0]?.delta
          if (!delta) continue
          if ((delta.content || delta.tool_calls?.length) && firstTokenMs === null) {
            firstTokenMs = performance.now() - started
          }
          if (delta.content) content += delta.content
          for (const tc of delta.tool_calls ?? []) {
            const existing = calls.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}`, name: '', arguments: '' }
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name += tc.function.name
            if (tc.function?.arguments) existing.arguments += tc.function.arguments
            calls.set(tc.index, existing)
          }
        }
      }

      return {
        content: stripThinking(content),
        toolCalls: [...calls.values()],
        timing: { firstTokenMs, totalMs: performance.now() - started },
        usage,
      }
    },
  }
}
