import type { ElementPaletteConfig } from '@repo/schematic/types'

/**
 * Palette for restaurant layouts. Two bands (same look & feel as the beach
 * editor): **Areas** below (z-band 0, pan-through) and **Fixtures** on top
 * (z-band 5, direct drag). Brand-neutral so both the Sunbnb chiringuito
 * integration and the standalone tablefind app can use it unmodified.
 *
 * Areas are dining sections (indoor/outdoor/private + back-of-house); fixtures
 * are recognizable landmarks differentiated by shape/proportion, not just hue.
 */
export const restaurantPalette: ElementPaletteConfig = {
  // Areas — z-band 0, pan-through when unselected.
  dining: { fill: '#fef3c7', stroke: '#b45309', zBand: 0, passThrough: true }, // indoor dining
  terrace: { fill: '#d1fae5', stroke: '#047857', zBand: 0, passThrough: true }, // outdoor
  bar: { fill: '#fde68a', stroke: '#92400e', zBand: 0, passThrough: true },
  lounge: { fill: '#ede9fe', stroke: '#6d28d9', zBand: 0, passThrough: true },
  private: { fill: '#fce7f3', stroke: '#be185d', zBand: 0, passThrough: true }, // private room
  kitchen: { fill: '#e5e7eb', stroke: '#4b5563', zBand: 0, passThrough: true }, // back-of-house

  // Fixtures — z-band 5, direct drag. Distinguished by shape + proportion.
  entrance: { fill: '#99f6e4', stroke: '#0f766e', zBand: 5 }, // doorway (wide & thin)
  'bar-counter': { fill: '#fcd34d', stroke: '#92400e', zBand: 5 }, // long & thin
  'host-stand': { fill: '#a78bfa', stroke: '#5b21b6', zBand: 5 },
  restroom: { fill: '#cbd5e1', stroke: '#475569', zBand: 5 },
  wall: { fill: '#9ca3af', stroke: '#4b5563', zBand: 5 }, // long & thin divider
  pillar: { fill: '#9ca3af', stroke: '#4b5563', zBand: 5 }, // round column
  plant: { fill: '#86efac', stroke: '#15803d', zBand: 5 }, // round decor
}

export const RESTAURANT_SURFACE_TYPES = ['dining', 'terrace', 'bar', 'lounge', 'private', 'kitchen'] as const
export const RESTAURANT_OBJECT_TYPES = [
  'entrance',
  'bar-counter',
  'host-stand',
  'restroom',
  'wall',
  'pillar',
  'plant',
] as const

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
  // Areas
  dining: { type: 'dining', shape: 'rect', width: 10, height: 8 },
  terrace: { type: 'terrace', shape: 'rect', width: 8, height: 5 },
  bar: { type: 'bar', shape: 'rect', width: 6, height: 3 },
  lounge: { type: 'lounge', shape: 'rect', width: 6, height: 4 },
  private: { type: 'private', shape: 'rect', width: 6, height: 5 },
  kitchen: { type: 'kitchen', shape: 'rect', width: 6, height: 4 },
  // Fixtures — proportions encode meaning (long bar/wall, square restroom, round pillar/plant)
  entrance: { type: 'entrance', shape: 'rect', width: 1.6, height: 0.3 },
  'bar-counter': { type: 'bar-counter', shape: 'rect', width: 5, height: 0.8 },
  'host-stand': { type: 'host-stand', shape: 'rect', width: 1.2, height: 0.6 },
  restroom: { type: 'restroom', shape: 'rect', width: 1.8, height: 1.8 },
  wall: { type: 'wall', shape: 'rect', width: 4, height: 0.25 },
  pillar: { type: 'pillar', shape: 'ellipse', width: 0.6, height: 0.6 },
  plant: { type: 'plant', shape: 'ellipse', width: 0.9, height: 0.9 },
}
