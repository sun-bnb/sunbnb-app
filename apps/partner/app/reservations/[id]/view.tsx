'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

/* ── MUI ───────────────────────────────────────────────────── */
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import Alert from '@mui/material/Alert'
import Tooltip from '@mui/material/Tooltip'
import Divider from '@mui/material/Divider'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import CircularProgress from '@mui/material/CircularProgress'
import TextField from '@mui/material/TextField'

import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import LoginIcon from '@mui/icons-material/Login'
import LogoutIcon from '@mui/icons-material/Logout'
import BlockIcon from '@mui/icons-material/Block'
import CancelIcon from '@mui/icons-material/Cancel'
import PersonIcon from '@mui/icons-material/Person'
import EmailIcon from '@mui/icons-material/Email'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import BeachAccessIcon from '@mui/icons-material/BeachAccess'
import TagIcon from '@mui/icons-material/Tag'
import NoteIcon from '@mui/icons-material/Note'
import PaymentIcon from '@mui/icons-material/Payment'
import EventSeatIcon from '@mui/icons-material/EventSeat'
import PlaceIcon from '@mui/icons-material/Place'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ScheduleIcon from '@mui/icons-material/Schedule'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'

import {
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  RESERVATION_PENDING,
  RESERVATION_COMPLETE,
  RESERVATION_CANCELED,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_REFUNDED,
} from '@repo/data/reservation-status'
import {
  checkInReservation,
  markDeparted,
  markNoShow,
  cancelReservation,
  updateNotes,
} from './actions'

/* ── Types ─────────────────────────────────────────────────── */

interface ReservationData {
  id: string
  siteId: string
  type: string
  status: string
  operationalStatus: string
  from: string
  to: string
  createdAt: string
  updatedAt: string
  checkedInAt: string | null
  departedAt: string | null
  reminderSentAt: string | null
  guestName: string | null
  guestContact: string | null
  internalNotes: string | null
  paymentAmount: number | null
  paymentRef: string | null
  user: { id: string; email: string; name: string | null }
  site: { id: string; name: string; type: string | null; vat: number | null }
  items: { id: string; number: number; group: number; label: string | null; category: string | null; price: number | null }[]
}

/* ── Helpers ───────────────────────────────────────────────── */

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
    + ', ' + d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function paymentStatusKey(status: string): string {
  switch (status) {
    case RESERVATION_PENDING: return 'payStatusPending'
    case 'confirmed': return 'payStatusConfirmed'
    case RESERVATION_COMPLETE: return 'payStatusPaid'
    case RESERVATION_PAID_IN_CASH: return 'payStatusPaidInCash'
    case RESERVATION_CANCELED: return 'payStatusCanceled'
    case RESERVATION_PAYMENT_FAILED: return 'payStatusFailed'
    case RESERVATION_REFUNDED: return 'payStatusRefunded'
    default: return status
  }
}

function paymentChipColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case RESERVATION_COMPLETE:
    case RESERVATION_PAID_IN_CASH:
    case 'confirmed':
      return 'success'
    case RESERVATION_PENDING:
      return 'warning'
    case RESERVATION_CANCELED:
    case RESERVATION_PAYMENT_FAILED:
      return 'error'
    case RESERVATION_REFUNDED:
      return 'default'
    default:
      return 'default'
  }
}

function opStatusKey(status: string): string {
  switch (status) {
    case OP_EXPECTED: return 'statusExpected'
    case OP_CHECKED_IN: return 'statusCheckedIn'
    case OP_WALKED_IN: return 'statusWalkIn'
    case OP_DEPARTED: return 'statusDeparted'
    case OP_NO_SHOW: return 'statusNoShow'
    default: return status
  }
}

function opChipColor(status: string): 'warning' | 'info' | 'success' | 'error' | 'default' {
  switch (status) {
    case OP_EXPECTED: return 'warning'
    case OP_CHECKED_IN:
    case OP_WALKED_IN: return 'info'
    case OP_DEPARTED: return 'success'
    case OP_NO_SHOW: return 'error'
    default: return 'default'
  }
}

/* ── Timeline step ─────────────────────────────────────────── */

function TimelineStep({ label, time, active, last }: { label: string; time: string | null; active: boolean; last?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full border-2 mt-0.5 ${
          active ? 'bg-blue-500 border-blue-500' : time ? 'bg-green-500 border-green-500' : 'bg-white border-gray-300'
        }`} />
        {!last && <div className={`w-0.5 flex-1 my-1 ${time ? 'bg-green-200' : 'bg-gray-200'}`} />}
      </div>
      <div className="pb-4">
        <p className={`text-sm font-medium ${time ? 'text-gray-800' : 'text-gray-400'}`}>{label}</p>
        {time && <p className="text-xs text-gray-500 mt-0.5">{fmtDateTime(time)}</p>}
      </div>
    </div>
  )
}

/* ── Action definitions ────────────────────────────────────── */

interface ActionDef {
  labelKey: string
  icon: React.ReactNode
  variant: 'contained' | 'outlined' | 'text'
  color: 'primary' | 'success' | 'error' | 'inherit'
  needsConfirm?: boolean
  confirmTitleKey?: string
  confirmBodyKey?: string
  action: (id: string) => Promise<{ status: string; errors?: (string | undefined)[] }>
}

function getActions(reservation: ReservationData): ActionDef[] {
  if (reservation.status === RESERVATION_CANCELED) return []

  switch (reservation.operationalStatus) {
    case OP_EXPECTED:
      return [
        {
          labelKey: 'checkIn',
          icon: <LoginIcon sx={{ fontSize: 18 }} />,
          variant: 'contained',
          color: 'primary',
          action: checkInReservation,
        },
        {
          labelKey: 'noShow',
          icon: <BlockIcon sx={{ fontSize: 18 }} />,
          variant: 'outlined',
          color: 'inherit',
          needsConfirm: true,
          confirmTitleKey: 'confirmNoShowTitle',
          confirmBodyKey: 'confirmNoShowBody',
          action: markNoShow,
        },
        {
          labelKey: 'cancelReservation',
          icon: <CancelIcon sx={{ fontSize: 18 }} />,
          variant: 'text',
          color: 'error',
          needsConfirm: true,
          confirmTitleKey: 'confirmCancelTitle',
          confirmBodyKey: 'confirmCancelBody',
          action: cancelReservation,
        },
      ]
    case OP_CHECKED_IN:
    case OP_WALKED_IN:
      return [
        {
          labelKey: 'markDeparted',
          icon: <LogoutIcon sx={{ fontSize: 18 }} />,
          variant: 'contained',
          color: 'success',
          action: markDeparted,
        },
        {
          labelKey: 'cancelReservation',
          icon: <CancelIcon sx={{ fontSize: 18 }} />,
          variant: 'text',
          color: 'error',
          needsConfirm: true,
          confirmTitleKey: 'confirmCancelTitle',
          confirmBodyKey: 'confirmCancelBody',
          action: cancelReservation,
        },
      ]
    default:
      return []
  }
}

/* ── Main view ─────────────────────────────────────────────── */

export default function ReservationView({ reservation }: { reservation: ReservationData }) {
  const router = useRouter()
  const t = useTranslations('ReservationView')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ActionDef | null>(null)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const r = reservation
  const isCanceled = r.status === RESERVATION_CANCELED
  const actions = getActions(r)
  const isHourly = r.type === 'hours'

  const handleAction = (actionDef: ActionDef) => {
    if (actionDef.needsConfirm) {
      setConfirmAction(actionDef)
      return
    }
    executeAction(actionDef)
  }

  const executeAction = (actionDef: ActionDef) => {
    setError(null)
    setConfirmAction(null)
    startTransition(async () => {
      const result = await actionDef.action(r.id)
      if (result.status === 'error') {
        setError(result.errors?.[0] ?? 'Something went wrong')
      } else {
        router.refresh()
      }
    })
  }

  const handleSaveNotes = async () => {
    setNotesSaving(true)
    const result = await updateNotes(r.id, notesValue)
    setNotesSaving(false)
    if (result.status === 'ok') {
      setEditingNotes(false)
      router.refresh()
    } else {
      setError(result.errors?.[0] ?? 'Failed to save notes')
    }
  }

  const startEditNotes = () => {
    setNotesValue(r.internalNotes || '')
    setEditingNotes(true)
  }

  const copyId = () => {
    navigator.clipboard.writeText(r.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`max-w-3xl mx-auto px-4 py-6 ${isPending ? 'opacity-50 pointer-events-none' : ''}`}>

      {/* ── Back link ── */}
      <Link href="/frontdesk" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowBackIcon sx={{ fontSize: 16 }} />
        <span>{t('backLink')}</span>
      </Link>

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-xl font-bold text-gray-900">
              {r.guestName || 'Guest'}
            </h1>
            {isCanceled && (
              <Chip label={t('canceled')} size="small" color="error" sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }} />
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <PlaceIcon sx={{ fontSize: 16, color: '#9ca3af' }} />
            <Link href={`/sites/${r.site.id}/manage`} className="hover:text-gray-700 hover:underline">
              {r.site.name}
            </Link>
          </div>
        </div>

        {/* Status chips */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Chip
            label={t(paymentStatusKey(r.status) as any)}
            size="small"
            color={paymentChipColor(r.status)}
            variant="outlined"
            sx={{ height: 26, fontSize: '0.75rem', fontWeight: 600 }}
          />
          {!isCanceled && (
            <Chip
              label={t(opStatusKey(r.operationalStatus) as any)}
              size="small"
              color={opChipColor(r.operationalStatus)}
              sx={{ height: 26, fontSize: '0.75rem', fontWeight: 600 }}
            />
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <Alert severity="error" variant="outlined" onClose={() => setError(null)} sx={{ mb: 3, '& .MuiAlert-message': { fontSize: '0.85rem' } }}>
          {error}
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

        {/* ═══════ Left column: Details ═══════ */}
        <div className="md:col-span-2 flex flex-col gap-5">

          {/* ── Booking info card ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <CalendarTodayIcon sx={{ fontSize: 16, color: '#6b7280' }} />
              {t('bookingDetails')}
            </h2>
            <div className="grid gap-3">
              {/* Date/time */}
              <div className="flex items-start gap-3">
                <AccessTimeIcon sx={{ fontSize: 16, color: '#9ca3af', mt: 0.3 }} />
                <div>
                  {isHourly ? (
                    <>
                      <p className="text-sm text-gray-800">{fmtDate(r.from)}</p>
                      <p className="text-xs text-gray-500">{fmtTime(r.from)} – {fmtTime(r.to)}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-800">{fmtDate(r.from)} – {fmtDate(r.to)}</p>
                      <p className="text-xs text-gray-500">{t('multiDay')}</p>
                    </>
                  )}
                </div>
              </div>

              {/* Guest info */}
              {r.guestName && (
                <div className="flex items-center gap-3">
                  <PersonIcon sx={{ fontSize: 16, color: '#9ca3af' }} />
                  <span className="text-sm text-gray-700">{r.guestName}</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <EmailIcon sx={{ fontSize: 16, color: '#9ca3af' }} />
                <span className="text-sm text-gray-700">{r.guestContact || r.user.email}</span>
              </div>

              {/* Payment */}
              {r.paymentAmount != null && (
                <div className="flex items-center gap-3">
                  <PaymentIcon sx={{ fontSize: 16, color: '#9ca3af' }} />
                  <span className="text-sm text-gray-700">
                    €{r.paymentAmount.toFixed(2)}
                    {r.site.vat != null && <span className="text-xs text-gray-400 ml-1">{t('vatIncl', { vat: r.site.vat })}</span>}
                  </span>
                </div>
              )}

              {/* Items */}
              {r.items.length > 0 && (
                <div className="flex items-start gap-3">
                  <EventSeatIcon sx={{ fontSize: 16, color: '#9ca3af', mt: 0.3 }} />
                  <div>
                    <p className="text-sm text-gray-700">
                      {t('sunbeds', { count: r.items.length })}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {r.items.map(item => (
                        <Chip
                          key={item.id}
                          label={item.label || `#${item.number}`}
                          size="small"
                          variant="outlined"
                          sx={{ height: 22, fontSize: '0.7rem', borderColor: '#e5e7eb', color: '#4b5563' }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Reservation ID */}
              <div className="flex items-center gap-3 min-w-0">
                <TagIcon sx={{ fontSize: 16, color: '#d1d5db', flexShrink: 0 }} />
                <span className="font-mono text-xs text-gray-400 select-all truncate">{r.id}</span>
                <Tooltip title={copied ? t('copiedTooltip') : t('copyIdTooltip')} arrow>
                  <IconButton size="small" onClick={copyId} sx={{ ml: -0.5, flexShrink: 0 }}>
                    <ContentCopyIcon sx={{ fontSize: 14, color: copied ? '#22c55e' : '#d1d5db' }} />
                  </IconButton>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* ── Internal notes card ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <NoteIcon sx={{ fontSize: 16, color: '#6b7280' }} />
              {t('internalNotes')}
            </h2>
            {editingNotes ? (
              <div className="flex flex-col gap-2">
                <TextField
                  value={notesValue}
                  onChange={e => setNotesValue(e.target.value)}
                  inputProps={{ maxLength: 500 }}
                  multiline
                  rows={3}
                  size="small"
                  placeholder={t('notesPlaceholder')}
                  fullWidth
                  autoFocus
                  sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    size="small"
                    onClick={() => setEditingNotes(false)}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('cancel')}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={handleSaveNotes}
                    disabled={notesSaving}
                    startIcon={notesSaving ? <CircularProgress size={14} /> : undefined}
                    sx={{ textTransform: 'none' }}
                  >
                    {notesSaving ? t('saving') : t('save')}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={startEditNotes}
                className="w-full text-left text-sm px-3 py-2.5 rounded-lg border border-dashed border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors flex items-start gap-2"
              >
                {r.internalNotes ? (
                  <span className="whitespace-pre-wrap">{r.internalNotes}</span>
                ) : (
                  <span className="text-gray-400">{t('addNotes')}</span>
                )}
              </button>
            )}
          </div>

          {/* ── Actions card ── */}
          {actions.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <BeachAccessIcon sx={{ fontSize: 16, color: '#6b7280' }} />
                {t('actionsTitle')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {actions.map(a => (
                  <Button
                    key={a.labelKey}
                    size="small"
                    variant={a.variant}
                    color={a.color}
                    startIcon={a.icon}
                    onClick={() => handleAction(a)}
                    disabled={isPending}
                    sx={{ textTransform: 'none', fontSize: '0.85rem', px: 2, minHeight: 36 }}
                  >
                    {t(a.labelKey as any)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══════ Right column: Timeline + meta ═══════ */}
        <div className="flex flex-col gap-5">

          {/* ── Timeline card ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <ScheduleIcon sx={{ fontSize: 16, color: '#6b7280' }} />
              {t('timeline')}
            </h2>
            <div>
              <TimelineStep
                label={t('booked')}
                time={r.createdAt}
                active={false}
              />
              {r.reminderSentAt && (
                <TimelineStep
                  label={t('reminderSent')}
                  time={r.reminderSentAt}
                  active={false}
                />
              )}
              <TimelineStep
                label={t('checkedIn')}
                time={r.checkedInAt}
                active={r.operationalStatus === OP_CHECKED_IN || r.operationalStatus === OP_WALKED_IN}
              />
              <TimelineStep
                label={r.operationalStatus === OP_NO_SHOW ? t('noShow') : t('departed')}
                time={r.operationalStatus === OP_NO_SHOW ? r.updatedAt : r.departedAt}
                active={r.operationalStatus === OP_DEPARTED || r.operationalStatus === OP_NO_SHOW}
                last
              />
            </div>
          </div>

          {/* ── Payment & meta card ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <PaymentIcon sx={{ fontSize: 16, color: '#6b7280' }} />
              {t('paymentTitle')}
            </h2>
            <div className="grid gap-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('status')}</span>
                <Chip
                  label={t(paymentStatusKey(r.status) as any)}
                  size="small"
                  color={paymentChipColor(r.status)}
                  variant="outlined"
                  sx={{ height: 22, fontSize: '0.65rem', fontWeight: 600 }}
                />
              </div>
              {r.paymentAmount != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t('amount')}</span>
                  <span className="text-gray-800 font-medium">€{r.paymentAmount.toFixed(2)}</span>
                </div>
              )}
              {r.paymentRef && (
                <div className="flex justify-between text-sm gap-4 min-w-0">
                  <span className="text-gray-500 flex-shrink-0">{t('reference')}</span>
                  <span className="text-gray-600 font-mono text-xs truncate">{r.paymentRef}</span>
                </div>
              )}
              <Divider sx={{ my: 0.5 }} />
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('type')}</span>
                <span className="text-gray-700">{isHourly ? t('hourly') : t('daily')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('created')}</span>
                <span className="text-gray-600 text-xs">{fmtDateTime(r.createdAt)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('updated')}</span>
                <span className="text-gray-600 text-xs">{fmtDateTime(r.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Confirm dialog ── */}
      <Dialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 600, pb: 0.5 }}>
          {confirmAction?.confirmTitleKey ? t(confirmAction.confirmTitleKey as any) : ''}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '0.85rem' }}>
            {confirmAction?.confirmBodyKey ? t(confirmAction.confirmBodyKey as any) : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmAction(null)} sx={{ textTransform: 'none' }}>
            {t('cancel')}
          </Button>
          <Button
            variant="contained"
            color={confirmAction?.color === 'error' ? 'error' : 'primary'}
            onClick={() => confirmAction && executeAction(confirmAction)}
            disabled={isPending}
            startIcon={isPending ? <CircularProgress size={14} /> : confirmAction?.icon}
            sx={{ textTransform: 'none' }}
          >
            {confirmAction ? t(confirmAction.labelKey as any) : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}