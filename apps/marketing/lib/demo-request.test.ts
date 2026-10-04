import { describe, expect, it } from 'vitest'
import { looksAutomated, MIN_FILL_MS, parseDemoRequest } from './demo-request.ts'

const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const valid = { name: 'Maria', email: 'maria@chiringuitosol.es', consent: 'on' }

describe('parseDemoRequest', () => {
  it('accepts name + email + consent', () => {
    expect(parseDemoRequest(form(valid))).toEqual({
      ok: true,
      value: { contactName: 'Maria', email: 'maria@chiringuitosol.es', phone: null, businessName: null, message: null },
    })
  })

  it('accepts a phone instead of an email', () => {
    expect(parseDemoRequest(form({ name: 'Jordi', phone: '+34 600 123 456', consent: 'on' })).ok).toBe(true)
  })

  it('requires SOME way to reach them', () => {
    expect(parseDemoRequest(form({ name: 'Maria', consent: 'on' }))).toEqual({ ok: false, errors: ['contact'] })
  })

  it('requires consent — no consent, nothing is stored', () => {
    expect(parseDemoRequest(form({ ...valid, consent: '' }))).toEqual({ ok: false, errors: ['consent'] })
  })

  it.each([
    [{ ...valid, email: 'maria at sol' }, 'email'],
    [{ ...valid, phone: 'call me' }, 'phone'],
    [{ ...valid, phone: '123' }, 'phone'],
    [{ ...valid, name: '   ' }, 'name'],
    [{ ...valid, message: 'x'.repeat(2001) }, 'tooLong'],
  ] as const)('rejects %j with %s', (fields, error) => {
    const r = parseDemoRequest(form(fields))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain(error)
  })

  it('trims and caps free text', () => {
    const r = parseDemoRequest(form({ ...valid, business: `  ${'B'.repeat(300)}  ` }))
    expect(r.ok && r.value.businessName?.length).toBe(200)
  })
})

describe('looksAutomated', () => {
  const now = 1_791_150_000_000

  it('passes a person who took their time', () => {
    expect(looksAutomated(form({ rendered_at: String(now - MIN_FILL_MS - 1) }), now)).toBe(false)
  })

  it('flags a filled honeypot', () => {
    expect(looksAutomated(form({ rendered_at: String(now - 60_000), website: 'http://spam' }), now)).toBe(true)
  })

  it('flags an instant submit', () => {
    expect(looksAutomated(form({ rendered_at: String(now - 500) }), now)).toBe(true)
  })

  it('flags a missing or forged timestamp', () => {
    expect(looksAutomated(form({}), now)).toBe(true)
    expect(looksAutomated(form({ rendered_at: 'abc' }), now)).toBe(true)
  })
})
