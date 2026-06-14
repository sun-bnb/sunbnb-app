'use client'

import {
  deleteInventoryItem,
  saveInventoryItemProperties,
  pairInventoryItems,
  depairInventoryItem,
} from '../inventory-actions'
import { rotateSelection } from './actions'

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
   * Rotate a single item (and its pair partner, if any) by `delta` degrees.
   * Mirrors schematic/view.tsx handleRotateSingleItem exactly:
   *  - If the item has a pair, both beds are rotated together via rotateSelection.
   *  - Otherwise the single bed is updated directly via saveInventoryItemProperties,
   *    normalising the angle into [0, 360).
   */
  async function rotateSingle(
    itemId: string,
    currentRotation: number,
    delta: number,
    partnerId?: string | null,
  ) {
    if (partnerId) {
      await rotateSelection(siteId, [itemId, partnerId], delta)
    } else {
      const newRotation = ((currentRotation + delta) + 360) % 360
      await saveInventoryItemProperties(itemId, { rotation: newRotation })
    }
    await refresh()
  }

  /**
   * Pair two inventory items (bidirectional).
   */
  async function pair(id1: string, id2: string) {
    await pairInventoryItems(id1, id2)
    await refresh()
  }

  /**
   * Dissolve the pairing of an inventory item (both directions).
   */
  async function depair(itemId: string) {
    await depairInventoryItem(itemId)
    await refresh()
  }

  /**
   * Delete a single inventory item.
   */
  async function deleteSingle(itemId: string) {
    await deleteInventoryItem(itemId)
    await refresh()
  }

  return { rotateSingle, pair, depair, deleteSingle }
}
