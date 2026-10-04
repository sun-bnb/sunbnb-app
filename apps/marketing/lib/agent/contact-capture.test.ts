import { describe, expect, it } from 'vitest'
import { validateToolCall } from './tools.ts'
import { extractContact } from './contact-capture.ts'

describe('extractContact — what counts as the prospect leaving contact details', () => {
  it.each([
    ['Can someone call me tomorrow? My number is +34 600 123 456.', { phone: '+34 600 123 456' }],
    ["I'm Jordi, jordi@calamayorclub.com", { email: 'jordi@calamayorclub.com' }],
    ['mail: maria@chiringuitosol.es.', { email: 'maria@chiringuitosol.es' }],
    ['WhatsApp 600 123 456 please', { phone: '600 123 456' }],
    ['(+358) 40-123 4567', { phone: '(+358) 40-123 4567' }],
    ['both: sofia@hotelmar.gr or +30 694 123 4567', { email: 'sofia@hotelmar.gr', phone: '+30 694 123 4567' }],
  ])('%s', (msg, expected) => {
    expect(extractContact(msg)).toEqual(expected)
  })

  it.each([
    'We have 120 sunbeds and charge €25 a day',
    'Season runs 2026-05-01 to 2026-10-15',
    'Thursday afternoon at 15:30 works',
    'maria at chiringuitosol dot', // garbled — the agent asks again, nothing is captured
    'call me on 600 123', // too short to be a phone
  ])('captures nothing from %j', (msg) => {
    expect(extractContact(msg)).toEqual({})
  })

  it('does not read digits inside an email as a phone', () => {
    expect(extractContact('jordi200712345@club.com')).toEqual({ email: 'jordi200712345@club.com' })
  })

  it('anything it extracts passes the same grounding check as a model-proposed call', () => {
    const msg = 'Call me: +34 600 123 456, or jordi@calamayorclub.com'
    const { email, phone } = extractContact(msg)
    expect(validateToolCall('request_demo', { email, phone }, { userText: msg })).toEqual({ ok: true })
  })
})
