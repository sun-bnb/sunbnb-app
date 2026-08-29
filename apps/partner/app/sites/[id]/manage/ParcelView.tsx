'use client'

import React, { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import CreditCardIcon from '@mui/icons-material/CreditCard'
import { InventoryItem } from '@/types/shared'
import Item from './Item'
import {
  ROW_LABEL_WIDTH, groupExtraSeatLabel,
  buildDisplayColumns, type DisplayColumn,
} from '@repo/floor-core/grid-helpers'
import { createPoolSeat } from './actions'
import { getBedState, getCellAppearance } from '@repo/floor-core/bed-state'
import { decodeSeatNumber } from '@repo/data/seat-label'

function PoolCell({
  item,
  onSelect,
  hideDetail = false,
  selected = false,
}: {
  item: InventoryItem
  onSelect: () => void
  hideDetail?: boolean
  selected?: boolean
}) {
  const { parcel } = decodeSeatNumber(item.number)
  const POOL_BAND_BASE = 9900
  const seq = item.number - (parcel * 10000 + POOL_BAND_BASE)
  const { bg, icon } = getCellAppearance(item)

  return (
    <button
      data-item-id={item.id}
      onClick={onSelect}
      className={`
        ${bg} border-2 rounded-lg
        min-w-[44px] min-h-[44px] w-14
        py-2 px-1 flex flex-col items-center justify-center
        active:brightness-90 transition-colors select-none
        ${selected ? 'ring-2 ring-blue-500' : ''}
      `}
      title={`Seat ${seq}`}
    >
      {!hideDetail && (
        <>
          {icon && (
            icon === 'card'
              ? <CreditCardIcon sx={{ fontSize: 12 }} />
              : <span className="text-[10px] leading-none">{icon}</span>
          )}
          <span className="text-[10px] leading-none opacity-70">{seq}</span>
        </>
      )}
    </button>
  )
}

function PoolSection({
  poolItems,
  isPendingPool,
  onSelectPool,
  onAddSeat,
  hideDetail,
  selectedIds,
  t,
}: {
  poolItems: InventoryItem[]
  isPendingPool: boolean
  onSelectPool: (item: InventoryItem) => void
  onAddSeat: () => void
  hideDetail: boolean
  selectedIds: string[]
  t: ReturnType<typeof useTranslations<'SiteManage'>>
}) {
  const occupied = poolItems.filter(i => getBedState(i) !== 'available').length

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
      {poolItems.length > 0 && (
        <div className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 px-0.5 leading-none tabular-nums">
          {occupied}/{poolItems.length}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {poolItems.map(item => (
          <PoolCell
            key={item.id}
            item={item}
            onSelect={() => onSelectPool(item)}
            hideDetail={hideDetail}
            selected={selectedIds.includes(item.id)}
          />
        ))}

        <button
          onClick={onAddSeat}
          disabled={isPendingPool}
          aria-label={t('poolAddSeat')}
          className="
            border-2 border-dashed border-gray-400 dark:border-gray-600 rounded-lg bg-transparent
            min-w-[44px] min-h-[44px] w-14
            py-2 px-1 flex items-center justify-center
            text-gray-400 dark:text-gray-500 text-lg font-light
            active:bg-gray-200 disabled:opacity-40 transition-colors select-none
          "
        >
          {isPendingPool ? (
            <span className="text-xs">…</span>
          ) : (
            <span aria-hidden="true">+</span>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Fixed-width track (px) of the gap between groups in the scroll view ──────
const GROUP_GAP_PX = 14

// Below this zoom the per-chair number/icon is hidden — at small scale the text
// is illegible anyway, so cells become plain colored blocks for orientation.
const DETAIL_HIDE_BELOW = 0.6

// ── ParcelView ────────────────────────────────────────────────────────────────

/**
 * Positional parts of a seat number, via the canonical decoder.
 *
 * This used to slice the string — `str[0]` as the parcel — which capped the
 * grid at nine parcels: a 43-parcel site showed nine, each polluted with seats
 * from other parcels carrying misread rows and positions.
 */
function parseSunbedNumber(num: number) {
  const { parcel, row, seatIdx } = decodeSeatNumber(num)
  return { parcel, row, position: seatIdx }
}

interface ParcelViewProps {
  siteId: string
  accessKey: string
  parcelNum: number
  /** All regular (non-pool) inventory items for this parcel. */
  regularItems: InventoryItem[]
  /** All regular inventory items across ALL parcels (for group-extra resolution). */
  allRegularItems: InventoryItem[]
  /** Group-extra pool seats (status='pool' && sunbedGroupId), indexed by groupId. */
  groupExtrasByGroupId: Map<string, InventoryItem[]>
  /** Free pool items (status='pool' && !sunbedGroupId) for this parcel. */
  poolItems: InventoryItem[]
  /** All inventory items across ALL parcels (for group membership queries). */
  allInventoryItems: InventoryItem[]
  isParcelReversed: boolean
  /** Canvas transform driven by the parent ManageView pan/zoom surface. */
  scale: number
  tx: number
  ty: number
  /** True right after a pan/pinch so a seat tap that followed a drag is ignored. */
  wasPannedRef: React.MutableRefObject<boolean>
  /** Ids of seats currently multiselected (ringed). Empty = not in multiselect. */
  selectedIds: string[]
  onSelectItem: (item: InventoryItem, isPool: boolean, isGroupExtra: boolean) => void
}

export default function ParcelView({
  siteId,
  accessKey,
  parcelNum,
  regularItems,
  allRegularItems,
  groupExtrasByGroupId,
  poolItems,
  allInventoryItems,
  isParcelReversed,
  scale,
  tx,
  ty,
  wasPannedRef,
  selectedIds,
  onSelectItem,
}: ParcelViewProps) {
  const t = useTranslations('SiteManage')
  const router = useRouter()
  const [isPendingPool, startPoolTransition] = useTransition()

  // At small zoom, drop per-chair number/icon — just colored blocks to orient.
  const hideDetail = scale < DETAIL_HIDE_BELOW

  // Selection guard: ignore the click that fires at the end of a pan/pinch so
  // dragging the canvas never selects a seat.
  const select = (item: InventoryItem, isPool: boolean, isGroupExtra: boolean) => {
    if (wasPannedRef.current) return
    onSelectItem(item, isPool, isGroupExtra)
  }

  // Sort row entries ascending (front row first)
  const grouped = regularItems.reduce((acc, item) => {
    const { row, position } = parseSunbedNumber(item.number)
    if (!acc[row]) acc[row] = {}
    acc[row][position] = item
    return acc
  }, {} as Record<number, Record<number, InventoryItem>>)

  const rowEntries: [number, Record<number, InventoryItem>][] = Object.entries(grouped)
    .map(([rowStr, positions]) => [Number(rowStr), positions] as [number, Record<number, InventoryItem>])
    .sort(([a], [b]) => a - b)

  // Build display columns for this parcel
  const parcelPositions = Array.from(
    rowEntries.reduce<Set<number>>((s, [, positions]) => {
      Object.keys(positions).forEach(k => s.add(Number(k)))
      return s
    }, new Set())
  )

  // Track 020 P3: group-membership lookups were `allRegularItems.filter(...)`
  // calls — one per group-extra AND one per grid CELL via resolveColumn below,
  // i.e. O(rows × cols × N) per render, re-run on every 30s refresh and every
  // seat tap. Build the per-group index once per render; cells do O(1) reads.
  const regularMembersByGroupId = new Map<string, InventoryItem[]>()
  for (const r of allRegularItems) {
    if (!r.sunbedGroupId) continue
    const list = regularMembersByGroupId.get(r.sunbedGroupId)
    if (list) list.push(r)
    else regularMembersByGroupId.set(r.sunbedGroupId, [r])
  }

  // Trailing (max) position per group — resolveColumn re-derived this per cell.
  const trailingPosByGroupId = new Map<string, number>()
  for (const [gid, members] of regularMembersByGroupId) {
    trailingPosByGroupId.set(gid, Math.max(...members.map(m => parseSunbedNumber(m.number).position)))
  }

  const allMembersByGroupId = new Map<string, InventoryItem[]>()
  for (const i of allInventoryItems) {
    if (!i.sunbedGroupId) continue
    const list = allMembersByGroupId.get(i.sunbedGroupId)
    if (list) list.push(i)
    else allMembersByGroupId.set(i.sunbedGroupId, [i])
  }

  // position → max extra count among groups whose trailing position is that position
  const extraSlotsAfter = new Map<number, number>()
  for (const [gid, extras] of groupExtrasByGroupId) {
    const members = regularMembersByGroupId.get(gid) ?? []
    if (members.length === 0) continue
    if (parseSunbedNumber(members[0]!.number).parcel !== parcelNum) continue
    const trailingPos = trailingPosByGroupId.get(gid)!
    extraSlotsAfter.set(trailingPos, Math.max(extraSlotsAfter.get(trailingPos) ?? 0, extras.length))
  }

  const displayColumns = buildDisplayColumns(parcelPositions, extraSlotsAfter, isParcelReversed)

  // All OTHER members of an item's group — for label derivation
  const otherGroupMembers = (it: InventoryItem): InventoryItem[] =>
    it.sunbedGroupId
      ? (allMembersByGroupId.get(it.sunbedGroupId) ?? []).filter(i => i.id !== it.id)
      : []

  type ResolvedCell =
    | { kind: 'seat'; item: InventoryItem }
    | { kind: 'extra'; item: InventoryItem; label: string }
    | { kind: 'empty' }

  const resolveColumn = (col: DisplayColumn, positions: Record<number, InventoryItem>): ResolvedCell => {
    if (col.kind === 'gap') return { kind: 'empty' }
    if (col.kind === 'pos') {
      const item = positions[col.pos]
      return item ? { kind: 'seat', item } : { kind: 'empty' }
    }
    // Extra column: filled only if the seat at afterPos is this group's trailing member
    const trailing = positions[col.afterPos]
    const gid = trailing?.sunbedGroupId
    if (!trailing || !gid) return { kind: 'empty' }
    const trailingPos = trailingPosByGroupId.get(gid)
    if (trailingPos !== col.afterPos) return { kind: 'empty' }
    const groupExtras = groupExtrasByGroupId.get(gid) ?? []
    const extra = groupExtras[col.slot]
    if (!extra) return { kind: 'empty' }
    return { kind: 'extra', item: extra, label: groupExtraSeatLabel(extra, otherGroupMembers(extra)) }
  }

  const sortedPoolItems = poolItems.slice().sort((a, b) => a.number - b.number)

  return (
    // Single transform layer — the parent ManageView viewport clips + drives
    // pan/zoom. `transform: translate scale` (origin top-left) scales uniformly
    // across mobile/desktop (unlike CSS `zoom`). `w-max` so it sizes to the
    // widest row; `absolute` so it doesn't stretch to the viewport.
    <div
      className="parcel-canvas-content absolute top-0 left-0 origin-top-left w-max select-none"
      style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
    >
      {rowEntries.map(([rowNum, positions]) => (
        <div
          key={rowNum}
          className={`
            flex items-stretch gap-1 mb-0.5 rounded-lg py-0.5
            ${rowNum % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800/40' : ''}
          `}
        >
          {/* Row label — pans/scales with the content (no longer sticky) */}
          <div
            className={`
              flex-shrink-0 flex items-center justify-center
              ${rowNum % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800/40' : 'bg-white dark:bg-gray-950'}
            `}
            style={{ width: ROW_LABEL_WIDTH }}
          >
            <span className="text-[10px] font-bold text-gray-500 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 leading-none whitespace-nowrap">
              {t('rowLabel', { n: rowNum })}
            </span>
          </div>

          {/* Bed cells */}
          {displayColumns.map((col, colIdx) => {
            if (col.kind === 'gap') {
              return <div key={`g${colIdx}`} className="flex-shrink-0" style={{ width: GROUP_GAP_PX }} />
            }
            const key = col.kind === 'pos' ? `p${col.pos}` : `x${col.afterPos}-${col.slot}`
            const resolved = resolveColumn(col, positions)
            if (resolved.kind === 'empty') {
              return (
                <div key={key} className="flex-shrink-0 min-h-[44px]" style={{ width: 48 }} />
              )
            }
            if (resolved.kind === 'seat') {
              return (
                <div key={key} className="flex-shrink-0" style={{ display: 'grid', width: 48 }}>
                  <Item
                    siteId={siteId}
                    item={resolved.item}
                    onSelect={() => select(resolved.item, false, false)}
                    hideDetail={hideDetail}
                    selected={selectedIds.includes(resolved.item.id)}
                  />
                </div>
              )
            }
            // Group-extra seat
            const { bg: extraBg, icon: extraIcon } = getCellAppearance(resolved.item)
            return (
              <div key={key} className="flex-shrink-0" style={{ width: 48 }}>
                <button
                  data-item-id={resolved.item.id}
                  onClick={() => select(resolved.item, false, true)}
                  className={`
                    ${extraBg} border-2 rounded-lg
                    w-full min-h-[44px]
                    py-2 px-0.5 flex flex-col items-center justify-center
                    active:brightness-90 transition-colors select-none
                    ${selectedIds.includes(resolved.item.id) ? 'ring-2 ring-blue-500' : ''}
                  `}
                  title={`Seat ${resolved.label}`}
                >
                  {!hideDetail && (
                    <>
                      {extraIcon && (
                        extraIcon === 'card'
                          ? <CreditCardIcon sx={{ fontSize: 12 }} />
                          : <span className="text-[10px] leading-none">{extraIcon}</span>
                      )}
                      <span className="text-[10px] leading-none opacity-70">{resolved.label}</span>
                    </>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      ))}

      {/* Per-parcel pool section — same transform layer, so the ungrouped extra
          seats pan/zoom with the parcel as one continuous area. */}
      <PoolSection
        poolItems={sortedPoolItems}
        isPendingPool={isPendingPool}
        onSelectPool={(item) => select(item, true, false)}
        onAddSeat={() => {
          if (wasPannedRef.current) return
          startPoolTransition(async () => {
            await createPoolSeat(siteId, parcelNum, accessKey)
            router.refresh()
          })
        }}
        hideDetail={hideDetail}
        selectedIds={selectedIds}
        t={t}
      />
    </div>
  )
}
