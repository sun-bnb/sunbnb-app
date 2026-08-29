/**
 * Safety-invariant test (track 024 P6.5): every action exposed through the
 * RPC allowlist must have a `manage.<name>` counterpart registered in the
 * gated-action registry (`app/test/gated-actions.ts`), so the auth-rejection
 * matrix's coverage transfers to this HTTP surface automatically.
 *
 * Parses both files as TEXT (regex) rather than importing them — importing
 * `registry.ts` pulls in the full `manage/actions.ts` module graph (prisma,
 * till, payment, reservation-machine…), which is unnecessary weight for a
 * pure name-set comparison and would require duplicating auth-matrix.test.ts's
 * mock setup here. Same technique as `app/test/mock-contract.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const REGISTRY_PATH = path.resolve(__dirname, 'registry.ts')
const GATED_ACTIONS_PATH = path.resolve(__dirname, '../../../test/gated-actions.ts')

/** Parses the plain-name keys of the `RPC_ACTIONS` object literal. */
function parseRpcActionNames(): string[] {
  const src = fs.readFileSync(REGISTRY_PATH, 'utf-8')
  const body = src.match(/export const RPC_ACTIONS[^{]*\{([\s\S]*)\n\}/)
  if (!body) throw new Error('Could not locate RPC_ACTIONS object literal in registry.ts')
  const names: string[] = []
  // Bare identifier keys (shorthand `{ reserveItem, ... }`) — one per line,
  // ignoring comment lines.
  for (const line of body[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) continue
    const m = trimmed.match(/^(\w+),?$/)
    if (m) names.push(m[1])
  }
  return names
}

/** Parses every `name: '<domain>.<action>'` string from GATED_ACTIONS. */
function parseGatedActionNames(): Set<string> {
  const src = fs.readFileSync(GATED_ACTIONS_PATH, 'utf-8')
  const names = new Set<string>()
  for (const m of src.matchAll(/name:\s*'([\w.-]+)'/g)) {
    names.add(m[1])
  }
  return names
}

describe('RPC allowlist ⊆ gated-action registry', () => {
  it('parses a non-trivial number of names from both files (sanity check)', () => {
    expect(parseRpcActionNames().length).toBeGreaterThan(30)
    expect(parseGatedActionNames().size).toBeGreaterThan(30)
  })

  it('every RPC_ACTIONS entry has a manage.<name> counterpart in GATED_ACTIONS', () => {
    const rpcNames = parseRpcActionNames()
    const gatedNames = parseGatedActionNames()

    const missing = rpcNames.filter((name) => !gatedNames.has(`manage.${name}`))

    expect(missing).toEqual([])
  })

  it('has no duplicate keys in the RPC allowlist', () => {
    const rpcNames = parseRpcActionNames()
    expect(new Set(rpcNames).size).toBe(rpcNames.length)
  })
})
