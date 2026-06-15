'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { InventoryItem, Reservation, RentalBookingProps, SiteProps } from '@/types/shared'
import Item from './Item'
import BedDetail from './BedDetail'
import RentalBookingCard from './RentalBookingCard'
import CreateRentalModal from './CreateRentalModal'
import {
  computeChunkSize, ROW_LABEL_WIDTH, groupExtraSeatLabel,
  buildDisplayColumns, chunkDisplayColumns, type DisplayColumn,
} from './grid-helpers'
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
const MANAGE_ZOOM_KEY = 'sunbnb-manage-zoom'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.25

// Fixed width (px) of the gap track BETWEEN groups in the SCROLL view.
const GROUP_GAP_PX = 14
// Narrower group separator in the SECTIONED view (cells are denser there).
const SECTION_GROUP_GAP_PX = 8

// Sectioned view fills the width with uniform 1fr seat cells, wrapping into
// stacked sections. SECTION_FIT_WIDTH is the target/min cell width used to decide
// how many columns fit per section; a short final section is padded so its cells
// match a full section's width rather than stretching.
const SECTION_FIT_WIDTH = 48

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

  // Always render — even when empty — so the add-seat button is always visible.
  // Separated from the mapped seats by a thin ruler (no tinted background, no title).
  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      {poolItems.length > 0 && (
        <div className="text-xs text-gray-400 mb-1.5 px-0.5 leading-none tabular-nums">
          {occupied}/{poolItems.length}
        </div>
      )}

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
  const [selectedItemIsGroupExtra, setSelectedItemIsGroupExtra] = useState(false)
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

  // Seat column order, per parcel — a parcel number in this set is reversed
  // (largest seat number on the left); default is ascending (smallest on the
  // left). Persisted per-site so a staff member's choice sticks per device.
  const [reversedParcels, setReversedParcels] = useState<Set<number>>(new Set())

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${SEAT_ORDER_REVERSED_KEY}-${site.id}`)
      if (stored) setReversedParcels(new Set(JSON.parse(stored) as number[]))
    } catch {
      /* ignore malformed value */
    }
  }, [site.id])

  const isParcelReversed = (parcel: number) => reversedParcels.has(parcel)

  const toggleParcelReversed = (parcel: number) => {
    setReversedParcels(prev => {
      const next = new Set(prev)
      if (next.has(parcel)) next.delete(parcel)
      else next.add(parcel)
      localStorage.setItem(`${SEAT_ORDER_REVERSED_KEY}-${site.id}`, JSON.stringify([...next]))
      return next
    })
  }

  // Zoom — initialised to 1 so SSR and first client render match,
  // then overridden from localStorage in useEffect (avoids hydration mismatch).
  // Stored per-site so each venue can have its own preferred zoom level.
  const [zoom, setZoom] = useState(1)

  // Mirror zoom into a ref so the wheel handler (registered once) always reads
  // the latest value without a stale closure. Updated in sync with setZoom.
  const zoomRef = useRef(1)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${MANAGE_ZOOM_KEY}-${site.id}`)
      if (stored !== null) {
        const v = parseFloat(stored)
        if (!isNaN(v)) {
          const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))
          setZoom(clamped)
          zoomRef.current = clamped
        }
      }
    } catch {
      /* ignore malformed value */
    }
  }, [site.id])

  const applyZoom = (next: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    zoomRef.current = clamped
    setZoom(clamped)
    try { localStorage.setItem(`${MANAGE_ZOOM_KEY}-${site.id}`, String(clamped)) } catch { /* ignore */ }
  }
  const zoomIn = () => applyZoom(Math.round((zoom + ZOOM_STEP) * 100) / 100)
  const zoomOut = () => applyZoom(Math.round((zoom - ZOOM_STEP) * 100) / 100)
  const resetZoom = () => applyZoom(1)

  // Measure the container width so we can compute how many bed columns fit.
  // ResizeObserver fires once immediately on observe() then on every resize/
  // orientation change — no separate window-resize listener needed.
  // Declared here (before the gesture handlers) so containerRef is in scope.
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

  // ── Trackpad pinch / ctrl+wheel zoom (desktop) ───────────────────────────────
  // Mac trackpad pinch-to-zoom and ctrl+wheel both arrive as a WheelEvent with
  // ctrlKey=true. We must attach via addEventListener with { passive: false } so
  // that e.preventDefault() actually suppresses the browser's native page zoom —
  // React's synthetic onWheel listener is always passive, making preventDefault
  // a no-op there (same reason SchematicRenderer uses this pattern).
  //
  // Stale-closure guard: the handler is registered once (empty deps) and reads
  // zoomRef.current, which applyZoom keeps in sync on every zoom change.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      // Only intercept ctrl+wheel / trackpad pinch; leave normal scroll alone
      if (!e.ctrlKey) return
      e.preventDefault()

      // Exponential factor: pinch-out → negative deltaY → factor > 1 → zoom in
      // Small constant (0.01) keeps trackpad deltas (typically 1–5) gentle.
      const factor = Math.exp(-e.deltaY * 0.01)
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomRef.current * factor))
      applyZoom(nextZoom)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — handler reads zoomRef, applyZoom is stable

  // ── Pinch-to-zoom (touch) ─────────────────────────────────────────────────────
  // Tracks all active pointer contacts in a Map (id → {x,y}). When two pointers
  // are live we compute a pinch ratio vs the initial distance and drive `zoom`.
  // Single-touch panning is left entirely to native browser scroll (touch-action:
  // pan-x pan-y on the scroll containers below). Matches the SchematicRenderer
  // ref-Map pattern to avoid re-renders on every pointermove.

  // Active pointers over the grid area (shared across both view modes)
  const pinchPointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  // State captured at the moment the second finger lands
  const pinchStart = useRef<{
    dist: number   // initial distance between the two pointers
    zoom: number   // zoom value at gesture start
  } | null>(null)

  const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pinchPointers.current.size === 2) {
      // Second finger landed — record the gesture baseline
      const pts = Array.from(pinchPointers.current.values())
      const p0 = pts[0]!
      const p1 = pts[1]!
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      pinchStart.current = { dist, zoom }
    }
  }

  const handleGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pinchPointers.current.has(e.pointerId)) return
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const ps = pinchStart.current
    if (!ps || pinchPointers.current.size < 2) return

    // Suppress native page pinch-zoom while a two-finger gesture is active
    e.preventDefault()

    const pts = Array.from(pinchPointers.current.values())
    const p0 = pts[0]!
    const p1 = pts[1]!
    const currentDist = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    const ratio = ps.dist > 0 ? currentDist / ps.dist : 1
    const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, ps.zoom * ratio))

    // Nudge the scroll container so the content under the fingers doesn't jump
    // wildly — a simple proportional adjustment, not pixel-perfect.
    if (nextZoom !== zoom) {
      const zoomRatio = nextZoom / zoom
      // Find the nearest horizontally-scrolling ancestor (scroll view containers)
      const scrollEl = (e.target as HTMLElement).closest<HTMLElement>('.overflow-x-auto')
      if (scrollEl) {
        scrollEl.scrollLeft = scrollEl.scrollLeft * zoomRatio
      }
    }

    applyZoom(nextZoom)
  }

  const handleGridPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pinchPointers.current.delete(e.pointerId)

    if (pinchPointers.current.size < 2) {
      // Pinch ended (one or zero fingers left) — clear the baseline
      pinchStart.current = null
    }
  }

  // ── Drag-to-pan for the scroll view (desktop mouse only) ──────────────────
  // Threshold prevents accidental panning on short taps. Each scroll container
  // gets its own ref; we share a single drag-state ref and attach identical
  // handlers per container. Touch scroll is left to the browser — touch pointer
  // events go to the pinch handler above instead.
  const dragState = useRef<{
    el: HTMLElement
    startX: number
    scrollLeft: number
    moved: boolean
  } | null>(null)

  const handleScrollPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const el = e.currentTarget
    dragState.current = { el, startX: e.clientX, scrollLeft: el.scrollLeft, moved: false }
    el.setPointerCapture(e.pointerId)
  }

  const handleScrollPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragState.current
    if (!ds || e.pointerType === 'touch') return
    const dx = e.clientX - ds.startX
    if (!ds.moved && Math.abs(dx) <= 5) return  // threshold — don't pan on micro-movements
    ds.moved = true
    ds.el.scrollLeft = ds.scrollLeft - dx
  }

  const handleScrollPointerUp = () => { dragState.current = null }

  // Default to 50 until measured — keeps all beds in a single section on the
  // first render, avoiding a visible layout jump on small sites.
  // Sectioned view uses constant-size cells (no zoom scaling); chunkSize is just
  // how many fixed-width cells fit the container, so each section row fills the
  // width and the remainder wraps to the next stacked section.
  const chunkSize = containerWidth > 0 ? computeChunkSize(containerWidth, { minBedWidth: SECTION_FIT_WIDTH }) : 50

  // Auto-refresh every 30 seconds so Carlos sees new bookings
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(interval)
  }, [router])

  const { inventoryItems = [] } = site

  // Pool seats (status='pool') are separated from the regular grid.
  // They are NOT counted in the headline occupancy summary — tracked only within
  // their own per-parcel section (product decision).
  //
  // Two flavours of pool seat:
  //   freePoolItems  — status='pool' && !sunbedGroupId → per-parcel strip (existing PoolSection)
  //   groupExtraItems — status='pool' && sunbedGroupId  → rendered inline with their group
  const freePoolItems = inventoryItems.filter(i => i.status === 'pool' && !i.sunbedGroupId)
  const groupExtraItems = inventoryItems.filter(i => i.status === 'pool' && !!i.sunbedGroupId)
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

  // Group FREE pool items by parcel (these go in the per-parcel PoolSection strip)
  const poolByParcel = freePoolItems.reduce((acc, item) => {
    const parcel = parseInt(String(item.number)[0]!, 10)
    if (!acc[parcel]) acc[parcel] = []
    acc[parcel].push(item)
    return acc
  }, {} as Record<number, InventoryItem[]>)

  // Group-extra pool seats render INLINE, clustered with their group's regular
  // members so the whole group reads as ONE tight cluster (like a pair, but N
  // members). Index extras by sunbedGroupId; at render time the group's
  // TRAILING regular member (the one drawn last in the current row direction)
  // becomes the anchor and the extras are emitted immediately after it — on the
  // cluster's outer edge. Sorted by seat number so they read left→right stably.
  const groupExtrasByGroupId = new Map<string, InventoryItem[]>()
  for (const extra of groupExtraItems) {
    if (!extra.sunbedGroupId) continue
    const list = groupExtrasByGroupId.get(extra.sunbedGroupId) ?? []
    list.push(extra)
    groupExtrasByGroupId.set(extra.sunbedGroupId, list)
  }
  for (const list of groupExtrasByGroupId.values()) {
    list.sort((a, b) => a.number - b.number)
  }

  // All OTHER members of an item's group (regular + extras) — for label derivation.
  const otherGroupMembers = (it: InventoryItem): InventoryItem[] =>
    it.sunbedGroupId
      ? inventoryItems.filter(i => i.id !== it.id && i.sunbedGroupId === it.sunbedGroupId)
      : []

  return (
    <div
      ref={containerRef}
      className="px-2 pt-2 pb-20 mx-auto w-full max-w-screen-lg"
      style={{ touchAction: 'pan-x pan-y' }}
      onPointerDown={handleGridPointerDown}
      onPointerMove={handleGridPointerMove}
      onPointerUp={handleGridPointerUp}
      onPointerCancel={handleGridPointerUp}
    >
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

        {/* ── Zoom + View Mode Controls ── */}
        <div className="col-span-2 flex items-center justify-end gap-2 sm:ml-auto">
          {/* Zoom control — "−  100%  +" — only meaningful in the scroll view;
              the sectioned view uses constant-size cells. */}
          {viewMode === 'scroll' && (
            <div className="flex rounded-lg overflow-hidden border border-gray-200 font-semibold">
              <button
                onClick={zoomOut}
                disabled={zoom <= ZOOM_MIN}
                aria-label={t('zoomOut')}
                title={t('zoomOut')}
                className="flex items-center justify-center px-3 min-h-[44px] text-sm transition-colors bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed"
              >
                −
              </button>
              <button
                onClick={resetZoom}
                aria-label={t('resetZoom')}
                title={t('resetZoom')}
                className="flex items-center justify-center px-2 min-h-[44px] text-xs font-semibold border-l border-gray-200 transition-colors bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50 tabular-nums min-w-[3.5rem]"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={zoomIn}
                disabled={zoom >= ZOOM_MAX}
                aria-label={t('zoomIn')}
                title={t('zoomIn')}
                className="flex items-center justify-center px-3 min-h-[44px] text-sm border-l border-gray-200 transition-colors bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
          )}

          {/* View mode toggle */}
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

        // ── Column-aligned layout (shared) ─────────────────────────────────────
        // Each seat position is a grid column shared by EVERY row. A group with
        // extra seats reserves additional columns after its trailing position;
        // those columns are global, so a column widened by one group widens for
        // all rows — groups with fewer seats just render empty space, keeping the
        // grid aligned in rows and columns.
        const reversed = isParcelReversed(parcelNum)
        const parcelPositions = Array.from(
          rowEntries.reduce<Set<number>>((s, [, positions]) => {
            Object.keys(positions).forEach(k => s.add(Number(k)))
            return s
          }, new Set())
        )
        // position → max extra count among groups whose trailing (highest) position is that position
        const extraSlotsAfter = new Map<number, number>()
        for (const [gid, extras] of groupExtrasByGroupId) {
          const members = regularItems.filter(r => r.sunbedGroupId === gid)
          if (members.length === 0) continue
          const parsed = members.map(m => parseSunbedNumber(m.number))
          if (parsed[0]!.parcel !== parcelNum) continue
          const trailingPos = Math.max(...parsed.map(p => p.position))
          extraSlotsAfter.set(trailingPos, Math.max(extraSlotsAfter.get(trailingPos) ?? 0, extras.length))
        }
        const displayColumns = buildDisplayColumns(parcelPositions, extraSlotsAfter, reversed)

        // Resolve a seat/extra display column to what THIS row renders in it.
        // ('gap' columns are rendered directly in the markup, not here.)
        type ResolvedCell =
          | { kind: 'seat'; item: InventoryItem }
          | { kind: 'extra'; item: InventoryItem; label: string }
          | { kind: 'empty' }
        const resolveColumn = (col: DisplayColumn, positions: Record<number, InventoryItem>): ResolvedCell => {
          if (col.kind === 'gap' || col.kind === 'pad') return { kind: 'empty' }
          if (col.kind === 'pos') {
            const item = positions[col.pos]
            return item ? { kind: 'seat', item } : { kind: 'empty' }
          }
          // Extra column: this row fills it only if the seat at afterPos is its
          // group's trailing member AND the group has a slot-th extra.
          const trailing = positions[col.afterPos]
          const gid = trailing?.sunbedGroupId
          if (!trailing || !gid) return { kind: 'empty' }
          const members = regularItems.filter(r => r.sunbedGroupId === gid)
          const trailingPos = Math.max(...members.map(m => parseSunbedNumber(m.number).position))
          if (trailingPos !== col.afterPos) return { kind: 'empty' }
          const groupExtras = groupExtrasByGroupId.get(gid) ?? []
          const extra = groupExtras[col.slot]
          if (!extra) return { kind: 'empty' }
          return { kind: 'extra', item: extra, label: groupExtraSeatLabel(extra, otherGroupMembers(extra)) }
        }

        // ── Horizontal-scroll view ────────────────────────────────────────────
        if (viewMode === 'scroll') {
          return (
            <div key={parcel} className="mb-5">
              <div className="flex items-center gap-2 mb-2 px-1">
                <h2 className="text-base sm:text-lg font-bold">
                  {t('parcel', { n: parcel })}
                </h2>
                <button
                  onClick={() => toggleParcelReversed(parcelNum)}
                  aria-label={t('reverseOrder')}
                  aria-pressed={isParcelReversed(parcelNum)}
                  title={t('reverseOrder')}
                  className={`
                    flex items-center gap-1 px-2 min-h-[32px] text-xs rounded-md border font-semibold transition-colors
                    ${isParcelReversed(parcelNum)
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-400 border-gray-200 hover:text-gray-700 hover:bg-gray-50'}
                  `}
                >
                  <span aria-hidden="true">⇄</span>
                  <span className="hidden sm:inline">{t('reverseOrder')}</span>
                </button>
              </div>

              {/* Single scroll container — all rows stay aligned while scrolling.
                  Drag-to-pan on desktop; one-finger pan on touch via native
                  browser scroll (touch-action: pan-x pan-y lets the browser
                  handle single-touch; two-finger pinch is handled by the
                  outer container's pointer handlers above). */}
              <div
                className={`overflow-x-auto select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${zoom !== 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{ touchAction: 'pan-x pan-y' }}
                onPointerDown={handleScrollPointerDown}
                onPointerMove={handleScrollPointerMove}
                onPointerUp={handleScrollPointerUp}
                onPointerLeave={handleScrollPointerUp}
              >
                {/* CSS zoom scales the rendered content; the overflow container then
                    reports the scaled scrollWidth so panning the container works
                    correctly. Sticky left-0 row labels pin within the zoom frame. */}
                <div style={{ zoom }}>
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
                          the scroll container widens instead. Every row renders the
                          SAME display columns (incl. global extra columns + empty
                          spacers) so seats stay aligned in rows and columns. */}
                      {displayColumns.map((col, colIdx) => {
                        if (col.kind === 'gap') {
                          return <div key={`g${colIdx}`} className="flex-shrink-0" style={{ width: GROUP_GAP_PX }} />
                        }
                        if (col.kind === 'pad') return null // pads exist only in the sectioned view
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
                                siteId={site.id!}
                                item={resolved.item}
                                onSelect={() => { setSelectedItem(resolved.item); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(false) }}
                              />
                            </div>
                          )
                        }
                        const extraState = getBedState(resolved.item)
                        return (
                          <div
                            key={key}
                            className="flex-shrink-0"
                            style={{ width: 48 }}
                          >
                            <button
                              onClick={() => { setSelectedItem(resolved.item); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(true) }}
                              className={`
                                ${POOL_STATE_STYLES[extraState]} border-2 rounded-lg
                                w-full min-h-[44px]
                                py-2 px-0.5 flex flex-col items-center justify-center
                                active:brightness-90 transition-colors select-none
                              `}
                              title={`Seat ${resolved.label}`}
                            >
                              {POOL_ICONS[extraState] && <span className="text-[10px] leading-none">{POOL_ICONS[extraState]}</span>}
                              <span className="text-[10px] leading-none opacity-70">{resolved.label}</span>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
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
        const sections = chunkDisplayColumns(displayColumns, chunkSize)

        return (
          <div key={parcel} className="mb-5">
            <div className="flex items-center gap-2 mb-2 px-1">
              <h2 className="text-base sm:text-lg font-bold">
                {t('parcel', { n: parcel })}
              </h2>
              <button
                onClick={() => toggleParcelReversed(parcelNum)}
                aria-label={t('reverseOrder')}
                aria-pressed={isParcelReversed(parcelNum)}
                title={t('reverseOrder')}
                className={`
                  flex items-center gap-1 px-2 min-h-[32px] text-xs rounded-md border font-semibold transition-colors
                  ${isParcelReversed(parcelNum)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-400 border-gray-200 hover:text-gray-700 hover:bg-gray-50'}
                `}
              >
                <span aria-hidden="true">⇄</span>
                <span className="hidden sm:inline">{t('reverseOrder')}</span>
              </button>
            </div>

            {sections.map((section, sectionIdx) => (
              <div key={sectionIdx} className={sectionIdx > 0 ? 'mt-4' : ''}>
                {/* Section span header — only when the parcel has multiple sections */}
                {sections.length > 1 && (
                  <div className="text-xs text-gray-400 font-semibold mb-1 px-1 tabular-nums tracking-wide">
                    {section.minPos}–{section.maxPos}
                  </div>
                )}

                {/* Row strips — every row renders the SAME display columns, so
                    seats line up in rows and columns. A column reserved for a
                    group's extra seat exists in every row; rows whose group has
                    no seat there render empty space. */}
                {rowEntries.map(([rowNum, positions]) => (
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

                    <div
                      className="flex-1 grid gap-1"
                      style={{
                        gridTemplateColumns: section.columns
                          .map(c => (c.kind === 'gap' ? `${SECTION_GROUP_GAP_PX}px` : 'minmax(0, 1fr)'))
                          .join(' '),
                      }}
                    >
                      {section.columns.map((col, colIdx) => {
                        if (col.kind === 'gap') return <div key={`g${colIdx}`} />
                        if (col.kind === 'pad') return <div key={`pad${colIdx}`} className="min-h-[44px]" />
                        const key = col.kind === 'pos' ? `p${col.pos}` : `x${col.afterPos}-${col.slot}`
                        const resolved = resolveColumn(col, positions)
                        if (resolved.kind === 'empty') {
                          return <div key={key} className="min-h-[44px]" />
                        }
                        if (resolved.kind === 'seat') {
                          return (
                            <Item
                              key={key}
                              siteId={site.id!}
                              item={resolved.item}
                              onSelect={() => { setSelectedItem(resolved.item); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(false) }}
                            />
                          )
                        }
                        // Group-extra seat — a full-width cell like any other.
                        const extraState = getBedState(resolved.item)
                        return (
                          <button
                            key={key}
                            onClick={() => { setSelectedItem(resolved.item); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(true) }}
                            className={`
                              ${POOL_STATE_STYLES[extraState]} border-2 rounded-lg
                              min-w-0 min-h-[44px]
                              py-2 sm:py-3 px-0.5 flex flex-col items-center justify-center
                              active:brightness-90 transition-colors select-none
                            `}
                            title={`Seat ${resolved.label}`}
                          >
                            {POOL_ICONS[extraState] && <span className="text-[10px] leading-none">{POOL_ICONS[extraState]}</span>}
                            <span className="text-[10px] leading-none opacity-70">{resolved.label}</span>
                          </button>
                        )
                      })}
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
          groupItems={
            selectedItem.sunbedGroupId
              ? inventoryItems.filter(i => i.id !== selectedItem.id && i.sunbedGroupId === selectedItem.sunbedGroupId)
              : []
          }
          accessKey={accessKey}
          isPool={selectedItemIsPool}
          isGroupExtra={selectedItemIsGroupExtra}
          onClose={() => { setSelectedItem(null); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(false) }}
          onPoolSeatRemoved={() => { setSelectedItem(null); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(false); router.refresh() }}
          onGroupSeatAdded={() => { router.refresh() }}
          onGroupSeatRemoved={() => { setSelectedItem(null); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(false); router.refresh() }}
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
