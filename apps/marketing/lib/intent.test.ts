import { describe, expect, it } from 'vitest'
import { isAffirmative, looksLikeQuestion, parseBareCount, parseIntent, parsePrice } from './intent.ts'
import { MAX_SUNBEDS } from './places.ts'

describe('parseIntent', () => {
  it('a plain beach name is just a query', () => {
    expect(parseIntent('Platja de Muro')).toEqual({ query: 'Platja de Muro', count: null, runs: [] })
  })

  it('reads the founder example', () => {
    expect(parseIntent('Platja de Muro, 80 beds and a bar')).toEqual({ query: 'Platja de Muro', count: 80, runs: ['fnb'] })
  })

  it('reads counts in all three languages', () => {
    expect(parseIntent('Playa de Palma 120 hamacas').count).toBe(120)
    expect(parseIntent('Hietaniemi 40 aurinkotuolia').count).toBe(40)
    expect(parseIntent('Nissi beach, 200 sunbeds').count).toBe(200)
    expect(parseIntent('Nissi beach, 200 sun loungers').count).toBe(200)
  })

  it('never takes an address number as a count', () => {
    const i = parseIntent('Carrer del Mar 5, Alcúdia')
    expect(i.count).toBeNull()
    expect(i.query).toBe('Carrer del Mar 5, Alcúdia')
  })

  it('caps the count and ignores zero', () => {
    expect(parseIntent('Muro 99999 beds').count).toBe(MAX_SUNBEDS)
    expect(parseIntent('Muro 0 beds').count).toBeNull()
  })

  it('picks up what else they run and strips it from the query', () => {
    expect(parseIntent('Playa Alonso con chiringuito y alquiler de kayaks, 60 hamacas')).toEqual({
      query: 'Playa Alonso',
      count: 60,
      runs: ['fnb', 'rentals'],
    })
    expect(parseIntent('Cala Millor, 50 beds, a restaurant and paddle boards').runs.sort()).toEqual(['rentals', 'tables'])
  })

  it('does not fire on words that merely contain a keyword', () => {
    // "Barceloneta" contains "bar", "Supetar" contains "sup"
    expect(parseIntent('Barceloneta').runs).toEqual([])
    expect(parseIntent('Supetar beach').runs).toEqual([])
  })
})

describe('routing typed text between the page and the agent', () => {
  it('questions go to the agent, places go to the search', () => {
    for (const q of ['do you work with beach bars?', 'How much does it cost', '¿Cuánto cuesta?', 'Paljonko maksaa', 'can guests pay cash']) expect(looksLikeQuestion(q), q).toBe(true)
    for (const p of ['Platja de Muro', "Where's Playa Alonso", 'Cala Millor, 80 beds', 'Hietaniemi']) expect(looksLikeQuestion(p), p).toBe(false)
  })
  it('reads a bare count only when it is just a count', () => {
    expect(parseBareCount('80')).toBe(80)
    expect(parseBareCount('about 120')).toBe(120)
    expect(parseBareCount('80 hamacas')).toBe(80)
    expect(parseBareCount('we have 80 and a bar')).toBeNull()
    expect(parseBareCount('0')).toBeNull()
  })
  it('reads a price in the shapes people type it', () => {
    for (const [t, n] of [['25', 25], ['€25', 25], ['25 €', 25], ['25 euros', 25], ['25,50', 25]] as const) expect(parsePrice(t), t).toBe(n)
    for (const t of ['0', '501', 'twenty', '25 per bed per day']) expect(parsePrice(t), t).toBeNull()
  })
  it('knows a go-ahead in three languages, and nothing longer', () => {
    for (const t of ['yes', 'Build it!', 'sí', 'vale', 'kyllä', 'ok']) expect(isAffirmative(t), t).toBe(true)
    for (const t of ['yes but how much', 'no']) expect(isAffirmative(t), t).toBe(false)
  })
})
