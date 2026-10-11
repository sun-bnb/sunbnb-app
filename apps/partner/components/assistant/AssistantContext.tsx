'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import {
  buildContextPayload,
  cleanSelection,
  type AssistantPageContext,
  type AssistantSelection,
  type AssistantViewport,
} from './context-payload'

interface AssistantContextValue {
  getContext: () => AssistantPageContext
  publish: (patch: { selection?: AssistantSelection; viewport?: AssistantViewport }) => void
}

const Ctx = createContext<AssistantContextValue | null>(null)

/**
 * Holds the page context the assistant sends with each message. It lives in a
 * ref, not state: editors publish on every selection change and nothing should
 * re-render for it — the drawer just reads the latest value at send time.
 */
export function AssistantContextProvider({
  tab,
  layoutMode,
  children,
}: {
  tab: string
  layoutMode: 'geo' | 'schematic'
  children: React.ReactNode
}) {
  const base = useRef({ tab, layoutMode })
  const dynamic = useRef<{ selection?: AssistantSelection; viewport?: AssistantViewport }>({})

  useEffect(() => {
    base.current = { tab, layoutMode }
  }, [tab, layoutMode])

  const getContext = useCallback(
    () => buildContextPayload({ ...base.current, ...dynamic.current }),
    [],
  )
  const publish = useCallback<AssistantContextValue['publish']>((patch) => {
    dynamic.current = { ...dynamic.current, ...patch }
  }, [])

  const value = useMemo(() => ({ getContext, publish }), [getContext, publish])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const EMPTY = () => ({}) as AssistantPageContext

/** Latest-context reader for the drawer. Safe outside a provider (empty context). */
export function useAssistantPageContext(): () => AssistantPageContext {
  return useContext(Ctx)?.getContext ?? EMPTY
}

/**
 * Editors call this with their current selection. It is a no-op outside a
 * provider and clears itself on unmount, so a stale selection from a tab you
 * left never rides along on the next message.
 */
export function usePublishAssistantSelection(selection: AssistantSelection) {
  const publish = useContext(Ctx)?.publish
  const key = JSON.stringify(cleanSelection(selection) ?? null)
  useEffect(() => {
    if (!publish) return
    publish({ selection: (JSON.parse(key) as AssistantSelection | null) ?? undefined })
    return () => publish({ selection: undefined })
  }, [publish, key])
}
