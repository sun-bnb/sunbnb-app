import type { ElementPaletteConfig } from '@repo/schematic/types'

export const beachPalette: ElementPaletteConfig = {
  // Base surfaces — z-band 0, pan-through when unselected
  water: { fill: '#7dd3fc', stroke: '#0284c7', zBand: 0, passThrough: true },
  sand: { fill: '#fde68a', stroke: '#f59e0b', zBand: 0, passThrough: true },
  grass: { fill: '#86efac', stroke: '#16a34a', zBand: 0, passThrough: true },
  deck: { fill: '#d6d3d1', stroke: '#78716c', zBand: 0, passThrough: true },
  pool: { fill: '#38bdf8', stroke: '#0369a1', zBand: 0, passThrough: true },

  // Objects on top of surfaces — z-band 5, direct drag
  bar: { fill: '#fbbf24', stroke: '#92400e', zBand: 5 },
  reception: { fill: '#a78bfa', stroke: '#5b21b6', zBand: 5 },
  shower: { fill: '#67e8f9', stroke: '#0e7490', zBand: 5 },
  restroom: { fill: '#cbd5e1', stroke: '#475569', zBand: 5 },
}

export type SurfaceType = 'water' | 'sand' | 'grass' | 'deck'
export type ObjectType = 'pool' | 'bar' | 'reception' | 'shower' | 'restroom'

export const SURFACE_TYPES: SurfaceType[] = ['water', 'sand', 'grass', 'deck']
export const OBJECT_TYPES: ObjectType[] = ['pool', 'bar', 'reception', 'shower', 'restroom']

export interface ElementPreset {
  type: string
  shape: 'rect' | 'ellipse' | 'icon'
  width: number
  height: number
}

export const ELEMENT_PRESETS: Record<string, ElementPreset> = {
  water: { type: 'water', shape: 'rect', width: 20, height: 8 },
  sand: { type: 'sand', shape: 'rect', width: 15, height: 10 },
  grass: { type: 'grass', shape: 'rect', width: 12, height: 8 },
  deck: { type: 'deck', shape: 'rect', width: 10, height: 6 },
  pool: { type: 'pool', shape: 'ellipse', width: 12, height: 6 },
  bar: { type: 'bar', shape: 'rect', width: 4, height: 2 },
  reception: { type: 'reception', shape: 'rect', width: 3, height: 2 },
  shower: { type: 'shower', shape: 'ellipse', width: 1.5, height: 1.5 },
  restroom: { type: 'restroom', shape: 'rect', width: 3, height: 2 },
}
