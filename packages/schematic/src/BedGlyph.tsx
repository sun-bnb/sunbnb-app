// SVG painter for the sunbed + parasol art (user app geo map and schematic).
// WHAT is drawn lives in the pure `bed-art.ts` (shared with the canvas painter
// in `bed-art-canvas.ts`); the rules behind it in `bed-glyph.ts`. This file
// only maps art nodes to SVG elements.
//
// Coordinates are decimetres on the real footprint: a bed is an 8.4 × 21 box
// with its head at y = 0. Gradients come from <BedArtDefs/>, mounted ONCE per
// document (fixed ids), so hundreds of beds don't each carry their own defs.

import { ART_GRADIENTS, bedArt, parasolArt, type ArtAnimation, type ArtGradient, type ArtNode, type ArtPaint } from './bed-art'
import { BED_ART_LENGTH as L, BED_ART_WIDTH as W, type BedGlyphState } from './bed-glyph'

const GRADIENT_ID: Record<ArtGradient, string> = { body: 'sbn-bed-body', bodySelected: 'sbn-bed-body-sel' }

/**
 * Animated accents (ArtNode.animation) — the selected-seat whirlpool. Dashes
 * stream around the outline (`stroke-dashoffset`, in `pathLength` units) in
 * two opposing currents while the glow under the pill breathes. Continuous,
 * linear, no easing seams. Under reduced motion the dashes stand still: the
 * rings stay, so "selected" still reads.
 */
const ANIMATION_CLASS: Record<ArtAnimation, string> = {
  whirl: 'sbn-whirl',
  whirlReverse: 'sbn-whirl-rev',
  glow: 'sbn-whirl-glow',
}
const ANIMATION_CSS = `
@keyframes sbn-whirl { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; } }
@keyframes sbn-whirl-rev { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 100; } }
@keyframes sbn-whirl-glow { from { opacity: 0.14; } to { opacity: 0.34; } }
.sbn-whirl { animation: sbn-whirl 1.6s linear infinite; pointer-events: none; }
.sbn-whirl-rev { animation: sbn-whirl-rev 2.4s linear infinite; pointer-events: none; }
.sbn-whirl-glow { animation: sbn-whirl-glow 1.2s ease-in-out infinite alternate; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .sbn-whirl, .sbn-whirl-rev, .sbn-whirl-glow { animation: none; }
}
`
const CX = W / 2
const CY = L / 2

/**
 * Shared gradients and animation keyframes. Render once anywhere in the page; ids resolve
 * document-wide. Keep it out of `display:none` (that disables gradients in
 * some browsers) — a zero-size, absolutely positioned <svg> is the host.
 */
export function BedArtDefs() {
  return (
    <svg width={0} height={0} aria-hidden="true" focusable="false" style={{ position: 'absolute', overflow: 'hidden' }}>
      <defs>
        <style>{ANIMATION_CSS}</style>
        {(Object.keys(ART_GRADIENTS) as ArtGradient[]).map((g) => (
          <linearGradient key={g} id={GRADIENT_ID[g]} x1="0" x2="1">
            {ART_GRADIENTS[g].map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        ))}
      </defs>
    </svg>
  )
}

const paint = (p: ArtPaint | undefined) =>
  p === undefined ? 'none' : typeof p === 'string' ? p : `url(#${GRADIENT_ID[p.gradient]})`

function ArtNodes({ nodes }: { nodes: ArtNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.kind === 'group') {
          const t = [
            n.translate ? `translate(${n.translate[0]} ${n.translate[1]})` : '',
            n.rotate ? `rotate(${n.rotate})` : '',
          ].join(' ').trim()
          return (
            <g key={i} transform={t || undefined} opacity={n.opacity}>
              <ArtNodes nodes={n.children} />
            </g>
          )
        }
        const style = {
          fill: paint(n.fill),
          stroke: n.stroke,
          strokeWidth: n.strokeWidth,
          opacity: n.opacity,
          strokeDasharray: n.dash?.join(' '),
          strokeLinecap: n.round ? ('round' as const) : undefined,
          strokeLinejoin: n.round ? ('round' as const) : undefined,
          vectorEffect: n.screenStroke ? ('non-scaling-stroke' as const) : undefined,
          className: n.animation ? ANIMATION_CLASS[n.animation] : undefined,
          pathLength: n.pathLength,
        }
        switch (n.kind) {
          case 'rect':
            return <rect key={i} x={n.x} y={n.y} width={n.w} height={n.h} rx={n.rx} {...style} />
          case 'line':
            return <line key={i} x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} {...style} />
          case 'path':
            return <path key={i} d={n.d} {...style} />
          case 'circle':
            return <circle key={i} cx={n.cx} cy={n.cy} r={n.r} {...style} />
          case 'poly':
            return <polygon key={i} points={n.points.map((p) => p.join(',')).join(' ')} {...style} />
        }
      })}
    </>
  )
}

/**
 * One bed's art, as SVG children in the 8.4 × 21 decimetre frame. Place it in
 * an element whose user space is that frame (see `BedGlyphSvg`).
 */
export function BedGlyph({ state, lengthPx }: { state: BedGlyphState; lengthPx: number }) {
  return <ArtNodes nodes={bedArt(state, lengthPx)} />
}

/**
 * A bed as a self-contained <svg> of the given box. The art fills the box
 * exactly; rotation turns it about the box centre and may overflow the box
 * (`overflow: visible`), matching how the partner marker rotates.
 */
export function BedGlyphSvg({
  state,
  lengthPx,
  width,
  height,
  x,
  y,
  rotation = 0,
  label,
}: {
  state: BedGlyphState
  lengthPx: number
  width: number
  height: number
  x?: number
  y?: number
  rotation?: number
  label?: string
}) {
  return (
    <svg
      x={x}
      y={y}
      width={width}
      height={height}
      viewBox={`0 0 ${W} ${L}`}
      overflow="visible"
      style={{ overflow: 'visible', display: 'block' }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g transform={rotation ? `rotate(${rotation} ${CX} ${CY})` : undefined}>
        <BedGlyph state={state} lengthPx={lengthPx} />
      </g>
    </svg>
  )
}

/**
 * Parasol, as SVG children centred on the origin in decimetres. `bedLengthPx`
 * picks the level of detail with the same threshold as the beds, so a micro
 * bed never sits under an opaque canopy.
 */
export function ParasolGlyph({ bedLengthPx }: { bedLengthPx: number }) {
  return <ArtNodes nodes={parasolArt(bedLengthPx)} />
}
