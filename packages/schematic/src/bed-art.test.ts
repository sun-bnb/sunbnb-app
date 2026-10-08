import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { artParts, bedArt, parasolArt, type ArtNode } from './bed-art'
import { paintBed, paintParasol } from './bed-art-canvas'
import { BED_MICRO_MAX_PX, BED_STATE_COLOR } from './bed-glyph'

const DETAIL = BED_MICRO_MAX_PX + 10
const MICRO = BED_MICRO_MAX_PX - 5

describe('bed art', () => {
  it('draws the towel on reserved beds only', () => {
    expect(artParts(bedArt('reserved', DETAIL))).toContain('towel')
    expect(artParts(bedArt('selected', DETAIL))).not.toContain('towel')
    expect(artParts(bedArt('free', DETAIL))).not.toContain('towel')
  })

  it('draws the check on selected beds only', () => {
    expect(artParts(bedArt('selected', DETAIL))).toContain('check')
    expect(artParts(bedArt('reserved', DETAIL))).not.toContain('check')
  })

  it('rings every detailed bed in its status colour, at a constant screen width', () => {
    for (const s of ['free', 'selected', 'reserved'] as const) {
      const ring = bedArt(s, DETAIL).find((n) => n.part === 'ring') as Extract<ArtNode, { kind: 'rect' }>
      expect(ring.stroke).toBe(BED_STATE_COLOR[s])
      expect(ring.screenStroke).toBe(true)
    }
  })

  it('reduces a small bed to a pill — no lounger, no towel', () => {
    const parts = artParts(bedArt('reserved', MICRO))
    expect(parts).toContain('pill')
    expect(parts).not.toContain('frame')
    expect(parts).not.toContain('towel')
  })

  it('swirls a whirlpool around a selected bed at pill size only', () => {
    expect(artParts(bedArt('selected', MICRO))).toContain('whirl')
    expect(artParts(bedArt('free', MICRO))).not.toContain('whirl')
    expect(artParts(bedArt('reserved', MICRO))).not.toContain('whirl')
    expect(artParts(bedArt('selected', DETAIL))).not.toContain('whirl')
  })

  it('keeps the whirlpool continuous and blue: glow under the pill, opposing currents over it', () => {
    const nodes = bedArt('selected', MICRO)
    const glow = nodes.findIndex((n) => n.part === 'whirl-glow')
    const pill = nodes.findIndex((n) => n.part === 'pill')
    const rings = nodes.filter((n) => n.part === 'whirl') as Array<Extract<ArtNode, { kind: 'path' }>>
    expect(glow).toBeLessThan(pill)
    expect(nodes.findIndex((n) => n.part === 'whirl')).toBeGreaterThan(pill)
    expect(rings.map((r) => r.animation).sort()).toEqual(['whirl', 'whirlReverse'])
    expect(rings[0]!.stroke).toBe(BED_STATE_COLOR.selected)
    // dashes are in pathLength units, so the pattern tiles the loop exactly — no seam in the current
    for (const r of rings) {
      const period = r.dash!.reduce((x, y) => x + y, 0)
      expect((r.pathLength! / period) % 1).toBeCloseTo(0, 6)
    }
  })

  it('fades the parasol over small beds and keeps its hub visible', () => {
    const small = parasolArt(MICRO)
    const canopy = small.find((n) => n.part === 'canopy')!
    expect(canopy.opacity).toBeLessThan(0.5)
    expect(artParts(small)).toContain('hub')
  })
})

// A recording 2D context: enough to prove the canvas painter draws the same art.
function recorder() {
  const fills: string[] = []
  const strokes: Array<{ color: string; width: number }> = []
  const state = { fillStyle: '' as unknown, strokeStyle: '', lineWidth: 1, globalAlpha: 1, lineCap: '', lineJoin: '' }
  const ctx = {
    ...state,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    setLineDash() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    fill() {
      if (typeof ctx.fillStyle === 'string') fills.push(ctx.fillStyle)
    },
    stroke() {
      strokes.push({ color: ctx.strokeStyle, width: ctx.lineWidth })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes }
}

describe('canvas painter', () => {
  const realPath2D = (globalThis as { Path2D?: unknown }).Path2D
  beforeEach(() => {
    ;(globalThis as { Path2D?: unknown }).Path2D = class {
      rect() {}
      roundRect() {}
      moveTo() {}
      lineTo() {}
      arc() {}
      closePath() {}
    }
  })
  afterEach(() => {
    ;(globalThis as { Path2D?: unknown }).Path2D = realPath2D
  })

  it('paints the towel colour for a reserved bed and not for a selected one', () => {
    const reserved = recorder()
    paintBed(reserved.ctx, 'reserved', 50, 50, 0, 42)
    expect(reserved.fills).toContain('#ff5a36')
    const selected = recorder()
    paintBed(selected.ctx, 'selected', 50, 50, 0, 42)
    expect(selected.fills).not.toContain('#ff5a36')
  })

  it('keeps the status ring 2 CSS px wide whatever the bed size', () => {
    for (const len of [28, 56, 112]) {
      const r = recorder()
      paintBed(r.ctx, 'free', 0, 0, 0, len)
      const ring = r.strokes.find((s) => s.color === BED_STATE_COLOR.free)!
      // lineWidth is in art units; × (px per unit) gives screen px
      expect(ring.width * (len / 21)).toBeCloseTo(2, 6)
    }
  })

  it('picks the level of detail from the settled size during a pop-in', () => {
    const r = recorder()
    paintBed(r.ctx, 'reserved', 0, 0, 0, 3, DETAIL) // growing in from 3 px, settles at detail size
    expect(r.fills).toContain('#ff5a36')
  })

  it('skips the animated whirlpool on canvas — a frozen one reads as a broken outline', () => {
    const r = recorder()
    paintBed(r.ctx, 'selected', 0, 0, 0, MICRO)
    // only the pill's own halo + edge are stroked; no selected-colour whirl ring
    expect(r.strokes.filter((s) => s.color === BED_STATE_COLOR.selected)).toHaveLength(0)
  })

  it('paints nothing for a parasol that has not popped in yet', () => {
    const r = recorder()
    paintParasol(r.ctx, 0, 0, 0, DETAIL, 0)
    expect(r.fills).toHaveLength(0)
  })
})
