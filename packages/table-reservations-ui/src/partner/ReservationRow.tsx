'use client'

import { useState } from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import CheckIcon from '@mui/icons-material/Check'
import LogoutIcon from '@mui/icons-material/Logout'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import CancelIcon from '@mui/icons-material/Cancel'
import NotesIcon from '@mui/icons-material/Notes'
import type { TableReservationListItem } from '@repo/table-reservations-core'

export interface ReservationRowLabels {
  markSeated: string
  markDeparted: string
  markNoShow: string
  cancel: string
  tableLabel: string
  partyShort: string
  notesPlaceholder: string
  notesSave: string
  notesSaving: string
  notesSaved: string
  notesEditToggle: string
  statusExpected: string
  statusSeated: string
  statusDeparted: string
  statusNoShow: string
  statusCanceled: string
  noTable: string
}

export interface ReservationRowProps {
  reservation: TableReservationListItem
  labels: ReservationRowLabels
  onMarkSeated: () => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onMarkDeparted: () => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onMarkNoShow: () => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onCancel: () => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onUpdateNotes: (notes: string | null) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

export function ReservationRow({
  reservation,
  labels,
  onMarkSeated,
  onMarkDeparted,
  onMarkNoShow,
  onCancel,
  onUpdateNotes,
}: ReservationRowProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState(reservation.internalNotes ?? '')
  const [notesState, setNotesState] = useState<'idle' | 'saving' | 'saved'>('idle')

  const isCanceled = reservation.status === 'canceled'
  const op = reservation.operationalStatus

  const handleNotesSave = async () => {
    setNotesState('saving')
    const res = await onUpdateNotes(notes.trim() || null)
    if (res.status === 'ok') {
      setNotesState('saved')
      setTimeout(() => setNotesState('idle'), 2000)
    } else {
      setNotesState('idle')
    }
  }

  return (
    <div
      className={`rounded border border-gray-200 bg-white ${
        isCanceled || op === 'no_show' ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center gap-4 px-3 py-2.5">
        <div className="w-20 shrink-0">
          <div className="text-sm font-medium text-gray-900">{formatTime(reservation.from)}</div>
          <div className="text-xs text-gray-500">{formatTime(reservation.to)}</div>
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {reservation.guestName}
            </span>
            <StatusBadge reservation={reservation} labels={labels} />
          </div>
          <div className="text-xs text-gray-500 flex flex-wrap gap-3">
            <span>
              {labels.partyShort}: <strong className="text-gray-700">{reservation.partySize}</strong>
            </span>
            <span>
              {labels.tableLabel}:{' '}
              <strong className="text-gray-700">
                {reservation.table
                  ? reservation.table.label || `#${reservation.table.number}`
                  : labels.noTable}
              </strong>
            </span>
            {reservation.guestEmail && (
              <span className="truncate max-w-[180px]">{reservation.guestEmail}</span>
            )}
            {reservation.guestPhone && <span>{reservation.guestPhone}</span>}
          </div>
          {reservation.specialRequests && (
            <div className="text-xs text-gray-600 mt-1 italic">
              “{reservation.specialRequests}”
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isCanceled && op === 'expected' && (
            <Tooltip title={labels.markSeated}>
              <IconButton size="small" color="primary" onClick={() => void onMarkSeated()}>
                <CheckIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {!isCanceled && op === 'seated' && (
            <Tooltip title={labels.markDeparted}>
              <IconButton size="small" onClick={() => void onMarkDeparted()}>
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={labels.notesEditToggle}>
            <IconButton
              size="small"
              onClick={() => setNotesOpen((v) => !v)}
              sx={{ color: reservation.internalNotes ? 'primary.main' : undefined }}
            >
              <NotesIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
            {!isCanceled && op !== 'seated' && op !== 'departed' && (
              <MenuItem
                onClick={() => {
                  void onMarkSeated()
                  setMenuAnchor(null)
                }}
              >
                <CheckIcon fontSize="small" className="mr-2" />
                {labels.markSeated}
              </MenuItem>
            )}
            {!isCanceled && op === 'seated' && (
              <MenuItem
                onClick={() => {
                  void onMarkDeparted()
                  setMenuAnchor(null)
                }}
              >
                <LogoutIcon fontSize="small" className="mr-2" />
                {labels.markDeparted}
              </MenuItem>
            )}
            {!isCanceled && op !== 'departed' && op !== 'no_show' && (
              <MenuItem
                onClick={() => {
                  void onMarkNoShow()
                  setMenuAnchor(null)
                }}
              >
                <HighlightOffIcon fontSize="small" className="mr-2" />
                {labels.markNoShow}
              </MenuItem>
            )}
            {!isCanceled && (
              <MenuItem
                onClick={() => {
                  void onCancel()
                  setMenuAnchor(null)
                }}
                sx={{ color: 'error.main' }}
              >
                <CancelIcon fontSize="small" className="mr-2" />
                {labels.cancel}
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>

      {notesOpen && (
        <div className="px-3 pb-3 border-t border-gray-100">
          <textarea
            className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-black"
            rows={2}
            placeholder={labels.notesPlaceholder}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex items-center gap-2 mt-1">
            <Button
              size="small"
              variant="outlined"
              onClick={handleNotesSave}
              disabled={notesState === 'saving'}
              sx={{ textTransform: 'none' }}
            >
              {notesState === 'saving' ? labels.notesSaving : labels.notesSave}
            </Button>
            {notesState === 'saved' && (
              <span className="text-xs text-green-600">{labels.notesSaved}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({
  reservation,
  labels,
}: {
  reservation: TableReservationListItem
  labels: ReservationRowLabels
}) {
  if (reservation.status === 'canceled') {
    return <Badge tone="gray">{labels.statusCanceled}</Badge>
  }
  switch (reservation.operationalStatus) {
    case 'seated':
      return <Badge tone="blue">{labels.statusSeated}</Badge>
    case 'departed':
      return <Badge tone="green">{labels.statusDeparted}</Badge>
    case 'no_show':
      return <Badge tone="amber">{labels.statusNoShow}</Badge>
    default:
      return <Badge tone="neutral">{labels.statusExpected}</Badge>
  }
}

function Badge({
  tone,
  children,
}: {
  tone: 'neutral' | 'blue' | 'green' | 'amber' | 'gray'
  children: React.ReactNode
}) {
  const cls: Record<string, string> = {
    neutral: 'bg-gray-100 text-gray-700 border-gray-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    gray: 'bg-gray-100 text-gray-500 border-gray-200',
  }
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls[tone]}`}
    >
      {children}
    </span>
  )
}

function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
