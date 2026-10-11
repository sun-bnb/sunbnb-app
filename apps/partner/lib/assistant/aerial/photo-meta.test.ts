/**
 * EXIF focal length + georef validation + seed priority (track 030 S7). Requirements: the 35 mm focal
 * length is read from both byte orders and garbage never throws; a stored georef must be a sane
 * similarity near the site; the seed prefers the DJI nadir pose, falls back to the site centre, and
 * flags an oblique DJI shot.
 */
import { describe, it, expect } from 'vitest'
import { readFocal35mm } from './photo-meta'
import { validateGeoref } from './georef-validate'
import { seedGeoref } from './seed'

function exif(le: boolean, focal: number, prefix = true): Buffer {
  const b = Buffer.alloc(44)
  const w16 = (o: number, v: number) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o))
  const w32 = (o: number, v: number) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o))
  b.write(le ? 'II' : 'MM', 0, 'latin1')
  w16(2, 42); w32(4, 8)
  w16(8, 1); w16(10, 0x8769); w16(12, 4); w32(14, 1); w32(18, 26); w32(22, 0)
  w16(26, 1); w16(28, 0xa405); w16(30, 3); w32(32, 1); w16(36, focal); w32(40, 0)
  return prefix ? Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), b]) : b
}

describe('readFocal35mm', () => {
  it('reads FocalLengthIn35mmFilm in little- and big-endian EXIF, with or without the Exif header', () => {
    expect(readFocal35mm(exif(true, 24))).toBe(24)
    expect(readFocal35mm(exif(false, 28))).toBe(28)
    expect(readFocal35mm(exif(true, 24, false))).toBe(24)
  })
  it('returns null for missing / truncated / garbage EXIF without throwing', () => {
    expect(readFocal35mm(undefined)).toBeNull()
    expect(readFocal35mm(Buffer.from('Exif\0\0garbage-garbage', 'latin1'))).toBeNull()
    expect(readFocal35mm(exif(true, 24).subarray(0, 30))).toBeNull()
  })
})

const SITE = { lat: 36.7, lng: -4.4 }
const ok = { kind: 'similarity', anchorPx: { x: 1000, y: 750 }, anchor: { lat: 36.7005, lng: -4.4003 }, metersPerPx: 0.05, rotationDeg: -30 }

describe('validateGeoref', () => {
  it('accepts a sane similarity near the site and normalises the rotation', () => {
    const r = validateGeoref(ok, SITE)
    expect(r).toEqual({ ok: true, georef: { ...ok, rotationDeg: 330 } })
  })
  it.each([
    ['not an object', null],
    ['homography (not produced in the MVP)', { ...ok, kind: 'homography' }],
    ['extra fields', { ...ok, evil: 1 }],
    ['NaN pixel', { ...ok, anchorPx: { x: Number.NaN, y: 1 } }],
    ['latitude out of range', { ...ok, anchor: { lat: 91, lng: 0 } }],
    ['zero scale', { ...ok, metersPerPx: 0 }],
    ['absurd scale', { ...ok, metersPerPx: 50 }],
    ['string rotation', { ...ok, rotationDeg: '10' }],
  ])('rejects %s', (_n, value) => {
    expect(validateGeoref(value, SITE).ok).toBe(false)
  })
  it('rejects an alignment far from the site (another town)', () => {
    expect(validateGeoref({ ...ok, anchor: { lat: 37.5, lng: -4.4 } }, SITE)).toEqual({ ok: false, errors: ['The aligned photo is too far from the site location'] })
  })
})

describe('seedGeoref', () => {
  const image = { w: 2000, h: 1500 }
  const dji = { lat: 36.701, lng: -4.401, relAltM: 60, yawDeg: 90, pitchDeg: -89.9, nadir: true }
  it('uses the DJI nadir pose: centred on the drone, top edge toward the gimbal yaw', () => {
    const s = seedGeoref({ meta: { dji, focal35mm: 24 }, image, siteCentre: SITE })
    expect(s.source).toBe('dji')
    expect(s.georef.anchor).toEqual({ lat: 36.701, lng: -4.401 })
    expect(s.georef.rotationDeg).toBe(90)
    expect(s.georef.metersPerPx).toBeGreaterThan(0.03)
    expect(s.georef.metersPerPx).toBeLessThan(0.08)
  })
  it('an oblique DJI shot falls back to the site centre and is flagged', () => {
    const s = seedGeoref({ meta: { dji: { ...dji, pitchDeg: -45, nadir: false }, focal35mm: null }, image, siteCentre: SITE })
    expect(s).toMatchObject({ source: 'default', oblique: true, georef: { anchor: SITE } })
  })
  it('without metadata: site centre, bed-size scale when the bed length is known', () => {
    expect(seedGeoref({ meta: { dji: null, focal35mm: null }, image, siteCentre: SITE, bedLengthPx: 42 }).georef.metersPerPx).toBeCloseTo(0.05)
    expect(seedGeoref({ meta: { dji: null, focal35mm: null }, image, siteCentre: SITE }).source).toBe('default')
  })
})
