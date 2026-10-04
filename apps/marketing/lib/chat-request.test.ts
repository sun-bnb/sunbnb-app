import { describe, expect, it } from 'vitest'
import { leadStateFromRow, MAX_CHAT_MESSAGE_CHARS, parseChatRequest, turnEffects } from './chat-request.ts'

const ok = { token: 'abcdefghijkm', sessionId: '3f0c2a8e-1b2c-4d5e-8f90-123456789abc', message: '  hi  ' }

describe('parseChatRequest — a public endpoint that spends API money', () => {
  it('accepts a valid request and trims the message', () => {
    expect(parseChatRequest(ok)).toEqual({ ...ok, message: 'hi' })
  })

  it.each([
    { ...ok, token: 'short' },
    { ...ok, sessionId: 'not-a-uuid' },
    { ...ok, message: '   ' },
    { ...ok, message: 'x'.repeat(MAX_CHAT_MESSAGE_CHARS + 1) },
    { ...ok, message: 42 },
    null,
    'string',
  ])('rejects %j', (body) => {
    expect(parseChatRequest(body)).toBeNull()
  })
})

describe('leadStateFromRow', () => {
  it('a lead that requested a demo (or that the team moved on) counts as requested', () => {
    const row = { status: 'contacted', sunbedCount: 120, contactName: 'M', email: null, phone: '+34', businessName: null, businessType: null }
    expect(leadStateFromRow(row)).toEqual({ mockupSunbedCount: 120, demoRequested: true, name: 'M', phone: '+34' })
  })
})

describe('turnEffects — only what changed', () => {
  const before = { mockupSunbedCount: 120, demoRequested: false, email: 'a@b.es' }

  it('a turn that changed nothing writes nothing', () => {
    expect(turnEffects(before, { ...before })).toEqual({ contact: {}, sunbedCount: undefined, demoRequested: false })
  })

  it('maps agent fields to lead columns', () => {
    const after = { ...before, name: 'Jordi', phone: '+34 600', business_name: 'Club', business_type: 'beach_club' }
    expect(turnEffects(before, after).contact).toEqual({ contactName: 'Jordi', phone: '+34 600', businessName: 'Club', businessType: 'beach_club' })
  })

  it('the demo request is reported only on the transition', () => {
    expect(turnEffects(before, { ...before, demoRequested: true }).demoRequested).toBe(true)
    expect(turnEffects({ ...before, demoRequested: true }, { ...before, demoRequested: true }).demoRequested).toBe(false)
  })

  it('resizes the mockup from adjust_mockup, or from the count they state about their beach', () => {
    expect(turnEffects(before, { ...before, mockupSunbedCount: 140 }).sunbedCount).toBe(140)
    expect(turnEffects(before, { ...before, sunbed_count: 80 }).sunbedCount).toBe(80)
  })
})
