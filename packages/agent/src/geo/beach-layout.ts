/**
 * Mockup sunbed layout (track 027, P2): anchor + sea direction + count → geo-placed sunbeds.
 *
 * Pure and deterministic — the same input always yields the same beach, so a shared mockup link
 * re-renders identically and the layout can later seed a real site (P7: the output carries what
 * `InventoryItem` stores — lat/lng + rotation).
 *
 * The shape is the classic Mediterranean concession: PAIRS of sunbeds (one umbrella each) in
 * rows parallel to the waterline, front row nearest the sea, a cross-walkway every few pairs so
 * guests can reach the back rows. Dimensions follow the schematic defaults (a bed is 0.84 m ×
 * 2.1 m, `@repo/schematic` SchematicItem docs).
 *
 * Geometry is laid out in local metres, then projected with an equirectangular approximation —
 * accurate to centimetres over the few hundred metres a beach spans.
 */

export interface LayoutInput {
  anchor: { lat: number; lng: number }
  /** Compass bearing (0 = north, 90 = east) pointing from the beach TOWARD the sea. */
  seaBearingDeg: number
  sunbedCount: number
  /**
   * How `anchor` is read. 'center' (default): the middle of the block — used when all we have is
   * Google's point or the prospect's click. 'waterline': a point ON the waterline (from the OSM
   * coastline) — the block sits `waterlineGapM` inland of it, front row facing the sea.
   */
  placement?: 'center' | 'waterline'
}

export interface LayoutOptions {
  bedWidthM: number
  bedLengthM: number
  /** Gap between the two beds of a pair (the umbrella stands in it). */
  pairInnerGapM: number
  /** Gap between neighbouring pairs in a row. */
  pairOuterGapM: number
  /** Aisle between rows, behind the beds' feet. */
  rowAisleM: number
  /** A cross-walkway after every this many pairs in a row. */
  pairsPerBlock: number
  walkwayM: number
  /** Pairs per row is chosen so the block stays a beach shape: long along the shore, few rows deep. */
  targetPairsPerRow: number
  maxRows: number
  /** In 'waterline' placement: wet sand between the waterline and the front row. */
  waterlineGapM: number
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  bedWidthM: 0.84,
  bedLengthM: 2.1,
  pairInnerGapM: 0.6,
  pairOuterGapM: 1.2,
  rowAisleM: 1.6,
  pairsPerBlock: 6,
  walkwayM: 2.5,
  targetPairsPerRow: 12,
  // Long and shallow: most beaches are 20–40 m deep, and 10-row blocks (250 beds) ran off narrow
  // ones into dunes and roads. 4 rows from the waterline ≈ 6 + 3 × 3.7 + 2.1 ≈ 19 m deep; extra
  // beds lengthen the rows along the shore instead (250 beds → 4 rows of 32 pairs, ~100 m).
  maxRows: 4,
  // OSM coastline ≈ the high-water line; 6 m of wet sand, then row A. 12 m pushed 5-row blocks
  // into the dune vegetation on a ~30 m wide beach (Platja de Muro, 2026-10-04).
  waterlineGapM: 6,
}

export interface MockSunbed {
  /** Row letter (A = front row, nearest the sea) + 1-based position along the row: "A1", "B12". */
  label: string
  row: number
  /** 0-based pair index within the row. */
  pair: number
  /** 0 or 1 — which bed of the pair. */
  side: 0 | 1
  lat: number
  lng: number
  /** Compass bearing of the bed's long axis, head → feet; feet point at the sea. */
  rotationDeg: number
}

export interface MockUmbrella {
  row: number
  pair: number
  lat: number
  lng: number
}

export interface BeachLayout {
  sunbeds: MockSunbed[]
  umbrellas: MockUmbrella[]
  rows: number
  pairsPerRow: number
}

const METRES_PER_DEG_LAT = 111_320

function rowLetter(row: number): string {
  // A..Z then AA, AB… — maxRows is 10 today, but never emit a non-letter label.
  let n = row
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

export function generateBeachLayout(input: LayoutInput, options: Partial<LayoutOptions> = {}): BeachLayout {
  const o = { ...DEFAULT_LAYOUT, ...options }
  const count = input.sunbedCount
  if (!Number.isInteger(count) || count < 1) throw new Error('sunbedCount must be a positive integer')

  const pairs = Math.ceil(count / 2)
  const rows = Math.min(o.maxRows, Math.max(1, Math.ceil(pairs / o.targetPairsPerRow)))
  const pairsPerRow = Math.ceil(pairs / rows)

  const pairWidth = 2 * o.bedWidthM + o.pairInnerGapM
  const pairPitch = pairWidth + o.pairOuterGapM
  const rowPitch = o.bedLengthM + o.rowAisleM

  // Along-shore position (x, metres) of a pair's centre, walkways included.
  const pairX = (p: number) => p * pairPitch + Math.floor(p / o.pairsPerBlock) * o.walkwayM
  const rowLength = pairX(pairsPerRow - 1)
  const depth = (rows - 1) * rowPitch

  // Local frame: x along the shore, y toward the sea. Front row (A) at the sea side; the block is
  // centred on the anchor, or (waterline placement) starts waterlineGapM inland of it.
  type Local = { x: number; y: number }
  const toGeo = (({ lat, lng }, seaDeg) => {
    const sea = (seaDeg * Math.PI) / 180
    // Unit vectors in (east, north): toward the sea, and along the shore (sea rotated −90°).
    const seaE = Math.sin(sea)
    const seaN = Math.cos(sea)
    const shoreE = -seaN
    const shoreN = seaE
    const mPerDegLng = METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
    return ({ x, y }: Local) => {
      const east = x * shoreE + y * seaE
      const north = x * shoreN + y * seaN
      return { lat: lat + north / METRES_PER_DEG_LAT, lng: lng + east / mPerDegLng }
    }
  })(input.anchor, input.seaBearingDeg)

  const rotationDeg = ((input.seaBearingDeg % 360) + 360) % 360
  const sunbeds: MockSunbed[] = []
  const umbrellas: MockUmbrella[] = []

  let placed = 0
  for (let row = 0; row < rows && placed < count; row++) {
    const frontY = input.placement === 'waterline' ? -o.waterlineGapM : depth / 2
    const y = frontY - row * rowPitch // row A seaward-most
    for (let pair = 0; pair < pairsPerRow && placed < count; pair++) {
      const cx = pairX(pair) - rowLength / 2
      umbrellas.push({ row, pair, ...toGeo({ x: cx, y }) })
      for (const side of [0, 1] as const) {
        if (placed >= count) break
        const offset = (side === 0 ? -1 : 1) * (o.pairInnerGapM / 2 + o.bedWidthM / 2)
        sunbeds.push({
          label: `${rowLetter(row)}${pair * 2 + side + 1}`,
          row,
          pair,
          side,
          rotationDeg,
          ...toGeo({ x: cx + offset, y }),
        })
        placed++
      }
    }
  }

  return { sunbeds, umbrellas, rows, pairsPerRow }
}

/**
 * The sunbed a tap landed on: the nearest bed centre within `maxM` metres, or null for a tap on
 * open sand. Used for the demo booking — the canvas overlay itself takes no pointer events.
 */
export function nearestSunbed(layout: BeachLayout, point: { lat: number; lng: number }, maxM = 1.5): MockSunbed | null {
  const mPerDegLng = METRES_PER_DEG_LAT * Math.cos((point.lat * Math.PI) / 180)
  let best: MockSunbed | null = null
  let bestD2 = maxM * maxM
  for (const s of layout.sunbeds) {
    const dx = (s.lng - point.lng) * mPerDegLng
    const dy = (s.lat - point.lat) * METRES_PER_DEG_LAT
    const d2 = dx * dx + dy * dy
    if (d2 <= bestD2) {
      best = s
      bestD2 = d2
    }
  }
  return best
}
