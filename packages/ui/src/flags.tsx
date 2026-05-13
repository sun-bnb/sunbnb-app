'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Client-side feature flag context.
 *
 * The server resolves flags once per request via
 * `@repo/data/flags#getFlagStates`, serializes the result into this provider,
 * and client components read it via `useFlag(name)`. SSR-safe because the
 * server-rendered HTML and the client hydration both see the same payload.
 */

export interface ClientFlagState {
  enabled: boolean
}

export type ClientFlagMap = Record<string, ClientFlagState>

const FlagContext = createContext<ClientFlagMap | null>(null)

export function FlagsProvider({
  value,
  children,
}: {
  value: ClientFlagMap
  children: ReactNode
}) {
  return <FlagContext.Provider value={value}>{children}</FlagContext.Provider>
}

/**
 * Read a flag in a client component. Returns `false` if the provider is
 * missing or the flag is unknown — fail-closed by design, so a missing
 * provider hides flagged features rather than exposing them.
 */
export function useFlag(name: string): boolean {
  const ctx = useContext(FlagContext)
  if (!ctx) return false
  return ctx[name]?.enabled ?? false
}

export function useFlags(): ClientFlagMap {
  return useContext(FlagContext) ?? {}
}
