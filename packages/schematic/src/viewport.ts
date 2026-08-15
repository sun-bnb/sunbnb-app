import { generateChairGrid } from './grid'

/**
 * Shared viewport primitives for large-inventory map surfaces (track 020 P6).
 *
 * Both the consumer site map and the partner inventory editor render seat
 * markers; at thousands of seats, mounting one marker per seat is what makes
 * a page feel broken. The shared strategy is two-tier:
 *
 *   - LOD: below `LOD_SEAT_ZOOM`, render PARCELS (hull/box + count), never
 *     individual seats — zoomed out, culling alone removes nothing because
 *     every seat is inside the viewport.
 *   - Bounds culling: at seat-level zoom, render only the seats inside the
 *     (margin-expanded) viewport — the viewport at that zoom naturally
 *     contains a few dozen seats.
 *
 * Everything here is PURE (no map-library or React dependencies). Adapters
 * that extract bounds from a concrete map instance live app-side.
 */

// ── LOD tier ────────────────────────────────────────────────────────────────

/**
 * Seats render only when `zoom > LOD_SEAT_ZOOM`; at or below it, surfaces
 * render the parcel tier. 19 matches the consumer map's long-standing switch
 * (`zoom > 19`), where individual sunbeds become comfortably tappable.
 */
export const LOD_SEAT_ZOOM = 19

export type LodTier = 'parcels' | 'seats'

export function lodTier(zoom: number): LodTier {
  return zoom > LOD_SEAT_ZOOM ? 'seats' : 'parcels'
}

// ── Bounds ──────────────────────────────────────────────────────────────────

export interface ViewportBounds {
  north: number
  south: number
  east: number
  west: number
}

/**
 * Expand bounds by a fraction of each span (default 30%) so panning does not
 * pop markers at the viewport edge before the next idle refresh.
 *
 * Anti-meridian note: spans are treated as plain numeric ranges — venues are
 * single beaches, never date-line-crossing regions.
 */
export function expandBounds(bounds: ViewportBounds, marginFactor = 0.3): ViewportBounds {
  const latMargin = (bounds.north - bounds.south) * marginFactor
  const lngMargin = (bounds.east - bounds.west) * marginFactor
  return {
    north: bounds.north + latMargin,
    south: bounds.south - latMargin,
    east: bounds.east + lngMargin,
    west: bounds.west - lngMargin,
  }
}

export interface CullOptions {
  /**
   * Ids that are kept regardless of position — e.g. the guest's selected
   * seats, so a selection never silently vanishes off-viewport.
   */
  alwaysInclude?: ReadonlySet<string>
}

/**
 * Filter items to those inside `bounds`. Pure O(n); accessors keep it agnostic
 * of the String-vs-number coordinate shapes the two apps carry.
 *
 * A `null` bounds (map not yet idle) returns ONLY the alwaysInclude items —
 * the safe cold-start default: markers appear on the first idle event a few
 * hundred ms later rather than mounting the whole site meanwhile.
 */
export function cullToBounds<T>(
  items: readonly T[],
  bounds: ViewportBounds | null,
  getId: (item: T) => string,
  getLat: (item: T) => number,
  getLng: (item: T) => number,
  options: CullOptions = {},
): T[] {
  const always = options.alwaysInclude
  if (!bounds) {
    return always && always.size > 0 ? items.filter((i) => always.has(getId(i))) : []
  }
  return items.filter((item) => {
    if (always?.has(getId(item))) return true
    const lat = getLat(item)
    const lng = getLng(item)
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat <= bounds.north &&
      lat >= bounds.south &&
      lng <= bounds.east &&
      lng >= bounds.west
    )
  })
}

// ── Parcel footprint (the ItemGroup-sourced bounding box) ───────────────────

/** Physical sunbed footprint in meters — must match the repo's 2.1m constant. */
const SEAT_LENGTH_M = 2.1
const SEAT_HALF_DIAGONAL_M = SEAT_LENGTH_M / 2

export interface ParcelGridConfig {
  rows: number
  seatsPerRow: number
  horizontalGap: number
  verticalGap: number
  intraPairGap: number
  pairSeats: boolean
  /** Degrees, same convention as ItemGroup.rotation / generateChairGrid. */
  rotation: number
}

export interface LatLng {
  lat: number
  lng: number
}

/**
 * The rotated rectangular footprint of a parcel grid, as 4 corners in lat/lng
 * around the parcel ANCHOR — computed purely from ItemGroup-shaped grid
 * parameters, never from seat rows. This is what lets an overview render a
 * 3 000-seat site from ~40 ItemGroup records (track 020 P6).
 *
 * Method: run the SAME grid generator the seats were placed with (rotation 0),
 * take the meter-offset extents, pad by the seat's half-length on every side
 * (a slightly generous square pad — corners of rotated seats stay inside),
 * rotate the 4 corners by the parcel rotation, then project meters→degrees at
 * the anchor latitude exactly like `generateChairs` does.
 */
export function parcelFootprint(anchor: LatLng, config: ParcelGridConfig): LatLng[] {
  const cells = generateChairGrid({
    group: 0,
    rotation: 0,
    rows: Math.max(1, config.rows),
    seatsPerRow: Math.max(1, config.seatsPerRow),
    horizontalGap: config.horizontalGap,
    verticalGap: config.verticalGap,
    intraPairGap: config.intraPairGap,
    pairSeats: config.pairSeats,
  })

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const cell of cells) {
    if (cell.dx < minX) minX = cell.dx
    if (cell.dx > maxX) maxX = cell.dx
    if (cell.dy < minY) minY = cell.dy
    if (cell.dy > maxY) maxY = cell.dy
  }
  minX -= SEAT_HALF_DIAGONAL_M
  maxX += SEAT_HALF_DIAGONAL_M
  minY -= SEAT_HALF_DIAGONAL_M
  maxY += SEAT_HALF_DIAGONAL_M

  const rad = (config.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // Same rotation convention as generateChairGrid's cell placement:
  // dy' = dy·cos − dx·sin, dx' = dy·sin + dx·cos.
  const rotate = (dx: number, dy: number) => ({
    dx: dy * sin + dx * cos,
    dy: dy * cos - dx * sin,
  })

  const metersPerLat = 111320
  const metersPerLng = 111320 * Math.cos((anchor.lat * Math.PI) / 180)

  return [
    rotate(minX, minY),
    rotate(maxX, minY),
    rotate(maxX, maxY),
    rotate(minX, maxY),
  ].map(({ dx, dy }) => ({
    lat: anchor.lat + dy / metersPerLat,
    lng: anchor.lng + dx / metersPerLng,
  }))
}

/**
 * Padded axis-aligned bounding box around a set of coordinates, as 4 corners
 * (NW, NE, SE, SW). The editor's parcel tier renders THIS instead of seats at
 * overview zoom — a deliberate box (not a hull): cheap, orientation-free, and
 * generous for rotated parcels, which is fine at the zoom level where it shows.
 */
export function boundingBoxFromPoints(points: readonly LatLng[], paddingMeters = 2): LatLng[] {
  if (points.length === 0) return []
  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    if (p.lat > north) north = p.lat
    if (p.lat < south) south = p.lat
    if (p.lng > east) east = p.lng
    if (p.lng < west) west = p.lng
  }
  if (!Number.isFinite(north)) return []
  const midLat = (north + south) / 2
  const dLat = paddingMeters / 111320
  const dLng = paddingMeters / (111320 * Math.cos((midLat * Math.PI) / 180))
  north += dLat; south -= dLat; east += dLng; west -= dLng
  return [
    { lat: north, lng: west },
    { lat: north, lng: east },
    { lat: south, lng: east },
    { lat: south, lng: west },
  ]
}
