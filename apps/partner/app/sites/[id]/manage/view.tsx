'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { InventoryItem, SiteProps } from '@/types/shared'
import BedDetail from './BedDetail'
import CreateRentalModal from './CreateRentalModal'
import ManageToolbar, { type ManageViewKey } from './ManageToolbar'
import ParcelView from './ParcelView'
import RentalsSection from './RentalsSection'
import { getBedState, type BedState } from './bed-state'

function parseSunbedNumber(num: number) {
  const str = String(num)
  const parcel = parseInt(str[0]!, 10)
  const row = parseInt(str.substring(1, 3), 10)
  const position = parseInt(str.substring(3), 10)
  return { parcel, row, position }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SEAT_ORDER_REVERSED_KEY = 'sunbnb-manage-seat-order-reversed'
const MANAGE_ZOOM_KEY = 'sunbnb-manage-zoom'
const DARK_MODE_KEY = 'sunbnb-manage-dark'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.25

// ── ManageView ────────────────────────────────────────────────────────────────

export default function ManageView({
  site,
  accessKey,
}: {
  site: SiteProps
  accessKey: string
}) {
  const router = useRouter()
  const t = useTranslations('SiteManage')

  // ── Dark mode ─────────────────────────────────────────────────────────────
  // Default false so SSR/first render matches (no hydration mismatch).
  // Overridden from localStorage in a mount useEffect, same pattern as zoom.
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(DARK_MODE_KEY) === '1') setIsDark(true)
    } catch { /* ignore */ }
  }, [])

  const toggleDark = () => {
    setIsDark(prev => {
      const next = !prev
      try { localStorage.setItem(DARK_MODE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  // Extend the body background to cover the area outside the max-w-screen-lg container.
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = isDark ? '#0a0a0a' : ''
    return () => { document.body.style.backgroundColor = prev }
  }, [isDark])

  // ── Selection state ───────────────────────────────────────────────────────
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [selectedItemIsPool, setSelectedItemIsPool] = useState(false)
  const [selectedItemIsGroupExtra, setSelectedItemIsGroupExtra] = useState(false)
  const [showRentalModal, setShowRentalModal] = useState(false)

  // ── View switcher — one destination (parcel / rentals) at a time ──────────
  // Default to the lowest parcel number; fall back to rentals if the site has
  // no regular seats. Derived from props so it's correct on first render.
  const defaultParcel = (() => {
    const nums = [...new Set(
      (site.inventoryItems ?? [])
        .filter(i => i.status !== 'pool')
        .map(i => parseInt(String(i.number)[0]!, 10))
    )].sort((a, b) => a - b)
    return nums[0]
  })()

  const [selectedView, setSelectedView] = useState<ManageViewKey>(defaultParcel ?? 'rentals')
  // Remember the last parcel viewed so the floating rentals/parcels toggle can
  // return the user to where they were, not always the first parcel.
  const [lastParcel, setLastParcel] = useState<number | undefined>(defaultParcel)

  const selectView = (view: ManageViewKey) => {
    if (typeof view === 'number') setLastParcel(view)
    setSelectedView(view)
  }

  // ── Per-parcel reverse-order toggle ──────────────────────────────────────
  // A parcel number in this set is reversed (largest seat on the left).
  // Persisted per-site so staff choice sticks per device.
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

  // ── Zoom state ────────────────────────────────────────────────────────────
  // Initialised to 1 so SSR and first client render match; overridden from
  // localStorage in useEffect. zoomRef mirrors zoom so the wheel handler
  // (registered once) always reads the latest value without a stale closure.
  const [zoom, setZoom] = useState(1)
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
  const zoomIn  = () => applyZoom(Math.round((zoom + ZOOM_STEP) * 100) / 100)
  const zoomOut = () => applyZoom(Math.round((zoom - ZOOM_STEP) * 100) / 100)
  const resetZoom = () => applyZoom(1)

  // ── Trackpad pinch / ctrl+wheel zoom (desktop) ────────────────────────────
  // Must be registered as a non-passive listener so preventDefault() works.
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.01)
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomRef.current * factor))
      applyZoom(nextZoom)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — handler reads zoomRef, applyZoom is stable

  // ── Two-finger pinch-to-zoom (touch) ─────────────────────────────────────
  const pinchPointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null)

  const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinchPointers.current.size === 2) {
      const pts = Array.from(pinchPointers.current.values())
      const p0 = pts[0]!
      const p1 = pts[1]!
      pinchStart.current = { dist: Math.hypot(p1.x - p0.x, p1.y - p0.y), zoom }
    }
  }

  const handleGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pinchPointers.current.has(e.pointerId)) return
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const ps = pinchStart.current
    if (!ps || pinchPointers.current.size < 2) return
    e.preventDefault()
    const pts = Array.from(pinchPointers.current.values())
    const p0 = pts[0]!
    const p1 = pts[1]!
    const currentDist = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    const ratio = ps.dist > 0 ? currentDist / ps.dist : 1
    const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, ps.zoom * ratio))
    // Nudge scroll container so content under the fingers doesn't jump.
    // The pinch handler finds the scroll container via .overflow-x-auto — this
    // class is on each ParcelView's scroll div, matching the original behaviour.
    if (nextZoom !== zoom) {
      const zoomRatio = nextZoom / zoom
      const scrollEl = (e.target as HTMLElement).closest<HTMLElement>('.overflow-x-auto')
      if (scrollEl) scrollEl.scrollLeft = scrollEl.scrollLeft * zoomRatio
    }
    applyZoom(nextZoom)
  }

  const handleGridPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pinchPointers.current.delete(e.pointerId)
    if (pinchPointers.current.size < 2) pinchStart.current = null
  }

  // ── Drag-to-pan (desktop mouse) ───────────────────────────────────────────
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
    if (!ds.moved && Math.abs(dx) <= 5) return
    ds.moved = true
    ds.el.scrollLeft = ds.scrollLeft - dx
  }

  const handleScrollPointerUp = () => { dragState.current = null }

  // ── Auto-refresh every 30 seconds ────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(interval)
  }, [router])

  // ── Inventory grouping ────────────────────────────────────────────────────
  const { inventoryItems = [] } = site

  const freePoolItems   = inventoryItems.filter(i => i.status === 'pool' && !i.sunbedGroupId)
  const groupExtraItems = inventoryItems.filter(i => i.status === 'pool' && !!i.sunbedGroupId)
  const regularItems    = inventoryItems.filter(i => i.status !== 'pool')
  const activeItems     = regularItems.filter(i => i.status !== 'disabled')

  // Summary counts for the toolbar (regular seats only)
  const summary = activeItems.reduce((acc, item) => {
    const state = getBedState(item)
    acc[state] = (acc[state] || 0) + 1
    return acc
  }, {} as Record<BedState, number>)

  const occupied = (summary['checked-in'] || 0) + (summary['walked-in'] || 0)

  // Group-extra pool seats by sunbedGroupId
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

  // Group regular items by parcel
  const regularByParcel = regularItems.reduce((acc, item) => {
    const { parcel } = parseSunbedNumber(item.number)
    if (!acc[parcel]) acc[parcel] = []
    acc[parcel]!.push(item)
    return acc
  }, {} as Record<number, InventoryItem[]>)

  // Free pool items by parcel
  const poolByParcel = freePoolItems.reduce((acc, item) => {
    const parcel = parseInt(String(item.number)[0]!, 10)
    if (!acc[parcel]) acc[parcel] = []
    acc[parcel]!.push(item)
    return acc
  }, {} as Record<number, InventoryItem[]>)

  // Sorted parcel numbers
  const parcelNums = Object.keys(regularByParcel).map(Number).sort((a, b) => a - b)

  // ── Resolve the visible destination from the switcher selection ───────────
  const hasRentals = !!site.features?.includes('rentals')
  const showRentals = selectedView === 'rentals' && hasRentals
  // The parcel to render: the selected one if it still exists, else the first.
  const effectiveParcel = !showRentals
    ? (typeof selectedView === 'number' && parcelNums.includes(selectedView)
        ? selectedView
        : parcelNums[0])
    : undefined
  // Where the floating toggle returns to from the rentals view: the last parcel
  // viewed if it still exists, else the first.
  const backParcel = (lastParcel !== undefined && parcelNums.includes(lastParcel))
    ? lastParcel
    : parcelNums[0]
  // The floating rentals/parcels toggle only makes sense when both destinations
  // exist (rentals feature on AND at least one parcel to return to).
  const showRentalsFab = hasRentals && parcelNums.length > 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className={`px-2 pt-2 pb-20 mx-auto w-full max-w-screen-lg transition-colors dark:bg-gray-950 dark:text-gray-100 ${isDark ? 'dark' : ''}`}
      style={{ touchAction: 'pan-x pan-y' }}
      onPointerDown={handleGridPointerDown}
      onPointerMove={handleGridPointerMove}
      onPointerUp={handleGridPointerUp}
      onPointerCancel={handleGridPointerUp}
    >
      {/* Header — parcel toolbar (stats / zoom / parcel tabs) in a parcel view;
          a minimal placeholder title in the rentals view. */}
      {showRentals ? (
        <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xl">🏄</span>
            <span className="text-base font-bold text-gray-900 dark:text-gray-100">{t('rentals')}</span>
          </div>
          <button
            type="button"
            onClick={toggleDark}
            aria-label={t('toggleTheme')}
            aria-pressed={isDark}
            title={t('toggleTheme')}
            className="flex items-center justify-center px-3 min-h-[36px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-semibold"
          >
            <span aria-hidden="true">{isDark ? '☀' : '☾'}</span>
          </button>
        </div>
      ) : (
        <ManageToolbar
          summary={summary}
          occupied={occupied}
          parcelNums={parcelNums}
          selectedView={selectedView}
          onSelectView={selectView}
          zoom={zoom}
          zoomMin={ZOOM_MIN}
          zoomMax={ZOOM_MAX}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          isReversed={effectiveParcel !== undefined && isParcelReversed(effectiveParcel)}
          onToggleReversed={() => { if (effectiveParcel !== undefined) toggleParcelReversed(effectiveParcel) }}
          isDark={isDark}
          onToggleDark={toggleDark}
        />
      )}

      {/* One destination at a time — the selected parcel, or the rentals view */}
      {showRentals ? (
        <RentalsSection
          siteId={site.id!}
          accessKey={accessKey}
          rentalBookings={site.rentalBookings}
          onRentOut={() => setShowRentalModal(true)}
        />
      ) : effectiveParcel !== undefined ? (
        <ParcelView
          key={effectiveParcel}
          siteId={site.id!}
          accessKey={accessKey}
          parcelNum={effectiveParcel}
          regularItems={regularByParcel[effectiveParcel] ?? []}
          allRegularItems={regularItems}
          groupExtrasByGroupId={groupExtrasByGroupId}
          poolItems={poolByParcel[effectiveParcel] ?? []}
          allInventoryItems={inventoryItems}
          isParcelReversed={isParcelReversed(effectiveParcel)}
          zoom={zoom}
          onSelectItem={(item, isPool, isGroupExtra) => {
            setSelectedItem(item)
            setSelectedItemIsPool(isPool)
            setSelectedItemIsGroupExtra(isGroupExtra)
          }}
          onScrollPointerDown={handleScrollPointerDown}
          onScrollPointerMove={handleScrollPointerMove}
          onScrollPointerUp={handleScrollPointerUp}
        />
      ) : null}

      {/* Floating rentals ⇄ parcels toggle — always visible, bottom-right.
          Shows the destination it switches to: 🏄 from a parcel, ⛱️ from rentals. */}
      {showRentalsFab && (
        <button
          type="button"
          onClick={() => selectView(showRentals ? backParcel! : 'rentals')}
          aria-label={showRentals ? t('parcel', { n: '' }).trim() : t('rentals')}
          title={showRentals ? t('parcel', { n: '' }).trim() : t('rentals')}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-accent dark:bg-gray-700 text-white text-2xl shadow-lg flex items-center justify-center hover:bg-accent-hover dark:hover:bg-gray-600 active:scale-95 transition select-none"
        >
          <span aria-hidden="true">{showRentals ? '⛱️' : '🏄'}</span>
        </button>
      )}

      {/* Bed detail modal */}
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

      {/* Walk-in rental modal */}
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
