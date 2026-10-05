import { describe, expect, it } from 'vitest'
import { assignVariant, generateLeadToken, isLeadEventName, LEAD_TOKEN_RE, parseAngle, parseClickId, parseEventProps, parseLeadLayout, parseLeadRuns, parseVariants, retentionCutoffs } from './lead-model'

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

describe('assignVariant — sticky A/B arm per lead', () => {
  it('is stable for a token', () => {
    expect(assignVariant('abcdefghijkm', ['a', 'b'])).toBe(assignVariant('abcdefghijkm', ['a', 'b']))
  })

  it('splits roughly evenly across many tokens', () => {
    const counts = { a: 0, b: 0 }
    for (let i = 0; i < 2000; i++) counts[assignVariant(generateLeadToken(), ['a', 'b'])]++
    expect(counts.a).toBeGreaterThan(850)
    expect(counts.b).toBeGreaterThan(850)
  })

  it('with one live arm, everyone gets it', () => {
    for (let i = 0; i < 50; i++) expect(assignVariant(generateLeadToken(), ['a'])).toBe('a')
  })

  it('parses the env kill switch, ignoring junk', () => {
    expect(parseVariants('a,b')).toEqual(['a', 'b'])
    expect(parseVariants(' b ')).toEqual(['b'])
    expect(parseVariants('x,y')).toEqual(['a'])
    expect(parseVariants(undefined)).toEqual(['a'])
  })
})

describe('event input rules — /api/events is public', () => {
  it('accepts only allow-listed event names', () => {
    expect(isLeadEventName('mockup_created')).toBe(true)
    expect(isLeadEventName('drop table')).toBe(false)
  })

  it('accepts small flat funnel props', () => {
    expect(parseEventProps({ source: 'vision', ms: 840, ok: true })).toEqual({ source: 'vision', ms: 840, ok: true })
  })

  it.each([
    [{ nested: { a: 1 } }],
    [{ text: 'x'.repeat(65) }],
    [{ 'Bad-Key': 1 }],
    [Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i]))],
    [[1, 2]],
    ['string'],
  ])('rejects %j', (props) => {
    expect(parseEventProps(props)).toBeNull()
  })

  it('angles and click ids', () => {
    expect(parseAngle('noshow')).toBe('noshow')
    expect(parseAngle('<script>')).toBeNull()
    expect(parseClickId('Cj0KCQjw_abc-123.xyz')).toBe('Cj0KCQjw_abc-123.xyz')
    expect(parseClickId('short')).toBeNull()
    expect(parseClickId('has space in it ok')).toBeNull()
  })
})

describe('parseLeadRuns — the qualifier answer from a public form', () => {
  it('keeps known values, de-duplicated', () => {
    expect(parseLeadRuns('fnb,rentals,fnb')).toEqual(['fnb', 'rentals'])
  })
  it('"none" means just sunbeds, and only stands alone', () => {
    expect(parseLeadRuns('none')).toEqual(['none'])
    expect(parseLeadRuns('none,tables')).toEqual(['tables'])
  })
  it('drops anything else; absent or oversized = not answered', () => {
    expect(parseLeadRuns('fnb,<script>,casino')).toEqual(['fnb'])
    expect(parseLeadRuns(null)).toEqual([])
    expect(parseLeadRuns('fnb,'.repeat(40))).toEqual([])
  })
})
