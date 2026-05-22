'use client'

import { SCHEMATIC_DRAG_MIME } from '@repo/schematic/renderer'
import {
  RESTAURANT_SURFACE_TYPES,
  RESTAURANT_OBJECT_TYPES,
  RESTAURANT_ELEMENT_PRESETS,
  restaurantPalette,
} from './restaurantPalette'

export interface ElementPaletteLabels {
  surfacesHeading: string
  objectsHeading: string
  /** Keyed by palette type — e.g. `{ dining: 'Dining area', bar: 'Bar', … }`. */
  typeLabels: Record<string, string>
}

export interface ElementPaletteProps {
  labels: ElementPaletteLabels
}

/**
 * Drag source for restaurant LayoutElements. Each tile starts a native
 * HTML5 drag using the SCHEMATIC_DRAG_MIME the SchematicRenderer listens
 * for. Drop is handled by the parent via onElementDrop.
 */
export function ElementPalette({ labels }: ElementPaletteProps) {
  return (
    <div className="w-48 shrink-0 border-r border-gray-200 bg-white p-3 flex flex-col gap-4 overflow-y-auto">
      <Section
        heading={labels.surfacesHeading}
        types={RESTAURANT_SURFACE_TYPES as unknown as string[]}
        typeLabels={labels.typeLabels}
      />
      <Section
        heading={labels.objectsHeading}
        types={RESTAURANT_OBJECT_TYPES as unknown as string[]}
        typeLabels={labels.typeLabels}
      />
    </div>
  )
}

function Section({
  heading,
  types,
  typeLabels,
}: {
  heading: string
  types: string[]
  typeLabels: Record<string, string>
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{heading}</h4>
      <div className="flex flex-col gap-1.5">
        {types.map((type) => {
          const visual = restaurantPalette[type]
          return (
            <div
              key={type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(SCHEMATIC_DRAG_MIME, type)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-gray-300"
            >
              <span
                className={`inline-block h-4 w-4 border ${
                  RESTAURANT_ELEMENT_PRESETS[type]?.shape === 'ellipse' ? 'rounded-full' : 'rounded-sm'
                }`}
                style={{ backgroundColor: visual?.fill ?? '#e5e7eb', borderColor: visual?.stroke ?? '#9ca3af' }}
              />
              <span className="text-xs text-gray-700">{typeLabels[type] ?? type}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
