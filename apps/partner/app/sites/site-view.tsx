'use client'

import React from 'react'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import { SiteProps } from '@/types/shared'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SiteProvider } from '@/app/sites/site-context'
import { useFlag } from '@repo/ui/flags'
import ReadinessChecklist from './readiness-checklist'

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
          {restaurantsEnabled && (
            <Tab value="restaurant" label={t('restaurant')} sx={tabStyle} />
          )}
          <Tab value="products" label={t('products')} sx={tabStyle} />
          <Tab value="rentals" label={t('rentals')} sx={tabStyle} />
          <Tab value="accounting" label={t('accounting')} sx={tabStyle} />
        </Tabs>
        {tab !== 'inventory' && tab !== 'schematic' && tab !== 'restaurant' && (
          <ReadinessChecklist
            site={site}
            onNavigate={(path) => router.push(path.startsWith('/') ? path : `/sites/${site.id}/${path}`)}
          />
        )}
        { children }
      </div>
    </SiteProvider>
  )

}
