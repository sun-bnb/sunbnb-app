'use client'

import React, { useState } from 'react'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import { SiteProps } from '@/types/shared'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SiteProvider } from '@/app/sites/site-context'
import { useFlag } from '@repo/ui/flags'
import ReadinessChecklist from './readiness-checklist'
import { createRestaurant } from '@/app/restaurants/[id]/actions'

const tabStyle = {
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.8rem',
  letterSpacing: '0.01em',
  minHeight: 40,
  color: '#9ca3af',
  '&.Mui-selected': {
    color: '#111827',
    fontWeight: 600,
  },
} as const

function RestaurantCard({ site, t }: { site: SiteProps; t: ReturnType<typeof useTranslations<'SiteView'>> }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (site.restaurantId) {
    return (
      <div className="mx-4 mt-3">
        <a
          href={`/restaurants/${site.restaurantId}`}
          className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all text-sm font-medium text-gray-900"
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
            </svg>
            {t('restaurant')}
          </span>
          <span className="text-gray-500 text-xs">{t('restaurantManage')}</span>
        </a>
      </div>
    )
  }

  return (
    <div className="mx-4 mt-3">
      <div className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-dashed border-gray-300 text-sm">
        <span className="flex items-center gap-2 text-gray-500">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
          </svg>
          {t('restaurantAdd')} — {t('restaurantAddDescription')}
        </span>
        <button
          disabled={creating}
          onClick={async () => {
            setCreating(true)
            setError(null)
            const res = await createRestaurant({ siteId: site.id })
            if (res.status === 'ok') {
              router.push(`/restaurants/${res.restaurantId}`)
            } else {
              setError(res.errors?.[0] ?? t('restaurantError'))
              setCreating(false)
            }
          }}
          className="ml-3 flex-shrink-0 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {creating ? t('restaurantCreating') : t('restaurantAdd')}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600 px-1">{error}</p>}
    </div>
  )
}

export default function SiteView(
  { tab, site, apiKey, children }:
  {
    site: SiteProps,
    apiKey: string,
    tab: string,
    children?: React.ReactNode | React.ReactNode[]
  }
) {

  const router = useRouter()
  const t = useTranslations('SiteView')
  const restaurantsEnabled = useFlag('restaurants')

  const isSchematic = site.layoutMode === 'schematic'

  return (
    <SiteProvider site={site} apiKey={apiKey}>
      <div className="mt-2">
        <Tabs
          variant="fullWidth"
          value={tab}
          onChange={(e, value) => {
            router.push(`/sites/${site.id}/${value}`)
          }}
          sx={{
            minHeight: 40,
            borderBottom: '1px solid #e5e7eb',
            '& .MuiTabs-indicator': {
              height: 2,
              borderRadius: '2px 2px 0 0',
              backgroundColor: '#111827',
            },
          }}
        >
          <Tab value="general" label={t('general')} sx={tabStyle} />
          <Tab value="content" label={t('content')} sx={tabStyle} />
          <Tab value="brand" label={t('brand')} sx={tabStyle} />
          {isSchematic ? (
            <Tab value="schematic" label={t('inventory')} sx={tabStyle} />
          ) : (
            <Tab value="inventory" label={t('inventory')} sx={tabStyle} />
          )}
          <Tab value="products" label={t('products')} sx={tabStyle} />
          <Tab value="rentals" label={t('rentals')} sx={tabStyle} />
          <Tab value="accounting" label={t('accounting')} sx={tabStyle} />
        </Tabs>
        {tab !== 'inventory' && tab !== 'schematic' && (
          <ReadinessChecklist
            site={site}
            onNavigate={(path) => router.push(path.startsWith('/') ? path : `/sites/${site.id}/${path}`)}
          />
        )}
        {restaurantsEnabled && (
          <RestaurantCard site={site} t={t} />
        )}
        { children }
      </div>
    </SiteProvider>
  )

}
