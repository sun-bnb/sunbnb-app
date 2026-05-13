'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import TextField from '@mui/material/TextField'
import {
  AvailabilityPicker,
  BookingForm,
  type BookingFormValues,
} from '@repo/table-reservations-ui'
import type { AvailabilitySlot } from '@repo/table-reservations-core'
import { bookTableForSite } from './actions'

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

const ANON_ID_KEY = 'sunbnb-anonId'

/** Full booking flow on a single page: pick slot → fill form → submit. */
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
                router.push(`/table-reservations/${res.reservationId}`)
              }
              return res
            }}
          />
        </section>
      ) : null}
    </div>
  )
}

function formatYmd(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
