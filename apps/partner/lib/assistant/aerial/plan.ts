/**
 * Fitted aerial parcels -> `inventory_batch` op lists (track 030 S7). Pure: no DB, no network.
 *
 *   - `fitAerialDescriptor` (@repo/agent/geo/grid-fit) turns pixel intent + georef into ChairConfig
 *     specs and drops specs below `minConfidence` (default 0.4);
 *   - each spec -> `create_parcel` (numbers from the site's max + 1) and, when the fit says the beds
 *     face away from the sea, a `reverse … orientation` op;
 *   - a spec larger than one proposal may touch (MAX_TOUCHED = 1200 seats) is cut into row bands,
 *     each its own parcel; specs are then packed into proposals of <= 1200 seats;
 *   - warnings: footprint over an EXISTING parcel's sunbeds, and corners in the sea by the coastline
 *     (`signedShoreDistance` < 0). Without a shore (no COASTLINE_POSTGRES_URL / lookup failed) the
 *     caller passes `shore: null` + a note and the land check is skipped.
 */
import { signedShoreDistance, type GeoPoint } from '@repo/agent/geo/coastline'
import { enuToLatLng, latLngToEnu, type Enu, type Georef, type LatLng } from '@repo/agent/geo/georef'
import { fitAerialDescriptor, INTRA_PAIR_GAP, type ParcelSpec } from '@repo/agent/geo/grid-fit'
import type { AerialDescriptorV1 } from '@repo/agent/vision/aerial-schema'
import { SUNBED_HEIGHT, SUNBED_WIDTH } from '@repo/schematic/grid'
import type { InvOp } from '../proposals/inventory-sim'

export const DEFAULT_MIN_CONFIDENCE = 0.4
export const MAX_SEATS_PER_PROPOSAL = 1200
/** Extra metres around a footprint before an existing bed counts as overlapping. */
const OVERLAP_SLACK_M = 0.3
/** A corner this far (m) into the sea is reported; less is alignment noise on the waterline. */
const SEA_TOLERANCE_M = 1

export interface PlannedParcel {
  number: number
  sourceParcelId: string
  rows: number
  seatsPerRow: number
  paired: boolean
  seats: number
  confidence: number
  flipped: boolean
  warnings: string[]
}

export interface PlannedProposal {
  ops: InvOp[]
  parcels: PlannedParcel[]
  seats: number
}

export interface AerialPlanInput {
  descriptor: AerialDescriptorV1
  georef: Georef
  nextParcelNumber: number
  minConfidence?: number
  /** Existing sunbeds by parcel number (geo positions). */
  existing: Array<{ parcel: number; points: LatLng[] }>
  /** Shoreline around the site, or null when unavailable (the land check is skipped). */
  shore: { ways: GeoPoint[][]; water: GeoPoint[][] } | null
  maxSeatsPerProposal?: number
}

export interface AerialPlan {
  proposals: PlannedProposal[]
  warnings: string[]
  /** Fitted parcels left out for low confidence (already in `warnings`). */
  dropped: number
}

const RAD = Math.PI / 180
const add = (a: Enu, b: Enu): Enu => ({ e: a.e + b.e, n: a.n + b.n })
const mul = (a: Enu, k: number): Enu => ({ e: a.e * k, n: a.n * k })
const dot = (a: Enu, b: Enu) => a.e * b.e + a.n * b.n

/** Seat axis u and row axis v of a generator rotation (grid.ts: u = (cos, -sin), v = (sin, cos)). */
function axes(rotationDeg: number): { u: Enu; v: Enu } {
  const t = rotationDeg * RAD
  return { u: { e: Math.cos(t), n: -Math.sin(t) }, v: { e: Math.sin(t), n: Math.cos(t) } }
}

/** Along-u offset of the last bed centre from the first. */
function rowLength(spec: Pick<ParcelSpec, 'seatsPerRow' | 'paired' | 'horizontalGap'>): number {
  const k = spec.seatsPerRow - 1
  if (!spec.paired) return k * (SUNBED_WIDTH + spec.horizontalGap)
  return Math.floor(k / 2) * (2 * SUNBED_WIDTH + INTRA_PAIR_GAP + spec.horizontalGap) + (k % 2) * (SUNBED_WIDTH + INTRA_PAIR_GAP)
}

const rowStride = (spec: Pick<ParcelSpec, 'verticalGap'>) => SUNBED_HEIGHT + spec.verticalGap

/** Footprint in the spec's own (u, v) frame, around its anchor (the first bed centre). */
function footprint(spec: ParcelSpec) {
  const { u, v } = axes(spec.rotation)
  return {
    u, v,
    uMin: -SUNBED_WIDTH / 2, uMax: rowLength(spec) + SUNBED_WIDTH / 2,
    vMin: -SUNBED_HEIGHT / 2, vMax: (spec.rows - 1) * rowStride(spec) + SUNBED_HEIGHT / 2,
  }
}

function corners(spec: ParcelSpec): LatLng[] {
  const f = footprint(spec)
  return [[f.uMin, f.vMin], [f.uMax, f.vMin], [f.uMax, f.vMax], [f.uMin, f.vMax]].map(([a, b]) =>
    enuToLatLng(spec.anchor, add(mul(f.u, a!), mul(f.v, b!))),
  )
}

/** Cut a spec into row bands of at most `maxSeats` seats each (anchors shifted along v). */
export function splitSpecByRows(spec: ParcelSpec, maxSeats: number): ParcelSpec[] {
  const perRow = spec.seatsPerRow
  if (spec.rows * perRow <= maxSeats) return [spec]
  const band = Math.max(1, Math.floor(maxSeats / perRow))
  const { v } = axes(spec.rotation)
  const out: ParcelSpec[] = []
  for (let r = 0; r < spec.rows; r += band) {
    const rows = Math.min(band, spec.rows - r)
    out.push({
      ...spec,
      rows,
      anchor: r === 0 ? spec.anchor : enuToLatLng(spec.anchor, mul(v, r * rowStride(spec))),
      sourceRows: spec.sourceRows.slice(r, r + rows),
      warnings: [...spec.warnings],
    })
  }
  return out
}

function overlapWarning(spec: ParcelSpec, existing: AerialPlanInput['existing']): string | null {
  const f = footprint(spec)
  const hits: string[] = []
  for (const parcel of existing) {
    let n = 0
    for (const p of parcel.points) {
      const d = latLngToEnu(spec.anchor, p)
      const a = dot(d, f.u)
      const b = dot(d, f.v)
      if (a >= f.uMin - OVERLAP_SLACK_M && a <= f.uMax + OVERLAP_SLACK_M && b >= f.vMin - OVERLAP_SLACK_M && b <= f.vMax + OVERLAP_SLACK_M) n++
    }
    if (n > 0) hits.push(`parcel ${parcel.parcel} (${n} sunbed${n === 1 ? '' : 's'})`)
  }
  return hits.length ? `overlaps existing ${hits.join(', ')}` : null
}

function seaWarning(spec: ParcelSpec, shore: NonNullable<AerialPlanInput['shore']>): string | null {
  if (!shore.ways.length) return null
  let worst = 0
  for (const c of corners(spec)) {
    const d = signedShoreDistance(shore.ways, c, shore.water)
    if (d !== null && d < worst) worst = d
  }
  return worst < -SEA_TOLERANCE_M ? `reaches about ${Math.round(-worst)} m into the sea by the mapped coastline (check the photo alignment)` : null
}

export function planAerialLayout(input: AerialPlanInput): AerialPlan {
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE
  const maxSeats = input.maxSeatsPerProposal ?? MAX_SEATS_PER_PROPOSAL
  const fit = fitAerialDescriptor(input.descriptor, input.georef, { minConfidence })
  const warnings = [...fit.warnings]
  const dropped = fit.warnings.filter((w) => / dropped: confidence /.test(w)).length

  const specs: ParcelSpec[] = []
  for (const spec of fit.parcels) {
    const parts = splitSpecByRows(spec, maxSeats)
    if (parts.length > 1) warnings.push(`Parcel ${spec.sourceParcelId} has ${spec.rows * spec.seatsPerRow} sunbeds, more than one proposal can hold; split into ${parts.length} parcels by rows`)
    specs.push(...parts)
  }

  let next = input.nextParcelNumber
  const proposals: PlannedProposal[] = []
  let cur: PlannedProposal | null = null
  for (const spec of specs) {
    const number = next++
    const seats = spec.rows * spec.seatsPerRow
    const own: string[] = [...spec.warnings]
    const overlap = overlapWarning(spec, input.existing)
    if (overlap) own.push(overlap)
    if (input.shore) {
      const sea = seaWarning(spec, input.shore)
      if (sea) own.push(sea)
    }
    const ops: InvOp[] = [{
      op: 'create_parcel', number,
      anchor: { y: spec.anchor.lat, x: spec.anchor.lng },
      rows: spec.rows, seatsPerRow: spec.seatsPerRow, paired: spec.paired,
      horizontalGap: spec.horizontalGap, verticalGap: spec.verticalGap, rotation: spec.rotation,
    }]
    if (spec.flipOrientation) ops.push({ op: 'reverse', parcel: number, what: 'orientation' })
    const planned: PlannedParcel = {
      number, sourceParcelId: spec.sourceParcelId, rows: spec.rows, seatsPerRow: spec.seatsPerRow, paired: spec.paired,
      seats, confidence: Math.round(spec.confidence * 100) / 100, flipped: spec.flipOrientation, warnings: own,
    }
    if (!cur || cur.seats + seats > maxSeats) {
      cur = { ops: [], parcels: [], seats: 0 }
      proposals.push(cur)
    }
    cur.ops.push(...ops)
    cur.parcels.push(planned)
    cur.seats += seats
  }
  return { proposals, warnings, dropped }
}
