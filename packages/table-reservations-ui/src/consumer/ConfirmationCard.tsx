'use client'

import Button from '@mui/material/Button'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'

export interface ConfirmationCardLabels {
  confirmedTitle: string
  canceledTitle: string
  dateLabel: string
  timeLabel: string
  partyLabel: string
  notesLabel: string
  idLabel: string
  cancelButton: string
  canceling: string
  cancelConfirmTitle: string
  cancelConfirmBody: string
  cancelYes: string
  cancelNo: string
  guestsSingular: string
  guestsPlural: string
  errorPrefix: string
}

export interface ConfirmationCardReservation {
  id: string
  from: Date | string
  to: Date | string
  partySize: number
  specialRequests: string | null
  status: string
}

export interface ConfirmationCardProps {
  reservation: ConfirmationCardReservation
  restaurantName: string
  labels: ConfirmationCardLabels
  onCancel: () => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

import { useState } from 'react'

export function ConfirmationCard({
  reservation,
  restaurantName,
  labels,
  onCancel,
}: ConfirmationCardProps) {
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const isCanceled = reservation.status === 'canceled'
  const from = new Date(reservation.from)
  const to = new Date(reservation.to)

  const handleCancel = async () => {
    setBusy(true)
    setErrors([])
    const res = await onCancel()
    setBusy(false)
    setConfirmOpen(false)
    if (res.status === 'error') setErrors(res.errors ?? [])
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 max-w-xl">
      <div className="flex items-center gap-2 mb-3">
        {isCanceled ? (
          <>
            <CancelIcon className="text-red-600" />
            <h2 className="text-base font-semibold text-gray-900">{labels.canceledTitle}</h2>
          </>
        ) : (
          <>
            <CheckCircleIcon className="text-green-600" />
            <h2 className="text-base font-semibold text-gray-900">{labels.confirmedTitle}</h2>
          </>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-4">{restaurantName}</p>
      <table className="w-full text-sm mb-4">
        <tbody>
          <Row label={labels.dateLabel} value={formatDate(from)} />
          <Row label={labels.timeLabel} value={`${formatTime(from)} – ${formatTime(to)}`} />
          <Row
            label={labels.partyLabel}
            value={`${reservation.partySize} ${
              reservation.partySize === 1 ? labels.guestsSingular : labels.guestsPlural
            }`}
          />
          {reservation.specialRequests && (
            <Row label={labels.notesLabel} value={reservation.specialRequests} />
          )}
          <Row label={labels.idLabel} value={reservation.id} mono />
        </tbody>
      </table>

      {!isCanceled && (
        <div>
          {confirmOpen ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <div className="text-sm font-medium text-amber-900 mb-1">
                {labels.cancelConfirmTitle}
              </div>
              <div className="text-xs text-amber-800 mb-3">{labels.cancelConfirmBody}</div>
              <div className="flex gap-2">
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  onClick={handleCancel}
                  disabled={busy}
                  sx={{ textTransform: 'none' }}
                >
                  {busy ? labels.canceling : labels.cancelYes}
                </Button>
                <Button
                  size="small"
                  onClick={() => setConfirmOpen(false)}
                  sx={{ textTransform: 'none' }}
                >
                  {labels.cancelNo}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="small"
              color="error"
              onClick={() => setConfirmOpen(true)}
              sx={{ textTransform: 'none' }}
            >
              {labels.cancelButton}
            </Button>
          )}
          {errors.length > 0 && (
            <div className="mt-2 text-xs text-red-600">
              {labels.errorPrefix}: {errors.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr>
      <td className="py-1 text-gray-500 pr-3 align-top w-24">{label}</td>
      <td className={`py-1 align-top ${mono ? 'font-mono text-xs text-gray-600' : 'text-gray-900'}`}>
        {value}
      </td>
    </tr>
  )
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
