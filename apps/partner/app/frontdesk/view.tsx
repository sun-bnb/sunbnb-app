'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

/* ── MUI ───────────────────────────────────────────────────── */
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Alert from '@mui/material/Alert'
import Tooltip from '@mui/material/Tooltip'
import Divider from '@mui/material/Divider'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import CircularProgress from '@mui/material/CircularProgress'

import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import LoginIcon from '@mui/icons-material/Login'
import LogoutIcon from '@mui/icons-material/Logout'
import BlockIcon from '@mui/icons-material/Block'
import CancelIcon from '@mui/icons-material/Cancel'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn'
import PersonIcon from '@mui/icons-material/Person'
import EmailIcon from '@mui/icons-material/Email'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import TagIcon from '@mui/icons-material/Tag'
import NoteIcon from '@mui/icons-material/Note'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import BeachAccessIcon from '@mui/icons-material/BeachAccess'
import SurfingIcon from '@mui/icons-material/Surfing'

import {
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  OP_RESERVED,
  OP_PICKED_UP,
  OP_RETURNED,
} from '@repo/data/reservation-status'
import {
  checkInReservation,
  markDeparted,
  markNoShow,
  cancelReservation,
  updateNotes,
  markRentalPickedUp,
  markRentalReturned,
  cancelRentalBooking,
  searchAllReservations,
} from './actions'

/* ── Types ─────────────────────────────────────────────────── */

export interface SunbedReservation {
  id: string
  from: string
  to: string
  type: 'sunbed'
  status: string
  operationalStatus: string
  guestName: string | null
  guestContact: string | null
  guestEmail: string | null
  internalNotes: string | null
  checkedInAt: string | null
  departedAt: string | null
  siteName: string
  siteId: string
  itemCount: number
}

export interface RentalBooking {
  id: string
  from: string
  to: string
  type: 'rental'
  status: string
  operationalStatus: string
  guestName: string | null
  guestEmail: string | null
  siteName: string
  siteId: string
  rentalItemName: string
  quantity: number
  totalPrice: number
  pickedUpAt: string | null
  returnedAt: string | null
}

type BoardItem = SunbedReservation | RentalBooking

export interface TodayBoardData {
  sites: { id: string; name: string }[]
  sunbedReservations: SunbedReservation[]
  rentalBookings: RentalBooking[]
}

/* ── Helpers ───────────────────────────────────────────────── */

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function timeUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `in ${hrs}h ${rem}m` : `in ${hrs}h`
}

function opStatusKey(status: string): string {
  switch (status) {
    case OP_EXPECTED: return 'statusExpected'
    case OP_CHECKED_IN: return 'statusCheckedIn'
    case OP_WALKED_IN: return 'statusWalkIn'
    case OP_DEPARTED: return 'statusDeparted'
    case OP_NO_SHOW: return 'statusNoShow'
    case OP_RESERVED: return 'statusReserved'
    case OP_PICKED_UP: return 'statusPickedUp'
    case OP_RETURNED: return 'statusReturned'
    default: return status
  }
}

function opStatusChipColor(status: string): 'warning' | 'info' | 'success' | 'default' | 'error' {
  switch (status) {
    case OP_EXPECTED:
    case OP_RESERVED:
      return 'warning'
    case OP_CHECKED_IN:
    case OP_WALKED_IN:
    case OP_PICKED_UP:
      return 'info'
    case OP_DEPARTED:
    case OP_RETURNED:
      return 'success'
    case OP_NO_SHOW:
      return 'error'
    default:
      return 'default'
  }
}

/* ── Swim-lane definitions ─────────────────────────────────── */

interface Lane {
  key: string
  titleKey: string
  descriptionKey: string
  accentColor: string
  chipColor: 'warning' | 'info' | 'success'
  matchStatuses: string[]
}

const LANES: Lane[] = [
  {
    key: 'arriving',
    titleKey: 'laneTitleArriving',
    descriptionKey: 'laneDescArriving',
    accentColor: 'amber',
    chipColor: 'warning',
    matchStatuses: [OP_EXPECTED, OP_RESERVED],
  },
  {
    key: 'on-site',
    titleKey: 'laneTitleOnSite',
    descriptionKey: 'laneDescOnSite',
    accentColor: 'blue',
    chipColor: 'info',
    matchStatuses: [OP_CHECKED_IN, OP_WALKED_IN, OP_PICKED_UP],
  },
  {
    key: 'completed',
    titleKey: 'laneTitleCompleted',
    descriptionKey: 'laneDescCompleted',
    accentColor: 'green',
    chipColor: 'success',
    matchStatuses: [OP_DEPARTED, OP_NO_SHOW, OP_RETURNED],
  },
]

const laneColors: Record<string, { bg: string; border: string; headerBg: string }> = {
  amber: { bg: 'bg-amber-50/60', border: 'border-amber-200', headerBg: 'bg-amber-100/80' },
  blue: { bg: 'bg-blue-50/60', border: 'border-blue-200', headerBg: 'bg-blue-100/80' },
  green: { bg: 'bg-green-50/60', border: 'border-green-200', headerBg: 'bg-green-100/80' },
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

function getSunbedActions(opStatus: string): ActionDef[] {
  switch (opStatus) {
    case OP_EXPECTED:
      return [
        {
          labelKey: 'checkIn',
          icon: <LoginIcon sx={{ fontSize: 16 }} />,
          variant: 'contained',
          color: 'primary',
          action: checkInReservation,
        },
        {
          labelKey: 'noShow',
          icon: <BlockIcon sx={{ fontSize: 16 }} />,
          variant: 'outlined',
          color: 'inherit',
          needsConfirm: true,
          confirmTitleKey: 'confirmNoShowTitle',
          confirmBodyKey: 'confirmNoShowBody',
          action: markNoShow,
        },
        {
          labelKey: 'cancel',
          icon: <CancelIcon sx={{ fontSize: 16 }} />,
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
      return [{
        labelKey: 'markDeparted',
        icon: <LogoutIcon sx={{ fontSize: 16 }} />,
        variant: 'contained',
        color: 'success',
        action: markDeparted,
      }]
    default:
      return []
  }
}

function getRentalActions(opStatus: string): ActionDef[] {
  switch (opStatus) {
    case OP_RESERVED:
      return [
        {
          labelKey: 'pickedUp',
          icon: <Inventory2OutlinedIcon sx={{ fontSize: 16 }} />,
          variant: 'contained',
          color: 'primary',
          action: markRentalPickedUp,
        },
        {
          labelKey: 'cancel',
          icon: <CancelIcon sx={{ fontSize: 16 }} />,
          variant: 'text',
          color: 'error',
          needsConfirm: true,
          confirmTitleKey: 'confirmCancelRentalTitle',
          confirmBodyKey: 'confirmCancelRentalBody',
          action: cancelRentalBooking,
        },
      ]
    case OP_PICKED_UP:
      return [{
        labelKey: 'returned',
        icon: <AssignmentReturnIcon sx={{ fontSize: 16 }} />,
        variant: 'contained',
        color: 'success',
        action: markRentalReturned,
      }]
    default:
      return []
  }
}

/* ── Card component ────────────────────────────────────────── */

function BoardCard({ item, expanded, onToggle }: {
  item: BoardItem
  expanded: boolean
  onToggle: () => void
}) {
  const router = useRouter()
  const t = useTranslations('Frontdesk')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ActionDef | null>(null)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)

  const isRental = item.type === 'rental'
  const rental = isRental ? (item as RentalBooking) : null
  const sunbed = !isRental ? (item as SunbedReservation) : null

  const now = Date.now()
  const fromTime = new Date(item.from).getTime()
  const isFuture = fromTime > now

  const actions = isRental
    ? getRentalActions(item.operationalStatus)
    : getSunbedActions(item.operationalStatus)

  const email = sunbed?.guestContact || sunbed?.guestEmail || rental?.guestEmail

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
      const result = await actionDef.action(item.id)
      if (result.status === 'error') {
        setError(result.errors?.[0] ?? 'Something went wrong')
      } else {
        router.refresh()
      }
    })
  }

  const handleSaveNotes = async () => {
    if (!sunbed) return
    setNotesSaving(true)
    const result = await updateNotes(item.id, notesValue)
    setNotesSaving(false)
    if (result.status === 'ok') {
      setEditingNotes(false)
      router.refresh()
    } else {
      setError(result.errors?.[0] ?? 'Failed to save notes')
    }
  }

  const startEditNotes = () => {
    setNotesValue(sunbed?.internalNotes || '')
    setEditingNotes(true)
  }

  const detailHref = isRental
    ? `/sites/${item.siteId}/manage`
    : `/reservations/${item.id}`

  return (
    <>
      <div className={`bg-white rounded-lg border transition-all ${
        expanded ? 'border-gray-300 shadow-md ring-1 ring-gray-200' : 'border-gray-200 hover:border-gray-300'
      } ${isPending ? 'opacity-50 pointer-events-none' : ''}`}>

        {/* ── Card header (always visible) ── */}
        <button onClick={onToggle} className="w-full text-left px-3.5 py-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-gray-900 truncate">
                  {item.guestName || t('guest')}
                </span>
                <Chip
                  label={isRental ? t('rental') : t('sunbed')}
                  size="small"
                  icon={isRental
                    ? <SurfingIcon sx={{ fontSize: 14 }} />
                    : <BeachAccessIcon sx={{ fontSize: 14 }} />
                  }
                  sx={{ height: 20, fontSize: '0.65rem', fontWeight: 600, '& .MuiChip-icon': { fontSize: 14 } }}
                  color={isRental ? 'secondary' : 'primary'}
                  variant="outlined"
                />
              </div>

              <p className="text-xs text-gray-500 mb-1.5">{item.siteName}</p>

              <div className="flex items-center gap-2 flex-wrap">
                <Chip
                  label={`${formatTime(item.from)} – ${formatTime(item.to)}`}
                  size="small"
                  variant="outlined"
                  sx={{ height: 22, fontSize: '0.7rem', fontWeight: 500, borderColor: '#e5e7eb', color: '#4b5563' }}
                />
                {sunbed && (
                  <span className="text-xs text-gray-500">
                    {t('sunbeds', { count: sunbed.itemCount })}
                  </span>
                )}
                {rental && (
                  <span className="text-xs text-gray-500">
                    {rental.quantity}× {rental.rentalItemName}
                  </span>
                )}
                {isFuture && (
                  <span className="text-xs text-amber-600 font-medium">{timeUntil(item.from)}</span>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
              <div className="flex items-center gap-1">
                <Chip
                  label={t(opStatusKey(item.operationalStatus) as any)}
                  size="small"
                  color={opStatusChipColor(item.operationalStatus)}
                  sx={{ height: 22, fontSize: '0.65rem', fontWeight: 600 }}
                />
                <Tooltip title={t('viewDetails')} arrow>
                  <IconButton
                    size="small"
                    component={Link}
                    href={detailHref}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    sx={{ color: '#9ca3af', p: 0.4 }}
                  >
                    <OpenInNewIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </div>
              <div className="flex items-center gap-0.5">
                {sunbed?.internalNotes && (
                  <Tooltip title={sunbed.internalNotes} arrow placement="top">
                    <NoteIcon sx={{ fontSize: 14, color: '#9ca3af' }} />
                  </Tooltip>
                )}
                <ExpandMoreIcon
                  sx={{
                    fontSize: 18,
                    color: '#9ca3af',
                    transition: 'transform 150ms',
                    transform: expanded ? 'rotate(180deg)' : 'none',
                  }}
                />
              </div>
            </div>
          </div>
        </button>

        {/* ── Expanded detail panel ── */}
        <Collapse in={expanded}>
          <div className="border-t border-gray-100">
            <div className="px-3.5 pt-3 pb-2">
              <div className="grid gap-1.5">
                {item.guestName && (
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <PersonIcon sx={{ fontSize: 15, color: '#9ca3af' }} />
                    <span>{item.guestName}</span>
                  </div>
                )}
                {email && (
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <EmailIcon sx={{ fontSize: 15, color: '#9ca3af' }} />
                    <span className="truncate">{email}</span>
                  </div>
                )}
                {sunbed?.checkedInAt && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <AccessTimeIcon sx={{ fontSize: 15, color: '#9ca3af' }} />
                    <span>{t('checkedInAt', { time: formatTime(sunbed.checkedInAt) })}</span>
                  </div>
                )}
                {sunbed?.departedAt && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <AccessTimeIcon sx={{ fontSize: 15, color: '#9ca3af' }} />
                    <span>{t('departedAt', { time: formatTime(sunbed.departedAt) })}</span>
                  </div>
                )}
                {rental?.pickedUpAt && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <AccessTimeIcon sx={{ fontSize: 15, color: '#9ca3af' }} />
                    <span>{t('pickedUpAt', { time: formatTime(rental.pickedUpAt) })}</span>
                  </div>
                )}
                {rental?.returnedAt && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <AccessTimeIcon sx={{ fontSize: 15, color: '#9ca3af' }} />
                    <span>{t('returnedAt', { time: formatTime(rental.returnedAt) })}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <TagIcon sx={{ fontSize: 15, color: '#d1d5db' }} />
                  <span className="font-mono text-[10px] select-all">{item.id}</span>
                </div>
              </div>
            </div>

            {/* Internal notes (sunbed only) */}
            {sunbed && (
              <div className="px-3.5 pb-2">
                {editingNotes ? (
                  <div className="flex flex-col gap-1.5">
                    <TextField
                      value={notesValue}
                      onChange={e => setNotesValue(e.target.value)}
                      inputProps={{ maxLength: 500 }}
                      multiline
                      rows={2}
                      size="small"
                      placeholder={t('notesPlaceholder')}
                      fullWidth
                      autoFocus
                      sx={{ '& .MuiInputBase-input': { fontSize: '0.75rem' } }}
                    />
                    <div className="flex gap-1.5 justify-end">
                      <Button
                        size="small"
                        onClick={() => setEditingNotes(false)}
                        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                      >
                        {t('cancel')}
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={handleSaveNotes}
                        disabled={notesSaving}
                        startIcon={notesSaving ? <CircularProgress size={12} /> : undefined}
                        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                      >
                        {notesSaving ? t('saving') : t('save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={startEditNotes}
                    className="w-full text-left text-xs px-2.5 py-2 rounded-md border border-dashed border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50 transition-colors flex items-center gap-2"
                  >
                    <NoteIcon sx={{ fontSize: 14, color: '#9ca3af' }} />
                    {sunbed.internalNotes ? (
                      <span className="truncate">{sunbed.internalNotes}</span>
                    ) : (
                      <span className="text-gray-400">{t('addNotes')}</span>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Error */}
            <Collapse in={!!error}>
              <div className="px-3.5 pb-2">
                <Alert severity="error" variant="outlined" sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.75rem' } }}
                  onClose={() => setError(null)}
                >
                  {error}
                </Alert>
              </div>
            </Collapse>

            {/* Action buttons + detail link */}
            <div className="px-3.5 pb-3 pt-1">
              <Divider sx={{ mb: 1.5 }} />
              <div className="flex items-center gap-1.5 flex-wrap">
                {actions.map(a => (
                  <Button
                    key={a.labelKey}
                    size="small"
                    variant={a.variant}
                    color={a.color}
                    startIcon={a.icon}
                    onClick={() => handleAction(a)}
                    disabled={isPending}
                    sx={{
                      textTransform: 'none',
                      fontSize: '0.75rem',
                      lineHeight: 1.5,
                      px: 1.5,
                      minHeight: 30,
                    }}
                  >
                    {t(a.labelKey as any)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </Collapse>
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
          <Button
            onClick={() => setConfirmAction(null)}
            sx={{ textTransform: 'none' }}
          >
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
    </>
  )
}

/* ── Search helper ──────────────────────────────────────────── */

function matchesSearch(item: BoardItem, query: string): boolean {
  const q = query.toLowerCase()
  if (item.id.toLowerCase().includes(q)) return true
  if (item.guestName?.toLowerCase().includes(q)) return true
  const email = 'guestEmail' in item ? (item as any).guestEmail : null
  if (email?.toLowerCase().includes(q)) return true
  if (item.type === 'sunbed') {
    const s = item as SunbedReservation
    if (s.guestContact?.toLowerCase().includes(q)) return true
  }
  return false
}

/* ── Main view ─────────────────────────────────────────────── */

export default function TodayBoardView({ data }: { data: TodayBoardData }) {
  const t = useTranslations('Frontdesk')
  const [selectedSiteId, setSelectedSiteId] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<BoardItem[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearchQuery(value.trim()), 300)
  }, [])

  const clearSearch = useCallback(() => {
    setSearchInput('')
    setSearchQuery('')
    setSearchResults(null)
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  // Server-side search when query changes
  useEffect(() => {
    if (!searchQuery) {
      setSearchResults(null)
      return
    }
    let cancelled = false
    setSearchLoading(true)
    searchAllReservations(searchQuery).then(res => {
      if (cancelled) return
      const items: BoardItem[] = [...res.sunbedReservations, ...res.rentalBookings]
      items.sort((a, b) => new Date(b.from).getTime() - new Date(a.from).getTime())
      setSearchResults(items)
      setSearchLoading(false)
    })
    return () => { cancelled = true }
  }, [searchQuery])

  const isSearching = !!searchQuery

  // Board items (today's data, filtered by site — used when NOT searching)
  const allItems: BoardItem[] = useMemo(() => {
    let items: BoardItem[] = [
      ...data.sunbedReservations,
      ...data.rentalBookings,
    ]
    if (selectedSiteId !== 'all') {
      items = items.filter(i => i.siteId === selectedSiteId)
    }
    return items
  }, [data, selectedSiteId])

  // Group into lanes
  const laneItems = useMemo(() => {
    const map: Record<string, BoardItem[]> = {}
    for (const lane of LANES) {
      map[lane.key] = allItems.filter(item =>
        lane.matchStatuses.includes(item.operationalStatus)
      )
    }
    return map
  }, [allItems])

  const totalCount = allItems.length
  const arrivingCount = laneItems['arriving']?.length ?? 0
  const onSiteCount = laneItems['on-site']?.length ?? 0
  const completedCount = laneItems['completed']?.length ?? 0

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {t('bookings', { count: totalCount })}
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <TextField
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder={t('searchPlaceholder')}
            size="small"
            sx={{
              width: 240,
              '& .MuiInputBase-root': { fontSize: '0.85rem', borderRadius: '8px' },
              '& .MuiInputBase-input::placeholder': { fontSize: '0.82rem' },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18, color: '#9ca3af' }} />
                </InputAdornment>
              ),
              endAdornment: searchInput ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => { setSearchInput(''); setSearchQuery('') }}
                    edge="end"
                  >
                    <ClearIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />

          {!isSearching && data.sites.length > 1 && (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <Select
                value={selectedSiteId}
                onChange={e => setSelectedSiteId(e.target.value)}
                displayEmpty
                sx={{ fontSize: '0.85rem', borderRadius: '8px' }}
              >
                <MenuItem value="all">{t('allSites')}</MenuItem>
                {data.sites.map(s => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </div>
      </div>

      {/* ── Search results mode ── */}
      {isSearching ? (
        <>
          <p className="text-sm text-gray-500 mb-4">
            {searchLoading
              ? t('searching')
              : t('searchResultsFor', { count: searchResults?.length ?? 0, query: searchQuery })
            }
          </p>

          {searchLoading && (
            <div className="flex justify-center py-12">
              <CircularProgress size={28} />
            </div>
          )}

          {!searchLoading && searchResults && searchResults.length === 0 && (
            <div className="text-center py-16 bg-gray-50 rounded-xl border border-gray-200">
              <SearchIcon sx={{ fontSize: 48, color: '#d1d5db', mb: 1 }} />
              <h2 className="text-lg font-semibold text-gray-600 mb-1">{t('noResultsTitle')}</h2>
              <p className="text-sm text-gray-400">{t('noResultsBody')}</p>
            </div>
          )}

          {!searchLoading && searchResults && searchResults.length > 0 && (
            <div className="flex flex-col gap-2">
              {searchResults.map(item => (
                <BoardCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* ── Summary chips ── */}
          <div className="flex flex-wrap gap-2 mb-5">
            <Chip
              label={t('arriving', { count: arrivingCount })}
              size="small"
              color="warning"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: '0.78rem', height: 28 }}
            />
            <Chip
              label={t('onSite', { count: onSiteCount })}
              size="small"
              color="info"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: '0.78rem', height: 28 }}
            />
            <Chip
              label={t('completed', { count: completedCount })}
              size="small"
              color="success"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: '0.78rem', height: 28 }}
            />
          </div>

          {/* ── Empty state ── */}
          {totalCount === 0 && (
            <div className="text-center py-16 bg-gray-50 rounded-xl border border-gray-200">
              <BeachAccessIcon sx={{ fontSize: 48, color: '#d1d5db', mb: 1 }} />
              <h2 className="text-lg font-semibold text-gray-600 mb-1">{t('noBookingsTitle')}</h2>
              <p className="text-sm text-gray-400">
                {selectedSiteId !== 'all'
                  ? t('noBookingsSiteBody')
                  : t('noBookingsBody')}
              </p>
            </div>
          )}

          {/* ── Swim lanes ── */}
          {totalCount > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {LANES.map(lane => {
                const items = laneItems[lane.key] ?? []
                const colors = laneColors[lane.accentColor]!

                return (
                  <div key={lane.key} className={`rounded-xl border ${colors.border} ${colors.bg}`}>
                    <div className={`px-4 py-3 ${colors.headerBg} rounded-t-xl border-b ${colors.border}`}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-800">{t(lane.titleKey as any)}</h3>
                        <Chip
                          label={items.length}
                          size="small"
                          color={lane.chipColor}
                          sx={{ height: 22, fontSize: '0.7rem', fontWeight: 700, minWidth: 28 }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{t(lane.descriptionKey as any)}</p>
                    </div>

                    <div className="p-2.5 flex flex-col gap-2">
                      {items.length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-6">{t('noBookings')}</p>
                      )}
                      {items.map(item => (
                        <BoardCard
                          key={item.id}
                          item={item}
                          expanded={expandedId === item.id}
                          onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
