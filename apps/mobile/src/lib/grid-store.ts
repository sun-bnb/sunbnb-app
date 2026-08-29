/**
 * Shared grid store — one fetch + one 30 s poll feeding every tab (beds,
 * rentals, guests locate). Module-level state with useSyncExternalStore; the
 * first mounted consumer starts the poll.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { getGrid, type GridPayload } from './api'
import { loadPairing, type Pairing } from './pairing'

const POLL_MS = 30_000

interface GridState {
  pairing: Pairing | null
  grid: GridPayload | null
  error: string | null
}

let state: GridState = { pairing: null, grid: null, error: null }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
let starting = false

function emit(next: Partial<GridState>) {
  state = { ...state, ...next }
  listeners.forEach(l => l())
}

export async function refreshGrid(): Promise<void> {
  const p = state.pairing
  if (!p) return
  try {
    const res = await getGrid(p.siteId, p.accessKey)
    if (res.status === 'ok' && 'site' in res) {
      emit({ grid: res as GridPayload, error: null })
    } else {
      emit({ error: res.errors?.[0] ?? 'Could not load the grid.' })
    }
  } catch {
    emit({ error: 'Could not reach the server.' })
  }
}

async function start() {
  if (starting || timer) return
  starting = true
  const p = await loadPairing()
  starting = false
  if (!p) return
  emit({ pairing: p })
  void refreshGrid()
  timer = setInterval(() => void refreshGrid(), POLL_MS)
}

/** Clear everything (unpair / key expiry). */
export function resetGridStore() {
  if (timer) clearInterval(timer)
  timer = undefined
  state = { pairing: null, grid: null, error: null }
  listeners.forEach(l => l())
}

export function useGridStore(): GridState {
  useEffect(() => {
    void start()
  }, [])
  return useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
