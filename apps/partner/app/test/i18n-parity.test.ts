/** en / es / fi message files must have identical key sets (no missing translations). */
import { describe, it, expect } from 'vitest'
import en from '../../messages/en.json'
import es from '../../messages/es.json'
import fi from '../../messages/fi.json'

function keys(o: unknown, prefix = ''): string[] {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    return Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

describe('i18n key parity', () => {
  const base = keys(en).sort()
  it.each([['es', es], ['fi', fi]] as const)('%s has exactly the en keys', (_l, m) => {
    const other = keys(m).sort()
    expect(base.filter((k) => !other.includes(k))).toEqual([])
    expect(other.filter((k) => !base.includes(k))).toEqual([])
  })
})
