import type { ElementPaletteConfig } from '@repo/schematic/types'

/**
 * Palette for restaurant layouts. Same shape as the beach palette in the
 * partner app (surfaces below, POIs on top); kept brand-neutral so both
 * the Sunbnb chiringuito integration and the standalone tablefind app
 * can use it without modification.
 */
export const restaurantPalette: ElementPaletteConfig = {
  // Base surfaces — z-band 0, pan-through when unselected.
  dining: { fill: '#fef3c7', stroke: '#b45309', zBand: 0, passThrough: true },
  bar: { fill: '#fde68a', stroke: '#92400e', zBand: 0, passThrough: true },
  kitchen: { fill: '#e5e7eb', stroke: '#4b5563', zBand: 0, passThrough: true },
  terrace: { fill: '#d1fae5', stroke: '#047857', zBand: 0, passThrough: true },
  lounge: { fill: '#ede9fe', stroke: '#6d28d9', zBand: 0, passThrough: true },

  // Objects on top of surfaces — z-band 5, direct drag.
  reception: { fill: '#a78bfa', stroke: '#5b21b6', zBand: 5 },
  restroom: { fill: '#cbd5e1', stroke: '#475569', zBand: 5 },
  stage: { fill: '#fbcfe8', stroke: '#9f1239', zBand: 5 },
}

export const RESTAURANT_SURFACE_TYPES = ['dining', 'bar', 'kitchen', 'terrace', 'lounge'] as const
export const RESTAURANT_OBJECT_TYPES = ['reception', 'restroom', 'stage'] as const

export type RestaurantSurfaceType = (typeof RESTAURANT_SURFACE_TYPES)[number]
export type RestaurantObjectType = (typeof RESTAURANT_OBJECT_TYPES)[number]

export interface RestaurantElementPreset {
  type: string
  shape: 'rect' | 'ellipse' | 'icon'
  width: number
  height: number
}

/** Default sizes (meters) + shapes for each element type. */
export const RESTAURANT_ELEMENT_PRESETS: Record<string, RestaurantElementPreset> = {
  dining: { type: 'dining', shape: 'rect', width: 10, height: 8 },
  bar: { type: 'bar', shape: 'rect', width: 5, height: 1.5 },
  kitchen: { type: 'kitchen', shape: 'rect', width: 6, height: 4 },
  terrace: { type: 'terrace', shape: 'rect', width: 8, height: 5 },
  lounge: { type: 'lounge', shape: 'rect', width: 6, height: 4 },
  reception: { type: 'reception', shape: 'rect', width: 2, height: 1 },
  restroom: { type: 'restroom', shape: 'rect', width: 2, height: 2 },
  stage: { type: 'stage', shape: 'rect', width: 4, height: 2 },
}
