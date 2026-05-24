'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ConfirmationCard } from '@repo/table-reservations-ui'
import { TABLE_RESERVATION_STATUS } from '@repo/table-reservations-core/status'
import { cancelTableBooking } from '../../sites/[id]/table/actions'

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
}

export default function TableReservationView({ reservation, restaurantName }: Props) {
  const t = useTranslations('TableBooking')
  const router = useRouter()
  const [status, setStatus] = useState(reservation.status)
  const [anonId, setAnonId] = useState<string | null>(null)

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

  return (
    <div className="max-w-xl mx-auto p-6">
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
    </div>
  )
}
