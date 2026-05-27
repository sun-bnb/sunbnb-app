'use client'

import { useMemo } from 'react'
import { SchematicRenderer } from '@repo/schematic/renderer'
import type { LayoutElementDTO, SchematicItem, ItemVisual } from '@repo/schematic/types'
import { restaurantPalette } from '../partner/restaurantPalette'

/** Decorative floor element (wall, bar, kitchen…) — re-exported so consumers
 *  don't need a direct @repo/schematic dependency. */
export type FloorMapElement = LayoutElementDTO

/** A floor-plan table as rendered to the consumer "pick your spot" map. */
export interface FloorMapTable {
  id: string
  label: string | null
  capacity: number
  shape: string
  width: number
  height: number
  schematicX: number | null
  schematicY: number | null
  rotation: number
  guestSelectable: boolean
  seatsTop: number | null
  seatsRight: number | null
  seatsBottom: number | null
  seatsLeft: number | null
}

export interface FloorMapPickerLabels {
  heading: string
  legendAvailable: string
  legendSelected: string
  legendUnavailable: string
}

export interface FloorMapPickerProps {
  world: { width: number; height: number }
  elements: FloorMapElement[]
  tables: FloorMapTable[]
  /** Table ids free for the chosen slot (from the availability API). */
  availableTableIds: string[]
  selectedTableId: string | null
  labels: FloorMapPickerLabels
  onSelect: (tableId: string) => void
}

const COLORS = {
  selectedFill: '#bbf7d0',
  selectedStroke: '#16a34a',
  pickableFill: '#dcfce7',
  pickableStroke: '#22c55e',
  mutedFill: '#e5e7eb',
  mutedStroke: '#9ca3af',
}

/**
 * Read-only floor map for guest table selection ("pick your spot"). Reuses the
 * shared SchematicRenderer in `view` mode: tables free for the slot AND flagged
 * guest-selectable are tappable/green; everything else renders muted and inert.
 * Tapping a pickable table calls `onSelect`.
 */
export function FloorMapPicker({
  world,
  elements,
  tables,
  availableTableIds,
  selectedTableId,
  labels,
  onSelect,
}: FloorMapPickerProps) {
  const availableSet = useMemo(() => new Set(availableTableIds), [availableTableIds])

  const items: SchematicItem[] = useMemo(
    () =>
      tables.map((t) => ({
        id: t.id,
        x: t.schematicX ?? 0,
        y: t.schematicY ?? 0,
        rotation: t.rotation ?? 0,
        status: 'active',
        label: t.label ?? String(t.capacity),
        width: t.width,
        height: t.height,
        shape: (t.shape as 'rect' | 'square' | 'round' | 'oval' | 'booth' | 'bar') ?? 'square',
        capacity: t.capacity,
        seatLayout: {
          top: t.seatsTop,
          right: t.seatsRight,
          bottom: t.seatsBottom,
          left: t.seatsLeft,
        },
      })),
    [tables],
  )

  const pickableSet = useMemo(
    () => new Set(tables.filter((t) => t.guestSelectable && availableSet.has(t.id)).map((t) => t.id)),
    [tables, availableSet],
  )

  const itemVisual = (item: SchematicItem): ItemVisual => {
    const isSelected = item.id === selectedTableId
    const pickable = pickableSet.has(item.id)
    return {
      fill: isSelected ? COLORS.selectedFill : pickable ? COLORS.pickableFill : COLORS.mutedFill,
      stroke: isSelected ? COLORS.selectedStroke : pickable ? COLORS.pickableStroke : COLORS.mutedStroke,
      label: item.label ?? undefined,
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {labels.heading}
      </h3>
      <div className="h-80 w-full overflow-hidden rounded-lg border border-gray-200">
        <SchematicRenderer
          world={world}
          paletteConfig={restaurantPalette}
          elements={elements}
          items={items}
          itemVisual={itemVisual}
          mode="view"
          selection={{ itemIds: selectedTableId ? [selectedTableId] : [] }}
          onItemClick={(id) => {
            if (pickableSet.has(id)) onSelect(id)
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500">
        <LegendSwatch fill={COLORS.pickableFill} stroke={COLORS.pickableStroke} label={labels.legendAvailable} />
        <LegendSwatch fill={COLORS.selectedFill} stroke={COLORS.selectedStroke} label={labels.legendSelected} />
        <LegendSwatch fill={COLORS.mutedFill} stroke={COLORS.mutedStroke} label={labels.legendUnavailable} />
      </div>
    </div>
  )
}

function LegendSwatch({ fill, stroke, label }: { fill: string; stroke: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-sm border"
        style={{ backgroundColor: fill, borderColor: stroke }}
      />
      {label}
    </span>
  )
}
