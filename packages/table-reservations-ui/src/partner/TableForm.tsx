'use client'

import { useEffect, useRef, useState } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import CloseIcon from '@mui/icons-material/Close'
import RotateLeftIcon from '@mui/icons-material/RotateLeft'
import RotateRightIcon from '@mui/icons-material/RotateRight'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import type { TableInput } from '@repo/table-reservations-core'

export type TableFormShape = 'square' | 'round' | 'rect' | 'oval' | 'booth' | 'bar'

export interface TableFormLabels {
  heading: string
  number: string
  label: string
  capacity: string
  minPartySize: string
  maxPartySize: string
  shape: string
  shapeSquare: string
  shapeRound: string
  shapeRect: string
  shapeOval: string
  shapeBooth: string
  shapeBar: string
  width: string
  height: string
  rotate: string
  zone: string
  staffNote: string
  onlineBookable: string
  turnTimeMinutes: string
  inheritsFromRestaurant: string
  locked: string
  seatLayoutHeading: string
  seatTop: string
  seatRight: string
  seatBottom: string
  seatLeft: string
  seatLayoutAuto: string
  seatLayoutResetAuto: string
  seatLayoutSumMismatch: string
  deleteTable: string
  close?: string
}

export interface TableFormValues {
  id: string
  number: number
  label: string
  capacity: number
  minPartySize: number
  maxPartySize: number | null
  shape: TableFormShape
  width: number
  height: number
  rotation: number
  zone: string
  staffNote: string
  onlineBookable: boolean
  turnTimeMinutes: number | null
  locked: boolean
  seatsTop: number | null
  seatsRight: number | null
  seatsBottom: number | null
  seatsLeft: number | null
}

export interface TableFormProps {
  initial: TableFormValues
  labels: TableFormLabels
  onChange: (patch: Partial<TableInput>) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onDelete: () => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onClose?: () => void
}

/**
 * Sidebar form for editing a single table. Auto-saves on field change
 * (debounced 800ms). Rotate buttons and toggles commit immediately.
 */
export function TableForm({ initial, labels, onChange, onDelete, onClose }: TableFormProps) {
  const [values, setValues] = useState<TableFormValues>(initial)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setValues(initial), [initial.id, initial])

  const save = (patch: Partial<TableInput>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void onChange(patch), 800)
  }
  const saveNow = (patch: Partial<TableInput>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    void onChange(patch)
  }

  const rotate = (delta: number) => {
    const next = Math.round(((values.rotation + delta) % 360 + 360) % 360)
    setValues((s) => ({ ...s, rotation: next }))
    saveNow({ rotation: next })
  }

  return (
    <div className="flex flex-col gap-3 p-4 border-l border-gray-200 bg-white w-72 shrink-0 h-full overflow-y-auto">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          {labels.heading} #{values.number}
        </h3>
        {onClose && (
          <Tooltip title={labels.close ?? 'Close'}>
            <IconButton size="small" onClick={onClose} sx={{ mt: -0.5, mr: -0.5 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </div>
      <TextField
        size="small"
        label={labels.number}
        type="number"
        value={values.number}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isFinite(n)) return
          setValues((s) => ({ ...s, number: n }))
          save({ number: n })
        }}
        inputProps={{ min: 1, max: 9999 }}
      />
      <TextField
        size="small"
        label={labels.label}
        value={values.label}
        onChange={(e) => {
          const v = e.target.value
          setValues((s) => ({ ...s, label: v }))
          save({ label: v || null })
        }}
      />
      <TextField
        size="small"
        label={labels.capacity}
        type="number"
        value={values.capacity}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isFinite(n)) return
          setValues((s) => ({ ...s, capacity: n }))
          save({ capacity: n })
        }}
        inputProps={{ min: 1, max: 50 }}
      />
      <div className="flex gap-2">
        <TextField
          size="small"
          label={labels.minPartySize}
          type="number"
          value={values.minPartySize}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            setValues((s) => ({ ...s, minPartySize: n }))
            save({ minPartySize: n })
          }}
          inputProps={{ min: 1, max: 50 }}
          fullWidth
        />
        <TextField
          size="small"
          label={labels.maxPartySize}
          type="number"
          value={values.maxPartySize ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            const n = raw === '' ? null : Number(raw)
            if (n !== null && !Number.isFinite(n)) return
            setValues((s) => ({ ...s, maxPartySize: n }))
            save({ maxPartySize: n })
          }}
          inputProps={{ min: 1, max: 50 }}
          fullWidth
        />
      </div>
      <TextField
        select
        size="small"
        label={labels.shape}
        value={values.shape}
        onChange={(e) => {
          const v = e.target.value as TableFormShape
          setValues((s) => ({ ...s, shape: v }))
          saveNow({ shape: v })
        }}
      >
        <MenuItem value="square">{labels.shapeSquare}</MenuItem>
        <MenuItem value="round">{labels.shapeRound}</MenuItem>
        <MenuItem value="rect">{labels.shapeRect}</MenuItem>
        <MenuItem value="oval">{labels.shapeOval}</MenuItem>
        <MenuItem value="booth">{labels.shapeBooth}</MenuItem>
        <MenuItem value="bar">{labels.shapeBar}</MenuItem>
      </TextField>

      <div className="flex gap-2">
        <TextField
          size="small"
          label={labels.width}
          type="number"
          value={values.width}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n) || n <= 0) return
            setValues((s) => ({ ...s, width: n }))
            save({ width: n })
          }}
          inputProps={{ min: 0.3, max: 10, step: 0.1 }}
          fullWidth
        />
        <TextField
          size="small"
          label={labels.height}
          type="number"
          value={values.height}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n) || n <= 0) return
            setValues((s) => ({ ...s, height: n }))
            save({ height: n })
          }}
          inputProps={{ min: 0.3, max: 10, step: 0.1 }}
          fullWidth
        />
      </div>

      {(values.shape === 'square' || values.shape === 'rect' || values.shape === 'booth') && (
        <SeatLayoutEditor
          values={values}
          labels={labels}
          onPatch={(patch) => {
            setValues((s) => ({ ...s, ...patch }))
            save(patch)
          }}
        />
      )}

      <TextField
        size="small"
        label={labels.zone}
        value={values.zone}
        onChange={(e) => {
          const v = e.target.value
          setValues((s) => ({ ...s, zone: v }))
          save({ zone: v || null })
        }}
        inputProps={{ maxLength: 50 }}
      />

      <TextField
        size="small"
        label={labels.turnTimeMinutes}
        type="number"
        value={values.turnTimeMinutes ?? ''}
        placeholder={labels.inheritsFromRestaurant}
        onChange={(e) => {
          const raw = e.target.value
          const n = raw === '' ? null : Number(raw)
          if (n !== null && !Number.isFinite(n)) return
          setValues((s) => ({ ...s, turnTimeMinutes: n }))
          save({ turnTimeMinutes: n })
        }}
        inputProps={{ min: 15, max: 600, step: 15 }}
      />

      <TextField
        size="small"
        label={labels.staffNote}
        multiline
        minRows={2}
        maxRows={4}
        value={values.staffNote}
        onChange={(e) => {
          const v = e.target.value
          setValues((s) => ({ ...s, staffNote: v }))
          save({ staffNote: v || null })
        }}
        inputProps={{ maxLength: 500 }}
      />

      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={values.onlineBookable}
            onChange={(_, checked) => {
              setValues((s) => ({ ...s, onlineBookable: checked }))
              saveNow({ onlineBookable: checked })
            }}
          />
        }
        label={<span className="text-xs text-gray-700">{labels.onlineBookable}</span>}
      />

      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={values.locked}
            onChange={(_, checked) => {
              setValues((s) => ({ ...s, locked: checked }))
              saveNow({ locked: checked })
            }}
          />
        }
        label={<span className="text-xs text-gray-700">{labels.locked}</span>}
      />

      <div className="flex items-center gap-1 mt-1">
        <Tooltip title={labels.rotate}>
          <IconButton size="small" onClick={() => rotate(-15)}>
            <RotateLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={labels.rotate}>
          <IconButton size="small" onClick={() => rotate(15)}>
            <RotateRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <span className="text-xs text-gray-500 ml-1">{values.rotation}°</span>
        <div className="ml-auto">
          <Tooltip title={labels.deleteTable}>
            <IconButton size="small" color="error" onClick={() => void onDelete()}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

interface SeatLayoutEditorProps {
  values: TableFormValues
  labels: TableFormLabels
  onPatch: (patch: Partial<TableFormValues> & Partial<TableInput>) => void
}

/**
 * Per-side chair-count override. When all four are null, chairs auto-distribute
 * by capacity. Setting any side flips the table to override mode; resetting
 * any side to empty/null re-enables auto-distribution if all four go null.
 */
function SeatLayoutEditor({ values, labels, onPatch }: SeatLayoutEditorProps) {
  const isOverride =
    values.seatsTop != null ||
    values.seatsRight != null ||
    values.seatsBottom != null ||
    values.seatsLeft != null
  const sum = isOverride
    ? (values.seatsTop ?? 0) +
      (values.seatsRight ?? 0) +
      (values.seatsBottom ?? 0) +
      (values.seatsLeft ?? 0)
    : 0
  const mismatch = isOverride && sum !== values.capacity

  const fieldFor = (key: 'seatsTop' | 'seatsRight' | 'seatsBottom' | 'seatsLeft', label: string) => (
    <TextField
      key={key}
      size="small"
      label={label}
      type="number"
      value={values[key] ?? ''}
      placeholder={isOverride ? '0' : labels.seatLayoutAuto}
      onChange={(e) => {
        const raw = e.target.value
        const n = raw === '' ? null : Number(raw)
        if (n !== null && !Number.isFinite(n)) return
        onPatch({ [key]: n } as Partial<TableFormValues> & Partial<TableInput>)
      }}
      inputProps={{ min: 0, max: 50 }}
      fullWidth
    />
  )

  return (
    <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">{labels.seatLayoutHeading}</span>
        {isOverride && (
          <button
            type="button"
            className="text-[11px] text-gray-500 hover:text-gray-700 underline"
            onClick={() =>
              onPatch({
                seatsTop: null,
                seatsRight: null,
                seatsBottom: null,
                seatsLeft: null,
              })
            }
          >
            {labels.seatLayoutResetAuto}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fieldFor('seatsTop', labels.seatTop)}
        {fieldFor('seatsRight', labels.seatRight)}
        {fieldFor('seatsBottom', labels.seatBottom)}
        {fieldFor('seatsLeft', labels.seatLeft)}
      </div>
      {mismatch && (
        <span className="text-[11px] text-amber-600">
          {labels.seatLayoutSumMismatch.replace('{sum}', String(sum)).replace('{capacity}', String(values.capacity))}
        </span>
      )}
    </div>
  )
}
