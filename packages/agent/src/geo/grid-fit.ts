/**
 * Aerial descriptor + georef -> rectangular parcel specs (track 030 S7). Pure and deterministic:
 * the model only reports pixel-space row endpoints and unit counts; this turns them into the exact
 * `ChairConfig` the partner inventory generator (`generateChairGrid`) takes.
 *
 * Generator convention (`packages/schematic/src/grid.ts` + `chair-util.generateChairs`, where `dx`
 * is east metres and `dy` north metres): the anchor is the FIRST BED (R01C01); with rotation θ the
 * seat axis is u = (cosθ, −sinθ) and the row axis v = (sinθ, cosθ) in (east, north) — v is u
 * turned 90° counter-clockwise. A pair's beds sit 0.4 m + bed width apart (`intraPairGap`), unit
 * stride = (paired ? 2W + 0.4 : W) + horizontalGap, row stride = 2.1 + verticalGap.
 *
 * Fit, per descriptor parcel:
 *   1. split rows into rectangular groups — consecutive rows with the same unit count and pairing,
 *      and rows whose start is not staggered by more than half a unit pitch;
 *   2. seat direction = mean row vector (rows aligned to one sense first), pitch from the endpoints;
 *   3. pick the corner so R01 is the FRONT row (nearest the sea) and v points landward — i.e. flip u
 *      when the front->back direction disagrees with u turned 90° CCW;
 *   4. row pitch / offset by least squares over the row centres, anchor from all rows' starts;
 *   5. gaps from pitches, clamped to sane ranges (warned), ≤ 99 rows / seats (warned);
 *   6. confidence = parcel × mean row confidence × fit quality (endpoint residual vs the grid).
 */
import { SUNBED_HEIGHT, SUNBED_WIDTH } from '@repo/schematic/grid'
import type { AerialDescriptorV1, AerialFacing, AerialRowV1, SeaSide } from '../vision/aerial-schema.ts'
import { enuToLatLng, normDeg, pxToEnu, type Enu, type Georef, type LatLng } from './georef.ts'

/** The generator's pair gap — `createParcel` in the partner inventory sim always sends 0.4. */
export const INTRA_PAIR_GAP = 0.4
/** Partner defaults (`parcel-config.ts`, `plan-extraction.ts`) when a pitch cannot be measured. */
export const DEFAULT_HORIZONTAL_GAP = 1
export const DEFAULT_VERTICAL_GAP = 1.5
export const MAX_ROWS = 99
export const MAX_SEATS_PER_ROW = 99
export const GAP_LIMITS = { horizontal: [0, 10], vertical: [0, 20] } as const

export interface ParcelSpec {
  /** Descriptor parcel this came from (a parcel can yield several specs after splitting). */
  sourceParcelId: string
  /** Descriptor row indexes covered, front -> back. */
  sourceRows: number[]
  /** First bed (R01C01) centre — the ChairConfig `baseLat` / `baseLng`. */
  anchor: LatLng
  rows: number
  seatsPerRow: number
  paired: boolean
  horizontalGap: number
  verticalGap: number
  intraPairGap: number
  /** Degrees, the generator's parcel rotation (seat axis (cosθ, −sinθ) in east/north). */
  rotation: number
  /** Emit a `reverse … orientation` op after creating the parcel. */
  flipOrientation: boolean
  /** 0..1 */
  confidence: number
  warnings: string[]
}

export interface GridFitResult {
  parcels: ParcelSpec[]
  warnings: string[]
}

// ─── facing convention (single point of truth) ────────────────────────────────

/**
 * Whether the fitted parcel needs its bed orientation reversed for the reported `facing`.
 *
 * ASSUMPTION (unverified against real beds — confirm before relying on it): a bed glyph's HEAD is
 * the art's −y end (`packages/schematic/src/bed-glyph.ts`: "head toward −y", where the parasol
 * nudge sits), drawn rotated clockwise by the bed's rotation on a north-up map, so the head points
 * at bearing θ — along +v, the row axis. The fit always makes R01 the sea-side row with v pointing
 * landward, so an unflipped parcel has heads landward and feet toward the sea: the occupant looks
 * at the sea. Hence only `land` flips. If the glyph's head turns out to be the other end, invert
 * this function (and nothing else).
 */
export function needsOrientationFlip(facing: AerialFacing): boolean {
  return facing === 'land'
}

// ─── vector helpers ────────────────────────────────────────────────────────────

const add = (a: Enu, b: Enu): Enu => ({ e: a.e + b.e, n: a.n + b.n })
const sub = (a: Enu, b: Enu): Enu => ({ e: a.e - b.e, n: a.n - b.n })
const mul = (a: Enu, k: number): Enu => ({ e: a.e * k, n: a.n * k })
const dot = (a: Enu, b: Enu): number => a.e * b.e + a.n * b.n
const len = (a: Enu): number => Math.hypot(a.e, a.n)
const unit = (a: Enu): Enu => mul(a, 1 / len(a))
/** 90° counter-clockwise in (east, north). */
const ccw = (a: Enu): Enu => ({ e: -a.n, n: a.e })
/** 90° clockwise in (east, north). */
const cw = (a: Enu): Enu => ({ e: a.n, n: -a.e })
const round = (v: number, step: number) => Math.round(v / step) * step
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

interface EnuRow {
  index: number
  src: AerialRowV1
  f: Enu
  l: Enu
  mid: Enu
}

/** Landward direction in ENU from the image edge the sea is on, or null. */
function landwardFromSeaSide(g: Georef, seaSide: SeaSide, at: { x: number; y: number }): Enu | null {
  const d = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0], none: null }[seaSide]
  if (!d) return null
  const a = pxToEnu(g, at)
  const b = pxToEnu(g, { x: at.x + d[0]! * 10, y: at.y + d[1]! * 10 })
  const v = sub(b, a)
  return len(v) > 0 ? unit(v) : null
}

/** Unit stride along the seat axis for a gap. */
const unitPitch = (paired: boolean, hGap: number) => (paired ? 2 * SUNBED_WIDTH + INTRA_PAIR_GAP : SUNBED_WIDTH) + hGap

/** Seat direction of a set of rows: the length-weighted mean vector, each row aligned to the first. */
function seatDirection(rows: EnuRow[]): Enu | null {
  let ref: Enu | null = null
  let sum: Enu = { e: 0, n: 0 }
  for (const r of rows) {
    if (r.src.units < 2) continue
    const d = sub(r.l, r.f)
    if (len(d) < 1e-6) continue
    if (!ref) ref = d
    sum = add(sum, dot(d, ref) < 0 ? mul(d, -1) : d)
  }
  return ref && len(sum) > 0 ? unit(sum) : null
}

// ─── fit ───────────────────────────────────────────────────────────────────────

/** Fit one rectangular group of rows (same units / pairing). Returns null + warnings when hopeless. */
function fitGroup(
  parcelId: string,
  rows: EnuRow[],
  facing: AerialFacing,
  parcelConfidence: number,
  landward: Enu | null,
  g: Georef,
): { spec: ParcelSpec; stagger: number[] } {
  const warnings: string[] = []
  const paired = rows[0]!.src.paired
  const units = rows[0]!.src.units
  const n = rows.length

  // Front -> back direction: the row progression, else the sea side.
  const progression = n >= 2 ? sub(rows[n - 1]!.mid, rows[0]!.mid) : null
  const back = progression && len(progression) > 1e-6 ? unit(progression) : landward

  let u = seatDirection(rows)
  if (!u) {
    if (back) u = cw(back)
    else {
      u = { e: 1, n: 0 }
      warnings.push('Row direction could not be measured (single unit, no sea side); rotation assumed 0°')
    }
  }
  let v = ccw(u)
  if (back) {
    if (dot(back, v) < 0) {
      u = mul(u, -1)
      v = mul(v, -1)
    }
  } else {
    warnings.push('Front row could not be determined (single row, no sea side); numbering may start from the back')
  }

  // Seat pitch: weighted by the number of steps each row spans.
  let steps = 0
  let span = 0
  for (const r of rows) {
    if (r.src.units < 2) continue
    steps += r.src.units - 1
    span += Math.abs(dot(sub(r.l, r.f), u))
  }
  let pitch: number
  if (steps > 0) pitch = span / steps
  else {
    pitch = unitPitch(paired, DEFAULT_HORIZONTAL_GAP)
    if (units >= 1) warnings.push(`Seat spacing could not be measured (one unit per row); default gap ${DEFAULT_HORIZONTAL_GAP} m`)
  }

  // Row positions along v: least squares t_r = t0 + r·rowPitch.
  const ts = rows.map((r) => dot(r.mid, v))
  let rowPitch: number
  let t0: number
  if (n >= 2) {
    const rMean = (n - 1) / 2
    const tMean = ts.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    ts.forEach((t, r) => {
      num += (r - rMean) * (t - tMean)
      den += (r - rMean) ** 2
    })
    rowPitch = num / den
    t0 = tMean - rowPitch * rMean
  } else {
    rowPitch = SUNBED_HEIGHT + DEFAULT_VERTICAL_GAP
    t0 = ts[0]!
  }

  // Row starts along u (unit centres), from both endpoints via the row centre.
  const starts = rows.map((r) => dot(r.mid, u!) - ((r.src.units - 1) * pitch) / 2)
  const s0 = starts.reduce((a, b) => a + b, 0) / n

  // Fit quality: endpoint residuals against the fitted lattice.
  let sq = 0
  let cnt = 0
  rows.forEach((r, i) => {
    const start = add(mul(u!, s0), mul(v, t0 + i * rowPitch))
    const end = add(start, mul(u!, (r.src.units - 1) * pitch))
    const [a, b] = dot(r.f, u!) <= dot(r.l, u!) ? [r.f, r.l] : [r.l, r.f]
    sq += len(sub(a, start)) ** 2 + len(sub(b, end)) ** 2
    cnt += 2
  })
  const rms = Math.sqrt(sq / cnt)
  const scale = Math.min(pitch, n >= 2 ? Math.abs(rowPitch) : pitch)
  const quality = scale > 0 ? clamp01(1 - rms / (0.5 * scale)) : 0

  // Gaps, clamped.
  let horizontalGap = pitch - (paired ? 2 * SUNBED_WIDTH + INTRA_PAIR_GAP : SUNBED_WIDTH)
  let verticalGap = rowPitch - SUNBED_HEIGHT
  const [hMin, hMax] = GAP_LIMITS.horizontal
  const [vMin, vMax] = GAP_LIMITS.vertical
  if (horizontalGap < hMin - 0.05) warnings.push(`Measured seat spacing leaves ${horizontalGap.toFixed(2)} m between units; clamped to ${hMin} m`)
  if (horizontalGap > hMax) warnings.push(`Measured seat spacing gap ${horizontalGap.toFixed(2)} m; clamped to ${hMax} m`)
  if (verticalGap < vMin - 0.05) warnings.push(`Measured row spacing leaves ${verticalGap.toFixed(2)} m between rows; clamped to ${vMin} m`)
  if (verticalGap > vMax) warnings.push(`Measured row gap ${verticalGap.toFixed(2)} m; clamped to ${vMax} m`)
  horizontalGap = round(Math.min(hMax, Math.max(hMin, horizontalGap)), 0.01)
  verticalGap = round(Math.min(vMax, Math.max(vMin, verticalGap)), 0.01)

  // Size limits.
  let rowsOut = n
  if (rowsOut > MAX_ROWS) {
    warnings.push(`${n} rows exceed the ${MAX_ROWS}-row limit; only the front ${MAX_ROWS} are kept`)
    rowsOut = MAX_ROWS
  }
  let seatsPerRow = paired ? units * 2 : units
  const maxSeats = paired ? MAX_SEATS_PER_ROW - 1 : MAX_SEATS_PER_ROW
  if (seatsPerRow > maxSeats) {
    warnings.push(`${seatsPerRow} beds per row exceed the ${MAX_SEATS_PER_ROW}-seat limit; clamped to ${maxSeats}`)
    seatsPerRow = maxSeats
  }

  // Anchor: first unit centre, then back half a pair to the first bed.
  const unitCentre = add(mul(u, s0), mul(v, t0))
  const firstBed = paired ? sub(unitCentre, mul(u, (SUNBED_WIDTH + INTRA_PAIR_GAP) / 2)) : unitCentre
  const anchor = enuToLatLng(g.anchor, firstBed)
  const rotation = round(normDeg((Math.atan2(-u.n, u.e) * 180) / Math.PI), 0.01) % 360

  const occluded = rows.reduce((a, r) => a + r.src.occludedBeds, 0)
  const beds = rows.reduce((a, r) => a + r.src.units * (r.src.paired ? 2 : 1), 0)
  if (occluded > 0) warnings.push(`${occluded} of ${beds} beds were hidden in the photo and inferred`)
  if (facing === 'unclear') warnings.push('Bed orientation unclear in the photo; assumed facing the sea')
  const rowConfidence = rows.reduce((a, r) => a + r.src.confidence, 0) / n
  const confidence = clamp01(parcelConfidence * rowConfidence * quality * (1 - 0.5 * (beds ? occluded / beds : 0)))

  return {
    spec: {
      sourceParcelId: parcelId,
      sourceRows: rows.map((r) => r.index),
      anchor,
      rows: rowsOut,
      seatsPerRow,
      paired,
      horizontalGap,
      verticalGap,
      intraPairGap: INTRA_PAIR_GAP,
      rotation,
      flipOrientation: needsOrientationFlip(facing),
      confidence,
      warnings,
    },
    stagger: starts.map((s) => s - s0),
  }
}

/** Split rows into runs where each new row keeps the same units/pairing and isn't staggered. */
function splitRuns(rows: EnuRow[], fitRun: (run: EnuRow[]) => { stagger: number[]; pitch: number }): EnuRow[][] {
  const byShape: EnuRow[][] = []
  for (const r of rows) {
    const cur = byShape[byShape.length - 1]
    if (cur && cur[0]!.src.units === r.src.units && cur[0]!.src.paired === r.src.paired) cur.push(r)
    else byShape.push([r])
  }
  const out: EnuRow[][] = []
  for (const run of byShape) {
    if (run.length < 2) {
      out.push(run)
      continue
    }
    // Stagger: compare each row's start with the run's first row, using the run's own fit.
    const { stagger, pitch } = fitRun(run)
    const tol = Math.max(0.5, pitch / 2)
    let cur: EnuRow[] = [run[0]!]
    let base = stagger[0]!
    for (let i = 1; i < run.length; i++) {
      if (Math.abs(stagger[i]! - base) > tol) {
        out.push(cur)
        cur = []
        base = stagger[i]!
      }
      cur.push(run[i]!)
    }
    out.push(cur)
  }
  return out
}

export interface FitOptions {
  /** Skip parcels / runs whose fitted confidence is below this (default 0: keep all). */
  minConfidence?: number
}

/** Descriptor (pixel intent) + georef -> parcel specs in the generator's convention. */
export function fitAerialDescriptor(d: AerialDescriptorV1, g: Georef, opts: FitOptions = {}): GridFitResult {
  const warnings: string[] = []
  const parcels: ParcelSpec[] = []
  if (!d.usable) warnings.push('The photo was reported as unusable for a layout')
  if (d.view !== 'nadir') warnings.push(`The photo is ${d.view === 'oblique' ? 'oblique' : 'of unclear angle'}; distances may be distorted`)

  for (const parcel of d.parcels) {
    if (parcel.rows.length === 0) continue
    const enuRows: EnuRow[] = parcel.rows.map((src, index) => {
      const f = pxToEnu(g, src.first)
      const l = pxToEnu(g, src.last)
      return { index, src, f, l, mid: mul(add(f, l), 0.5) }
    })
    const midPx = parcel.rows[0]!.first
    const landward = landwardFromSeaSide(g, d.shoreline.seaSide, midPx)
    const fit = (run: EnuRow[]) => fitGroup(parcel.id, run, parcel.facing, parcel.confidence, landward, g)
    const runs = splitRuns(enuRows, (run) => {
      const r = fit(run)
      return { stagger: r.stagger, pitch: unitPitch(r.spec.paired, r.spec.horizontalGap) }
    })
    if (runs.length > 1) warnings.push(`Parcel ${parcel.id} has uneven rows; split into ${runs.length} rectangular parcels`)
    for (const run of runs) {
      const { spec } = fit(run)
      if (spec.confidence < (opts.minConfidence ?? 0)) {
        warnings.push(`Parcel ${parcel.id} rows ${spec.sourceRows.map((i) => i + 1).join(', ')} dropped: confidence ${spec.confidence.toFixed(2)}`)
        continue
      }
      parcels.push(spec)
    }
  }
  return { parcels, warnings }
}
