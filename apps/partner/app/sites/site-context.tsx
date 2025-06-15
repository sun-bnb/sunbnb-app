'use client'

import React, { createContext, useContext, useState } from 'react'
import { SiteProps } from '@/types/shared'

interface SiteContextValue {
  site: SiteProps
  setSite: (site: SiteProps) => void
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

  const updateSite = (newSite: SiteProps) => {
    console.log('Update site', newSite)
    setNonce(Math.random())
    setSite(newSite)
  }

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
