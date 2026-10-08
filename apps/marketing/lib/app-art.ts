'use client'

/**
 * Draws sunbeds EXACTLY as the guest app does (track 027 D8: graphics are the app's, not made up).
 * The art is not copied: it is the guest app's own vector art from `@repo/schematic/art`
 * (`bed-art.ts`), painted on canvas by the shared `paintBed` / `paintParasol` — the same
 * description `apps/user` renders as SVG on its seat maps, so the two cannot drift.
 * States as in the app: free = green ring, selected = blue lounger + check, booked = red ring +
 * red towel; small beds become pills. Used by the hero beach scene and the map overlay.
 */

import { BED_ART_LENGTH, paintBed, paintParasol, parasolOffset, type BedGlyphState } from '@repo/schematic/art'

export type BedStatus = 'free' | 'selected' | 'booked'

/** Marketing's "booked" is the app's "reserved". */
export const BED_STATE: Record<BedStatus, BedGlyphState> = { free: 'free', selected: 'selected', booked: 'reserved' }

/** The app's bed footprint: 0.84 × 2.1 m, width = length / 2.5. */
export const BED_WIDTH_RATIO = 1 / 2.5

/**
 * One sunbed centred at (x, y). `seaAngle` is the canvas rotation that points "up" at the sea;
 * the backrest goes on the LAND side so the lounger faces the water. `pop` (0–1) scales the bed in
 * for the drop-in animation.
 */
export function drawAppBed(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seaAngle: number,
  lengthPx: number,
  status: BedStatus,
  pop = 1,
) {
  ctx.save()
  ctx.globalAlpha *= Math.min(1, pop * 1.2)
  // The art's head is at its top; turn it to face the sea (backrest away from the water).
  paintBed(ctx, BED_STATE[status], x, y, seaAngle + Math.PI, lengthPx * pop, lengthPx)
  ctx.restore()
}

/**
 * The parasol a pair of beds shares, given the pair's midpoint (x, y). Placed exactly as the app
 * places it (`parasolOffset('pair')`: toward the backrests), turned with the beds.
 */
export function drawAppShade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seaAngle: number,
  bedLengthPx: number,
  pop = 1,
) {
  const k = bedLengthPx / BED_ART_LENGTH // art units (dm) → px
  const off = parasolOffset('pair')
  const a = seaAngle + Math.PI
  const ox = (off.x * Math.cos(a) - off.y * Math.sin(a)) * k
  const oy = (off.x * Math.sin(a) + off.y * Math.cos(a)) * k
  ctx.save()
  ctx.globalAlpha *= Math.min(1, pop * 1.2)
  paintParasol(ctx, x + ox, y + oy, a, bedLengthPx, pop)
  ctx.restore()
}

/** Light haptic tick on supporting phones — the "game feel" of every confirmed touch. */
export function haptic(ms = 8) {
  try {
    if (typeof navigator !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(ms)
  } catch {
    /* unsupported */
  }
}
