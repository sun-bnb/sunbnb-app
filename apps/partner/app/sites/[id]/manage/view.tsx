'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { InventoryItem, SiteProps } from '@/types/shared'
import BedDetail from './BedDetail'
import CreateRentalModal from './CreateRentalModal'
import ManageToolbar, { type ManageViewKey } from './ManageToolbar'
import ParcelView from './ParcelView'
import RentalsSection from './RentalsSection'
import { getActiveReservation, getBedState, type BedState } from './bed-state'
import { moveReservationToSeats } from './actions'

function parseSunbedNumber(num: number) {
  const str = String(num)
  const parcel = parseInt(str[0]!, 10)
  const row = parseInt(str.substring(1, 3), 10)
  const position = parseInt(str.substring(3), 10)
  return { parcel, row, position }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SEAT_ORDER_REVERSED_KEY = 'sunbnb-manage-seat-order-reversed'
const DARK_MODE_KEY = 'sunbnb-manage-dark'

// Scale floor is intentionally low so even very wide parcels fit fully in view;
// chair labels auto-hide below DETAIL_HIDE_BELOW (ParcelView), so far-out zoom
// reads as plain colored blocks for orientation. The view opens fit-to-width.
const ZOOM_MIN = 0.1
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.25
const TAP_THRESHOLD = 6 // px of pointer travel before a gesture counts as pan, not tap

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

  // ── Move mode (tap-to-move / Cambio de Lugar) ─────────────────────────────
  // When set, the next free seat tapped becomes the relocation destination for
  // this reservation (instead of opening the bed-detail sheet). `count` is how
  // many seats the booking occupies — the destination must match.
  const [movingRes, setMovingRes] = useState<{ id: string; count: number } | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [, startMoveTransition] = useTransition()

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

  // ── Pan / zoom canvas ───────────────────────────────────────────────────────
  // The whole parcel view is ONE transformable surface. Content is positioned
  // with `transform: translate(tx,ty) scale(scale)` (origin top-left) inside a
  // clipping viewport; pinch / drag / wheel drive scale+pan directly. No CSS
  // `zoom` (non-standard — scaled min-sizes inconsistently on mobile) and no
  // native scroll container, so pinch works anywhere on the visible view and
  // every cell (incl. pool seats) scales uniformly across mobile/desktop.
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const scaleRef = useRef(1)
  const txRef = useRef(0)
  const tyRef = useRef(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentSizeRef = useRef({ w: 0, h: 0 })

  function measureContent() {
    const content = viewportRef.current?.querySelector<HTMLElement>('.parcel-canvas-content')
    if (content) contentSizeRef.current = { w: content.offsetWidth, h: content.offsetHeight }
  }

  // Clamp one axis. When the (scaled) content fits the viewport, rest it at the
  // `align` anchor ('center' or 'start'=top/left); otherwise keep its edges flush
  // so empty space can't be dragged into view. Vertical uses 'start' so a short
  // parcel sits at the top rather than floating in the middle.
  function clampAxis(t: number, contentScaled: number, viewport: number, align: 'center' | 'start' = 'center') {
    if (contentScaled <= viewport) return align === 'start' ? 0 : Math.round((viewport - contentScaled) / 2)
    return Math.min(0, Math.max(viewport - contentScaled, t))
  }

  function commit(nextScale: number, nextTx: number, nextTy: number) {
    const vp = viewportRef.current
    const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale))
    const { w: cw, h: ch } = contentSizeRef.current
    const vw = vp?.clientWidth ?? 0
    const vh = vp?.clientHeight ?? 0
    const ctx = cw && vw ? clampAxis(nextTx, cw * s, vw) : nextTx
    const cty = ch && vh ? clampAxis(nextTy, ch * s, vh, 'start') : nextTy
    scaleRef.current = s; txRef.current = ctx; tyRef.current = cty
    setScale(s); setTx(ctx); setTy(cty)
  }

  // Zoom keeping a focal point (cursor / pinch midpoint, in viewport coords) fixed.
  function zoomAround(focalX: number, focalY: number, nextScale: number) {
    const s0 = scaleRef.current
    const s1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale))
    const cx = (focalX - txRef.current) / s0
    const cy = (focalY - tyRef.current) / s0
    commit(s1, focalX - cx * s1, focalY - cy * s1)
  }

  function fitToView() {
    measureContent()
    const vp = viewportRef.current
    const { w: cw } = contentSizeRef.current
    if (!vp || !cw) return
    const fit = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, vp.clientWidth / cw))
    commit(fit, 0, 0) // clampAxis centers
  }

  function toLocal(clientX: number, clientY: number) {
    const r = viewportRef.current?.getBoundingClientRect()
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) }
  }

  // Active pointers + gesture baselines. wasPannedRef tells the seat cells to
  // ignore the click that follows a drag/pinch (so panning never selects a seat).
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ startDist: number; startScale: number; cx: number; cy: number } | null>(null)
  const panLast = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(0)
  const wasPannedRef = useRef(false)

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    wasPannedRef.current = false
    movedRef.current = 0
    if (pointers.current.size === 1) {
      panLast.current = { x: e.clientX, y: e.clientY }
      pinchRef.current = null
    } else if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values())
      const p0 = pts[0]!, p1 = pts[1]!
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1
      const mid = toLocal((p0.x + p1.x) / 2, (p0.y + p1.y) / 2)
      const s0 = scaleRef.current
      pinchRef.current = { startDist: dist, startScale: s0, cx: (mid.x - txRef.current) / s0, cy: (mid.y - tyRef.current) / s0 }
      panLast.current = null
    }
  }

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pinch = pinchRef.current
    if (pinch && pointers.current.size >= 2) {
      e.preventDefault()
      const pts = Array.from(pointers.current.values())
      const p0 = pts[0]!, p1 = pts[1]!
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      const mid = toLocal((p0.x + p1.x) / 2, (p0.y + p1.y) / 2)
      const s1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.startScale * (dist / pinch.startDist)))
      wasPannedRef.current = true
      commit(s1, mid.x - pinch.cx * s1, mid.y - pinch.cy * s1)
    } else if (panLast.current && pointers.current.size === 1) {
      const dx = e.clientX - panLast.current.x
      const dy = e.clientY - panLast.current.y
      panLast.current = { x: e.clientX, y: e.clientY }
      movedRef.current += Math.abs(dx) + Math.abs(dy)
      if (movedRef.current > TAP_THRESHOLD) wasPannedRef.current = true
      commit(scaleRef.current, txRef.current + dx, tyRef.current + dy)
    }
  }

  const onCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchRef.current = null
    if (pointers.current.size === 0) {
      panLast.current = null
    } else {
      const p = Array.from(pointers.current.values())[0]!
      panLast.current = { x: p.x, y: p.y }
    }
  }

  const viewportCenter = () => {
    const vp = viewportRef.current
    return { x: (vp?.clientWidth ?? 0) / 2, y: (vp?.clientHeight ?? 0) / 2 }
  }
  const zoomIn = () => { const c = viewportCenter(); zoomAround(c.x, c.y, scaleRef.current + ZOOM_STEP) }
  const zoomOut = () => { const c = viewportCenter(); zoomAround(c.x, c.y, scaleRef.current - ZOOM_STEP) }
  const resetZoom = () => fitToView()

  // Re-measure + re-clamp on viewport resize (keeps content in view, recenters
  // when it now fits).
  useEffect(() => {
    const onResize = () => { measureContent(); commit(scaleRef.current, txRef.current, tyRef.current) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // ── Move-mode handlers ────────────────────────────────────────────────────
  // Enter move mode for a reservation: count how many seats it occupies (the
  // destination must match), then close the detail sheet.
  const handleStartMove = (reservationId: string) => {
    const count = inventoryItems.filter(i => getActiveReservation(i)?.id === reservationId).length || 1
    setMoveError(null)
    setMovingRes({ id: reservationId, count })
    setSelectedItem(null)
    setSelectedItemIsPool(false)
    setSelectedItemIsGroupExtra(false)
  }

  // A tap while in move mode → resolve the destination seat(s) and relocate.
  const handleMoveDestination = (item: InventoryItem) => {
    if (!movingRes) return
    setMoveError(null)
    if (getBedState(item) !== 'available') { setMoveError(t('moveDestOccupied')); return }

    let destIds: string[]
    if (movingRes.count === 1) {
      destIds = [item.id]
    } else {
      // N-seat booking → needs a fully-free group of the same size. Include the
      // group's EXTRA (pool) members: a group booking's footprint counts them, so
      // the destination group must too (e.g. a "group of 3" = 2 active + 1 extra).
      const grp = item.sunbedGroupId
        ? inventoryItems.filter(i => i.sunbedGroupId === item.sunbedGroupId)
        : []
      const allFree = grp.length > 0 && grp.every(i => getBedState(i) === 'available')
      if (grp.length !== movingRes.count || !allFree) {
        setMoveError(t('moveDestSize', { n: movingRes.count }))
        return
      }
      destIds = grp.map(i => i.id)
    }

    const resId = movingRes.id
    startMoveTransition(async () => {
      const res = await moveReservationToSeats(site.id!, resId, destIds, accessKey)
      if (res.status === 'ok') {
        setMovingRes(null)
        router.refresh()
      } else {
        setMoveError(res.errors?.[0] || 'Move failed')
      }
    })
  }

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

  // Open each parcel fit-to-width + centered (rAF so the new content is laid out
  // before we measure). The keyed ParcelView remounts per parcel, so this fires
  // on every switch.
  useEffect(() => {
    if (showRentals) return
    const id = requestAnimationFrame(fitToView)
    return () => cancelAnimationFrame(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveParcel, showRentals])

  // Wheel zoom (ctrl/⌘ or trackpad-pinch → zoom to cursor; plain wheel → pan).
  // Non-passive so preventDefault works; re-attached when the viewport mounts.
  useEffect(() => {
    const el = viewportRef.current
    if (!el || showRentals) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const { x, y } = toLocal(e.clientX, e.clientY)
        zoomAround(x, y, scaleRef.current * Math.exp(-e.deltaY * 0.01))
      } else {
        commit(scaleRef.current, txRef.current - e.deltaX, tyRef.current - e.deltaY)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveParcel, showRentals])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={`flex flex-col h-[100dvh] overflow-hidden px-2 pt-2 mx-auto w-full max-w-screen-lg transition-colors dark:bg-gray-950 dark:text-gray-100 ${isDark ? 'dark' : ''}`}
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
          zoom={scale}
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

      {/* Move-mode banner — tap a free seat to relocate the picked reservation */}
      {movingRes && (
        <div className="mb-2 px-3 py-2 rounded-xl border-2 border-blue-300 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">
              {movingRes.count > 1 ? t('movePromptGroup', { n: movingRes.count }) : t('movePrompt')}
            </span>
            <button
              type="button"
              onClick={() => { setMovingRes(null); setMoveError(null) }}
              className="flex-shrink-0 px-3 min-h-[36px] rounded-lg border border-blue-300 dark:border-blue-700 active:bg-blue-100 dark:active:bg-blue-900/40 font-semibold"
            >
              {t('moveCancel')}
            </button>
          </div>
          {moveError && <div className="mt-1 text-red-600 dark:text-red-400">{moveError}</div>}
        </div>
      )}

      {/* One destination at a time — the selected parcel (pan/zoom canvas), or
          the rentals view (normal vertical scroll). */}
      {showRentals ? (
        <div className="flex-1 overflow-y-auto">
          <RentalsSection
            siteId={site.id!}
            accessKey={accessKey}
            rentalBookings={site.rentalBookings}
            onRentOut={() => setShowRentalModal(true)}
          />
        </div>
      ) : effectiveParcel !== undefined ? (
        <div
          ref={viewportRef}
          className="flex-1 relative overflow-hidden touch-none select-none"
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          onPointerLeave={onCanvasPointerUp}
        >
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
            scale={scale}
            tx={tx}
            ty={ty}
            wasPannedRef={wasPannedRef}
            onSelectItem={(item, isPool, isGroupExtra) => {
              if (movingRes) { handleMoveDestination(item); return }
              setSelectedItem(item)
              setSelectedItemIsPool(isPool)
              setSelectedItemIsGroupExtra(isGroupExtra)
            }}
          />
        </div>
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
          onMove={handleStartMove}
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
