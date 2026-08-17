import { formatSeatId } from '@repo/data/seat-label'

/** Width (px) reserved for the row-label badge column. Must match Tailwind w-9 = 36px. */
export const ROW_LABEL_WIDTH = 36

/**
 * Display label for a group-extra pool seat: the NEXT member of its group's unit.
 *
 * A group's regular members display as "1-3-1", "1-3-2" (parcel-stripped
 * `{row}-{seq}-{member}`). An extra added to that group should read as the next
 * member — "1-3-3", "1-3-4", … — ordered among the group's extras by ascending
 * seat number (their pool-band number). Falls back to "+N" only when the group
 * has no labeled regular member to derive the base from.
 *
 * Splitting on the LAST dash is what makes this format-agnostic: the member is
 * always the final segment, so the same code produced "103-3" under the packed
 * form and "1-3-3" under the unpacked one.
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
  const rep = formatSeatId(labeled[0]!, { parcel: false }) // e.g. "1-3-2"
  const dash = rep.lastIndexOf('-')
  const base = dash === -1 ? rep : rep.slice(0, dash)     // "1-3"
  const maxMember = Math.max(
    ...labeled.map(m => memberIndexOf(formatSeatId(m, { parcel: false }))),
  )
  return `${base}-${maxMember + ordinal}`
}

/** Minimum usable tap-target width per bed cell (px). */
export const MIN_BED_WIDTH = 44

/** Grid gap between cells (px). Must match Tailwind gap-1 = 4px. */
export const CELL_GAP = 4

/**
 * A single display column of the manage grid:
 * - `pos`   — a real seat position, shared by every row at that position.
 * - `extra` — a slot reserved because some group in this position-column has an
 *   extra seat. Extra columns are global: every row reserves them so the grid
 *   stays aligned; a row whose group has no seat at that slot renders empty.
 * - `gap`   — a fixed-width spacer track BETWEEN groups. Grouping is expressed
 *   with these tracks (not seat margins) so every seat cell is a clean 1fr and
 *   every group separator is identical regardless of its neighbours.
 */
export type DisplayColumn =
  | { kind: 'pos'; pos: number }
  | { kind: 'extra'; afterPos: number; slot: number }
  | { kind: 'gap' }

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
