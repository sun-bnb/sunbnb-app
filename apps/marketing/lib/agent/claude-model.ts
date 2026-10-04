/**
 * Claude implementation of `LeadAgentModel` — the LIVE conversation path (track 027 D3: the
 * prospect waits on every reply, so it goes to the API; the local model does background work).
 *
 * Translates the provider-neutral messages (`model.ts`) to the Messages API:
 *   - the system prompt becomes top-level `system`, cached (it is the large, stable fact sheet);
 *   - an assistant turn is replayed from `providerContent` — Claude's own blocks, thinking
 *     included — never rebuilt from text, because Opus 5.5 / Sonnet 5.5 thinking blocks are bound
 *     to the conversation and an edited turn invalidates them;
 *   - consecutive tool results go back in ONE user message (splitting them teaches the model to
 *     stop calling tools in parallel).
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ChatMessage, ChatResult, LeadAgentModel, ToolCall, ToolDefinition } from './model.ts'

type Beta = Anthropic.Beta.Messages.BetaMessageParam
type BetaContent = Anthropic.Beta.Messages.BetaContentBlockParam

/** Opus 5.5 and Sonnet 5.5 run adaptive thinking and accept effort; Haiku 4.5 does neither. */
function capabilities(model: string) {
  const adaptive = /^claude-(opus-5|sonnet-5|fable-5)/.test(model)
  return {
    effort: adaptive,
    // Server-side refusal fallback: re-runs a declined request on a model chosen by category.
    // Enabled by default for the Opus / Sonnet 5.5 line; not offered for Haiku 4.5.
    fallbacks: /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)$/.test(model),
  }
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
      out.push({ role: 'user', content: m.content })
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

export function createClaudeModel(config: {
  model: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTokens?: number
  client?: Anthropic
}): LeadAgentModel {
  const client = config.client ?? new Anthropic()
  const caps = capabilities(config.model)

  return {
    name: config.model,
    async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatResult> {
      const started = performance.now()
      const { system, messages: wire } = toClaudeMessages(messages)
      const stream = client.beta.messages.stream({
        model: config.model,
        // Room for adaptive thinking ahead of a short reply; a reply's length is held by the prompt.
        max_tokens: config.maxTokens ?? 16000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: wire,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Beta.Messages.BetaTool.InputSchema,
          // Stream tool input as it is generated. The API then no longer validates it — fine,
          // because every call goes through validateToolCall (tools.ts) before it runs.
          eager_input_streaming: true,
        })),
        ...(caps.effort ? { output_config: { effort: config.effort ?? 'low' } } : {}),
        ...(caps.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      })

      let firstTokenMs: number | null = null
      for await (const event of stream) {
        if (firstTokenMs !== null) continue
        if (
          (event.type === 'content_block_delta' && event.delta.type === 'text_delta') ||
          (event.type === 'content_block_start' && event.content_block.type === 'tool_use')
        ) {
          firstTokenMs = performance.now() - started
        }
      }
      const message = await stream.finalMessage()

      const toolCalls: ToolCall[] = []
      let text = ''
      for (const block of message.content) {
        if (block.type === 'text') text += block.text
        else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) })
      }

      return {
        // A refusal or a cut-off turn must not reach the prospect as half a sentence.
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
