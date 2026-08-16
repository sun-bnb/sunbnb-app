/**
 * Track 021 P1 ratchet: nothing may write the legacy `pairId` again.
 *
 * `SunbedGroup` is the single representation of pairing. The column still
 * exists (it drops a release later, per expand/contract), so a well-meaning
 * change could quietly reintroduce the dual-write and resurrect the second
 * source of truth this track exists to remove — with no test failing, because
 * every reader is group-first.
 *
 * Same shape as the reservation-machine single-writer ratchet: a source scan
 * with an exact-equality, SHRINK-ONLY allowlist.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const APP_ROOT = path.resolve(__dirname, '../..')

/**
 * The ONLY sanctioned `pairId` writes: defensive cleanup that must survive
 * until the column is dropped. Old rows still carry values and the self-FK
 * still blocks deletes, so seat deletion must keep clearing references.
 */
const ALLOWED = new Set([
  'app/sites/[id]/inventory-actions.ts', // clear-on-delete sweeps + depair cleanup
])

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

describe('no new pairId writes (track 021 P1 ratchet)', () => {
  it('only the sanctioned cleanup file writes pairId', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(path.join(APP_ROOT, 'app'))) {
      const rel = path.relative(APP_ROOT, file)
      if (ALLOWED.has(rel)) continue
      const src = readFileSync(file, 'utf8')
      // The rule is "never point pairId AT ANOTHER SEAT". `pairId: null` on a
      // freshly created row is the absence of pairing, not a second source of
      // truth, so it is allowed everywhere; anything else is a resurrection.
      // A relation connect writes pair_id just as surely as the scalar does —
      // `pair: { connect: { id } }` was a real miss on the first pass of this
      // ratchet, found only by reading the write path by hand.
      const relationWrites = [...src.matchAll(/\b(pair|pairedBy)\s*:\s*\{\s*connect/g)]
      if (relationWrites.length > 0) {
        offenders.push(`${rel} (relation connect: ${relationWrites.map((m) => m[1]).join(', ')})`)
        continue
      }
      const writes = [...src.matchAll(/\bpairId\s*:\s*([^,\n}]+)/g)]
        .map((m) => m[1]!.trim())
        .filter((value) => value !== 'null' && !value.startsWith('true') && !value.startsWith('string'))
      if (writes.length > 0) offenders.push(`${rel} (${writes.join(' | ')})`)
    }
    expect(offenders, `pairId written outside the allowlist: ${offenders.join(', ')}`).toEqual([])
  })

  it('the allowlist only shrinks — every entry still exists and still writes pairId', () => {
    for (const rel of ALLOWED) {
      const src = readFileSync(path.join(APP_ROOT, rel), 'utf8')
      expect(src, `${rel} no longer writes pairId — remove it from ALLOWED`).toMatch(/pairId/)
    }
  })
})
