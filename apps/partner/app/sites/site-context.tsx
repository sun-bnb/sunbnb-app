'use client'

import React, { createContext, useContext, useState } from 'react'
import { SiteProps } from '@/types/shared'
import { useAssistantResync } from '@/components/assistant/useAssistantResync'
import { getSiteScalars } from '@/app/sites/[id]/queries'

interface SiteContextValue {
  site: SiteProps
  /**
   * Accepts an updater as well as a value (track 020 C2): parcel seat loads
   * can overlap (a map-idle trigger and a click), and a value-form update
   * built from a stale closure would drop the other's rows.
   */
  setSite: (site: SiteProps | ((prev: SiteProps) => SiteProps)) => void
  apiKey: string,
  nonce: number
}

interface SiteContextProps {
  site: SiteProps
  apiKey: string
}

const SiteContext = createContext<SiteContextValue | undefined>(undefined)

export function SiteProvider(props: SiteContextProps & { children: React.ReactNode }) {

  const [site, setSite] = useState<SiteProps>(props.site)
  const [nonce, setNonce] = useState<number>(Math.random())

  const updateSite = (newSite: SiteProps | ((prev: SiteProps) => SiteProps)) => {
    setNonce(Math.random())
    setSite(newSite)
  }

  // The assistant writes site fields / hours / slug / brand through server actions. router.refresh()
  // re-renders the server tree but this provider's useState ignores new props, so pull the light
  // site columns and merge them over the context copy (seats/products/layout stay untouched).
  // Tabs reconcile their own form state against the new `site` identity.
  useAssistantResync(['site_fields', 'working_hours', 'brand', 'slug', 'place_image:cover', 'place_image:schematic_underlay'], async () => {
    const fresh = await getSiteScalars(props.site.id!)
    if (fresh) updateSite(prev => ({ ...prev, ...(fresh as unknown as Partial<SiteProps>) }))
  })

  return (
    <SiteContext.Provider value={{ site, setSite: updateSite, nonce, apiKey: props.apiKey }}>
      {props.children}
    </SiteContext.Provider>
  )
}

export function useSite() {
  const ctx = useContext(SiteContext)
  if (!ctx) {
    throw new Error('useSite must be used inside a SiteProvider')
  }
  return ctx
}
