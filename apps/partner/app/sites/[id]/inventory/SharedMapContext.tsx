'use client'

import React, {
  createContext,
  useContext,
  useState,
  ReactNode
} from 'react'

type SharedMap = Record<string, any>

interface SharedMapContextType {
  values: SharedMap
  setValue: (key: string, value: any) => void
  removeValue: (key: string) => void
  clear: () => void
}

const SharedMapContext = createContext<SharedMapContextType | undefined>(undefined)

export function SharedMapProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<SharedMap>({})

  const setValue = (key: string, value: any) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }

  const removeValue = (key: string) => {
    setValues(prev => {
      const copy = { ...prev }
      delete copy[key]
      return copy
    })
  }

  const clear = () => setValues({})

  return (
    <SharedMapContext.Provider value={{ values, setValue, removeValue, clear }}>
      {children}
    </SharedMapContext.Provider>
  )
}

export function useSharedMap() {
  const context = useContext(SharedMapContext)
  if (!context) {
    throw new Error('useSharedMap must be used within a SharedMapProvider')
  }
  return context
}
