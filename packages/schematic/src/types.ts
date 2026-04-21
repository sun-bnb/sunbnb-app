import type { ComponentType } from 'react'

export interface WorldDims {
  width: number
  height: number
}

export interface LayoutElementDTO {
  id: string
  type: string
  shape: 'rect' | 'ellipse' | 'icon'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  z: number
  label?: string | null
  color?: string | null
  cornerRadius?: number | null
}

export interface SchematicItem {
  id: string
  x: number
  y: number
  rotation: number
  status?: string
  label?: string | null
  group?: number
  pairId?: string | null
}

export interface ElementVisualConfig {
  fill: string
  stroke?: string
  iconUrl?: string
  iconComponent?: ComponentType<{ size: number }>
  zBand: number
}

export type ElementPaletteConfig = Record<string, ElementVisualConfig>

export interface ItemVisual {
  fill: string
  stroke?: string
  label?: string
  sunbedImageUrl?: string
  towelImageUrl?: string
}
