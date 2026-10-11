import { MAX_INSPECT_BYTES } from './types'

const size = (v: unknown): number => JSON.stringify(v).length

/**
 * Keep a provider's output under `max` serialized characters. Providers are compact by design; this
 * is the backstop (a site with an unusual amount of data): it repeatedly halves the longest array
 * and finally clips long strings, and records what it did in `_truncated` so the model never
 * mistakes a clipped list for the whole.
 */
export function fitToBudget<T>(value: T, max = MAX_INSPECT_BYTES): T | (T & { _truncated: string[] }) {
  if (size(value) <= max) return value
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  const notes: string[] = []
  const withNotes = () => (notes.length ? { ...copy, _truncated: notes } : copy)

  for (let guard = 0; guard < 200 && size(withNotes()) > max; guard++) {
    const longest = longestArray(copy, '')
    if (!longest || longest.arr.length <= 1) break
    const keep = Math.max(1, Math.floor(longest.arr.length / 2))
    notes.push(`${longest.path || 'root'}: showing ${keep} of ${longest.arr.length}`)
    longest.arr.length = keep
  }
  if (size(withNotes()) > max) {
    clipStrings(copy, 200)
    notes.push('long text clipped')
  }
  return withNotes() as T & { _truncated: string[] }
}

function longestArray(node: unknown, path: string): { arr: unknown[]; path: string } | null {
  let best: { arr: unknown[]; path: string } | null = null
  const visit = (n: unknown, p: string) => {
    if (Array.isArray(n)) {
      if (!best || n.length > best.arr.length) best = { arr: n, path: p }
      n.forEach((x, i) => visit(x, `${p}[${i}]`))
    } else if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) visit(v, p ? `${p}.${k}` : k)
    }
  }
  visit(node, path)
  return best
}

function clipStrings(node: unknown, maxLen: number): void {
  if (Array.isArray(node)) {
    node.forEach((x, i) => {
      if (typeof x === 'string' && x.length > maxLen) node[i] = `${x.slice(0, maxLen)}...`
      else clipStrings(x, maxLen)
    })
  } else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && v.length > maxLen) o[k] = `${v.slice(0, maxLen)}...`
      else clipStrings(v, maxLen)
    }
  }
}
