'use client'

import Button from '@mui/material/Button'
import type { AvailabilitySlot } from '@repo/table-reservations-core'

export interface AvailabilityPickerLabels {
  heading: string
  empty: string
  tablesSuffix: string
}

export interface AvailabilityPickerProps {
  slots: AvailabilitySlot[]
  selectedIso: string | null
  labels: AvailabilityPickerLabels
  onSelect: (slot: AvailabilitySlot) => void
}

/** A row of "19:00", "19:30", "20:00" buttons for the selected day. */
export function AvailabilityPicker({
  slots,
  selectedIso,
  labels,
  onSelect,
}: AvailabilityPickerProps) {
  if (slots.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4">{labels.empty}</div>
    )
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {labels.heading}
      </h3>
      <div className="flex flex-wrap gap-2">
        {slots.map((slot) => {
          const iso = new Date(slot.from).toISOString()
          const isSelected = selectedIso === iso
          return (
            <Button
              key={iso}
              type="button"
              size="small"
              variant={isSelected ? 'contained' : 'outlined'}
              onClick={() => onSelect(slot)}
              sx={{ textTransform: 'none', minWidth: 80 }}
            >
              <span className="flex flex-col">
                <span className="font-medium">{formatTime(slot.from)}</span>
                <span className="text-[10px] opacity-70">
                  {slot.availableTableIds.length} {labels.tablesSuffix}
                </span>
              </span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
