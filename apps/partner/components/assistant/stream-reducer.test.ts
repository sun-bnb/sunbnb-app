import { describe, it, expect } from 'vitest'
import { INITIAL_STATE, reduce, type AssistantAction, type AssistantState } from './stream-reducer'
import type { AssistantEvent } from './sse-parser'

const run = (actions: AssistantAction[], from: AssistantState = INITIAL_STATE) =>
  actions.reduce(reduce, from)
const ev = (event: AssistantEvent): AssistantAction => ({ type: 'event', event })
const sent: AssistantAction = { type: 'user_sent', userId: 'u1', assistantId: 'a1', text: 'hello' }

describe('assistant stream reducer', () => {
  it('appends the user bubble plus an empty assistant placeholder and starts streaming', () => {
    const s = run([sent])
    expect(s.status).toBe('streaming')
    expect(s.messages.map((m) => [m.role, m.text])).toEqual([['user', 'hello'], ['assistant', '']])
  })

  it('accumulates text deltas on the assistant message only', () => {
    const s = run([sent, ev({ type: 'text', delta: 'He' }), ev({ type: 'text', delta: 'llo' })])
    expect(s.messages[0].text).toBe('hello')
    expect(s.messages[1].text).toBe('Hello')
  })

  it('tracks tool activity: running then done / failed, matching by name', () => {
    const s = run([
      sent,
      ev({ type: 'tool_start', name: 'a', label: 'Reading a…' }),
      ev({ type: 'tool_start', name: 'b', label: 'Reading b…' }),
      ev({ type: 'tool_result', name: 'a', ok: true }),
      ev({ type: 'tool_result', name: 'b', ok: false }),
    ])
    expect(s.messages[1].tools.map((t) => t.status)).toEqual(['done', 'failed'])
  })

  it('settles the right call when the same tool runs twice', () => {
    const s = run([
      sent,
      ev({ type: 'tool_start', name: 'a', label: 'x' }),
      ev({ type: 'tool_result', name: 'a', ok: true }),
      ev({ type: 'tool_start', name: 'a', label: 'x' }),
    ])
    expect(s.messages[1].tools.map((t) => t.status)).toEqual(['done', 'running'])
  })

  it('records conversation id and returns to idle on done', () => {
    const s = run([sent, ev({ type: 'conversation', conversationId: 'c1' }), ev({ type: 'text', delta: 'x' }), ev({ type: 'done', conversationId: 'c1' })])
    expect(s.conversationId).toBe('c1')
    expect(s.status).toBe('idle')
  })

  it('attaches proposals to the assistant message', () => {
    const s = run([sent, ev({ type: 'proposal', actionId: 'p1', kind: 'k', summary: 'S', preview: null })])
    expect(s.messages[1].proposals).toEqual([{ actionId: 'p1', kind: 'k', summary: 'S', preview: null, status: 'proposed' }])
  })

  it('an error before any output removes the empty placeholder and keeps the user message', () => {
    const s = run([sent, ev({ type: 'error', code: 'budget', message: '' })])
    expect(s.error).toBe('budget')
    expect(s.status).toBe('idle')
    expect(s.messages.map((m) => m.role)).toEqual(['user'])
  })

  it('an error after partial text keeps the partial reply and fails running tools', () => {
    const s = run([sent, ev({ type: 'text', delta: 'part' }), ev({ type: 'tool_start', name: 't', label: 'l' }), { type: 'failed', code: 'unavailable' }])
    expect(s.messages[1].text).toBe('part')
    expect(s.messages[1].tools[0].status).toBe('failed')
  })

  it('forbidden hides the assistant entirely', () => {
    expect(run([sent, { type: 'failed', code: 'forbidden' }]).availability).toBe('hidden')
  })

  it('stop keeps what streamed so far and returns to idle', () => {
    const s = run([sent, ev({ type: 'text', delta: 'abc' }), { type: 'stopped' }])
    expect(s.status).toBe('idle')
    expect(s.messages[1].text).toBe('abc')
    expect(s.error).toBeNull()
  })

  it('a new message clears a previous error', () => {
    const failed = run([sent, { type: 'failed', code: 'rate_limited' }])
    expect(run([{ ...sent, userId: 'u2', assistantId: 'a2' }], failed).error).toBeNull()
  })

  it('probe adopts history when empty, but never overwrites a live conversation', () => {
    const adopted = run([{ type: 'probed', availability: 'available', conversationId: 'c1', history: [{ role: 'assistant', text: 'hi', tools: [{ name: 't', label: 'L' }] }] }])
    expect(adopted.conversationId).toBe('c1')
    expect(adopted.messages[0].tools[0].status).toBe('done')
    const live = run([sent, { type: 'probed', availability: 'available', conversationId: 'zzz', history: [{ role: 'user', text: 'old' }] }])
    expect(live.messages).toHaveLength(2)
    expect(live.conversationId).toBeNull()
  })

  it('503 probe leaves the button visible (unavailable), 403 hides it', () => {
    expect(run([{ type: 'probed', availability: 'unavailable' }]).availability).toBe('unavailable')
    expect(run([{ type: 'probed', availability: 'hidden' }]).availability).toBe('hidden')
  })

  it('reset starts a fresh conversation but keeps availability and open state', () => {
    const s = run([{ type: 'open' }, { type: 'probed', availability: 'available' }, sent, ev({ type: 'conversation', conversationId: 'c1' }), { type: 'reset' }])
    expect(s).toMatchObject({ messages: [], conversationId: null, status: 'idle', open: true, availability: 'available' })
  })

  it('returns the same state object for no-op transitions (stable snapshots)', () => {
    expect(reduce(INITIAL_STATE, { type: 'close' })).toBe(INITIAL_STATE)
    expect(reduce(INITIAL_STATE, { type: 'ended' })).toBe(INITIAL_STATE)
  })

  describe('proposal status', () => {
    const withProposal = () =>
      run([sent, ev({ type: 'proposal', actionId: 'p1', kind: 'k', summary: 'S', preview: null }), ev({ type: 'proposal', actionId: 'p2', kind: 'k', summary: 'T', preview: null })])
    const status = (s: AssistantState, id: string) =>
      s.messages.flatMap((m) => m.proposals).find((p) => p.actionId === id)!

    it('updates only the targeted proposal and records appliedAt', () => {
      const s = run([{ type: 'proposal_status', actionId: 'p1', status: 'applied', appliedAt: 123 }], withProposal())
      expect(status(s, 'p1')).toMatchObject({ status: 'applied', appliedAt: 123 })
      expect(status(s, 'p2').status).toBe('proposed')
    })
    it('apply then undo keeps appliedAt and ends undone', () => {
      const s = run(
        [
          { type: 'proposal_status', actionId: 'p1', status: 'applied', appliedAt: 5 },
          { type: 'proposal_status', actionId: 'p1', status: 'undone' },
        ],
        withProposal(),
      )
      expect(status(s, 'p1')).toMatchObject({ status: 'undone', appliedAt: 5 })
    })
    it('is a no-op (same state object) for unknown ids or unchanged status', () => {
      const base = withProposal()
      expect(reduce(base, { type: 'proposal_status', actionId: 'nope', status: 'applied' })).toBe(base)
      expect(reduce(base, { type: 'proposal_status', actionId: 'p1', status: 'proposed' })).toBe(base)
    })
    it('survives settle on done (cards are not an empty placeholder)', () => {
      const s = run([ev({ type: 'done' })], withProposal())
      expect(s.messages[1].proposals).toHaveLength(2)
    })
    it('restores proposals with status from the transcript, defaulting bad values', () => {
      const s = run([{ type: 'probed', availability: 'available', history: [{ role: 'assistant', text: 'x', proposals: [{ actionId: 'a', kind: 'k', summary: 's', preview: {}, status: 'applied' }, { actionId: 'b', kind: 'k', summary: 's', status: 'bogus' }] }] }])
      expect(s.messages[0].proposals.map((p) => p.status)).toEqual(['applied', 'proposed'])
    })
  })
})

describe('qr_print in the reducer', () => {
  it('attaches the request to the streaming assistant message and keeps it through done', () => {
    const s = run([sent, ev({ type: 'qr_print', parcel: 2 }), ev({ type: 'done' })])
    expect(s.messages[1]?.qrPrints).toEqual([{ parcel: 2, seatLabels: undefined }])
  })
  it('a message that only carries a qr_print is not dropped as an empty placeholder', () => {
    const s = run([sent, ev({ type: 'qr_print', seatLabels: ['A1'] }), { type: 'ended' }])
    expect(s.messages).toHaveLength(2)
  })

  it('shows attachments on the live user message', () => {
    const s = run([{ ...sent, attachments: [{ id: 'u1', name: 'menu.pdf', kind: 'document' }] }])
    expect(s.messages[0].attachments).toEqual([{ id: 'u1', name: 'menu.pdf', kind: 'document' }])
    expect(run([sent]).messages[0].attachments).toBeUndefined()
  })

  it('restores attachments from the transcript GET', () => {
    const s = run([
      {
        type: 'probed',
        availability: 'available',
        history: [
          { role: 'user', text: 'see file', attachments: [{ id: 'x', name: 'a.png', kind: 'photo' }] },
          { role: 'assistant', text: 'ok' },
        ],
      },
    ])
    expect(s.messages[0].attachments).toEqual([{ id: 'x', name: 'a.png', kind: 'photo' }])
    expect(s.messages[1].attachments).toBeUndefined()
  })
})

describe('align_photo in the reducer', () => {
  const req = {
    uploadId: 'u1',
    seed: { kind: 'similarity' as const, anchorPx: { x: 1, y: 2 }, anchor: { lat: 1, lng: 2 }, metersPerPx: 0.1, rotationDeg: 0 },
    image: { w: 100, h: 50 },
  }
  it('attaches the request to the streaming assistant message', () => {
    const s = run([sent, ev({ type: 'align_photo', ...req }), ev({ type: 'done' })])
    expect(s.messages[1]?.alignPhotos).toEqual([req])
  })
  it('a message that only carries an align_photo is not dropped as an empty placeholder', () => {
    const s = run([sent, ev({ type: 'align_photo', ...req }), { type: 'ended' }])
    expect(s.messages).toHaveLength(2)
  })
})
