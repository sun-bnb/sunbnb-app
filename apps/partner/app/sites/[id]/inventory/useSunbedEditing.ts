'use client'

import { deleteInventoryItem } from '../inventory-actions'
import { rotateUnit } from './parcel-ops'

/**
 * Coordinate-free, setup-independent single-sunbed editing actions.
 * Both the Maps editor (inventory/view.tsx) and the Schematic editor
 * (schematic/view.tsx) consume this hook so the server-action wiring
 * never drifts between the two editors.
 *
 * Edit-panel toggling is pure UI state and stays per-editor — not here.
 *
 * @param siteId  The site whose inventory is being edited.
 * @param refresh Called after every mutation to pull fresh site state.
 */
export function useSunbedEditing(
  siteId: string,
  refresh: () => void | Promise<void>,
) {
  /**
   * Rotate a single item (and the other members of its SunbedGroup unit) by
   * `delta` degrees. The unit's members are resolved server-side by
   * `rotateUnit` (parcel-ops.ts) — the same action the AI assistant uses — so
   * the client no longer picks ids or chooses between rotateSelection and
   * saveInventoryItemProperties.
   */
  async function rotateSingle(itemId: string, delta: number) {
    await rotateUnit(siteId, itemId, delta)
    await refresh()
  }

  /**
   * Pair two inventory items (bidirectional).
   */

  /**
   * Dissolve the pairing of an inventory item (both directions).
   */

  /**
   * Delete a single inventory item.
   */
  async function deleteSingle(itemId: string) {
    await deleteInventoryItem(itemId)
    await refresh()
  }

  return { rotateSingle, deleteSingle }
}
