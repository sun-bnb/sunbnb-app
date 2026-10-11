import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatOptions, ChatResult, LeadAgentModel, ToolDefinition } from './model.ts'
import { executeToolCall, runAgentLoop, type AgentEvent, type AgentTool } from './loop.ts'

/** A scripted model: returns the given steps in order and records what it was sent. */
function scripted(steps: Partial<ChatResult>[]) {
  const calls: { messages: ChatMessage[]; tools: ToolDefinition[]; opts?: ChatOptions }[] = []
  let i = 0
  const model: LeadAgentModel = {
    name: 'scripted',
    async chat(messages, tools, opts) {
      calls.push({ messages: [...messages], tools, opts })
      const s = steps[i++] ?? {}
      return {
        content: s.content ?? '',
        toolCalls: s.toolCalls ?? [],
        providerContent: s.providerContent,
        stopReason: s.stopReason,
        timing: { firstTokenMs: 1, totalMs: 1 },
        usage: s.usage === undefined ? { promptTokens: 3, completionTokens: 2 } : s.usage,
      }
    },
  }
  return { model, calls }
}

interface Ctx {
  saved: Record<string, unknown>[]
}

const save: AgentTool<Ctx> = {
  name: 'save',
  description: 'Save a note',
  inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'], additionalProperties: false },
  run: (input, ctx) => {
    ctx.saved.push(input)
  },
}
const user = (content: string): ChatMessage => ({ role: 'user', content })

describe('runAgentLoop', () => {
  it('replays the provider content verbatim on the next call', async () => {
    const own = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: '1', name: 'save', input: { note: 'x' } }]
    const { model, calls } = scripted([{ toolCalls: [{ id: '1', name: 'save', arguments: '{"note":"x"}' }], providerContent: own }, { content: 'Done.' }])
    const r = await runAgentLoop({ model, messages: [user('save x')], tools: [save], ctx: { saved: [] }, maxSteps: 4 })
    expect(calls[1]!.messages[1]).toEqual({ role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'save', arguments: '{"note":"x"}' }], providerContent: own })
    expect(r.messages.at(-1)).toEqual({ role: 'assistant', content: 'Done.', providerContent: undefined })
  })

  it('appends every tool result of a step, in order, right after its assistant turn', async () => {
    const ctx: Ctx = { saved: [] }
    const { model, calls } = scripted([
      { toolCalls: [{ id: 'a', name: 'save', arguments: '{"note":"1"}' }, { id: 'b', name: 'save', arguments: '{"note":"2"}' }] },
      { content: 'ok' },
    ])
    const r = await runAgentLoop({ model, messages: [user('x')], tools: [save], ctx, maxSteps: 4 })
    expect(r.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'assistant'])
    expect(calls[1]!.messages.slice(-2)).toEqual([
      { role: 'tool', toolCallId: 'a', content: '{"ok":true}' },
      { role: 'tool', toolCallId: 'b', content: '{"ok":true}' },
    ])
    expect(ctx.saved).toEqual([{ note: '1' }, { note: '2' }])
  })

  it('collects text from every step, not just the last', async () => {
    const { model } = scripted([{ content: 'Saved.', toolCalls: [{ id: '1', name: 'save', arguments: '{"note":"n"}' }] }, { content: '' }])
    const r = await runAgentLoop({ model, messages: [user('x')], tools: [save], ctx: { saved: [] }, maxSteps: 4 })
    expect(r.reply).toBe('Saved.')
    const two = await runAgentLoop({
      model: scripted([{ content: 'A', toolCalls: [{ id: '1', name: 'save', arguments: '{"note":"n"}' }] }, { content: 'B' }]).model,
      messages: [user('x')],
      tools: [save],
      ctx: { saved: [] },
      maxSteps: 4,
    })
    expect(two.reply).toBe('A\n\nB')
  })

  it('stops at the step cap and says so', async () => {
    const loopCall = { toolCalls: [{ id: '1', name: 'save', arguments: '{"note":"n"}' }] }
    const { model, calls } = scripted([loopCall, loopCall, loopCall, loopCall, loopCall])
    const r = await runAgentLoop({ model, messages: [user('x')], tools: [save], ctx: { saved: [] }, maxSteps: 3 })
    expect(calls).toHaveLength(3)
    expect(r.exhausted).toBe(true)
    expect(r.modelCalls).toHaveLength(3)
    expect(r.usage).toEqual({ promptTokens: 9, completionTokens: 6 })
  })

  it.each(['refusal', 'max_tokens'])('drops the tool calls and ends on %s', async (stopReason) => {
    const ctx: Ctx = { saved: [] }
    const { model, calls } = scripted([{ content: 'Partial', stopReason, toolCalls: [{ id: '1', name: 'save', arguments: '{"note":"n"}' }] }])
    const r = await runAgentLoop({ model, messages: [user('x')], tools: [save], ctx, maxSteps: 4 })
    expect(calls).toHaveLength(1)
    expect(ctx.saved).toEqual([])
    expect(r.executions).toEqual([])
    expect(r).toMatchObject({ exhausted: false, stopReason })
    expect(r.messages).toEqual([{ role: 'assistant', content: 'Partial', providerContent: undefined }])
  })

  it('feeds invalid JSON, unknown tools and schema violations back as errors without running them', async () => {
    const run = vi.fn()
    const tool: AgentTool<Ctx> = { ...save, run }
    const { model } = scripted([
      {
        toolCalls: [
          { id: '1', name: 'save', arguments: '{"note":' },
          { id: '2', name: 'nope', arguments: '{}' },
          { id: '3', name: 'save', arguments: '{"note":5,"x":1}' },
          { id: '4', name: 'save', arguments: '[1]' },
        ],
      },
      { content: 'Sorry' },
    ])
    const r = await runAgentLoop({ model, messages: [user('x')], tools: [tool], ctx: { saved: [] }, maxSteps: 4 })
    expect(run).not.toHaveBeenCalled()
    expect(r.executions.map((e) => e.errors)).toEqual([
      ['arguments were not valid JSON'],
      ['unknown tool: nope'],
      ['input.note must be string', 'unknown field: x'],
      ['arguments were not valid JSON'],
    ])
    expect(JSON.parse((r.messages[1] as { content: string }).content)).toEqual({ ok: false, errors: ['arguments were not valid JSON'] })
  })

  it("uses a tool's own validate instead of the schema, and runs calls sequentially against shared ctx", async () => {
    const ctx = { email: undefined as string | undefined }
    const setEmail: AgentTool<typeof ctx> = { name: 'set_email', description: '', inputSchema: { type: 'object' }, run: (i, c) => void (c.email = i.email as string) }
    const book: AgentTool<typeof ctx> = {
      name: 'book',
      description: '',
      inputSchema: { type: 'object' },
      validate: (_i, c) => (c.email ? [] : ['no email yet']),
      run: () => ({ ok: true, booked: true }),
    }
    const { model } = scripted([{ toolCalls: [{ id: '1', name: 'set_email', arguments: '{"email":"a@b.co"}' }, { id: '2', name: 'book', arguments: '{}' }] }, { content: 'Booked' }])
    const r = await runAgentLoop({ model, messages: [user('x')], tools: [setEmail, book], ctx, maxSteps: 4 })
    expect(r.executions.map((e) => e.accepted)).toEqual([true, true])
    expect(r.messages[2]).toEqual({ role: 'tool', toolCallId: '2', content: '{"ok":true,"booked":true}' })
  })

  it('passes tool definitions (strict only when set) and prepends the system prompt', async () => {
    const { model, calls } = scripted([{ content: 'hi' }])
    await runAgentLoop({ model, system: 'SYS', messages: [user('x')], tools: [save, { ...save, name: 'strict_save', strict: true }], ctx: { saved: [] }, maxSteps: 1 })
    expect(calls[0]!.messages[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(calls[0]!.tools).toEqual([
      { name: 'save', description: 'Save a note', parameters: save.inputSchema },
      { name: 'strict_save', description: 'Save a note', parameters: save.inputSchema, strict: true },
    ])
  })

  it('emits streaming, model and tool events', async () => {
    const model: LeadAgentModel = {
      name: 'streamy',
      async chat(_m, _t, opts) {
        opts?.onTextDelta?.('He')
        opts?.onToolStart?.('save')
        return { content: 'He', toolCalls: [], timing: { firstTokenMs: 1, totalMs: 1 }, usage: null }
      },
    }
    const events: AgentEvent[] = []
    await runAgentLoop({ model, messages: [user('x')], tools: [save], ctx: { saved: [] }, maxSteps: 2, onEvent: (e) => events.push(e) })
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'tool_start', 'model_result'])
  })

  it('throws when aborted before a step', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(runAgentLoop({ model: scripted([]).model, messages: [user('x')], tools: [], ctx: {}, maxSteps: 2, signal: ac.signal })).rejects.toThrow()
  })
})

describe('executeToolCall', () => {
  it('serialises what run returns, defaulting to { ok: true }', async () => {
    const e = await executeToolCall([save], { id: 'z', name: 'save', arguments: '{"note":"n"}' }, { saved: [] })
    expect(e).toMatchObject({ accepted: true, errors: [], result: { ok: true }, message: { role: 'tool', toolCallId: 'z', content: '{"ok":true}' } })
  })
})
