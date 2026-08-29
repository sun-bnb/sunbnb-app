/**
 * Pure layout builder for the parcel grid — a faithful port of the web
 * ParcelView's column/row construction (apps/partner/.../ParcelView.tsx) on
 * top of the shared @repo/floor-core/grid-helpers. Everything here is
 * deterministic geometry; rendering and gestures live in GridCanvas.
 */
import { decodeSeatNumber } from '@repo/data/seat-label'
import {
  ROW_LABEL_WIDTH,
  buildDisplayColumns,
  groupExtraSeatLabel,
  type DisplayColumn,
} from '@repo/floor-core/grid-helpers'
import type { InventoryItem } from '@repo/floor-core/types'

export const CELL_W = 48
export const CELL_H = 54
export const CELL_GAP = 4
export const GROUP_GAP_PX = 14
export const ROW_PAD_V = 2
export const ROW_MB = 2
export const POOL_CELL_W = 56
export const POOL_CELL_H = 48
export { ROW_LABEL_WIDTH }

export type GridCell =
  | { kind: 'gap'; key: string }
  | { kind: 'empty'; key: string }
  | { kind: 'seat'; key: string; item: InventoryItem }
  | { kind: 'extra'; key: string; item: InventoryItem; label: string }

export interface HitRect {
  x: number
  y: number
  w: number
  h: number
  item: InventoryItem
  isPool: boolean
  isGroupExtra: boolean
}

export interface ParcelLayout {
  parcelNum: number
  rows: { row: number; cells: GridCell[] }[]
  poolItems: InventoryItem[]
  /** Tap targets in content coordinates (scale 1) for the canvas hit-test. */
  hitRects: HitRect[]
  /** Fixed content-box size at scale 1 — drives pan clamping and fit-to-view. */
  contentW: number
  contentH: number
}

/** Find the cell under a content-space point (post-transform coordinates). */
export function hitTest(layout: ParcelLayout, cx: number, cy: number): HitRect | null {
  for (const r of layout.hitRects) {
    if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r
  }
  return null
}

export function parcelNumbers(items: InventoryItem[]): number[] {
  const set = new Set<number>()
  for (const i of items) {
    if (i.status === 'disabled') continue
    set.add(decodeSeatNumber(i.number).parcel)
  }
  return Array.from(set).sort((a, b) => a - b)
}

export function buildParcelLayout(
  allItems: InventoryItem[],
  parcelNum: number,
  reversed = false,
): ParcelLayout {
  const enabled = allItems.filter(i => i.status !== 'disabled')
  const allRegular = enabled.filter(i => i.status !== 'pool')
  const regular = allRegular.filter(i => decodeSeatNumber(i.number).parcel === parcelNum)

  // Group-extra pool seats (attached to a SunbedGroup) vs free pool seats.
  const groupExtrasByGroupId = new Map<string, InventoryItem[]>()
  const freePool: InventoryItem[] = []
  for (const i of enabled) {
    if (i.status !== 'pool') continue
    if (i.sunbedGroupId) {
      const list = groupExtrasByGroupId.get(i.sunbedGroupId)
      if (list) list.push(i)
      else groupExtrasByGroupId.set(i.sunbedGroupId, [i])
    } else if (decodeSeatNumber(i.number).parcel === parcelNum) {
      freePool.push(i)
    }
  }
  for (const extras of groupExtrasByGroupId.values()) extras.sort((a, b) => a.number - b.number)

  // Rows: row → position → item
  const grouped = new Map<number, Record<number, InventoryItem>>()
  for (const item of regular) {
    const { row, seatIdx } = decodeSeatNumber(item.number)
    const positions = grouped.get(row) ?? {}
    positions[seatIdx] = item
    grouped.set(row, positions)
  }
  const rowEntries = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])

  const parcelPositions: number[] = []
  for (const [, positions] of rowEntries) {
    for (const k of Object.keys(positions)) parcelPositions.push(Number(k))
  }

  // Per-group indexes (mirrors the web's track-020 O(1) lookups).
  const regularMembersByGroupId = new Map<string, InventoryItem[]>()
  for (const r of allRegular) {
    if (!r.sunbedGroupId) continue
    const list = regularMembersByGroupId.get(r.sunbedGroupId)
    if (list) list.push(r)
    else regularMembersByGroupId.set(r.sunbedGroupId, [r])
  }
  const trailingPosByGroupId = new Map<string, number>()
  for (const [gid, members] of regularMembersByGroupId) {
    trailingPosByGroupId.set(gid, Math.max(...members.map(m => decodeSeatNumber(m.number).seatIdx)))
  }
  const allMembersByGroupId = new Map<string, InventoryItem[]>()
  for (const i of enabled) {
    if (!i.sunbedGroupId) continue
    const list = allMembersByGroupId.get(i.sunbedGroupId)
    if (list) list.push(i)
    else allMembersByGroupId.set(i.sunbedGroupId, [i])
  }
  const otherGroupMembers = (it: InventoryItem): InventoryItem[] =>
    it.sunbedGroupId
      ? (allMembersByGroupId.get(it.sunbedGroupId) ?? []).filter(i => i.id !== it.id)
      : []

  // position → max extra count among groups whose trailing position is that position
  const extraSlotsAfter = new Map<number, number>()
  for (const [gid, extras] of groupExtrasByGroupId) {
    const members = regularMembersByGroupId.get(gid) ?? []
    if (members.length === 0) continue
    if (decodeSeatNumber(members[0]!.number).parcel !== parcelNum) continue
    const trailingPos = trailingPosByGroupId.get(gid)!
    extraSlotsAfter.set(trailingPos, Math.max(extraSlotsAfter.get(trailingPos) ?? 0, extras.length))
  }

  const displayColumns = buildDisplayColumns(parcelPositions, extraSlotsAfter, reversed)

  const resolveColumn = (col: DisplayColumn, positions: Record<number, InventoryItem>, idx: number): GridCell => {
    if (col.kind === 'gap') return { kind: 'gap', key: `g${idx}` }
    if (col.kind === 'pos') {
      const item = positions[col.pos]
      return item ? { kind: 'seat', key: `p${col.pos}`, item } : { kind: 'empty', key: `p${col.pos}` }
    }
    const key = `x${col.afterPos}-${col.slot}`
    const trailing = positions[col.afterPos]
    const gid = trailing?.sunbedGroupId
    if (!trailing || !gid) return { kind: 'empty', key }
    if (trailingPosByGroupId.get(gid) !== col.afterPos) return { kind: 'empty', key }
    const extra = (groupExtrasByGroupId.get(gid) ?? [])[col.slot]
    if (!extra) return { kind: 'empty', key }
    return { kind: 'extra', key, item: extra, label: groupExtraSeatLabel(extra, otherGroupMembers(extra)) }
  }

  const rows = rowEntries.map(([row, positions]) => ({
    row,
    cells: displayColumns.map((col, idx) => resolveColumn(col, positions, idx)),
  }))

  // ── Content-box geometry (scale 1) ──────────────────────────────────────
  const nCols = displayColumns.length
  const colsWidth = displayColumns.reduce((w, c) => w + (c.kind === 'gap' ? GROUP_GAP_PX : CELL_W), 0)
  const contentW = ROW_LABEL_WIDTH + colsWidth + CELL_GAP * nCols
  const rowH = CELL_H + ROW_PAD_V * 2 + ROW_MB

  const poolItems = freePool.sort((a, b) => a.number - b.number)
  const perPoolRow = Math.max(1, Math.floor((contentW + CELL_GAP) / (POOL_CELL_W + CELL_GAP)))
  const poolCellCount = poolItems.length + 1 // + the dashed add button
  const poolRows = Math.ceil(poolCellCount / perPoolRow)
  const poolH = 12 + 1 + (poolItems.length > 0 ? 22 : 0) + poolRows * (POOL_CELL_H + CELL_GAP) + 12

  // ── Hit rects (content coordinates at scale 1, mirroring the render flow) ──
  const hitRects: HitRect[] = []
  rows.forEach(({ cells }, rowIdx) => {
    const cellY = rowIdx * rowH + ROW_PAD_V
    let x = ROW_LABEL_WIDTH
    for (const cell of cells) {
      x += CELL_GAP
      if (cell.kind === 'gap') {
        x += GROUP_GAP_PX
        continue
      }
      if (cell.kind === 'seat' || cell.kind === 'extra') {
        hitRects.push({
          x, y: cellY, w: CELL_W, h: CELL_H,
          item: cell.item, isPool: false, isGroupExtra: cell.kind === 'extra',
        })
      }
      x += CELL_W
    }
  })
  const poolCellsTop = rows.length * rowH + 12 + 1 + 12 + (poolItems.length > 0 ? 20 : 0)
  poolItems.forEach((item, idx) => {
    const r = Math.floor(idx / perPoolRow)
    const c = idx % perPoolRow
    hitRects.push({
      x: c * (POOL_CELL_W + CELL_GAP),
      y: poolCellsTop + r * (POOL_CELL_H + CELL_GAP),
      w: POOL_CELL_W, h: POOL_CELL_H,
      item, isPool: true, isGroupExtra: false,
    })
  })

  const contentH = rows.length * rowH + poolH + 24
  return { parcelNum, rows, poolItems, hitRects, contentW, contentH }
}

/** Pool-band sequence number, as the web PoolCell shows it. */
export function poolSeq(item: InventoryItem): number {
  const { parcel } = decodeSeatNumber(item.number)
  return item.number - (parcel * 10000 + 9900)
}
