'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  /** Smallest party the partner allows on this table (default 1). */
  minPartySize: number
  /** Optional cap below `capacity` (null = no extra cap). */
  maxPartySize: number | null
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
  /** Shown when the guest taps a table the partner didn't flag as selectable. */
  reasonNotSelectable: string
  /** Shown when the party exceeds the table's effective capacity (or maxPartySize).
   *  `capacity` is the effective max — `maxPartySize ?? table.capacity`. */
  reasonTooSmall: (args: { capacity: number; partySize: number }) => string
  /** Shown when the party is below the table's minPartySize — surfacing
   *  "you're too small a group for this big table". */
  reasonTooBig: (args: { minPartySize: number; partySize: number }) => string
  /** Shown when the table is selectable + size-fits but isn't free at this slot. */
  reasonUnavailable: string
}

export interface FloorMapPickerProps {
  world: { width: number; height: number }
  elements: FloorMapElement[]
  tables: FloorMapTable[]
  /** Table ids free for the chosen slot (from the availability API). */
  availableTableIds: string[]
  selectedTableId: string | null
  /** Optional — when supplied, the "too small" reason can be surfaced specifically. */
  partySize?: number
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

const FLASH_DURATION_MS = 2800

/**
 * Read-only floor map for guest table selection ("pick your spot"). Reuses the
 * shared SchematicRenderer in `view` mode. Tables free for the slot AND flagged
 * guest-selectable render tappable/green; everything else is drawn with the
 * renderer's `status: "disabled"` visual (red diagonal) and, when tapped,
 * flashes a short banner explaining why it can't be booked.
 */
export function FloorMapPicker({
  world,
  elements,
  tables,
  availableTableIds,
  selectedTableId,
  partySize,
  labels,
  onSelect,
}: FloorMapPickerProps) {
  const availableSet = useMemo(() => new Set(availableTableIds), [availableTableIds])

  const pickableSet = useMemo(
    () => new Set(tables.filter((t) => t.guestSelectable && availableSet.has(t.id)).map((t) => t.id)),
    [tables, availableSet],
  )

  // SchematicRenderer draws a red diagonal for items with status: "disabled" —
  // exactly the "inactive" affordance we want for non-pickable tables.
  const items: SchematicItem[] = useMemo(
    () =>
      tables.map((t) => ({
        id: t.id,
        x: t.schematicX ?? 0,
        y: t.schematicY ?? 0,
        rotation: t.rotation ?? 0,
        status: pickableSet.has(t.id) ? 'active' : 'disabled',
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
    [tables, pickableSet],
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

  // ── Flash banner ────────────────────────────────────────────────────────────
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])
  const showFlash = (message: string) => {
    setFlash(message)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlash(null), FLASH_DURATION_MS)
  }

  const reasonFor = (table: FloorMapTable): string => {
    if (!table.guestSelectable) return labels.reasonNotSelectable
    if (partySize !== undefined) {
      // Effective max is maxPartySize if set, else physical capacity.
      const effectiveMax = table.maxPartySize ?? table.capacity
      if (partySize > effectiveMax) {
        return labels.reasonTooSmall({ capacity: effectiveMax, partySize })
      }
      if (partySize < table.minPartySize) {
        return labels.reasonTooBig({ minPartySize: table.minPartySize, partySize })
      }
    }
    return labels.reasonUnavailable
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {labels.heading}
      </h3>
      <div className="relative h-80 w-full overflow-hidden rounded-lg border border-gray-200">
        <SchematicRenderer
          world={world}
          paletteConfig={restaurantPalette}
          elements={elements}
          items={items}
          itemVisual={itemVisual}
          mode="view"
          selection={{ itemIds: selectedTableId ? [selectedTableId] : [] }}
          onItemClick={(id) => {
            if (pickableSet.has(id)) {
              onSelect(id)
              return
            }
            const table = tables.find((t) => t.id === id)
            if (table) showFlash(reasonFor(table))
          }}
        />
        {flash ? (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-1/2 top-2 max-w-[90%] -translate-x-1/2 rounded-lg bg-gray-900/90 px-3 py-2 text-center text-xs font-medium text-white shadow-lg"
          >
            {flash}
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500">
        <LegendSwatch fill={COLORS.pickableFill} stroke={COLORS.pickableStroke} label={labels.legendAvailable} />
        <LegendSwatch fill={COLORS.selectedFill} stroke={COLORS.selectedStroke} label={labels.legendSelected} />
        <LegendSwatch fill={COLORS.mutedFill} stroke={COLORS.mutedStroke} label={labels.legendUnavailable} crossed />
      </div>
    </div>
  )
}

function LegendSwatch({
  fill,
  stroke,
  label,
  crossed,
}: {
  fill: string
  stroke: string
  label: string
  crossed?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="relative inline-block h-3 w-3 rounded-sm border"
        style={{ backgroundColor: fill, borderColor: stroke }}
      >
        {crossed ? (
          <svg
            viewBox="0 0 12 12"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            <line x1="2" y1="2" x2="10" y2="10" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : null}
      </span>
      {label}
    </span>
  )
}
