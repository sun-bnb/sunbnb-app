// Pure geometry: where to draw decorative chair glyphs around a restaurant
// table given its capacity and visual shape. Output positions are local to
// the table centre — callers translate by (cx, cy) and rotate with the table
// transform. No DOM, no React, no IO.

export type ChairShape = 'rect' | 'square' | 'round' | 'oval' | 'booth' | 'bar'

export interface ChairPosition {
  /** Offset from table centre (world units). */
  x: number
  y: number
  /** Rotation in degrees so the chair "faces" the table. */
  rotation: number
}

export interface SeatLayoutOverride {
  top?: number | null
  right?: number | null
  bottom?: number | null
  left?: number | null
}

/**
 * True when the operator has explicitly set any of the four side counts.
 * Auto-distribution is disabled in that case and the override is used
 * verbatim.
 */
export function hasSeatLayoutOverride(o: SeatLayoutOverride | undefined): boolean {
  if (!o) return false
  return (
    o.top != null ||
    o.right != null ||
    o.bottom != null ||
    o.left != null
  )
}

const ASPECT_SQUARISH = 1.2

/**
 * Compute decorative chair positions for one table.
 *
 * Conventions:
 *  - Round / oval: chairs evenly distributed around the perimeter.
 *  - Square (or near-square rect): chairs distributed across all four sides
 *    (one per side first, then doubled up).
 *  - Rect: chairs primarily along long sides; one head chair if capacity is
 *    odd or capacity > 2 × long-side count would otherwise be needed.
 *  - Booth: half capacity along the open long side; the other half is
 *    implicit on the banquette (no glyphs — the accent strip represents it).
 *  - Bar / high-top: no chair glyphs (stools are part of the bar fixture).
 */
export function computeChairPositions(
  shape: ChairShape,
  width: number,
  height: number,
  capacity: number,
  options: {
    gap?: number
    chairSize?: number
    /** Per-side override; when any side is set, all four are taken as-is. */
    override?: SeatLayoutOverride
  } = {},
): ChairPosition[] {
  if (shape === 'bar') return []
  const overridden = hasSeatLayoutOverride(options.override)
  if (capacity <= 0 && !overridden) return []
  const gap = options.gap ?? 0.05
  const chairSize = options.chairSize ?? Math.min(0.4, Math.min(width, height) * 0.35)
  const offEdge = chairSize / 2 + gap

  if (shape === 'round' || shape === 'oval') {
    const rx = width / 2 + offEdge
    const ry = height / 2 + offEdge
    const positions: ChairPosition[] = []
    for (let i = 0; i < capacity; i++) {
      // Start at the top (theta = -π/2) and sweep clockwise.
      const theta = (2 * Math.PI * i) / capacity - Math.PI / 2
      positions.push({
        x: rx * Math.cos(theta),
        y: ry * Math.sin(theta),
        // Chair backrest faces outward; rotate so the flat seat side faces
        // the table centre.
        rotation: (theta * 180) / Math.PI + 90,
      })
    }
    return positions
  }

  // Side allocation for rect / square / booth.
  // sides[0]=top, [1]=right, [2]=bottom, [3]=left
  const longHorizontal = width >= height
  const aspect = longHorizontal ? width / height : height / width
  const isSquarish = shape === 'square' || aspect < ASPECT_SQUARISH

  let counts = [0, 0, 0, 0]

  if (overridden) {
    // Operator-supplied values used as-is. Treat unset sides as 0.
    counts = [
      options.override?.top ?? 0,
      options.override?.right ?? 0,
      options.override?.bottom ?? 0,
      options.override?.left ?? 0,
    ]
  } else if (shape === 'booth') {
    // Banquette wall is on the bottom long side (when w ≥ h) or right long
    // side (when h > w); the open side gets all the chair glyphs.
    if (longHorizontal) counts[0] = capacity
    else counts[3] = capacity
  } else if (isSquarish) {
    // Distribute across all four sides as evenly as possible.
    const base = Math.floor(capacity / 4)
    const remainder = capacity - 4 * base
    counts = [
      base + (remainder > 0 ? 1 : 0),
      base + (remainder > 1 ? 1 : 0),
      base + (remainder > 2 ? 1 : 0),
      base,
    ]
  } else {
    // Long sides take the bulk; head seats fill the remainder.
    const perLong = Math.floor(capacity / 2)
    const heads = capacity - 2 * perLong // 0 or 1
    if (longHorizontal) {
      counts[0] = perLong
      counts[2] = perLong
      if (heads === 1) counts[1] = 1
    } else {
      counts[1] = perLong
      counts[3] = perLong
      if (heads === 1) counts[2] = 1
    }
  }

  const positions: ChairPosition[] = []
  const halfW = width / 2
  const halfH = height / 2
  const [topN = 0, rightN = 0, bottomN = 0, leftN = 0] = counts
  // Top side
  for (let i = 0; i < topN; i++) {
    const t = (i + 1) / (topN + 1)
    positions.push({
      x: -halfW + t * width,
      y: -halfH - offEdge,
      rotation: 180,
    })
  }
  // Right side
  for (let i = 0; i < rightN; i++) {
    const t = (i + 1) / (rightN + 1)
    positions.push({
      x: halfW + offEdge,
      y: -halfH + t * height,
      rotation: -90,
    })
  }
  // Bottom side
  for (let i = 0; i < bottomN; i++) {
    const t = (i + 1) / (bottomN + 1)
    positions.push({
      x: -halfW + t * width,
      y: halfH + offEdge,
      rotation: 0,
    })
  }
  // Left side
  for (let i = 0; i < leftN; i++) {
    const t = (i + 1) / (leftN + 1)
    positions.push({
      x: -halfW - offEdge,
      y: -halfH + t * height,
      rotation: 90,
    })
  }
  return positions
}
