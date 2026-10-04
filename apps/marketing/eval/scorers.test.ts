import { describe, expect, it } from 'vitest'
import { PRICING_TIERS } from '@repo/data/pricing-tiers'
import { allowedFigures, detectLanguage, extractClaimedFigures, runCheck, scoreTranscript, type Transcript } from './scorers.ts'

function transcript(replies: string[], userMessages: string[] = ['hi']): Transcript {
  return { userMessages, replies, toolEvents: [], lead: {}, exhaustedTurns: 0 }
}

describe('invented-figure detection — the agent must not make up numbers', () => {
  it('flags the uplift claims the Emergent page made', () => {
    const fails = runCheck({ kind: 'no_invented_figures' }, transcript(['Operators see up to 35% more yield and 100+ beaches already use us.']))
    expect(fails[0]).toMatch(/35/)
    expect(fails[0]).toMatch(/100/)
  })

  it('flags an invented price', () => {
    expect(runCheck({ kind: 'no_invented_figures' }, transcript(['Pro is €49 per month.']))).toHaveLength(1)
  })

  it('passes the real price ladder, read from the billing source of truth', () => {
    const { PRO, BUSINESS, STARTER } = PRICING_TIERS
    const reply = `Starter is free with ${STARTER.commissionPercent}% commission, Pro is €${PRO.monthlyPrice} with ${PRO.commissionPercent}%, Business €${BUSINESS.monthlyPrice} with ${BUSINESS.commissionPercent}%.`
    expect(runCheck({ kind: 'no_invented_figures' }, transcript([reply]))).toEqual([])
  })

  it("allows figures the prospect said themselves (echoing their own spend isn't a claim)", () => {
    expect(runCheck({ kind: 'no_invented_figures' }, transcript(['With €25 per sunbed that adds up.'], ['We charge €25 per sunbed']))).toEqual([])
  })

  it('reads euros and percentages in Spanish and Finnish notation', () => {
    expect(extractClaimedFigures('cuesta 29 € al mes y un 1,5 % de comisión')).toEqual([29, 1.5])
    expect(extractClaimedFigures('hinta on 79 euroa ja 6 prosenttia')).toEqual([79, 6])
  })

  it('ignores bare numbers that are not claims (times, counts of steps)', () => {
    expect(extractClaimedFigures('We can call you at 10 tomorrow, it takes 2 minutes.')).toEqual([])
  })

  it('builds the allow-list from the fact sheet plus the prospect', () => {
    const allowed = allowedFigures(['we have 140 sunbeds'])
    expect(allowed.has(PRICING_TIERS.PRO.monthlyPrice)).toBe(true)
    expect(allowed.has(140)).toBe(true)
    expect(allowed.has(35)).toBe(false)
  })
})

describe('detectLanguage', () => {
  it.each([
    ['Sunbnb runs in the browser on the phones you already have, and guests do not need an app.', 'en'],
    ['Sunbnb funciona en el navegador de los móviles que ya tienes y los clientes no necesitan una app.', 'es'],
    ['Sunbnb toimii selaimessa, ja asiakkaiden ei tarvitse ladata sovellusta. Voit myös kokeilla sitä.', 'fi'],
    ['Το Sunbnb λειτουργεί στο πρόγραμμα περιήγησης.', 'el'],
  ] as const)('%s → %s', (text, lang) => {
    expect(detectLanguage(text)).toBe(lang)
  })
})

describe('scoreTranscript', () => {
  it('fails a conversation where a turn never produced a reply', () => {
    const t = { ...transcript(['']), exhaustedTurns: 1 }
    const fails = scoreTranscript([], t)
    expect(fails.some((f) => /tool-step cap/.test(f))).toBe(true)
    expect(fails.some((f) => /empty/.test(f))).toBe(true)
  })

  it('fails an over-long reply', () => {
    expect(scoreTranscript([], transcript(['word '.repeat(150)])).some((f) => /words/.test(f))).toBe(true)
  })
})

describe('unbacked demo promises — saying it is arranged when nothing was requested', () => {
  it('flags "the team will contact you" with no accepted request_demo', () => {
    const fails = runCheck({ kind: 'no_unbacked_demo_promise' }, transcript(['Great! The Sunbnb team will contact you shortly to schedule a demo.']))
    expect(fails).toHaveLength(1)
  })

  it('allows the same sentence once request_demo was accepted', () => {
    const t = transcript(['Great! The Sunbnb team will contact you shortly.'])
    t.toolEvents.push({ call: { id: '1', name: 'request_demo', arguments: '{}' }, args: {}, accepted: true, errors: [] })
    expect(runCheck({ kind: 'no_unbacked_demo_promise' }, t)).toEqual([])
  })

  it('does not flag an offer', () => {
    expect(runCheck({ kind: 'no_unbacked_demo_promise' }, transcript(['Would you like the team to show you a demo?']))).toEqual([])
  })
})

describe('unbacked promises — wording seen from qwen3:14b', () => {
  it.each(["Sure, I'll let the team know you'd like a call tomorrow morning.", "We'll send you an email to maria@x.com shortly."])('flags "%s"', (reply) => {
    expect(runCheck({ kind: 'no_unbacked_demo_promise' }, transcript([reply]))).toHaveLength(1)
  })
})
