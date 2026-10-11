'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { SiteProps } from '@/types/shared'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SiteProvider } from '@/app/sites/site-context'
import { useFlag } from '@repo/ui/flags'
import ReadinessChecklist from './readiness-checklist'
import { createRestaurant } from '@/app/restaurants/[id]/actions'
import AssistantDrawer, { AssistantToggle } from '@/components/assistant/AssistantDrawer'
import { AssistantContextProvider } from '@/components/assistant/AssistantContext'

function RestaurantCard({ site, t, className = 'mx-4 mt-3' }: { site: SiteProps; t: ReturnType<typeof useTranslations<'SiteView'>>; className?: string }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (site.restaurantId) {
    return (
      <div className={className}>
        <a
          href={`/restaurants/${site.restaurantId}`}
          className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-xs transition-all text-sm font-medium text-gray-900"
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
    <div className={className}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 bg-white rounded-xl border border-dashed border-gray-300 text-sm">
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
          className="sm:ml-3 shrink-0 self-start sm:self-auto min-h-[40px] sm:min-h-0 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
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
  const isEditorTab = tab === 'inventory' || tab === 'schematic'

  // Keep the active tab visible when the strip is scrolled on a phone.
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navRef.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return
    nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2
  }, [tab])

  const tabs = [
    { value: 'general', label: t('general') },
    { value: 'content', label: t('content') },
    { value: 'brand', label: t('brand') },
    { value: isSchematic ? 'schematic' : 'inventory', label: t('inventory') },
    { value: 'products', label: t('products') },
    { value: 'rentals', label: t('rentals') },
    { value: 'accounting', label: t('accounting') },
  ]

  return (
    <SiteProvider site={site} apiKey={apiKey}>
     <AssistantContextProvider tab={tab} layoutMode={isSchematic ? 'schematic' : 'geo'}>
      {/* From lg the assistant drawer is a 400px column BESIDE the tab content
          (push, not overlay) so it never covers the map controls; the map
          just gets the narrower column. Below lg it is a fixed full-screen sheet. */}
      <div className="mt-2 lg:flex lg:items-start lg:gap-4">
      <div className="min-w-0 flex-1">
        {/* Tab nav: scrolls horizontally on phones (seven tabs never fit 360px),
            spreads evenly sm–md (the old MUI fullWidth Tabs look), and from lg
            sits left-aligned at natural width so it doesn't stretch across a
            1100px+ frame. */}
        <div className="flex items-center gap-2 border-b border-gray-200">
        <nav
          ref={navRef}
          className="relative flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map(({ value, label }) => {
            const selected = value === tab
            return (
              <Link
                key={value}
                href={`/sites/${site.id}/${value}`}
                aria-current={selected ? 'page' : undefined}
                className={`relative shrink-0 sm:flex-1 lg:flex-none min-h-[40px] px-4 sm:px-2 lg:px-5 flex items-center justify-center whitespace-nowrap text-[0.8rem] tracking-[0.01em] transition-colors ${
                  selected
                    ? 'text-gray-900 font-semibold'
                    : 'text-gray-400 font-medium hover:text-gray-600'
                }`}
              >
                {label}
                {selected && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t-sm bg-gray-900" />
                )}
              </Link>
            )
          })}
        </nav>
        <AssistantToggle siteId={site.id ?? ''} className="mr-2 my-1.5" />
        </div>
        {/* Setup nudges: stacked on phones/tablets; side by side from lg (each
            takes half, or the full row when it is alone). */}
        <div className="lg:flex lg:items-start lg:gap-4 lg:*:flex-1 lg:*:min-w-0">
          {!isEditorTab && (
            <ReadinessChecklist
              className="mt-3 mb-1"
              site={site}
              onNavigate={(path) => router.push(path.startsWith('/') ? path : `/sites/${site.id}/${path}`)}
            />
          )}
          {restaurantsEnabled && (
            <RestaurantCard
              site={site}
              t={t}
              className="mt-3"
            />
          )}
        </div>
        {/* Tab views pad themselves (px-4 below 800px); cancel the shell gutter
            there so phone layouts are unchanged. */}
        <div className={`-mx-4 min-[640px]:-mx-6 ${tab === 'inventory' ? 'min-[800px]:mx-auto max-w-[768px]' : 'min-[800px]:mx-0'}`}>
          { children }
        </div>
      </div>
      <AssistantDrawer siteId={site.id ?? ''} tab={tab} />
      </div>
     </AssistantContextProvider>
    </SiteProvider>
  )

}
