import { describe, it, expect } from 'vitest'
import { reconcileField, reconcileFields, sameSet, listKey, fromListKey, cancelPendingSave, concerns, imageTargetOf } from './resync'

describe('reconcileField', () => {
  it('resets an untouched field whose server value changed (the 9,1 -> 9,5 bug)', () => {
    expect(reconcileField('9.1', '9.1', '9.5')).toEqual({ value: '9.5', outcome: 'reset' })
  })
  it('keeps a field the user is editing even when the server moved', () => {
    expect(reconcileField('9.3', '9.1', '9.5')).toEqual({ value: '9.3', outcome: 'kept' })
  })
  it('leaves everything alone when the server value did not change', () => {
    expect(reconcileField('typing', '9.1', '9.1')).toEqual({ value: 'typing', outcome: 'same' })
  })
  it('is a no-op when the user already typed the new server value', () => {
    expect(reconcileField('9.5', '9.1', '9.5').outcome).toBe('same')
  })
})

describe('reconcileFields', () => {
  it('resets only changed+untouched fields and reports kept ones', () => {
    const r = reconcileFields(
      { name: 'Beach', price: '9.1', vat: '21' },
      { name: 'Beach', price: '9.1', vat: '21' },
      { name: 'Beach 2', price: '9.5', vat: '21' },
    )
    expect(r.values).toEqual({ name: 'Beach 2', price: '9.5', vat: '21' })
    expect(r.reset).toEqual(['name', 'price'])
    expect(r.kept).toEqual([])
    const k = reconcileFields({ name: 'Mine', price: '9.1' }, { name: 'Beach', price: '9.1' }, { name: 'Beach 2', price: '9.5' })
    expect(k.values).toEqual({ name: 'Mine', price: '9.5' })
    expect(k.kept).toEqual(['name'])
  })
})

describe('list helpers', () => {
  it('sameSet ignores order', () => {
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameSet(['a'], ['a', 'b'])).toBe(false)
  })
  it('listKey round-trips and is order-insensitive', () => {
    expect(listKey(['wc', 'food'])).toBe(listKey(['food', 'wc']))
    expect(fromListKey(listKey(['wc', 'food']))).toEqual(['food', 'wc'])
    expect(fromListKey(listKey([]))).toEqual([])
    expect(listKey(null)).toBe('')
  })
})

describe('cancelPendingSave', () => {
  it('clears a pending timer so a stale save never fires', async () => {
    let fired = false
    const ref = { current: setTimeout(() => { fired = true }, 10) as ReturnType<typeof setTimeout> | null }
    expect(cancelPendingSave(ref)).toBe(true)
    expect(ref.current).toBeNull()
    await new Promise(r => setTimeout(r, 30))
    expect(fired).toBe(false)
    expect(cancelPendingSave(ref)).toBe(false)
  })
})

describe('concerns', () => {
  it('matches by kind', () => {
    expect(concerns(['brand', 'slug'], 'slug')).toBe(true)
    expect(concerns(['brand'], 'products')).toBe(false)
  })
})

describe('concerns: place_image spans several tabs', () => {
  it('reacts only to the targets a tab subscribed to', () => {
    expect(concerns(['place_image:cover'], 'place_image', 'cover')).toBe(true)
    expect(concerns(['place_image:cover'], 'place_image', 'product')).toBe(false)
    expect(concerns(['place_image:cover'], 'place_image')).toBe(false)
    expect(concerns(['place_image:product'], 'products', undefined)).toBe(false)
  })
  it('a bare kind subscription matches every target', () => {
    expect(concerns(['place_image'], 'place_image', 'rental_item')).toBe(true)
  })
  it('does not let a target alias another kind', () => {
    expect(concerns(['products'], 'place_image', 'products')).toBe(false)
  })
})

describe('imageTargetOf', () => {
  it('reads the placement target from a stored preview, tolerating garbage', () => {
    expect(imageTargetOf({ image: { target: 'cover' } })).toBe('cover')
    for (const bad of [null, undefined, 'x', {}, { image: null }, { image: { target: 3 } }, { image: { target: '' } }]) {
      expect(imageTargetOf(bad)).toBeUndefined()
    }
  })
})
