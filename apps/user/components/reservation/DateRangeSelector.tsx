'use client'

import React, { useState, useEffect } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import dayjs from 'dayjs'

interface DateRangeSelectorProps {
  value: [string | null, string | null]
  onChange: (range: [string | null, string | null]) => void
  disabled?: boolean
  label?: string
  onOpen?: () => void
  onOpenChange?: (isOpen: boolean) => void
}

export default function DateRangeSelector({
  value,
  onChange,
  disabled,
  label = 'From – To',
  onOpen,
  onOpenChange
}: DateRangeSelectorProps) {
  const [open, setOpen] = useState(false)
  // Local draft range — starts empty when picker opens so first click picks a fresh "from"
  const [draft, setDraft] = useState<DateRange | undefined>(undefined)
  // Explicit click counter: 0 = just opened, 1 = picked "from", 2 = picked "to"
  const [clicks, setClicks] = useState(0)

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  const from = value[0] ? new Date(value[0]) : undefined
  const to = value[1] ? new Date(value[1]) : undefined

  const displayText = from && to
    ? `${dayjs(from).format('YYYY-MM-DD')}  –  ${dayjs(to).format('YYYY-MM-DD')}`
    : from
      ? `${dayjs(from).format('YYYY-MM-DD')}  –  …`
      : label

  return (
    <div className="w-full">
      <div className="relative mt-2">
        <span className="absolute top-1.5 left-1.5 bg-white px-1.5 text-xs text-gray-400 border border-gray-300 rounded z-10">
          {label}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              const next = !open
              setOpen(next)
              if (next) {
                // Show current selection initially; first click will start fresh
                setDraft(from ? { from, to } : undefined)
                setClicks(0)
                if (onOpen) onOpen()
              }
            }
          }}
          className={`
            w-full px-3 py-[15.5px] text-center text-base rounded
            border transition-colors
            ${disabled
              ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
              : 'bg-white text-gray-900 border-gray-300 hover:border-gray-900 cursor-pointer'}
            focus:outline-none
          `}
        >
          <span className={`pointer-events-none ${from ? 'text-gray-900' : 'text-gray-500'}`}>
            {displayText}
          </span>
        </button>
      </div>

      {open && (
        <div className="mt-2 bg-white rounded-lg border border-gray-200 py-2 px-2">
          <DayPicker
            modifiers={{
              rangeStart: draft?.from ? [draft.from] : [],
              rangeEnd: draft?.to ? [draft.to] : [],
              inRange: draft?.from && draft?.to
                ? { after: draft.from, before: draft.to }
                : [],
              selected: draft?.from && draft?.to
                ? { from: draft.from, to: draft.to }
                : draft?.from
                  ? [draft.from]
                  : [],
            }}
            modifiersClassNames={{
              rangeStart: 'rdp-range_start rdp-selected',
              rangeEnd: 'rdp-range_end rdp-selected',
              inRange: 'rdp-range_middle',
              selected: 'rdp-selected',
            }}
            onDayClick={(day) => {
              const step = clicks + 1
              setClicks(step)

              if (step === 1) {
                // First click: always use the exact clicked day as new "from"
                setDraft({ from: day, to: undefined })
              } else {
                // Second click: set "to", ensuring from < to
                const prevFrom = draft?.from
                if (!prevFrom) return

                const [rangeFrom, rangeTo] = day < prevFrom
                  ? [day, prevFrom]
                  : [prevFrom, day]

                setDraft({ from: rangeFrom, to: rangeTo })
                onChange([
                  dayjs(rangeFrom).startOf('day').toISOString(),
                  dayjs(rangeTo).endOf('day').toISOString(),
                ])
                setTimeout(() => setOpen(false), 250)
              }
            }}
            numberOfMonths={1}
            defaultMonth={from || new Date()}
            showOutsideDays
          />
        </div>
      )}
    </div>
  )
}
