/**
 * Initial georef for the alignment UI (track 030 S7). Pure. Priority:
 *   1. DJI XMP nadir pose (+ EXIF focal length; DJI's common 24 mm-equivalent when missing),
 *   2. the site centre at a bed-size scale (descriptor's bed length, if extraction already ran),
 *   3. the site centre at a default ground width.
 * The user's alignment corrects whatever this gets wrong; it only has to land "roughly here".
 */
import { hfovFromFocal35, similarityFromBedSize, similarityFromDji, type ImageSize, type LatLng, type SimilarityGeoref } from '@repo/agent/geo/georef'
import type { PhotoMeta } from './photo-meta'

/** DJI Mavic / Air / Mini wide cameras are ~24 mm equivalent. */
export const DEFAULT_DRONE_FOCAL_35MM = 24
/** Without any scale hint: assume the photo spans this many metres across its long edge. */
export const DEFAULT_GROUND_SPAN_M = 120

export type SeedSource = 'dji' | 'bed_size' | 'default'

export interface Seed {
  georef: SimilarityGeoref
  source: SeedSource
  /** The DJI metadata says the camera was not pointing down (pitch outside -90 +- 10). */
  oblique: boolean
}

export function seedGeoref(input: { meta: PhotoMeta; image: ImageSize; siteCentre: LatLng; bedLengthPx?: number | null }): Seed {
  const { meta, image, siteCentre } = input
  const dji = meta.dji
  if (dji) {
    const hfovDeg = hfovFromFocal35(meta.focal35mm ?? DEFAULT_DRONE_FOCAL_35MM, image)
    const g = similarityFromDji({ lat: dji.lat, lng: dji.lng, relAltM: dji.relAltM, yawDeg: dji.yawDeg, pitchDeg: dji.pitchDeg, hfovDeg }, image)
    if (g) return { georef: g, source: 'dji', oblique: false }
  }
  const oblique = !!dji && !dji.nadir
  const bed = input.bedLengthPx && input.bedLengthPx > 0 ? similarityFromBedSize(siteCentre, image, input.bedLengthPx) : null
  if (bed) return { georef: bed, source: 'bed_size', oblique }
  return {
    georef: {
      kind: 'similarity',
      anchorPx: { x: image.w / 2, y: image.h / 2 },
      anchor: { ...siteCentre },
      metersPerPx: DEFAULT_GROUND_SPAN_M / Math.max(image.w, image.h, 1),
      rotationDeg: 0,
    },
    source: 'default',
    oblique,
  }
}
