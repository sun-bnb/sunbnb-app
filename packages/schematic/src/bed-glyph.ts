// Pure rules for the consumer seat-map sunbed art: size per zoom, level of
// detail, how a seat's state is drawn, and where the parasol sits. The React
// components in `BedGlyph.tsx` only paint what these functions decide, so the
// geo map and the schematic cannot disagree. No DOM, no React, no IO.
//
// The art is authored in DECIMETRES on the real footprint (0.84 m × 2.1 m →
// an 8.4 × 21 viewBox, head at y = 0). Drawing that viewBox into a box of the
// bed's on-screen size is exact and symmetric at every zoom — no margins, no
// image aspect ratios, no per-zoom fudge factors.

import { SUNBED_HEIGHT, SUNBED_WIDTH } from './grid'

export type BedGlyphState = 'free' | 'selected' | 'reserved'
export type BedGlyphLod = 'micro' | 'detail'

/** Art-space footprint in decimetres. */
export const BED_ART_WIDTH = SUNBED_WIDTH * 10
export const BED_ART_LENGTH = SUNBED_HEIGHT * 10

/**
 * Below this on-screen bed length (CSS px) the lounger art is replaced by a
 * plain pill: slats and a towel do not survive a 7–19 px bed, a solid colour
 * does. 20 px ≈ zoom 20.5 at the map's scale.
 */
export const BED_MICRO_MAX_PX = 20

/** Status palette (green / blue / red 600, see `.claude/rules/ui.md`). */
export const BED_STATE_COLOR: Record<BedGlyphState, string> = {
  free: '#16a34a',
  selected: '#2563eb',
  reserved: '#dc2626',
}
/** Contrast halo under every ring/edge so it reads on sand and on dark imagery. */
export const BED_HALO_COLOR = 'rgba(15,23,42,0.40)'
const MICRO_FREE_FILL = '#f7f2e6'

/** Parasol canopy diameter (metres) and opacities. */
export const PARASOL_DIAMETER_M = 1.6
export const PARASOL_CANOPY_OPACITY = 0.85
/** On micro beds the canopy fades so it never hides the state of the beds under it. */
export const PARASOL_MICRO_OPACITY = 0.28
/** Screen size (CSS px) of the hub dot drawn on micro beds. */
export const PARASOL_MICRO_HUB_PX = 1.8

const METERS_PER_PX_AT_ZOOM_0 = 156543.03392

/**
 * On-screen bed length in CSS px at a Google Maps zoom. Same Web-Mercator
 * equator approximation the partner placement editor uses
 * (`apps/partner/.../InventoryMap.tsx` `getScaledSize`), so the consumer map
 * draws beds at exactly the size the operator placed them. Note: neither copy
 * applies the cos(latitude) factor — fix both together or not at all.
 */
export function bedLengthPxAtZoom(zoom: number): number {
  return SUNBED_HEIGHT / (METERS_PER_PX_AT_ZOOM_0 / Math.pow(2, zoom))
}

export function bedLod(lengthPx: number): BedGlyphLod {
  return lengthPx < BED_MICRO_MAX_PX ? 'micro' : 'detail'
}

/**
 * The marker's layout box for a bed `lengthPx` long. Matches the partner
 * marker's footprint (width = length / 2.5) — the map anchors a marker at the
 * bottom-centre of this box, so it must not change or every bed shifts away
 * from where the operator placed it.
 */
export function bedMarkerBox(lengthPx: number): { width: number; height: number } {
  return { width: lengthPx * (SUNBED_WIDTH / SUNBED_HEIGHT), height: lengthPx }
}

export type BedGlyphParts =
  | {
      kind: 'micro'
      fill: string
      edge: string
      edgePx: number
      /**
       * A continuous blue whirlpool around the pill. Only on a selected micro
       * bed: at that size the blue fill alone is easy to miss, and "this one is
       * yours" is the one state worth pulling the eye to. Detail beds have the
       * tint + check.
       */
      whirl: boolean
    }
  | {
      kind: 'detail'
      ringColor: string
      /** Lounger recoloured blue — "this one is yours". */
      tinted: boolean
      check: boolean
      /** The red towel is the reserved marker, and only that. */
      towel: boolean
      dimmed: boolean
    }

/**
 * What to draw for a seat. Every state carries a ring/edge in its status
 * colour, because at small sizes colour is the only cue that survives; the
 * detail parts (tint + check, towel) add meaning once there is room for them.
 * Free micro beds are hollow so free vs taken stays distinguishable without
 * relying on hue alone.
 */
export function bedGlyphParts(state: BedGlyphState, lod: BedGlyphLod): BedGlyphParts {
  if (lod === 'micro') {
    return state === 'free'
      ? { kind: 'micro', fill: MICRO_FREE_FILL, edge: BED_STATE_COLOR.free, edgePx: 2, whirl: false }
      : { kind: 'micro', fill: BED_STATE_COLOR[state], edge: '#ffffff', edgePx: 1.25, whirl: state === 'selected' }
  }
  return {
    kind: 'detail',
    ringColor: BED_STATE_COLOR[state],
    tinted: state === 'selected',
    check: state === 'selected',
    towel: state === 'reserved',
    dimmed: state === 'reserved',
  }
}

/**
 * Parasol centre relative to its anchor, in the beds' LOCAL art frame
 * (decimetres, head toward −y), before the beds' rotation is applied.
 *
 * - `pair`: the anchor is the midpoint of the two bed centres; the canopy
 *   sits there, pulled 0.7 m toward the heads — where a parasol stands, and
 *   far enough that the seat (towel, selected check) stays uncovered.
 * - `single`: the anchor is the bed centre; the canopy sits on its local left.
 */
export function parasolOffset(kind: 'pair' | 'single'): { x: number; y: number } {
  const headNudge = -7
  return kind === 'pair' ? { x: 0, y: headNudge } : { x: -(BED_ART_WIDTH / 2 + 3), y: headNudge }
}

/** Octagon vertices (vertex up), centred on the origin. */
export function octagonPoints(radius: number): Array<[number, number]> {
  return Array.from({ length: 8 }, (_, i) => {
    const a = ((-90 + i * 45) * Math.PI) / 180
    return [round3(radius * Math.cos(a)), round3(radius * Math.sin(a))]
  })
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
