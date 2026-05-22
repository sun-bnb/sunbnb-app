'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ReservationList,
  type ReservationListLabels,
} from '@repo/table-reservations-ui'
import type { TableReservationListItem } from '@repo/table-reservations-core'
import { RestaurantSubNav } from '../RestaurantSubNav'
import { RestaurantHeader } from '../RestaurantHeader'
import {
  getRestaurantReservationsForDay,
  markRestaurantReservationSeated,
  markRestaurantReservationDeparted,
  markRestaurantReservationNoShow,
  cancelRestaurantReservation,
  setRestaurantReservationNotes,
} from './actions'

function formatYmd(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function ReservationsView({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations('Restaurant')

  const [date, setDate] = useState(formatYmd(new Date()))
  const [items, setItems] = useState<TableReservationListItem[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const res = await getRestaurantReservationsForDay(restaurantId, date)
    if (res.status === 'ok') setItems(res.reservations)
    else setItems([])
  }, [restaurantId, date])

  useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const labels: ReservationListLabels = {
    dateLabel: t('resDateLabel'),
    filterAll: t('resFilterAll'),
    filterExpected: t('resFilterExpected'),
    filterSeated: t('resFilterSeated'),
    filterDeparted: t('resFilterDeparted'),
    filterNoShow: t('resFilterNoShow'),
    filterCanceled: t('resFilterCanceled'),
    emptyTitle: t('resEmptyTitle'),
    emptyHint: t('resEmptyHint'),
    row: {
      markSeated: t('resActionSeat'),
      markDeparted: t('resActionDepart'),
      markNoShow: t('resActionNoShow'),
      cancel: t('resActionCancel'),
      tableLabel: t('resTable'),
      partyShort: t('resParty'),
      notesPlaceholder: t('resNotesPlaceholder'),
      notesSave: t('resNotesSave'),
      notesSaving: t('saving'),
      notesSaved: t('resNotesSaved'),
      notesEditToggle: t('resNotesToggle'),
      statusExpected: t('resStatusExpected'),
      statusSeated: t('resStatusSeated'),
      statusDeparted: t('resStatusDeparted'),
      statusNoShow: t('resStatusNoShow'),
      statusCanceled: t('resStatusCanceled'),
      noTable: t('resNoTable'),
    },
  }

  return (
    <div className="pt-2">
      <RestaurantSubNav restaurantId={restaurantId} active="reservations" />
      <div className="p-4 space-y-4">
        <RestaurantHeader restaurantId={restaurantId} />
        {loading ? (
          <div className="text-sm text-gray-500">{t('loading')}</div>
        ) : (
          <ReservationList
            date={date}
            reservations={items}
            labels={labels}
            onChangeDate={(d) => setDate(d)}
            onMarkSeated={async (id) => {
              const res = await markRestaurantReservationSeated(restaurantId, id)
              if (res.status === 'ok') await refresh()
              return res
            }}
            onMarkDeparted={async (id) => {
              const res = await markRestaurantReservationDeparted(restaurantId, id)
              if (res.status === 'ok') await refresh()
              return res
            }}
            onMarkNoShow={async (id) => {
              const res = await markRestaurantReservationNoShow(restaurantId, id)
              if (res.status === 'ok') await refresh()
              return res
            }}
            onCancel={async (id) => {
              const res = await cancelRestaurantReservation(restaurantId, id)
              if (res.status === 'ok') await refresh()
              return res
            }}
            onUpdateNotes={async (id, notes) => {
              const res = await setRestaurantReservationNotes(restaurantId, id, notes)
              if (res.status === 'ok') await refresh()
              return res
            }}
          />
        )}
      </div>
    </div>
  )
}
