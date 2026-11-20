/**
 * Locale hygiene for messages/{en,es,fi}.json (CR-004; first version CR-002):
 * identical dotted key sets, no duplicate keys inside one JSON object
 * (JSON.parse silently keeps the last one), no empty values.
 * Same file in apps/user/app/test/i18n-parity.test.ts; keep them in sync.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const LOCALES = ['en', 'es', 'fi'] as const
const dir = path.resolve(__dirname, '../../messages')
const raw = Object.fromEntries(LOCALES.map((l) => [l, readFileSync(path.join(dir, `${l}.json`), 'utf8')]))
const parsed = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(raw[l])]))

function flatten(o: unknown, prefix = ''): Record<string, unknown> {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    return Object.assign({}, ...Object.entries(o).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)))
  }
  return { [prefix]: o }
}

/** Dotted paths of keys repeated within the same object (repeats across namespaces are fine). */
function duplicateKeys(text: string): string[] {
  const dups: string[] = []
  const stack: { keys: Set<string>; path: string }[] = []
  let pendingKey: string | null = null
  const re = /"(?:[^"\\]|\\.)*"|[{}[\],:]/g
  let m: RegExpExecArray | null
  let last = ''
  while ((m = re.exec(text))) {
    const tok = m[0]
    if (tok === '{') {
      const parent = stack[stack.length - 1]
      const p = parent && pendingKey !== null ? (parent.path ? `${parent.path}.${pendingKey}` : pendingKey) : ''
      stack.push({ keys: new Set(), path: p })
      pendingKey = null
    } else if (tok === '}') {
      stack.pop()
    } else if (tok === ':') {
      // the previous string token was a key
      const top = stack[stack.length - 1]
      const key = JSON.parse(last) as string
      if (top) {
        if (top.keys.has(key)) dups.push(top.path ? `${top.path}.${key}` : key)
        top.keys.add(key)
      }
      pendingKey = key
    }
    last = tok
  }
  return dups
}

describe('i18n message files', () => {
  const flat = Object.fromEntries(LOCALES.map((l) => [l, flatten(parsed[l])]))
  const enKeys = Object.keys(flat.en)

  it.each(['es', 'fi'] as const)('%s has exactly the en keys', (l) => {
    const other = new Set(Object.keys(flat[l]))
    const base = new Set(enKeys)
    expect({
      [`missing in ${l}`]: enKeys.filter((k) => !other.has(k)),
      [`extra in ${l}`]: [...other].filter((k) => !base.has(k)),
    }).toEqual({ [`missing in ${l}`]: [], [`extra in ${l}`]: [] })
  })

  it.each(LOCALES)('%s has no duplicate keys within an object', (l) => {
    expect(duplicateKeys(raw[l])).toEqual([])
  })

  it.each(LOCALES)('%s has no empty values', (l) => {
    expect(Object.entries(flat[l]).filter(([, v]) => v === '').map(([k]) => k)).toEqual([])
  })

  it('duplicate scan catches same-object repeats only', () => {
    expect(duplicateKeys('{"A":{"x":"1","x":"2"},"B":{"x":"3"}}')).toEqual(['A.x'])
  })
})
