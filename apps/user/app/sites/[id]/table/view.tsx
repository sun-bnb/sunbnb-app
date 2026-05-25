'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import TextField from '@mui/material/TextField'
import CircularProgress from '@mui/material/CircularProgress'
import {
  AvailabilityPicker,
  BookingForm,
  type BookingFormValues,
} from '@repo/table-reservations-ui'
import type { AvailabilitySlot } from '@repo/table-reservations-core'
import { bookTableForSite, initiateDemoTableDeposit, joinWaitlistForSite } from './actions'

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || ''

interface Props {
  siteId: string
  restaurant: {
    id: string
    name: string
    reservationWindow: number
  }
  initialDate?: string
  initialPartySize?: number
}

interface SlotWire {
  from: string
  to: string
  availableTableIds: string[]
}

/** State set when bookTableForSite returns requiresDeposit. */
interface DepositPending {
  reservationId: string
  depositAmount: number
}

const ANON_ID_KEY = 'sunbnb-anonId'

/** Full booking flow on a single page: pick slot → fill form → pay deposit (if required) → confirm. */
export default function TableBookingView({
  siteId,
  restaurant,
  initialDate,
  initialPartySize,
}: Props) {
  const t = useTranslations('TableBooking')
  const router = useRouter()

  const today = formatYmd(new Date())
  const maxDate = formatYmd(new Date(Date.now() + restaurant.reservationWindow * 86400000))

  const [date, setDate] = useState(initialDate || today)
  const [partySize, setPartySize] = useState(initialPartySize ?? 2)
  const [slots, setSlots] = useState<SlotWire[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<SlotWire | null>(null)
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [depositPending, setDepositPending] = useState<DepositPending | null>(null)
  const [depositError, setDepositError] = useState<string | null>(null)
  const [depositLoading, setDepositLoading] = useState(false)
  const [waitlisted, setWaitlisted] = useState(false)

  // Anonymous identity — persisted across bookings so cancellation stays
  // possible without signing in. Keep scoped to this hook (same pattern as
  // Sunbnb's sunbed flow).
  const [anonId, setAnonId] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    let id = window.localStorage.getItem(ANON_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem(ANON_ID_KEY, id)
    }
    setAnonId(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoadingSlots(true)
      try {
        const res = await fetch(
          `/api/restaurants/${restaurant.id}/availability?date=${encodeURIComponent(date)}&partySize=${partySize}`,
        )
        if (!res.ok) {
          if (!cancelled) setSlots([])
          return
        }
        const body = (await res.json()) as { slots: SlotWire[] }
        if (!cancelled) {
          setSlots(body.slots)
          setSelectedSlot(null)
          setSelectedTableId(null)
          setWaitlisted(false)
        }
      } finally {
        if (!cancelled) setLoadingSlots(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [restaurant.id, date, partySize])

  const availabilitySlots: AvailabilitySlot[] = slots.map((s) => ({
    from: new Date(s.from),
    to: new Date(s.to),
    availableTableIds: s.availableTableIds,
  }))

  // ── Deposit pay step ────────────────────────────────────────────────────────
  if (depositPending) {
    const { reservationId, depositAmount } = depositPending

    if (DEMO_MODE) {
      return (
        <DepositDemoStep
          restaurantName={restaurant.name}
          reservationId={reservationId}
          depositAmount={depositAmount}
          anonId={anonId}
          loading={depositLoading}
          error={depositError}
          onPay={async () => {
            setDepositLoading(true)
            setDepositError(null)
            const res = await initiateDemoTableDeposit(reservationId, anonId)
            setDepositLoading(false)
            if (res.status === 'ok') {
              router.push(`/table-reservations/${reservationId}`)
            } else {
              setDepositError(res.errors?.[0] ?? 'Payment failed')
            }
          }}
        />
      )
    }

    // Mollie redirect path
    return (
      <DepositMollieStep
        restaurantName={restaurant.name}
        reservationId={reservationId}
        depositAmount={depositAmount}
        anonId={anonId}
        loading={depositLoading}
        error={depositError}
        onPay={async () => {
          setDepositLoading(true)
          setDepositError(null)
          try {
            const redirectUrl = `${APP_URL}/table-reservations/${reservationId}`
            const res = await fetch(
              `/api/table-reservations/${reservationId}/deposit/mollie`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ redirectUrl, anonId }),
              },
            )
            const data = await res.json()
            if (data.error) {
              setDepositError(data.error)
              setDepositLoading(false)
              return
            }
            window.location.assign(data.checkoutUrl)
          } catch {
            setDepositError('Payment failed — please try again')
            setDepositLoading(false)
          }
        }}
      />
    )
  }

  return (
    <div className="max-w-xl mx-auto p-6 flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">
          {t('pageTitle', { name: restaurant.name })}
        </h1>
      </header>

      <section className="flex gap-3 flex-wrap">
        <TextField
          size="small"
          type="date"
          label={t('dateLabel')}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: today, max: maxDate }}
          sx={{ minWidth: 180 }}
        />
        <TextField
          size="small"
          type="number"
          label={t('partySizeLabel')}
          value={partySize}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n >= 1 && n <= 50) setPartySize(n)
          }}
          inputProps={{ min: 1, max: 50 }}
          sx={{ width: 140 }}
        />
      </section>

      <section>
        {loadingSlots ? (
          <div className="text-sm text-gray-500 py-4">{t('loadingSlots')}</div>
        ) : (
          <AvailabilityPicker
            slots={availabilitySlots}
            selectedIso={selectedSlot?.from ?? null}
            labels={{
              heading: t('availabilityHeading'),
              empty: t('availabilityEmpty'),
              tablesSuffix: t('tablesSuffix'),
            }}
            onSelect={(slot) => {
              const wire: SlotWire = {
                from: new Date(slot.from).toISOString(),
                to: new Date(slot.to).toISOString(),
                availableTableIds: slot.availableTableIds,
              }
              setSelectedSlot(wire)
              // Default to the first available table — the customer can switch
              // once we expose a TableSelector (post-MVP).
              setSelectedTableId(slot.availableTableIds[0] ?? null)
            }}
          />
        )}
      </section>

      {!loadingSlots && slots.length === 0 ? (
        <section className="border-t border-gray-200 pt-5">
          {waitlisted ? (
            <div
              role="status"
              className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
            >
              {t('waitlistJoined')}
            </div>
          ) : (
            <BookingForm
              labels={{
                heading: t('waitlistHeading'),
                guestName: t('fieldGuestName'),
                guestEmail: t('fieldGuestEmail'),
                guestPhone: t('fieldGuestPhone'),
                specialRequests: t('fieldSpecialRequests'),
                submit: t('waitlistSubmit'),
                submitting: t('submitting'),
                errorPrefix: t('errorPrefix'),
              }}
              onSubmit={async (values: BookingFormValues) => {
                const res = await joinWaitlistForSite({
                  siteId,
                  dateISO: date,
                  partySize,
                  guestName: values.guestName,
                  guestEmail: values.guestEmail,
                  guestPhone: values.guestPhone || null,
                  anonId,
                })
                if (res.status === 'ok') setWaitlisted(true)
                return res
              }}
            />
          )}
        </section>
      ) : null}

      {selectedSlot && selectedTableId ? (
        <section className="border-t border-gray-200 pt-5">
          <BookingForm
            labels={{
              heading: t('formHeading'),
              guestName: t('fieldGuestName'),
              guestEmail: t('fieldGuestEmail'),
              guestPhone: t('fieldGuestPhone'),
              specialRequests: t('fieldSpecialRequests'),
              submit: t('submit'),
              submitting: t('submitting'),
              errorPrefix: t('errorPrefix'),
            }}
            onSubmit={async (values: BookingFormValues) => {
              const res = await bookTableForSite({
                siteId,
                tableId: selectedTableId!,
                fromIso: selectedSlot!.from,
                toIso: selectedSlot!.to,
                partySize,
                guestName: values.guestName,
                guestEmail: values.guestEmail,
                guestPhone: values.guestPhone || null,
                specialRequests: values.specialRequests || null,
                anonId,
              })
              if (res.status === 'ok') {
                if (res.requiresDeposit) {
                  // Transition to the in-page deposit pay step (no page nav).
                  setDepositPending({
                    reservationId: res.reservationId,
                    depositAmount: res.depositAmount ?? 0,
                  })
                } else {
                  router.push(`/table-reservations/${res.reservationId}`)
                }
              }
              return res
            }}
          />
        </section>
      ) : null}
    </div>
  )
}

// ── Deposit pay-step sub-components ──────────────────────────────────────────

interface DepositStepProps {
  restaurantName: string
  reservationId: string
  depositAmount: number
  anonId: string | null
  loading: boolean
  error: string | null
  onPay: () => void | Promise<void>
}

function DepositAmountBadge({ amount }: { amount: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 mb-4">
      <div>
        <p className="text-sm font-medium text-gray-700">Refundable deposit</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Held until your visit — refunded on arrival
        </p>
      </div>
      <span className="text-lg font-semibold text-gray-900">
        &euro;{amount.toFixed(2)}
      </span>
    </div>
  )
}

function DepositDemoStep({
  restaurantName,
  depositAmount,
  loading,
  error,
  onPay,
}: DepositStepProps) {
  return (
    <div className="max-w-xl mx-auto p-6 flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">{restaurantName}</h1>
        <p className="text-sm text-gray-600 mt-1">
          A refundable deposit is required to confirm your table.
        </p>
      </header>
      <DepositAmountBadge amount={depositAmount} />
      <button
        type="button"
        disabled={loading}
        onClick={onPay}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-gray-900 text-white text-sm font-semibold py-3 hover:bg-gray-800 disabled:opacity-60 transition-colors"
      >
        {loading ? (
          <CircularProgress size={16} color="inherit" />
        ) : (
          'Pay deposit (demo)'
        )}
      </button>
      {error && <p className="text-red-600 text-sm text-center">{error}</p>}
    </div>
  )
}

function DepositMollieStep({
  restaurantName,
  depositAmount,
  loading,
  error,
  onPay,
}: DepositStepProps) {
  return (
    <div className="max-w-xl mx-auto p-6 flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">{restaurantName}</h1>
        <p className="text-sm text-gray-600 mt-1">
          A refundable deposit is required to confirm your table.
        </p>
      </header>
      <DepositAmountBadge amount={depositAmount} />
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <svg
            className="w-4 h-4 text-gray-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="text-sm font-medium text-gray-700">Secure checkout</span>
        </div>
        <p className="text-xs text-gray-500">
          You will be redirected to complete payment
        </p>
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={onPay}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-gray-900 text-white text-sm font-semibold py-3 hover:bg-gray-800 disabled:opacity-60 transition-colors"
      >
        {loading ? <CircularProgress size={16} color="inherit" /> : 'Pay deposit now'}
      </button>
      {error && <p className="text-red-600 text-sm text-center">{error}</p>}
    </div>
  )
}

function formatYmd(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
