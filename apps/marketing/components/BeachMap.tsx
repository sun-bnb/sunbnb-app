'use client'

import { APIProvider as VisAPIProvider, Map as VisMap, useMap, type APIProviderProps, type MapMouseEvent, type MapProps } from '@vis.gl/react-google-maps'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { generateBeachLayout, type LayoutInput } from '@/lib/beach-layout.ts'
import type { ShoreFrame } from '@/lib/coastline.ts'
import SunbedOverlay from './SunbedOverlay'

// @vis.gl resolves the hoisted @types/react 19 while this app is on React 18 types, so its
// components fail the JSX element check. Re-type them against OUR React types — unlike the
// `ComponentType<any>` casts elsewhere in the repo, this keeps prop checking.
const APIProvider = VisAPIProvider as unknown as FC<APIProviderProps>
const Map = VisMap as unknown as FC<MapProps>

const ROTATE_STEP_DEG = 15
/**
 * Until the coastline lookup answers (or if it never does) the sea is assumed south — the
 * commonest for the Mediterranean coasts we sell into — and the prospect can turn it.
 */
const DEFAULT_SEA_BEARING_DEG = 180

/** The prospect's beach on satellite imagery with a generated, adjustable sunbed layout. */
export default function BeachMap({
  apiKey,
  center,
  sunbedCount,
}: {
  apiKey: string
  center: { lat: number; lng: number }
  sunbedCount: number
}) {
  const t = useTranslations('Beach')
  const [anchor, setAnchor] = useState(center)
  const [placement, setPlacement] = useState<LayoutInput['placement']>('center')
  const [seaBearingDeg, setSeaBearingDeg] = useState(DEFAULT_SEA_BEARING_DEG)
  const touched = useRef(false)
  const [snapped, setSnapped] = useState(false)
  const layout = useMemo(
    () => generateBeachLayout({ anchor, seaBearingDeg, sunbedCount, placement }),
    [anchor, seaBearingDeg, sunbedCount, placement],
  )

  // Snap to the real shore once the OSM lookup answers — unless the prospect already moved or
  // turned the layout themselves; their adjustment wins over a late answer.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/coastline?lat=${center.lat}&lng=${center.lng}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ frame: ShoreFrame | null }>) : { frame: null }))
      .then(({ frame }) => {
        if (cancelled || !frame || touched.current) return
        setAnchor(frame.waterline)
        setSeaBearingDeg(frame.seaBearingDeg)
        setPlacement('waterline')
        setSnapped(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [center.lat, center.lng])

  if (!apiKey) {
    return <div className="flex h-[60vh] items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-500">{t('mapUnavailable')}</div>
  }

  const rotate = (delta: number) => {
    touched.current = true
    setSeaBearingDeg((b) => (((b + delta) % 360) + 360) % 360)
  }
  const onClick = (e: MapMouseEvent) => {
    const ll = e.detail.latLng
    if (!ll) return
    touched.current = true
    setPlacement('center')
    setAnchor({ lat: ll.lat, lng: ll.lng })
  }

  return (
    <div>
      <div className="relative h-[60vh] min-h-[360px] overflow-hidden rounded-xl border border-gray-200">
        <APIProvider apiKey={apiKey}>
          <Map
            defaultCenter={center}
            defaultZoom={layout.pairsPerRow > 40 ? 17 : 19}
            mapTypeId="satellite"
            tilt={0}
            gestureHandling="greedy"
            disableDefaultUI
            zoomControl
            clickableIcons={false}
            onClick={onClick}
          >
            <SunbedOverlay layout={layout} />
            {snapped && <PanToLayout layout={layout} />}
          </Map>
        </APIProvider>
        <div className="absolute right-3 top-3 flex gap-1 rounded-lg bg-white/95 p-1 shadow">
          <button type="button" onClick={() => rotate(-ROTATE_STEP_DEG)} aria-label={t('rotateLeft')} title={t('rotateLeft')} className="rounded-md px-2.5 py-1.5 text-gray-700 hover:bg-gray-100">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
          <button type="button" onClick={() => rotate(ROTATE_STEP_DEG)} aria-label={t('rotateRight')} title={t('rotateRight')} className="rounded-md px-2.5 py-1.5 text-gray-700 hover:bg-gray-100">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" />
            </svg>
          </button>
        </div>
      </div>
      <p className="mt-3 text-sm text-gray-600">
        {t('shown', { count: layout.sunbeds.length, rows: layout.rows })} · {t('moveHint')}
      </p>
    </div>
  )
}

/** After the shore snap moves the block, bring it into view once (not on every later tweak). */
function PanToLayout({ layout }: { layout: ReturnType<typeof generateBeachLayout> }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (!map || done.current || !layout.umbrellas.length) return
    done.current = true
    const n = layout.umbrellas.length
    map.panTo({
      lat: layout.umbrellas.reduce((a, u) => a + u.lat, 0) / n,
      lng: layout.umbrellas.reduce((a, u) => a + u.lng, 0) / n,
    })
  }, [map, layout])
  return null
}
