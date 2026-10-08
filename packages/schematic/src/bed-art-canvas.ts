// Canvas 2D painter for the sunbed + parasol art — the same `bed-art.ts`
// description the SVG painter (`BedGlyph.tsx`) renders, for surfaces that draw
// many beds on one canvas (the marketing site's map overlay and hero beach).
// Browser-only at call time (uses Path2D); importing it is side-effect free.

import { ART_GRADIENTS, bedArt, parasolArt, type ArtNode, type ArtPaint } from './bed-art'
import { BED_ART_LENGTH as L, BED_ART_WIDTH as W, type BedGlyphState } from './bed-glyph'

type Ctx = CanvasRenderingContext2D

/** Horizontal extent of a shape, for gradients that span its own bounding box. */
function xExtent(n: ArtNode): [number, number] {
  if (n.kind === 'rect') return [n.x, n.x + n.w]
  if (n.kind === 'poly') {
    const xs = n.points.map((p) => p[0])
    return [Math.min(...xs), Math.max(...xs)]
  }
  return [0, 1]
}

function fillStyle(ctx: Ctx, p: ArtPaint, n: ArtNode): string | CanvasGradient {
  if (typeof p === 'string') return p
  const [x0, x1] = xExtent(n)
  const g = ctx.createLinearGradient(x0, 0, x1, 0)
  for (const [offset, color] of ART_GRADIENTS[p.gradient]) g.addColorStop(offset, color)
  return g
}

/**
 * Paint art nodes in the CURRENT transform. `pxPerUnit` is the on-screen size
 * of one art unit, so `screenStroke` widths stay constant in CSS px.
 */
export function paintArt(ctx: Ctx, nodes: ArtNode[], pxPerUnit: number) {
  for (const n of nodes) {
    // A still frame has no place for an animated accent (see ArtNode.animation).
    if (n.kind !== 'group' && n.animation) continue
    ctx.save()
    if (n.opacity !== undefined) ctx.globalAlpha *= n.opacity
    if (n.kind === 'group') {
      if (n.translate) ctx.translate(n.translate[0], n.translate[1])
      if (n.rotate) ctx.rotate((n.rotate * Math.PI) / 180)
      paintArt(ctx, n.children, pxPerUnit)
      ctx.restore()
      continue
    }
    let path: Path2D
    switch (n.kind) {
      case 'rect':
        path = new Path2D()
        if (n.rx) path.roundRect(n.x, n.y, n.w, n.h, n.rx)
        else path.rect(n.x, n.y, n.w, n.h)
        break
      case 'line':
        path = new Path2D()
        path.moveTo(n.x1, n.y1)
        path.lineTo(n.x2, n.y2)
        break
      case 'path':
        path = new Path2D(n.d)
        break
      case 'circle':
        path = new Path2D()
        path.arc(n.cx, n.cy, n.r, 0, Math.PI * 2)
        break
      case 'poly':
        path = new Path2D()
        n.points.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])))
        path.closePath()
        break
    }
    if (n.fill !== undefined) {
      ctx.fillStyle = fillStyle(ctx, n.fill, n)
      ctx.fill(path)
    }
    if (n.stroke && n.strokeWidth) {
      ctx.strokeStyle = n.stroke
      ctx.lineWidth = n.screenStroke ? n.strokeWidth / pxPerUnit : n.strokeWidth
      if (n.dash) ctx.setLineDash(n.dash)
      if (n.round) {
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
      }
      ctx.stroke(path)
    }
    ctx.restore()
  }
}

/**
 * One bed centred at (x, y), `lengthPx` long, turned `rotation` radians
 * clockwise from head-up. `lodLengthPx` picks the level of detail (defaults to
 * `lengthPx`); pass the settled size during a pop-in so a growing bed doesn't
 * flicker between pill and lounger.
 */
export function paintBed(
  ctx: Ctx,
  state: BedGlyphState,
  x: number,
  y: number,
  rotation: number,
  lengthPx: number,
  lodLengthPx = lengthPx,
) {
  if (lengthPx <= 0) return
  const k = lengthPx / L
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.scale(k, k)
  ctx.translate(-W / 2, -L / 2)
  paintArt(ctx, bedArt(state, lodLengthPx), k)
  ctx.restore()
}

/**
 * One parasol whose canopy centre is at (x, y), for beds `bedLengthPx` long.
 * Callers place it with `parasolOffset` (bed-glyph.ts) in the beds' frame.
 */
export function paintParasol(ctx: Ctx, x: number, y: number, rotation: number, bedLengthPx: number, scale = 1) {
  if (bedLengthPx <= 0 || scale <= 0) return
  const k = (bedLengthPx / L) * scale
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.scale(k, k)
  paintArt(ctx, parasolArt(bedLengthPx), k)
  ctx.restore()
}
