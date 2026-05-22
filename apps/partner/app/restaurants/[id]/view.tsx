'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  RestaurantSettingsForm,
  RestaurantHoursEditor,
  type RestaurantSettingsValues,
  type SaveStatus,
} from '@repo/table-reservations-ui'
import type { RestaurantHoursInput } from '@repo/table-reservations-core'
import { RestaurantSubNav } from './RestaurantSubNav'
import { RestaurantHeader } from './RestaurantHeader'
import { getRestaurant, type RestaurantDetail } from './queries'
import { updateRestaurantSettings, setRestaurantOpeningHours } from './actions'

export default function RestaurantView({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations('Restaurant')

  const [restaurant, setRestaurant] = useState<RestaurantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveErrors, setSaveErrors] = useState<string[]>([])

  async function refresh() {
    const r = await getRestaurant(restaurantId)
    setRestaurant(r)
  }

  useEffect(() => {
    setLoading(true)
    getRestaurant(restaurantId).then((r) => {
      setRestaurant(r)
      setLoading(false)
    })
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
      </div>
    </div>
  )
}
