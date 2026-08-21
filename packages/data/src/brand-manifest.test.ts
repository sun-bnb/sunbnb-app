/**
 * Brand render resolution (track 023).
 *
 * One function answers "what does a guest see" for three different apps, so the
 * cases that matter are the half-configured ones. Every one of them must land on
 * the standard page: a bespoke page that is missing, misconfigured or switched
 * off should cost the customer their design, never their bookings.
 */

import { describe, it, expect } from 'vitest'

import { resolveBrandRender, isKnownBrandKey, BRAND_KEYS } from './brand-manifest'

const KNOWN = BRAND_KEYS[0]

describe('resolveBrandRender', () => {
  it('serves the bespoke page when a real module is assigned AND the switch is on', () => {
    expect(resolveBrandRender({ customBrandEnabled: true, customBrandKey: KNOWN })).toEqual({
      mode: 'custom',
      key: KNOWN,
      reason: 'live',
    })
  })

  it('holds a merged module dark while the switch is off', () => {
    // The staging case: the page is written and reviewed, the customer has not
    // approved it yet. It keeps its key so enabling is one click, not a redeploy.
    expect(resolveBrandRender({ customBrandEnabled: false, customBrandKey: KNOWN })).toEqual({
      mode: 'standard',
      key: KNOWN,
      reason: 'disabled',
    })
  })

  it('distinguishes "switched on, nothing assigned" from "switched off"', () => {
    // Both render the standard page, and an operator needs to tell them apart:
    // one is waiting for code, the other is a deliberate default.
    expect(resolveBrandRender({ customBrandEnabled: true, customBrandKey: null }).reason).toBe('no-key')
    expect(resolveBrandRender({ customBrandEnabled: false, customBrandKey: null }).reason).toBe('disabled')
  })

  it('falls back when the assigned key answers to no module', () => {
    // A typo in admin, or a module deleted while a site still points at it.
    // Falling back beats 500-ing on a public storefront.
    const result = resolveBrandRender({ customBrandEnabled: true, customBrandKey: 'not-a-brand' })

    expect(result.mode).toBe('standard')
    expect(result.reason).toBe('unknown-key')
    expect(result.key).toBeNull()
  })

  it('treats a blank or whitespace key as no key at all', () => {
    // An admin text field that has been cleared leaves '' rather than null.
    expect(resolveBrandRender({ customBrandEnabled: true, customBrandKey: '' }).reason).toBe('no-key')
    expect(resolveBrandRender({ customBrandEnabled: true, customBrandKey: '   ' }).reason).toBe('no-key')
  })

  it('never returns custom without a key', () => {
    // The property the routes rely on: mode 'custom' always carries the key they
    // are about to import, so a caller can never be handed a mode it cannot act on.
    const inputs = [
      { customBrandEnabled: true, customBrandKey: KNOWN },
      { customBrandEnabled: true, customBrandKey: 'nope' },
      { customBrandEnabled: false, customBrandKey: KNOWN },
      { customBrandEnabled: true, customBrandKey: null },
      { customBrandEnabled: null, customBrandKey: undefined },
      {},
    ]

    for (const input of inputs) {
      const result = resolveBrandRender(input)
      if (result.mode === 'custom') expect(result.key).not.toBeNull()
    }
  })
})

describe('isKnownBrandKey', () => {
  it('accepts every key in the manifest', () => {
    for (const key of BRAND_KEYS) expect(isKnownBrandKey(key)).toBe(true)
  })

  it('rejects absent and unknown keys', () => {
    for (const key of [null, undefined, '', 'unknown-brand']) {
      expect(isKnownBrandKey(key)).toBe(false)
    }
  })
})
