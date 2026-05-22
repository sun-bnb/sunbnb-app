'use client'

import { useEffect, useState } from 'react'
import type { RestaurantHoursInput } from '@repo/table-reservations-core'
import { Toggle } from './Toggle'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// Raw utility strings — aligned with .claude/rules/ui.md by hand (this shared
// package can't see the partner app's component classes).
const TIME_INPUT =
  'text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-900'
const BTN =
  'bg-gray-900 text-white px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed'

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
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{labels.heading}</h3>
      <div className="flex flex-col">
        {rows.map((r, idx) => (
          <div
            key={r.day}
            className={`flex items-center gap-3 py-2 ${idx > 0 ? 'border-t border-gray-100' : ''}`}
          >
            <div className="flex items-center gap-2 w-36 shrink-0">
              <Toggle
                size="sm"
                checked={r.enabled}
                ariaLabel={labels.dayNames[r.day]}
                onChange={(v) => setRow(r.day, { enabled: v })}
              />
              <span
                className={`text-sm font-medium ${r.enabled ? 'text-gray-900' : 'text-gray-400'}`}
              >
                {labels.dayNames[r.day]}
              </span>
            </div>
            {r.enabled ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-10">{labels.openAbbr}</span>
                <input
                  type="time"
                  className={TIME_INPUT}
                  value={r.openTime}
                  onChange={(e) => setRow(r.day, { openTime: e.target.value })}
                />
                <span className="text-xs text-gray-500 w-10">{labels.closeAbbr}</span>
                <input
                  type="time"
                  className={TIME_INPUT}
                  value={r.closeTime}
                  onChange={(e) => setRow(r.day, { closeTime: e.target.value })}
                />
              </div>
            ) : (
              <span className="text-xs text-gray-400">{labels.closed}</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4">
        <button type="button" className={BTN} disabled={busy} onClick={handleSave}>
          {busy ? labels.saving : labels.save}
        </button>
      </div>
    </section>
  )
}
