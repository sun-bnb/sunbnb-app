import { describe, expect, it } from 'vitest'
import { factSheetFigures, renderFactSheet } from './fact-sheet.ts'
import { KNOWLEDGE } from './knowledge.ts'
import { knowledgeProblems, numbersIn, renderKnowledge, type KnowledgeEntry } from './knowledge-schema.ts'

describe('product knowledge — the agent can only be as right as this', () => {
  it('every entry meets the contract (sources, declared figures, honest status)', () => {
    expect(knowledgeProblems(KNOWLEDGE)).toEqual([])
  })

  it('the contract catches what it is meant to catch', () => {
    const bad: KnowledgeEntry[] = [
      { id: 'a', topic: 'A', status: 'shipped', say: 'Saves 35% of staff time.', sources: ['x'] },
      { id: 'b', topic: 'B', status: 'coming', say: 'It is now available.', sources: ['x'] },
      { id: 'c', topic: 'C', status: 'shipped', say: 'Fine.', sources: [] },
      { id: 'c', topic: 'C2', status: 'shipped', say: 'TODO', sources: ['x'] },
    ]
    const p = knowledgeProblems(bad).join('\n')
    expect(p).toMatch(/a: states 35/)
    expect(p).toMatch(/b: a 'coming' entry/)
    expect(p).toMatch(/c: no source/)
    expect(p).toMatch(/c: duplicate id/)
    expect(p).toMatch(/placeholder/)
  })

  it('every figure the knowledge states joins the eval allow-list', () => {
    const allowed = new Set(factSheetFigures())
    for (const e of KNOWLEDGE) for (const n of numbersIn(e.say)) expect(allowed.has(n), `${e.id}: ${n}`).toBe(true)
  })

  it('reaches both agents through the fact sheet', () => {
    const sheet = renderFactSheet()
    for (const e of KNOWLEDGE) expect(sheet).toContain(e.topic)
  })

  it('Veri*factu is presented as coming before the 2027 deadline, never as live (founder, 2026-10-05)', () => {
    const v = KNOWLEDGE.find((e) => e.id === 'verifactu')!
    expect(v.status).toBe('coming')
    expect(v.say).toMatch(/coming before the 2027 deadline/)
    expect(renderKnowledge([v])).toMatch(/never that it works today/)
  })

  it('claims the code disproves are fenced off (verified 2026-10-05)', () => {
    const never = KNOWLEDGE.flatMap((e) => e.neverClaim ?? []).join(' | ')
    for (const fenced of [/scan the QR/i, /by the hour/i, /Stripe/i, /dynamic pricing/i, /App Store/i]) expect(never).toMatch(fenced)
    // and no entry states them positively
    const said = KNOWLEDGE.map((e) => e.say).join(' ')
    expect(said).not.toMatch(/staff (can )?scan/i)
  })
})
