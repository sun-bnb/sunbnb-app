import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { listVivaTerminals, type GridPayload, type VivaTerminal } from './api'
import type { Pairing } from './pairing'

/**
 * Per-site Viva terminal choice — the staff phone's only contribution to the
 * card-present leg ([[track:024]] W8). Same store and validation pattern as
 * the worker chip (worker.ts): a terminalId is not a secret, and a stale id
 * (no longer in the site's list) is dropped silently.
 */
const keyFor = (siteId: string) => `sunbnb-terminal-${siteId}`

export async function getSelectedTerminal(siteId: string): Promise<string | null> {
  return (await AsyncStorage.getItem(keyFor(siteId))) || null
}

export async function setSelectedTerminal(siteId: string, terminalId: string | null): Promise<void> {
  if (terminalId) await AsyncStorage.setItem(keyFor(siteId), terminalId)
  else await AsyncStorage.removeItem(keyFor(siteId))
}

export interface TerminalsState {
  terminals: VivaTerminal[]
  selected: VivaTerminal | null
  select: (terminalId: string | null) => void
}

/**
 * Loads the site's terminals on screen focus and on every grid refresh (one
 * cheap RPC per 30 s poll), and keeps the persisted choice roster-validated.
 * A site without terminals yields an empty list — callers hide the UI.
 */
export function useTerminals(pairing: Pairing | null, grid: GridPayload | null): TerminalsState {
  const [terminals, setTerminals] = useState<VivaTerminal[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const siteId = pairing?.siteId ?? null
  const accessKey = pairing?.accessKey ?? null

  const load = useCallback(() => {
    if (!siteId || !accessKey) return
    let alive = true
    Promise.all([listVivaTerminals(siteId, accessKey), getSelectedTerminal(siteId)])
      .then(([res, stored]) => {
        if (!alive) return
        const list = res.status === 'ok' && Array.isArray(res.terminals) ? res.terminals : []
        setTerminals(list)
        if (stored && !list.some(t => t.terminalId === stored)) {
          void setSelectedTerminal(siteId, null)
          setSelectedId(null)
        } else {
          setSelectedId(stored)
        }
      })
      .catch(() => {
        // transient — keep whatever we had
      })
    return () => {
      alive = false
    }
  }, [siteId, accessKey])

  useFocusEffect(load)
  useEffect(load, [load, grid])

  const select = useCallback(
    (terminalId: string | null) => {
      if (!siteId) return
      setSelectedId(terminalId)
      void setSelectedTerminal(siteId, terminalId)
    },
    [siteId],
  )

  const selected = terminals.find(t => t.terminalId === selectedId) ?? null
  return { terminals, selected, select }
}
