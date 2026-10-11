/**
 * Pure maths + state machines for the aerial-photo alignment mode (track 030 S7d).
 *
 * The photo is a `SimilarityGeoref` (see `@repo/agent/geo/georef`). The user edits it three ways:
 *   - drag the body       -> `dragMove`    : translate; the anchor moves by exactly the cursor delta
 *   - drag the corner     -> `dragHandle`  : rotate + scale about the IMAGE CENTRE so the corner
 *                            follows the cursor (bearing change = rotation change, distance ratio
 *                            k = scale change: the image is k times larger on the ground, so
 *                            `metersPerPx` is multiplied by k)
 *   - pin two points      -> `reducePins`  : photo point, map point, photo point, map point ->
 *                            `similarityFrom2Points`
 * No React, no Google Maps: every transition is unit-testable.
 */
import {
  enuToLatLng,
  latLngToEnu,
  normDeg,
  pxToLatLng,
  similarityFrom2Points,
  type Enu,
  type ImageSize,
  type LatLng,
  type Px,
  type SimilarityGeoref,
} from '@repo/agent/geo/georef'

export const MIN_METERS_PER_PX = 0.005
export const MAX_METERS_PER_PX = 20
/** A handle dragged closer than this to the centre (metres) is ignored (degenerate scale/angle). */
export const MIN_HANDLE_DISTANCE_M = 0.5
export const MIN_OPACITY = 0.1
export const MAX_OPACITY = 1
export const DEFAULT_OPACITY = 0.6

const DEG = 180 / Math.PI

export const clampOpacity = (v: number): number =>
  Number.isFinite(v) ? Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, v)) : DEFAULT_OPACITY

export const imageCentre = (image: ImageSize): Px => ({ x: image.w / 2, y: image.h / 2 })

/** The corner the rotate+scale handle sits on (top-right). */
export const handlePx = (image: ImageSize): Px => ({ x: image.w, y: 0 })

/** Shift the georef by an ENU delta (metres). */
export function translateGeoref(g: SimilarityGeoref, d: Enu): SimilarityGeoref {
  return { ...g, anchor: enuToLatLng(g.anchor, d) }
}

/** Body drag: the photo follows the cursor from `from` to `to`. */
export function dragMove(g: SimilarityGeoref, from: LatLng, to: LatLng): SimilarityGeoref {
  return translateGeoref(g, latLngToEnu(from, to))
}

const bearing = (v: Enu): number => Math.atan2(v.e, v.n) * DEG

/**
 * Corner drag: rotate + scale about the image centre so the handle's image point ends up under
 * `to`. Returns the same georef when the cursor is (nearly) on the centre. The result is
 * re-anchored at the centre, which stays fixed on the map.
 */
export function dragHandle(g: SimilarityGeoref, image: ImageSize, handle: Px, to: LatLng): SimilarityGeoref {
  const centre = imageCentre(image)
  const centreLL = pxToLatLng(g, centre)
  const v0 = latLngToEnu(centreLL, pxToLatLng(g, handle))
  const v1 = latLngToEnu(centreLL, to)
  const d0 = Math.hypot(v0.e, v0.n)
  const d1 = Math.hypot(v1.e, v1.n)
  if (d0 < 1e-9 || d1 < MIN_HANDLE_DISTANCE_M) return g
  const mpp = Math.min(MAX_METERS_PER_PX, Math.max(MIN_METERS_PER_PX, g.metersPerPx * (d1 / d0)))
  return {
    kind: 'similarity',
    anchorPx: centre,
    anchor: centreLL,
    metersPerPx: mpp,
    rotationDeg: normDeg(g.rotationDeg + (bearing(v1) - bearing(v0))),
  }
}

// ─── 2-point pin flow ──────────────────────────────────────────────────────────

export type PinStep = 'idle' | 'photo1' | 'map1' | 'photo2' | 'map2'

export interface PinState {
  step: PinStep
  photo1?: Px
  map1?: LatLng
  photo2?: Px
  /** Set on the transition out of `map2`; the flow is back to `idle` afterwards. */
  result?: SimilarityGeoref
  /** `degenerate` when the two pins coincide in the photo or on the map. */
  error?: 'degenerate'
}

export const INITIAL_PINS: PinState = { step: 'idle' }

export type PinAction =
  | { type: 'start' }
  | { type: 'cancel' }
  | { type: 'back' }
  /** `px` = the clicked point in photo pixels under the CURRENT georef; `ll` = the clicked map point. */
  | { type: 'click'; px: Px; ll: LatLng; image: ImageSize }

export const pinning = (s: PinState): boolean => s.step !== 'idle'

const inside = (p: Px, image: ImageSize) => p.x >= 0 && p.y >= 0 && p.x <= image.w && p.y <= image.h

export function reducePins(s: PinState, a: PinAction): PinState {
  switch (a.type) {
    case 'start':
      return { step: 'photo1' }
    case 'cancel':
      return INITIAL_PINS
    case 'back': {
      // Undo the last pin.
      if (s.step === 'map1') return { step: 'photo1' }
      if (s.step === 'photo2') return { step: 'map1', photo1: s.photo1 }
      if (s.step === 'map2') return { step: 'photo2', photo1: s.photo1, map1: s.map1 }
      return s
    }
    case 'click': {
      switch (s.step) {
        case 'idle':
          return s
        case 'photo1':
          return inside(a.px, a.image) ? { step: 'map1', photo1: a.px } : s
        case 'map1':
          return { step: 'photo2', photo1: s.photo1, map1: a.ll }
        case 'photo2':
          return inside(a.px, a.image) ? { step: 'map2', photo1: s.photo1, map1: s.map1, photo2: a.px } : s
        case 'map2': {
          try {
            const result = similarityFrom2Points(
              { px: s.photo1!, ll: s.map1! },
              { px: s.photo2!, ll: a.ll },
            )
            return { step: 'idle', result }
          } catch {
            // Coincident pins: restart so the user does not get stuck on a bad pair.
            return { step: 'photo1', error: 'degenerate' }
          }
        }
      }
    }
  }
}
