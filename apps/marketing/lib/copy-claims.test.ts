/**
 * "No invented claims" guard (track 027 D8). The previous AI-built page invented "100+ beaches",
 * "35 % uplift" and fake scarcity. Every user-facing string is scanned for figures, percentages
 * and customer-count language; a string may contain them only if its key is allow-listed below
 * with the reason it is true. ICU placeholders ({count}, {max}…) are data, not claims.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ALLOWED: Record<string, string> = {
  'Thread.mod_verifactu': 'the 2027 Veri*factu deadline — founder-approved wording (track 027, lib/agent/knowledge.ts)',
  'Thread.vf_badge': 'the 2027 Veri*factu deadline — founder-approved wording',
  'Hero.v.sunbed': 'a sunbed label in an illustration (A3), not a figure',
  'Hero.v.rc_sunbed': 'a sunbed label in an illustration (A3), not a figure',
  'Thread.pj_yourEstimate': 'the 30-day month the arithmetic uses (lib/projection.ts MONTH_DAYS), not a claim',
  'Thread.pj_keep': 'the % sign of the plan commission, interpolated from PRICING_TIERS (lib/projection.ts)',
  'Thread.greeting': 'quotes an example of what to type ("…, 80 sunbeds and a bar"), not a claim',
}

// Digits and % catch "100+ beaches" / "35 %"; number words catch "hundreds of venues"; promise
// words catch outcome guarantees. Plain nouns ("customers", "clientes") are not claims on their own.
const CLAIM = /\d|%|\b(dozens|hundreds|thousands|millions|docenas|cientos|miles|millones|kymmeniä|satoja|tuhansia|miljoonia|uplift|guarantee[sd]?|garantiza\w*|garantía|takaa\w*|takuu)\b/i

function leaves(obj: unknown, prefix = ''): [string, string][] {
  if (typeof obj === 'string') return [[prefix, obj]]
  if (obj && typeof obj === 'object') return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
  return []
}

describe.each(['en', 'es', 'fi'])('messages/%s.json', (locale) => {
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')) as unknown

  it('states no figure, percentage or customer count unless allow-listed', () => {
    const offenders = leaves(messages)
      .filter(([key]) => !ALLOWED[key])
      .map(([key, text]) => [key, text.replace(/\{[^{}]*\{[^{}]*\}[^{}]*\}|\{[^{}]*\}|#/g, '')] as const)
      .filter(([, text]) => CLAIM.test(text))
    expect(offenders).toEqual([])
  })
})
