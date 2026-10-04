'use client'

import {
  APIProvider as VisAPIProvider,
  Map as VisMap,
  useMap,
  type APIProviderProps,
  type MapMouseEvent,
  type MapProps,
} from '@vis.gl/react-google-maps'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import type { LeadLayout, LeadPlacement } from '@repo/data/lead-model'
import { saveLayout } from '@/app/actions'
import { generateBeachLayout, nearestSunbed, type BeachLayout, type MockSunbed } from '@/lib/beach-layout.ts'
import type { ShoreFrame } from '@/lib/coastline.ts'
import DemoBookingPanel from './DemoBookingPanel'
import SunbedOverlay from './SunbedOverlay'

// @vis.gl resolves the hoisted @types/react 19 while this app is on React 18 types, so its
// components fail the JSX element check. Re-type them against OUR React types — unlike the
// `ComponentType<any>` casts elsewhere in the repo, this keeps prop checking.
const APIProvider = VisAPIProvider as unknown as FC<APIProviderProps>
const Map = VisMap as unknown as FC<MapProps>

const ROTATE_STEP_DEG = 15
/** Until a coastline answer (or the prospect) says otherwise — the commonest Med orientation. */
const DEFAULT_SEA_BEARING_DEG = 180
const SAVE_DEBOUNCE_MS = 1200

/**
 * The prospect's beach: satellite map + generated layout + guest booking demo.
 *
 * Two map modes: by default a tap SELECTS a sunbed (booking demo); "Move" arms the next tap to
 * reposition the layout. Every adjustment, and the one-time shore snap, is saved to the lead so the
 * shareable link always shows the beach as the prospect left it.
 */
export default function MockupView({
  token,
  apiKey,
  center,
  sunbedCount,
  saved,
}: {
  token: string
  apiKey: string
  center: { lat: number; lng: number }
  sunbedCount: number
  /** Layout saved on the lead; null on first visit. */
  saved: LeadLayout | null
}) {
  const t = useTranslations()
  const [anchor, setAnchor] = useState(saved ? { lat: saved.anchorLat, lng: saved.anchorLng } : center)
  const [placement, setPlacement] = useState<LeadPlacement>(saved?.placement ?? 'center')
  const [seaBearingDeg, setSeaBearingDeg] = useState(saved?.seaBearingDeg ?? DEFAULT_SEA_BEARING_DEG)
  const [moving, setMoving] = useState(false)
  const [selected, setSelected] = useState<MockSunbed | null>(null)
  const [booked, setBooked] = useState<ReadonlySet<string>>(new Set())
  const [panTarget, setPanTarget] = useState<number>(0)
  const touched = useRef(saved !== null)
  const dirty = useRef(false)

  const layout = useMemo(
    () => generateBeachLayout({ anchor, seaBearingDeg, sunbedCount, placement }),
    [anchor, seaBearingDeg, sunbedCount, placement],
  )

  // First visit only: snap to the real shore once the OSM lookup answers — unless the prospect
  // already moved/turned the layout; their adjustment wins over a late answer.
  useEffect(() => {
    if (saved) return
    let cancelled = false
    fetch(`/api/coastline?lat=${center.lat}&lng=${center.lng}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ frame: ShoreFrame | null }>) : { frame: null }))
      .then(({ frame }) => {
        if (cancelled || !frame || touched.current) return
        dirty.current = true
        setAnchor(frame.waterline)
        setSeaBearingDeg(frame.seaBearingDeg)
        setPlacement('waterline')
        setPanTarget((n) => n + 1)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [saved, center.lat, center.lng])

  // Persist adjustments (debounced) — the shared link should not depend on Overpass answering again.
  useEffect(() => {
    if (!dirty.current) return
    const timer = setTimeout(() => {
      void saveLayout(token, { anchorLat: anchor.lat, anchorLng: anchor.lng, seaBearingDeg, placement })
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [token, anchor, seaBearingDeg, placement])

  if (!apiKey) {
    return <div className="flex h-[60vh] items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-500">{t('Beach.mapUnavailable')}</div>
  }

  const adjust = () => {
    touched.current = true
    dirty.current = true
    setSelected(null)
  }
  const rotate = (delta: number) => {
    adjust()
    setSeaBearingDeg((b) => (((b + delta) % 360) + 360) % 360)
  }
  const onClick = (e: MapMouseEvent) => {
    const ll = e.detail.latLng
    if (!ll) return
    if (moving) {
      adjust()
      setPlacement('center')
      setAnchor({ lat: ll.lat, lng: ll.lng })
      setMoving(false)
      return
    }
    setSelected(nearestSunbed(layout, ll))
  }

  const iconBtn = 'rounded-md px-2.5 py-1.5 text-gray-700 hover:bg-gray-100'

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div>
        <div className="relative h-[60vh] min-h-[360px] overflow-hidden rounded-xl border border-gray-200">
          <APIProvider apiKey={apiKey}>
            <Map
              defaultCenter={anchor}
              defaultZoom={layout.pairsPerRow > 40 ? 17 : 19}
              mapTypeId="satellite"
              tilt={0}
              gestureHandling="greedy"
              disableDefaultUI
              zoomControl
              clickableIcons={false}
              draggableCursor={moving ? 'crosshair' : 'pointer'}
              onClick={onClick}
            >
              <SunbedOverlay layout={layout} selected={selected?.label ?? null} booked={booked} />
              <PanToLayout layout={layout} trigger={panTarget} />
            </Map>
          </APIProvider>
          <div className="absolute right-3 top-3 flex gap-1 rounded-lg bg-white/95 p-1 shadow">
            <button type="button" onClick={() => rotate(-ROTATE_STEP_DEG)} aria-label={t('Beach.rotateLeft')} title={t('Beach.rotateLeft')} className={iconBtn}>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
            </button>
            <button type="button" onClick={() => rotate(ROTATE_STEP_DEG)} aria-label={t('Beach.rotateRight')} title={t('Beach.rotateRight')} className={iconBtn}>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setMoving((m) => !m)}
              aria-pressed={moving}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${moving ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {t('Mockup.move')}
            </button>
          </div>
          {moving && (
            <div role="status" className="absolute inset-x-3 bottom-3 rounded-lg bg-gray-900/90 px-4 py-2 text-center text-sm text-white">
              {t('Mockup.moveActive')}
            </div>
          )}
        </div>
        <p className="mt-3 text-sm text-gray-600">
          {t('Beach.shown', { count: layout.sunbeds.length, rows: layout.rows })} · {t('Mockup.tapHint')}
        </p>
      </div>

      <DemoBookingPanel
        bed={selected}
        bookedCount={booked.size}
        onBooked={(label) => setBooked((prev) => new Set(prev).add(label))}
        onDone={() => setSelected(null)}
      />
    </div>
  )
}

/** Bring the block into view after the shore snap moves it (not on every later tweak). */
function PanToLayout({ layout, trigger }: { layout: BeachLayout; trigger: number }) {
  const map = useMap()
  const handled = useRef(0)
  useEffect(() => {
    if (!map || trigger === handled.current || !layout.umbrellas.length) return
    handled.current = trigger
    const n = layout.umbrellas.length
    map.panTo({
      lat: layout.umbrellas.reduce((a, u) => a + u.lat, 0) / n,
      lng: layout.umbrellas.reduce((a, u) => a + u.lng, 0) / n,
    })
  }, [map, layout, trigger])
  return null
}
