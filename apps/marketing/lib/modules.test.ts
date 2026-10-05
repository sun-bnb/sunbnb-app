import { describe, expect, it } from 'vitest'
import { KNOWLEDGE } from './agent/knowledge.ts'
import { isSpanishAddress, planModules, type Module } from './modules.ts'

describe('planModules — the demo follows what they run', () => {
  it('just sunbeds → the day close only', () => {
    expect(planModules({ runs: [], spain: false })).toEqual(['dayclose'])
  })
  it('unanswered → food & drink (the commonest extra) + the day close', () => {
    expect(planModules({ runs: null, spain: false })).toEqual(['order', 'dayclose'])
  })
  it('each answer adds its own module, in a fixed order', () => {
    expect(planModules({ runs: ['tables', 'rentals', 'fnb'], spain: false })).toEqual(['order', 'rental', 'tables', 'dayclose'])
  })
  it('Spanish beaches end on Veri*factu', () => {
    expect(planModules({ runs: ['rentals'], spain: true })).toEqual(['rental', 'dayclose', 'verifactu'])
  })
  it('every module maps to a knowledge entry; only Veri*factu is "coming"', () => {
    const entry: Record<Module, string> = { order: 'food-drink', rental: 'rentals', tables: 'tables', dayclose: 'invoicing', verifactu: 'verifactu' }
    for (const [m, id] of Object.entries(entry)) {
      const k = KNOWLEDGE.find((e) => e.id === id)
      expect(k, m).toBeDefined()
      expect(k!.status, m).toBe(m === 'verifactu' ? 'coming' : 'shipped')
    }
  })
})

describe('isSpanishAddress', () => {
  it('reads Spain in every page language', () => {
    for (const a of ['07458 Muro, Illes Balears, Spain', 'Muro, Islas Baleares, España', 'Muro, Espanja', 'Platja, Girona, Espanya']) expect(isSpanishAddress(a), a).toBe(true)
    for (const a of ['Copacabana, Rio de Janeiro, Brazil', 'Hietaniemi, Helsinki, Finland', 'Spainville Rd, USA']) expect(isSpanishAddress(a), a).toBe(false)
  })
})
