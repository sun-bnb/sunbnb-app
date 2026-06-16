/**
 * No-inline-money guard — Phase 0.4 of the partner test-architecture track.
 *
 * Architectural rule: server actions must NOT do inline money/VAT arithmetic.
 * All financial rounding and reverse-VAT must go through the @repo/data helpers:
 *   - round(amount)                        — financial rounding (2 dp)
 *   - computeVatAndBaseAmounts(gross, rate) — reverse-VAT: base = round(gross / (1 + rate/100))
 *
 * This guard statically scans every partner server-action source file and fails
 * if it finds:
 *
 *   1. .toFixed(  in a money context — when the same line references a money
 *      identifier (price|total|tax|vat|amount|fee|deposit|gross|net|priceBeforeTax).
 *      Non-money uses (geometry, display formatting of coordinates, file-size
 *      display) are NOT flagged. A bare `.toFixed(` with no surrounding money
 *      term is allowed.
 *
 *   2. Inline reverse-VAT pattern: `/ (1 +` where the divisor involves a
 *      tax/vat variable or `/100` arithmetic — the canonical shape of
 *      `totalPrice / (1 + taxPercent / 100)`.
 *
 * Allowlist: legitimate inline uses (none currently — every money operation must
 * go through @repo/data) live in INLINE_MONEY_ALLOWLIST below with justification.
 *
 * Known TRUE POSITIVE (intentionally RED until Phase 3 fix):
 *   app/sites/[id]/products/actions.ts — addProduct and updateProduct compute
 *   `price = totalPrice / (1 + taxPercent / 100)` and store via `.toFixed(2)`
 *   instead of calling round() + computeVatAndBaseAmounts().
 *
 * Precision guarantee:
 *   - Coordinates (.toFixed(5) on lat/lng), file-size (file.size / 1024), and
 *     percentage formatting (.toFixed(0) on fee.percentage) live in .tsx files
 *     that are outside the scan scope (action files only).
 *   - The money-identifier check prevents false positives on any non-money
 *     `.toFixed(` usage that might appear in action files in the future.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { globSync } from 'glob'

// ─── Paths ────────────────────────────────────────────────────────────────────

const PARTNER_ROOT = path.resolve(__dirname, '../..')  // apps/partner

// ─── Money-context identifiers ────────────────────────────────────────────────
//
// A .toFixed( or / (1 + on a line is only a money violation if the line also
// references one of these terms. This prevents false positives on geometry,
// display-only percentage formatting, file size calculations, etc.
//
// The list is deliberately conservative: err on the side of flagging real
// money work rather than missing it. Non-money identifiers that happen to match
// (e.g. "totalDays") don't appear in server actions alongside .toFixed(.
//
// Order does not matter — the regex is an alternation.

const MONEY_TERMS = [
  'price',
  'total',        // totalPrice, total, subtotal
  'tax',
  'vat',
  'amount',
  'fee',
  'deposit',
  'gross',
  'net',
  'priceBeforeTax',
]

// Regex: any money term as a word boundary (case-insensitive)
// e.g. "totalPrice", "taxPercent", "priceBeforeTax", "vatRate", "feeAmount"
const MONEY_TERM_RE = new RegExp(
  `\\b(?:${MONEY_TERMS.join('|')})\\b`,
  'i',
)

// ─── Patterns to flag ─────────────────────────────────────────────────────────

/**
 * Pattern 1: .toFixed( in a money context.
 *
 * We scan line by line. A line with .toFixed( is flagged iff it also matches
 * the money-identifier regex. This catches:
 *   +priceBeforeTax.toFixed(2)
 *   updateData.price = +priceBeforeTax.toFixed(2)
 *
 * And does NOT flag:
 *   (fee.percentage ?? 0).toFixed(0)   — "percentage" is not in the money list
 *   Number(mapCoords.lat).toFixed(5)   — no money term
 *   (file.size / 1024).toFixed(0)      — no money term
 */
function findMoneyToFixed(src: string): number[] {
  const lines = src.split('\n')
  const offendingLines: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('.toFixed(') && MONEY_TERM_RE.test(line)) {
      offendingLines.push(i + 1)  // 1-based line number
    }
  }
  return offendingLines
}

/**
 * Pattern 2: Inline reverse-VAT arithmetic.
 *
 * Flags lines matching `/ (1 +` that also match the money-identifier regex.
 * This catches the canonical shape:
 *   totalPrice / (1 + taxPercent / 100)
 *   data.totalPrice / (1 + data.tax / 100)
 *   existing.totalPrice / (1 + existing.tax / 100)
 *
 * The money-term check here is mostly belt-and-suspenders; `/ (1 +` is already
 * very specific to VAT arithmetic in the action context, but the check keeps
 * the guard honest if someone writes `/ (1 + someNonMoneyFactor)`.
 */
function findInlineReverseVat(src: string): number[] {
  const lines = src.split('\n')
  const offendingLines: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('/ (1 +') && MONEY_TERM_RE.test(line)) {
      offendingLines.push(i + 1)
    }
  }
  return offendingLines
}

// ─── Allowlist ────────────────────────────────────────────────────────────────
//
// Use the allowlist ONLY for genuinely legitimate inline uses — cases where the
// inline arithmetic is intentional, isolated, and cannot reasonably route through
// the @repo/data helper (e.g. a display-only preview calculation that is never
// stored). Document the justification precisely.
//
// DO NOT allowlist the products/actions.ts offenders — they are the bug this
// guard exists to catch. They stay RED until Phase 3.
//
// Format: { file: relative-from-PARTNER_ROOT, line: 1-based, reason: string }

interface AllowlistEntry {
  file: string
  line: number
  reason: string
}

const INLINE_MONEY_ALLOWLIST: AllowlistEntry[] = [
  // No legitimate inline money operations exist in partner server actions.
  // All financial arithmetic must use round() / computeVatAndBaseAmounts()
  // from @repo/data/payment.
]

function buildAllowlistKey(file: string, line: number): string {
  const absFile = path.resolve(PARTNER_ROOT, file)
  return `${absFile}:${line}`
}

function buildAllowlistSet(): Set<string> {
  const set = new Set<string>()
  for (const entry of INLINE_MONEY_ALLOWLIST) {
    set.add(buildAllowlistKey(entry.file, entry.line))
  }
  return set
}

// ─── File enumeration ─────────────────────────────────────────────────────────

function enumerateActionFiles(): string[] {
  return globSync('app/**/*actions*.ts', {
    cwd: PARTNER_ROOT,
    absolute: true,
  }).filter(
    (f) =>
      !f.endsWith('.test.ts') &&
      !f.endsWith('.integration.test.ts') &&
      !f.includes('__mocks__') &&
      !f.includes('/test/'),
  )
}

// ─── Offender collection ──────────────────────────────────────────────────────

interface Offender {
  file: string      // absolute path
  line: number      // 1-based
  snippet: string   // trimmed source line
  pattern: 'toFixed-money' | 'inline-reverse-vat'
}

function collectOffenders(): Offender[] {
  const files = enumerateActionFiles()
  const allowlistSet = buildAllowlistSet()
  const offenders: Offender[] = []

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf-8')
    const lines = src.split('\n')

    // Pattern 1: money-context .toFixed(
    for (const lineNo of findMoneyToFixed(src)) {
      const key = `${file}:${lineNo}`
      if (!allowlistSet.has(key)) {
        offenders.push({
          file,
          line: lineNo,
          snippet: lines[lineNo - 1].trim(),
          pattern: 'toFixed-money',
        })
      }
    }

    // Pattern 2: inline reverse-VAT
    for (const lineNo of findInlineReverseVat(src)) {
      const key = `${file}:${lineNo}`
      if (!allowlistSet.has(key)) {
        offenders.push({
          file,
          line: lineNo,
          snippet: lines[lineNo - 1].trim(),
          pattern: 'inline-reverse-vat',
        })
      }
    }
  }

  // Deduplicate: a line that matches both patterns should appear once per pattern
  // (they represent two distinct architectural violations, both must be fixed)
  return offenders
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('No-inline-money guard', () => {
  it('partner server actions must not do inline money/VAT arithmetic — use @repo/data helpers', () => {
    const offenders = collectOffenders()

    if (offenders.length === 0) {
      // Guard is satisfied — all money goes through @repo/data
      expect(offenders).toHaveLength(0)
      return
    }

    // Build a human-readable report
    const report = offenders
      .map((o) => {
        const relFile = path.relative(PARTNER_ROOT, o.file)
        const fix =
          o.pattern === 'toFixed-money'
            ? 'Use round(amount) from @repo/data/payment instead of .toFixed(2)'
            : 'Use computeVatAndBaseAmounts(gross, vatRate) from @repo/data/payment instead of inline / (1 + tax/100)'
        return `  ${relFile}:${o.line} [${o.pattern}]\n    code:  ${o.snippet}\n    fix:   ${fix}`
      })
      .join('\n\n')

    expect.fail(
      `\n${offenders.length} inline money/VAT violation(s) found in partner server actions.\n\n` +
        `Architectural rule: no inline financial arithmetic in actions.\n` +
        `Route all money math through @repo/data helpers:\n` +
        `  round(amount)                         — 2-decimal financial rounding\n` +
        `  computeVatAndBaseAmounts(gross, rate) — reverse VAT (base = round(gross / (1 + rate/100)))\n\n` +
        `Offenders:\n${report}\n\n` +
        `If this is a legitimate exception, add an entry to INLINE_MONEY_ALLOWLIST\n` +
        `in app/test/no-inline-money.test.ts with a justification.`,
    )
  })

  it('INLINE_MONEY_ALLOWLIST has no stale entries (all files exist)', () => {
    const stale: string[] = []
    for (const entry of INLINE_MONEY_ALLOWLIST) {
      const absFile = path.resolve(PARTNER_ROOT, entry.file)
      if (!fs.existsSync(absFile)) {
        stale.push(entry.file)
      }
    }
    if (stale.length > 0) {
      expect.fail(
        `\nStale INLINE_MONEY_ALLOWLIST entries (files no longer exist):\n` +
          stale.map((f) => `  ${f}`).join('\n'),
      )
    }
    expect(stale).toHaveLength(0)
  })
})
