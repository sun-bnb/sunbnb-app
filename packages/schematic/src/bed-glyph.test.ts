import { describe, expect, it } from 'vitest'
import {
  BED_ART_LENGTH,
  BED_ART_WIDTH,
  BED_MICRO_MAX_PX,
  BED_STATE_COLOR,
  PARASOL_DIAMETER_M,
  bedGlyphParts,
  bedLengthPxAtZoom,
  bedLod,
  bedMarkerBox,
  octagonPoints,
  parasolOffset,
  type BedGlyphState,
} from './bed-glyph'
import { SUNBED_HEIGHT, SUNBED_WIDTH } from './grid'

const STATES: BedGlyphState[] = ['free', 'selected', 'reserved']

describe('bed size per zoom', () => {
  it('draws a 2.1 m bed at about 14 px at zoom 20 and doubles per zoom level', () => {
    expect(bedLengthPxAtZoom(20)).toBeCloseTo(14.07, 1)
    expect(bedLengthPxAtZoom(21) / bedLengthPxAtZoom(20)).toBeCloseTo(2, 10)
  })

  it('matches the partner placement editor (getScaledSize, InventoryMap.tsx)', () => {
    const partner = (zoom: number) => 2.1 / (156543.03392 / Math.pow(2, zoom))
    for (const z of [19.3, 20, 21.7, 23]) expect(bedLengthPxAtZoom(z)).toBeCloseTo(partner(z), 10)
  })
})

describe('marker box', () => {
  it('keeps the partner marker footprint (width = length / 2.5) so beds stay where operators placed them', () => {
    for (const len of [7, 14, 20, 80]) {
      const box = bedMarkerBox(len)
      expect(box.height).toBe(len)
      expect(box.width).toBeCloseTo(len / 2.5, 10)
    }
  })

  it('has the same aspect as the art viewBox, so the art fills the box with no margin at any size', () => {
    const box = bedMarkerBox(37)
    expect(box.width / box.height).toBeCloseTo(BED_ART_WIDTH / BED_ART_LENGTH, 10)
    expect(BED_ART_WIDTH).toBeCloseTo(SUNBED_WIDTH * 10, 10)
    expect(BED_ART_LENGTH).toBeCloseTo(SUNBED_HEIGHT * 10, 10)
  })
})

describe('level of detail', () => {
  it('uses the plain pill below the threshold and the lounger art from it upward', () => {
    expect(bedLod(BED_MICRO_MAX_PX - 0.01)).toBe('micro')
    expect(bedLod(BED_MICRO_MAX_PX)).toBe('detail')
  })

  it('shows pills at the first seat zoom (just above 19) and detail by zoom 21', () => {
    expect(bedLod(bedLengthPxAtZoom(19.01))).toBe('micro')
    expect(bedLod(bedLengthPxAtZoom(20))).toBe('micro')
    expect(bedLod(bedLengthPxAtZoom(21))).toBe('detail')
  })
})

describe('state encoding', () => {
  it('gives every state a distinct status colour at both levels of detail', () => {
    for (const lod of ['micro', 'detail'] as const) {
      const colours = STATES.map((s) => {
        const p = bedGlyphParts(s, lod)
        return p.kind === 'micro' ? (s === 'free' ? p.edge : p.fill) : p.ringColor
      })
      expect(colours).toEqual([BED_STATE_COLOR.free, BED_STATE_COLOR.selected, BED_STATE_COLOR.reserved])
    }
  })

  it('reserves the red towel for reserved beds only — a selected bed is never towelled', () => {
    for (const s of STATES) {
      const p = bedGlyphParts(s, 'detail')
      if (p.kind !== 'detail') throw new Error('expected detail parts')
      expect(p.towel).toBe(s === 'reserved')
      expect(p.dimmed).toBe(s === 'reserved')
    }
  })

  it('marks a selected bed with the blue tint and a check, and nothing else does', () => {
    for (const s of STATES) {
      const p = bedGlyphParts(s, 'detail')
      if (p.kind !== 'detail') throw new Error('expected detail parts')
      expect(p.tinted).toBe(s === 'selected')
      expect(p.check).toBe(s === 'selected')
    }
  })

  it('draws a free micro bed hollow, so free vs taken does not depend on hue alone', () => {
    const free = bedGlyphParts('free', 'micro')
    const taken = bedGlyphParts('reserved', 'micro')
    if (free.kind !== 'micro' || taken.kind !== 'micro') throw new Error('expected micro parts')
    expect(free.fill).not.toBe(free.edge)
    expect(taken.fill).toBe(BED_STATE_COLOR.reserved)
  })
})

describe('parasol', () => {
  it('centres a shared parasol between the pair, toward the heads, leaving the lower seat uncovered', () => {
    const o = parasolOffset('pair')
    expect(o.x).toBe(0)
    expect(o.y).toBeLessThan(0)
    // canopy's far edge (bed-centre frame) stays above the lower seat, where the check and towel read
    const canopyBottom = o.y + (PARASOL_DIAMETER_M * 10) / 2
    expect(canopyBottom).toBeLessThan(BED_ART_LENGTH / 4)
  })

  it('puts a single bed’s parasol on its local left, clear of the bed centre', () => {
    const o = parasolOffset('single')
    expect(o.x).toBeLessThan(-BED_ART_WIDTH / 2)
  })

  it('builds a symmetric octagon with a vertex straight up', () => {
    const pts = octagonPoints(8)
    expect(pts).toHaveLength(8)
    expect(pts[0]![0]).toBeCloseTo(0, 6)
    expect(pts[0]![1]).toBeCloseTo(-8, 6)
    const cx = pts.reduce((a, p) => a + p[0], 0) / 8
    const cy = pts.reduce((a, p) => a + p[1], 0) / 8
    expect(cx).toBeCloseTo(0, 6)
    expect(cy).toBeCloseTo(0, 6)
  })
})
