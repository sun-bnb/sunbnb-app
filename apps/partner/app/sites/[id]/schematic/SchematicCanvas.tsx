'use client'

import { useMemo } from 'react'
import { SchematicRenderer } from '@repo/schematic/renderer'
import type { LayoutElementDTO, SchematicItem, ItemVisual } from '@repo/schematic/types'
import { beachPalette } from './palette'
import { getParcelColor } from '../inventory/chair-util'
import type { InventoryItem, LayoutElementProps } from '@/types/shared'
import { formatSeatId } from '@repo/data/seat-label'
import type { GhostModel } from '@/components/assistant/geometry-preview'
import { ELEMENT_GHOST_COLOR, elementGhostLayer } from '@/components/assistant/layout-overlay'

interface Props {
  worldWidth: number
  worldHeight: number
  bgImageUrl?: string | null
  elements: LayoutElementProps[]
  items: InventoryItem[]
  selectedItemIds: string[]
  editingItemId?: string | null
  selectedElementId: string | null
  placementActive?: boolean
  highlightedGroup?: number | null
  /** Assistant proposal preview (track 030 S4b), schematic coordinates. */
  ghostModel?: GhostModel | null
  onItemClick: (id: string, mods: { metaKey: boolean; ctrlKey: boolean }) => void
  onItemDragEnd: (id: string, x: number, y: number) => void
  onItemDoubleClick: (id: string) => void
  onElementClick: (id: string) => void
  onElementDoubleClick: (id: string) => void
  onElementDragEnd: (id: string, x: number, y: number) => void
  onElementResizeEnd: (id: string, x: number, y: number, width: number, height: number) => void
  onBackgroundClick: (x: number, y: number) => void
  onElementDrop?: (type: string, x: number, y: number) => void
  onItemsRectSelect?: (
    ids: string[],
    mods: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  ) => void
}

function toElementDTO(el: LayoutElementProps): LayoutElementDTO {
  return {
    id: el.id,
    type: el.type,
    shape: (el.shape as 'rect' | 'ellipse' | 'icon') ?? 'rect',
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    z: el.z,
    label: el.label ?? null,
    color: el.color ?? null,
    cornerRadius: el.cornerRadius ?? null,
  }
}

function toSchematicItem(item: InventoryItem): SchematicItem {
  const numberLabel =
    item.number != null ? formatSeatId(item, { parcel: true }) : ''
  return {
    id: item.id,
    x: item.schematicX ?? 0,
    y: item.schematicY ?? 0,
    rotation: item.rotation ?? 0,
    status: item.status,
    label: item.label ?? numberLabel,
    group: item.group,
    // groupId drives BOTH the drag co-move and the isPaired highlight in
    // SchematicRenderer (all members of the same SunbedGroup are linked).
    groupId: item.sunbedGroupId ?? null,
  }
}

const GHOST_PREFIX = 'ghost:'
const isGhostId = (id: string) => id.startsWith(GHOST_PREFIX)
/** Status palette: blue = new, amber = moved there, red = removed, gray = moved from. */
const GHOST_COLOR = { added: '#3b82f6', moved: '#f59e0b', removed: '#ef4444', 'moved-from': '#9ca3af' } as const

export default function SchematicCanvas(props: Props) {
  const elements = props.elements.map(toElementDTO)
  const model = props.ghostModel?.mode === 'schematic' ? props.ghostModel : null

  // The renderer is a shared package with no ghost layer, so ghosts ride in as extra items:
  // proposed seats ('added' + the moved seats' NEW spot) are synthetic items, while removed /
  // moved-from seats tint the REAL item in place. Synthetic ids are filtered out of every
  // handler below, so ghosts can never be clicked, dragged or box-selected into an action.
  const { ghostItems, tint } = useMemo(() => {
    const ghostItems: SchematicItem[] = []
    const tint = new Map<string, keyof typeof GHOST_COLOR>()
    for (const g of model?.seats ?? []) {
      if (g.kind === 'added' || g.kind === 'moved') {
        ghostItems.push({ id: GHOST_PREFIX + g.key, x: g.at.x, y: g.at.y, rotation: g.rotation, label: g.label ?? null, status: g.kind })
        tint.set(GHOST_PREFIX + g.key, g.kind)
      } else if (g.itemId) {
        tint.set(g.itemId, g.kind)
      }
    }
    return { ghostItems, tint }
  }, [model])

  const items = [...props.items.map(toSchematicItem), ...ghostItems]
  const selectedItemIds = ghostItems.length
    ? [...props.selectedItemIds, ...ghostItems.map((g) => g.id)]
    : props.selectedItemIds

  // Layout-element ghosts (track 030 S4c): drawn by the renderer's overlay layer, in world metres,
  // pointer-events none. Removed / moved elements look up their current shape in `props.elements`.
  const elementLayer = useMemo(() => {
    if (!model || !(model.elements.added.length || model.elements.moved.length || model.elements.removed.length)) return null
    const byId = new Map(props.elements.map((e) => [e.id, e]))
    return elementGhostLayer(model.elements, (id) => {
      const e = byId.get(id)
      return e ? { shape: e.shape, rect: { x: e.x, y: e.y, w: e.width, h: e.height, rotation: e.rotation } } : undefined
    })
  }, [model, props.elements])

  function visualForItem(item: SchematicItem): ItemVisual {
    const kind = tint.get(item.id)
    if (kind) {
      return { fill: 'transparent', label: item.label ? String(item.label) : undefined, parcelColor: GHOST_COLOR[kind] }
    }
    const parcelColor = item.group ? getParcelColor(item.group) : undefined
    return {
      fill: 'transparent',
      label: item.label ? String(item.label) : undefined,
      parcelColor,
    }
  }

  return (
    <SchematicRenderer
      world={{ width: props.worldWidth, height: props.worldHeight }}
      bgImageUrl={props.bgImageUrl}
      paletteConfig={beachPalette}
      elements={elements}
      items={items}
      itemVisual={visualForItem}
      mode="edit"
      placementActive={props.placementActive}
      selection={{
        itemIds: selectedItemIds,
        editingItemId: props.editingItemId,
        elementId: props.selectedElementId,
      }}
      onItemClick={(id, mods) => !isGhostId(id) && props.onItemClick(id, mods)}
      onItemDragEnd={(id, x, y) => !isGhostId(id) && props.onItemDragEnd(id, x, y)}
      onItemDoubleClick={(id) => !isGhostId(id) && props.onItemDoubleClick(id)}
      onElementClick={props.onElementClick}
      onElementDoubleClick={props.onElementDoubleClick}
      onElementDragEnd={props.onElementDragEnd}
      onElementResizeEnd={props.onElementResizeEnd}
      onBackgroundClick={props.onBackgroundClick}
      onElementDrop={props.onElementDrop}
      overlay={
        elementLayer
          ? ({ worldPerPx }) => (
              <>
                {elementLayer.links.map((l) => (
                  <line
                    key={l.key} x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y}
                    stroke={ELEMENT_GHOST_COLOR.moved} strokeWidth={1.5 * worldPerPx}
                    strokeDasharray={`${3 * worldPerPx} ${3 * worldPerPx}`}
                  />
                ))}
                {elementLayer.shapes.map((g) => {
                  const color = ELEMENT_GHOST_COLOR[g.kind]
                  const common = { fill: color, fillOpacity: g.kind === 'removed' ? 0.18 : 0.14, stroke: color, strokeWidth: 2 * worldPerPx, strokeDasharray: g.kind === 'removed' ? undefined : `${5 * worldPerPx} ${3 * worldPerPx}` }
                  return (
                    <g key={g.key} transform={g.transform} data-ghost={g.kind}>
                      {g.shape === 'ellipse'
                        ? <ellipse cx={g.cx} cy={g.cy} rx={g.w / 2} ry={g.h / 2} {...common} />
                        : <rect x={g.x} y={g.y} width={g.w} height={g.h} {...common} />}
                      {g.kind === 'removed' && (
                        <>
                          <line x1={g.x} y1={g.y} x2={g.x + g.w} y2={g.y + g.h} stroke={color} strokeWidth={1.5 * worldPerPx} />
                          <line x1={g.x + g.w} y1={g.y} x2={g.x} y2={g.y + g.h} stroke={color} strokeWidth={1.5 * worldPerPx} />
                        </>
                      )}
                      {g.label && (
                        <text x={g.cx} y={g.cy} textAnchor="middle" dominantBaseline="middle" fontSize={11 * worldPerPx} fill={color} fontWeight={600}>
                          {g.label}
                        </text>
                      )}
                    </g>
                  )
                })}
              </>
            )
          : undefined
      }
      onItemsRectSelect={
        props.onItemsRectSelect
          ? (ids, mods) => props.onItemsRectSelect!(ids.filter((i) => !isGhostId(i)), mods)
          : undefined
      }
    />
  )
}
