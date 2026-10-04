import { describe, expect, it } from 'vitest'
import { generateLeadToken, LEAD_TOKEN_RE, parseLeadLayout, retentionCutoffs } from './lead-model'

describe('retentionCutoffs — the periods the privacy notice promises', () => {
  const now = new Date('2026-10-04T12:00:00Z')

  it('anonymous mockups: 90 days', () => {
    expect(retentionCutoffs(now).anonymousBefore.toISOString()).toBe('2026-07-06T12:00:00.000Z')
  })

  it('leads with contact: 24 calendar months', () => {
    expect(retentionCutoffs(now).contactBefore.toISOString()).toBe('2024-10-04T12:00:00.000Z')
  })
})

describe('generateLeadToken', () => {
  it('produces tokens matching the public format', () => {
    for (let i = 0; i < 200; i++) expect(generateLeadToken()).toMatch(LEAD_TOKEN_RE)
  })

  it('does not repeat (≈67 bits)', () => {
    const seen = new Set(Array.from({ length: 5000 }, generateLeadToken))
    expect(seen.size).toBe(5000)
  })

  it('never emits look-alike characters', () => {
    const all = Array.from({ length: 500 }, generateLeadToken).join('')
    expect(all).not.toMatch(/[0O1lI]/)
  })
})

describe('parseLeadLayout — the public save action trusts nothing', () => {
  const ok = { anchorLat: 39.79, anchorLng: 3.12, seaBearingDeg: 50, placement: 'waterline' }

  it('accepts a valid layout', () => {
    expect(parseLeadLayout(ok)).toEqual(ok)
  })

  it.each([
    { ...ok, anchorLat: 91 },
    { ...ok, anchorLng: Number.NaN },
    { ...ok, seaBearingDeg: 360 },
    { ...ok, seaBearingDeg: 12.5 },
    { ...ok, placement: 'diagonal' },
    { ...ok, anchorLat: '39.79' },
  ])('rejects %j', (bad) => {
    expect(parseLeadLayout(bad)).toBeNull()
  })

  it('rejects non-objects', () => {
    expect(parseLeadLayout(null)).toBeNull()
    expect(parseLeadLayout('x')).toBeNull()
  })
})
