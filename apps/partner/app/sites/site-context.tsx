// components/SiteContext.tsx
import React, { createContext, useContext } from 'react'
import { SiteProps } from '@/types/shared'

interface SiteContextValue {
  site: SiteProps
  apiKey: string
}

const SiteContext = createContext<SiteContextValue | undefined>(undefined)

export function SiteProvider(props: SiteContextValue & { children: React.ReactNode }) {
  return (
    <SiteContext.Provider value={{ site: props.site, apiKey: props.apiKey }}>
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
