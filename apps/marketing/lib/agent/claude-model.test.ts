import { describe, expect, it } from 'vitest'
import { toClaudeMessages } from './claude-model.ts'

describe('toClaudeMessages', () => {
  it('lifts the system prompt out of the message list', () => {
    const r = toClaudeMessages([{ role: 'system', content: 'FACTS' }, { role: 'user', content: 'hi' }])
    expect(r.system).toBe('FACTS')
    expect(r.messages).toEqual([{ role: 'user', content: 'hi' }])
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
