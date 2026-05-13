'use client'

import { useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

export interface BookTableSectionLabels {
  title: string
  description: string
  dateLabel: string
  partySizeLabel: string
  continue: string
}

export interface BookTableSectionProps {
  labels: BookTableSectionLabels
  reservationWindowDays: number
  onContinue: (params: { date: string; partySize: number }) => void
}

/**
 * Entry-point card rendered on the chiringuito's Sunbnb site page when a
 * Restaurant is linked. Collects date + party size, then calls onContinue
 * (typically a router push to /sites/[id]/table with these params).
 */
export function BookTableSection({
  labels,
  reservationWindowDays,
  onContinue,
}: BookTableSectionProps) {
  const today = new Date()
  const defaultDate = formatYmd(today)
  const maxDate = formatYmd(new Date(today.getTime() + reservationWindowDays * 86400000))

  const [date, setDate] = useState(defaultDate)
  const [partySize, setPartySize] = useState(2)

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-1">{labels.title}</h2>
      <p className="text-sm text-gray-600 mb-4">{labels.description}</p>
      <div className="flex gap-3 flex-wrap">
        <TextField
          size="small"
          type="date"
          label={labels.dateLabel}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: defaultDate, max: maxDate }}
          sx={{ minWidth: 180 }}
        />
        <TextField
          size="small"
          type="number"
          label={labels.partySizeLabel}
          value={partySize}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n >= 1 && n <= 50) setPartySize(n)
          }}
          inputProps={{ min: 1, max: 50 }}
          sx={{ width: 140 }}
        />
        <Button
          variant="contained"
          size="small"
          onClick={() => onContinue({ date, partySize })}
          sx={{ textTransform: 'none' }}
        >
          {labels.continue}
        </Button>
      </div>
    </section>
  )
}

function formatYmd(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
