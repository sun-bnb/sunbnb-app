import { describe, it, expect } from 'vitest'
import { parseMarkdownLite, parseInline } from './markdown-lite'
import { buildContextPayload, MAX_CONTEXT_ITEM_IDS, starterKeys } from './context-payload'

describe('parseMarkdownLite', () => {
  it('splits paragraphs, groups list items, separates ul from ol', () => {
    const blocks = parseMarkdownLite('Intro\n\n- a\n- b\n1. one\n2. two\n\nEnd')
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ul', 'ol', 'p'])
    expect(blocks[1]).toMatchObject({ items: [[{ text: 'a' }], [{ text: 'b' }]] })
  })

  it('parses bold and inline code, leaving unmatched markers literal', () => {
    expect(parseInline('a **b** `c` **open')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'c' },
      { kind: 'text', text: ' **open' },
    ])
  })

  it('never produces markup: html stays a plain text node', () => {
    const [p] = parseMarkdownLite('<img src=x onerror=alert(1)> **ok**')
    expect(p).toMatchObject({ kind: 'p' })
    if (p.kind === 'p') expect(p.inline[0]).toEqual({ kind: 'text', text: '<img src=x onerror=alert(1)> ' })
  })
})

describe('buildContextPayload', () => {
  it('omits empty selection and caps item ids', () => {
    expect(buildContextPayload({ tab: 'inventory', layoutMode: 'geo', selection: { itemIds: [] } })).toEqual({ tab: 'inventory', layoutMode: 'geo' })
    const ids = Array.from({ length: 500 }, (_, i) => `i${i}`)
    expect(buildContextPayload({ selection: { itemIds: ids, parcel: 3 } }).selection?.itemIds).toHaveLength(MAX_CONTEXT_ITEM_IDS)
  })

  it('keeps parcel 0-safe and element id', () => {
    expect(buildContextPayload({ selection: { parcel: 3, elementId: 'e1' } }).selection).toEqual({ parcel: 3, elementId: 'e1' })
  })
})

describe('starterKeys', () => {
  it('is tailored per tab and falls back to defaults', () => {
    expect(starterKeys('inventory')[0]).toBe('inventory1')
    expect(starterKeys('accounting')[0]).toBe('default1')
  })
})
