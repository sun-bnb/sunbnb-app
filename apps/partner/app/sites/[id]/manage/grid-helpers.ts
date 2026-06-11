import { InventoryItem } from '@/types/shared'

/** Width (px) reserved for the row-label badge column. Must match Tailwind w-9 = 36px. */
export const ROW_LABEL_WIDTH = 36

/** Minimum usable tap-target width per bed cell (px). */
export const MIN_BED_WIDTH = 44

/** Grid gap between cells (px). Must match Tailwind gap-1 = 4px. */
export const CELL_GAP = 4

/**
 * Compute the even chunk size (number of bed columns per section)
 * from the measured container content width.
 *
 * Reserves `rowLabelWidth` px for the row-label badge column plus one gap.
 * The result is always >= 2 and always even so visual bed pairs are never
 * split across a section boundary. Pairs are odd+even adjacent positions;
 * an even chunk size guarantees the boundary always falls between pairs.
 */
export function computeChunkSize(
  containerWidth: number,
  {
    rowLabelWidth = ROW_LABEL_WIDTH,
    minBedWidth = MIN_BED_WIDTH,
    gap = CELL_GAP,
  }: { rowLabelWidth?: number; minBedWidth?: number; gap?: number } = {}
): number {
  const available = containerWidth - rowLabelWidth - gap
  const n = Math.floor((available + gap) / (minBedWidth + gap))
  const even = n - (n % 2)
  return Math.max(2, even)
}

export interface RowCells {
  rowNum: number
  /** Exactly chunkSize cells — null means an empty spacer (position absent in this row). */
  cells: (InventoryItem | null)[]
}

export interface GridSection {
  /** Smallest position number in this section (for the "1–10" span header). */
  minPos: number
  /** Largest position number in this section. */
  maxPos: number
  rows: RowCells[]
}

/**
 * Chunk parcel rows into display sections.
 *
 * @param rowEntries  Sorted array of [rowNum, positions] pairs.
 *                    `positions` maps position number → InventoryItem.
 * @param chunkSize   Even number of position columns per section.
 *
 * The display order for positions follows Object.entries(positions).reverse()
 * semantics: numeric keys ascend naturally in JS objects, so reversing them
 * gives DESCENDING order (largest position on the left). Sections are produced
 * left-to-right in that display order.
 *
 * Each section's rows always have exactly `chunkSize` cells — null pads any
 * position that does not exist in a given row, keeping all sections the same
 * width and preventing bed-cell size from varying across sections.
 *
 * Returns a single section when all positions fit inside one chunk (small venues).
 */
export function chunkRows(
  rowEntries: [number, Record<number, InventoryItem>][],
  chunkSize: number
): GridSection[] {
  if (rowEntries.length === 0) return []

  // Collect all positions across every row → sort DESCENDING (display order)
  const allPositions = new Set<number>()
  for (const [, positions] of rowEntries) {
    for (const key of Object.keys(positions)) {
      allPositions.add(Number(key))
    }
  }
  const orderedPositions = Array.from(allPositions).sort((a, b) => b - a)

  if (orderedPositions.length === 0) return []

  const sections: GridSection[] = []

  for (let i = 0; i < orderedPositions.length; i += chunkSize) {
    const chunk = orderedPositions.slice(i, i + chunkSize)

    const rows: RowCells[] = rowEntries.map(([rowNum, positions]) => ({
      rowNum,
      // Always chunkSize cells: item at that position, or null spacer
      cells: Array.from({ length: chunkSize }, (_, j) => {
        const pos = chunk[j]
        if (pos === undefined) return null
        return positions[pos] ?? null
      }),
    }))

    sections.push({
      minPos: Math.min(...chunk),
      maxPos: Math.max(...chunk),
      rows,
    })
  }

  return sections
}
