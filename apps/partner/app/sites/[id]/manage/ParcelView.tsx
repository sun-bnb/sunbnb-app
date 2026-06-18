'use client'

import React, { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { InventoryItem } from '@/types/shared'
import Item from './Item'
import {
  ROW_LABEL_WIDTH, groupExtraSeatLabel,
  buildDisplayColumns, type DisplayColumn,
} from './grid-helpers'
import { createPoolSeat } from './actions'
import { getBedState, getCellAppearance } from './bed-state'

function PoolCell({
  item,
  onSelect,
  hideDetail = false,
}: {
  item: InventoryItem
  onSelect: () => void
  hideDetail?: boolean
}) {
  const parcel = parseInt(String(item.number)[0]!, 10)
  const POOL_BAND_BASE = 9900
  const seq = item.number - (parcel * 10000 + POOL_BAND_BASE)
  const { bg, icon } = getCellAppearance(item)

  return (
    <button
      onClick={onSelect}
      className={`
        ${bg} border-2 rounded-lg
        min-w-[44px] min-h-[44px] w-14
        py-2 px-1 flex flex-col items-center justify-center
        active:brightness-90 transition-colors select-none
      `}
      title={`Seat ${seq}`}
    >
      {!hideDetail && (
        <>
          {icon && <span className="text-[10px] leading-none">{icon}</span>}
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
  t,
}: {
  poolItems: InventoryItem[]
  isPendingPool: boolean
  onSelectPool: (item: InventoryItem) => void
  onAddSeat: () => void
  hideDetail: boolean
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

function parseSunbedNumber(num: number) {
  const str = String(num)
  const parcel = parseInt(str[0]!, 10)
  const row = parseInt(str.substring(1, 3), 10)
  const position = parseInt(str.substring(3), 10)
  return { parcel, row, position }
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
  zoom: number
  onSelectItem: (item: InventoryItem, isPool: boolean, isGroupExtra: boolean) => void
  /** Pointer handlers for the scroll container (drag-to-pan). */
  onScrollPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onScrollPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onScrollPointerUp: () => void
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
  zoom,
  onSelectItem,
  onScrollPointerDown,
  onScrollPointerMove,
  onScrollPointerUp,
}: ParcelViewProps) {
  const t = useTranslations('SiteManage')
  const router = useRouter()
  const [isPendingPool, startPoolTransition] = useTransition()

  // At small zoom, drop per-chair number/icon — just colored blocks to orient.
  const hideDetail = zoom < DETAIL_HIDE_BELOW

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

  // position → max extra count among groups whose trailing position is that position
  const extraSlotsAfter = new Map<number, number>()
  for (const [gid, extras] of groupExtrasByGroupId) {
    const members = allRegularItems.filter(r => r.sunbedGroupId === gid)
    if (members.length === 0) continue
    const parsed = members.map(m => parseSunbedNumber(m.number))
    if (parsed[0]!.parcel !== parcelNum) continue
    const trailingPos = Math.max(...parsed.map(p => p.position))
    extraSlotsAfter.set(trailingPos, Math.max(extraSlotsAfter.get(trailingPos) ?? 0, extras.length))
  }

  const displayColumns = buildDisplayColumns(parcelPositions, extraSlotsAfter, isParcelReversed)

  // All OTHER members of an item's group — for label derivation
  const otherGroupMembers = (it: InventoryItem): InventoryItem[] =>
    it.sunbedGroupId
      ? allInventoryItems.filter(i => i.id !== it.id && i.sunbedGroupId === it.sunbedGroupId)
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
    const members = allRegularItems.filter(r => r.sunbedGroupId === gid)
    const trailingPos = Math.max(...members.map(m => parseSunbedNumber(m.number).position))
    if (trailingPos !== col.afterPos) return { kind: 'empty' }
    const groupExtras = groupExtrasByGroupId.get(gid) ?? []
    const extra = groupExtras[col.slot]
    if (!extra) return { kind: 'empty' }
    return { kind: 'extra', item: extra, label: groupExtraSeatLabel(extra, otherGroupMembers(extra)) }
  }

  const sortedPoolItems = poolItems.slice().sort((a, b) => a.number - b.number)

  return (
    <div className="mb-5">
      {/* Scroll+zoom grid
          - overflow-x-auto keeps the class name that the pinch handler finds via .closest()
          - drag-to-pan handlers attached here for desktop mouse panning */}
      <div
        className={`overflow-x-auto select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${zoom !== 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={{ touchAction: 'pan-x pan-y' }}
        onPointerDown={onScrollPointerDown}
        onPointerMove={onScrollPointerMove}
        onPointerUp={onScrollPointerUp}
        onPointerLeave={onScrollPointerUp}
      >
        {/* CSS zoom scales the rendered content; sticky row labels pin within the zoom frame. */}
        <div style={{ zoom }}>
          {rowEntries.map(([rowNum, positions]) => (
            <div
              key={rowNum}
              className={`
                flex items-stretch gap-1 mb-0.5 rounded-lg py-0.5
                ${rowNum % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800/40' : ''}
              `}
            >
              {/* Sticky row label */}
              <div
                className={`
                  sticky left-0 z-10 flex-shrink-0
                  flex items-center justify-center
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
                    <div
                      key={key}
                      className="flex-shrink-0 min-h-[44px]"
                      style={{ width: 48 }}
                    />
                  )
                }
                if (resolved.kind === 'seat') {
                  return (
                    <div
                      key={key}
                      className="flex-shrink-0"
                      style={{ display: 'grid', width: 48 }}
                    >
                      <Item
                        siteId={siteId}
                        item={resolved.item}
                        onSelect={() => onSelectItem(resolved.item, false, false)}
                        hideDetail={hideDetail}
                      />
                    </div>
                  )
                }
                // Group-extra seat
                const { bg: extraBg, icon: extraIcon } = getCellAppearance(resolved.item)
                return (
                  <div
                    key={key}
                    className="flex-shrink-0"
                    style={{ width: 48 }}
                  >
                    <button
                      onClick={() => onSelectItem(resolved.item, false, true)}
                      className={`
                        ${extraBg} border-2 rounded-lg
                        w-full min-h-[44px]
                        py-2 px-0.5 flex flex-col items-center justify-center
                        active:brightness-90 transition-colors select-none
                      `}
                      title={`Seat ${resolved.label}`}
                    >
                      {!hideDetail && (
                        <>
                          {extraIcon && <span className="text-[10px] leading-none">{extraIcon}</span>}
                          <span className="text-[10px] leading-none opacity-70">{resolved.label}</span>
                        </>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}

          {/* Per-parcel pool section — lives INSIDE the zoom+scroll frame so the
              ungrouped extra seats zoom and pan together with the parcel grid as
              one continuous area (previously it sat outside and stayed fixed). */}
          <PoolSection
            poolItems={sortedPoolItems}
            isPendingPool={isPendingPool}
            onSelectPool={(item) => onSelectItem(item, true, false)}
            onAddSeat={() => {
              startPoolTransition(async () => {
                await createPoolSeat(siteId, parcelNum, accessKey)
                router.refresh()
              })
            }}
            hideDetail={hideDetail}
            t={t}
          />
        </div>
      </div>
    </div>
  )
}
