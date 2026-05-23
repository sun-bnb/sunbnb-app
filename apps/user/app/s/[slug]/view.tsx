'use client'

import { useEffect } from 'react'
import { SiteProps } from '@/app/sites/types'
import SiteView from '@/app/sites/[id]/view'
import type { SiteViewBrand } from '@/app/sites/[id]/view'
import BrandHeader from './brand-header'

export default function BrandedSiteView({
  site,
  brand,
  apiKey,
}: {
  site: SiteProps
  brand: SiteViewBrand | null | undefined
  apiKey: string
}) {

  const viewBrand: SiteViewBrand = {
    brandName: brand?.brandName || site.name || 'Book',
    tagline: brand?.tagline,
    bgColor: brand?.bgColor || '#faf9f6',
    fgColor: brand?.fgColor || '#111827',
    logoUrl: brand?.logoUrl,
  }

  useEffect(() => {
    const bg = viewBrand.bgColor || '#faf9f6'
    document.body.style.backgroundColor = bg
    document.body.style.margin = '0'
    return () => {
      document.body.style.backgroundColor = ''
      document.body.style.margin = ''
    }
  }, [viewBrand.bgColor])

  return (
    <div className="relative">
      <div className="absolute top-0 left-0 right-0 z-20">
        <BrandHeader brand={viewBrand} />
      </div>
      <SiteView site={site} apiKey={apiKey} brand={viewBrand} />
    </div>
  )
}
