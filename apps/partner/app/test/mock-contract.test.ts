/**
 * Mock-contract test — Phase 0.1 of the partner test-architecture track.
 *
 * Asserts that each per-app `@repo/data` mock is a SUPERSET of the real
 * module's surface (keys/names only — no behaviour). This test goes RED
 * whenever the real module gains a model or function that the mock hasn't
 * been updated to stub, preventing false-green unit-test suites.
 *
 * Prisma client: model presence checked via `Prisma.dmmf` (connection-free).
 * Submodule functions: real exports parsed from source with a regex (avoids
 * importing DB-dependent code under unit test conditions).
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Prisma } from '@prisma/client'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DATA_SRC = path.resolve(__dirname, '../../../../packages/data/src')
const MOCKS_DIR = path.resolve(__dirname, '../../__mocks__/@repo/data')
const PARTNER_ROOT = path.resolve(__dirname, '../..')

/**
 * Parse exported function names from a real TypeScript source file.
 * Captures: `export function`, `export async function`, and
 * `export const <name> = <function-like>` where the rhs is an arrow/plain
 * function. Does NOT capture types, interfaces, or non-callable consts
 * (objects, strings, etc.) — the check is focused on callable exports.
 */
function parseExportedFunctions(filePath: string): Set<string> {
  const src = fs.readFileSync(filePath, 'utf-8')
  const names = new Set<string>()
  // export (async) function name
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    names.add(m[1])
  }
  // export const name = (...) =>  or  = async (...) =>  or  = function
  for (const m of src.matchAll(/^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/gm)) {
    names.add(m[1])
  }
  return names
}

/**
 * Parse exported callable names from a mock file.
 * Mocks use `export const name = vi.fn(...)` which is not a bare arrow/plain
 * function — we widen the pattern to any `export const name = ...` here
 * (the mock file only exports stubs so there are no non-callable consts to
 * exclude). Real files stay narrow to avoid capturing exported objects/consts.
 * Mock files may export MORE than the real module — superset is fine.
 */
function parseMockExports(filePath: string): Set<string> {
  const src = fs.readFileSync(filePath, 'utf-8')
  const names = new Set<string>()
  // export (async) function name
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    names.add(m[1])
  }
  // export const name = <anything>  (covers vi.fn(), arrow functions, etc.)
  for (const m of src.matchAll(/^export\s+const\s+(\w+)\s*=/gm)) {
    names.add(m[1])
  }
  return names
}

// ─── Prisma client model contract ────────────────────────────────────────────

describe('PrismaCient mock — model superset', () => {
  /**
   * The real Prisma delegate key for a model is its name with the first letter
   * lowercased (PascalCase → camelCase). `spatial_ref_sys` is a PostGIS system
   * table exposed by the generated client but never queried via the Prisma
   * delegate in the partner app (raw SQL only) — it is excluded from the
   * contract so the check stays focused on business models.
   */
  const EXCLUDED_MODELS = new Set(['spatial_ref_sys'])

  const realModels = Prisma.dmmf.datamodel.models
    .map((m) => {
      const name = m.name
      // PascalCase → camelCase delegate key
      return name[0].toLowerCase() + name.slice(1)
    })
    .filter((key) => !EXCLUDED_MODELS.has(key))

  // Import the mock via its real path (the vitest alias redirects
  // `@repo/data/PrismaCient` here at test time, but we need the object to
  // inspect its keys — import it directly to be alias-independent).
  const mockPath = path.join(MOCKS_DIR, 'PrismaCient.ts')
  // We can't `require` TS in Node directly; instead parse the source for
  // top-level keys of the `prisma` object literal.
  const mockSrc = fs.readFileSync(mockPath, 'utf-8')

  /**
   * Extract keys from the top-level `const prisma = { ... }` object.
   * Keys appear as `  <key>: {` at the start of a line (2-space indent).
   * We also capture `$executeRaw`, `$transaction`, etc. but the contract
   * only checks model-delegate keys (no `$` prefix).
   */
  function parsePrismaObjectKeys(src: string): Set<string> {
    const keys = new Set<string>()
    for (const m of src.matchAll(/^  (\w+):\s*\{/gm)) {
      if (!m[1].startsWith('$')) {
        keys.add(m[1])
      }
    }
    return keys
  }

  const mockKeys = parsePrismaObjectKeys(mockSrc)

  it('stubs every real Prisma model delegate', () => {
    const missing = realModels.filter((key) => !mockKeys.has(key))
    expect(missing, `PrismaCient mock is missing delegates: ${missing.join(', ')}`).toEqual([])
  })

  // Prove the assertion is load-bearing: securityToken is present because we
  // added it. This named sub-test documents what the gap was.
  it('includes securityToken (the motivating gap for this contract test)', () => {
    expect(mockKeys.has('securityToken')).toBe(true)
  })
})

// ─── Submodule function-export contracts ─────────────────────────────────────

/**
 * For each aliased `@repo/data/<submodule>`, verify that the partner mock
 * exports at least every function the real source exports.
 *
 * The "real" surface is sourced by parsing the TypeScript source file directly
 * rather than importing it — this keeps the contract test free of Prisma
 * client instantiation and other DB-side effects that would require additional
 * mocking in a unit-test environment.
 */

interface SubmoduleSpec {
  /** @repo/data export path (without the package prefix) */
  name: string
  /** Filename in packages/data/src/ */
  realFile: string
  /** Filename in apps/partner/__mocks__/@repo/data/ */
  mockFile: string
}

const SUBMODULE_SPECS: SubmoduleSpec[] = [
  {
    name: 'subscription',
    realFile: 'subscription.ts',
    mockFile: 'subscription.ts',
  },
  {
    name: 'password-reset',
    realFile: 'password-reset.ts',
    mockFile: 'password-reset.ts',
  },
  {
    name: 'rate-limit',
    realFile: 'rate-limit.ts',
    mockFile: 'rate-limit.ts',
  },
  {
    name: 'reservation-emails',
    realFile: 'reservation-emails.ts',
    mockFile: 'reservation-emails.ts',
  },
  {
    name: 'seat-label',
    realFile: 'seat-label.ts',
    mockFile: 'seat-label.ts',
  },
  {
    name: 'seat-label-db',
    realFile: 'seat-label-db.ts',
    mockFile: 'seat-label-db.ts',
  },
  {
    name: 'reservations',
    realFile: 'reservations.ts',
    mockFile: 'reservations.ts',
  },
  {
    name: 'refund',
    realFile: 'refund.ts',
    mockFile: 'refund.ts',
  },
  {
    name: 'reservation-payment',
    realFile: 'reservation-payment.ts',
    mockFile: 'reservation-payment.ts',
  },
]

describe.each(SUBMODULE_SPECS)('$name mock — function superset', ({ name, realFile, mockFile }) => {
  it(`stubs every exported function from @repo/data/${name}`, () => {
    const realFns = parseExportedFunctions(path.join(DATA_SRC, realFile))
    const mockFns = parseMockExports(path.join(MOCKS_DIR, mockFile))

    const missing = [...realFns].filter((fn) => !mockFns.has(fn))
    expect(
      missing,
      `${mockFile} mock is missing exported functions: ${missing.join(', ')} ` +
        `(from @repo/data/src/${realFile})`,
    ).toEqual([])
  })
})
