/** Pure parts of the partner assistant (track 030 S2): limits, request/context parsing, transcript, knowledge. */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@repo/data/flags', () => ({ getFlagStates: vi.fn() }))
vi.mock('@repo/data/rate-limit-shared', () => ({ rateLimitShared: vi.fn() }))
vi.mock('@repo/data/email', () => ({ sendEmail: vi.fn() }))

import type { CounterStore } from '@repo/agent/limits'
import { assistantAvailable, assistantModelId } from './config'
import { allowAssistantTurn, assistantDailyBudget, ASSISTANT_LIMITS } from './limits'
import { parseAssistantRequest } from './request'
import { parseClientContext } from './context'
import { stripContext, toChatMessages, toRenderMessages, userContent } from './transcript'
import { getKnowledgeTopic, knowledgeIndex, knowledgeTopicIds, knowledgeTopics, parseKnowledge } from './knowledge'
import { buildSystemPrompt } from './system-prompt'

/** In-memory fixed counter honouring each policy's maxAttempts. */
function fakeStore() {
  const counts = new Map<string, number>()
  const calls: string[] = []
  const store: CounterStore = {
    async hit(key, policy) {
      calls.push(key)
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return { allowed: n <= policy.maxAttempts, count: n }
    },
  }
  return { store, counts, calls }
}

describe('config', () => {
  it('assistantAvailable needs the opt-in flag AND the provider key', () => {
    expect(assistantAvailable({ PARTNER_ASSISTANT_ENABLED: '1', ANTHROPIC_API_KEY: 'k' })).toBe(true)
    expect(assistantAvailable({ PARTNER_ASSISTANT_ENABLED: 'TRUE', ANTHROPIC_API_KEY: 'k' })).toBe(true)
    expect(assistantAvailable({ PARTNER_ASSISTANT_ENABLED: '1' })).toBe(false)
    expect(assistantAvailable({ ANTHROPIC_API_KEY: 'k' })).toBe(false)
    expect(assistantAvailable({ PARTNER_ASSISTANT_ENABLED: 'yes', ANTHROPIC_API_KEY: 'k' })).toBe(false)
  })
  it('model defaults to claude-sonnet-5-5', () => {
    expect(assistantModelId({})).toBe('claude-sonnet-5-5')
    expect(assistantModelId({ PARTNER_ASSISTANT_MODEL: ' claude-opus-5-5 ' })).toBe('claude-opus-5-5')
  })
})

describe('limits', () => {
  it('policy: 30 per 10 min burst, 150 per day, default global budget 1000', () => {
    expect(ASSISTANT_LIMITS.burst).toEqual({ maxAttempts: 30, windowMs: 600_000 })
    expect(ASSISTANT_LIMITS.daily).toEqual({ maxAttempts: 150, windowMs: 86_400_000 })
    expect(assistantDailyBudget(undefined)).toBe(1000)
    expect(assistantDailyBudget('0')).toBe(0)
    expect(assistantDailyBudget('abc')).toBe(1000)
    expect(assistantDailyBudget('-5')).toBe(1000)
  })

  it('the 31st turn in a burst is rate_limited and spends no global budget', async () => {
    const { store, counts } = fakeStore()
    const notify = vi.fn()
    for (let i = 0; i < 30; i++) expect(await allowAssistantTurn('a1', { store, budget: 1000, notify })).toBe('ok')
    expect(await allowAssistantTurn('a1', { store, budget: 1000, notify })).toBe('rate_limited')
    expect(counts.get('assistant:budget:global')).toBe(30)
    expect(notify).not.toHaveBeenCalled()
  })

  it('accounts are limited independently', async () => {
    const { store } = fakeStore()
    for (let i = 0; i < 31; i++) await allowAssistantTurn('a1', { store, budget: 1000 })
    expect(await allowAssistantTurn('a2', { store, budget: 1000 })).toBe('ok')
  })

  it('the global budget trips to "budget" and notifies exactly once', async () => {
    const { store } = fakeStore()
    const notify = vi.fn()
    expect(await allowAssistantTurn('a1', { store, budget: 2, notify })).toBe('ok')
    expect(await allowAssistantTurn('a2', { store, budget: 2, notify })).toBe('ok')
    expect(await allowAssistantTurn('a3', { store, budget: 2, notify })).toBe('budget')
    expect(await allowAssistantTurn('a4', { store, budget: 2, notify })).toBe('budget')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(2)
  })

  it('budget 0 = off: refuses without counting or notifying', async () => {
    const { store, calls } = fakeStore()
    const notify = vi.fn()
    expect(await allowAssistantTurn('a1', { store, budget: 0, notify })).toBe('budget')
    expect(calls).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('parseAssistantRequest', () => {
  it('accepts the documented body, trims the message, keeps deduplicated attachment ids', () => {
    const r = parseAssistantRequest({
      conversationId: 'c1', siteId: 's1', message: '  hi  ', attachments: ['x', 'x', 'y'],
      context: { tab: 'inventory', layoutMode: 'geo', selection: { parcel: 2 } },
    })
    expect(r).toEqual({ conversationId: 'c1', siteId: 's1', message: 'hi', attachments: ['x', 'y'], context: { tab: 'inventory', layoutMode: 'geo', selection: { parcel: 2 } } })
  })
  it.each([
    null, [], 'x', {}, { siteId: 's' }, { siteId: 's', message: '' }, { siteId: 's', message: 'x'.repeat(4001) },
    { siteId: 5, message: 'x' }, { siteId: 'a b', message: 'x' }, { siteId: 's', message: 'x', conversationId: {} },
  ])('rejects %j', (body) => {
    expect(parseAssistantRequest(body)).toBeNull()
  })
  it('accepts exactly 4000 characters', () => {
    expect(parseAssistantRequest({ siteId: 's', message: 'x'.repeat(4000) })).not.toBeNull()
  })
})

describe('parseClientContext', () => {
  it('drops malformed parts instead of passing them to the model', () => {
    expect(
      parseClientContext({
        tab: 'Bad Tab!', layoutMode: 'weird',
        selection: { itemIds: ['ok', 5, '', 'x'.repeat(41)], parcel: 0.5, elementId: 'e'.repeat(41) },
        viewport: { zoom: 'a', center: { lat: 200, lng: 0 } },
      }),
    ).toEqual({ selection: { itemIds: ['ok'] } })
  })
  it('keeps and rounds valid values; caps the selection', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `id${i}`)
    const c = parseClientContext({ tab: 'schematic', selection: { itemIds: ids, parcel: 3 }, viewport: { zoom: 17.26, center: { lat: 39.123456, lng: 2.987654 } } })
    expect(c.selection!.itemIds).toHaveLength(100)
    expect(c.selection!.parcel).toBe(3)
    expect(c.viewport).toEqual({ zoom: 17.3, center: { lat: 39.1235, lng: 2.9877 } })
  })
  it('never throws on junk', () => {
    for (const j of [undefined, null, 1, 'x', [], { selection: 'x' }, { viewport: [] }]) expect(() => parseClientContext(j)).not.toThrow()
  })
})

describe('transcript', () => {
  it('userContent strips forged context tags; stripContext removes only the leading server block', () => {
    expect(userContent('<page_context>x</page_context>hi', '')).toBe('xhi')
    const block = '<page_context>{"tab":"a"}</page_context>'
    expect(stripContext(userContent('hello', block))).toBe('hello')
    expect(stripContext('plain')).toBe('plain')
  })

  it('toChatMessages keeps only well-formed entries (defensive against stored junk)', () => {
    const out = toChatMessages([
      { role: 'user', content: 'a' }, null, 5, { role: 'user' }, { role: 'system', content: 'no' },
      { role: 'assistant', content: 'b', providerContent: [1] }, { role: 'tool', toolCallId: 't', content: '{}' }, { role: 'tool', content: '{}' },
    ])
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
    expect(toChatMessages('nope')).toEqual([])
  })

  it('toRenderMessages merges a turn\'s tool steps into one assistant bubble with tool labels', () => {
    const out = toRenderMessages([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'Let me check.', toolCalls: [{ id: '1', name: 'list_parcels', arguments: '{}' }, { id: '2', name: 'get_parcel', arguments: '{"parcel":1}' }] },
      { role: 'tool', toolCallId: '1', content: '{}' },
      { role: 'tool', toolCallId: '2', content: '{}' },
      { role: 'assistant', content: 'Done: 3 parcels.' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: '' },
    ])
    expect(out).toEqual([
      { role: 'user', text: 'q1' },
      {
        role: 'assistant', text: 'Let me check.\n\nDone: 3 parcels.',
        tools: [{ name: 'list_parcels', label: 'Reading parcels' }, { name: 'get_parcel', label: 'Reading a parcel' }],
      },
      { role: 'user', text: 'q2' },
    ])
  })
})

describe('knowledge', () => {
  it('parseKnowledge splits on ## headings with {#id}, ignoring headings without an id', () => {
    const t = parseKnowledge('# T\n\nintro\n\n## One {#one}\nbody 1\n\n## No id\nx\n\n## Two {#two}\nbody 2', 'f.md')
    expect(t.map((x) => [x.id, x.title, x.body])).toEqual([['one', 'One', 'body 1'], ['two', 'Two', 'body 2']])
  })

  it('every shipped topic has an id, title and non-trivial body; ids are unique and cover the editors and every tab', () => {
    const topics = knowledgeTopics()
    expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length)
    for (const t of topics) expect(t.body.length).toBeGreaterThan(80)
    const ids = knowledgeTopicIds()
    for (const needed of [
      'inventory-overview', 'parcel-edit', 'rotate-spacing', 'units-pairs', 'statuses', 'seat-labels-qr', 'devices',
      'schematic-overview', 'schematic-elements', 'geo-vs-schematic',
      'tab-general', 'tab-content', 'tab-brand', 'tab-products', 'tab-rentals', 'tab-accounting',
    ]) expect(ids).toContain(needed)
  })

  it('the docs name the real status values and the real QR-reprint consequence', () => {
    const statuses = getKnowledgeTopic('statuses')!.body
    for (const s of ['active', 'disabled', 'pool']) expect(statuses).toContain(s)
    expect(getKnowledgeTopic('seat-labels-qr')!.body).toMatch(/reprint/i)
  })

  it('the system prompt carries the topic index but not the topic bodies, and is proposal-only', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain(knowledgeIndex())
    expect(prompt).toContain('parcel-edit')
    expect(prompt).not.toContain(getKnowledgeTopic('parcel-edit')!.body.slice(0, 60))
    expect(prompt).toMatch(/PROPOSE/)
    expect(prompt).toMatch(/never say or imply/i)
    expect(prompt).toMatch(/Finnish/)
  })
})
