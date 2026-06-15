'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { InventoryItem, Reservation, RentalBookingProps, SiteProps } from '@/types/shared'
import Item from './Item'
import BedDetail from './BedDetail'
import RentalBookingCard from './RentalBookingCard'
import CreateRentalModal from './CreateRentalModal'
import { computeChunkSize, chunkRows, ROW_LABEL_WIDTH } from './grid-helpers'
import { createPoolSeat } from './actions'
import {
  OP_EXPECTED, OP_CHECKED_IN, OP_WALKED_IN, OP_DEPARTED, OP_NO_SHOW,
  OP_PICKED_UP, OP_RESERVED,
} from '@repo/data/reservation-status'

function parseSunbedNumber(num: number) {
  const str = String(num)
  const parcel = parseInt(str[0]!, 10)
  const row = parseInt(str.substring(1, 3), 10)
  const position = parseInt(str.substring(3), 10)
  return { parcel, row, position }
}

type BedState = 'available' | 'expected' | 'checked-in' | 'walked-in' | 'blocked'
type ViewMode = 'sections' | 'scroll'

// Pool seat numbering: number = parcel*10000 + 9900 + seq
// Display label = seq (number - parcel*10000 - 9900)
const POOL_BAND_BASE = 9900

function getPoolSeq(item: InventoryItem): number {
  const parcel = parseInt(String(item.number)[0]!, 10)
  return item.number - (parcel * 10000 + POOL_BAND_BASE)
}

const VIEW_MODE_KEY = 'sunbnb-manage-view'
const SEAT_ORDER_REVERSED_KEY = 'sunbnb-manage-seat-order-reversed'

function getActiveReservation(item: InventoryItem): Reservation | null {
  if (!item.reservations?.length) return null
  return item.reservations.find(r =>
    !([OP_DEPARTED, OP_NO_SHOW] as string[]).includes(r.operationalStatus)
  ) || null
}

function getBedState(item: InventoryItem): BedState {
  const res = getActiveReservation(item)
  if (!res) return 'available'
  switch (res.operationalStatus) {
    case OP_EXPECTED: return 'expected'
    case OP_CHECKED_IN: return 'checked-in'
    case OP_WALKED_IN: return 'walked-in'
    case 'blocked': return 'blocked'
    default: return 'available'
  }
}

// ── Pool seat cell ─────────────────────────────────────────────────────────────
// Uses the exact same state colors as the regular Item cell so additional seats
// read as a continuation, not a separate system.

const POOL_STATE_STYLES: Record<BedState, string> = {
  'available':  'bg-green-300 border-green-500',
  'expected':   'bg-yellow-300 border-yellow-500 animate-pulse-slow',
  'checked-in': 'bg-blue-400 border-blue-600 text-white',
  'walked-in':  'bg-orange-400 border-orange-600 text-white',
  'blocked':    'bg-gray-400 border-gray-600 text-white',
}

const POOL_ICONS: Record<BedState, string> = {
  'available': '',
  'expected': '⏳',
  'checked-in': '✓',
  'walked-in': '●',
  'blocked': '✕',
}

function PoolCell({
  item,
  onSelect,
}: {
  item: InventoryItem
  onSelect: () => void
}) {
  const seq = getPoolSeq(item)
  const state = getBedState(item)

  return (
    <button
      onClick={onSelect}
      className={`
        ${POOL_STATE_STYLES[state]} border-2 rounded-lg
        min-w-[44px] min-h-[44px] w-14
        py-2 px-1 flex flex-col items-center justify-center
        active:brightness-90 transition-colors select-none
      `}
      title={`Seat ${seq}`}
    >
      {POOL_ICONS[state] && <span className="text-[10px] leading-none">{POOL_ICONS[state]}</span>}
      <span className="text-[10px] leading-none opacity-70">{seq}</span>
    </button>
  )
}

// ── Pool section (per-parcel) ──────────────────────────────────────────────────
// Renders as a continuation strip beneath the parcel's mapped seats — a light
// neutral tint distinguishes the area; seats use the same state colors as
// regular Item cells. The "add seat" button is an outline of the next seat.

function PoolSection({
  poolItems,
  isPendingPool,
  onSelectPool,
  onAddSeat,
  t,
}: {
  poolItems: InventoryItem[]
  isPendingPool: boolean
  onSelectPool: (item: InventoryItem) => void
  onAddSeat: () => void
  t: ReturnType<typeof useTranslations<'SiteManage'>>
}) {
  const occupied = poolItems.filter(i => getBedState(i) !== 'available').length

  // Always render — even when empty — so the add-seat button is always visible
  return (
    <div className="mt-2">
      <div className="bg-gray-100 rounded-xl px-2 pt-2 pb-2">
        {/* Caption — small and muted, reads as a section annotation */}
        <div className="text-xs text-gray-400 mb-1.5 px-0.5 leading-none">
          {t('additionalSeats')}
          {poolItems.length > 0 && (
            <span className="ml-1">· {occupied}/{poolItems.length}</span>
          )}
        </div>

        {/* Seats + outline add-seat button in a wrapping flex row */}
        <div className="flex flex-wrap gap-1">
          {poolItems.map(item => (
            <PoolCell
              key={item.id}
              item={item}
              onSelect={() => onSelectPool(item)}
            />
          ))}

          {/* Add-seat: seat-sized cell with dashed outline */}
          <button
            onClick={onAddSeat}
            disabled={isPendingPool}
            aria-label={t('poolAddSeat')}
            className="
              border-2 border-dashed border-gray-400 rounded-lg bg-transparent
              min-w-[44px] min-h-[44px] w-14
              py-2 px-1 flex items-center justify-center
              text-gray-400 text-lg font-light
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
    </div>
  )
}

// ── View-toggle icons ──────────────────────────────────────────────────────────

function SectionsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="0" y="0" width="6" height="6" rx="1" />
      <rect x="8" y="0" width="6" height="6" rx="1" />
      <rect x="0" y="8" width="6" height="6" rx="1" />
      <rect x="8" y="8" width="6" height="6" rx="1" />
    </svg>
  )
}

function ScrollIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="0" y="1" width="10" height="3" rx="1" />
      <rect x="0" y="6" width="10" height="3" rx="1" />
      <rect x="0" y="11" width="10" height="3" rx="1" />
      <path d="M11 4 L14 7 L11 10 Z" />
    </svg>
  )
}

export default function ManageView({
  site,
  accessKey,
}: {
  site: SiteProps
  accessKey: string
}) {
  const t = useTranslations('SiteManage')
  const router = useRouter()
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [selectedItemIsPool, setSelectedItemIsPool] = useState(false)
  const [showRentalModal, setShowRentalModal] = useState(false)
  const [isPendingPool, startPoolTransition] = useTransition()

  // View mode — initialised to 'sections' so SSR and first client render match,
  // then overridden from localStorage in useEffect (avoids hydration mismatch).
  const [viewMode, setViewMode] = useState<ViewMode>('sections')

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    if (stored === 'sections' || stored === 'scroll') setViewMode(stored)
  }, [])

  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    localStorage.setItem(VIEW_MODE_KEY, mode)
  }

  // Seat column order — false = smallest seat number on the left (default),
  // true = reversed (largest on the left). Per-device staff preference.
  const [reversed, setReversed] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(SEAT_ORDER_REVERSED_KEY) === 'true') setReversed(true)
  }, [])

  const handleToggleReversed = () => {
    setReversed(prev => {
      const next = !prev
      localStorage.setItem(SEAT_ORDER_REVERSED_KEY, String(next))
      return next
    })
  }

  // Measure the container width so we can compute how many bed columns fit.
  // ResizeObserver fires once immediately on observe() then on every resize/
  // orientation change — no separate window-resize listener needed.
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number>(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0]!.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Default to 50 until measured — keeps all beds in a single section on the
  // first render, avoiding a visible layout jump on small sites.
  const chunkSize = containerWidth > 0 ? computeChunkSize(containerWidth) : 50

  // Auto-refresh every 30 seconds so Carlos sees new bookings
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(interval)
  }, [router])

  const { inventoryItems = [] } = site

  // Pool seats (status='pool') are separated from the regular grid.
  // They are NOT counted in the headline occupancy summary — tracked only within
  // their own per-parcel section (product decision).
  const poolItems = inventoryItems.filter(i => i.status === 'pool')
  const regularItems = inventoryItems.filter(i => i.status !== 'pool')

  // Headline summary excludes pool seats and disabled items
  const activeItems = regularItems.filter(i => i.status !== 'disabled')

  // Compute summary counts (regular seats only)
  const summary = activeItems.reduce((acc, item) => {
    const state = getBedState(item)
    acc[state] = (acc[state] || 0) + 1
    return acc
  }, {} as Record<BedState, number>)

  const total = activeItems.length
  const occupied = (summary['checked-in'] || 0) + (summary['walked-in'] || 0)

  // Group regular items by parcel → row → position (including disabled for spacers)
  const grouped = regularItems.reduce((acc, item) => {
    const { parcel, row, position } = parseSunbedNumber(item.number)
    if (!acc[parcel]) acc[parcel] = {}
    if (!acc[parcel][row]) acc[parcel][row] = {}
    acc[parcel][row][position] = item
    return acc
  }, {} as Record<number, Record<number, Record<number, InventoryItem>>>)

  // Group pool items by parcel
  const poolByParcel = poolItems.reduce((acc, item) => {
    const parcel = parseInt(String(item.number)[0]!, 10)
    if (!acc[parcel]) acc[parcel] = []
    acc[parcel].push(item)
    return acc
  }, {} as Record<number, InventoryItem[]>)

  return (
    <div ref={containerRef} className="px-2 pt-2 pb-20 mx-auto w-full max-w-screen-lg">
      {/* ── Summary Bar ── */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2 sm:gap-4 mb-3 px-3 py-3 sm:px-4 sm:py-4 bg-white rounded-xl text-sm sm:text-base font-bold sticky top-0 z-10 border-2 shadow-sm">
        <span className="text-gray-900 text-base sm:text-lg col-span-2 sm:col-span-1">{occupied}/{total}</span>
        <span className="flex items-center gap-1.5 text-green-700">
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-green-300 border-2 border-green-500 flex-shrink-0" />
          {summary['available'] || 0} {t('free')}
        </span>
        <span className="flex items-center gap-1.5 text-yellow-700">
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-yellow-300 border-2 border-yellow-500 flex-shrink-0" />
          {(summary['expected'] || 0)} {t('expected')}
        </span>
        <span className="flex items-center gap-1.5 text-blue-700">
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-blue-400 border-2 border-blue-600 flex-shrink-0" />
          {(summary['checked-in'] || 0) + (summary['walked-in'] || 0)} {t('checkedIn')}
        </span>
        {(summary['blocked'] || 0) > 0 && (
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-gray-400 border-2 border-gray-600 flex-shrink-0" />
            {summary['blocked']} {t('blocked')}
          </span>
        )}

        {/* ── View Mode Toggle ── */}
        <div className="col-span-2 flex justify-end sm:ml-auto gap-2">
          {/* Reverse seat order (per-device staff preference) */}
          <button
            onClick={handleToggleReversed}
            aria-label={t('reverseOrder')}
            aria-pressed={reversed}
            title={t('reverseOrder')}
            className={`
              flex items-center gap-1.5 px-3 min-h-[44px] text-xs rounded-lg border font-semibold transition-colors
              ${reversed
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-400 border-gray-200 hover:text-gray-700 hover:bg-gray-50'}
            `}
          >
            <span aria-hidden="true">⇄</span>
            <span className="hidden sm:inline">{t('reverseOrder')}</span>
          </button>
          <div className="flex rounded-lg overflow-hidden border border-gray-200 font-semibold">
            <button
              onClick={() => handleViewMode('sections')}
              aria-label={t('viewSections')}
              title={t('viewSections')}
              className={`
                flex items-center gap-1.5 px-3 min-h-[44px] text-xs transition-colors
                ${viewMode === 'sections'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50'}
              `}
            >
              <SectionsIcon />
              <span className="hidden sm:inline">{t('viewSections')}</span>
            </button>
            <button
              onClick={() => handleViewMode('scroll')}
              aria-label={t('viewScroll')}
              title={t('viewScroll')}
              className={`
                flex items-center gap-1.5 px-3 min-h-[44px] text-xs border-l border-gray-200 transition-colors
                ${viewMode === 'scroll'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50'}
              `}
            >
              <ScrollIcon />
              <span className="hidden sm:inline">{t('viewScroll')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Sunbed Grid ── */}
      {Object.entries(grouped).map(([parcel, rows]) => {
        const parcelNum = Number(parcel)
        // Sort row entries by row number (ascending = front row first)
        const rowEntries: [number, Record<number, InventoryItem>][] = Object.entries(rows)
          .map(([rowStr, positions]) => [Number(rowStr), positions] as [number, Record<number, InventoryItem>])
          .sort(([a], [b]) => a - b)

        // Pool seats for this parcel (sorted by seq = number ascending)
        const parcelPoolItems = (poolByParcel[parcelNum] || []).slice().sort((a, b) => a.number - b.number)

        // ── Horizontal-scroll view ────────────────────────────────────────────
        if (viewMode === 'scroll') {
          // Collect all positions across every row, ordered to match the
          // sectioned view: smallest seat number on the left by default,
          // reversed (largest on the left) when the staff toggle is on.
          const allPositions = Array.from(
            rowEntries.reduce<Set<number>>((s, [, positions]) => {
              Object.keys(positions).forEach(k => s.add(Number(k)))
              return s
            }, new Set())
          ).sort((a, b) => (reversed ? b - a : a - b))

          return (
            <div key={parcel} className="mb-5">
              <h2 className="text-base sm:text-lg font-bold mb-2 px-1">
                {t('parcel', { n: parcel })}
              </h2>

              {/* Single scroll container — all rows stay aligned while scrolling */}
              <div className="overflow-x-auto">
                {rowEntries.map(([rowNum, positions]) => (
                  <div
                    key={rowNum}
                    className={`
                      flex items-stretch gap-1 mb-0.5 rounded-lg py-0.5
                      ${rowNum % 2 === 0 ? 'bg-gray-50' : ''}
                    `}
                  >
                    {/* Row-label badge — sticky to the left so it stays visible
                        while the bed cells scroll horizontally beneath it.
                        Background matches the row strip so cells slide cleanly under it. */}
                    <div
                      className={`
                        sticky left-0 z-10 flex-shrink-0
                        flex items-center justify-center
                        ${rowNum % 2 === 0 ? 'bg-gray-50' : 'bg-white'}
                      `}
                      style={{ width: ROW_LABEL_WIDTH }}
                    >
                      <span className="text-[10px] font-bold text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 leading-none whitespace-nowrap">
                        {t('rowLabel', { n: rowNum })}
                      </span>
                    </div>

                    {/* Fixed-width bed cells — ~48px each so they never shrink;
                        the scroll container widens instead.
                        Using a single-column grid wrapper makes the Item button
                        stretch to fill the cell (grid items stretch by default). */}
                    {allPositions.map(pos => {
                      const item = positions[pos] ?? null
                      return item ? (
                        <div
                          key={pos}
                          className="flex-shrink-0"
                          style={{ display: 'grid', width: 48 }}
                        >
                          <Item
                            siteId={site.id!}
                            item={item}
                            onSelect={() => { setSelectedItem(item); setSelectedItemIsPool(false) }}
                          />
                        </div>
                      ) : (
                        <div
                          key={pos}
                          className="flex-shrink-0 min-h-[44px]"
                          style={{ width: 48 }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>

              {/* Pool section (scroll view) */}
              <PoolSection
                poolItems={parcelPoolItems}
                isPendingPool={isPendingPool}
                onSelectPool={(item) => { setSelectedItem(item); setSelectedItemIsPool(true) }}
                onAddSeat={() => {
                  startPoolTransition(async () => {
                    await createPoolSeat(site.id!, parcelNum, accessKey)
                    router.refresh()
                  })
                }}
                t={t}
              />
            </div>
          )
        }

        // ── Sectioned view (default) ──────────────────────────────────────────
        const sections = chunkRows(rowEntries, chunkSize, reversed)

        return (
          <div key={parcel} className="mb-5">
            <h2 className="text-base sm:text-lg font-bold mb-2 px-1">
              {t('parcel', { n: parcel })}
            </h2>

            {sections.map((section, sectionIdx) => (
              <div key={sectionIdx} className={sectionIdx > 0 ? 'mt-4' : ''}>
                {/* Section span header — only when the parcel has multiple sections */}
                {sections.length > 1 && (
                  <div className="text-xs text-gray-400 font-semibold mb-1 px-1 tabular-nums tracking-wide">
                    {section.minPos}–{section.maxPos}
                  </div>
                )}

                {/* Row strips */}
                {section.rows.map(({ rowNum, cells }) => (
                  <div
                    key={rowNum}
                    className={`
                      flex items-stretch gap-1 mb-0.5 rounded-lg py-0.5
                      ${rowNum % 2 === 0 ? 'bg-gray-50' : ''}
                    `}
                  >
                    {/* Row-label badge — same badge for this rowNum in every section */}
                    <div
                      className="flex-shrink-0 flex items-center justify-center"
                      style={{ width: ROW_LABEL_WIDTH }}
                    >
                      <span className="text-[10px] font-bold text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 leading-none whitespace-nowrap">
                        {t('rowLabel', { n: rowNum })}
                      </span>
                    </div>

                    {/* Bed cells — fixed chunkSize columns so every section is the same width */}
                    <div
                      className="flex-1 grid gap-1"
                      style={{ gridTemplateColumns: `repeat(${chunkSize}, minmax(0, 1fr))` }}
                    >
                      {cells.map((item, cellIdx) =>
                        item ? (
                          <Item
                            key={item.id}
                            siteId={site.id!}
                            item={item}
                            onSelect={() => { setSelectedItem(item); setSelectedItemIsPool(false) }}
                          />
                        ) : (
                          <div key={`spacer-${cellIdx}`} className="min-h-[44px]" />
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {/* Pool section (sections view) */}
            <PoolSection
              poolItems={parcelPoolItems}
              isPendingPool={isPendingPool}
              onSelectPool={(item) => { setSelectedItem(item); setSelectedItemIsPool(true) }}
              onAddSeat={() => {
                startPoolTransition(async () => {
                  await createPoolSeat(site.id!, parcelNum, accessKey)
                  router.refresh()
                })
              }}
              t={t}
            />
          </div>
        )
      })}

      {/* ── Rental Bookings Section ── */}
      {site.features?.includes('rentals') && (
        <div className="mt-6 mb-4">
          {/* Header — big + button, glanceable counters */}
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-black">🏄</span>
              {(site.rentalBookings?.length ?? 0) > 0 && (
                <span className="text-base font-black text-gray-600">
                  {site.rentalBookings!.filter(b => b.operationalStatus === OP_PICKED_UP).length} {t('out')}
                  {site.rentalBookings!.filter(b => b.operationalStatus === OP_RESERVED).length > 0 && (
                    <span className="text-yellow-600 ml-2">
                      {site.rentalBookings!.filter(b => b.operationalStatus === OP_RESERVED).length} {t('waiting')}
                    </span>
                  )}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowRentalModal(true)}
              className="bg-green-600 text-white text-base font-black px-5 py-3 rounded-xl active:bg-green-700 select-none"
            >
              {t('rentOut')}
            </button>
          </div>

          {(site.rentalBookings?.length ?? 0) === 0 ? (
            <div className="text-center py-6 text-gray-300 text-lg font-bold">
              {t('noRentals')}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {site.rentalBookings!.map(booking => (
                <RentalBookingCard
                  key={booking.id}
                  siteId={site.id!}
                  booking={booking}
                  accessKey={accessKey}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Detail Modal ── */}
      {selectedItem && (
        <BedDetail
          siteId={site.id!}
          item={selectedItem}
          pairItem={selectedItemIsPool ? null : (inventoryItems.find(i => i.id !== selectedItem.id && !!i.sunbedGroupId && i.sunbedGroupId === selectedItem.sunbedGroupId) ?? null)}
          accessKey={accessKey}
          isPool={selectedItemIsPool}
          onClose={() => { setSelectedItem(null); setSelectedItemIsPool(false) }}
          onPoolSeatRemoved={() => { setSelectedItem(null); setSelectedItemIsPool(false); router.refresh() }}
        />
      )}

      {/* ── Walk-in Rental Modal ── */}
      {showRentalModal && site.rentalItems && (
        <CreateRentalModal
          siteId={site.id!}
          rentalItems={site.rentalItems}
          activeBookings={site.rentalBookings}
          accessKey={accessKey}
          onClose={() => setShowRentalModal(false)}
          onCreated={() => {
            setShowRentalModal(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
