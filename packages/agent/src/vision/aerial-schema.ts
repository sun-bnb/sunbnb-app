/**
 * The aerial-photo vision descriptor (track 030 S7): what the model reports about a drone photo of
 * a beach. Pixel-space INTENT only — row endpoints and unit counts, never per-bed points or
 * metres; the deterministic fit (`geo/grid-fit.ts`) turns it into parcel geometry.
 *
 * Two schemas live here on purpose:
 *   - `AERIAL_DESCRIPTOR_SCHEMA` is the wire schema sent as the structured-output format. It stays
 *     inside the structured-outputs subset (no numeric / length constraints — the API does not
 *     enforce them there), every object closed and every field required.
 *   - `validateAerialDescriptor` re-checks the shape with `validateJsonSchema` and adds the range
 *     checks the wire schema cannot carry (coordinates inside the image, confidences 0..1,
 *     units >= 1, unique parcel ids).
 */
import type { Georef, ImageSize, Px } from '../geo/georef.ts'
import { validateJsonSchema, type JsonSchema } from '../schema.ts'

export type AerialView = 'nadir' | 'oblique' | 'unclear'
/** Which image edge the sea is on (`none` = no sea visible). */
export type SeaSide = 'top' | 'bottom' | 'left' | 'right' | 'none'
/**
 * Where a person lying on the beds looks (their feet end): toward the sea, away from it, or
 * unclear. The fit maps this to the generator's orientation in ONE place (`needsOrientationFlip`).
 */
export type AerialFacing = 'sea' | 'land' | 'unclear'

export interface AerialRowV1 {
  /** Centre of the first UNIT in the row (for pairs: the shared parasol / pair centre), image px. */
  first: Px
  /** Centre of the last unit. Equal to `first` when the row has one unit. */
  last: Px
  /** Units in the row (a pair counts once), occluded ones included. */
  units: number
  /** Units are pairs of beds sharing a parasol. */
  paired: boolean
  /** Beds counted but hidden (parasol canopy, trees, people). */
  occludedBeds: number
  confidence: number
}

export interface AerialParcelV1 {
  id: string
  /** Front (nearest the sea) first, then landward. */
  rows: AerialRowV1[]
  facing: AerialFacing
  confidence: number
}

export interface AerialDescriptorV1 {
  image: ImageSize
  view: AerialView
  /** False when the photo cannot support a layout (oblique, no beds, too blurry, …). */
  usable: boolean
  /** Median single-bed footprint in px (0 when no beds are visible). */
  bed: { lengthPx: number; widthPx: number }
  shoreline: { points: Px[]; seaSide: SeaSide }
  parcels: AerialParcelV1[]
  /** Short notes on things deliberately left out ("stacked beds by the kiosk"). */
  ignored: string[]
}

/** Sent to the partner client (SSE) to open the alignment UI for an uploaded photo. */
export interface AlignPhotoEvent {
  uploadId: string
  seed: Georef
  image: ImageSize
}

const PX: JsonSchema = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
}

const ROW: JsonSchema = {
  type: 'object',
  properties: {
    first: PX,
    last: PX,
    units: { type: 'integer' },
    paired: { type: 'boolean' },
    occludedBeds: { type: 'integer' },
    confidence: { type: 'number' },
  },
  required: ['first', 'last', 'units', 'paired', 'occludedBeds', 'confidence'],
  additionalProperties: false,
}

const PARCEL: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    rows: { type: 'array', items: ROW },
    facing: { type: 'string', enum: ['sea', 'land', 'unclear'] },
    confidence: { type: 'number' },
  },
  required: ['id', 'rows', 'facing', 'confidence'],
  additionalProperties: false,
}

export const AERIAL_DESCRIPTOR_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    image: {
      type: 'object',
      properties: { w: { type: 'integer' }, h: { type: 'integer' } },
      required: ['w', 'h'],
      additionalProperties: false,
    },
    view: { type: 'string', enum: ['nadir', 'oblique', 'unclear'] },
    usable: { type: 'boolean' },
    bed: {
      type: 'object',
      properties: { lengthPx: { type: 'number' }, widthPx: { type: 'number' } },
      required: ['lengthPx', 'widthPx'],
      additionalProperties: false,
    },
    shoreline: {
      type: 'object',
      properties: {
        points: { type: 'array', items: PX },
        seaSide: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'none'] },
      },
      required: ['points', 'seaSide'],
      additionalProperties: false,
    },
    parcels: { type: 'array', items: PARCEL },
    ignored: { type: 'array', items: { type: 'string' } },
  },
  required: ['image', 'view', 'usable', 'bed', 'shoreline', 'parcels', 'ignored'],
  additionalProperties: false,
}

export type AerialValidation = { ok: true; descriptor: AerialDescriptorV1 } | { ok: false; errors: string[] }

/** Points may sit up to this many px outside the frame (a parasol centre on the edge). */
const EDGE_SLACK_PX = 2

/**
 * Shape + range validation. `expectedImage`, when given, must match the reported image size (the
 * model is told the size of the image it was sent; a mismatch means its coordinates are in some
 * other frame).
 */
export function validateAerialDescriptor(value: unknown, expectedImage?: ImageSize): AerialValidation {
  const errors = validateJsonSchema(AERIAL_DESCRIPTOR_SCHEMA, value, 'descriptor')
  if (errors.length) return { ok: false, errors }
  const d = value as AerialDescriptorV1
  const { w, h } = d.image
  if (!(w > 0 && h > 0)) errors.push('descriptor.image must have a positive size')
  if (expectedImage && (expectedImage.w !== w || expectedImage.h !== h))
    errors.push(`descriptor.image is ${w}x${h}, expected ${expectedImage.w}x${expectedImage.h}`)
  const inImage = (p: Px, path: string) => {
    if (p.x < -EDGE_SLACK_PX || p.y < -EDGE_SLACK_PX || p.x > w + EDGE_SLACK_PX || p.y > h + EDGE_SLACK_PX)
      errors.push(`${path} (${p.x}, ${p.y}) is outside the ${w}x${h} image`)
  }
  const unit = (v: number, path: string) => {
    if (!(v >= 0 && v <= 1)) errors.push(`${path} must be within 0..1`)
  }
  if (d.bed.lengthPx < 0 || d.bed.widthPx < 0) errors.push('descriptor.bed sizes must be >= 0')
  if (d.usable && d.parcels.length > 0 && !(d.bed.lengthPx > 0)) errors.push('descriptor.bed.lengthPx must be > 0 when beds are reported')
  d.shoreline.points.forEach((p, i) => inImage(p, `descriptor.shoreline.points[${i}]`))
  const ids = new Set<string>()
  d.parcels.forEach((parcel, pi) => {
    const pp = `descriptor.parcels[${pi}]`
    if (ids.has(parcel.id)) errors.push(`${pp}.id "${parcel.id}" is not unique`)
    ids.add(parcel.id)
    unit(parcel.confidence, `${pp}.confidence`)
    if (parcel.rows.length === 0) errors.push(`${pp}.rows must not be empty`)
    parcel.rows.forEach((row, ri) => {
      const rp = `${pp}.rows[${ri}]`
      inImage(row.first, `${rp}.first`)
      inImage(row.last, `${rp}.last`)
      if (row.units < 1) errors.push(`${rp}.units must be >= 1`)
      if (row.occludedBeds < 0) errors.push(`${rp}.occludedBeds must be >= 0`)
      if (row.occludedBeds > row.units * (row.paired ? 2 : 1)) errors.push(`${rp}.occludedBeds exceeds the beds in the row`)
      unit(row.confidence, `${rp}.confidence`)
    })
  })
  return errors.length ? { ok: false, errors } : { ok: true, descriptor: d }
}
