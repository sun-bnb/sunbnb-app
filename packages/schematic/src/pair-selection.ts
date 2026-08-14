import type { SchematicItem } from './types'

/**
 * Ids of items that should render as "paired-selected": some OTHER member of
 * the same group is selected or being edited (track 020 P3).
 *
 * Extracted from SchematicRenderer, where this was computed per item via
 * `items.some(...)` inside `items.map(...)` — O(n²) per paint, re-run at
 * pointer-event rate while panning. This builds the same answer in two O(n)
 * passes; the renderer then does an O(1) `Set.has` per item.
 *
 * Semantics locked by pair-selection.test.ts — note the self-exclusion detail:
 * a group's ONLY selected member is not itself paired-selected (its partners
 * are), but when two members of one group are both selected, each has "another
 * selected member", so both are.
 */
export function buildPairedSelectedIds(
  items: ReadonlyArray<Pick<SchematicItem, 'id' | 'groupId'>>,
  selectedItemIds: ReadonlySet<string>,
  editingItemId: string | null,
): Set<string> {
  const isActive = (id: string) => id === editingItemId || selectedItemIds.has(id)

  // Pass 1: how many active (selected-or-editing) members each group has.
  const activePerGroup = new Map<string, number>()
  for (const item of items) {
    if (!item.groupId || !isActive(item.id)) continue
    activePerGroup.set(item.groupId, (activePerGroup.get(item.groupId) ?? 0) + 1)
  }

  // Pass 2: an item is paired-selected when the group's active count, minus
  // itself if it is active, is still positive — i.e. some OTHER member is active.
  const result = new Set<string>()
  for (const item of items) {
    if (!item.groupId) continue
    const others = (activePerGroup.get(item.groupId) ?? 0) - (isActive(item.id) ? 1 : 0)
    if (others > 0) result.add(item.id)
  }
  return result
}
