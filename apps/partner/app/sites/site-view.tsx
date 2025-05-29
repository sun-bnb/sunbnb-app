'use client'

import React, { ReactElement, useState } from 'react'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import { SiteProps } from '@/types/shared'
import { useRouter } from 'next/navigation'
import { SiteProvider } from '@/app/sites/site-context'

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

  return (
    <SiteProvider site={site} apiKey={apiKey}>
      <div className="container mx-auto mt-2">
        <Tabs variant="fullWidth" value={tab} onChange={(e, value) => {
          router.push(`/sites/${site.id}/${value}`)
        }}>
          <Tab value="general" label="General" />
          <Tab value="content" label="Content" />
          <Tab value="inventory" label="Inventory" />
          <Tab value="products" label="Products" />
          <Tab value="accounting" label="Accounting" />
        </Tabs>
        { children }
      </div>
    </SiteProvider>
  )

}