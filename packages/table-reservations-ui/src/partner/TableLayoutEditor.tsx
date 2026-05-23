'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { SchematicRenderer } from '@repo/schematic/renderer'
import type { LayoutElementDTO, SchematicItem, ItemVisual } from '@repo/schematic/types'
import type { TableShape } from '@repo/schematic/grid'
import type {
  LayoutElementRecord,
  TableInput,
  TableRecord,
} from '@repo/table-reservations-core'
import {
  ElementPropertiesSidebar,
  type ElementPropertiesSidebarLabels,
  useEditorKeyboard,
  type SaveStatus,
} from '@repo/schematic-editor'
import { ElementPalette, type ElementPaletteLabels } from './ElementPalette'
import { TableForm, type TableFormLabels, type TableFormValues } from './TableForm'
import { restaurantPalette } from './restaurantPalette'

export interface TableLayoutEditorLabels {
  palette: ElementPaletteLabels
  tableForm: TableFormLabels
  elementSidebar: ElementPropertiesSidebarLabels
  addTable: string
  emptyHint: string
  bringForward: string
  sendBackward: string
  editElement: string
  editTable: string
  duplicateTable: string
  deleteElement: string
  deleteTable: string
  deselect: string
}

export interface TableLayoutEditorProps {
  worldWidth: number
  worldHeight: number
  tables: TableRecord[]
  elements: LayoutElementRecord[]
  labels: TableLayoutEditorLabels
  /** Optional — bubble CRUD save status up so the parent can drive a shared banner. */
  onSaveStatusChange?: (status: SaveStatus, errors?: string[]) => void
  /** Optional content rendered on the right of the toolbar (e.g. canvas dimensions). */
  toolbarRight?: ReactNode

  onTablePatch: (
    tableId: string,
    patch: Partial<TableInput>,
  ) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onTableDelete: (tableId: string) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onTableCreate: (at: { x: number; y: number }) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onTableDuplicate: (tableId: string) => Promise<{ status: 'ok' | 'error'; errors?: string[]; tableId?: string }>

  onElementCreate: (at: { x: number; y: number }, type: string) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onElementPatch: (
    elementId: string,
    patch: Partial<LayoutElementDTO>,
  ) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onElementDelete: (elementId: string) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

/**
 * Partner-side floor-plan editor. Mirrors the beach inventory editor's
 * interaction model: single click selects, a floating top-center toolbar
 * exposes bring forward/backward (elements), edit, delete and deselect, and
 * the right-side properties panel only opens when Edit is clicked (or the
 * item/element is double-clicked). Panels overlay the canvas.
 */
export function TableLayoutEditor(props: TableLayoutEditorProps) {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [propertiesOpenTableId, setPropertiesOpenTableId] = useState<string | null>(null)
  const [propertiesOpenElementId, setPropertiesOpenElementId] = useState<string | null>(null)
  const [placementMode, setPlacementMode] = useState<'none' | 'single'>('none')
  const [clipboardTableId, setClipboardTableId] = useState<string | null>(null)

  const selectedTable = useMemo(
    () => props.tables.find((t) => t.id === selectedTableId) ?? null,
    [selectedTableId, props.tables],
  )
  const selectedElement = useMemo(
    () => props.elements.find((e) => e.id === selectedElementId) ?? null,
    [selectedElementId, props.elements],
  )
  const propertiesTable = useMemo(
    () => props.tables.find((t) => t.id === propertiesOpenTableId) ?? null,
    [propertiesOpenTableId, props.tables],
  )
  const propertiesElement = useMemo(
    () => props.elements.find((e) => e.id === propertiesOpenElementId) ?? null,
    [propertiesOpenElementId, props.elements],
  )

  const reportStatus = (status: SaveStatus, errors?: string[]) => {
    props.onSaveStatusChange?.(status, errors)
  }

  const tracked = async <T,>(
    run: () => Promise<{ status: 'ok' | 'error'; errors?: string[] } & Partial<T>>,
  ) => {
    reportStatus('saving')
    const res = await run()
    if (res.status === 'ok') reportStatus('saved')
    else reportStatus('error', res.errors)
    return res
  }

  const clearSelection = () => {
    setSelectedTableId(null)
    setSelectedElementId(null)
    setPropertiesOpenTableId(null)
    setPropertiesOpenElementId(null)
  }

  const duplicateAndSelect = (sourceId: string) => {
    void tracked(() => props.onTableDuplicate(sourceId)).then((res) => {
      if (res.status === 'ok' && res.tableId) {
        setSelectedTableId(res.tableId)
        setSelectedElementId(null)
        setPropertiesOpenTableId(null)
        setPropertiesOpenElementId(null)
      }
    })
  }

  useEditorKeyboard({
    disabled: false,
    onEscape: () => {
      clearSelection()
      setPlacementMode('none')
    },
    onDelete: () => {
      if (selectedTableId) {
        void tracked(() => props.onTableDelete(selectedTableId)).then((res) => {
          if (res.status === 'ok') {
            setSelectedTableId(null)
            setPropertiesOpenTableId(null)
          }
        })
      } else if (selectedElementId) {
        void tracked(() => props.onElementDelete(selectedElementId)).then((res) => {
          if (res.status === 'ok') {
            setSelectedElementId(null)
            setPropertiesOpenElementId(null)
          }
        })
      }
    },
    onDuplicate: () => {
      if (selectedTableId) duplicateAndSelect(selectedTableId)
    },
    onCopy: () => {
      if (selectedTableId) setClipboardTableId(selectedTableId)
    },
    onPaste: () => {
      const source = clipboardTableId ?? selectedTableId
      if (source) duplicateAndSelect(source)
    },
  })

  const items: SchematicItem[] = useMemo(
    () =>
      props.tables.map((t) => ({
        id: t.id,
        x: t.schematicX ?? 0,
        y: t.schematicY ?? 0,
        rotation: t.rotation ?? 0,
        status: t.status,
        label: t.label ?? String(t.capacity),
        width: t.width,
        height: t.height,
        shape: (t.shape as
          | 'rect'
          | 'square'
          | 'round'
          | 'oval'
          | 'booth'
          | 'bar') ?? 'square',
        capacity: t.capacity,
        seatLayout: {
          top: t.seatsTop,
          right: t.seatsRight,
          bottom: t.seatsBottom,
          left: t.seatsLeft,
        },
      })),
    [props.tables],
  )

  const elementsDto: LayoutElementDTO[] = useMemo(
    () =>
      props.elements.map((e) => ({
        id: e.id,
        type: e.type,
        shape: (e.shape as 'rect' | 'ellipse' | 'icon') ?? 'rect',
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        rotation: e.rotation,
        z: e.z,
        label: e.label,
        color: e.color,
        cornerRadius: e.cornerRadius,
      })),
    [props.elements],
  )

  const itemVisual = (item: SchematicItem): ItemVisual => {
    const isSelected = item.id === selectedTableId
    return {
      fill: isSelected ? '#dbeafe' : '#fef3c7',
      stroke: isSelected ? '#2563eb' : '#b45309',
      label: item.label ?? undefined,
    }
  }

  const bumpElementZ = async (delta: number) => {
    if (!selectedElement) return
    await tracked(() => props.onElementPatch(selectedElement.id, { z: (selectedElement.z ?? 0) + delta }))
  }

  const showPropertiesPanel = !!(propertiesTable || (propertiesElement && !propertiesTable))

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPlacementMode(placementMode === 'single' ? 'none' : 'single')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              placementMode === 'single'
                ? 'bg-gray-900 text-white hover:bg-gray-700'
                : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M10 5a1 1 0 0 1 1 1v3h3a1 1 0 1 1 0 2h-3v3a1 1 0 1 1-2 0v-3H6a1 1 0 1 1 0-2h3V6a1 1 0 0 1 1-1Z" />
            </svg>
            {props.labels.addTable}
          </button>
          {placementMode === 'single' && (
            <span className="text-xs text-blue-600">{props.labels.emptyHint}</span>
          )}
        </div>
        {props.toolbarRight}
      </div>

      <div className="flex relative" style={{ height: 600 }}>
        <ElementPalette labels={props.labels.palette} />

        <div className="flex-1 relative bg-gray-100">
          {selectedElement && !selectedTable ? (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
              <div className="flex gap-1 bg-white/95 backdrop-blur border border-gray-200 rounded-md shadow-sm p-1">
                <button
                  type="button"
                  onClick={() => void bumpElementZ(1)}
                  title={props.labels.bringForward}
                  className="h-7 px-2 flex items-center text-xs text-gray-700 rounded hover:bg-gray-100 whitespace-nowrap"
                >
                  ↑ {props.labels.bringForward}
                </button>
                <button
                  type="button"
                  onClick={() => void bumpElementZ(-1)}
                  title={props.labels.sendBackward}
                  className="h-7 px-2 flex items-center text-xs text-gray-700 rounded hover:bg-gray-100 whitespace-nowrap"
                >
                  ↓ {props.labels.sendBackward}
                </button>
              </div>
              <div className="flex gap-1 bg-white/95 backdrop-blur border border-gray-200 rounded-md shadow-sm p-1">
                <button
                  type="button"
                  onClick={() => setPropertiesOpenElementId(selectedElement.id)}
                  title={props.labels.editElement}
                  className="w-7 h-7 flex items-center justify-center text-sm text-gray-700 rounded hover:bg-gray-100"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void tracked(() => props.onElementDelete(selectedElement.id)).then((res) => {
                      if (res.status === 'ok') {
                        setSelectedElementId(null)
                        setPropertiesOpenElementId(null)
                      }
                    })
                  }}
                  title={props.labels.deleteElement}
                  className="w-7 h-7 flex items-center justify-center text-sm text-red-600 rounded hover:bg-red-50"
                >
                  ✕
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedElementId(null)
                  setPropertiesOpenElementId(null)
                }}
                className="text-[11px] text-gray-500 hover:text-gray-700 underline px-1"
              >
                {props.labels.deselect}
              </button>
            </div>
          ) : null}

          {selectedTable ? (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
              <div className="flex gap-1 bg-white/95 backdrop-blur border border-gray-200 rounded-md shadow-sm p-1">
                <button
                  type="button"
                  onClick={() => setPropertiesOpenTableId(selectedTable.id)}
                  title={props.labels.editTable}
                  className="w-7 h-7 flex items-center justify-center text-sm text-gray-700 rounded hover:bg-gray-100"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => duplicateAndSelect(selectedTable.id)}
                  title={props.labels.duplicateTable}
                  className="w-7 h-7 flex items-center justify-center text-sm text-gray-700 rounded hover:bg-gray-100"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void tracked(() => props.onTableDelete(selectedTable.id)).then((res) => {
                      if (res.status === 'ok') {
                        setSelectedTableId(null)
                        setPropertiesOpenTableId(null)
                      }
                    })
                  }}
                  title={props.labels.deleteTable}
                  className="w-7 h-7 flex items-center justify-center text-sm text-red-600 rounded hover:bg-red-50"
                >
                  ✕
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedTableId(null)
                  setPropertiesOpenTableId(null)
                }}
                className="text-[11px] text-gray-500 hover:text-gray-700 underline px-1"
              >
                {props.labels.deselect}
              </button>
            </div>
          ) : null}

          <SchematicRenderer
            world={{ width: props.worldWidth, height: props.worldHeight }}
            paletteConfig={restaurantPalette}
            elements={elementsDto}
            items={items}
            itemVisual={itemVisual}
            mode="edit"
            placementActive={placementMode === 'single'}
            selection={{
              itemIds: selectedTableId ? [selectedTableId] : [],
              elementId: selectedElementId,
            }}
            onItemClick={(id) => {
              setSelectedTableId(id)
              setSelectedElementId(null)
              if (propertiesOpenTableId && propertiesOpenTableId !== id) {
                setPropertiesOpenTableId(null)
              }
              setPropertiesOpenElementId(null)
            }}
            onItemDoubleClick={(id) => {
              setSelectedTableId(id)
              setSelectedElementId(null)
              setPropertiesOpenTableId(id)
              setPropertiesOpenElementId(null)
            }}
            onItemDragEnd={(id, x, y) => {
              const t = props.tables.find((tab) => tab.id === id)
              if (t?.locked) return
              void tracked(() => props.onTablePatch(id, { schematicX: x, schematicY: y }))
            }}
            onElementClick={(id) => {
              setSelectedElementId(id)
              setSelectedTableId(null)
              if (propertiesOpenElementId && propertiesOpenElementId !== id) {
                setPropertiesOpenElementId(null)
              }
              setPropertiesOpenTableId(null)
            }}
            onElementDoubleClick={(id) => {
              setSelectedElementId(id)
              setSelectedTableId(null)
              setPropertiesOpenElementId(id)
              setPropertiesOpenTableId(null)
            }}
            onElementDragEnd={(id, x, y) => {
              void tracked(() => props.onElementPatch(id, { x, y }))
            }}
            onElementResizeEnd={(id, x, y, width, height) => {
              void tracked(() => props.onElementPatch(id, { x, y, width, height }))
            }}
            onBackgroundClick={(x, y) => {
              if (placementMode === 'single') {
                void tracked(() => props.onTableCreate({ x, y })).then(() =>
                  setPlacementMode('none'),
                )
              } else {
                clearSelection()
              }
            }}
            onElementDrop={(type, x, y) => {
              void tracked(() => props.onElementCreate({ x, y }, type))
            }}
          />

          {showPropertiesPanel ? (
            <div className="absolute right-0 top-0 bottom-0 w-80 border-l border-gray-200 bg-white overflow-y-auto shadow-lg z-10">
              {propertiesTable ? (
                <TableForm
                  key={propertiesTable.id}
                  labels={props.labels.tableForm}
                  initial={toFormValues(propertiesTable)}
                  onChange={(patch) => tracked(() => props.onTablePatch(propertiesTable.id, patch))}
                  onDelete={async () => {
                    const res = await tracked(() => props.onTableDelete(propertiesTable.id))
                    if (res.status === 'ok') {
                      setPropertiesOpenTableId(null)
                      setSelectedTableId(null)
                    }
                    return res
                  }}
                  onClose={() => setPropertiesOpenTableId(null)}
                />
              ) : propertiesElement ? (
                <ElementPropertiesSidebar
                  key={propertiesElement.id}
                  labels={props.labels.elementSidebar}
                  element={{
                    id: propertiesElement.id,
                    type: propertiesElement.type,
                    shape: (propertiesElement.shape as 'rect' | 'ellipse' | 'icon') ?? 'rect',
                    x: propertiesElement.x,
                    y: propertiesElement.y,
                    width: propertiesElement.width,
                    height: propertiesElement.height,
                    rotation: propertiesElement.rotation,
                    z: propertiesElement.z,
                    label: propertiesElement.label,
                    color: propertiesElement.color,
                    cornerRadius: propertiesElement.cornerRadius,
                  }}
                  onChange={(patch) => tracked(() => props.onElementPatch(propertiesElement.id, patch))}
                  onDelete={async () => {
                    const res = await tracked(() => props.onElementDelete(propertiesElement.id))
                    if (res.status === 'ok') {
                      setPropertiesOpenElementId(null)
                      setSelectedElementId(null)
                    }
                    return res
                  }}
                  onClose={() => setPropertiesOpenElementId(null)}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function toFormValues(t: TableRecord): TableFormValues {
  return {
    id: t.id,
    number: t.number,
    label: t.label ?? '',
    capacity: t.capacity,
    minPartySize: t.minPartySize,
    maxPartySize: t.maxPartySize ?? null,
    shape: (t.shape as TableShape) ?? 'square',
    width: t.width,
    height: t.height,
    rotation: t.rotation,
    zone: t.zone ?? '',
    staffNote: t.staffNote ?? '',
    onlineBookable: t.onlineBookable,
    combinable: t.combinable,
    features: t.features ?? [],
    requiresDeposit: t.requiresDeposit ?? null,
    depositPerGuest: t.depositPerGuest ?? null,
    turnTimeMinutes: t.turnTimeMinutes ?? null,
    locked: t.locked,
    seatsTop: t.seatsTop,
    seatsRight: t.seatsRight,
    seatsBottom: t.seatsBottom,
    seatsLeft: t.seatsLeft,
  }
}
