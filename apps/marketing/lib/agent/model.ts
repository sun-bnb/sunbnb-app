/**
 * Provider-agnostic seam for the lead agent's language model.
 *
 * Everything speaks the OpenAI-compatible `/v1/chat/completions` protocol: Ollama in
 * development, llama.cpp-server or vLLM on the production inference host. Switching between
 * them — or adding an API fallback (track 027, Q1) — is a base-URL change, not a rewrite.
 *
 * Responses are streamed so time-to-first-token can be measured; that is what a prospect
 * feels, and it is a P0 selection criterion.
 */

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  /** Raw JSON as the model produced it — may be malformed, which is itself an eval signal. */
  arguments: string
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  timing: {
    /** Request start → first content or tool-call token. */
    firstTokenMs: number | null
    totalMs: number
  }
  usage: { promptTokens: number; completionTokens: number } | null
}

export interface LeadAgentModel {
  readonly name: string
  chat(messages: ChatMessage[], tools: ToolDefinition[], opts?: { temperature?: number }): Promise<ChatResult>
}

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
