'use client'
/* global google -- loaded by the Maps JS API via APIProvider */

import { APIProvider as VisAPIProvider, Map as VisMap, useMap, type APIProviderProps, type MapMouseEvent, type MapProps } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState, type FC } from 'react'
import { nearestSunbed, type BeachLayout, type MockSunbed } from '@/lib/beach-layout.ts'
import HeroBeach, { type HeroMode } from './HeroBeach'
import SunbedOverlay, { type FloatTag } from './SunbedOverlay'

// @vis.gl resolves the hoisted @types/react 19; re-type against this app's React 18 (keeps props).
const APIProvider = VisAPIProvider as unknown as FC<APIProviderProps>
const Map = VisMap as unknown as FC<MapProps>

/** The guest app's own cloud-styled map. */
const APP_MAP_ID = '7a0196a7ba317ea5'
/** Regional, aerial view the camera starts from — the hand-off from the illustrated beach. */
const FLY_FROM_ZOOM = 10
const FLY_TO_ZOOM = 19.3
export const FLY_MS = 2200
const FADE_MS = 1000

export interface Insets {
  top: number
  bottom: number
  left: number
}

/**
 * The world behind the conversation (track 027 D11) — ONE layer for the whole visit. Before a
 * beach is picked it is the illustrated beach booking itself; once picked, the prospect's real
 * map fades in under it and the camera flies down to their shore. It never remounts: building
 * the mockup, booking a bed and checking a guest in all happen on this same map.
 */
export default function World({
  apiKey,
  center,
  layout,
  scene,
  insets,
  fitKey,
  selected,
  booked,
  hint,
  tag,
  onBedTap,
  onMapClick,
  ground = null,
  onFlown,
  heroMode = 'book',
  heroTags,
}: {
  apiKey: string
  /** The picked beach; null shows the illustrated scene. */
  center: { lat: number; lng: number } | null
  layout: BeachLayout | null
  /** Where the illustrated scene may draw (fitted to the floating UI). */
  scene: { shore: number; band: [number, number] } | null
  /** Screen area covered by the floating UI — the camera frames the beach in what is left. */
  insets: Insets
  /** Bump to re-frame the parcel (count settled, mockup built). */
  fitKey: number
  selected: string | null
  booked: ReadonlySet<string>
  hint: string | null
  tag: FloatTag | null
  onBedTap?: (bed: MockSunbed) => void
  /** When set, a tap on the map goes here instead of picking a bed (moving the parcel). */
  onMapClick?: (ll: { lat: number; lng: number }) => void
  ground?: { lat: number; lng: number }[][] | null
  /** The camera has landed on the beach (the shore snap waits for this, so it is seen). */
  onFlown?: () => void
  heroMode?: HeroMode
  heroTags: Record<HeroMode, string>
}) {
  const [heroGone, setHeroGone] = useState(false)
  // The map fades in only once its first tiles are drawn — never a blank grey flash.
  const [mapShown, setMapShown] = useState(false)
  // The fly-in has landed: framing before that would be overridden by the fly-in's camera.
  const [flown, setFlown] = useState(false)
  useEffect(() => {
    if (!center) {
      setMapShown(false)
      setFlown(false)
      return setHeroGone(false)
    }
    const timer = setTimeout(() => setHeroGone(true), FADE_MS)
    return () => clearTimeout(timer)
  }, [center])

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#f7ebd1]">
      {center && apiKey && (
        <div className={`absolute inset-0 transition-opacity duration-700 ${mapShown ? 'opacity-100' : 'opacity-0'}`}>
          <APIProvider apiKey={apiKey}>
          <Map
            mapId={APP_MAP_ID}
            defaultCenter={center}
            defaultZoom={FLY_FROM_ZOOM}
            gestureHandling="greedy"
            isFractionalZoomEnabled
            disableDefaultUI
            clickableIcons={false}
            onTilesLoaded={() => setMapShown(true)}
            onClick={(e: MapMouseEvent) => {
              const ll = e.detail.latLng
              if (ll && onMapClick) return onMapClick(ll)
              const bed = ll && layout ? nearestSunbed(layout, ll, 3) : null
              if (bed) onBedTap?.(bed)
            }}
          >
            {/* The flight starts once the aerial tiles are drawn — the hand-off is seen, not loaded. */}
            <FlyIn
              target={center}
              insets={insets}
              start={mapShown}
              onLanded={() => {
                setFlown(true)
                onFlown?.()
              }}
            />
            {layout && <SunbedOverlay layout={layout} selected={selected} booked={booked} hint={hint} tag={tag} ground={ground} />}
            <Frame layout={layout} insets={insets} fitKey={fitKey} flown={flown} />
          </Map>
          </APIProvider>
        </div>
      )}
      {!heroGone && (
        // The illustrated beach recedes like a camera rising away from it, as the real coast fades in.
        <div
          className={`absolute inset-0 origin-[50%_60%] transition-all duration-1000 ease-in motion-reduce:transition-none ${
            center ? 'pointer-events-none scale-[0.55] opacity-0 blur-[3px]' : 'scale-100 opacity-100'
          }`}
        >
          {scene && <HeroBeach shore={scene.shore} band={scene.band} mode={heroMode} tags={heroTags} />}
        </div>
      )}
    </div>
  )
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Pixel offset that puts a point in the middle of the UNCOVERED part of the screen. */
function offsetFor(insets: Insets) {
  // panBy moves the CENTRE: down (+y) lifts the beach above the conversation, left (−x) shifts it right of a side panel.
  return { x: -insets.left / 2, y: (insets.bottom - insets.top) / 2 }
}

/** Camera fly-in from coast level down to the beach (one orchestrated motion). */
function FlyIn({ target, insets, start, onLanded }: { target: { lat: number; lng: number }; insets: Insets; start: boolean; onLanded: () => void }) {
  const map = useMap()
  const insetsRef = useRef(insets)
  insetsRef.current = insets
  const landedRef = useRef(onLanded)
  landedRef.current = onLanded
  useEffect(() => {
    if (!map || !start) return
    const land = () => {
      // Centre the beach in the visible part, above the conversation.
      const o = offsetFor(insetsRef.current)
      map.panBy(o.x, o.y)
      landedRef.current()
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      map.moveCamera({ center: target, zoom: FLY_TO_ZOOM })
      land()
      return
    }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / FLY_MS)
      map.moveCamera({ center: target, zoom: FLY_FROM_ZOOM + (FLY_TO_ZOOM - FLY_FROM_ZOOM) * easeInOut(k) })
      if (k < 1) raf = requestAnimationFrame(tick)
      else land()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [map, start, target.lat, target.lng])
  return null
}

/**
 * Frames the parcel in the uncovered part of the screen whenever `fitKey` changes, so 20 beds and
 * 400 beds both fill the view instead of shrinking to icons or hiding under the conversation.
 */
function Frame({ layout, insets, fitKey, flown }: { layout: BeachLayout | null; insets: Insets; fitKey: number; flown: boolean }) {
  const map = useMap()
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const insetsRef = useRef(insets)
  insetsRef.current = insets
  // Only an explicit fitKey re-frames — not every message that changes the conversation's height.
  useEffect(() => {
    const l = layoutRef.current
    const insets = insetsRef.current
    // Never frame before the fly-in has landed, or the fly-in's camera overrides it; a request
    // made during the flight runs when it lands (`flown` is a dependency).
    if (!map || !fitKey || !flown || !l?.sunbeds.length) return
    const timer = setTimeout(() => {
      const b = new google.maps.LatLngBounds()
      for (const s of l.sunbeds) b.extend({ lat: s.lat, lng: s.lng })
      map.fitBounds(b, { top: insets.top + 24, bottom: insets.bottom + 24, left: insets.left + 24, right: 24 })
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if ((map.getZoom() ?? FLY_TO_ZOOM) > 21) map.setZoom(21)
      })
    }, 350)
    return () => clearTimeout(timer)
  }, [map, fitKey, flown])
  return null
}
