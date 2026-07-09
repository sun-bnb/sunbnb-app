'use client'

import logger from '@/utils/logger'

import { v4 as uuidv4 } from 'uuid'
import { SiteProps } from '@/app/sites/types'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import Select from '@mui/material/Select'
import CircularProgress from '@mui/material/CircularProgress'
import React, { useState } from 'react'

import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { useSession } from 'next-auth/react'

import { MobileDatePicker } from '@mui/x-date-pickers/MobileDatePicker'
import DateRangeSelector from '@/components/reservation/DateRangeSelector'
import TimeRangeSelector from '@/components/reservation/TimeRangeSelector'

import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import { useTranslations } from 'next-intl'
import {
  useGetReservationByIdQuery,
  useGetRentalAvailabilityQuery,
} from '@/store/features/api/apiSlice'
import dayjs from 'dayjs'
import SunbedSelection from '@/components/reservation/SunbedSelection'
import EquipmentSelection from '@/components/reservation/EquipmentSelection'
import { saveReservationForMultipleItems, saveRentalBooking } from './actions'
import { deleteReservation } from '@/app/reservations/[id]/actions'
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

import { WorkingHours } from '@/app/sites/types'

/** Derive open/close hours for a given day from the site's working hours */
function getOpenCloseHours(reservationDay: dayjs.Dayjs, workingHours?: WorkingHours[]): { openHour: number; closeHour: number } {
  const dow = reservationDay.day() === 0 ? 7 : reservationDay.day()
  const wh = (workingHours || []).find(w => w.day === dow)
  if (!wh) return { openHour: 8, closeHour: 20 }
  const open = new Date(wh.openTime)
  const close = new Date(wh.closeTime)
  return { openHour: open.getHours(), closeHour: close.getHours() }
}

function ReservationTimerangeSelector({ onDatePickerOpenChange, alwaysOpen, workingHours, mode }: { onDatePickerOpenChange?: (open: boolean) => void, alwaysOpen?: boolean, workingHours?: WorkingHours[], mode?: string }) {

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)

  const t = useTranslations('SiteView')

  const { reservationState } = sitesState
  const reservationMode = mode || sitesState.reservationMode || 'days'

  let reservationDay = sitesState.reservationDay || dayjs().toDate()
  const { openHour, closeHour } = getOpenCloseHours(dayjs(reservationDay), workingHours)

  let timeRange = sitesState.timeRange || [
    dayjs().hour(openHour).minute(0).second(0).toDate(),
    dayjs().hour(Math.min(openHour + 2, closeHour)).minute(0).second(0).toDate(),
  ]

  let dateRange = sitesState.dateRange || [
    dayjs().startOf('day').toISOString(),
    dayjs().endOf('day').toISOString()
  ]

  return (
    reservationMode === 'hours' ? (
      <div className="mb-2 pt-[6px] flex">
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <MobileDatePicker sx={{ 
            marginRight: '4px',
            '& .MuiInputBase-root': {
              height: '44px',
            },
            input: {
              textAlign: 'center',
              padding: '8px 14px',
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
          <TimeRangeSelector
            value={[dayjs(timeRange[0]), dayjs(timeRange[1])]}
            openHour={openHour}
            closeHour={closeHour}
            disabled={reservationState === RESERVATION_PROCESSING}
            onFocus={() => {
              dispatch(setValue({ focused: true }))
            }}
            onChange={(newValue) => {
              dispatch(setValue({ timeRange: [newValue[0]?.toDate(), newValue[1]?.toDate()] }))
            }}
          />
        </LocalizationProvider>
      </div>
    ) : (
      <div className="mb-2">
        <DateRangeSelector
          value={[dateRange[0], dateRange[1]]}
          disabled={reservationState === RESERVATION_PROCESSING}
          label={`${t('From')} – ${t('To')}`}
          alwaysOpen={alwaysOpen}
          onOpen={() => {
            dispatch(setValue({ focused: true }))
          }}
          onOpenChange={onDatePickerOpenChange}
          onChange={(newValue) => {
            dispatch(setValue({ dateRange: [newValue[0], newValue[1]] }))
          }}
        />
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

  const [guestEmail, setGuestEmail] = useState('')
  const [emailError, setEmailError] = useState(false)

  // We rely on the same lightweight check as the server action (a stricter check
  // is enforced server-side too). Keeps the field forgiving for typos like trailing spaces.
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

  async function submitReservation(opts: { anonId?: string; email?: string }) {
    dispatch(setValue({ reservationState: 'saving' }))
    logger.debug('Reserve', reservationMode, timeRange, dateRange, selectedItems)

    let saveResult = null
    const common = {
      siteId: site.id!,
      items: selectedItems,
      userId: session?.user?.id,
      anonId: opts.anonId,
      email: opts.email,
    }

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
        ...common,
        from: from.toISOString(),
        to: to.toISOString(),
        type: 'hours',
      })
    } else if (reservationMode === 'days' && dateRange[0] && dateRange[1]) {
      const from = dateRange[0].toDate()
      const to = dateRange[1].toDate()
      logger.debug('Save reservation', from, to)
      saveResult = await saveReservationForMultipleItems({
        ...common,
        from: from.toISOString(),
        to: to.toISOString(),
        type: 'days',
      })
    }

    logger.debug('Save result', saveResult)
    if (saveResult?.status === 'ok' && saveResult.id) {
      logger.debug('Site type', site.type)
      if (site.type !== 'paid') {
        const suffix = opts.anonId ? `?anonId=${opts.anonId}` : ''
        router.push(`/reservations/${saveResult.id}${suffix}`)
      } else {
        dispatch(setValue({
          reservationState: 'processing',
          pendingReservationId: saveResult.id
        }))
      }
    } else {
      logger.debug('Save result error', saveResult)
      dispatch(setValue({ reservationState: 'default' }))
    }
  }

  if (loggedIn) {
    return (
      <div className="mt-[10px]">
        <Button variant="contained"
          fullWidth={true}
          disabled={disabled}
          onClick={() => submitReservation({})}>
            {t('Reserve')}
        </Button>
      </div>
    )
  }

  // Anonymous (marketplace) flow — collect an email so we can send confirmation
  // and let the guest recover their booking. The QR/POS flow uses a different
  // component and skips email capture by design.
  return (
    <div className="mt-[10px]">
      <TextField
        type="email"
        size="small"
        fullWidth
        label={t('Email')}
        value={guestEmail}
        onChange={(e) => {
          setGuestEmail(e.target.value)
          if (emailError) setEmailError(false)
        }}
        error={emailError}
        helperText={emailError ? t('Enter a valid email') : ''}
        sx={{ mb: 1 }}
      />
      <Button variant="contained"
        fullWidth={true}
        disabled={disabled}
        onClick={async () => {
          const trimmed = guestEmail.trim()
          if (!isValidEmail(trimmed)) {
            setEmailError(true)
            return
          }
          let anonId = localStorage.getItem('sunbnb-anonId')
          if (!anonId) {
            anonId = uuidv4()
            localStorage.setItem('sunbnb-anonId', anonId)
          }
          await submitReservation({ anonId, email: trimmed })
        }}>
          {t('Reserve as guest')}
      </Button>
      <div className="text-center mt-2 text-xs text-gray-500">
        <button
          type="button"
          className="underline hover:text-gray-700"
          onClick={() => {
            const callbackUrl = pathname.startsWith('/s/') ? pathname : `/sites/${site.id}`
            router.push('/api/auth/signin?callbackUrl=' + callbackUrl)
          }}
        >
          {t('Sign in instead')}
        </button>
      </div>
    </div>
  )
}

function ItemSelection({ apiKey, site, wide } : { apiKey: string, site: SiteProps, wide?: boolean }) {

  const sitesState = useSelector((state: RootState) => state.sites)
  const { selectedItems } = sitesState
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  return (
    <>
      <ReservationTimerangeSelector
        onDatePickerOpenChange={wide ? undefined : setDatePickerOpen}
        alwaysOpen={wide}
        workingHours={site.workingHours}
        mode="days"
      />
      {(wide || !datePickerOpen) && (
        <>
          <div className="w-full h-[300px]">
            <SunbedSelection apiKey={apiKey} site={site} />
          </div>
          <ReservationButton disabled={!selectedItems || selectedItems.length === 0} site={site} />
        </>
      )}
    </>
  )
}

function EquipmentBookingSection({ site }: { site: SiteProps }) {

  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const loggedIn = !!(session?.user?.id)

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const reservationMode = sitesState.reservationMode || 'hours'

  // Show hours/days toggle only when at least one rental item has hourly pricing
  const hasHourlyPricing = (site.rentalItems || []).some(ri => ri.pricePerHour != null && ri.pricePerHour > 0)

  const [cart, setCart] = useState<{ rentalItemId: string; quantity: number }[]>([])
  const [booking, setBooking] = useState(false)
  const [bookingComplete, setBookingComplete] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [confirmationCart, setConfirmationCart] = useState<{ rentalItemId: string; quantity: number }[]>([])
  const [confirmationTotal, setConfirmationTotal] = useState(0)
  const [rentalPaymentLoading, setRentalPaymentLoading] = useState(false)
  const [rentalPaymentError, setRentalPaymentError] = useState<string | null>(null)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [guestEmail, setGuestEmail] = useState('')
  const [emailError, setEmailError] = useState(false)

  // Same lightweight format check as ReservationButton — server enforces strictly too
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

  const t = useTranslations('SiteView')
  const tp = useTranslations('Payment')

  const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

  let reservationDay = dayjs(sitesState.reservationDay)
  let timeRange = sitesState.timeRange ? [dayjs(sitesState.timeRange[0]), dayjs(sitesState.timeRange[1])] : [dayjs().add(2, 'hour'), dayjs().add(4, 'hour')]
  let dateRange = sitesState.dateRange ? [dayjs(sitesState.dateRange[0]), dayjs(sitesState.dateRange[1])] : [dayjs().startOf('day'), dayjs().add(1, 'day')]

  // Compute time window for availability query (mirrors getBookingDates logic)
  let availFrom: string | null = null
  let availTo: string | null = null
  if (reservationMode === 'hours' && reservationDay && timeRange[0] && timeRange[1]) {
    availFrom = reservationDay.hour(timeRange[0].hour()).minute(timeRange[0].minute()).second(0).toISOString()
    availTo = reservationDay.hour(timeRange[1].hour()).minute(timeRange[1].minute()).second(0).toISOString()
  } else if (dateRange[0] && dateRange[1]) {
    availFrom = dateRange[0].startOf('day').toISOString()
    availTo = dateRange[1].endOf('day').toISOString()
  }

  const { data: rentalAvailability } = useGetRentalAvailabilityQuery(
    { siteId: site.id!, from: availFrom!, to: availTo! },
    { skip: !site.id || !availFrom || !availTo }
  )

  // Merge live availability into rental items
  const itemsWithAvailability = (site.rentalItems || []).map(item => {
    const avail = rentalAvailability?.availability?.find(a => a.rentalItemId === item.id)
    return avail ? { ...item, availableQuantity: avail.availableQuantity } : item
  })

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

  const isPaidSite = (site.rentalPaymentType ?? site.type) === 'paid'

  const [bookingError, setBookingError] = useState<string | null>(null)

  const handleBook = () => {
    if (totalItems === 0) return
    // Anonymous path: validate guest email before proceeding to confirmation
    if (!loggedIn) {
      const trimmed = guestEmail.trim()
      if (!isValidEmail(trimmed)) {
        setEmailError(true)
        return
      }
    }
    setBookingError(null)
    setRentalPaymentError(null)
    // Snapshot the cart & total for the confirmation view
    setConfirmationCart([...cart])
    setConfirmationTotal(totalPrice)
    setShowConfirmation(true)
  }

  const getBookingDates = () => {
    let from: string
    let to: string

    if (reservationMode === 'hours' && reservationDay && timeRange[0] && timeRange[1]) {
      from = reservationDay.hour(timeRange[0].hour()).minute(timeRange[0].minute()).toDate().toISOString()
      to = reservationDay.hour(timeRange[1].hour()).minute(timeRange[1].minute()).toDate().toISOString()
    } else if (dateRange[0] && dateRange[1]) {
      from = dateRange[0].toDate().toISOString()
      to = dateRange[1].endOf('day').toDate().toISOString()
    } else {
      return null
    }
    return { from, to }
  }

  const handleConfirmBooking = async () => {
    setBooking(true)
    setBookingError(null)

    const dates = getBookingDates()
    if (!dates) { setBooking(false); return }

    // Resolve identity: session user or anonymous (anonId from localStorage)
    let anonId: string | undefined
    if (!loggedIn) {
      anonId = typeof window !== 'undefined'
        ? localStorage.getItem('sunbnb-anonId') ?? undefined
        : undefined
      if (!anonId) {
        anonId = uuidv4()
        if (typeof window !== 'undefined') {
          localStorage.setItem('sunbnb-anonId', anonId)
        }
      }
    }

    try {
      const result = await saveRentalBooking({
        siteId: site.id!,
        items: confirmationCart,
        durationType: reservationMode,
        from: dates.from,
        to: dates.to,
        anonId,
        guestEmail: !loggedIn ? guestEmail.trim() : undefined,
      })

      setBooking(false)
      if (result.status === 'ok' && result.bookingIds) {
        if (isPaidSite) {
          // For paid sites, proceed to payment immediately
          await handleRentalPayment(result.bookingIds)
        } else {
          // For unpaid sites, booking is done — show completed and navigate
          setShowConfirmation(false)
          setBookingComplete(true)
          setCart([])
          setTimeout(() => {
            setBookingComplete(false)
            const anonSuffix = anonId ? `?anonId=${anonId}` : ''
            router.push(`/reservations/rental/${result.bookingIds![0]}${anonSuffix}`)
          }, 2000)
        }
      } else {
        console.error('[RentalBooking] Error:', result)
        setBookingError(result.errors?.[0] || t('Booking failed — please try again'))
      }
    } catch (err) {
      console.error('[RentalBooking] Exception:', err)
      setBooking(false)
      setBookingError(t('Booking failed — please try again'))
    }
  }

  const handleRentalPayment = async (bookingIds: string[]) => {
    if (!bookingIds?.length) return
    setRentalPaymentLoading(true)
    setRentalPaymentError(null)

    // Read anonId for anonymous ownership verification throughout the payment flow
    const anonId = typeof window !== 'undefined'
      ? localStorage.getItem('sunbnb-anonId') ?? undefined
      : undefined

    try {
      if (DEMO_MODE) {
        const result = await initiateDemoRentalPayment(bookingIds, anonId)
        if (result.status === 'ok') {
          setShowConfirmation(false)
          setBookingComplete(true)
          setCart([])
          setTimeout(() => setBookingComplete(false), 4000)
        } else {
          setRentalPaymentError(result.errors?.[0] || 'Payment failed')
        }
        setRentalPaymentLoading(false)
        return
      }

      // Mollie payment — thread anonId through redirect URL and request body
      const anonSuffix = anonId ? `&anonId=${anonId}` : ''
      const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL}/payment/complete/rental?rentalBookingId=${bookingIds[0]}${anonSuffix}`

      const res = await fetch('/api/payment/mollie/create-rental-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalBookingIds: bookingIds,
          anonId: anonId ?? null,
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
      setRentalPaymentError(t('Booking failed — please try again'))
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

  // Pre-booking confirmation / order summary view
  if (showConfirmation) {
    const dates = getBookingDates()
    return (
      <div className="px-1.5 pt-1 pb-2">
        <div className="mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-sm font-medium text-gray-900 mb-2">🏄 {t('Order summary')}</p>
          {confirmationCart.map((cartItem) => {
            const item = site.rentalItems?.find(ri => ri.id === cartItem.rentalItemId)
            if (!item) return null
            const unitPrice = reservationMode === 'hours' ? (item.pricePerHour ?? 0) : (item.pricePerDay ?? 0)
            let duration = 1
            if (reservationMode === 'hours' && timeRange.length === 2 && timeRange[1]) {
              duration = Math.ceil(timeRange[1].diff(timeRange[0], 'hour', true))
            } else if (dateRange.length === 2 && dateRange[1]) {
              duration = Math.max(1, dateRange[1].diff(dateRange[0], 'day') + 1)
            }
            const lineTotal = unitPrice * duration * cartItem.quantity
            return (
              <div key={cartItem.rentalItemId} className="flex justify-between items-center text-xs text-gray-700 mb-1">
                <span>{item.name} × {cartItem.quantity}</span>
                <span className="font-medium">€{lineTotal.toFixed(2)}</span>
              </div>
            )
          })}
          {dates && (
            <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
              {reservationMode === 'hours'
                ? `${dayjs(dates.from).format('D MMM YYYY, HH:mm')} – ${dayjs(dates.to).format('HH:mm')}`
                : `${dayjs(dates.from).format('D MMM YYYY')} – ${dayjs(dates.to).format('D MMM YYYY')}`}
            </div>
          )}
          <div className="flex justify-between items-center text-sm font-semibold text-gray-900 mt-2 pt-2 border-t border-gray-100">
            <span>{t('Total')}</span>
            <span>€{confirmationTotal.toFixed(2)}</span>
          </div>
        </div>
        {isPaidSite ? (
          <>
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
            {bookingError && (
              <div className="text-red-600 text-xs text-center mb-1.5">{bookingError}</div>
            )}
            {rentalPaymentError && (
              <div className="text-red-600 text-xs text-center mb-1.5">{rentalPaymentError}</div>
            )}
            <Button
              variant="contained"
              fullWidth
              onClick={handleConfirmBooking}
              disabled={booking || rentalPaymentLoading}
              sx={{ textTransform: 'none', fontWeight: 600, py: 1.2 }}
            >
              {(booking || rentalPaymentLoading) ? <CircularProgress size={20} color="inherit" /> : tp('Pay now')}
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
          </>
        ) : (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 mb-2">
              <p className="text-xs text-gray-600">{t('Pay at the venue when you pick up your equipment')}</p>
            </div>
            {bookingError && (
              <div className="text-red-600 text-xs text-center mb-1.5">{bookingError}</div>
            )}
            <Button
              variant="contained"
              fullWidth
              onClick={handleConfirmBooking}
              disabled={booking}
              sx={{ textTransform: 'none', fontWeight: 600, py: 1.2 }}
            >
              {booking ? <CircularProgress size={20} color="inherit" /> : t('Confirm booking')}
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      {hasHourlyPricing && (
        <div className="flex rounded-lg bg-gray-100 mb-2">
          <button
            type="button"
            onClick={() => dispatch(setValue({ reservationMode: 'hours' }))}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-all ${
              reservationMode === 'hours'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('Hours')}
          </button>
          <button
            type="button"
            onClick={() => dispatch(setValue({ reservationMode: 'days' }))}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-all ${
              reservationMode === 'days'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('Days')}
          </button>
        </div>
      )}
      <ReservationTimerangeSelector onDatePickerOpenChange={setDatePickerOpen} workingHours={site.workingHours} />
      {!datePickerOpen && (
        <>
          <div className="w-full h-[300px]">
            <EquipmentSelection
              items={itemsWithAvailability}
              cart={cart}
              onCartChange={setCart}
              durationType={reservationMode}
            />
          </div>
          <div className="mt-[10px]">
            {bookingError && (
              <div className="text-red-600 text-xs text-center mb-1.5">{bookingError}</div>
            )}
            {!loggedIn ? (
              <>
                <TextField
                  type="email"
                  size="small"
                  fullWidth
                  label={t('Email')}
                  value={guestEmail}
                  onChange={(e) => {
                    setGuestEmail(e.target.value)
                    if (emailError) setEmailError(false)
                  }}
                  error={emailError}
                  helperText={emailError ? t('Enter a valid email') : ''}
                  sx={{ mb: 1 }}
                />
                <Button
                  variant="contained"
                  fullWidth
                  disabled={totalItems === 0 || booking}
                  onClick={handleBook}
                >
                  {booking ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : totalItems > 0 ? (
                    `${t('Reserve as guest')} · ${totalItems} ${totalItems !== 1 ? t('items') : t('item')} · €${totalPrice.toFixed(2)}`
                  ) : (
                    t('Reserve as guest')
                  )}
                </Button>
                <div className="text-center mt-2 text-xs text-gray-500">
                  <button
                    type="button"
                    className="underline hover:text-gray-700"
                    onClick={() => {
                      const callbackUrl = pathname.startsWith('/s/') ? pathname : `/sites/${site.id}`
                      router.push('/api/auth/signin?callbackUrl=' + callbackUrl)
                    }}
                  >
                    {t('Sign in instead')}
                  </button>
                </div>
              </>
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
                  `${t('Reserve')} · ${totalItems} ${totalItems !== 1 ? t('items') : t('item')} · €${totalPrice.toFixed(2)}`
                ) : (
                  t('Reserve')
                )}
              </Button>
            )}
          </div>
        </>
      )}
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
  const t = useTranslations('SiteView')

  if (!hasSunbeds || !hasRentals) return null

  return (
    <div className="flex rounded-lg bg-gray-100 p-0.5 mb-1.5 mt-1.5">
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
        <span>{t('Sunbeds')}</span>
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
        <span>{t('Equipment')}</span>
      </button>
    </div>
  )
}

export default function ReservationView({
  apiKey,
  site,
  wide,
} : {
  apiKey: string
  site: SiteProps
  wide?: boolean
}) {

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, pendingReservationId } = sitesState

  const features = site.features || ['sunbeds']
  const hasSunbeds = features.includes('sunbeds')
  const hasRentals = features.includes('rentals') && (site.rentalItems?.length ?? 0) > 0

  // Default to sunbeds if available, otherwise equipment
  const defaultMode: ViewMode = hasSunbeds ? 'sunbeds' : 'equipment'
  const viewMode: ViewMode = (sitesState.viewMode as ViewMode) || defaultMode
  const setViewMode = (mode: ViewMode) => dispatch(setValue({ viewMode: mode }))

  const t = useTranslations('SiteView')

  const { data: reservation } = useGetReservationByIdQuery({ id: pendingReservationId }, {
    skip: !pendingReservationId
  })

  logger.debug('Pending reservation', pendingReservationId, reservation)

  const handleCancelReservation = async () => {
    if (!pendingReservationId) return
    await deleteReservation(pendingReservationId)
    dispatch(setValue({ reservationState: null, pendingReservationId: null }))
  }

  return (
    <>
      {
        (reservationState === RESERVATION_PROCESSING || reservationState === 'payment_in_progress') ? (
          !reservation ? (
            <div className="flex justify-center mb-[12px] mt-[12px]">
              <CircularProgress />
            </div>
          ) : <PaymentView reservation={reservation} paymentProvider={site.paymentProvider} onCancel={handleCancelReservation} />
         ) : (
          <>
            <ViewModeSelector
              mode={viewMode}
              onChange={(mode) => {
                setViewMode(mode)
                if (mode === 'sunbeds') {
                  dispatch(setValue({ reservationMode: 'days', focused: true }))
                } else if (mode === 'equipment') {
                  dispatch(setValue({ reservationMode: 'hours', focused: true }))
                }
              }}
              hasSunbeds={hasSunbeds}
              hasRentals={hasRentals}
            />
            {viewMode === 'sunbeds' && hasSunbeds ? (
              <ItemSelection apiKey={apiKey} site={site} wide={wide} />
            ) : hasRentals ? (
              <EquipmentBookingSection site={site} />
            ) : (
              <ItemSelection apiKey={apiKey} site={site} wide={wide} />
            )}
          </>
         )
      }
    </>
  )
}