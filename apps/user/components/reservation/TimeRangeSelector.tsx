'use client'

import React from 'react'
import dayjs, { Dayjs } from 'dayjs'

interface TimeRangeSelectorProps {
  value: [Dayjs | null, Dayjs | null]
  onChange: (range: [Dayjs | null, Dayjs | null]) => void
  disabled?: boolean
  label?: string
  onFocus?: () => void
  /** Earliest selectable hour (inclusive). Defaults to 8. */
  openHour?: number
  /** Latest selectable hour (inclusive, represents the last "to" option). Defaults to 20. */
  closeHour?: number
}

/** Format hour number as HH:00 */
function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

export default function TimeRangeSelector({
  value,
  onChange,
  disabled,
  label = 'Time',
  onFocus,
  openHour = 8,
  closeHour = 20,
}: TimeRangeSelectorProps) {

  const fromHour = value[0] ? value[0].hour() : openHour
  const toHour = value[1] ? value[1].hour() : Math.min(fromHour + 2, closeHour)

  // "From" options: openHour .. closeHour - 1 (need at least 1h booking)
  const fromOptions: number[] = []
  for (let h = openHour; h < closeHour; h++) fromOptions.push(h)

  // "To" options: current fromHour + 1 .. closeHour
  const toOptions: number[] = []
  for (let h = fromHour + 1; h <= closeHour; h++) toOptions.push(h)

  const handleFromChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const h = Number(e.target.value)
    const updated = (value[0] || dayjs()).hour(h).minute(0).second(0)
    // If current "to" is <= new "from", bump "to" to from + 1
    const currentTo = value[1] ? value[1].hour() : toHour
    let newTo = value[1]
    if (currentTo <= h) {
      const newToHour = Math.min(h + 1, closeHour)
      newTo = (value[1] || dayjs()).hour(newToHour).minute(0).second(0)
    }
    onFocus?.()
    onChange([updated, newTo])
  }

  const handleToChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const h = Number(e.target.value)
    const updated = (value[1] || dayjs()).hour(h).minute(0).second(0)
    onFocus?.()
    onChange([value[0], updated])
  }

  return (
    <div className="flex-1 flex items-center">
      <fieldset
        disabled={disabled}
        className={`
          flex items-center w-full border rounded px-2 pt-[11px] pb-[7px] transition-colors
          ${disabled
            ? 'bg-gray-50 border-gray-200'
            : 'bg-white border-gray-300 hover:border-gray-900'}
          focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500
        `}
      >
        <label className="sr-only">{label}</label>
        <select
          value={fromHour}
          onChange={handleFromChange}
          onFocus={onFocus}
          disabled={disabled}
          className="flex-1 -mt-[3px] text-center bg-transparent text-base text-gray-900 outline-none disabled:text-gray-400 appearance-none cursor-pointer"
        >
          {fromOptions.map(h => (
            <option key={h} value={h}>{fmtHour(h)}</option>
          ))}
        </select>
        <span className="text-gray-400 -mt-[3px]mx-1">–</span>
        <select
          value={toHour}
          onChange={handleToChange}
          onFocus={onFocus}
          disabled={disabled}
          className="flex-1 -mt-[3px] text-center bg-transparent text-base text-gray-900 outline-none disabled:text-gray-400 appearance-none cursor-pointer"
        >
          {toOptions.map(h => (
            <option key={h} value={h}>{fmtHour(h)}</option>
          ))}
        </select>
      </fieldset>
    </div>
  )
}
