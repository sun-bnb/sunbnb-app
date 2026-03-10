'use client'

import React, { useState, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
import { addWorkingHours, deleteWorkingHours } from '../working-hours-actions'
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
        <span>Customer pays</span>
        <span>{priceNum.toFixed(2)} &euro;</span>
      </div>
      {feeAmount > 0 && (
        <div className="flex justify-between text-gray-500 mb-1">
          <span>
            Service fee
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
            Upgrade to {TIER_LABELS[nextTier]} for {TIER_FEES[nextTier]} service fee
          </div>
        ) : null
      })()}
      <div className="border-t border-gray-200 my-1.5" />
      <div className="flex justify-between font-medium text-gray-800 mb-1">
        <span>You receive</span>
        <span>{partnerGross.toFixed(2)} &euro;</span>
      </div>
      {vatRate > 0 && (
        <div className="flex justify-between text-gray-400">
          <span>incl. VAT {vatRate}%</span>
          <span>{partnerVat.toFixed(2)} &euro;</span>
        </div>
      )}
      {!serviceFee && (
        <div className="flex justify-between text-gray-400 italic">
          <span>No service fee configured for sunbed-rental</span>
        </div>
      )}
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

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)

  const doSave = useCallback(async (overrides?: {
    name?: string
    type?: string
    price?: string
    vat?: string
    lat?: string
    lng?: string
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
      })
      if (result.status === 'ok') {
        setSaveStatus('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('error')
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

  const sortedHours = useMemo(
    () => [...(site.workingHours ?? [])].sort((a, b) => a.day - b.day),
    [site.workingHours],
  )

  const hoursForDay = (dayKey: string) =>
    sortedHours.filter(h => h.day === Number(dayKey))

  const isPaid = siteType === 'paid'
  const tier = site.subscriptionTier ?? 'STARTER'
  const canUseAvailabilityOnly = tier === 'PRO' || tier === 'BUSINESS'

  return (
    <div className="p-4">

      {/* Save status indicator — sticky top bar */}
      <div className={`flex items-center justify-center gap-2 px-3 py-2 rounded mb-4 text-sm transition-all ${
        saveStatus === 'saving' ? 'bg-blue-50 border border-blue-200 text-blue-600' :
        saveStatus === 'saved' ? 'bg-green-50 border border-green-200 text-green-600' :
        saveStatus === 'error' ? 'bg-red-50 border border-red-200 text-red-600' :
        'bg-gray-50 border border-gray-200 text-gray-400'
      }`}>
        {saveStatus === 'saving' && <><SyncIcon fontSize="small" className="animate-spin" /> Saving…</>}
        {saveStatus === 'saved' && <><CloudDoneIcon fontSize="small" /> All changes saved</>}
        {saveStatus === 'error' && <><WarningAmberIcon fontSize="small" /> Error saving changes</>}
        {saveStatus === 'idle' && <><CloudDoneIcon fontSize="small" /> Up to date</>}
      </div>

      {/* Site name */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Site name</h3>
        <TextField
          fullWidth
          required
          value={name}
          onChange={e => {
            setName(e.target.value)
            scheduleSave({ name: e.target.value })
          }}
          helperText="The name your customers will see"
        />
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Billing type — Reservations */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Reservation billing</h3>
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
                Integrated payments
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Customers pay when booking. Payment is collected and settled through the platform.
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
                Off-platform billing
              </span>
            </div>
            <p className="text-xs text-gray-500">
              No payment collected on the platform. Ideal when billing is handled externally, e.g. hotel guests.
            </p>
            {!canUseAvailabilityOnly && (
              <p className="text-xs text-amber-600 mt-1.5 font-medium">Pro or Business plan required</p>
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
              label="Base price (€)"
              type="number"
              value={price}
              onChange={e => {
                setPrice(e.target.value)
                scheduleSave({ price: e.target.value })
              }}
              placeholder="e.g. 15"
              helperText="The price your customers will pay"
            />
            <TextField
              sx={{ width: 180, flexShrink: 0 }}
              label="Tax rate (%)"
              type="number"
              value={vat}
              onChange={e => {
                setVat(e.target.value)
                scheduleSave({ vat: e.target.value })
              }}
              placeholder="e.g. 21"
              helperText="Applied to all sales"
            />
          </div>
          <PriceBreakdown price={price} vat={vat} serviceFees={site.serviceFees} tier={tier} />
        </div>
      )}

      <Divider sx={{ mb: 3 }} />

      {/* Booking hours */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-1">Booking hours</h3>
        <p className="text-xs text-gray-500 mb-3">
          Set when sunbeds are available for reservation each day.
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
                    onChange={() => {
                      if (isActive) {
                        slots.forEach(s => deleteWorkingHours(s.id))
                      } else {
                        addWorkingHours(site.id!, { day: day.key, openTime: '09:00', closeTime: '18:00' })
                      }
                    }}
                  />
                  <span className={`text-sm w-12 ${isActive ? 'font-medium text-gray-800' : 'text-gray-400'}`}>
                    {day.short}
                  </span>

                  {isActive ? (
                    <div className="flex-1 flex flex-col gap-1">
                      {slots.map(slot => (
                        <div key={slot.id} className="flex items-center gap-2">
                          <span className="text-sm text-gray-700">
                            {formatTime(slot.openTime)}
                          </span>
                          <span className="text-xs text-gray-400">to</span>
                          <span className="text-sm text-gray-700">
                            {formatTime(slot.closeTime)}
                          </span>
                          <IconButton size="small" onClick={() => deleteWorkingHours(slot.id)}>
                            <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
                          </IconButton>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Closed</span>
                  )}

                  {isActive && (
                    <Button
                      size="small"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() =>
                        addWorkingHours(site.id!, { day: day.key, openTime: '09:00', closeTime: '18:00' })
                      }
                      sx={{ textTransform: 'none', fontSize: '0.7rem', minWidth: 0, ml: 1 }}
                    >
                      Split
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Use "Split" to add a break in the middle of the day, e.g. a lunch closure.
        </p>
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Site location */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Site location</h3>
        <p className="text-xs text-gray-500 mb-3">
          Search or click the map to update the location pin.
        </p>

        <div className="flex items-center gap-2 px-3 py-2 rounded mb-3 text-sm bg-green-50 border border-green-200 text-green-700">
          <CheckCircleIcon fontSize="small" />
          <span>Location — {Number(mapCoords.lat).toFixed(5)}, {Number(mapCoords.lng).toFixed(5)}</span>
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
        <h3 className="text-sm font-medium text-gray-700 mb-2">Site visibility</h3>
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
                {siteStatus === 'active' ? 'Site is live' : 'Site is hidden'}
              </div>
              <div className="text-xs text-gray-500">
                {siteStatus === 'active'
                  ? 'Customers can find and book sunbeds at this site.'
                  : 'This site is not visible to customers. Activate it when you\'re ready.'}
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
          <h3 className="text-sm font-medium text-gray-700 mb-2">Payment provider</h3>
          <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4">
            <div className="flex items-center gap-2 mb-1">
              <PaymentsIcon fontSize="small" className="text-blue-600" />
              <span className="font-medium text-sm text-blue-700">Mollie</span>
            </div>
            <p className="text-xs text-gray-500">
              iDEAL, cards &amp; more. Connect your Mollie account in the Security section.
            </p>
          </div>
        </div>
      )}

      <Divider sx={{ mb: 3 }} />

      {/* Site features */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Site features</h3>
        <p className="text-xs text-gray-500 mb-3">
          Choose what this site offers. Customers will see the enabled features.
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
                <div className="text-sm font-medium text-gray-700">Sunbed reservations</div>
                <div className="text-xs text-gray-500">Customers can reserve sunbeds on a map</div>
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
                <div className="text-sm font-medium text-gray-700">Equipment rental</div>
                <div className="text-xs text-gray-500">Rent out surfboards, kayaks, umbrellas, and more</div>
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

      {/* Danger zone */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-red-600 mb-2">Danger zone</h3>
        <div className="rounded-lg border border-red-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-700">Delete this site</div>
              <div className="text-xs text-gray-500">
                Permanently remove this site and all its data. This action cannot be undone.
              </div>
            </div>
            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={() => setDeleteDialogOpen(true)}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap', ml: 2 }}
            >
              Delete site
            </Button>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete site?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>{name}</strong>? This will permanently remove
            the site, all inventory items, reservations, and associated data. This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteDialogOpen(false)}
            disabled={deleting}
            sx={{ textTransform: 'none' }}
          >
            Cancel
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
              <><CircularProgress size={16} color="inherit" sx={{ mr: 1 }} /> Deleting…</>
            ) : (
              'Delete permanently'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
