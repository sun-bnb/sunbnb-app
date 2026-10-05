import { describe, expect, it } from 'vitest'
import { clientIp, isValidPlaceId, isValidQuery, isValidSessionToken, parseBeachParams, parseNear, parseSunbedCount } from './places.ts'

describe('parseSunbedCount — what the sunbed field accepts', () => {
  it.each([
    ['120', 120],
    [' 8 ', 8],
    ['1', 1],
    ['5000', 5000],
  ])('accepts %j', (raw, n) => expect(parseSunbedCount(raw)).toBe(n))

  it.each(['0', '-5', '12.5', '1e3', '5001', 'abc', '', '120 beds', '999999'])('rejects %j', (raw) =>
    expect(parseSunbedCount(raw)).toBeNull(),
  )
})

describe('parseBeachParams — the /beach URL contract', () => {
  it('accepts a valid place + count', () => {
    expect(parseBeachParams({ place: 'ChIJ_abc-123', beds: '120' })).toEqual({ placeId: 'ChIJ_abc-123', sunbedCount: 120 })
  })

  it('rejects a place id that could inject parameters into the Google request', () => {
    expect(parseBeachParams({ place: 'ChIJ&key=other', beds: '120' })).toBeNull()
  })

  it('rejects repeated params and missing fields', () => {
    expect(parseBeachParams({ place: ['a', 'b'], beds: '1' })).toBeNull()
    expect(parseBeachParams({ place: 'ChIJabc' })).toBeNull()
  })
})

describe('Places proxy input rules', () => {
  it('bounds the search text', () => {
    expect(isValidQuery('Playa de Muro')).toBe(true)
    expect(isValidQuery('   ')).toBe(false)
    expect(isValidQuery('x'.repeat(201))).toBe(false)
  })

  it('accepts only our own UUID session tokens', () => {
    expect(isValidSessionToken('3f0c2a8e-1b2c-4d5e-8f90-123456789abc')).toBe(true)
    expect(isValidSessionToken('anything&key=x')).toBe(false)
  })

  it('validates place ids', () => {
    expect(isValidPlaceId('ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe(true)
    expect(isValidPlaceId('../../etc')).toBe(false)
  })

  it('takes the first x-forwarded-for hop as the client ip', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
    expect(clientIp(new Headers())).toBe('unknown')
  })
})

describe('parseNear — the "near me" bias', () => {
  it('rounds to ~1 km before anything leaves us', () => {
    expect(parseNear('39.80719,3.11650')).toEqual({ lat: 39.81, lng: 3.12 })
  })
  it('rejects anything that is not two coordinates', () => {
    for (const bad of [null, '', '39.8', '91,3', '39.8,181', '39.8;3.1', 'a,b', '39.8,3.1,5']) expect(parseNear(bad)).toBeNull()
  })
})
