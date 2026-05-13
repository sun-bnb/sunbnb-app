'use client'

import { useEffect, useRef, useState } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import type { LayoutElementDTO } from '@repo/schematic/types'

export interface ElementPropertiesSidebarLabels {
  heading: string
  elementType: string
  label: string
  width: string
  height: string
  rotation: string
  shape: string
  shapeRect: string
  shapeEllipse: string
  cornerRadius: string
  colorOverride: string
  bringForward: string
  sendBackward: string
  deleteElement: string
  /** Optional label for the close (×) button. Defaults to 'Close' when omitted. */
  close?: string
  /** Optional overrides for type labels keyed by the palette's type strings. */
  typeLabels?: Record<string, string>
}

export interface ElementPropertiesSidebarProps {
  /** The element currently selected. */
  element: LayoutElementDTO
  labels: ElementPropertiesSidebarLabels
  /** Debounce delay for text/number fields before onChange fires. Defaults 800ms. */
  debounceMs?: number
  onChange: (
    patch: Partial<LayoutElementDTO>,
  ) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onDelete: () => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  /** Called when the user clicks the close (×) button. */
  onClose?: () => void
  /** Accessible label for the close button. */
  closeLabel?: string
}

/**
 * Sidebar panel that lets the partner edit an element's label, size, rotation,
 * shape, corner radius, colour override, and z-layer. Same shape both the
 * beach and restaurant editors need, minus any palette-specific semantics.
 */
export function ElementPropertiesSidebar({
  element,
  labels,
  debounceMs = 800,
  onChange,
  onDelete,
  onClose,
  closeLabel,
}: ElementPropertiesSidebarProps) {
  const [label, setLabel] = useState(element.label ?? '')
  const [width, setWidth] = useState(element.width)
  const [height, setHeight] = useState(element.height)
  const [rotation, setRotation] = useState(element.rotation)
  const [shape, setShape] = useState(element.shape)
  const [cornerRadius, setCornerRadius] = useState(element.cornerRadius ?? 0)
  const [color, setColor] = useState(element.color ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLabel(element.label ?? '')
    setWidth(element.width)
    setHeight(element.height)
    setRotation(element.rotation)
    setShape(element.shape)
    setCornerRadius(element.cornerRadius ?? 0)
    setColor(element.color ?? '')
  }, [element.id, element])

  const save = (patch: Partial<LayoutElementDTO>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void onChange(patch), debounceMs)
  }
  const saveNow = (patch: Partial<LayoutElementDTO>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    void onChange(patch)
  }

  const typeDisplay = labels.typeLabels?.[element.type] ?? element.type

  return (
    <div className="flex flex-col gap-3 p-4 border-l border-gray-200 bg-white w-72 shrink-0 h-full overflow-y-auto">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700">{labels.heading}</h3>
          <div className="text-xs text-gray-500">
            {labels.elementType}: <span className="text-gray-700">{typeDisplay}</span>
          </div>
        </div>
        {onClose && (
          <Tooltip title={labels.close ?? closeLabel ?? 'Close'}>
            <IconButton size="small" onClick={onClose} sx={{ mt: -0.5, mr: -0.5 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </div>

      <TextField
        size="small"
        label={labels.label}
        value={label}
        onChange={(e) => {
          setLabel(e.target.value)
          save({ label: e.target.value || null })
        }}
      />

      <TextField
        select
        size="small"
        label={labels.shape}
        value={shape}
        onChange={(e) => {
          const s = e.target.value as 'rect' | 'ellipse' | 'icon'
          setShape(s)
          saveNow({ shape: s })
        }}
      >
        <MenuItem value="rect">{labels.shapeRect}</MenuItem>
        <MenuItem value="ellipse">{labels.shapeEllipse}</MenuItem>
      </TextField>

      <div className="flex gap-2">
        <TextField
          size="small"
          label={labels.width}
          type="number"
          value={width}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n) || n <= 0) return
            setWidth(n)
            save({ width: n })
          }}
          inputProps={{ min: 0.1, step: 0.1 }}
          fullWidth
        />
        <TextField
          size="small"
          label={labels.height}
          type="number"
          value={height}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n) || n <= 0) return
            setHeight(n)
            save({ height: n })
          }}
          inputProps={{ min: 0.1, step: 0.1 }}
          fullWidth
        />
      </div>

      <TextField
        size="small"
        label={labels.rotation}
        type="number"
        value={rotation}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isFinite(n)) return
          setRotation(n)
          save({ rotation: n })
        }}
        inputProps={{ min: -360, max: 360, step: 5 }}
      />

      {shape === 'rect' && (
        <TextField
          size="small"
          label={labels.cornerRadius}
          type="number"
          value={cornerRadius}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n) || n < 0) return
            setCornerRadius(n)
            save({ cornerRadius: n })
          }}
          inputProps={{ min: 0, step: 0.1 }}
        />
      )}

      <TextField
        size="small"
        label={labels.colorOverride}
        value={color}
        placeholder="#rrggbb"
        onChange={(e) => {
          const v = e.target.value
          setColor(v)
          save({ color: v || null })
        }}
      />

      <div className="flex items-center gap-1 mt-1">
        <Tooltip title={labels.bringForward}>
          <IconButton size="small" onClick={() => saveNow({ z: (element.z ?? 0) + 1 })}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={labels.sendBackward}>
          <IconButton size="small" onClick={() => saveNow({ z: (element.z ?? 0) - 1 })}>
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <div className="ml-auto">
          <Tooltip title={labels.deleteElement}>
            <IconButton size="small" color="error" onClick={() => void onDelete()}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
