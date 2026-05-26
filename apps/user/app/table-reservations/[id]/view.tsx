'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AvailabilityPicker, ConfirmationCard } from '@repo/table-reservations-ui'
import type { AvailabilitySlot } from '@repo/table-reservations-core'
import { TABLE_RESERVATION_STATUS } from '@repo/table-reservations-core/status'
import { cancelTableBooking, modifyTableBooking } from '../../sites/[id]/table/actions'

const ANON_ID_KEY = 'sunbnb-anonId'

interface Props {
  reservation: {
    id: string
    from: string
    to: string
    partySize: number
    specialRequests: string | null
    status: string
    userId: string | null
    anonId: string | null
  }
  restaurantName: string
  restaurantId: string
  reservationWindow: number
}

interface SlotWire {
  from: string
  to: string
  availableTableIds: string[]
}

function ymd(iso: string | Date): string {
  return new Date(iso).toISOString().slice(0, 10)
}

export default function TableReservationView({
  reservation,
  restaurantName,
  restaurantId,
  reservationWindow,
}: Props) {
  const t = useTranslations('TableBooking')
  const router = useRouter()
  const [status, setStatus] = useState(reservation.status)
  const [anonId, setAnonId] = useState<string | null>(null)

  // ── Modify mode ─────────────────────────────────────────────────────────────
  const [modifying, setModifying] = useState(false)
  const [modDate, setModDate] = useState(ymd(reservation.from))
  const [modParty, setModParty] = useState(reservation.partySize)
  const [modSlots, setModSlots] = useState<SlotWire[]>([])
  const [modLoading, setModLoading] = useState(false)
  const [modError, setModError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setAnonId(window.localStorage.getItem(ANON_ID_KEY))
  }, [])

  // While the deposit is being collected (returned from Mollie / demo), poll the
  // status route until the booking confirms. The Mollie webhook is the primary
  // confirm path; this is the safety net when the customer beats the webhook.
  useEffect(() => {
    if (status !== TABLE_RESERVATION_STATUS.PENDING_PAYMENT) return
    let active = true
    const poll = async () => {
      const qs = anonId ? `?anonId=${encodeURIComponent(anonId)}` : ''
      try {
        const res = await fetch(`/api/table-reservations/${reservation.id}${qs}`)
        if (!res.ok) return
        const data = await res.json()
        if (active && data?.status && data.status !== status) {
          setStatus(data.status)
          router.refresh()
        }
      } catch {
        /* transient — the next tick retries */
      }
    }
    poll()
    const interval = setInterval(poll, 2500)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [status, anonId, reservation.id, router])

  // Fetch availability for the new date/party while in modify mode.
  useEffect(() => {
    if (!modifying) return
    let cancelled = false
    const run = async () => {
      setModLoading(true)
      try {
        const res = await fetch(
          `/api/restaurants/${restaurantId}/availability?date=${encodeURIComponent(modDate)}&partySize=${modParty}`,
        )
        if (!res.ok) {
          if (!cancelled) setModSlots([])
          return
        }
        const body = (await res.json()) as { slots: SlotWire[] }
        if (!cancelled) setModSlots(body.slots)
      } finally {
        if (!cancelled) setModLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [modifying, modDate, modParty, restaurantId])

  const modAvailability: AvailabilitySlot[] = modSlots.map((s) => ({
    from: new Date(s.from),
    to: new Date(s.to),
    availableTableIds: s.availableTableIds,
  }))

  const today = ymd(new Date())
  const maxDate = ymd(new Date(Date.now() + reservationWindow * 86400000))
  const canModify = status === TABLE_RESERVATION_STATUS.CONFIRMED

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <ConfirmationCard
        reservation={{
          id: reservation.id,
          from: reservation.from,
          to: reservation.to,
          partySize: reservation.partySize,
          specialRequests: reservation.specialRequests,
          status,
        }}
        restaurantName={restaurantName}
        labels={{
          confirmedTitle: t('confirmedTitle'),
          canceledTitle: t('canceledTitle'),
          dateLabel: t('confirmationDate'),
          timeLabel: t('confirmationTime'),
          partyLabel: t('confirmationParty'),
          notesLabel: t('confirmationNotes'),
          idLabel: t('confirmationId'),
          cancelButton: t('cancelButton'),
          canceling: t('canceling'),
          cancelConfirmTitle: t('cancelConfirmTitle'),
          cancelConfirmBody: t('cancelConfirmBody'),
          cancelYes: t('cancelYes'),
          cancelNo: t('cancelNo'),
          guestsSingular: t('guest'),
          guestsPlural: t('guests'),
          errorPrefix: t('errorPrefix'),
        }}
        onCancel={async () => {
          const res = await cancelTableBooking(reservation.id, anonId)
          if (res.status === 'ok') {
            setStatus('canceled')
            router.refresh()
          }
          return res
        }}
      />

      {canModify && !modifying && (
        <button
          type="button"
          onClick={() => {
            setModError(null)
            setModifying(true)
          }}
          className="self-start text-sm font-medium text-gray-700 underline hover:text-gray-900"
        >
          {t('modifyButton')}
        </button>
      )}

      {modifying && (
        <section className="flex flex-col gap-3 border-t border-gray-200 pt-4">
          <h2 className="text-sm font-semibold text-gray-900">{t('modifyHeading')}</h2>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              {t('dateLabel')}
              <input
                type="date"
                value={modDate}
                min={today}
                max={maxDate}
                onChange={(e) => setModDate(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              {t('partySizeLabel')}
              <input
                type="number"
                value={modParty}
                min={1}
                max={50}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n) && n >= 1 && n <= 50) setModParty(n)
                }}
                className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
          </div>

          {modLoading ? (
            <div className="py-3 text-sm text-gray-500">{t('loadingSlots')}</div>
          ) : (
            <AvailabilityPicker
              slots={modAvailability}
              selectedIso={null}
              labels={{
                heading: t('availabilityHeading'),
                empty: t('availabilityEmpty'),
                tablesSuffix: t('tablesSuffix'),
              }}
              onSelect={async (slot) => {
                setModError(null)
                const res = await modifyTableBooking({
                  reservationId: reservation.id,
                  fromIso: new Date(slot.from).toISOString(),
                  toIso: new Date(slot.to).toISOString(),
                  partySize: modParty,
                  tableId: slot.availableTableIds[0],
                  anonId,
                })
                if (res.status === 'ok') {
                  setModifying(false)
                  router.refresh()
                } else {
                  setModError(res.errors?.[0] ?? t('errorPrefix'))
                }
              }}
            />
          )}

          {modError && <p className="text-sm text-red-600">{modError}</p>}

          <button
            type="button"
            onClick={() => setModifying(false)}
            className="self-start text-sm text-gray-500 hover:text-gray-700"
          >
            {t('modifyCancel')}
          </button>
        </section>
      )}
    </div>
  )
}
