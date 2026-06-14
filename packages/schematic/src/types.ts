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
  /**
   * Generic co-move group identifier. Items sharing the same non-null groupId
   * move together when any member is dragged (outside of a multi-selection).
   * The renderer is domain-agnostic here — for sunbeds this is populated from
   * `SunbedGroup.id`; tables never set it, making this field a no-op for them.
   */
  groupId?: string | null
  /**
   * Physical footprint in world units (metres). When absent, the renderer
   * falls back to the sunbed defaults (0.84 × 2.1) so the beach flow is
   * unchanged. Tables always set these explicitly.
   */
  width?: number
  height?: number
  /**
   * Visual shape hint. Defaults to 'rect' (sunbed-like rounded rectangle).
   * 'round' / 'oval' render as an ellipse; 'booth' adds a banquette accent
   * along one long side; 'bar' is a small rounded square. 'square' / 'rect'
   * render as plain rounded rects.
   */
  shape?: 'rect' | 'square' | 'round' | 'oval' | 'booth' | 'bar'
  /**
   * Decorative chair count rendered around the table. When set (and the item
   * is not a sunbed), the renderer draws chair glyphs on the table's
   * perimeter according to its `shape`. The beach flow leaves this undefined.
   */
  capacity?: number
  /**
   * Optional per-side chair-count override. When any side is non-null the
   * renderer skips auto-distribution and uses these counts directly.
   */
  seatLayout?: {
    top?: number | null
    right?: number | null
    bottom?: number | null
    left?: number | null
  }
}

export interface ElementVisualConfig {
  fill: string
  stroke?: string
  iconUrl?: string
  iconComponent?: ComponentType<{ size: number }>
  zBand: number
  // If true, unselected element does not intercept drag-to-pan. A plain click
  // still selects it; once selected, drag moves it normally.
  passThrough?: boolean
}

export type ElementPaletteConfig = Record<string, ElementVisualConfig>

export interface ItemVisual {
  fill: string
  stroke?: string
  label?: string
  sunbedImageUrl?: string
  towelImageUrl?: string
  parcelColor?: string
}
