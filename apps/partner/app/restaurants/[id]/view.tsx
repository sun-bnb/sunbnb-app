'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  RestaurantSettingsForm,
  RestaurantHoursEditor,
  ShiftsEditor,
  type RestaurantSettingsValues,
  type SaveStatus,
} from '@repo/table-reservations-ui'
import type {
  RestaurantHoursInput,
  RestaurantShiftInput,
  RestaurantShiftRecord,
} from '@repo/table-reservations-core'
import { RestaurantSubNav } from './RestaurantSubNav'
import { RestaurantHeader } from './RestaurantHeader'
import { getRestaurant, getRestaurantShifts, type RestaurantDetail } from './queries'
import {
  updateRestaurantSettings,
  setRestaurantOpeningHours,
  setRestaurantServiceShifts,
} from './actions'

export default function RestaurantView({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations('Restaurant')

  const [restaurant, setRestaurant] = useState<RestaurantDetail | null>(null)
  const [shifts, setShifts] = useState<RestaurantShiftRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveErrors, setSaveErrors] = useState<string[]>([])

  async function refresh() {
    const [r, s] = await Promise.all([
      getRestaurant(restaurantId),
      getRestaurantShifts(restaurantId),
    ])
    setRestaurant(r)
    setShifts(s ?? [])
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([getRestaurant(restaurantId), getRestaurantShifts(restaurantId)]).then(
      ([r, s]) => {
        setRestaurant(r)
        setShifts(s ?? [])
        setLoading(false)
      },
    )
  }, [restaurantId])

  if (loading || !restaurant) {
    return (
      <div className="pt-2">
        <RestaurantSubNav restaurantId={restaurantId} active="general" />
        <div className="p-4 text-sm text-gray-500">{t('loading')}</div>
      </div>
    )
  }

  const initialSettings: RestaurantSettingsValues = {
    name: restaurant.name,
    slug: restaurant.slug,
    tagline: restaurant.tagline ?? '',
    description: restaurant.description ?? '',
    cuisineType: restaurant.cuisineType ?? '',
    priceRange: restaurant.priceRange,
    averageMealDuration: restaurant.averageMealDuration,
    reservationWindow: restaurant.reservationWindow,
    timeZone: restaurant.timeZone ?? '',
    noShowPolicy: restaurant.noShowPolicy,
    depositPerGuest: restaurant.depositPerGuest,
    publicOnStandaloneApp: restaurant.publicOnStandaloneApp,
  }

  const initialHours: RestaurantHoursInput[] = restaurant.workingHours.map((h) => ({
    day: h.day,
    openTime: h.openTime,
    closeTime: h.closeTime,
  }))

  const trackSave: (s: SaveStatus, errors?: string[]) => void = (s, errors) => {
    setSaveStatus(s)
    if (s === 'error') setSaveErrors(errors ?? [])
    else setSaveErrors([])
  }

  return (
    <div className="pt-2">
      <RestaurantSubNav restaurantId={restaurantId} active="general" />
      <div className="p-4 space-y-4">
        <RestaurantHeader
          restaurantId={restaurantId}
          restaurant={restaurant}
          saveStatus={saveStatus}
          saveError={saveErrors.length > 0 ? saveErrors.join(', ') : undefined}
        />

        <RestaurantSettingsForm
          initial={initialSettings}
          labels={{
            identityHeading: t('identityHeading'),
            detailsHeading: t('detailsHeading'),
            policyHeading: t('policyHeading'),
            visibilityHeading: t('visibilityHeading'),
            name: t('fieldName'),
            nameHelper: t('fieldNameHelper'),
            slug: t('fieldSlug'),
            slugHelper: t('fieldSlugHelper'),
            tagline: t('fieldTagline'),
            description: t('fieldDescription'),
            cuisineType: t('fieldCuisineType'),
            priceRange: t('fieldPriceRange'),
            averageMealDuration: t('fieldAverageMealDuration'),
            averageMealDurationHint: t('fieldAverageMealDurationHint'),
            reservationWindow: t('fieldReservationWindow'),
            reservationWindowHint: t('fieldReservationWindowHint'),
            timeZone: t('fieldTimeZone'),
            timeZoneHint: t('fieldTimeZoneHint'),
            timeZoneDefault: t('fieldTimeZoneDefault'),
            noShowPolicy: t('fieldNoShowPolicy'),
            noShowPolicyNone: t('fieldNoShowPolicyNone'),
            noShowPolicyDeposit: t('fieldNoShowPolicyDeposit'),
            depositPerGuest: t('fieldDepositPerGuest'),
            depositPerGuestHint: t('fieldDepositPerGuestHint'),
            publicOnStandaloneApp: t('fieldPublicOnStandaloneApp'),
            publicOnStandaloneAppHint: t('fieldPublicOnStandaloneAppHint'),
          }}
          onSaveStatusChange={trackSave}
          onSave={async (patch) => {
            const res = await updateRestaurantSettings(restaurantId, patch)
            if (res.status === 'ok') await refresh()
            return res
          }}
        />

        <RestaurantHoursEditor
          initial={initialHours}
          labels={{
            heading: t('hoursHeading'),
            closed: t('hoursClosed'),
            openAbbr: t('hoursOpenAbbr'),
            closeAbbr: t('hoursCloseAbbr'),
            save: t('hoursSave'),
            saving: t('saving'),
            dayNames: [
              t('daySun'),
              t('dayMon'),
              t('dayTue'),
              t('dayWed'),
              t('dayThu'),
              t('dayFri'),
              t('daySat'),
            ],
          }}
          onSaveStatusChange={trackSave}
          onSave={async (hours) => {
            const res = await setRestaurantOpeningHours(restaurantId, hours)
            if (res.status === 'ok') await refresh()
            return res
          }}
        />

        <ShiftsEditor
          initial={shifts.map(
            (s): RestaurantShiftInput => ({
              name: s.name,
              day: s.day,
              startTime: s.startTime,
              endTime: s.endTime,
              pacingCovers: s.pacingCovers,
              pacingWindowMinutes: s.pacingWindowMinutes,
              lastSeatingOffsetMinutes: s.lastSeatingOffsetMinutes,
              requiresDeposit: s.requiresDeposit,
              depositMinPartySize: s.depositMinPartySize,
            }),
          )}
          labels={{
            heading: t('shiftsHeading'),
            addShift: t('shiftAdd'),
            name: t('shiftName'),
            day: t('shiftDay'),
            start: t('shiftStart'),
            end: t('shiftEnd'),
            pacingCovers: t('shiftPacingCovers'),
            pacingWindow: t('shiftPacingWindow'),
            lastSeating: t('shiftLastSeating'),
            noPacingHint: t('shiftNoPacing'),
            requiresDeposit: t('shiftRequiresDeposit'),
            depositMinParty: t('shiftDepositMinParty'),
            remove: t('shiftRemove'),
            save: t('shiftSave'),
            saving: t('saving'),
            empty: t('shiftEmpty'),
            dayNames: [
              t('daySun'),
              t('dayMon'),
              t('dayTue'),
              t('dayWed'),
              t('dayThu'),
              t('dayFri'),
              t('daySat'),
            ],
          }}
          onSaveStatusChange={trackSave}
          onSave={async (next) => {
            const res = await setRestaurantServiceShifts(restaurantId, next)
            if (res.status === 'ok') await refresh()
            return res
          }}
        />
      </div>
    </div>
  )
}
