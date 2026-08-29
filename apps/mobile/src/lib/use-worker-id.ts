import { useEffect, useState } from 'react'
import type { GridPayload } from './api'
import type { Pairing } from './pairing'
import { loadWorkerId } from './worker'

/** Roster-validated current worker id for any tab. */
export function useWorkerId(pairing: Pairing | null, grid: GridPayload | null): string | null {
  const [workerId, setWorkerId] = useState<string | null>(null)
  useEffect(() => {
    if (!pairing || !grid) return
    loadWorkerId(pairing.siteId, grid.employees).then(setWorkerId)
  }, [pairing, grid])
  return workerId
}
