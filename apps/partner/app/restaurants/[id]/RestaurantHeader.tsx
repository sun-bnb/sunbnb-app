'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { SaveStatus } from '@repo/table-reservations-ui'
import { getRestaurant, type RestaurantDetail } from './queries'

/** Compact inline save indicator that lives in the identity header. */
function SaveIndicator({
  status,
  labels,
  error,
}: {
  status: SaveStatus
  labels: { saving: string; saved: string; idle: string; error: string }
  error?: string
}) {
  const map = {
    saving: { text: 'text-blue-600', dot: 'bg-blue-500 animate-pulse', label: labels.saving },
    saved: { text: 'text-green-600', dot: 'bg-green-500', label: labels.saved },
    error: { text: 'text-red-600', dot: 'bg-red-500', label: labels.error },
    idle: { text: 'text-gray-400', dot: 'bg-gray-300', label: labels.idle },
  }[status]
  return (
    <span
      role="status"
      aria-live="polite"
      className={`flex items-center gap-1.5 text-xs shrink-0 ${map.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} />
      {map.label}
      {status === 'error' && error ? ` — ${error}` : ''}
    </span>
  )
}

/**
 * Shared restaurant identity header for every detail tab — monogram (the one
 * warm sun-amber decorative accent) + name + cuisine/price/slug chips, with an
 * optional compact inline save status on the right. See .claude/rules/ui.md
 * § Detail/settings. Pass `restaurant` when the parent already has it; otherwise
 * pass `restaurantId` and the header self-fetches.
 */
export function RestaurantHeader({
  restaurantId,
  restaurant: restaurantProp,
  saveStatus,
  saveError,
}: {
  restaurantId: string
  restaurant?: RestaurantDetail | null
  saveStatus?: SaveStatus
  saveError?: string
}) {
  const t = useTranslations('Restaurant')
  const tGeneral = useTranslations('SiteGeneral')
  const [fetched, setFetched] = useState<RestaurantDetail | null>(restaurantProp ?? null)

  useEffect(() => {
    if (restaurantProp) return
    let alive = true
    getRestaurant(restaurantId).then((r) => {
      if (alive) setFetched(r)
    })
    return () => {
      alive = false
    }
  }, [restaurantId, restaurantProp])

  const restaurant = restaurantProp ?? fetched
  if (!restaurant) {
    return <div className="h-[68px] rounded-xl border border-gray-200 bg-white shadow-sm" />
  }

  const priceLabel = restaurant.priceRange ? '$'.repeat(restaurant.priceRange) : null
  const monogram = restaurant.name.trim().charAt(0).toUpperCase() || 'R'

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 text-lg font-semibold text-amber-700">
          {monogram}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-gray-900">{restaurant.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {restaurant.cuisineType && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
                {restaurant.cuisineType}
              </span>
            )}
            {priceLabel && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
                {priceLabel}
              </span>
            )}
            <span className="text-gray-400">/{restaurant.slug}</span>
            {restaurant.siteId && (
              <Link
                href={`/sites/${restaurant.siteId}`}
                className="text-blue-600 hover:underline"
              >
                {t('linkedSiteLink')}
              </Link>
            )}
          </div>
        </div>
      </div>
      {saveStatus && (
        <SaveIndicator
          status={saveStatus}
          labels={{
            saving: tGeneral('saving'),
            saved: tGeneral('allChangesSaved'),
            idle: tGeneral('upToDate'),
            error: tGeneral('errorSaving'),
          }}
          error={saveError}
        />
      )}
    </div>
  )
}
