// The sunbed + parasol ART as data: a list of primitive shapes per seat state.
// One description, two painters — `BedGlyph.tsx` turns it into SVG (user app
// seat maps) and `bed-art-canvas.ts` paints it on a 2D canvas (marketing site,
// which draws thousands of beds on one canvas). Neither painter knows what a
// lounger looks like, so the two can never drift apart. No DOM, no React.
//
// Coordinates are decimetres on the real footprint: a bed is an 8.4 × 21 box
// with its head at y = 0; a parasol is centred on the origin.

import {
  BED_ART_LENGTH as L,
  BED_ART_WIDTH as W,
  BED_HALO_COLOR,
  BED_STATE_COLOR,
  PARASOL_CANOPY_OPACITY,
  PARASOL_DIAMETER_M,
  PARASOL_MICRO_HUB_PX,
  PARASOL_MICRO_OPACITY,
  bedGlyphParts,
  bedLod,
  octagonPoints,
  type BedGlyphState,
} from './bed-glyph'

/** A horizontal gradient across the shape's own bounding box. */
export type ArtGradient = 'body' | 'bodySelected'
export const ART_GRADIENTS: Record<ArtGradient, ReadonlyArray<[offset: number, color: string]>> = {
  body: [[0, '#ffffff'], [1, '#dde2e6']],
  bodySelected: [[0, '#5e97f8'], [1, '#1f4fd6']],
}
export type ArtPaint = string | { gradient: ArtGradient }
/** `whirl` / `whirlReverse`: dashes travel around the outline; `glow`: fill breathes. */
export type ArtAnimation = 'whirl' | 'whirlReverse' | 'glow'

interface ArtStyle {
  fill?: ArtPaint
  stroke?: string
  /** Stroke width in art units — or in screen px when `screenStroke` is set. */
  strokeWidth?: number
  /** Constant on-screen stroke width at every zoom (SVG `non-scaling-stroke`). */
  screenStroke?: boolean
  opacity?: number
  dash?: number[]
  round?: boolean
  /** A name for the part ('towel', 'check', 'ring', 'canopy'…), for tests and debugging. */
  part?: string
  /** Normalises the dash pattern to this total length (SVG `pathLength`). */
  pathLength?: number
  /**
   * An animated accent. Painters that can animate (SVG, via the keyframes in
   * <BedArtDefs/>) do; static painters (canvas) skip the node entirely — a
   * frozen whirlpool reads as a broken outline, not as "selected".
   */
  animation?: ArtAnimation
}

export type ArtNode =
  | (ArtStyle & { kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number })
  | (ArtStyle & { kind: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (ArtStyle & { kind: 'path'; d: string })
  | (ArtStyle & { kind: 'circle'; cx: number; cy: number; r: number })
  | (ArtStyle & { kind: 'poly'; points: ReadonlyArray<[number, number]> })
  | {
      kind: 'group'
      translate?: [number, number]
      /** Degrees, clockwise, about the group's (translated) origin. */
      rotate?: number
      opacity?: number
      part?: string
      children: ArtNode[]
    }

const CX = W / 2

const BACK_SLOTS = [0, 1, 2, 3, 4].map((i) => 1.65 + i * 1.15)
const SEAT_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 9.1 + i * 1.38)

/** White perforated plastic lounger, top-down. `selected` recolours it blue. */
function lounger(selected: boolean): ArtNode[] {
  const p = selected
    ? { body: { gradient: 'bodySelected' as const }, edge: '#1e3a8a', panel: '#3f7ef1', slot: '#1e3a8a', arm: '#4f8af5' }
    : { body: { gradient: 'body' as const }, edge: '#9aa2a9', panel: '#eceff1', slot: '#848d95', arm: '#f2f4f5' }
  return [
    // soft ground shadow, offset toward the bottom-right
    { kind: 'rect', x: 1.0, y: 0.9, w: 7.3, h: 20.6, rx: 1.1, fill: '#2a1a08', opacity: 0.22, part: 'shadow' },
    { kind: 'rect', x: 0.55, y: 0.2, w: 7.3, h: 20.6, rx: 1.1, fill: p.body, stroke: p.edge, strokeWidth: 0.16, part: 'frame' },
    { kind: 'rect', x: 0, y: 8.6, w: 0.62, h: 5.4, rx: 0.25, fill: p.arm, stroke: p.edge, strokeWidth: 0.14 },
    { kind: 'rect', x: 7.78, y: 8.6, w: 0.62, h: 5.4, rx: 0.25, fill: p.arm, stroke: p.edge, strokeWidth: 0.14 },
    { kind: 'rect', x: 1.35, y: 1.0, w: 5.7, h: 6.2, rx: 0.45, fill: p.panel, opacity: 0.7 },
    { kind: 'rect', x: 1.35, y: 8.4, w: 5.7, h: 11.6, rx: 0.45, fill: p.panel, opacity: 0.7 },
    { kind: 'line', x1: 0.6, y1: 7.75, x2: 7.8, y2: 7.75, stroke: p.edge, strokeWidth: 0.2, opacity: 0.7 },
    ...BACK_SLOTS.map((y): ArtNode => ({ kind: 'rect', x: 1.8, y, w: 4.8, h: 0.34, rx: 0.17, fill: p.slot })),
    ...SEAT_SLOTS.map((y): ArtNode => ({ kind: 'rect', x: 1.8, y, w: 4.8, h: 0.42, rx: 0.21, fill: p.slot })),
  ]
}

const TOWEL_W = 6.2
const TOWEL_H = 13.2

/** The red towel — the reserved marker. Lies slightly askew across the seat. */
function towel(): ArtNode {
  const w = TOWEL_W
  const x = -w / 2
  const y = -TOWEL_H / 2
  const fringe: ArtNode[] = []
  for (let k = 0; k <= 9; k++) {
    const fx = x + 0.3 + (k * (w - 0.6)) / 9
    fringe.push({ kind: 'line', x1: fx, y1: y, x2: fx, y2: y - 0.7, stroke: '#ff7a5c', strokeWidth: 0.15 })
    fringe.push({ kind: 'line', x1: fx, y1: y + TOWEL_H, x2: fx, y2: y + TOWEL_H + 0.7, stroke: '#ff7a5c', strokeWidth: 0.15 })
  }
  return {
    kind: 'group',
    translate: [CX, 11.9],
    rotate: -8,
    part: 'towel',
    children: [
      { kind: 'rect', x, y, w, h: TOWEL_H, rx: 0.25, fill: '#ff5a36', stroke: '#d63e1f', strokeWidth: 0.12 },
      ...[0, 1, 2].map((i): ArtNode => {
        const y0 = y + 1.9 + i * 4.1
        return {
          kind: 'path',
          d: `M${x},${y0} q${w / 4},-0.9 ${w / 2},0 t${w / 2},0 v1.9 q${-w / 4},0.9 ${-w / 2},0 t${-w / 2},0 z`,
          fill: '#ffaba5',
        }
      }),
      ...fringe,
    ],
  }
}

// On the lower seat, clear of the parasol canopy that covers the head end.
const CHECK_PATH = 'M1.9 16.2 l1.75 1.85 l3.0 -3.9'
function check(): ArtNode[] {
  return [
    { kind: 'path', d: CHECK_PATH, stroke: 'rgba(15,23,42,0.45)', strokeWidth: 1.9, round: true, part: 'check' },
    { kind: 'path', d: CHECK_PATH, stroke: '#ffffff', strokeWidth: 1.25, round: true, part: 'check' },
  ]
}

/** Status outline over a dark halo; constant on-screen width at every zoom. */
function outline(color: string, widthPx: number, inset: number, rx: number, part: string, fill?: string): ArtNode[] {
  const r = { x: inset, y: inset, w: W - 2 * inset, h: L - 2 * inset, rx }
  return [
    { kind: 'rect', ...r, fill, stroke: BED_HALO_COLOR, strokeWidth: widthPx + 2, screenStroke: true, part: `${part}-halo` },
    { kind: 'rect', ...r, fill, stroke: color, strokeWidth: widthPx, screenStroke: true, part },
  ]
}

/** A stadium (fully rounded rect) path around the bed, `grow` art units outside its box. */
function stadium(grow: number): string {
  const x = -grow
  const y = -grow
  const w = W + 2 * grow
  const h = L + 2 * grow
  const r = w / 2
  return (
    `M${x + r},${y} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} ` +
    `A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`
  )
}

/**
 * The selected-seat whirlpool: a breathing blue glow under the pill, and two
 * dashed rings hugging it whose dashes stream around it in opposite
 * directions. The outline itself never rotates — on a 2.5 : 1 pill a turning
 * ring would wobble, and a pair (selected together) would collide.
 */
function whirlpool(layer: 'under' | 'over'): ArtNode[] {
  const blue = BED_STATE_COLOR.selected
  if (layer === 'under') {
    return [{ kind: 'path', d: stadium(4.6), fill: blue, opacity: 0.22, animation: 'glow', part: 'whirl-glow' }]
  }
  return [
    {
      kind: 'path', d: stadium(3.0), stroke: blue, strokeWidth: 2, screenStroke: true, round: true,
      pathLength: 100, dash: [17, 8], animation: 'whirl', part: 'whirl',
    },
    {
      kind: 'path', d: stadium(5.6), stroke: '#60a5fa', strokeWidth: 1.5, screenStroke: true, round: true,
      pathLength: 100, dash: [7, 13], opacity: 0.9, animation: 'whirlReverse', part: 'whirl',
    },
  ]
}

/** One bed in the 8.4 × 21 frame, for a bed drawn `lengthPx` long on screen. */
export function bedArt(state: BedGlyphState, lengthPx: number): ArtNode[] {
  const parts = bedGlyphParts(state, bedLod(lengthPx))
  if (parts.kind === 'micro') {
    const pill = outline(parts.edge, parts.edgePx, 0.4, 2.6, 'pill', parts.fill)
    return parts.whirl ? [...whirlpool('under'), ...pill, ...whirlpool('over')] : pill
  }
  const body = lounger(parts.tinted)
  return [
    ...(parts.dimmed ? [{ kind: 'group', opacity: 0.55, children: body } as ArtNode] : body),
    ...(parts.towel ? [towel()] : []),
    ...(parts.check ? check() : []),
    ...outline(parts.ringColor, 2, -0.45, 1.6, 'ring'),
  ]
}

/** One parasol centred on the origin. Fades on micro beds so it never hides their state. */
export function parasolArt(bedLengthPx: number): ArtNode[] {
  const R = PARASOL_DIAMETER_M * 5
  const pts = octagonPoints(R)
  if (bedLod(bedLengthPx) === 'micro') {
    const pxPerDm = bedLengthPx / L
    return [
      { kind: 'poly', points: pts, fill: '#ffffff', opacity: PARASOL_MICRO_OPACITY, part: 'canopy' },
      { kind: 'circle', cx: 0, cy: 0, r: PARASOL_MICRO_HUB_PX / pxPerDm, fill: '#3b2a18', stroke: '#ffffff', strokeWidth: 1, screenStroke: true, part: 'hub' },
    ]
  }
  return [
    { kind: 'group', translate: [3.2, 4.2], children: [{ kind: 'poly', points: pts, fill: '#2a1a08', opacity: 0.22, part: 'shadow' }] },
    {
      kind: 'group',
      opacity: PARASOL_CANOPY_OPACITY,
      part: 'canopy',
      children: [
        ...pts.map((p1, i): ArtNode => ({ kind: 'poly', points: [[0, 0], p1, pts[(i + 1) % 8]!], fill: i % 2 ? '#e9ecee' : '#ffffff' })),
        ...pts.map((p): ArtNode => ({ kind: 'line', x1: 0, y1: 0, x2: p[0], y2: p[1], stroke: '#9aa1a8', strokeWidth: 0.14, dash: [0.5, 0.45] })),
        { kind: 'poly', points: pts, stroke: '#b9c0c6', strokeWidth: 0.2 },
      ],
    },
    { kind: 'poly', points: octagonPoints(0.9), fill: '#dfe3e6', stroke: '#9aa1a8', strokeWidth: 0.12, part: 'hub' },
    { kind: 'circle', cx: 0, cy: 0, r: 0.35, fill: '#9aa1a8' },
  ]
}

/** Every `part` name in a tree, depth-first. */
export function artParts(nodes: ArtNode[]): string[] {
  const out: string[] = []
  const walk = (ns: ArtNode[]) => {
    for (const n of ns) {
      if (n.part) out.push(n.part)
      if (n.kind === 'group') walk(n.children)
    }
  }
  walk(nodes)
  return out
}
