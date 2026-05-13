'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import SyncIcon from '@mui/icons-material/Sync'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Divider from '@mui/material/Divider'
import {
  EnableRestaurantCta,
  RestaurantSettingsForm,
  RestaurantHoursEditor,
  type RestaurantSettingsValues,
  type SaveStatus,
} from '@repo/table-reservations-ui'
import type { RestaurantHoursInput } from '@repo/table-reservations-core'
import { useSite } from '@/app/sites/site-context'
import { getSite } from '../queries'
import {
  enableTableReservations,
  updateLinkedRestaurant,
  setLinkedRestaurantHours,
} from './actions'
import { getLinkedRestaurant, type LinkedRestaurant } from './queries'
import { RestaurantSubNav } from './RestaurantSubNav'

export default function RestaurantView() {
  const t = useTranslations('Restaurant')
  const tGeneral = useTranslations('SiteGeneral')
  const { site, setSite } = useSite()
  const siteId = site.id || ''

  const [restaurant, setRestaurant] = useState<LinkedRestaurant | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveErrors, setSaveErrors] = useState<string[]>([])

  async function refresh() {
    const r = await getLinkedRestaurant(siteId)
    setRestaurant(r)
  }

  useEffect(() => {
    if (!site.restaurantId) {
      setRestaurant(null)
      setLoading(false)
      return
    }
    setLoading(true)
    getLinkedRestaurant(siteId).then((r) => {
      setRestaurant(r)
      setLoading(false)
    })
  }, [site.restaurantId, siteId])

  if (!site.restaurantId) {
    return (
      <div className="pt-2">
        <RestaurantSubNav siteId={siteId} active="settings" />
        <div className="p-4">
          <EnableRestaurantCta
          labels={{
            title: t('enableTitle'),
            description: t('enableDescription'),
            button: t('enableButton'),
            enabling: t('enabling'),
            errorPrefix: t('errorPrefix'),
          }}
          onEnable={async () => {
            const res = await enableTableReservations(siteId)
            if (res.status === 'ok') {
              const updated = await getSite(siteId)
              if (updated) setSite(updated)
            }
            return res
          }}
        />
        </div>
      </div>
    )
  }

  if (loading || !restaurant) {
    return (
      <div className="pt-2">
        <RestaurantSubNav siteId={siteId} active="settings" />
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
      <RestaurantSubNav siteId={siteId} active="settings" />
      <div className="p-4">
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
          const res = await updateLinkedRestaurant(siteId, patch)
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
          const res = await setLinkedRestaurantHours(siteId, hours)
          if (res.status === 'ok') await refresh()
          return res
        }}
      />
      </div>
    </div>
  )
}
