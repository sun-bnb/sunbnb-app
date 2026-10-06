/**
 * No-hardcoded-tier-pricing guard.
 *
 * The plan catalogue (name, monthly price, commission %) lives ONLY in
 * PRICING_TIERS (`@repo/data/pricing-tiers`). Billing seeds ServiceFee and
 * SubscriptionPlan rows from it; partner screens must read it too. Local copies
 * drift (a stale TIER_FEES once told partners "Pro = 2%" while Pro charges 3%).
 *
 * Flags, in non-test .ts/.tsx under app/ and lib/:
 *   1. Declaring a TIER_FEES / TIER_PRICES / TIER_COMMISSIONS-style constant.
 *   2. An object entry keyed by a tier (STARTER|PRO|BUSINESS) whose value is a
 *      number or percent/price string literal, e.g. `PRO: '2%'`, `BUSINESS: 79`.
 * Tier-keyed entries with other values (labels, icons, enums) are not flagged.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { globSync } from 'glob'

const PARTNER_ROOT = path.resolve(__dirname, '../..')

const CONSTANT_RE = /\bTIER_(?:FEES?|PRICES?|COMMISSIONS?|RATES?)\b/
// `PRO: '2%'`, `PRO: "€29"`, `BUSINESS: 79`, `STARTER: 1.5,` — value is only a number / money / percent literal
const TIER_KEYED_LITERAL_RE =
  /\b(?:STARTER|PRO|BUSINESS)\s*:\s*(?:(['"`])\s*[€$]?\s*\d+(?:[.,]\d+)?\s*[%€$]?\s*\1|\d+(?:\.\d+)?)\s*[,}\n]/

export function findTierPricingViolations(src: string): { line: number; snippet: string }[] {
  const out: { line: number; snippet: string }[] = []
  src.split('\n').forEach((l, i) => {
    if (CONSTANT_RE.test(l) || TIER_KEYED_LITERAL_RE.test(l + '\n')) {
      out.push({ line: i + 1, snippet: l.trim() })
    }
  })
  return out
}

describe('No-hardcoded-tier-pricing guard', () => {
  it('matcher flags the legacy stale constants and tier-keyed literals', () => {
    const legacy = "const TIER_FEES: Record<string, string> = { STARTER: '5%', PRO: '2%', BUSINESS: '0%' }"
    expect(findTierPricingViolations(legacy)).toHaveLength(1)
    expect(findTierPricingViolations('  PRO: 29,')).toHaveLength(1)
    expect(findTierPricingViolations("  BUSINESS: '€79',")).toHaveLength(1)
  })

  it('matcher ignores unrelated tier keys and percentages', () => {
    expect(findTierPricingViolations("const x = { PRO: 'Pro', BUSINESS: 'Business' }")).toHaveLength(0)
    expect(findTierPricingViolations('<div className="w-[50%]" style={{ width: "100%" }} />')).toHaveLength(0)
    expect(findTierPricingViolations('const vat = { PRO: PRICING_TIERS.PRO.monthlyPrice }')).toHaveLength(0)
    expect(findTierPricingViolations("const tax = '21%'")).toHaveLength(0)
  })

  it('partner source reads tier pricing from PRICING_TIERS, never hardcodes it', () => {
    const files = globSync('{app,lib}/**/*.{ts,tsx}', { cwd: PARTNER_ROOT, absolute: true }).filter(
      (f) =>
        !/\.test\.tsx?$/.test(f) &&
        !f.includes('__mocks__') &&
        !f.includes('/test/'),
    )
    const offenders = files.flatMap((f) =>
      findTierPricingViolations(fs.readFileSync(f, 'utf-8')).map(
        (v) => `  ${path.relative(PARTNER_ROOT, f)}:${v.line}  ${v.snippet}`,
      ),
    )
    expect(
      offenders,
      `Hardcoded tier pricing found. Use PRICING_TIERS from '@repo/data/pricing-tiers':\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
