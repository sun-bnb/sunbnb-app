/**
 * Georeferencing for aerial / drone photos (track 030 S7): image pixels <-> local metres <-> lat/lng.
 *
 * Frames:
 *   - **px**  — image pixels, origin top-left, x right, y DOWN.
 *   - **ENU** — local east/north metres around the georef's `anchor` (e east, n north).
 *   - **lat/lng** — equirectangular around the anchor, 111 320 m per degree of latitude and
 *     111 320·cos(anchor.lat) per degree of longitude — the same flat-earth constants as
 *     `apps/partner/.../inventory/chair-util.ts` (`generateChairs`) and
 *     `packages/schematic/src/viewport.ts`, so a fitted anchor lands where the generator puts beds.
 *
 * `Georef` is a tagged union. `similarity` (scale + rotation + translation; the image's y-flip is
 * built in) is the MVP — nadir drone shots and the manual overlay alignment both produce one.
 * `homography` is reserved for v2 (4-corner oblique alignment); the maths below supports it so the
 * union does not need a migration later, but nothing produces one yet.
 */

export const METERS_PER_DEG_LAT = 111320

export interface Px {
  x: number
  y: number
}
export interface Enu {
  e: number
  n: number
}
export interface LatLng {
  lat: number
  lng: number
}
export interface ImageSize {
  w: number
  h: number
}

export interface SimilarityGeoref {
  kind: 'similarity'
  /** The image point pinned to `anchor` (also the ENU origin). */
  anchorPx: Px
  anchor: LatLng
  /** Ground metres per image pixel (> 0). */
  metersPerPx: number
  /** Bearing of the image's "up" direction, degrees clockwise from north, [0, 360). */
  rotationDeg: number
}

export interface HomographyGeoref {
  kind: 'homography'
  /** ENU origin. */
  anchor: LatLng
  /** Row-major 3×3 matrix mapping homogeneous px (x, y, 1) to homogeneous ENU (e, n, w). */
  h: [number, number, number, number, number, number, number, number, number]
}

export type Georef = SimilarityGeoref | HomographyGeoref

const RAD = Math.PI / 180

export const normDeg = (d: number): number => ((d % 360) + 360) % 360

export function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos(lat * RAD)
}

// ─── ENU <-> lat/lng ───────────────────────────────────────────────────────────

export function enuToLatLng(anchor: LatLng, p: Enu): LatLng {
  return { lat: anchor.lat + p.n / METERS_PER_DEG_LAT, lng: anchor.lng + p.e / metersPerDegLng(anchor.lat) }
}

export function latLngToEnu(anchor: LatLng, p: LatLng): Enu {
  return { e: (p.lng - anchor.lng) * metersPerDegLng(anchor.lat), n: (p.lat - anchor.lat) * METERS_PER_DEG_LAT }
}

// ─── px <-> ENU ────────────────────────────────────────────────────────────────

function invert3(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number]
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-18) throw new Error('Georef homography is singular')
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det)
}

function applyH(m: readonly number[], x: number, y: number): [number, number] {
  const w = m[6]! * x + m[7]! * y + m[8]!
  return [(m[0]! * x + m[1]! * y + m[2]!) / w, (m[3]! * x + m[4]! * y + m[5]!) / w]
}

export function pxToEnu(g: Georef, p: Px): Enu {
  if (g.kind === 'homography') {
    const [e, n] = applyH(g.h, p.x, p.y)
    return { e, n }
  }
  const r = g.rotationDeg * RAD
  const s = g.metersPerPx
  const dx = p.x - g.anchorPx.x
  const dy = p.y - g.anchorPx.y
  // image right = (cos r, −sin r) in ENU; image DOWN = −up = (−sin r, −cos r).
  return { e: s * (dx * Math.cos(r) - dy * Math.sin(r)), n: s * (-dx * Math.sin(r) - dy * Math.cos(r)) }
}

export function enuToPx(g: Georef, p: Enu): Px {
  if (g.kind === 'homography') {
    const [x, y] = applyH(invert3(g.h), p.e, p.n)
    return { x, y }
  }
  const r = g.rotationDeg * RAD
  const s = g.metersPerPx
  // Inverse of the orthonormal (reflected) basis above, divided by the scale.
  const dx = (p.e * Math.cos(r) - p.n * Math.sin(r)) / s
  const dy = (-p.e * Math.sin(r) - p.n * Math.cos(r)) / s
  return { x: g.anchorPx.x + dx, y: g.anchorPx.y + dy }
}

export function pxToLatLng(g: Georef, p: Px): LatLng {
  return enuToLatLng(g.anchor, pxToEnu(g, p))
}

export function latLngToPx(g: Georef, p: LatLng): Px {
  return enuToPx(g, latLngToEnu(g.anchor, p))
}

/** Ground metres per pixel at an image point (exact for a similarity; local for a homography). */
export function metersPerPxAt(g: Georef, p: Px): number {
  if (g.kind === 'similarity') return g.metersPerPx
  const a = pxToEnu(g, p)
  const b = pxToEnu(g, { x: p.x + 1, y: p.y })
  const c = pxToEnu(g, { x: p.x, y: p.y + 1 })
  return Math.sqrt(Math.abs((b.e - a.e) * (c.n - a.n) - (b.n - a.n) * (c.e - a.e)))
}

// ─── solvers / seeds ───────────────────────────────────────────────────────────

/**
 * The similarity that pins two image points to two map points exactly (the manual 2-pin alignment).
 * `p1` becomes the anchor. Throws when the pins coincide in either space.
 */
export function similarityFrom2Points(p1: { px: Px; ll: LatLng }, p2: { px: Px; ll: LatLng }): SimilarityGeoref {
  const v = latLngToEnu(p1.ll, p2.ll)
  const dx = p2.px.x - p1.px.x
  const dUp = -(p2.px.y - p1.px.y)
  const lenImg = Math.hypot(dx, dUp)
  const lenGround = Math.hypot(v.e, v.n)
  if (lenImg < 1e-9 || lenGround < 1e-9) throw new Error('Alignment pins must be two distinct points')
  // Bearing of the ground vector minus the bearing the image vector would have if "up" were north.
  const rotationDeg = normDeg((Math.atan2(v.e, v.n) - Math.atan2(dx, dUp)) / RAD)
  return { kind: 'similarity', anchorPx: { ...p1.px }, anchor: { ...p1.ll }, metersPerPx: lenGround / lenImg, rotationDeg }
}

export interface DjiPose {
  lat: number
  lng: number
  /** Height above the take-off point (`drone-dji:RelativeAltitude`), metres. */
  relAltM: number
  /** Gimbal yaw, degrees clockwise from north — the bearing of the image's top edge in a nadir shot. */
  yawDeg: number
  /** Gimbal pitch, degrees; −90 = straight down. */
  pitchDeg: number
  /** Horizontal field of view across the image width, degrees. */
  hfovDeg: number
}

/** Pitch tolerance around straight-down for a shot to count as nadir (design: ±10°). */
export const NADIR_TOLERANCE_DEG = 10

export const isNadir = (pitchDeg: number): boolean => Math.abs(pitchDeg + 90) <= NADIR_TOLERANCE_DEG

/**
 * Seed georef from DJI metadata: drone position = image centre, ground width = 2·alt·tan(hfov/2),
 * image top toward the gimbal yaw. Returns null for an oblique shot (pitch outside −90 ± 10°) or
 * nonsensical inputs — oblique photos are refused in the MVP. Relative altitude is above take-off,
 * so a launch from a promenade above the beach overestimates scale slightly; the user's alignment
 * step corrects it.
 */
export function similarityFromDji(pose: DjiPose, image: ImageSize): SimilarityGeoref | null {
  if (!isNadir(pose.pitchDeg)) return null
  if (!(pose.relAltM > 0) || !(pose.hfovDeg > 0 && pose.hfovDeg < 180) || !(image.w > 0 && image.h > 0)) return null
  if (!Number.isFinite(pose.lat) || !Number.isFinite(pose.lng)) return null
  const groundWidth = 2 * pose.relAltM * Math.tan((pose.hfovDeg / 2) * RAD)
  return {
    kind: 'similarity',
    anchorPx: { x: image.w / 2, y: image.h / 2 },
    anchor: { lat: pose.lat, lng: pose.lng },
    metersPerPx: groundWidth / image.w,
    rotationDeg: normDeg(pose.yawDeg),
  }
}

/**
 * Horizontal FOV from EXIF `FocalLengthIn35mmFormat`. The 35 mm equivalent is defined on the
 * diagonal (43.27 mm), so the width share follows the image's aspect ratio.
 */
export function hfovFromFocal35(focal35mm: number, image: ImageSize): number {
  const halfDiag = Math.atan(43.2666 / (2 * focal35mm))
  const ratio = image.w / Math.hypot(image.w, image.h)
  return (2 * Math.atan(Math.tan(halfDiag) * ratio)) / RAD
}

/** Fallback seed without metadata: image centre on the site centre, scale from the bed length (2.1 m). */
export function similarityFromBedSize(centre: LatLng, image: ImageSize, bedLengthPx: number, rotationDeg = 0): SimilarityGeoref | null {
  if (!(bedLengthPx > 0) || !(image.w > 0 && image.h > 0)) return null
  return { kind: 'similarity', anchorPx: { x: image.w / 2, y: image.h / 2 }, anchor: { ...centre }, metersPerPx: 2.1 / bedLengthPx, rotationDeg: normDeg(rotationDeg) }
}

// ─── DJI XMP ───────────────────────────────────────────────────────────────────

export interface DjiXmp {
  lat: number
  lng: number
  relAltM: number
  yawDeg: number
  pitchDeg: number
  /** Gimbal pitch within NADIR_TOLERANCE_DEG of straight down. */
  nadir: boolean
}

function xmpNumber(xmp: string, ...names: string[]): number | null {
  for (const name of names) {
    // Attribute form `drone-dji:Name="+12.3"` or element form `<drone-dji:Name>+12.3</drone-dji:Name>`.
    const re = new RegExp(`drone-dji:${name}\\s*=\\s*["']\\s*([+-]?[0-9.]+(?:[eE][+-]?\\d+)?)\\s*["']|<drone-dji:${name}>\\s*([+-]?[0-9.]+(?:[eE][+-]?\\d+)?)\\s*</drone-dji:${name}>`)
    const m = re.exec(xmp)
    if (m) {
      const v = Number(m[1] ?? m[2])
      if (Number.isFinite(v)) return v
    }
  }
  return null
}

/**
 * Parse the DJI fields the seed needs out of a raw XMP packet. Null when position, altitude,
 * yaw or pitch is missing. Older firmware spells longitude `GpsLongtitude`; both are accepted.
 */
export function parseDjiXmp(xmp: string): DjiXmp | null {
  const lat = xmpNumber(xmp, 'GpsLatitude', 'GPSLatitude')
  const lng = xmpNumber(xmp, 'GpsLongitude', 'GpsLongtitude', 'GPSLongitude')
  const relAltM = xmpNumber(xmp, 'RelativeAltitude')
  const yawDeg = xmpNumber(xmp, 'GimbalYawDegree')
  const pitchDeg = xmpNumber(xmp, 'GimbalPitchDegree')
  if (lat === null || lng === null || relAltM === null || yawDeg === null || pitchDeg === null) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng, relAltM, yawDeg, pitchDeg, nadir: isNadir(pitchDeg) }
}

// ─── overlay CSS transform ─────────────────────────────────────────────────────

export interface Affine2D {
  /** CSS `matrix(a, b, c, d, e, f)`: (x, y) -> (a·x + c·y + e, b·x + d·y + f). */
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/** The affine map taking three source points onto three destination points. */
export function affineFrom3Points(src: [Px, Px, Px], dst: [Px, Px, Px]): Affine2D {
  const [p0, p1, p2] = src
  const [q0, q1, q2] = dst
  const ux = p1.x - p0.x, uy = p1.y - p0.y
  const vx = p2.x - p0.x, vy = p2.y - p0.y
  const det = ux * vy - uy * vx
  if (Math.abs(det) < 1e-12) throw new Error('Source points are collinear')
  const qux = q1.x - q0.x, quy = q1.y - q0.y
  const qvx = q2.x - q0.x, qvy = q2.y - q0.y
  // M · [u v] = [qu qv]  =>  M = [qu qv] · [u v]^-1
  const a = (qux * vy - qvx * uy) / det
  const c = (-qux * vx + qvx * ux) / det
  const b = (quy * vy - qvy * uy) / det
  const d = (-quy * vx + qvy * ux) / det
  return { a, b, c, d, e: q0.x - a * p0.x - c * p0.y, f: q0.y - b * p0.x - d * p0.y }
}

/**
 * CSS transform placing the image (laid out at its natural size, `transform-origin: 0 0`) on the
 * map. `project` is the caller's lat/lng -> overlay-pane pixel mapping (Google's
 * `fromLatLngToDivPixel`); three image corners are pushed through georef + projection and the
 * affine through them is returned. Exact for a similarity under a locally linear projection
 * (Web Mercator over a beach); for a homography it is the 3-corner approximation (v2 will need
 * `matrix3d`).
 */
export function cssMatrixFor(g: Georef, image: ImageSize, project: (ll: LatLng) => Px): Affine2D & { css: string } {
  const src: [Px, Px, Px] = [{ x: 0, y: 0 }, { x: image.w, y: 0 }, { x: 0, y: image.h }]
  const dst = src.map((p) => project(pxToLatLng(g, p))) as [Px, Px, Px]
  const m = affineFrom3Points(src, dst)
  return { ...m, css: `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})` }
}
