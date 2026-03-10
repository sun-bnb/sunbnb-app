'use client'

import logger from '@/utils/logger'

import { SiteProps } from '@/app/sites/types'
import Button from '@mui/material/Button'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import Select from '@mui/material/Select'
import CircularProgress from '@mui/material/CircularProgress'
import React, { useState } from 'react'

import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { SingleInputTimeRangeField } from '@mui/x-date-pickers-pro/SingleInputTimeRangeField'
import { useSession } from 'next-auth/react'

import { MobileDatePicker } from '@mui/x-date-pickers/MobileDatePicker'
import { MobileDateRangePicker } from '@mui/x-date-pickers-pro/MobileDateRangePicker'
import { SingleInputDateRangeField } from '@mui/x-date-pickers-pro/SingleInputDateRangeField'

import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import { useTranslations } from 'next-intl'
import {
  useGetReservationByIdQuery
} from '@/store/features/api/apiSlice'
import dayjs from 'dayjs'
import SunbedSelection from '@/components/reservation/SunbedSelection'
import EquipmentSelection from '@/components/reservation/EquipmentSelection'
import { saveReservationForMultipleItems, saveRentalBooking } from './actions'
import PaymentView from '@/app/payment/Payment'
import { initiateDemoRentalPayment } from '@/app/payment/actions'
import { RESERVATION_PROCESSING } from '@repo/data/reservation-status'
import { useRouter, usePathname } from 'next/navigation'

function PaymentMethodSelection() {

  const [ paymentMethod, setPaymentMethod ] = useState('0001')

  return (
    <div className="w-full mt-4">
      <FormControl size="medium" fullWidth={true}>
        <InputLabel>Payment method</InputLabel>
        <Select
          labelId="demo-select-small-label"
          id="demo-select-small"
          value={paymentMethod}
          label="Payment method"
          onChange={(...args) => {
          }}
          MenuProps={{
            sx: {
              transform: "translateX(-8px)", // Move the dropdown 10px to the left
            }
          }}
          sx={{
            '& .MuiSelect-select': {
              display: 'flex',
              justifyContent: 'center'
            }
            }}
        >
          
          <MenuItem value={'0001'} sx={{ display: 'flex', justifyContent: 'center' }}>VISA 4398 1206 7404 9258</MenuItem>
          <MenuItem value="" sx={{ display: 'flex', justifyContent: 'center' }}>
            <em>+ Add payment method</em>
          </MenuItem>
        </Select>
      </FormControl>
    </div>
  )

}

function ReservationTimerangeSelector() {

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)

  const t = useTranslations('SiteView')

  const { reservationState, reservationMode } = sitesState

  let reservationDay = sitesState.reservationDay || dayjs().toDate()
  let timeRange = sitesState.timeRange || [
    dayjs().add(2, 'hour').toDate().toISOString(),
    dayjs().add(4, 'hour').toDate().toISOString()
  ]

  let dateRange = sitesState.dateRange || [
    dayjs().startOf('day').toISOString(),
    dayjs().add(1, 'day').endOf('day').toISOString().substring(0, 10)
  ]

  return (
    reservationMode === 'hours' ? (
      <div className="mb-2 flex">
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <MobileDatePicker sx={{ 
            marginRight: '4px',
            input: {
              textAlign: 'center'
            }
          }}
            disabled={reservationState === RESERVATION_PROCESSING}
            label="Date"
            format='YYYY-MM-DD'
            value={dayjs(reservationDay)}
            selectedSections={null}
            onOpen={() => {
              dispatch(setValue({ focused: true }))
            }}
            onChange={(value) => {
              dispatch(setValue({
                reservationDay: value?.toDate(),
                focused: true
              }))
            }}
          />
          <SingleInputTimeRangeField sx={{
            input: {
              textAlign: 'center'
            }
          }}
            label="Time"
            disabled={reservationState === RESERVATION_PROCESSING}
            ampm={false}
            fullWidth={true}
            value={[dayjs(timeRange[0]), dayjs(timeRange[1])]}
            onFocus={() => {
              dispatch(setValue({ focused: true }))
            }}
            onBlur={() => {
            }}
            onChange={(newValue) => {
              dispatch(setValue({ timeRange: [newValue[0]?.toDate(), newValue[1]?.endOf('day').toDate()] }))
            }}
          />
        </LocalizationProvider>
      </div>
    ) : (
      <div className="mb-2 bg-white">
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <MobileDateRangePicker sx={{ 
              width: '100%',
              input: {
                textAlign: 'center'
              },
              '& .MuiInputLabel-root': {
                backgroundColor: 'white',
                px: '6px',
                borderRadius: '4px',
                border: '1px solid rgba(0,0,0,0.23)',
              }
            }}
            onOpen={() => {
              dispatch(setValue({ focused: true }))
            }}
            value={[dayjs(dateRange[0]), dayjs(dateRange[1])]}
            disabled={reservationState === RESERVATION_PROCESSING}
            format='YYYY-MM-DD'
            selectedSections={null}
            label={`${t('From')} - ${t('To')}`}
            slots={{ 
              field: SingleInputDateRangeField
            }}
            onChange={(newValue) => {
              dispatch(setValue({ dateRange: [newValue[0]?.toISOString(), newValue[1]?.toISOString()] }))
            }}
          />
        </LocalizationProvider>
      </div>
    )
  )

}

function ReservationButton({
  disabled,
  site
}: {
  disabled: boolean,
  site: SiteProps
}) {

  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const loggedIn = !!(session?.user?.id)

  const dispatch = useDispatch();
  const sitesState = useSelector((state: RootState) => state.sites)
  const { selectedItems } = sitesState
  let reservationMode = sitesState.reservationMode || 'days'

  let reservationDay = dayjs(sitesState.reservationDay)
  let timeRange = sitesState.timeRange ? [dayjs(sitesState.timeRange[0]), dayjs(sitesState.timeRange[1])] : []
  let dateRange = sitesState.dateRange ? [dayjs(sitesState.dateRange[0]), dayjs(sitesState.dateRange[1])] : []

  const t = useTranslations('SiteView')

  return (
    <div className="mt-[10px]">
      {
        !loggedIn ? (
          <Button variant="contained" 
            fullWidth={true} onClick={() => {
              const callbackUrl = pathname.startsWith('/s/') ? pathname : `/sites/${site.id}`
              router.push('/api/auth/signin?callbackUrl=' + callbackUrl)
            }}>
              {t('Login to reserve')}
          </Button>
        ) : (
          <Button variant="contained" 
            fullWidth={true}
            disabled={disabled}
            onClick={
              async () => {
                dispatch(setValue({ reservationState: 'saving' }))
                logger.debug('Reserve', reservationMode, timeRange, dateRange, selectedItems)

                let saveResult = null
                if (reservationMode === 'hours' && reservationDay && timeRange[0] && timeRange[1]) {
                  const from = reservationDay
                    .hour(timeRange[0].hour())
                    .minute(timeRange[0].minute())
                    .second(timeRange[0].second())
                    .toDate()
                  const to = reservationDay
                    .hour(timeRange[1].hour())
                    .minute(timeRange[1].minute())
                    .second(timeRange[1].second())
                    .toDate()
                  saveResult = await saveReservationForMultipleItems({
                    from: from.toISOString(),
                    to: to.toISOString(),
                    type: 'hours',
                    siteId: site.id!,
                    items: selectedItems,
                    userId: session?.user?.id!
                  })
                } else if (reservationMode === 'days' && dateRange[0] && dateRange[1]) {
                  const from = dateRange[0].toDate()
                  const to = dateRange[1].toDate()
                  logger.debug('Save reservation', from, to)
                  saveResult = await saveReservationForMultipleItems({
                    from: from.toISOString(),
                    to: to.toISOString(),
                    type: 'days',
                    siteId: site.id!,
                    items: selectedItems,
                    userId: session?.user?.id!
                  })
                }

                logger.debug('Save result', saveResult)
                if (saveResult?.status === 'ok' && saveResult.id) {
                  logger.debug('Site type', site.type)
                  if (site.type === 'unpaid') {
                    router.push(`/reservations/${saveResult.id}`)
                  } else {
                    dispatch(setValue({ 
                      reservationState: site.type === 'unpaid' ? 'complete' : 'processing',
                      pendingReservationId: saveResult.id
                    }))
                  }
                } else {
                  logger.debug('Save result error', saveResult)
                }

              }
            }>
              {t('Reserve')}
            </Button>
          )
      }
      
    </div>
  )
}

function ItemSelection({ apiKey, site } : { apiKey: string, site: SiteProps }) {

  const sitesState = useSelector((state: RootState) => state.sites)
  const { selectedItems } = sitesState

  return (
    <>
      <ReservationTimerangeSelector />
      <div className="w-full h-[300px]">
        <SunbedSelection apiKey={apiKey} site={site} />
      </div>
      
      <ReservationButton disabled={!selectedItems || selectedItems.length === 0} site={site} />
    </>
  )
}

function EquipmentBookingSection({ site }: { site: SiteProps }) {

  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const loggedIn = !!(session?.user?.id)

  const sitesState = useSelector((state: RootState) => state.sites)
  const reservationMode = sitesState.reservationMode || 'days'

  const [cart, setCart] = useState<{ rentalItemId: string; quantity: number }[]>([])
  const [booking, setBooking] = useState(false)
  const [bookingComplete, setBookingComplete] = useState(false)
  const [pendingBookingIds, setPendingBookingIds] = useState<string[] | null>(null)
  const [pendingTotalAmount, setPendingTotalAmount] = useState(0)
  const [rentalPaymentLoading, setRentalPaymentLoading] = useState(false)
  const [rentalPaymentError, setRentalPaymentError] = useState<string | null>(null)

  const t = useTranslations('SiteView')
  const tp = useTranslations('Payment')

  const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

  let reservationDay = dayjs(sitesState.reservationDay)
  let timeRange = sitesState.timeRange ? [dayjs(sitesState.timeRange[0]), dayjs(sitesState.timeRange[1])] : []
  let dateRange = sitesState.dateRange ? [dayjs(sitesState.dateRange[0]), dayjs(sitesState.dateRange[1])] : []

  const totalItems = cart.reduce((sum, c) => sum + c.quantity, 0)

  // Calculate total price
  const totalPrice = cart.reduce((sum, cartItem) => {
    const item = site.rentalItems?.find(ri => ri.id === cartItem.rentalItemId)
    if (!item) return sum
    if (reservationMode === 'hours' && item.pricePerHour) {
      const hours = (timeRange.length === 2 && timeRange[1]) ? Math.ceil(timeRange[1].diff(timeRange[0], 'hour', true)) : 1
      return sum + item.pricePerHour * hours * cartItem.quantity
    }
    if (item.pricePerDay) {
      const days = (dateRange.length === 2 && dateRange[1]) ? Math.max(1, dateRange[1].diff(dateRange[0], 'day') + 1) : 1
      return sum + item.pricePerDay * days * cartItem.quantity
    }
    return sum
  }, 0)

  const isPaidSite = site.type !== 'unpaid'

  const handleBook = async () => {
    if (!session?.user?.id) return
    setBooking(true)

    let from: string
    let to: string

    if (reservationMode === 'hours' && reservationDay && timeRange[0] && timeRange[1]) {
      from = reservationDay.hour(timeRange[0].hour()).minute(timeRange[0].minute()).toDate().toISOString()
      to = reservationDay.hour(timeRange[1].hour()).minute(timeRange[1].minute()).toDate().toISOString()
    } else if (dateRange[0] && dateRange[1]) {
      from = dateRange[0].toDate().toISOString()
      to = dateRange[1].toDate().toISOString()
    } else {
      setBooking(false)
      return
    }

    const result = await saveRentalBooking({
      siteId: site.id!,
      items: cart,
      durationType: reservationMode,
      from,
      to,
    })

    setBooking(false)
    if (result.status === 'ok' && result.bookingIds) {
      if (isPaidSite) {
        // Enter payment flow
        setPendingBookingIds(result.bookingIds)
        setPendingTotalAmount(totalPrice)
        setCart([])
      } else {
        // Unpaid site — booking is immediately complete
        setBookingComplete(true)
        setCart([])
        setTimeout(() => setBookingComplete(false), 4000)
      }
    }
  }

  const handleRentalPayment = async () => {
    if (!pendingBookingIds?.length) return
    setRentalPaymentLoading(true)
    setRentalPaymentError(null)

    try {
      if (DEMO_MODE) {
        const result = await initiateDemoRentalPayment(pendingBookingIds)
        if (result.status === 'ok') {
          setPendingBookingIds(null)
          setBookingComplete(true)
          setTimeout(() => setBookingComplete(false), 4000)
        } else {
          setRentalPaymentError(result.errors?.[0] || 'Payment failed')
        }
        setRentalPaymentLoading(false)
        return
      }

      // Mollie payment
      const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL}/payment/complete/rental?rentalBookingId=${pendingBookingIds[0]}`

      const res = await fetch('/api/payment/mollie/create-rental-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalBookingIds: pendingBookingIds,
          redirectUrl,
        }),
      })

      const data = await res.json()

      if (data.error) {
        setRentalPaymentError(data.error)
        setRentalPaymentLoading(false)
        return
      }

      // Redirect to Mollie's hosted checkout page
      window.location.href = data.checkoutUrl
    } catch (err) {
      console.error('[RentalPayment] Error:', err)
      setRentalPaymentError('Payment failed — please try again')
      setRentalPaymentLoading(false)
    }
  }

  if (bookingComplete) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <span className="text-4xl mb-2">✅</span>
        <p className="text-lg font-semibold text-gray-900">{t('Booking confirmed')}</p>
        <p className="text-sm text-gray-500 mt-1">{t('Check your reservations for details')}</p>
      </div>
    )
  }

  // Payment view for pending rental bookings
  if (pendingBookingIds && isPaidSite) {
    return (
      <div className="px-1.5 pt-1 pb-2">
        <div className="mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-sm font-medium text-gray-900 mb-1">🏄 Equipment rental</p>
          <p className="text-lg font-semibold text-gray-900">€{pendingTotalAmount.toFixed(2)}</p>
          <p className="text-xs text-gray-500">{pendingBookingIds.length} item{pendingBookingIds.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 mb-2">
          <div className="flex items-center gap-2 mb-1.5">
            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span className="text-sm font-medium text-gray-700">{tp('Secure checkout')}</span>
          </div>
          <p className="text-xs text-gray-500">{tp('You will be redirected to complete payment')}</p>
        </div>
        <Button
          variant="contained"
          fullWidth
          onClick={handleRentalPayment}
          disabled={rentalPaymentLoading}
          sx={{ textTransform: 'none', fontWeight: 600, py: 1.2 }}
        >
          {rentalPaymentLoading ? <CircularProgress size={20} color="inherit" /> : tp('Pay now')}
        </Button>
        <div className="text-gray-400 text-[11px] text-center mt-1.5">
          {tp('Payment confirms acceptance of')}{' '}
          <a
            className="text-[#1976d2]"
            href="/tos/reservation"
            target="_blank"
            rel="noopener noreferrer"
          >
            {tp('terms of service')}
          </a>
        </div>
        {rentalPaymentError && (
          <div className="text-red-600 text-xs text-center mt-1.5">{rentalPaymentError}</div>
        )}
      </div>
    )
  }

  return (
    <>
      <ReservationTimerangeSelector />
      <div className="w-full h-[300px]">
        <EquipmentSelection
          items={site.rentalItems || []}
          cart={cart}
          onCartChange={setCart}
          durationType={reservationMode}
        />
      </div>
      <div className="mt-[10px]">
        {!loggedIn ? (
          <Button
            variant="contained"
            fullWidth
            onClick={() => {
              const callbackUrl = pathname.startsWith('/s/') ? pathname : `/sites/${site.id}`
              router.push('/api/auth/signin?callbackUrl=' + callbackUrl)
            }}
          >
            {t('Login to reserve')}
          </Button>
        ) : (
          <Button
            variant="contained"
            fullWidth
            disabled={totalItems === 0 || booking}
            onClick={handleBook}
          >
            {booking ? (
              <CircularProgress size={20} color="inherit" />
            ) : totalItems > 0 ? (
              `${t('Reserve')} · ${totalItems} item${totalItems !== 1 ? 's' : ''} · €${totalPrice.toFixed(2)}`
            ) : (
              t('Reserve')
            )}
          </Button>
        )}
      </div>
    </>
  )
}

type ViewMode = 'sunbeds' | 'equipment'

function ViewModeSelector({
  mode,
  onChange,
  hasSunbeds,
  hasRentals,
}: {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  hasSunbeds: boolean
  hasRentals: boolean
}) {
  if (!hasSunbeds || !hasRentals) return null

  return (
    <div className="flex rounded-lg bg-gray-100 p-0.5 mb-3">
      <button
        type="button"
        onClick={() => onChange('sunbeds')}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-all ${
          mode === 'sunbeds'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        <span>⛱️</span>
        <span>Sunbeds</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('equipment')}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-all ${
          mode === 'equipment'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        <span>🏄</span>
        <span>Equipment</span>
      </button>
    </div>
  )
}

export default function ReservationView({
  apiKey,
  stripePublicKey,
  site
} : {
  apiKey: string
  stripePublicKey: string | undefined
  site: SiteProps
}) {

  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, pendingReservationId } = sitesState

  const features = site.features || ['sunbeds']
  const hasSunbeds = features.includes('sunbeds')
  const hasRentals = features.includes('rentals') && (site.rentalItems?.length ?? 0) > 0

  // Default to sunbeds if available, otherwise equipment
  const defaultMode: ViewMode = hasSunbeds ? 'sunbeds' : 'equipment'
  const [viewMode, setViewMode] = useState<ViewMode>(defaultMode)

  if (!stripePublicKey && site.paymentProvider !== 'mollie') {
    return (
      <div className="flex flex-col items-center justify-center">
        <div>Payment gateway unavailable</div>
      </div>
    )
  }

  const { data: reservation } = useGetReservationByIdQuery({ id: pendingReservationId }, {
    skip: !pendingReservationId
  })

  logger.debug('Pending reservation', pendingReservationId, reservation)

  return (
    <>
      {
        (reservationState === RESERVATION_PROCESSING || reservationState === 'payment_in_progress') ? (
          !reservation ? (
            <div className="flex justify-center mb-[12px] mt-[12px]">
              <CircularProgress />
            </div>
          ) : <PaymentView stripePublicKey={stripePublicKey} reservation={reservation} paymentProvider={site.paymentProvider} />
         ) : (
          <>
            <ViewModeSelector
              mode={viewMode}
              onChange={setViewMode}
              hasSunbeds={hasSunbeds}
              hasRentals={hasRentals}
            />
            {viewMode === 'sunbeds' && hasSunbeds ? (
              <ItemSelection apiKey={apiKey} site={site} />
            ) : hasRentals ? (
              <EquipmentBookingSection site={site} />
            ) : (
              <ItemSelection apiKey={apiKey} site={site} />
            )}
          </>
         )
      }
    </>
  )
}