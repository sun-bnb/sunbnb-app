'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  APIProvider,
  ControlPosition,
  Map,
  AdvancedMarker,
} from '@vis.gl/react-google-maps'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import Divider from '@mui/material/Divider'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import CircularProgress from '@mui/material/CircularProgress'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import PaymentsIcon from '@mui/icons-material/Payments'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import SyncIcon from '@mui/icons-material/Sync'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'

import SurfingIcon from '@mui/icons-material/Surfing'

import { useSite } from '@/app/sites/site-context'
import { ServiceFee } from '@/types/shared'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'
import {
  saveGeneral,
  deleteSite,
  setSiteStatus,
} from '../site-actions'
import { addWorkingHours, deleteWorkingHours, updateWorkingHours } from '../working-hours-actions'
import { toggleSiteFeature } from '../rentals/actions'

function round(amount: number) {
  return Math.round(amount * 100) / 100
}

const TIER_ORDER = ['STARTER', 'PRO', 'BUSINESS'] as const
const TIER_LABELS: Record<string, string> = { STARTER: 'Starter', PRO: 'Pro', BUSINESS: 'Business' }
const TIER_FEES: Record<string, string> = { STARTER: '5%', PRO: '2%', BUSINESS: '0%' }

function PriceBreakdown({
  price,
  vat: vatStr,
  serviceFees,
  tier,
}: {
  price: string
  vat: string
  serviceFees?: ServiceFee[]
  tier: string
}) {
  const t = useTranslations('SiteGeneral')
  const priceNum = Number(price)
  if (!priceNum || priceNum <= 0) return null

  const vatRate = Number(vatStr) || 0
  const serviceFee = serviceFees?.find(f => f.serviceCode === 'sunbed-rental')

  const feeAmount = serviceFee
    ? serviceFee.chargeType === 'fixed'
      ? (serviceFee.feeAmount ?? 0)
      : round(((serviceFee.percentage ?? 0) / 100) * priceNum)
    : 0

  const partnerGross = round(priceNum - feeAmount)
  const partnerBase = vatRate > 0
    ? round(partnerGross / (1 + vatRate / 100))
    : partnerGross
  const partnerVat = round(partnerGross - partnerBase)

  // Build processing fee label parts
  const procParts: string[] = []
  const procLabel = ''

  return (
    <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 text-xs">
      <div className="flex justify-between text-gray-500 mb-1">
        <span>{t('customerPays')}</span>
        <span>{priceNum.toFixed(2)} &euro;</span>
      </div>
      {feeAmount > 0 && (
        <div className="flex justify-between text-gray-500 mb-1">
          <span>
            {t('serviceFee')}
            {serviceFee?.chargeType === 'fixed'
              ? ''
              : ` (${(serviceFee?.percentage ?? 0).toFixed(0)}%)`}
          </span>
          <span className="text-red-500">&minus;{feeAmount.toFixed(2)} &euro;</span>
        </div>
      )}
      {feeAmount > 0 && (() => {
        const tierIdx = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number])
        const nextTier = tierIdx >= 0 && tierIdx < TIER_ORDER.length - 1 ? TIER_ORDER[tierIdx + 1] : null
        return nextTier ? (
          <div className="text-[11px] text-indigo-500 mb-1">
            {t('upgradeTier', { tier: TIER_LABELS[nextTier], fee: TIER_FEES[nextTier] })}
          </div>
        ) : null
      })()}
      <div className="border-t border-gray-200 my-1.5" />
      <div className="flex justify-between font-medium text-gray-800 mb-1">
        <span>{t('youReceive')}</span>
        <span>{partnerGross.toFixed(2)} &euro;</span>
      </div>
      {vatRate > 0 && (
        <div className="flex justify-between text-gray-400">
          <span>{t('inclVat', { rate: vatRate })}</span>
          <span>{partnerVat.toFixed(2)} &euro;</span>
        </div>
      )}
      {!serviceFee && (
        <div className="flex justify-between text-gray-400 italic">
          <span>{t('noServiceFee')}</span>
        </div>
      )}
    </div>
  )
}

type Slot = { id: string; day: number; openTime: Date; closeTime: Date }

function WorkingHoursSlot({
  slot,
  timeToLabel,
  formatTime,
  onSave,
  onDelete,
}: {
  slot: Slot
  timeToLabel: string
  formatTime: (d: Date) => string
  onSave: (id: string, openTime: string, closeTime: string) => Promise<void> | void
  onDelete: (id: string) => Promise<void> | void
}) {
  const initialOpen = formatTime(slot.openTime)
  const initialClose = formatTime(slot.closeTime)
  const [openTime, setOpenTime] = useState(initialOpen)
  const [closeTime, setCloseTime] = useState(initialClose)

  // Resync local inputs when the server returns updated values for this slot.
  useEffect(() => {
    setOpenTime(initialOpen)
    setCloseTime(initialClose)
  }, [initialOpen, initialClose])

  const commit = (nextOpen: string, nextClose: string) => {
    if (nextOpen === initialOpen && nextClose === initialClose) return
    if (!/^\d{2}:\d{2}$/.test(nextOpen) || !/^\d{2}:\d{2}$/.test(nextClose)) return
    onSave(slot.id, nextOpen, nextClose)
  }

  const inputCls =
    'text-sm text-gray-700 bg-transparent border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-400'

  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={openTime}
        onChange={e => setOpenTime(e.target.value)}
        onBlur={() => commit(openTime, closeTime)}
        className={inputCls}
      />
      <span className="text-xs text-gray-400">{timeToLabel}</span>
      <input
        type="time"
        value={closeTime}
        onChange={e => setCloseTime(e.target.value)}
        onBlur={() => commit(openTime, closeTime)}
        className={inputCls}
      />
      <IconButton size="small" onClick={() => onDelete(slot.id)}>
        <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
      </IconButton>
    </div>
  )
}

const WEEK_DAYS = [
  { key: '1', short: 'Mon', label: 'Monday' },
  { key: '2', short: 'Tue', label: 'Tuesday' },
  { key: '3', short: 'Wed', label: 'Wednesday' },
  { key: '4', short: 'Thu', label: 'Thursday' },
  { key: '5', short: 'Fri', label: 'Friday' },
  { key: '6', short: 'Sat', label: 'Saturday' },
  { key: '7', short: 'Sun', label: 'Sunday' },
]

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function GeneralView() {
  const { site, apiKey } = useSite()
  const router = useRouter()
  const t = useTranslations('SiteGeneral')

  const [selectedPlace, setSelectedPlace] =
    useState<google.maps.places.PlaceResult | null>(null)

  const [name, setName] = useState(site.name || '')
  const [siteType, setSiteType] = useState(site.type ?? 'paid')
  const [price, setPrice] = useState(site.price?.toString() || '')
  const [vat, setVat] = useState(site.vat?.toString() || '')
  const [mapCoords, setMapCoords] = useState<{ lat: number; lng: number }>(
    { lat: +site.locationLat!, lng: +site.locationLng! }
  )
  const [siteStatus, setSiteStatusLocal] = useState(site.status ?? 'hidden')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [features, setFeatures] = useState<string[]>(site.features || ['sunbeds'])
  const [layoutMode, setLayoutMode] = useState<'geo' | 'schematic'>(
    (site.layoutMode as 'geo' | 'schematic' | undefined) ?? 'geo',
  )
  const [layoutWidth, setLayoutWidth] = useState(site.layoutWidth?.toString() ?? '50')
  const [layoutHeight, setLayoutHeight] = useState(site.layoutHeight?.toString() ?? '35')
  const [layoutLockedReason, setLayoutLockedReason] = useState<string | null>(null)
  const layoutLocked = (site.inventoryItems?.length ?? 0) > 0

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)

  const doSave = useCallback(async (overrides?: {
    name?: string
    type?: string
    price?: string
    vat?: string
    lat?: string
    lng?: string
    layoutMode?: 'geo' | 'schematic'
    layoutWidth?: string
    layoutHeight?: string
  }) => {
    setSaveStatus('saving')
    try {
      const result = await saveGeneral({
        id: site.id!,
        name: overrides?.name ?? name,
        type: overrides?.type ?? siteType,
        price: overrides?.price ?? price,
        vat: overrides?.vat ?? vat,
        locationLat: overrides?.lat ?? mapCoords.lat.toString(),
        locationLng: overrides?.lng ?? mapCoords.lng.toString(),
        ...(overrides?.layoutMode !== undefined ? { layoutMode: overrides.layoutMode } : {}),
        ...(overrides?.layoutWidth !== undefined ? { layoutWidth: overrides.layoutWidth } : {}),
        ...(overrides?.layoutHeight !== undefined ? { layoutHeight: overrides.layoutHeight } : {}),
      })
      if (result.status === 'ok') {
        setSaveStatus('saved')
        setLayoutLockedReason(null)
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('error')
        const lockMsg = result.errors?.find(e => e.includes('layout mode'))
        if (lockMsg) setLayoutLockedReason(lockMsg)
      }
    } catch {
      setSaveStatus('error')
    }
  }, [site.id, name, siteType, price, vat, mapCoords])

  const scheduleSave = useCallback((overrides?: Parameters<typeof doSave>[0]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSave(overrides), 2000)
  }, [doSave])

  // Immediate save (for clicks like type change, map click)
  const immediateSave = useCallback((overrides?: Parameters<typeof doSave>[0]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    doSave(overrides)
  }, [doSave])

  const SafeAPIProvider = APIProvider as unknown as React.ComponentType<any>
  const SafeMap = Map as unknown as React.ComponentType<any>
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

  const formatTime = (date: Date) =>
    `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`

  const [workingHours, setWorkingHours] = useState(site.workingHours ?? [])

  const sortedHours = useMemo(
    () => [...workingHours].sort((a, b) => a.day - b.day),
    [workingHours],
  )

  const hoursForDay = (dayKey: string) =>
    sortedHours.filter(h => h.day === Number(dayKey))

  const applyHoursResult = (result: Awaited<ReturnType<typeof addWorkingHours>>) => {
    if (result.status === 'ok' && result.workingHours) {
      setWorkingHours(result.workingHours)
      setSaveStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
    } else {
      setSaveStatus('error')
    }
  }

  const onAddHours = async (dayKey: string) => {
    setSaveStatus('saving')
    applyHoursResult(
      await addWorkingHours(site.id!, { day: dayKey, openTime: '09:00', closeTime: '18:00' }),
    )
  }

  const onDeleteHours = async (id: string) => {
    setSaveStatus('saving')
    applyHoursResult(await deleteWorkingHours(id))
  }

  const onUpdateHours = async (id: string, openTime: string, closeTime: string) => {
    setSaveStatus('saving')
    applyHoursResult(await updateWorkingHours(id, { openTime, closeTime }))
  }

  const isPaid = siteType === 'paid'
  const tier = site.subscriptionTier ?? 'STARTER'
  const canUseAvailabilityOnly = tier === 'PRO' || tier === 'BUSINESS'

  return (
    <div className="pt-2">

      {/* Save status indicator — sticky top bar */}
      <div className={`flex items-center justify-center gap-2 px-3 py-2 rounded mb-4 text-sm transition-all ${
        saveStatus === 'saving' ? 'bg-blue-50 border border-blue-200 text-blue-600' :
        saveStatus === 'saved' ? 'bg-green-50 border border-green-200 text-green-600' :
        saveStatus === 'error' ? 'bg-red-50 border border-red-200 text-red-600' :
        'bg-gray-50 border border-gray-200 text-gray-400'
      }`}>
        {saveStatus === 'saving' && <><SyncIcon fontSize="small" className="animate-spin" /> {t('saving')}</>}
        {saveStatus === 'saved' && <><CloudDoneIcon fontSize="small" /> {t('allChangesSaved')}</>}
        {saveStatus === 'error' && <><WarningAmberIcon fontSize="small" /> {t('errorSaving')}</>}
        {saveStatus === 'idle' && <><CloudDoneIcon fontSize="small" /> {t('upToDate')}</>}
      </div>

      {/* Site name */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{t('siteName')}</h3>
        <TextField
          fullWidth
          required
          value={name}
          onChange={e => {
            setName(e.target.value)
            scheduleSave({ name: e.target.value })
          }}
          helperText={t('siteNameHelper')}
        />
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Billing type — Reservations */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{t('reservationBilling')}</h3>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setSiteType('paid')
              immediateSave({ type: 'paid' })
            }}
            className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
              isPaid
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <PaymentsIcon fontSize="small" className={isPaid ? 'text-blue-600' : 'text-gray-400'} />
              <span className={`font-medium text-sm ${isPaid ? 'text-blue-700' : 'text-gray-700'}`}>
                {t('integratedPayments')}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {t('integratedPaymentsDesc')}
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!canUseAvailabilityOnly) return
              setSiteType('unpaid')
              setPrice('')
              immediateSave({ type: 'unpaid', price: '' })
            }}
            disabled={!canUseAvailabilityOnly}
            className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
              !canUseAvailabilityOnly
                ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                : !isPaid
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <EventAvailableIcon fontSize="small" className={!canUseAvailabilityOnly ? 'text-gray-300' : !isPaid ? 'text-blue-600' : 'text-gray-400'} />
              <span className={`font-medium text-sm ${!canUseAvailabilityOnly ? 'text-gray-400' : !isPaid ? 'text-blue-700' : 'text-gray-700'}`}>
                {t('offPlatformBilling')}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {t('offPlatformBillingDesc')}
            </p>
            {!canUseAvailabilityOnly && (
              <p className="text-xs text-amber-600 mt-1.5 font-medium">{t('proOrBusinessRequired')}</p>
            )}
          </button>
        </div>
      </div>

      {/* Pricing — only for paid */}
      {isPaid && (
        <div className="mb-5">
          <div className="flex gap-3">
            <TextField
              fullWidth
              label={t('basePrice')}
              type="number"
              value={price}
              onChange={e => {
                setPrice(e.target.value)
                scheduleSave({ price: e.target.value })
              }}
              placeholder="e.g. 15"
              helperText={t('basePriceHelper')}
            />
            <TextField
              sx={{ width: 180, flexShrink: 0 }}
              label={t('taxRate')}
              type="number"
              value={vat}
              onChange={e => {
                setVat(e.target.value)
                scheduleSave({ vat: e.target.value })
              }}
              placeholder="e.g. 21"
              helperText={t('taxRateHelper')}
            />
          </div>
          <PriceBreakdown price={price} vat={vat} serviceFees={site.serviceFees} tier={tier} />
        </div>
      )}

      <Divider sx={{ mb: 3 }} />

      {/* Booking hours */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-1">{t('bookingHours')}</h3>
        <p className="text-xs text-gray-500 mb-3">
          {t('bookingHoursDesc')}
        </p>

        <div className="flex flex-col gap-1">
          {WEEK_DAYS.map(day => {
            const slots = hoursForDay(day.key)
            const isActive = slots.length > 0

            return (
              <div
                key={day.key}
                className={`rounded-lg border px-3 py-2 transition-all ${
                  isActive ? 'border-gray-200 bg-white' : 'border-transparent bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Switch
                    size="small"
                    checked={isActive}
                    onChange={async () => {
                      if (isActive) {
                        setSaveStatus('saving')
                        let last: Awaited<ReturnType<typeof deleteWorkingHours>> | null = null
                        for (const s of slots) {
                          last = await deleteWorkingHours(s.id)
                        }
                        if (last) applyHoursResult(last)
                      } else {
                        await onAddHours(day.key)
                      }
                    }}
                  />
                  <span className={`text-sm w-12 ${isActive ? 'font-medium text-gray-800' : 'text-gray-400'}`}>
                    {day.short}
                  </span>

                  {isActive ? (
                    <div className="flex-1 flex flex-col gap-1">
                      {slots.map(slot => (
                        <WorkingHoursSlot
                          key={slot.id}
                          slot={slot}
                          timeToLabel={t('timeTo')}
                          formatTime={formatTime}
                          onSave={onUpdateHours}
                          onDelete={onDeleteHours}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">{t('closed')}</span>
                  )}

                  {isActive && (
                    <Button
                      size="small"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() => onAddHours(day.key)}
                      sx={{ textTransform: 'none', fontSize: '0.7rem', minWidth: 0, ml: 1 }}
                    >
                      {t('split')}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {t('splitHint')}
        </p>
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Site location */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{t('location')}</h3>
        <p className="text-xs text-gray-500 mb-3">
          {t('locationDesc')}
        </p>

        <div className="flex items-center gap-2 px-3 py-2 rounded mb-3 text-sm bg-green-50 border border-green-200 text-green-700">
          <CheckCircleIcon fontSize="small" />
          <span>{t('locationCoords', { lat: Number(mapCoords.lat).toFixed(5), lng: Number(mapCoords.lng).toFixed(5) })}</span>
        </div>

        <div className="h-[400px] rounded overflow-hidden border-2 border-green-300">
          <SafeAPIProvider apiKey={apiKey}>
            <SafeMap
              mapId="site-map"
              defaultZoom={9}
              defaultCenter={{ lat: +site.locationLat!, lng: +site.locationLng! }}
              gestureHandling="greedy"
              disableDefaultUI
              onClick={(e: any) => {
                if (e.detail.latLng) {
                  const { lat, lng } = e.detail.latLng
                  setMapCoords({ lat, lng })
                  immediateSave({ lat: lat.toString(), lng: lng.toString() })
                }
              }}
            >
              <SafeAdvancedMarker position={mapCoords} />
              <CustomMapControl
                controlPosition={ControlPosition.TOP_LEFT}
                onPlaceSelect={setSelectedPlace}
              />
              <MapHandler place={selectedPlace} />
            </SafeMap>
          </SafeAPIProvider>
        </div>
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Site visibility */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{t('visibility')}</h3>
        <div className={`flex items-center justify-between rounded-lg border-2 p-4 transition-all ${
          siteStatus === 'active'
            ? 'border-green-300 bg-green-50'
            : 'border-gray-200 bg-gray-50'
        }`}>
          <div className="flex items-center gap-3">
            {siteStatus === 'active' ? (
              <VisibilityIcon className="text-green-600" />
            ) : (
              <VisibilityOffIcon className="text-gray-400" />
            )}
            <div>
              <div className={`text-sm font-medium ${siteStatus === 'active' ? 'text-green-700' : 'text-gray-700'}`}>
                {siteStatus === 'active' ? t('siteIsLive') : t('siteIsHidden')}
              </div>
              <div className="text-xs text-gray-500">
                {siteStatus === 'active'
                  ? t('siteIsLiveDesc')
                  : t('siteIsHiddenDesc')}
              </div>
            </div>
          </div>
          <Switch
            checked={siteStatus === 'active'}
            onChange={async () => {
              const newStatus = siteStatus === 'active' ? 'hidden' : 'active'
              const result = await setSiteStatus(site.id!, newStatus)
              if (result.status === 'ok') {
                setSiteStatusLocal(newStatus)
              }
            }}
            color="success"
          />
        </div>
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Payment provider */}
      {isPaid && (
        <div className="mb-5">
          <h3 className="text-sm font-medium text-gray-700 mb-2">{t('paymentProvider')}</h3>
          <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4">
            <div className="flex items-center gap-2 mb-1">
              <PaymentsIcon fontSize="small" className="text-blue-600" />
              <span className="font-medium text-sm text-blue-700">{t('mollie')}</span>
            </div>
            <p className="text-xs text-gray-500">
              {t('mollieDesc')}
            </p>
          </div>
        </div>
      )}

      <Divider sx={{ mb: 3 }} />

      {/* Site features */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{t('siteFeatures')}</h3>
        <p className="text-xs text-gray-500 mb-3">
          {t('siteFeaturesDesc')}
        </p>
        <div className="space-y-2">
          <div className={`flex items-center justify-between rounded-lg border-2 p-3 transition-all ${
            features.includes('sunbeds')
              ? 'border-blue-300 bg-blue-50'
              : 'border-gray-200 bg-gray-50'
          }`}>
            <div className="flex items-center gap-3">
              <span className="text-xl">⛱️</span>
              <div>
                <div className="text-sm font-medium text-gray-700">{t('sunbedReservations')}</div>
                <div className="text-xs text-gray-500">{t('sunbedReservationsDesc')}</div>
              </div>
            </div>
            <Switch
              checked={features.includes('sunbeds')}
              onChange={async () => {
                const enabled = !features.includes('sunbeds')
                const result = await toggleSiteFeature(site.id!, 'sunbeds', enabled)
                if (result.status === 'ok' && result.features) {
                  setFeatures(result.features)
                }
              }}
              color="primary"
            />
          </div>
          <div className={`flex items-center justify-between rounded-lg border-2 p-3 transition-all ${
            features.includes('rentals')
              ? 'border-blue-300 bg-blue-50'
              : 'border-gray-200 bg-gray-50'
          }`}>
            <div className="flex items-center gap-3">
              <SurfingIcon className={features.includes('rentals') ? 'text-blue-600' : 'text-gray-400'} />
              <div>
                <div className="text-sm font-medium text-gray-700">{t('equipmentRental')}</div>
                <div className="text-xs text-gray-500">{t('equipmentRentalDesc')}</div>
              </div>
            </div>
            <Switch
              checked={features.includes('rentals')}
              onChange={async () => {
                const enabled = !features.includes('rentals')
                const result = await toggleSiteFeature(site.id!, 'rentals', enabled)
                if (result.status === 'ok' && result.features) {
                  setFeatures(result.features)
                }
              }}
              color="primary"
            />
          </div>
        </div>
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Layout mode */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{t('layoutMode')}</h3>
        <p className="text-xs text-gray-500 mb-3">{t('layoutModeDesc')}</p>

        {layoutLocked && (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {t('layoutModeLocked')}
          </div>
        )}
        {layoutLockedReason && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {layoutLockedReason}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            disabled={layoutLocked}
            onClick={() => {
              if (layoutLocked || layoutMode === 'geo') return
              setLayoutMode('geo')
              immediateSave({ layoutMode: 'geo' })
            }}
            className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
              layoutLocked
                ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                : layoutMode === 'geo'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="font-medium text-sm mb-1">{t('layoutModeGeo')}</div>
            <p className="text-xs text-gray-500">{t('layoutModeGeoDesc')}</p>
          </button>
          <button
            type="button"
            disabled={layoutLocked}
            onClick={() => {
              if (layoutLocked || layoutMode === 'schematic') return
              setLayoutMode('schematic')
              immediateSave({
                layoutMode: 'schematic',
                layoutWidth: layoutWidth || '50',
                layoutHeight: layoutHeight || '35',
              })
            }}
            className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
              layoutLocked
                ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                : layoutMode === 'schematic'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="font-medium text-sm mb-1">{t('layoutModeSchematic')}</div>
            <p className="text-xs text-gray-500">{t('layoutModeSchematicDesc')}</p>
          </button>
        </div>

        {layoutMode === 'schematic' && (
          <div className="mt-3 flex gap-3">
            <TextField
              label={t('layoutWidth')}
              type="number"
              value={layoutWidth}
              onChange={(e) => {
                setLayoutWidth(e.target.value)
                scheduleSave({ layoutWidth: e.target.value })
              }}
              helperText="m"
              sx={{ flex: 1 }}
            />
            <TextField
              label={t('layoutHeight')}
              type="number"
              value={layoutHeight}
              onChange={(e) => {
                setLayoutHeight(e.target.value)
                scheduleSave({ layoutHeight: e.target.value })
              }}
              helperText="m"
              sx={{ flex: 1 }}
            />
          </div>
        )}
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Danger zone */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-red-600 mb-2">{t('dangerZone')}</h3>
        <div className="rounded-lg border border-red-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-700">{t('deleteSite')}</div>
              <div className="text-xs text-gray-500">
                {t('deleteSiteDesc')}
              </div>
            </div>
            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={() => setDeleteDialogOpen(true)}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap', ml: 2 }}
            >
              {t('deleteSite')}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('deleteSiteTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('deleteSiteConfirmBody', { name })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteDialogOpen(false)}
            disabled={deleting}
            sx={{ textTransform: 'none' }}
          >
            {t('cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true)
              await deleteSite(site.id!)
              router.push('/sites')
            }}
            sx={{ textTransform: 'none' }}
          >
            {deleting ? (
              <><CircularProgress size={16} color="inherit" sx={{ mr: 1 }} /> {t('deleting')}</>
            ) : (
              t('deletePermanently')
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
