import { InventoryItem } from '@/types/shared'
import { formatSeat } from '@repo/data/seat-label'

/** Width (px) reserved for the row-label badge column. Must match Tailwind w-9 = 36px. */
export const ROW_LABEL_WIDTH = 36

/**
 * Display label for a group-extra pool seat: the NEXT member of its group's unit.
 *
 * A group's regular members carry stored seat labels like "103-1", "103-2"
 * (parcel-stripped form). An extra added to that group should read as the next
 * member — "103-3", "103-4", … — ordered among the group's extras by ascending
 * seat number (their pool-band number). Falls back to "+N" only when the group
 * has no labeled regular member to derive the base from.
 *
 * @param extra        the group-extra pool item to label
 * @param groupMembers all OTHER members of the same SunbedGroup (regular + extras)
 */
export function groupExtraSeatLabel(
  extra: { id: string; number: number },
  groupMembers: { id: string; number: number; seatLabel?: string | null; status?: string | null }[],
): string {
  // Order all extras of the group (including this one) by seat number → ordinal.
  const extras = [extra, ...groupMembers.filter(m => m.status === 'pool')]
    .sort((a, b) => a.number - b.number)
  const ordinal = extras.findIndex(e => e.id === extra.id) + 1

  // Derive base ("103") + highest member index from labeled regular members.
  const labeled = groupMembers.filter(m => m.status !== 'pool' && m.seatLabel)
  if (labeled.length === 0) return `+${ordinal}`

  const memberIndexOf = (label: string) => {
    const dash = label.lastIndexOf('-')
    return dash === -1 ? 0 : (parseInt(label.slice(dash + 1), 10) || 0)
  }
  const rep = formatSeat(labeled[0]!, { parcel: false }) // e.g. "103-2"
  const dash = rep.lastIndexOf('-')
  const base = dash === -1 ? rep : rep.slice(0, dash)     // "103"
  const maxMember = Math.max(
    ...labeled.map(m => memberIndexOf(formatSeat(m, { parcel: false }))),
  )
  return `${base}-${maxMember + ordinal}`
}

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

/**
 * A single display column of the manage grid:
 * - `pos`   — a real seat position, shared by every row at that position.
 * - `extra` — a slot reserved because some group in this position-column has an
 *   extra seat. Extra columns are global: every row reserves them so the grid
 *   stays aligned; a row whose group has no seat at that slot renders empty.
 * - `gap`   — a fixed-width spacer track BETWEEN groups. Grouping is expressed
 *   with these tracks (not seat margins) so every seat cell is a clean 1fr and
 *   every group separator is identical regardless of its neighbours.
 * - `pad`   — a trailing empty 1fr cell used to pad a short (last) section up to
 *   the full column count, so every section's seat cells are the same width and
 *   the grid still fills the container.
 */
export type DisplayColumn =
  | { kind: 'pos'; pos: number }
  | { kind: 'extra'; afterPos: number; slot: number }
  | { kind: 'gap' }
  | { kind: 'pad' }

/**
 * Build the ordered display columns for a parcel: every seat position, with
 * `extraSlotsAfter.get(pos)` extra columns inserted immediately after each
 * position that needs them, and a `gap` separator after the end of each group.
 * Sunbeds pair as adjacent odd/even positions, so an even position is a group's
 * trailing seat — the gap goes after its extras. Built ascending, then reversed
 * as a whole when the staff reverse toggle is on (keeps extras + gaps adjacent
 * to their group on the mirrored side).
 *
 * @param positions       all seat positions in the parcel (any order; deduped + sorted here)
 * @param extraSlotsAfter position → number of extra columns to reserve after it
 *                        (the MAX extra count among groups ending at that position)
 */
export function buildDisplayColumns(
  positions: number[],
  extraSlotsAfter: Map<number, number>,
  reversed = false,
): DisplayColumn[] {
  const asc = Array.from(new Set(positions)).sort((a, b) => a - b)
  const cols: DisplayColumn[] = []
  asc.forEach((pos, i) => {
    cols.push({ kind: 'pos', pos })
    const n = extraSlotsAfter.get(pos) ?? 0
    for (let slot = 0; slot < n; slot++) cols.push({ kind: 'extra', afterPos: pos, slot })
    // Group separator after the trailing (even) seat of a pair, never trailing
    // the whole list.
    if (i < asc.length - 1 && pos % 2 === 0) cols.push({ kind: 'gap' })
  })
  return reversed ? cols.reverse() : cols
}

export interface ColumnSection {
  /** Smallest seat position in this section (for the "1–10" span header). */
  minPos: number
  /** Largest seat position in this section. */
  maxPos: number
  columns: DisplayColumn[]
}

/**
 * Chunk display columns into sections of `chunkSize` SEAT columns (pos + extra;
 * gap separators don't count toward the limit). Leading/trailing gap separators
 * are trimmed from each section, and a short final section is padded with `pad`
 * columns up to chunkSize so every section's 1fr seat cells are the same width
 * while still filling the container. minPos/maxPos come from the 'pos' columns.
 */
export function chunkDisplayColumns(
  columns: DisplayColumn[],
  chunkSize: number,
): ColumnSection[] {
  if (columns.length === 0) return []
  const sections: ColumnSection[] = []
  let cur: DisplayColumn[] = []
  let seats = 0
  const flush = () => {
    while (cur.length && cur[0]!.kind === 'gap') cur.shift()
    while (cur.length && cur[cur.length - 1]!.kind === 'gap') cur.pop()
    if (cur.length > 0) {
      const positions = cur.filter((c): c is { kind: 'pos'; pos: number } => c.kind === 'pos').map(c => c.pos)
      // Pad the (short) section up to chunkSize seat columns so its cells match
      // the width of a full section instead of stretching to fill the row.
      while (seats < chunkSize) {
        cur.push({ kind: 'pad' })
        seats++
      }
      sections.push({
        minPos: positions.length ? Math.min(...positions) : 0,
        maxPos: positions.length ? Math.max(...positions) : 0,
        columns: cur,
      })
    }
    cur = []
    seats = 0
  }
  for (const col of columns) {
    if (seats >= chunkSize && col.kind !== 'gap') flush()
    cur.push(col)
    if (col.kind !== 'gap') seats++
  }
  flush()
  return sections
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
  chunkSize: number,
  reversed = false
): GridSection[] {
  if (rowEntries.length === 0) return []

  // Collect all positions across every row → order them for display.
  // Default: ascending (smallest seat number on the left). reversed: descending.
  const allPositions = new Set<number>()
  for (const [, positions] of rowEntries) {
    for (const key of Object.keys(positions)) {
      allPositions.add(Number(key))
    }
  }
  const orderedPositions = Array.from(allPositions).sort((a, b) => (reversed ? b - a : a - b))

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
