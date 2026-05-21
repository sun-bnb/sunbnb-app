'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import SyncIcon from '@mui/icons-material/Sync'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Divider from '@mui/material/Divider'
import {
  RestaurantSettingsForm,
  RestaurantHoursEditor,
  type RestaurantSettingsValues,
  type SaveStatus,
} from '@repo/table-reservations-ui'
import type { RestaurantHoursInput } from '@repo/table-reservations-core'
import { useTranslations as useTrans } from 'next-intl'
import { RestaurantSubNav } from './RestaurantSubNav'
import { getRestaurant, type RestaurantDetail } from './queries'
import { updateRestaurantSettings, setRestaurantOpeningHours } from './actions'

export default function RestaurantView({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations('Restaurant')
  const tGeneral = useTranslations('SiteGeneral')

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
        <RestaurantSubNav restaurantId={restaurantId} active="settings" />
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
      <RestaurantSubNav restaurantId={restaurantId} active="settings" />
      <div className="p-4">
        {/* Back-link to linked site if any */}
        {restaurant.siteId && (
          <div className="mb-4">
            <Link
              href={`/sites/${restaurant.siteId}`}
              className="text-sm text-blue-600 hover:underline"
            >
              {t('linkedSiteLink')}
            </Link>
          </div>
        )}

        <div
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded mb-4 text-sm transition-all ${
            saveStatus === 'saving'
              ? 'bg-blue-50 border border-blue-200 text-blue-600'
              : saveStatus === 'saved'
                ? 'bg-green-50 border border-green-200 text-green-600'
                : saveStatus === 'error'
                  ? 'bg-red-50 border border-red-200 text-red-600'
                  : 'bg-gray-50 border border-gray-200 text-gray-400'
          }`}
        >
          {saveStatus === 'saving' && (
            <>
              <SyncIcon fontSize="small" className="animate-spin" /> {tGeneral('saving')}
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <CloudDoneIcon fontSize="small" /> {tGeneral('allChangesSaved')}
            </>
          )}
          {saveStatus === 'error' && (
            <>
              <WarningAmberIcon fontSize="small" />{' '}
              {tGeneral('errorSaving')}
              {saveErrors.length > 0 && <span className="ml-1">— {saveErrors.join(', ')}</span>}
            </>
          )}
          {saveStatus === 'idle' && (
            <>
              <CloudDoneIcon fontSize="small" /> {tGeneral('upToDate')}
            </>
          )}
        </div>

        <RestaurantSettingsForm
          initial={initialSettings}
          labels={{
            identityHeading: t('identityHeading'),
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

        <Divider sx={{ mb: 3 }} />

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
