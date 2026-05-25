'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ReservationList,
  type ReservationListLabels,
} from '@repo/table-reservations-ui'
import type {
  TableReservationListItem,
  WaitlistEntryRecord,
} from '@repo/table-reservations-core'
import { RestaurantSubNav } from '../RestaurantSubNav'
import { RestaurantHeader } from '../RestaurantHeader'
import {
  getRestaurantReservationsForDay,
  getRestaurantWaitlistForDay,
  removeRestaurantWaitlistEntry,
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
  const [waitlist, setWaitlist] = useState<WaitlistEntryRecord[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [resv, wl] = await Promise.all([
      getRestaurantReservationsForDay(restaurantId, date),
      getRestaurantWaitlistForDay(restaurantId, date),
    ])
    setItems(resv.status === 'ok' ? resv.reservations : [])
    setWaitlist(wl.status === 'ok' ? wl.entries : [])
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

        {!loading && (
          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">{t('waitlistHeading')}</h2>
              <span className="text-xs text-gray-400">{waitlist.length}</span>
            </div>
            {waitlist.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500">{t('waitlistEmpty')}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {waitlist.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-900">{w.guestName}</span>
                        <span className="text-xs text-gray-500">· {t('resParty')} {w.partySize}</span>
                        {w.requestedTime ? (
                          <span className="text-xs text-gray-500">· {w.requestedTime}</span>
                        ) : null}
                        {w.notifiedAt ? (
                          <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-px text-xs text-blue-600">
                            {t('waitlistNotified')}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {w.guestEmail}
                        {w.guestPhone ? ` · ${w.guestPhone}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await removeRestaurantWaitlistEntry(restaurantId, w.id)
                        if (res.status === 'ok') await refresh()
                      }}
                      className="shrink-0 text-xs text-gray-500 hover:text-red-600"
                    >
                      {t('waitlistRemove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
