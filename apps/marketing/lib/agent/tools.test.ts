import { describe, expect, it } from 'vitest'
import { validateToolCall } from './tools.ts'

describe('validateToolCall — the model proposes, the server decides', () => {
  it('accepts a well-formed lead update', () => {
    expect(validateToolCall('update_lead', { name: 'Maria', email: 'maria@chiringuitosol.es', sunbed_count: 80 })).toEqual({ ok: true })
  })

  it('rejects an email the prospect garbled, so the agent asks again instead of saving junk', () => {
    const r = validateToolCall('update_lead', { email: 'maria at chiringuitosol dot' })
    expect(r.ok).toBe(false)
  })

  it.each(['+34 600 123 456', '(+358) 40-123 4567', '600123456'])('accepts real-world phone format %s', (phone) => {
    expect(validateToolCall('update_lead', { phone })).toEqual({ ok: true })
  })

  it.each(['call me', '123', '+34 600 123 456 789 012 345'])('rejects non-phone %s', (phone) => {
    expect(validateToolCall('update_lead', { phone }).ok).toBe(false)
  })

  it.each([0, -5, 12.5, 5001, '80'])('rejects sunbed_count %s', (sunbed_count) => {
    expect(validateToolCall('adjust_mockup', { sunbed_count }).ok).toBe(false)
  })

  it('rejects fields the tool does not define — a model inventing a "discount" field must not reach the DB', () => {
    expect(validateToolCall('update_lead', { name: 'Maria', discount: 100 }).ok).toBe(false)
  })

  it('rejects an empty update', () => {
    expect(validateToolCall('update_lead', {}).ok).toBe(false)
  })

  it('refuses a demo request when nobody can be contacted', () => {
    expect(validateToolCall('request_demo', { preferred_time: 'tomorrow' }).ok).toBe(false)
  })

  it('allows a demo request once an email or phone is on the lead', () => {
    expect(validateToolCall('request_demo', {}, { email: 'a@b.es' })).toEqual({ ok: true })
    expect(validateToolCall('request_demo', {}, { phone: '+34600123456' })).toEqual({ ok: true })
  })

  it('rejects unknown tools and non-object arguments', () => {
    expect(validateToolCall('delete_everything', {}).ok).toBe(false)
    expect(validateToolCall('update_lead', ['x']).ok).toBe(false)
  })
})

describe('contact details must be grounded in what the prospect typed', () => {
  const userText = 'Email me at maria at chiringuitosol dot'

  it('rejects an email the model completed itself, even though it is well-formed', () => {
    expect(validateToolCall('update_lead', { email: 'maria@chiringuitosol.com' }, { userText }).ok).toBe(false)
  })

  it('accepts an email the prospect wrote, regardless of case', () => {
    expect(validateToolCall('update_lead', { email: 'maria@chiringuitosol.es' }, { userText: 'mail me: Maria@ChiringuitoSol.es' })).toEqual({ ok: true })
  })

  it('accepts a phone written with different spacing, rejects one the prospect never gave', () => {
    const t = 'call me on +34 600 123 456'
    expect(validateToolCall('update_lead', { phone: '+34600123456' }, { userText: t })).toEqual({ ok: true })
    expect(validateToolCall('update_lead', { phone: '+34 600 123 457' }, { userText: t }).ok).toBe(false)
  })
})

describe('request_demo carries its own contact details', () => {
  it('accepts a demo request that brings the phone in the same call', () => {
    const userText = 'Can someone call me tomorrow morning? My number is +34 600 123 456.'
    expect(validateToolCall('request_demo', { phone: '+34 600 123 456', preferred_time: 'tomorrow morning' }, { userText })).toEqual({ ok: true })
  })

  it('applies the same grounding to contact details passed to request_demo', () => {
    expect(validateToolCall('request_demo', { email: 'maria@chiringuitosol.com' }, { userText: 'maria at chiringuitosol dot' }).ok).toBe(false)
  })
})
