'use client'

import { useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import type { RestaurantHoursInput } from '@repo/table-reservations-core'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface RestaurantHoursEditorLabels {
  heading: string
  closed: string
  openAbbr: string
  closeAbbr: string
  save: string
  saving: string
  /** 7 day names starting from Sunday */
  dayNames: readonly [string, string, string, string, string, string, string]
}

export interface RestaurantHoursEditorProps {
  initial: RestaurantHoursInput[]
  labels: RestaurantHoursEditorLabels
  onSave: (
    hours: RestaurantHoursInput[],
  ) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onSaveStatusChange?: (status: SaveStatus, errors?: string[]) => void
}

interface DayRow {
  day: number
  enabled: boolean
  openTime: string
  closeTime: string
}

function buildRows(initial: RestaurantHoursInput[]): DayRow[] {
  return Array.from({ length: 7 }, (_, day) => {
    const existing = initial.find((h) => h.day === day)
    return {
      day,
      enabled: !!existing,
      openTime: existing?.openTime ?? '10:00',
      closeTime: existing?.closeTime ?? '22:00',
    }
  })
}

/**
 * Seven-day weekly opening-hours editor. Explicit save button (not auto-save)
 * so partners can make several edits before committing.
 */
export function RestaurantHoursEditor({
  initial,
  labels,
  onSave,
  onSaveStatusChange,
}: RestaurantHoursEditorProps) {
  const [rows, setRows] = useState<DayRow[]>(() => buildRows(initial))
  const [busy, setBusy] = useState(false)

  useEffect(() => setRows(buildRows(initial)), [initial])

  const setRow = (day: number, patch: Partial<DayRow>) => {
    setRows((prev) => prev.map((r) => (r.day === day ? { ...r, ...patch } : r)))
  }

  const handleSave = async () => {
    setBusy(true)
    onSaveStatusChange?.('saving')
    const hours: RestaurantHoursInput[] = rows
      .filter((r) => r.enabled)
      .map((r) => ({ day: r.day, openTime: r.openTime, closeTime: r.closeTime }))
    const res = await onSave(hours)
    setBusy(false)
    if (res.status === 'ok') {
      onSaveStatusChange?.('saved')
      setTimeout(() => onSaveStatusChange?.('idle'), 3000)
    } else {
      onSaveStatusChange?.('error', res.errors)
    }
  }

  return (
    <div className="mb-5">
      <h3 className="text-sm font-medium text-gray-700 mb-2">{labels.heading}</h3>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.day} className="flex items-center gap-3">
            <div className="flex items-center gap-1 w-36 shrink-0">
              <Switch
                size="small"
                checked={r.enabled}
                onChange={(e) => setRow(r.day, { enabled: e.target.checked })}
              />
              <span className="text-sm font-medium text-gray-900">
                {labels.dayNames[r.day]}
              </span>
            </div>
            {r.enabled ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-10">{labels.openAbbr}</span>
                <TextField
                  type="time"
                  size="small"
                  value={r.openTime}
                  onChange={(e) => setRow(r.day, { openTime: e.target.value })}
                  sx={{ width: 120 }}
                />
                <span className="text-xs text-gray-500 w-10">{labels.closeAbbr}</span>
                <TextField
                  type="time"
                  size="small"
                  value={r.closeTime}
                  onChange={(e) => setRow(r.day, { closeTime: e.target.value })}
                  sx={{ width: 120 }}
                />
              </div>
            ) : (
              <span className="text-xs text-gray-400">{labels.closed}</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Button
          type="button"
          variant="contained"
          size="small"
          disabled={busy}
          onClick={handleSave}
          sx={{ textTransform: 'none' }}
        >
          {busy ? labels.saving : labels.save}
        </Button>
      </div>
    </div>
  )
}
