import { describe, expect, it } from 'vitest'
import { googleConsent } from './consent.ts'
import { newScrollMarks, planEvent, type TagConfig } from './tracking-plan.ts'

const ALL: TagConfig = { googleAdsId: 'AW-1', ga4Id: 'G-1', adsLabels: { mockup: 'mk', lead: 'ld', signup: 'su' } }
const NONE: TagConfig = { adsLabels: {} }

describe('tracking plan', () => {
  it('a demo request is ONE Meta Lead and ONE Google Ads conversion, both with the id server-side conversions de-duplicate on', () => {
    const p = planEvent('demo_requested', { via: 'form' }, { token: 'tok123', variant: 'b' }, ALL)
    expect(p.fbq).toEqual([['track', 'Lead', {}, { eventID: 'tok123:demo_requested' }]])
    expect(p.gtag).toContainEqual(['event', 'conversion', { send_to: 'AW-1/ld', transaction_id: 'tok123:demo_requested' }])
    // Never also a custom event: Meta would count the lead twice.
    expect(p.fbq.some((c) => c[0] === 'trackCustom')).toBe(false)
  })

  it('every funnel event reaches GA4 (addressed to the GA4 id only), Meta as a custom event, and PostHog', () => {
    const p = planEvent('beds_placed', { count: 80 }, { angle: 'noshow' }, ALL)
    expect(p.gtag).toEqual([['event', 'beds_placed', { count: 80, angle: 'noshow', send_to: 'G-1' }]])
    expect(p.fbq).toEqual([['trackCustom', 'beds_placed', { count: 80 }]])
    expect(p.posthog).toEqual({ event: 'beds_placed', properties: { count: 80, angle: 'noshow' } })
    expect(p.beacon).toBe(true)
  })

  it('the mockup token (a capability link) goes to our own PostHog only — never to Google or Meta', () => {
    const p = planEvent('price_set', undefined, { token: 'secret-token', variant: 'a' }, ALL)
    expect(JSON.stringify([p.fbq, p.gtag])).not.toContain('secret-token')
    expect(p.posthog.properties.token).toBe('secret-token')
  })

  it('without IDs nothing is addressed to Google; a conversion with no Ads label is not sent to Ads', () => {
    expect(planEvent('demo_requested', undefined, {}, NONE).gtag).toEqual([])
    const noLabel = planEvent('mockup_created', undefined, {}, { googleAdsId: 'AW-1', adsLabels: {} })
    expect(noLabel.gtag).toEqual([])
  })

  it('web vitals are measurements: GA4 + PostHog, never the first-party funnel or Meta', () => {
    const p = planEvent('web_vital', { metric: 'LCP', value: 2100 }, {}, ALL)
    expect(p.beacon).toBe(false)
    expect(p.fbq).toEqual([])
    expect(p.gtag).toEqual([['event', 'web_vital', { metric: 'LCP', value: 2100, send_to: 'G-1' }]])
  })

  it('an event the server already recorded skips the beacon but still reaches the tags', () => {
    const p = planEvent('mockup_created', undefined, { token: 't' }, ALL, { beacon: false })
    expect(p.beacon).toBe(false)
    expect(p.fbq[0]?.[1]).toBe('ViewContent')
  })
})

describe('scroll depth', () => {
  it('reports each mark once, in order, including the end of the page', () => {
    const sent = new Set<number>()
    const a = newScrollMarks(0.6, sent)
    expect(a).toEqual([25, 50])
    a.forEach((m) => sent.add(m))
    expect(newScrollMarks(0.55, sent)).toEqual([])
    expect(newScrollMarks(0.995, sent)).toEqual([75, 100])
  })
})

describe('Google consent mode', () => {
  it('accept grants all four v2 signals; withdrawal denies all four', () => {
    expect(Object.values(googleConsent(true))).toEqual(['granted', 'granted', 'granted', 'granted'])
    expect(googleConsent(false)).toEqual({ ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
  })
})
