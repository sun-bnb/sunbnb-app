import { describe, expect, it } from 'vitest'
import type { ChatResult, LeadAgentModel } from './model.ts'
import { runTurn } from './run-turn.ts'

/** A scripted model: returns the given steps in order. */
function scripted(steps: Partial<ChatResult>[]): LeadAgentModel {
  let i = 0
  return {
    name: 'scripted',
    async chat() {
      const s = steps[i++] ?? {}
      return { content: s.content ?? '', toolCalls: s.toolCalls ?? [], timing: { firstTokenMs: 1, totalMs: 1 }, usage: null }
    },
  }
}

describe('runTurn', () => {
  it('keeps the answer a model gave ALONGSIDE a tool call, even if it adds nothing after', async () => {
    const model = scripted([
      { content: 'Yes — guests order from their phone.', toolCalls: [{ id: '1', name: 'update_lead', arguments: '{"business_type":"beach_club"}' }] },
      { content: '' },
    ])
    const r = await runTurn(model, [{ role: 'user', content: 'Can guests order drinks? We are a beach club.' }], {})
    expect(r.reply).toBe('Yes — guests order from their phone.')
    expect(r.lead.business_type).toBe('beach_club')
  })

  it('joins text from several steps in order', async () => {
    const model = scripted([
      { content: 'Saved.', toolCalls: [{ id: '1', name: 'adjust_mockup', arguments: '{"sunbed_count":140}' }] },
      { content: 'Your mockup now shows 140 sunbeds.' },
    ])
    const r = await runTurn(model, [{ role: 'user', content: 'Actually 140 sunbeds' }], {})
    expect(r.reply).toBe('Saved.\n\nYour mockup now shows 140 sunbeds.')
    expect(r.lead.mockupSunbedCount).toBe(140)
  })

  it('feeds a rejected tool call back as an error and does not apply it', async () => {
    const model = scripted([
      { toolCalls: [{ id: '1', name: 'update_lead', arguments: '{"email":"maria@guess.com"}' }] },
      { content: 'Could you type your email again?' },
    ])
    const r = await runTurn(model, [{ role: 'user', content: 'maria at sol dot' }], {})
    expect(r.lead.email).toBeUndefined()
    expect(r.toolEvents[0]!.accepted).toBe(false)
    expect(r.messages.find((m) => m.role === 'tool')?.content).toMatch(/did not write this email/)
  })

  it('autoCapture books the demo itself when the prospect leaves a phone — whatever the model does', async () => {
    // The model asks for a name instead of booking (Haiku 4.5's real failure).
    const model = scripted([{ content: 'Great, the team will call you. What should they cover?' }])
    const history = [{ role: 'user' as const, content: 'Call me tomorrow, +34 600 123 456' }]
    const r = await runTurn(model, history, {}, { autoCapture: true })
    expect(r.lead).toMatchObject({ phone: '+34 600 123 456', demoRequested: true })
    expect(r.toolEvents).toEqual([expect.objectContaining({ auto: true, accepted: true })])
    // The model saw the call + its ok result BEFORE replying.
    expect(r.messages.slice(0, 2).map((m) => m.role)).toEqual(['assistant', 'tool'])
  })

  it('autoCapture only adds NEW details once a demo is already requested (no second request)', async () => {
    const model = scripted([{ content: 'Noted.' }])
    const history = [{ role: 'user' as const, content: 'also my email jordi@club.com' }]
    const r = await runTurn(model, history, { phone: '+34600123456', demoRequested: true }, { autoCapture: true })
    expect(r.toolEvents[0]!.call.name).toBe('update_lead')
    expect(r.lead.email).toBe('jordi@club.com')
  })

  it('autoCapture does nothing without contact details, and is off by default', async () => {
    const quiet = await runTurn(scripted([{ content: 'Hi!' }]), [{ role: 'user', content: 'we have 120 sunbeds' }], {}, { autoCapture: true })
    expect(quiet.toolEvents).toEqual([])
    const off = await runTurn(scripted([{ content: 'Hi!' }]), [{ role: 'user', content: '+34 600 123 456' }], {})
    expect(off.toolEvents).toEqual([])
  })
})
