'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import { InventoryItem, SiteProps } from '@/types/shared'
import BedDetail from './BedDetail'
import CreateRentalModal from './CreateRentalModal'
import ManageToolbar, { type ManageViewKey } from './ManageToolbar'
import ParcelView from './ParcelView'
import RentalsSection from './RentalsSection'
import { getActiveReservation, getBedState, isFailedReservationStatus, type BedState } from './bed-state'
import {
  moveReservationToSeats,
  blockBed, compBed, holdBed, reserveItem, convertHoldToWalkIn,
  unblockBed, uncompBed, releaseHold, unreserveItem, removeFailedReservation,
  checkInReservation, markNoShow, markDeparted, cancelReservation,
} from './actions'
import { RESERVATION_COMPLETE, RESERVATION_HELD } from '@repo/data/reservation-status'

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
// Current floor-staff worker — remembered per-device-per-site (like dark mode);
// every on-site action auto-stamps it. `${KEY}-${site.id}`.
const WORKER_KEY = 'sunbnb-manage-worker'

/** A selectable roster member for the current-worker chip. */
export interface WorkerOption {
  id: string
  name: string
}

// Scale floor is intentionally low so even very wide parcels fit fully in view;
// chair labels auto-hide below DETAIL_HIDE_BELOW (ParcelView), so far-out zoom
// reads as plain colored blocks for orientation. The view opens fit-to-width.
const ZOOM_MIN = 0.1
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.25
// Default open zoom — fraction of fit-to-width, so the parcel shows with margins.
const DEFAULT_ZOOM_RATIO = 0.8
// Floor for the open zoom. Parcels wider than the viewport would otherwise open
// at fit-to-width × ratio (e.g. 16–34% on a phone) — uncomfortably small. Floor
// it here so a wide parcel opens at a readable zoom and the user pans to the rest.
const MIN_OPEN_ZOOM = 0.4
const TAP_THRESHOLD = 6 // px of pointer travel before a gesture counts as pan, not tap
const LONG_PRESS_MS = 450 // hold a seat this long (without moving) to enter multiselect

// ── ManageView ────────────────────────────────────────────────────────────────

export default function ManageView({
  site,
  accessKey,
  employees = [],
}: {
  site: SiteProps
  accessKey: string
  /** Active roster for this site's account — empty hides the worker chip. */
  employees?: WorkerOption[]
}) {
  const router = useRouter()
  const t = useTranslations('SiteManage')
  const tb = useTranslations('BedDetail') // reuse the tap-dialog labels in the multiselect sheet

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

  // ── Current worker (floor-staff attribution) ──────────────────────────────
  // Chosen once via the toolbar chip, remembered per-device-per-site, and passed
  // to every on-site create action so the booking is auto-attributed. Default
  // null (no hydration mismatch); restored from localStorage on mount and
  // re-validated against the live roster so a removed/renamed worker drops out.
  const [currentWorkerId, setCurrentWorkerId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${WORKER_KEY}-${site.id}`)
      if (stored && employees.some(e => e.id === stored)) setCurrentWorkerId(stored)
      else if (stored) localStorage.removeItem(`${WORKER_KEY}-${site.id}`)
    } catch { /* ignore */ }
  }, [site.id, employees])

  const selectWorker = (id: string | null) => {
    setCurrentWorkerId(id)
    try {
      if (id) localStorage.setItem(`${WORKER_KEY}-${site.id}`, id)
      else localStorage.removeItem(`${WORKER_KEY}-${site.id}`)
    } catch { /* ignore */ }
  }
  // Undefined (not null) when unset, so it omits cleanly from action arg lists.
  const workerArg = currentWorkerId ?? undefined

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
  // Bulk move is a QUEUE of single moves: relocate each selected booking in turn,
  // reusing the exact tap-to-move destination logic. Holds the bookings still
  // waiting after the one currently in `movingRes`.
  const [moveQueue, setMoveQueue] = useState<string[]>([])
  const [isMovePending, startMoveTransition] = useTransition()

  // ── Multiselect (slice 1: selection mechanics only) ───────────────────────
  // Long-press a seat to enter; tap toggles seats; selected seats are ringed.
  // Exits when the selection panel is dismissed or empty space is tapped.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [isBulkPending, startBulkTransition] = useTransition()
  // Shared Guest name + multi-day period for bulk Rent (mirrors the tap dialog).
  const [bulkGuestName, setBulkGuestName] = useState('')
  const [bulkUntil, setBulkUntil] = useState('')
  // Shared confirm step for the ⚠ bulk verbs (no-show / cancel / depart).
  const [bulkConfirm, setBulkConfirm] = useState<'no-show' | 'cancel' | 'depart' | null>(null)
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD')
  const maxUntil = dayjs().add(90, 'day').format('YYYY-MM-DD')
  const bulkDays = bulkUntil ? dayjs(bulkUntil).startOf('day').diff(dayjs().startOf('day'), 'day') + 1 : 1
  // Reset the shared inputs whenever the selection is cleared/exited.
  useEffect(() => {
    if (selectedIds.length === 0) { setBulkGuestName(''); setBulkUntil(''); setBulkConfirm(null) }
  }, [selectedIds.length])

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
    // Open at 80% of fit-to-width so the whole parcel shows with side margins,
    // not edge-to-edge — but never below MIN_OPEN_ZOOM, so a parcel much wider
    // than the viewport opens at a readable zoom (and pans) instead of tiny.
    const fit = Math.min(ZOOM_MAX, Math.max(MIN_OPEN_ZOOM, (vp.clientWidth / cw) * DEFAULT_ZOOM_RATIO))
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
  // Long-press tracking (enter multiselect on a held, still seat press).
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const longPressSeatId = useRef<string | null>(null)
  useEffect(() => () => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }, [])

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    wasPannedRef.current = false
    movedRef.current = 0
    if (pointers.current.size === 1) {
      panLast.current = { x: e.clientX, y: e.clientY }
      pinchRef.current = null
      // Long-press on a seat → enter/extend multiselect. Cancelled by movement
      // (pan), a second finger (pinch), or pointer up before the timer fires.
      const seatEl = (e.target as HTMLElement).closest('[data-item-id]')
      longPressSeatId.current = seatEl?.getAttribute('data-item-id') ?? null
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
      if (longPressSeatId.current) {
        longPressTimer.current = setTimeout(() => {
          const sid = longPressSeatId.current
          longPressTimer.current = undefined
          if (!sid) return
          wasPannedRef.current = true // suppress the click that would open the sheet
          setSelectedIds(prev => (prev.includes(sid) ? prev : [...prev, sid]))
        }, LONG_PRESS_MS)
      }
    } else if (pointers.current.size === 2) {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = undefined }
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
      if (movedRef.current > TAP_THRESHOLD) {
        wasPannedRef.current = true
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = undefined }
      }
      commit(scaleRef.current, txRef.current + dx, tyRef.current + dy)
    }
  }

  const onCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = undefined }
    // Tap on the viewport background (outside the parcel content) while selecting
    // → clear/exit multiselect. Tapping a gap between seats stays in multiselect.
    if (selectedIds.length > 0 && !wasPannedRef.current && !(e.target as HTMLElement).closest('.parcel-canvas-content')) {
      setSelectedIds([])
    }
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

  // Re-resolve the open bed against the freshest inventory so the detail drawer
  // reflects server-state changes after a router.refresh() (e.g. a collected
  // payment flipping the bed to paid) instead of the snapshot captured at tap
  // time. Falls back to the snapshot if the item is gone (e.g. a removed seat —
  // the drawer is closing anyway).
  const liveSelectedItem = selectedItem
    ? (inventoryItems.find(i => i.id === selectedItem.id) ?? selectedItem)
    : null

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
    setMoveQueue([]) // single move from the tap dialog — no queue behind it
    setMovingRes({ id: reservationId, count })
    setSelectedItem(null)
    setSelectedItemIsPool(false)
    setSelectedItemIsGroupExtra(false)
  }

  // Bulk move: queue every DISTINCT booking touched by the selection (in seat
  // order), then enter move mode on the first. Each completed move advances to the
  // next. Moving relocates the WHOLE booking regardless of how many of its seats
  // were selected — the selection only picks which bookings to move.
  const handleStartBulkMove = () => {
    const seen = new Set<string>()
    const resIds: string[] = []
    for (const i of inventoryItems) {
      if (!selectedIds.includes(i.id)) continue
      const r = getActiveReservation(i)
      if (r && !seen.has(r.id)) { seen.add(r.id); resIds.push(r.id) }
    }
    const first = resIds[0]
    if (!first) return
    const rest = resIds.slice(1)
    const count = inventoryItems.filter(i => getActiveReservation(i)?.id === first).length || 1
    setMoveError(null)
    setSelectedIds([])     // leave multiselect; the move banner takes over
    setMoveQueue(rest)
    setMovingRes({ id: first, count })
  }

  // A tap while in move mode → resolve the destination seat(s) and relocate.
  const handleMoveDestination = (item: InventoryItem) => {
    if (!movingRes) return
    // Block re-entry while a move is in flight — otherwise a quick second tap fires
    // with the SAME (not-yet-advanced) `movingRes`, re-moving the current booking
    // and skipping the next one in the queue (only one seat ends up relocated).
    if (isMovePending) return
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
        const next = moveQueue[0]
        if (next) {
          // Advance to the next queued booking. Its seat count is read from the
          // current inventory — accurate, since only the just-moved booking changed.
          const count = inventoryItems.filter(i => getActiveReservation(i)?.id === next).length || 1
          setMoveQueue(moveQueue.slice(1))
          setMovingRes({ id: next, count })
        } else {
          setMovingRes(null)
        }
        router.refresh()
      } else {
        setMoveError(res.errors?.[0] || 'Move failed')
      }
    })
  }

  // ── Bulk actions (multiselect slice 2) ────────────────────────────────────
  // The selection's composition decides which bulk verbs apply. Slice 2 covers
  // the safe ones: bulk Create on an all-free selection, and Free/clear on a
  // selection of no-money / cash-offline states. Paid bookings (reserved /
  // checked-in) are deliberately excluded — their bulk cancel+refund is slice 4.
  type SeatKind = 'available' | 'reserved' | 'held' | 'failed' | 'inflight' | 'checked-in' | 'walked-in' | 'comp' | 'blocked'
  const seatKind = (item: InventoryItem): SeatKind => {
    const st = getBedState(item)
    if (st !== 'expected') return st as SeatKind // available / checked-in / walked-in / blocked / comp
    const res = getActiveReservation(item)
    if (!res) return 'available'
    if (isFailedReservationStatus(res.status)) return 'failed'
    if (res.status === RESERVATION_HELD) return 'held'
    if (res.status === RESERVATION_COMPLETE) return 'reserved'
    return 'inflight'
  }

  // Run a per-seat action over the selection SEQUENTIALLY (so concurrent calls
  // can't race on a reservation shared by several selected seats), then refresh.
  // Clears the selection on full success; keeps it + shows a count on partial failure.
  const runBulkSeq = (fn: (item: InventoryItem) => Promise<{ status: string }>) => {
    const items = inventoryItems.filter(i => selectedIds.includes(i.id))
    if (items.length === 0) return
    setBulkError(null)
    startBulkTransition(async () => {
      let failed = 0
      for (const item of items) {
        try { const r = await fn(item); if (r?.status === 'error') failed++ } catch { failed++ }
      }
      router.refresh()
      if (failed > 0) setBulkError(t('bulkSomeFailed', { n: failed }))
      else setSelectedIds([])
    })
  }

  // applyToPair=false on every call → act on EXACTLY the selected seats.
  // The shared Guest name applies to create/comp/hold; the period only to Rent.
  const bulkBlock = () => runBulkSeq(i => blockBed(site.id!, i.id, undefined, accessKey, false, workerArg))
  const bulkComp = () => runBulkSeq(i => compBed(site.id!, i.id, accessKey, false, bulkGuestName.trim() || undefined, undefined, workerArg))
  const bulkReserve = () => runBulkSeq(i => holdBed(site.id!, i.id, accessKey, false, bulkGuestName.trim() || undefined, undefined, workerArg))
  const bulkRent = () => {
    const seenHolds = new Set<string>() // a held reservation spanning several selected seats converts once
    const name = bulkGuestName.trim() || undefined
    const until = bulkUntil || undefined
    runBulkSeq((i) => {
      if (seatKind(i) === 'held') {
        const res = getActiveReservation(i)
        if (!res || seenHolds.has(res.id)) return Promise.resolve({ status: 'ok' as const })
        seenHolds.add(res.id)
        return convertHoldToWalkIn(site.id!, i.id, accessKey, name, until, workerArg)
      }
      return reserveItem(site.id!, i.id, name, undefined, accessKey, until, false, workerArg)
    })
  }
  const bulkFree = () => {
    const seen = new Set<string>() // dedupe a failed reservation shared by >1 selected seat
    runBulkSeq((i) => {
      const kind = seatKind(i)
      if (kind === 'blocked') return unblockBed(site.id!, i.id, accessKey, false)
      if (kind === 'comp') return uncompBed(site.id!, i.id, accessKey, false)
      if (kind === 'held') return releaseHold(site.id!, i.id, accessKey, false)
      if (kind === 'walked-in') return unreserveItem(site.id!, i.id, accessKey, false)
      if (kind === 'failed') {
        const res = getActiveReservation(i)
        if (!res || seen.has(res.id)) return Promise.resolve({ status: 'ok' as const })
        seen.add(res.id)
        return removeFailedReservation(site.id!, res.id, accessKey)
      }
      return Promise.resolve({ status: 'ok' as const })
    })
  }

  // Reservation-level bulk verbs (check-in / no-show / depart / cancel): group the
  // selected seats by reservation and call the action ONCE per reservation,
  // SEQUENTIALLY. Whole-reservation semantics — selecting one seat of a multi-seat
  // booking acts on the whole booking (use the tap dialog for per-seat disconnects).
  const bulkByReservation = (fn: (resId: string, firstItemId: string) => Promise<{ status: string }>) => {
    const items = inventoryItems.filter(i => selectedIds.includes(i.id))
    const firstItemOf = new Map<string, string>() // reservationId → one of its selected itemIds
    for (const i of items) {
      const res = getActiveReservation(i)
      if (res && !firstItemOf.has(res.id)) firstItemOf.set(res.id, i.id)
    }
    if (firstItemOf.size === 0) return
    setBulkError(null)
    startBulkTransition(async () => {
      let failed = 0
      for (const [resId, itemId] of firstItemOf) {
        try { const r = await fn(resId, itemId); if (r?.status === 'error') failed++ } catch { failed++ }
      }
      router.refresh()
      if (failed > 0) setBulkError(t('bulkSomeFailed', { n: failed }))
      else setSelectedIds([])
    })
  }
  const bulkCheckIn = () => bulkByReservation((resId) => checkInReservation(site.id!, resId, accessKey))
  const bulkDepart = () => bulkByReservation((resId) => markDeparted(site.id!, resId, accessKey))
  const bulkNoShow = () => bulkByReservation((resId) => markNoShow(site.id!, resId, accessKey))
  const bulkCancel = () => bulkByReservation((_resId, itemId) => cancelReservation(site.id!, itemId, accessKey))
  // The ⚠ bulk verbs route through a shared confirm step (mirrors the tap dialog).
  const runBulkConfirm = () => {
    const v = bulkConfirm
    setBulkConfirm(null)
    if (v === 'no-show') bulkNoShow()
    else if (v === 'cancel') bulkCancel()
    else if (v === 'depart') bulkDepart()
  }

  // The panel offers the INTERSECTION of each selected seat's valid actions — a
  // verb shows only when every selected seat's state supports it.
  //   Rent: available → create walk-in · held → convert hold to walk-in
  //   Reserve/Comp/Block: available only
  //   Free (make available): held/walk-in/comp/blocked/failed (no-money vacates)
  const selItems = inventoryItems.filter(i => selectedIds.includes(i.id))
  const can = (states: SeatKind[]) => selItems.length > 0 && selItems.every(i => states.includes(seatKind(i)))
  const allAvailable = can(['available'])                         // → the full create row
  const canRent = can(['available', 'held'])
  const canFree = can(['held', 'walked-in', 'comp', 'blocked', 'failed'])
  const selKinds = new Set(selItems.map(seatKind))
  const homogeneous = selKinds.size === 1 ? [...selKinds][0] : null

  // Paid lane — reservation-level transitions (whole-reservation semantics).
  const canCheckIn = can(['reserved'])
  const canDepart = can(['checked-in', 'walked-in'])
  const canNoShow = can(['reserved'])
  // Real Mollie-paid bookings must NEVER be canceled silently (no refund). Cancel
  // is hidden in bulk when any selected booking is Mollie-paid — those are canceled
  // one at a time via the tap dialog, which surfaces the manual refund control.
  const canCancelStates = can(['reserved', 'checked-in'])
  const hasMolliePaid = selItems.some(i => {
    const r = getActiveReservation(i)
    return !!r?.paymentRef && r.paymentRef.startsWith('tr_')
  })
  const canCancel = canCancelStates && !hasMolliePaid
  const cancelBlockedByPaid = canCancelStates && hasMolliePaid

  // Move applies to any selection of relocatable bookings (same states the tap
  // dialog shows Move on). Each booking is relocated in turn via the move queue.
  const canMove = can(['reserved', 'held', 'checked-in', 'walked-in'])
  // Square Move button — sits on the dominant action's row (like the tap dialog);
  // rendered standalone when Move is the only applicable verb.
  const bulkMoveSquare = (
    <button
      type="button"
      disabled={isBulkPending}
      onClick={handleStartBulkMove}
      aria-label={tb('move')}
      title={tb('move')}
      className="w-16 self-stretch flex flex-col items-center justify-center gap-0.5 border-2 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-xl active:bg-gray-50 dark:active:bg-gray-800 disabled:opacity-50"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 7l-4 5 4 5M16 7l4 5-4 5M4 12h16" />
      </svg>
      <span className="text-[10px] font-semibold leading-none">{tb('move')}</span>
    </button>
  )

  // The vacate button mirrors the tap dialog when the selection is one state
  // (Release / Unblock / End comp / Unreserve / Remove); a mixed freeable
  // selection falls back to the generic "Make available". Always runs bulkFree
  // (which dispatches the right per-seat vacate). Null when not freeable.
  const freeButton = (() => {
    if (homogeneous === 'held') return <button disabled={isBulkPending} onClick={bulkFree} className="w-full text-gray-400 dark:text-gray-500 text-sm py-2 active:text-gray-600 dark:active:text-gray-200 disabled:opacity-50">{tb('release')}</button>
    if (homogeneous === 'blocked') return <button disabled={isBulkPending} onClick={bulkFree} className="w-full bg-green-500 text-white font-bold text-lg py-4 rounded-xl active:bg-green-600 disabled:opacity-50">{tb('unblock')}</button>
    if (homogeneous === 'comp') return <button disabled={isBulkPending} onClick={bulkFree} className="w-full bg-green-500 text-white font-bold text-lg py-4 rounded-xl active:bg-green-600 disabled:opacity-50">{tb('endComp')}</button>
    if (homogeneous === 'walked-in') return <button disabled={isBulkPending} onClick={bulkFree} className="w-full text-red-500 text-sm py-2 active:text-red-700 disabled:opacity-50">{tb('unreserve')}</button>
    if (homogeneous === 'failed') return <button disabled={isBulkPending} onClick={bulkFree} className="w-full bg-red-500 text-white font-bold text-lg py-4 rounded-xl active:bg-red-600 disabled:opacity-50">{tb('remove')}</button>
    if (!homogeneous && canFree) return <button disabled={isBulkPending} onClick={bulkFree} className="w-full bg-green-500 text-white font-bold text-lg py-4 rounded-xl active:bg-green-600 disabled:opacity-50">{t('bulkFree')}</button>
    return null
  })()

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
      className={`flex flex-col h-[calc(100dvh-var(--impersonation-offset,0px))] overflow-hidden px-2 pt-2 mx-auto w-full max-w-screen-lg transition-colors dark:bg-gray-950 dark:text-gray-100 ${isDark ? 'dark' : ''}`}
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
          employees={employees}
          currentWorkerId={currentWorkerId}
          onSelectWorker={selectWorker}
        />
      )}

      {/* Move-mode banner — tap a free seat to relocate the picked reservation */}
      {movingRes && (
        <div className="mb-2 px-3 py-2 rounded-xl border-2 border-blue-300 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">
              {movingRes.count > 1 ? t('movePromptGroup', { n: movingRes.count }) : t('movePrompt')}
              {moveQueue.length > 0 && <span className="font-normal"> · {t('moveQueueRemaining', { n: moveQueue.length })}</span>}
            </span>
            <button
              type="button"
              onClick={() => { setMovingRes(null); setMoveError(null); setMoveQueue([]) }}
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
              if (selectedIds.length > 0) {
                setSelectedIds(prev => prev.includes(item.id) ? prev.filter(x => x !== item.id) : [...prev, item.id])
                return
              }
              if (movingRes) { handleMoveDestination(item); return }
              setSelectedItem(item)
              setSelectedItemIsPool(isPool)
              setSelectedItemIsGroupExtra(isGroupExtra)
            }}
            selectedIds={selectedIds}
          />
        </div>
      ) : null}

      {/* Floating rentals ⇄ parcels toggle — bottom-right; hidden during
          multiselect so it doesn't overlap the selection sheet. */}
      {showRentalsFab && selectedIds.length === 0 && (
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
      {liveSelectedItem && (
        <BedDetail
          siteId={site.id!}
          item={liveSelectedItem}
          groupItems={
            liveSelectedItem.sunbedGroupId
              ? inventoryItems.filter(i => i.id !== liveSelectedItem.id && i.sunbedGroupId === liveSelectedItem.sunbedGroupId)
              : []
          }
          accessKey={accessKey}
          currentWorkerId={workerArg}
          isPool={selectedItemIsPool}
          isGroupExtra={selectedItemIsGroupExtra}
          onClose={() => { setSelectedItem(null); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(false) }}
          onPoolSeatRemoved={() => { setSelectedItem(null); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(false); router.refresh() }}
          onGroupSeatAdded={() => { router.refresh() }}
          onGroupSeatRemoved={() => { setSelectedItem(null); setSelectedItemIsPool(false); setSelectedItemIsGroupExtra(false); router.refresh() }}
          onMove={handleStartMove}
          siteIsPaid={site.type === 'paid'}
          onCollected={() => router.refresh()}
        />
      )}

      {/* Walk-in rental modal */}
      {showRentalModal && site.rentalItems && (
        <CreateRentalModal
          siteId={site.id!}
          rentalItems={site.rentalItems}
          activeBookings={site.rentalBookings}
          accessKey={accessKey}
          currentWorkerId={workerArg}
          onClose={() => setShowRentalModal(false)}
          onCreated={() => {
            setShowRentalModal(false)
            router.refresh()
          }}
        />
      )}

      {/* Multiselect bottom sheet — BedDetail-style but NON-modal: no backdrop,
          and a pointer-events-none wrapper (only the panel itself is interactive)
          so the parcel stays pan/zoom/select-able underneath. Shows the selection
          count + the bulk verbs that apply to the current composition; the × ends
          multiselect (same lifecycle as the selection). */}
      {selectedIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center pointer-events-none">
          <div
            className="pointer-events-auto bg-white dark:bg-gray-900 dark:text-gray-100 w-full max-w-lg rounded-t-2xl border-t border-x border-gray-200 dark:border-gray-800 p-4 sm:p-5 shadow-xl animate-slide-up"
            style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}
          >
            {/* Header — count where the seat number sits in BedDetail */}
            <div className="flex items-center justify-between mb-4 sm:mb-5">
              <span className="text-2xl sm:text-3xl font-black">{t('selectedCount', { n: selectedIds.length })}</span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                aria-label={t('moveCancel')}
                className="text-gray-400 dark:text-gray-500 text-3xl leading-none p-2"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3">
              {bulkError && (
                <div className="bg-red-50 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm rounded-xl px-4 py-3">{bulkError}</div>
              )}

              {bulkConfirm ? (
                /* ⚠ confirm step — mirrors the BedDetail confirm panel */
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {bulkConfirm === 'no-show' ? tb('confirmNoShow') : bulkConfirm === 'depart' ? tb('confirmDepart') : tb('confirmCancel')}
                  </p>
                  <div className="flex gap-3">
                    <button disabled={isBulkPending} onClick={runBulkConfirm} className="flex-1 bg-red-500 text-white font-bold text-lg py-4 rounded-xl active:bg-red-600 disabled:opacity-50">{isBulkPending ? '...' : tb('confirm')}</button>
                    <button onClick={() => setBulkConfirm(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold text-lg py-4 rounded-xl active:bg-gray-200 dark:active:bg-gray-700">{tb('back')}</button>
                  </div>
                </div>
              ) : (
                <>
              {/* Guest name + multi-day period — shown when Rent applies (available/held) */}
              {canRent && (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={tb('guestName')}
                      value={bulkGuestName}
                      onChange={e => setBulkGuestName(e.target.value)}
                      className="flex-1 border-2 rounded-xl px-4 py-3.5 text-base dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
                    />
                    <button
                      type="button"
                      onClick={() => setBulkUntil(bulkUntil === '' ? tomorrow : '')}
                      aria-label={tb('multipleDays')}
                      aria-pressed={bulkUntil !== ''}
                      title={tb('multipleDays')}
                      className={`w-14 self-stretch flex flex-col items-center justify-center gap-0.5 rounded-xl border-2 transition-colors ${bulkUntil !== '' ? 'border-orange-400 bg-orange-50 text-orange-600' : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 active:bg-gray-50'}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                      </svg>
                      {bulkUntil !== '' && <span className="text-[10px] font-bold leading-none tabular-nums">{bulkDays}d</span>}
                    </button>
                  </div>
                  {bulkUntil !== '' && (
                    <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/40 border-2 dark:border-gray-600 rounded-xl px-3 py-2.5">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">{tb('until')}</span>
                      <input type="date" value={bulkUntil} min={tomorrow} max={maxUntil} onChange={e => setBulkUntil(e.target.value || tomorrow)} className="flex-1 bg-transparent text-base font-medium outline-none" />
                      <button type="button" onClick={() => setBulkUntil('')} className="text-gray-400 text-2xl leading-none px-1 flex-shrink-0" aria-label={tb('cancel')}>&times;</button>
                    </div>
                  )}
                </>
              )}

              {/* Action buttons — mirror the tap dialog for the verbs common to the selection */}
              {allAvailable ? (
                <div className="flex gap-3">
                  <button disabled={isBulkPending} onClick={bulkBlock} aria-label={tb('block')} title={tb('block')} className="w-16 self-stretch flex flex-col items-center justify-center gap-0.5 border-2 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-xl active:bg-gray-50 dark:active:bg-gray-800 disabled:opacity-50">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
                    <span className="text-[10px] font-semibold leading-none">{tb('block')}</span>
                  </button>
                  <button disabled={isBulkPending} onClick={bulkComp} aria-label={tb('comp')} title={tb('comp')} className="w-16 self-stretch flex flex-col items-center justify-center gap-0.5 border-2 border-purple-300 text-purple-600 dark:text-purple-300 rounded-xl active:bg-purple-50 dark:active:bg-purple-950/30 disabled:opacity-50">
                    <span className="text-base leading-none" aria-hidden="true">★</span>
                    <span className="text-[10px] font-semibold leading-none">{tb('comp')}</span>
                  </button>
                  <button disabled={isBulkPending} onClick={bulkReserve} className="flex-1 bg-yellow-400 text-yellow-900 font-bold text-lg py-4 rounded-xl active:bg-yellow-500 disabled:opacity-50">{tb('reserve')}</button>
                  <button disabled={isBulkPending} onClick={bulkRent} className="flex-1 bg-orange-500 text-white font-bold text-lg py-4 rounded-xl active:bg-orange-600 disabled:opacity-50">{bulkDays > 1 ? tb('rentDays', { n: bulkDays }) : tb('rent')}</button>
                </div>
              ) : canRent ? (
                <div className="flex gap-3">
                  <button disabled={isBulkPending} onClick={bulkRent} className="flex-1 bg-orange-500 text-white font-bold text-lg py-4 rounded-xl active:bg-orange-600 disabled:opacity-50">{bulkDays > 1 ? tb('rentDays', { n: bulkDays }) : tb('rent')}</button>
                  {canMove && bulkMoveSquare}
                </div>
              ) : null}

              {/* Paid lane — Check-in (safe) · Depart (⚠) as the dominant button, with Move alongside */}
              {canCheckIn && (
                <div className="flex gap-3">
                  <button disabled={isBulkPending} onClick={bulkCheckIn} className="flex-1 bg-blue-500 text-white font-bold text-lg py-4 rounded-xl active:bg-blue-600 disabled:opacity-50">{tb('checkIn')}</button>
                  {canMove && bulkMoveSquare}
                </div>
              )}
              {canDepart && (
                <div className="flex gap-3">
                  <button disabled={isBulkPending} onClick={() => setBulkConfirm('depart')} className="flex-1 bg-gray-700 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-800 disabled:opacity-50">{tb('markDeparted')}</button>
                  {canMove && bulkMoveSquare}
                </div>
              )}
              {/* Standalone Move — mixed relocatable states with no shared dominant verb */}
              {canMove && !(canRent && !allAvailable) && !canCheckIn && !canDepart && (
                <button disabled={isBulkPending} onClick={handleStartBulkMove} className="w-full flex items-center justify-center gap-2 border-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-bold text-lg py-4 rounded-xl active:bg-gray-50 dark:active:bg-gray-800 disabled:opacity-50">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 7l-4 5 4 5M16 7l4 5-4 5M4 12h16" /></svg>
                  {tb('move')}
                </button>
              )}

              {freeButton}

              {/* No-show / Cancel — secondary ⚠ links, mirror the tap dialog */}
              {(canNoShow || canCancel) && (
                <div className="flex gap-3">
                  {canNoShow && <button onClick={() => setBulkConfirm('no-show')} className="flex-1 text-gray-400 text-sm py-2 active:text-gray-600">{tb('markNoShow')}</button>}
                  {canCancel && <button onClick={() => setBulkConfirm('cancel')} className="flex-1 text-red-400 text-sm py-2 active:text-red-600">{tb('cancelReservation')}</button>}
                </div>
              )}
              {cancelBlockedByPaid && (
                <div className="text-gray-500 dark:text-gray-400 text-center text-sm py-2">{t('bulkCancelPaidNote')}</div>
              )}

              {!allAvailable && !canRent && !canCheckIn && !canDepart && !canMove && !freeButton && !canCancel && !cancelBlockedByPaid && (
                <div className="text-gray-500 dark:text-gray-400 text-center py-2">{t('bulkNoAction')}</div>
              )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
