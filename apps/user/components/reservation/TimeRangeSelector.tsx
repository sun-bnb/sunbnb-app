'use client'

import React from 'react'
import dayjs, { Dayjs } from 'dayjs'

interface TimeRangeSelectorProps {
  value: [Dayjs | null, Dayjs | null]
  onChange: (range: [Dayjs | null, Dayjs | null]) => void
  disabled?: boolean
  label?: string
  onFocus?: () => void
}

export default function TimeRangeSelector({
  value,
  onChange,
  disabled,
  label = 'Time',
  onFocus
}: TimeRangeSelectorProps) {
  const fromTime = value[0] ? value[0].format('HH:mm') : ''
  const toTime = value[1] ? value[1].format('HH:mm') : ''

  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parts = e.target.value.split(':').map(Number)
    const h = parts[0] ?? 0
    const m = parts[1] ?? 0
    const updated = (value[0] || dayjs()).hour(h).minute(m).second(0)
    onChange([updated, value[1]])
  }

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parts = e.target.value.split(':').map(Number)
    const h = parts[0] ?? 0
    const m = parts[1] ?? 0
    const updated = (value[1] || dayjs()).hour(h).minute(m).second(0)
    onChange([value[0], updated])
  }

  return (
    <div className="flex-1 flex items-center">
      <fieldset
        disabled={disabled}
        className={`
          flex items-center w-full border rounded px-2 py-[11px] transition-colors
          ${disabled
            ? 'bg-gray-50 border-gray-200'
            : 'bg-white border-gray-300 hover:border-gray-900'}
          focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500
        `}
      >
        <label className="sr-only">{label}</label>
        <input
          type="time"
          value={fromTime}
          onChange={handleFromChange}
          onFocus={onFocus}
          disabled={disabled}
          className="flex-1 text-center bg-transparent text-base text-gray-900 outline-none disabled:text-gray-400 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute"
        />
        <span className="text-gray-400 mx-1">–</span>
        <input
          type="time"
          value={toTime}
          onChange={handleToChange}
          onFocus={onFocus}
          disabled={disabled}
          className="flex-1 text-center bg-transparent text-base text-gray-900 outline-none disabled:text-gray-400 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute"
        />
      </fieldset>
    </div>
  )
}
