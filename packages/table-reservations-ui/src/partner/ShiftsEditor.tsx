'use client'

import { useEffect, useState } from 'react'
import type { RestaurantShiftInput } from '@repo/table-reservations-core'
import type { SaveStatus } from './RestaurantSettingsForm'

const INPUT =
  'w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900'
const LABEL = 'block text-[11px] font-medium text-gray-500 mb-1'
const CARD = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm'
const HEADING = 'text-sm font-medium text-gray-700'

export interface ShiftsEditorLabels {
  heading: string
  addShift: string
  name: string
  day: string
  start: string
  end: string
  pacingCovers: string
  pacingWindow: string
  lastSeating: string
  noPacingHint: string
  requiresDeposit: string
  depositMinParty: string
  remove: string
  save: string
  saving: string
  empty: string
  dayNames: string[] // 7, index 0 = Sunday
}

export interface ShiftsEditorProps {
  initial: RestaurantShiftInput[]
  labels: ShiftsEditorLabels
  onSave: (
    shifts: RestaurantShiftInput[],
  ) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onSaveStatusChange?: (status: SaveStatus, errors?: string[]) => void
}

type Row = {
  name: string
  day: number
  startTime: string
  endTime: string
  pacingCovers: string // '' = no pacing
  pacingWindowMinutes: string
  lastSeatingOffsetMinutes: string // '' = none
  requiresDeposit: boolean
  depositMinPartySize: string // '' = any size
}

function toRow(s: RestaurantShiftInput): Row {
  return {
    name: s.name,
    day: s.day,
    startTime: s.startTime,
    endTime: s.endTime,
    pacingCovers: s.pacingCovers != null ? String(s.pacingCovers) : '',
    pacingWindowMinutes: String(s.pacingWindowMinutes ?? 15),
    lastSeatingOffsetMinutes:
      s.lastSeatingOffsetMinutes != null ? String(s.lastSeatingOffsetMinutes) : '',
    requiresDeposit: s.requiresDeposit ?? false,
    depositMinPartySize: s.depositMinPartySize != null ? String(s.depositMinPartySize) : '',
  }
}

function toInput(r: Row): RestaurantShiftInput {
  const num = (v: string): number | null => (v.trim() === '' ? null : Number(v))
  return {
    name: r.name,
    day: r.day,
    startTime: r.startTime,
    endTime: r.endTime,
    pacingCovers: num(r.pacingCovers),
    pacingWindowMinutes: Number(r.pacingWindowMinutes) || 15,
    lastSeatingOffsetMinutes: num(r.lastSeatingOffsetMinutes),
    requiresDeposit: r.requiresDeposit,
    depositMinPartySize: num(r.depositMinPartySize),
  }
}

/**
 * Editor for named service shifts with pacing. Replace-all on save — mirrors the
 * RestaurantHoursEditor pattern. Brand-neutral: labels come from the parent.
 */
export function ShiftsEditor({ initial, labels, onSave, onSaveStatusChange }: ShiftsEditorProps) {
  const [rows, setRows] = useState<Row[]>(initial.map(toRow))

  useEffect(() => setRows(initial.map(toRow)), [initial])

  const addRow = () =>
    setRows((rs) => [
      ...rs,
      {
        name: '',
        day: 5,
        startTime: '12:00',
        endTime: '16:00',
        pacingCovers: '',
        pacingWindowMinutes: '15',
        lastSeatingOffsetMinutes: '',
        requiresDeposit: false,
        depositMinPartySize: '',
      },
    ])

  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i))
  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)))

  const save = async () => {
    onSaveStatusChange?.('saving')
    const res = await onSave(rows.map(toInput))
    if (res.status === 'ok') onSaveStatusChange?.('saved')
    else onSaveStatusChange?.('error', res.errors)
  }

  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={HEADING}>{labels.heading}</h3>
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
        >
          {labels.addShift}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">{labels.empty}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-gray-100 p-3 sm:grid-cols-4">
              <label className="col-span-2 block sm:col-span-1">
                <span className={LABEL}>{labels.name}</span>
                <input className={INPUT} value={r.name} onChange={(e) => patch(i, { name: e.target.value })} />
              </label>
              <label className="block">
                <span className={LABEL}>{labels.day}</span>
                <select
                  className={INPUT}
                  value={r.day}
                  onChange={(e) => patch(i, { day: Number(e.target.value) })}
                >
                  {labels.dayNames.map((d, idx) => (
                    <option key={idx} value={idx}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LABEL}>{labels.start}</span>
                <input
                  type="time"
                  className={INPUT}
                  value={r.startTime}
                  onChange={(e) => patch(i, { startTime: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={LABEL}>{labels.end}</span>
                <input
                  type="time"
                  className={INPUT}
                  value={r.endTime}
                  onChange={(e) => patch(i, { endTime: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={LABEL}>{labels.pacingCovers}</span>
                <input
                  type="number"
                  min={1}
                  placeholder={labels.noPacingHint}
                  className={INPUT}
                  value={r.pacingCovers}
                  onChange={(e) => patch(i, { pacingCovers: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={LABEL}>{labels.pacingWindow}</span>
                <input
                  type="number"
                  min={5}
                  max={240}
                  className={INPUT}
                  value={r.pacingWindowMinutes}
                  onChange={(e) => patch(i, { pacingWindowMinutes: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={LABEL}>{labels.lastSeating}</span>
                <input
                  type="number"
                  min={0}
                  max={360}
                  className={INPUT}
                  value={r.lastSeatingOffsetMinutes}
                  onChange={(e) => patch(i, { lastSeatingOffsetMinutes: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 self-end">
                <input
                  type="checkbox"
                  checked={r.requiresDeposit}
                  onChange={(e) => patch(i, { requiresDeposit: e.target.checked })}
                />
                <span className="text-xs text-gray-700">{labels.requiresDeposit}</span>
              </label>
              {r.requiresDeposit && (
                <label className="block">
                  <span className={LABEL}>{labels.depositMinParty}</span>
                  <input
                    type="number"
                    min={1}
                    className={INPUT}
                    value={r.depositMinPartySize}
                    onChange={(e) => patch(i, { depositMinPartySize: e.target.value })}
                  />
                </label>
              )}
              <div className="col-span-2 flex items-end justify-end sm:col-span-1">
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  {labels.remove}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          {labels.save}
        </button>
      </div>
    </section>
  )
}
