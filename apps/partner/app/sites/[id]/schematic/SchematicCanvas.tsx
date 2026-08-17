'use client'

import { SchematicRenderer } from '@repo/schematic/renderer'
import type { LayoutElementDTO, SchematicItem, ItemVisual } from '@repo/schematic/types'
import { beachPalette } from './palette'
import { getParcelColor } from '../inventory/chair-util'
import type { InventoryItem, LayoutElementProps } from '@/types/shared'
import { formatSeatId } from '@repo/data/seat-label'

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

export default function SchematicCanvas(props: Props) {
  const elements = props.elements.map(toElementDTO)
  const items = props.items.map(toSchematicItem)

  function visualForItem(item: SchematicItem): ItemVisual {
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
        itemIds: props.selectedItemIds,
        editingItemId: props.editingItemId,
        elementId: props.selectedElementId,
      }}
      onItemClick={props.onItemClick}
      onItemDragEnd={props.onItemDragEnd}
      onItemDoubleClick={props.onItemDoubleClick}
      onElementClick={props.onElementClick}
      onElementDoubleClick={props.onElementDoubleClick}
      onElementDragEnd={props.onElementDragEnd}
      onElementResizeEnd={props.onElementResizeEnd}
      onBackgroundClick={props.onBackgroundClick}
      onElementDrop={props.onElementDrop}
      onItemsRectSelect={props.onItemsRectSelect}
    />
  )
}
