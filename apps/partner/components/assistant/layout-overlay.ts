/**
 * Pure model for the schematic-canvas overlay of a `layout_elements` proposal (track 030 S4c).
 * World = schematic metres (the renderer's own coordinate space, so no screen transform is needed:
 * the renderer draws the overlay inside its <svg> viewBox). This file turns the parsed preview into
 * the shapes to draw: blue = added, amber = moved (drawn at the AFTER position, with a connector from
 * the old centre), red = removed (drawn where the element is now).
 */
import type { ElementPreview, ElementRect } from './geometry-preview'

export type ElementGhostKind = 'added' | 'moved' | 'removed'

export interface ElementGhostShape {
  key: string
  kind: ElementGhostKind
  shape: 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  /** SVG `transform` rotating about the centre, undefined when unrotated. */
  transform?: string
  label: string | null
}
export interface ElementGhostLink {
  key: string
  from: { x: number; y: number }
  to: { x: number; y: number }
}
export interface ElementGhostLayer {
  shapes: ElementGhostShape[]
  links: ElementGhostLink[]
}

/** An existing element as the editor holds it, for the ids the wire only names. */
export type ElementLookup = (id: string) => { shape: string; rect: ElementRect } | undefined

export const ELEMENT_GHOST_COLOR: Record<ElementGhostKind, string> = { added: '#3b82f6', moved: '#f59e0b', removed: '#ef4444' }

const round = (n: number) => Math.round(n * 1000) / 1000

function shapeOf(key: string, kind: ElementGhostKind, shape: string, r: ElementRect, label: string | null): ElementGhostShape {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return {
    key, kind, shape: shape === 'ellipse' ? 'ellipse' : 'rect',
    x: r.x, y: r.y, w: r.w, h: r.h, cx: round(cx), cy: round(cy),
    ...(r.rotation ? { transform: `rotate(${r.rotation} ${round(cx)} ${round(cy)})` } : {}),
    label,
  }
}

export function elementGhostLayer(el: ElementPreview, lookup?: ElementLookup): ElementGhostLayer {
  const shapes: ElementGhostShape[] = []
  const links: ElementGhostLink[] = []
  for (const a of el.added) shapes.push(shapeOf(`a:${a.tempId}`, 'added', a.shape, a.rect, a.label))
  for (const m of el.moved) {
    const s = shapeOf(`m:${m.id}`, 'moved', lookup?.(m.id)?.shape ?? 'rect', m.after, m.label)
    shapes.push(s)
    const from = { x: round(m.before.x + m.before.w / 2), y: round(m.before.y + m.before.h / 2) }
    if (Math.abs(from.x - s.cx) > 1e-3 || Math.abs(from.y - s.cy) > 1e-3) links.push({ key: `l:${m.id}`, from, to: { x: s.cx, y: s.cy } })
  }
  for (const r of el.removed) {
    const hit = lookup?.(r.id)
    if (hit) shapes.push(shapeOf(`r:${r.id}`, 'removed', hit.shape, hit.rect, r.label))
  }
  return { shapes, links }
}
