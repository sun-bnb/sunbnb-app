import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { buildClaudeRequest, claudeCapabilities, createClaudeModel, toClaudeMessages } from './claude-model.ts'

describe('toClaudeMessages', () => {
  it('lifts the system prompt out of the message list', () => {
    const r = toClaudeMessages([{ role: 'system', content: 'FACTS' }, { role: 'user', content: 'hi' }])
    expect(r.system).toBe('FACTS')
    expect(r.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('sends user media as base64 image / document blocks before the text; no media = plain string', () => {
    const r = toClaudeMessages([
      { role: 'user', content: 'plain' },
      {
        role: 'user',
        content: 'read these',
        media: [
          { type: 'document', mediaType: 'application/pdf', data: 'UERG', title: 'a.pdf' },
          { type: 'image', mediaType: 'image/jpeg', data: 'SlBH' },
        ],
      },
    ])
    expect(r.messages[0]).toEqual({ role: 'user', content: 'plain' })
    expect(r.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' }, title: 'a.pdf' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'SlBH' } },
        { type: 'text', text: 'read these' },
      ],
    })
  })

  it("replays Claude's own blocks verbatim — thinking blocks must not be dropped", () => {
    const own = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Hello' }]
    const r = toClaudeMessages([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello', providerContent: own }])
    expect(r.messages[1]).toEqual({ role: 'assistant', content: own })
  })

  it('returns parallel tool results in ONE user message', () => {
    const r = toClaudeMessages([
      { role: 'user', content: 'Maria, maria@x.es, call me' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'update_lead', arguments: '{}' }, { id: 'b', name: 'request_demo', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'a', content: '{"ok":true}' },
      { role: 'tool', toolCallId: 'b', content: '{"ok":true}' },
    ])
    expect(r.messages).toHaveLength(3)
    expect(r.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: '{"ok":true}' },
        { type: 'tool_result', tool_use_id: 'b', content: '{"ok":true}' },
      ],
    })
  })

  it('rebuilds a turn produced by another provider from text + tool calls', () => {
    const r = toClaudeMessages([
      { role: 'user', content: 'x' },
      { role: 'assistant', content: 'ok', toolCalls: [{ id: 't', name: 'adjust_mockup', arguments: '{"sunbed_count":140}' }] },
    ])
    expect(r.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't', name: 'adjust_mockup', input: { sunbed_count: 140 } }],
    })
  })
})

describe('claudeCapabilities', () => {
  it('keeps claude-haiku-4-5 (the marketing default) on neither effort nor fallbacks', () => {
    expect(claudeCapabilities('claude-haiku-4-5')).toEqual({ effort: false, fallbacks: false })
    expect(claudeCapabilities('claude-haiku-4-5-20251001')).toEqual({ effort: false, fallbacks: false })
  })

  it('gives claude-haiku-5-5 effort (the old regex missed it) but no server-side fallback', () => {
    expect(claudeCapabilities('claude-haiku-5-5')).toEqual({ effort: true, fallbacks: false })
  })

  it('offers the default fallback only on Fable 5.1, Opus 5.5, Opus 5 and Sonnet 5.5', () => {
    for (const id of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']) {
      expect(claudeCapabilities(id)).toEqual({ effort: true, fallbacks: true })
    }
    for (const id of ['claude-fable-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-sonnet-4-6']) {
      expect(claudeCapabilities(id)).toEqual({ effort: true, fallbacks: false })
    }
  })

  it('matches the longest prefix — claude-sonnet-5-5 is not read as claude-sonnet-5', () => {
    expect(claudeCapabilities('claude-sonnet-5-5').fallbacks).toBe(true)
    expect(claudeCapabilities('claude-sonnet-5').fallbacks).toBe(false)
  })

  it('sends neither parameter for an unknown id', () => {
    for (const id of ['claude-opus-6', 'claude-3-haiku', 'gpt-x', 'claude-haiku-4-55']) {
      expect(claudeCapabilities(id)).toEqual({ effort: false, fallbacks: false })
    }
  })
})

describe('buildClaudeRequest', () => {
  const msgs = [{ role: 'system' as const, content: 'S' }, { role: 'user' as const, content: 'hi' }]
  const tools = [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }]

  it('is exactly the marketing request for claude-haiku-4-5', () => {
    expect(buildClaudeRequest({ model: 'claude-haiku-4-5', maxTokens: 1024 }, msgs, tools)).toEqual({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object', properties: {} }, eager_input_streaming: true }],
    })
  })

  it('adds effort (default low) and the default fallback where supported; strict only when asked', () => {
    const r = buildClaudeRequest({ model: 'claude-sonnet-5-5' }, msgs, [{ ...tools[0]!, strict: true }])
    expect(r.max_tokens).toBe(16000)
    expect(r.output_config).toEqual({ effort: 'low' })
    expect(r.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(r.fallbacks).toBe('default')
    expect(r.tools[0]).toMatchObject({ strict: true })
    const h = buildClaudeRequest({ model: 'claude-haiku-5-5', effort: 'medium' }, msgs, tools)
    expect(h.output_config).toEqual({ effort: 'medium' })
    expect('betas' in h).toBe(false)
  })
})

/** A fake SDK client whose stream yields the given events then the given final message. */
function fakeClient(events: unknown[], final: Record<string, unknown>, seen: { params?: unknown; options?: unknown } = {}) {
  return {
    beta: {
      messages: {
        stream(params: unknown, options: unknown) {
          seen.params = params
          seen.options = options
          return {
            async *[Symbol.asyncIterator]() {
              yield* events
            },
            finalMessage: async () => final,
          }
        },
      },
    },
  } as unknown as Anthropic
}

const finalMsg = (over: Record<string, unknown> = {}) => ({
  content: [
    { type: 'text', text: 'Hello ' },
    { type: 'tool_use', id: 'tu1', name: 'save', input: { a: 1 } },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 10, output_tokens: 5 },
  ...over,
})

const streamEvents = [
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo ' } },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'save', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":1}' } },
]

describe('createClaudeModel streaming callbacks', () => {
  it('reports text deltas and tool starts as they stream, and returns the final message', async () => {
    const deltas: string[] = []
    const starts: string[] = []
    const model = createClaudeModel({ model: 'claude-haiku-4-5', client: fakeClient(streamEvents, finalMsg()) })
    const r = await model.chat([{ role: 'user', content: 'hi' }], [], { onTextDelta: (t) => deltas.push(t), onToolStart: (n) => starts.push(n) })
    expect(deltas).toEqual(['Hel', 'lo '])
    expect(starts).toEqual(['save'])
    expect(r.content).toBe('Hello')
    expect(r.toolCalls).toEqual([{ id: 'tu1', name: 'save', arguments: '{"a":1}' }])
    expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
    expect(r.timing.firstTokenMs).not.toBeNull()
  })

  it('without callbacks behaves the same and passes no request options', async () => {
    const seen: { params?: unknown; options?: unknown } = {}
    const model = createClaudeModel({ model: 'claude-haiku-4-5', client: fakeClient(streamEvents, finalMsg(), seen) })
    const r = await model.chat([{ role: 'user', content: 'hi' }], [])
    expect(r.content).toBe('Hello')
    expect(seen.options).toBeUndefined()
  })

  it('forwards an abort signal to the SDK request', async () => {
    const seen: { params?: unknown; options?: unknown } = {}
    const signal = new AbortController().signal
    await createClaudeModel({ model: 'claude-haiku-4-5', client: fakeClient([], finalMsg(), seen) }).chat([{ role: 'user', content: 'x' }], [], { signal })
    expect(seen.options).toEqual({ signal })
  })

  it('drops tool calls on max_tokens and text + tool calls on refusal', async () => {
    const cut = await createClaudeModel({ model: 'claude-haiku-4-5', client: fakeClient([], finalMsg({ stop_reason: 'max_tokens' })) }).chat([{ role: 'user', content: 'x' }], [])
    expect(cut.toolCalls).toEqual([])
    expect(cut.content).toBe('Hello')
    const refused = await createClaudeModel({ model: 'claude-haiku-4-5', client: fakeClient([], finalMsg({ stop_reason: 'refusal' })) }).chat([{ role: 'user', content: 'x' }], [])
    expect(refused).toMatchObject({ content: '', toolCalls: [], stopReason: 'refusal' })
  })
})
