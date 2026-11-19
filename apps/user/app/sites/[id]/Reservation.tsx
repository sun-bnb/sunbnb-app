'use client'

import logger from '@/utils/logger'

import { v4 as uuidv4 } from 'uuid'
import { SiteProps } from '@/app/sites/types'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import Select from '@mui/material/Select'
import React, { useEffect, useState } from 'react'

import { useSession } from 'next-auth/react'

import DateRangeSelector from '@/components/reservation/DateRangeSelector'
import DayStrip from '@/components/reservation/DayStrip'
import TimeStepper from '@/components/reservation/TimeStepper'
import { unitPrice } from '@/components/reservation/EquipmentSelection'
import { clampSlot, fmtHour, hourBounds, type HourBounds } from './equipment-time'
import { formatStay, singleDayRange } from './day-strip'
import { formatSeatId } from '@repo/data/seat-label'
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, INPUT, Spinner } from '@/components/booking/ui'

import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import { useLocale, useTranslations } from 'next-intl'
import {
  useGetReservationByIdQuery,
  useGetRentalAvailabilityQuery,
  useGetDailyAvailabilityQuery,
} from '@/store/features/api/apiSlice'
import dayjs from 'dayjs'
import SunbedSelection from '@/components/reservation/SunbedSelection'
import EquipmentSelection from '@/components/reservation/EquipmentSelection'
import { trackBeginCheckout, trackPurchase, trackReservationCreated } from '@/app/analytics/track'
import { saveReservationForMultipleItems, saveRentalBooking } from './actions'
import { deleteReservation } from '@/app/reservations/[id]/actions'
import PaymentView from '@/app/payment/Payment'
import { usesLegacyMollieEndpoint, neutralCheckoutBody } from '@/app/payment/checkout-endpoint'
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

/** Desktop sunbeds: the always-open range calendar (the phone uses the day strip). */
function ReservationTimerangeSelector({ alwaysOpen }: { alwaysOpen?: boolean; workingHours?: WorkingHours[]; mode?: string }) {
  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const t = useTranslations('SiteView')
  const dateRange: [string, string] = sitesState.dateRange || singleDayRange(dayjs().format('YYYY-MM-DD'))

  return (
    <div className="mb-2">
      <DateRangeSelector
        value={dateRange}
        disabled={sitesState.reservationState === RESERVATION_PROCESSING}
        label={`${t('From')} – ${t('To')}`}
        alwaysOpen={alwaysOpen}
        onChange={(newValue) => dispatch(setValue({ dateRange: [newValue[0], newValue[1]] }))}
      />
    </div>
  )
}

/** Where "Sign in" sends a guest, and back to this venue afterwards. */
function useSignInHref(site: SiteProps) {
  const pathname = usePathname()
  const callbackUrl = pathname.startsWith('/s/') ? pathname : `/sites/${site.id}`
  return '/api/auth/signin?callbackUrl=' + callbackUrl
}

/** Lightweight check shared by both confirm steps — the server action enforces strictly too. */
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

/** The guest's anonymous identity, created on first booking (`sunbnb-anonId`). */
function ensureAnonId(): string {
  let anonId = localStorage.getItem('sunbnb-anonId')
  if (!anonId) {
    anonId = uuidv4()
    localStorage.setItem('sunbnb-anonId', anonId)
  }
  return anonId
}

/**
 * Create the sunbed reservation for the current selection and move the funnel
 * on: unpaid venue → the reservation page; paid venue → the in-sheet payment
 * step (`reservationState: 'processing'`).
 */
function useSubmitSunbedReservation(site: SiteProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { selectedItems } = sitesState
  const reservationMode = sitesState.reservationMode || 'days'

  return async function submit(opts: { anonId?: string; email?: string }) {
    const reservationDay = dayjs(sitesState.reservationDay)
    const timeRange = sitesState.timeRange ? [dayjs(sitesState.timeRange[0]), dayjs(sitesState.timeRange[1])] : []
    const dateRange = sitesState.dateRange ? [dayjs(sitesState.dateRange[0]), dayjs(sitesState.dateRange[1])] : []

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
      const from = reservationDay.hour(timeRange[0].hour()).minute(timeRange[0].minute()).second(timeRange[0].second()).toDate()
      const to = reservationDay.hour(timeRange[1].hour()).minute(timeRange[1].minute()).second(timeRange[1].second()).toDate()
      saveResult = await saveReservationForMultipleItems({ ...common, from: from.toISOString(), to: to.toISOString(), type: 'hours' })
    } else if (reservationMode === 'days' && dateRange[0] && dateRange[1]) {
      // Send civil dates (YYYY-MM-DD), not browser instants: the server anchors
      // them to the venue's civil day (track 017 P3). A bare civil date is
      // unambiguous for guests booking from any timezone, unlike a browser
      // midnight which can land in the venue's previous/next day.
      saveResult = await saveReservationForMultipleItems({
        ...common,
        from: dateRange[0].format('YYYY-MM-DD'),
        to: dateRange[1].format('YYYY-MM-DD'),
        type: 'days',
      })
    }

    logger.debug('Save result', saveResult)
    if (saveResult?.status === 'ok' && saveResult.id) {
      if (site.type !== 'paid') {
        trackReservationCreated({ kind: 'sunbed', siteId: site.id!, transactionId: saveResult.id })
        const suffix = opts.anonId ? `?anonId=${opts.anonId}` : ''
        router.push(`/reservations/${saveResult.id}${suffix}`)
      } else {
        dispatch(setValue({ reservationState: 'processing', pendingReservationId: saveResult.id }))
      }
      return true
    }
    logger.debug('Save result error', saveResult)
    dispatch(setValue({ reservationState: 'default' }))
    return false
  }
}

/**
 * The booking sheet's pinned footer on the sunbeds tab: what is selected, and
 * Reserve. A signed-in guest books in one tap; anyone else continues to the
 * confirm step (email or sign in) — the email field used to live here and
 * pushed Reserve below the fold on a phone.
 */
function SunbedFooter({ site, onGuestContinue }: { site: SiteProps; onGuestContinue: () => void }) {
  const { data: session } = useSession()
  const loggedIn = !!session?.user?.id
  const sitesState = useSelector((state: RootState) => state.sites)
  const { selectedItems, reservationState } = sitesState
  const t = useTranslations('SiteView')
  const submit = useSubmitSunbedReservation(site)

  const items: any[] = selectedItems ?? []
  const saving = reservationState === 'saving'
  const seats = items.map((item) => formatSeatId(item)).join(', ')

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 text-left">
        <div className="text-sm font-semibold text-brand-ink">{t('sunbedsSelected', { count: items.length })}</div>
        <div className="truncate text-xs text-brand-ink/60">{items.length ? seats : t('Choose your sunbeds')}</div>
      </div>
      <button
        type="button"
        className={`${BTN_PRIMARY} shrink-0`}
        disabled={items.length === 0 || saving}
        onClick={() => (loggedIn ? submit({}) : onGuestContinue())}
      >
        {saving ? <Spinner /> : t('Reserve')}
      </button>
    </div>
  )
}

/**
 * The confirm step for a guest who is not signed in: give an email for the
 * confirmation, or sign in instead. Shared by sunbeds and equipment; the
 * booking summary and the confirm action come from the caller.
 */
function GuestConfirm({
  site,
  summary,
  notice,
  confirmLabel,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  site: SiteProps
  summary: React.ReactNode
  notice?: React.ReactNode
  confirmLabel: string
  busy: boolean
  error?: string | null
  onBack: () => void
  /** Called with a validated email; omitted email = signed-in guest. */
  onConfirm: (email?: string) => void
}) {
  const t = useTranslations('SiteView')
  const { data: session } = useSession()
  const loggedIn = !!session?.user?.id
  const signInHref = useSignInHref(site)
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState(false)

  return (
    <form
      className="flex min-h-0 flex-1 flex-col text-left"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (loggedIn) return onConfirm()
        const trimmed = email.trim()
        if (!isValidEmail(trimmed)) {
          setEmailError(true)
          return
        }
        onConfirm(trimmed)
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <button type="button" className={`${BTN_GHOST} mb-3`} onClick={onBack}>
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.83 10l3.94 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
          </svg>
          {t('Back')}
        </button>
        <h2 className="mb-3 text-lg font-semibold text-brand-ink">{t('Confirm your booking')}</h2>
        <div className="mb-4 rounded-xl border border-brand-ink/10 bg-white px-4 py-3">{summary}</div>
        {notice}
        {!loggedIn && (
          <>
            <label htmlFor="guest-email" className="mb-1.5 block text-sm font-medium text-brand-ink">
              {t('Email')}
            </label>
            <input
              id="guest-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className={`${INPUT} ${emailError ? 'border-red-400' : 'border-brand-ink/15'}`}
              value={email}
              aria-invalid={emailError}
              aria-describedby="guest-email-hint"
              onChange={(e) => {
                setEmail(e.target.value)
                if (emailError) setEmailError(false)
              }}
            />
            <p id="guest-email-hint" className={`mt-1.5 text-xs ${emailError ? 'text-red-600' : 'text-brand-ink/60'}`}>
              {emailError ? t('Enter a valid email') : t('confirmationEmailHint')}
            </p>
          </>
        )}
      </div>
      <div className="shrink-0 pt-3">
        {error && <p className="mb-2 text-center text-xs text-red-600" role="alert">{error}</p>}
        <button type="submit" className={`${BTN_PRIMARY} w-full`} disabled={busy}>
          {busy ? <Spinner /> : confirmLabel}
        </button>
        {!loggedIn && (
          <>
            <div className="my-2 flex items-center gap-3 text-xs text-brand-ink/50">
              <span className="h-px flex-1 bg-brand-ink/10" />
              {t('or')}
              <span className="h-px flex-1 bg-brand-ink/10" />
            </div>
            <button type="button" className={`${BTN_SECONDARY} w-full`} onClick={() => router.push(signInHref)}>
              {t('Sign in to book')}
            </button>
          </>
        )}
      </div>
    </form>
  )
}

/** The sunbed confirm step: the stay + seats, then `GuestConfirm`. */
function SunbedGuestConfirm({ site, onBack }: { site: SiteProps; onBack: () => void }) {
  const t = useTranslations('SiteView')
  const locale = useLocale()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { selectedItems, reservationState } = sitesState
  const submit = useSubmitSunbedReservation(site)
  const items: any[] = selectedItems ?? []
  const dateRange: [string, string] = sitesState.dateRange || singleDayRange(dayjs().format('YYYY-MM-DD'))

  return (
    <GuestConfirm
      site={site}
      onBack={onBack}
      busy={reservationState === 'saving'}
      confirmLabel={t('Reserve')}
      summary={
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-brand-ink/60">{t('Date')}</dt>
            <dd className="text-right font-medium text-brand-ink">{formatStay(locale, dateRange[0], dateRange[1])}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-brand-ink/60">{t('Sunbeds')}</dt>
            <dd className="text-right font-medium text-brand-ink">{items.map((i) => formatSeatId(i)).join(', ')}</dd>
          </div>
        </dl>
      }
      onConfirm={(email) => submit(email ? { anonId: ensureAnonId(), email } : {})}
    />
  )
}

/**
 * Mobile sunbed date control: the day strip, with the full calendar one tap
 * away behind the calendar tile for multi-day stays and far-off days.
 */
function MobileDayChooser({
  site,
  calendarOpen,
  setCalendarOpen,
}: {
  site: SiteProps
  calendarOpen: boolean
  setCalendarOpen: (open: boolean) => void
}) {
  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const t = useTranslations('SiteView')

  const { data } = useGetDailyAvailabilityQuery({ siteId: site.id!, days: 7 }, { skip: !site.id })

  // Same default as SunbedSelection: today, browser-local.
  const dateRange: [string, string] = sitesState.dateRange || singleDayRange(dayjs().format('YYYY-MM-DD'))

  if (calendarOpen) {
    return (
      <div className="pt-1">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-brand-ink">{t('Choose your dates')}</span>
          <button type="button" className={BTN_GHOST} onClick={() => setCalendarOpen(false)}>
            {t('Cancel')}
          </button>
        </div>
        <DateRangeSelector
          value={dateRange}
          label={`${t('From')} – ${t('To')}`}
          alwaysOpen
          onChange={(range) => {
            dispatch(setValue({ dateRange: range }))
            setCalendarOpen(false)
          }}
        />
      </div>
    )
  }

  return (
    <DayStrip
      days={data?.days}
      dateRange={dateRange}
      onSelect={(dateKey) => dispatch(setValue({ dateRange: singleDayRange(dateKey) }))}
      onOther={() => setCalendarOpen(true)}
    />
  )
}

/**
 * Phone sheet: a tap on the footer band (below the map / list) that is not on
 * a control closes the sheet — the band reads as "outside" the booking work,
 * and the guest gets back to the page without reaching for the handle.
 */
function useCloseSheetOnBackgroundTap() {
  const dispatch = useDispatch()
  return (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
    dispatch(setValue({ focused: false }))
  }
}

/**
 * The sunbeds tab. On a phone (the booking sheet) it is a fixed-height column:
 * day strip on top, the seat map taking every remaining pixel, the footer
 * pinned below — so Reserve is always on screen whatever the phone's height.
 * Desktop (`wide`) keeps the stacked sidebar with a 300px map.
 */
function ItemSelection({ apiKey, site, wide } : { apiKey: string, site: SiteProps, wide?: boolean }) {

  const sitesState = useSelector((state: RootState) => state.sites)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const closeSheetOnBackgroundTap = useCloseSheetOnBackgroundTap()

  // Closing the sheet abandons an open calendar, so it reopens on the strip.
  const sheetOpen = sitesState.focused !== false
  useEffect(() => {
    if (!sheetOpen) setDatePickerOpen(false)
  }, [sheetOpen])

  if (confirming) {
    return <SunbedGuestConfirm site={site} onBack={() => setConfirming(false)} />
  }

  if (wide) {
    return (
      <>
        <ReservationTimerangeSelector alwaysOpen workingHours={site.workingHours} mode="days" />
        <div className="w-full h-[300px]">
          <SunbedSelection apiKey={apiKey} site={site} />
        </div>
        <div className="mt-3">
          <SunbedFooter site={site} onGuestContinue={() => setConfirming(true)} />
        </div>
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <MobileDayChooser site={site} calendarOpen={datePickerOpen} setCalendarOpen={setDatePickerOpen} />
      </div>
      {!datePickerOpen && (
        <>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl">
            <SunbedSelection apiKey={apiKey} site={site} />
          </div>
          <div className="shrink-0 pt-3" onClick={closeSheetOnBackgroundTap}>
            <SunbedFooter site={site} onGuestContinue={() => setConfirming(true)} />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Equipment's date (and time) control — the sunbeds day strip, without seat
 * counts. Days mode: tiles book one day, the calendar tile a range. Hours
 * mode: tiles pick the day (the calendar picks one date), Start / Duration
 * steppers pick the hours, and the caption reads the whole slot back.
 */
function EquipmentWhen({
  mode,
  dateRange,
  day,
  hourWindow,
  slot,
  calendarOpen,
  setCalendarOpen,
}: {
  mode: 'hours' | 'days'
  dateRange: [string, string]
  day: dayjs.Dayjs
  hourWindow: HourBounds | null
  slot: { start: number; duration: number } | null
  calendarOpen: boolean
  setCalendarOpen: (open: boolean) => void
}) {
  const dispatch = useDispatch()
  const t = useTranslations('SiteView')

  const todayKey = dayjs().format('YYYY-MM-DD')
  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({ date: dayjs(todayKey).add(i, 'day').format('YYYY-MM-DD') })),
    [todayKey],
  )
  const hourly = mode === 'hours'
  const selection: [string, string] = hourly ? singleDayRange(day.format('YYYY-MM-DD')) : dateRange

  const setDay = (range: [string, string]) =>
    dispatch(setValue(hourly ? { reservationDay: dayjs(range[0]).toDate() } : { dateRange: range }))

  if (calendarOpen) {
    return (
      <div className="pt-1">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-brand-ink">{hourly ? t('Choose a day') : t('Choose your dates')}</span>
          <button type="button" className={BTN_GHOST} onClick={() => setCalendarOpen(false)}>
            {t('Cancel')}
          </button>
        </div>
        <DateRangeSelector
          value={selection}
          label={`${t('From')} – ${t('To')}`}
          alwaysOpen
          single={hourly}
          onChange={(range) => {
            setDay(range as [string, string])
            setCalendarOpen(false)
          }}
        />
      </div>
    )
  }

  const rangeDays = dayjs(selection[1]).startOf('day').diff(dayjs(selection[0]).startOf('day'), 'day') + 1

  return (
    <DayStrip
      days={days}
      dateRange={selection}
      onSelect={(key) => setDay(singleDayRange(key))}
      onOther={() => setCalendarOpen(true)}
      between={
        hourly ? (
          <TimeStepper
            bounds={hourWindow}
            start={slot?.start ?? 0}
            duration={slot?.duration ?? 1}
            onChange={(next) =>
              dispatch(setValue({ timeRange: [day.hour(next.start).toDate(), day.hour(next.start + next.duration).toDate()] }))
            }
          />
        ) : undefined
      }
      captionAside={
        hourly
          ? slot
            ? `${fmtHour(slot.start)}–${fmtHour(slot.start + slot.duration)}`
            : ''
          : t('daysCount', { count: rangeDays })
      }
    />
  )
}

function EquipmentBookingSection({ site, wide }: { site: SiteProps; wide?: boolean }) {

  const { data: session } = useSession()
  const router = useRouter()
  const loggedIn = !!(session?.user?.id)

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)

  // A mode exists only if some item is priced for it; the Hours/Days choice
  // shows only when both do. (Before, an hourly-only venue offered Days, where
  // its items cost €0, and a day-only venue could book by the hour.)
  const rentalItems = site.rentalItems || []
  const hasHourlyPricing = rentalItems.some(ri => unitPrice(ri, 'hours') != null)
  const hasDailyPricing = rentalItems.some(ri => unitPrice(ri, 'days') != null)
  const offersBothModes = hasHourlyPricing && hasDailyPricing
  const reservationMode: 'hours' | 'days' = offersBothModes
    ? (sitesState.reservationMode === 'days' ? 'days' : 'hours')
    : hasHourlyPricing ? 'hours' : 'days'

  const [cart, setCart] = useState<{ rentalItemId: string; quantity: number }[]>([])
  const [booking, setBooking] = useState(false)
  const [bookingComplete, setBookingComplete] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [confirmationCart, setConfirmationCart] = useState<{ rentalItemId: string; quantity: number }[]>([])
  const [confirmationTotal, setConfirmationTotal] = useState(0)
  const [rentalPaymentLoading, setRentalPaymentLoading] = useState(false)
  const [rentalPaymentError, setRentalPaymentError] = useState<string | null>(null)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const closeSheetOnBackgroundTap = useCloseSheetOnBackgroundTap()

  const t = useTranslations('SiteView')
  const tp = useTranslations('Payment')
  const locale = useLocale()

  const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

  // The hourly slot, clamped into the chosen day's opening hours (and not in
  // the past today), is the ONE source for what is shown, priced and booked —
  // the defaults used to differ (picker: opening hour; booking: now + 2 h).
  const reservationDay = dayjs(sitesState.reservationDay || new Date()).startOf('day')
  const { openHour, closeHour } = getOpenCloseHours(reservationDay, site.workingHours)
  const hourWindow = hourBounds(openHour, closeHour, reservationDay.isSame(dayjs(), 'day'), dayjs().hour())
  const storedSlot = sitesState.timeRange
    ? { start: dayjs(sitesState.timeRange[0]).hour(), duration: dayjs(sitesState.timeRange[1]).hour() - dayjs(sitesState.timeRange[0]).hour() }
    : undefined
  const slot = hourWindow ? clampSlot(hourWindow, storedSlot) : null
  useEffect(() => {
    if (reservationMode !== 'hours' || !slot) return
    if (storedSlot?.start === slot.start && storedSlot?.duration === slot.duration) return
    dispatch(setValue({
      timeRange: [
        reservationDay.hour(slot.start).toDate(),
        reservationDay.hour(slot.start + slot.duration).toDate(),
      ],
    }))
  }, [reservationMode, slot?.start, slot?.duration, storedSlot?.start, storedSlot?.duration])

  const timeRange = slot
    ? [reservationDay.hour(slot.start), reservationDay.hour(slot.start + slot.duration)]
    : []
  const dateRangeIso: [string, string] = sitesState.dateRange || singleDayRange(dayjs().format('YYYY-MM-DD'))
  const dateRange: [dayjs.Dayjs, dayjs.Dayjs] = [dayjs(dateRangeIso[0]), dayjs(dateRangeIso[1])]

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

  // Only items priced for this mode are bookable in it; live availability merged in.
  const itemsWithAvailability = rentalItems
    .filter(item => unitPrice(item, reservationMode) != null)
    .map(item => {
      const avail = rentalAvailability?.availability?.find(a => a.rentalItemId === item.id)
      return avail ? { ...item, availableQuantity: avail.availableQuantity } : item
    })

  // Switching mode drops cart lines the new mode cannot price.
  useEffect(() => {
    setCart(prev => {
      const next = prev.filter(c => {
        const item = rentalItems.find(ri => ri.id === c.rentalItemId)
        return item && unitPrice(item, reservationMode) != null
      })
      return next.length === prev.length ? prev : next
    })
  }, [reservationMode])

  const totalItems = cart.reduce((sum, c) => sum + c.quantity, 0)

  // Hours or days being booked — the multiplier for every unit price.
  const bookedUnits = reservationMode === 'hours'
    ? (slot?.duration ?? 0)
    : Math.max(1, dateRange[1].startOf('day').diff(dateRange[0].startOf('day'), 'day') + 1)

  // Calculate total price
  const totalPrice = cart.reduce((sum, cartItem) => {
    const item = site.rentalItems?.find(ri => ri.id === cartItem.rentalItemId)
    const price = item ? unitPrice(item, reservationMode) : null
    if (price == null) return sum
    return sum + price * bookedUnits * cartItem.quantity
  }, 0)

  const isPaidSite = (site.rentalPaymentType ?? site.type) === 'paid'

  const [bookingError, setBookingError] = useState<string | null>(null)

  const handleBook = () => {
    if (totalItems === 0) return
    // A guest's email is asked on the confirm step (GuestConfirm), not here.
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

  const handleConfirmBooking = async (guestEmail?: string) => {
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
        guestEmail: !loggedIn ? guestEmail : undefined,
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
          trackReservationCreated({ kind: 'rental', siteId: site.id!, transactionId: result.bookingIds![0]! })
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

    // GA4: amount is the total the confirmation screen just showed the guest.
    const funnel = { kind: 'rental' as const, siteId: site.id!, siteName: site.name, value: confirmationTotal, quantity: confirmationCart.length || undefined }
    trackBeginCheckout(funnel)

    // Read anonId for anonymous ownership verification throughout the payment flow
    const anonId = typeof window !== 'undefined'
      ? localStorage.getItem('sunbnb-anonId') ?? undefined
      : undefined

    try {
      if (DEMO_MODE) {
        const result = await initiateDemoRentalPayment(bookingIds, anonId)
        if (result.status === 'ok') {
          // Demo payment settles inline (no return page), so the purchase fires here.
          trackPurchase({ ...funnel, transactionId: bookingIds[0]! })
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

      const legacy = usesLegacyMollieEndpoint(site.paymentProvider)
      const res = await fetch(legacy ? '/api/payment/mollie/create-rental-payment' : '/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          legacy
            ? { rentalBookingIds: bookingIds, anonId: anonId ?? null, redirectUrl }
            : neutralCheckoutBody('rental', { rentalBookingIds: bookingIds }, { anonId, redirectUrl }),
        ),
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

  // Confirm step: order summary, then email (or sign in) for a guest, then
  // pay / confirm. Shares GuestConfirm with the sunbeds tab.
  if (showConfirmation) {
    const dates = getBookingDates()
    return (
      <GuestConfirm
        site={site}
        onBack={() => setShowConfirmation(false)}
        busy={booking || rentalPaymentLoading}
        error={bookingError || rentalPaymentError}
        confirmLabel={isPaidSite ? tp('Pay now') : t('Confirm booking')}
        onConfirm={(email) => handleConfirmBooking(email)}
        summary={
          <div className="text-sm">
            {confirmationCart.map((cartItem) => {
              const item = site.rentalItems?.find(ri => ri.id === cartItem.rentalItemId)
              if (!item) return null
              const lineTotal = (unitPrice(item, reservationMode) ?? 0) * bookedUnits * cartItem.quantity
              return (
                <div key={cartItem.rentalItemId} className="mb-1 flex items-center justify-between text-brand-ink">
                  <span>{item.name} × {cartItem.quantity}</span>
                  <span className="font-medium tabular-nums">€{lineTotal.toFixed(2)}</span>
                </div>
              )
            })}
            {dates && (
              <div className="mt-2 border-t border-brand-ink/10 pt-2 text-xs text-brand-ink/60">
                {reservationMode === 'hours'
                  ? `${formatStay(locale, dates.from)}, ${dayjs(dates.from).format('HH:mm')}–${dayjs(dates.to).format('HH:mm')}`
                  : formatStay(locale, dates.from, dates.to)}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between border-t border-brand-ink/10 pt-2 font-semibold text-brand-ink">
              <span>{t('Total')}</span>
              <span className="tabular-nums">€{confirmationTotal.toFixed(2)}</span>
            </div>
          </div>
        }
        notice={
          isPaidSite ? (
            <p className="mb-4 text-xs text-brand-ink/60">
              {tp('You will be redirected to complete payment')}{' '}
              {tp('Payment confirms acceptance of')}{' '}
              <a className="underline" href="/tos/reservation" target="_blank" rel="noopener noreferrer">
                {tp('terms of service')}
              </a>
            </p>
          ) : (
            <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
              {t('Pay at the venue when you pick up your equipment')}
            </p>
          )
        }
      />
    )
  }

  const reserveLabel = totalItems > 0
    ? `${t('Reserve')} · €${totalPrice.toFixed(2)}`
    : t('Reserve')

  // Same frame as the sunbeds tab: controls on top, the item list taking the
  // remaining height (it scrolls — a list, unlike the map, may), footer pinned.
  return (
    <div className={wide ? '' : 'flex min-h-0 flex-1 flex-col'}>
      <div className="shrink-0">
        {offersBothModes && (
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-brand-ink/70">{t('Rent by')}</span>
            <div className="inline-flex rounded-lg bg-brand-ink/5 p-0.5" role="group" aria-label={t('Rent by')}>
              {(['hours', 'days'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={reservationMode === m}
                  onClick={() => dispatch(setValue({ reservationMode: m }))}
                  className={`h-8 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-ink ${
                    reservationMode === m ? 'bg-white text-brand-ink shadow-xs' : 'text-brand-ink/60 hover:text-brand-ink'
                  }`}
                >
                  {m === 'hours' ? t('Hours') : t('Days')}
                </button>
              ))}
            </div>
          </div>
        )}
        <EquipmentWhen
          mode={reservationMode}
          dateRange={dateRangeIso}
          day={reservationDay}
          hourWindow={hourWindow}
          slot={slot}
          calendarOpen={datePickerOpen}
          setCalendarOpen={setDatePickerOpen}
        />
      </div>
      {!datePickerOpen && (
        <>
          <div className={wide ? 'h-[300px] w-full' : 'min-h-0 flex-1'}>
            <EquipmentSelection
              items={itemsWithAvailability}
              cart={cart}
              onCartChange={setCart}
              durationType={reservationMode}
            />
          </div>
          <div className="shrink-0 pt-3" onClick={wide ? undefined : closeSheetOnBackgroundTap}>
            {bookingError && (
              <p className="mb-1.5 text-center text-xs text-red-600" role="alert">{bookingError}</p>
            )}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 text-left">
                <div className="text-sm font-semibold text-brand-ink">{t('itemsSelected', { count: totalItems })}</div>
                <div className="truncate text-xs text-brand-ink/60">
                  {totalItems === 0
                    ? t('Choose your equipment')
                    : reservationMode === 'hours'
                      // The day is in the caption just above; the footer needs the hours.
                      ? slot ? `${fmtHour(slot.start)}–${fmtHour(slot.start + slot.duration)} · ${t('hoursCount', { count: slot.duration })}` : ''
                      : formatStay(locale, dateRangeIso[0], dateRangeIso[1])}
                </div>
              </div>
              <button
                type="button"
                className={`${BTN_PRIMARY} shrink-0`}
                disabled={totalItems === 0 || booking || (reservationMode === 'hours' && !slot)}
                onClick={handleBook}
              >
                {booking ? <Spinner /> : reserveLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
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
    <div className="mb-2 flex rounded-lg bg-gray-100 p-0.5">
      <button
        type="button"
        onClick={() => onChange('sunbeds')}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-all ${
          mode === 'sunbeds'
            ? 'bg-white text-gray-900 shadow-xs'
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
            ? 'bg-white text-gray-900 shadow-xs'
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

  const paying = reservationState === RESERVATION_PROCESSING || reservationState === 'payment_in_progress'

  // On a phone this fills the booking sheet as one column (see BookingSurface):
  // children decide which part flexes. Desktop (`wide`) stacks naturally.
  return (
    <div className={wide ? '' : 'flex h-full min-h-0 flex-col'}>
      {paying ? (
        <div className={wide ? '' : 'min-h-0 flex-1 overflow-y-auto'}>
          {!reservation ? (
            <div className="flex justify-center py-6 text-brand-ink/60">
              <Spinner className="h-6 w-6" />
            </div>
          ) : (
            <PaymentView reservation={reservation} paymentProvider={site.paymentProvider} onCancel={handleCancelReservation} />
          )}
        </div>
      ) : (
        <>
          <div className="shrink-0">
            <ViewModeSelector
              mode={viewMode}
              onChange={(mode) => {
                setViewMode(mode)
                dispatch(setValue({ reservationMode: mode === 'sunbeds' ? 'days' : 'hours' }))
              }}
              hasSunbeds={hasSunbeds}
              hasRentals={hasRentals}
            />
          </div>
          {viewMode === 'equipment' && hasRentals ? (
            <EquipmentBookingSection site={site} wide={wide} />
          ) : (
            <ItemSelection apiKey={apiKey} site={site} wide={wide} />
          )}
        </>
      )}
    </div>
  )
}
