'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { InventoryItem, Reservation, RentalBookingProps, SiteProps } from '@/types/shared'
import Item from './Item'
import BedDetail from './BedDetail'
import RentalBookingCard from './RentalBookingCard'
import CreateRentalModal from './CreateRentalModal'
import { computeChunkSize, chunkRows, ROW_LABEL_WIDTH } from './grid-helpers'
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

const VIEW_MODE_KEY = 'sunbnb-manage-view'

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
  const [showRentalModal, setShowRentalModal] = useState(false)

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
  const activeItems = inventoryItems.filter(i => i.status !== 'disabled')

  // Compute summary counts
  const summary = activeItems.reduce((acc, item) => {
    const state = getBedState(item)
    acc[state] = (acc[state] || 0) + 1
    return acc
  }, {} as Record<BedState, number>)

  const total = activeItems.length
  const occupied = (summary['checked-in'] || 0) + (summary['walked-in'] || 0)

  // Group by parcel → row → position (all items, including disabled — Item.tsx renders
  // disabled items as spacers so row geometry is preserved)
  const grouped = inventoryItems.reduce((acc, item) => {
    const { parcel, row, position } = parseSunbedNumber(item.number)
    if (!acc[parcel]) acc[parcel] = {}
    if (!acc[parcel][row]) acc[parcel][row] = {}
    acc[parcel][row][position] = item
    return acc
  }, {} as Record<number, Record<number, Record<number, InventoryItem>>>)

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
        <div className="col-span-2 flex justify-end sm:ml-auto">
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
        // Sort row entries by row number (ascending = front row first)
        const rowEntries: [number, Record<number, InventoryItem>][] = Object.entries(rows)
          .map(([rowStr, positions]) => [Number(rowStr), positions] as [number, Record<number, InventoryItem>])
          .sort(([a], [b]) => a - b)

        // ── Horizontal-scroll view ────────────────────────────────────────────
        if (viewMode === 'scroll') {
          // Collect all positions across every row, sorted DESCENDING (same
          // display order as sectioned view: largest position on the left).
          const allPositions = Array.from(
            rowEntries.reduce<Set<number>>((s, [, positions]) => {
              Object.keys(positions).forEach(k => s.add(Number(k)))
              return s
            }, new Set())
          ).sort((a, b) => b - a)

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
                            onSelect={() => setSelectedItem(item)}
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
            </div>
          )
        }

        // ── Sectioned view (default) ──────────────────────────────────────────
        const sections = chunkRows(rowEntries, chunkSize)

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
                            onSelect={() => setSelectedItem(item)}
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
          accessKey={accessKey}
          onClose={() => setSelectedItem(null)}
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
