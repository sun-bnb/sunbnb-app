'use client'

import { useMemo, useState } from 'react'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import type { TableReservationListItem } from '@repo/table-reservations-core'
import { ReservationRow, type ReservationRowLabels } from './ReservationRow'

export type ReservationFilter = 'all' | 'expected' | 'seated' | 'departed' | 'no_show' | 'canceled'

export interface ReservationListLabels {
  dateLabel: string
  filterAll: string
  filterExpected: string
  filterSeated: string
  filterDeparted: string
  filterNoShow: string
  filterCanceled: string
  emptyTitle: string
  emptyHint: string
  row: ReservationRowLabels
}

export interface ReservationListProps {
  date: string
  reservations: TableReservationListItem[]
  labels: ReservationListLabels
  onChangeDate: (date: string) => void
  onMarkSeated: (id: string) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onMarkDeparted: (id: string) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onMarkNoShow: (id: string) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onCancel: (id: string) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onUpdateNotes: (id: string, notes: string | null) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

/**
 * Day-view reservation list. Filter-bar limits by operational state; empty
 * state prompts the partner to pick a different date.
 */
export function ReservationList({
  date,
  reservations,
  labels,
  onChangeDate,
  onMarkSeated,
  onMarkDeparted,
  onMarkNoShow,
  onCancel,
  onUpdateNotes,
}: ReservationListProps) {
  const [filter, setFilter] = useState<ReservationFilter>('all')

  const filtered = useMemo(() => {
    const list = reservations
      .slice()
      .sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime())
    switch (filter) {
      case 'all':
        return list
      case 'canceled':
        return list.filter((r) => r.status === 'canceled')
      default:
        return list.filter((r) => r.status !== 'canceled' && r.operationalStatus === filter)
    }
  }, [reservations, filter])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <TextField
          size="small"
          type="date"
          label={labels.dateLabel}
          value={date}
          onChange={(e) => onChangeDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 180 }}
        />
        <ToggleButtonGroup
          size="small"
          value={filter}
          exclusive
          onChange={(_, v) => v && setFilter(v)}
          sx={{ '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5, py: 0.5, fontSize: '0.75rem' } }}
        >
          <ToggleButton value="all">{labels.filterAll}</ToggleButton>
          <ToggleButton value="expected">{labels.filterExpected}</ToggleButton>
          <ToggleButton value="seated">{labels.filterSeated}</ToggleButton>
          <ToggleButton value="departed">{labels.filterDeparted}</ToggleButton>
          <ToggleButton value="no_show">{labels.filterNoShow}</ToggleButton>
          <ToggleButton value="canceled">{labels.filterCanceled}</ToggleButton>
        </ToggleButtonGroup>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <div className="text-sm font-medium text-gray-700">{labels.emptyTitle}</div>
          <div className="text-xs text-gray-500 mt-1">{labels.emptyHint}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => (
            <ReservationRow
              key={r.id}
              reservation={r}
              labels={labels.row}
              onMarkSeated={() => onMarkSeated(r.id)}
              onMarkDeparted={() => onMarkDeparted(r.id)}
              onMarkNoShow={() => onMarkNoShow(r.id)}
              onCancel={() => onCancel(r.id)}
              onUpdateNotes={(notes) => onUpdateNotes(r.id, notes)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
