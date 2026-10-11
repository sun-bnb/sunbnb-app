/**
 * Pure inventory geometry (track 030 S4a). NOT a 'use server' file.
 *
 * Everything here used to be inlined in `actions.ts` (syncChairsWithLayout, rotateSelection,
 * adjustItemSpacing, reverseParcel*). It is extracted so the server actions AND the assistant's
 * proposal preview run the SAME code: what the user reviews on the map is, by construction, what apply
 * produces. Coordinates are unified as `y` = latitude | schematicY and `x` = longitude | schematicX,
 * exactly the "latOrY / lngOrX" convention the actions already use.
 */

import { generateChairs, generateChairsSchematic, type ChairConfig } from './chair-util'

export type LayoutMode = 'geo' | 'schematic'

// ─── layout generation + rearrange planning (syncChairsWithLayout) ──────────

export interface GeneratedSeat {
  tempId: string
  pairTempId?: string
  locationLat: string
  locationLng: string
  schematicX?: number
  schematicY?: number
  rotation: number
  group: number
  number: number
  isPrimary?: boolean
}

export interface ItemGroupData {
  number: number
  price: number | undefined
  category: string | undefined
  rows: number
  seatsPerRow: number
  horizontalGap: number
  verticalGap: number
  pairGap: number
  rotation: number
  locationLat: string
  locationLng: string
  schematicX?: number
  schematicY?: number
}

/** The grid of seats a config generates, in the mode's coordinate system. */
export function generateLayout(config: ChairConfig, mode: LayoutMode): GeneratedSeat[] {
  return mode === 'schematic'
    ? generateChairsSchematic({ ...config, baseX: config.baseLng, baseY: config.baseLat }).map((c) => ({
        tempId: c.tempId,
        pairTempId: c.pairTempId,
        locationLat: '0',
        locationLng: '0',
        schematicX: c.schematicX,
        schematicY: c.schematicY,
        rotation: c.rotation,
        group: c.group,
        number: c.number,
        isPrimary: c.isPrimary,
      }))
    : generateChairs(config).map((c) => ({ ...c, schematicX: undefined, schematicY: undefined }))
}

/** The ItemGroup row a config persists. */
export function buildItemGroupData(config: ChairConfig, mode: LayoutMode): ItemGroupData {
  const common = {
    number: config.group,
    price: config.price,
    category: config.category,
    rows: config.rows,
    seatsPerRow: config.seatsPerRow,
    horizontalGap: config.horizontalGap,
    verticalGap: config.verticalGap,
    pairGap: config.intraPairGap,
    rotation: config.rotation,
  }
  return mode === 'schematic'
    ? { ...common, locationLat: '0', locationLng: '0', schematicX: config.baseLng, schematicY: config.baseLat }
    : { ...common, locationLat: String(config.baseLat), locationLng: String(config.baseLng) }
}

export interface ExistingSeat {
  id: string
  number: number
  locationLat: string
  locationLng: string
  schematicX: number | null
  schematicY: number | null
}

/**
 * Preserve the visual centroid across a rearrange so rotation pivots around the parcel centre, with
 * the sanity guard against a poisoned (sentinel / corrupt) centroid. See syncChairsWithLayout.
 */
export function shiftToExistingCentroid<G extends GeneratedSeat>(
  existing: ExistingSeat[],
  generated: G[],
  groupData: ItemGroupData,
  mode: LayoutMode,
): { generated: G[]; groupData: ItemGroupData } {
  const isSchematic = mode === 'schematic'
  // Geo shifts are in degrees (0.01° ≈ 1.1 km); schematic shifts are in world units.
  const MAX_CENTROID_SHIFT = isSchematic ? 10 : 0.01
  if (existing.length === 0 || generated.length === 0) return { generated, groupData }

  if (isSchematic) {
    const oldCx = existing.reduce((s, i) => s + (i.schematicX ?? 0), 0) / existing.length
    const oldCy = existing.reduce((s, i) => s + (i.schematicY ?? 0), 0) / existing.length
    const newCx = generated.reduce((s, g) => s + (g.schematicX ?? 0), 0) / generated.length
    const newCy = generated.reduce((s, g) => s + (g.schematicY ?? 0), 0) / generated.length
    const dx = oldCx - newCx
    const dy = oldCy - newCy
    if (Number.isFinite(dx) && Number.isFinite(dy) && Math.abs(dx) <= MAX_CENTROID_SHIFT && Math.abs(dy) <= MAX_CENTROID_SHIFT) {
      return {
        generated: generated.map((g) => ({
          ...g,
          schematicX: (g.schematicX ?? 0) + dx,
          schematicY: (g.schematicY ?? 0) + dy,
        })),
        groupData: {
          ...groupData,
          schematicX: (groupData.schematicX ?? 0) + dx,
          schematicY: (groupData.schematicY ?? 0) + dy,
        },
      }
    }
  } else {
    const oldCLat = existing.reduce((s, i) => s + parseFloat(i.locationLat), 0) / existing.length
    const oldCLng = existing.reduce((s, i) => s + parseFloat(i.locationLng), 0) / existing.length
    const newCLat = generated.reduce((s, g) => s + parseFloat(g.locationLat), 0) / generated.length
    const newCLng = generated.reduce((s, g) => s + parseFloat(g.locationLng), 0) / generated.length
    const dLat = oldCLat - newCLat
    const dLng = oldCLng - newCLng
    if (Number.isFinite(dLat) && Number.isFinite(dLng) && Math.abs(dLat) <= MAX_CENTROID_SHIFT && Math.abs(dLng) <= MAX_CENTROID_SHIFT) {
      return {
        generated: generated.map((g) => ({
          ...g,
          locationLat: (parseFloat(g.locationLat) + dLat).toString(),
          locationLng: (parseFloat(g.locationLng) + dLng).toString(),
        })),
        groupData: {
          ...groupData,
          locationLat: (parseFloat(groupData.locationLat) + dLat).toString(),
          locationLng: (parseFloat(groupData.locationLng) + dLng).toString(),
        },
      }
    }
  }
  return { generated, groupData }
}

export interface Matching<E extends { id: string; number: number }, G extends GeneratedSeat> {
  assignments: Array<{ id: string; gen: G }>
  unmatchedExisting: E[]
  unmatchedGenerated: G[]
  /** Existing seats with no generated position left: removed by a shrink. */
  surplus: E[]
  /** Generated positions with no existing seat: created by a grow. */
  vacant: G[]
}

/**
 * Pair each existing seat with its generated position: first by seat number, then the remaining
 * unmatched seats take leftover generated positions in order (so every seat gets repositioned).
 */
export function matchSeats<E extends { id: string; number: number }, G extends GeneratedSeat>(
  existing: E[],
  generated: G[],
): Matching<E, G> {
  const numberToId = new Map(existing.map((e) => [e.number, e.id]))
  const matchedIds = new Set<string>()
  const assignments: Array<{ id: string; gen: G }> = []
  for (const gen of generated) {
    const id = numberToId.get(gen.number)
    if (id) {
      matchedIds.add(id)
      assignments.push({ id, gen })
    }
  }
  const unmatchedExisting = existing.filter((e) => !matchedIds.has(e.id))
  const unmatchedGenerated = generated.filter((g) => !numberToId.has(g.number))
  unmatchedExisting.forEach((existingItem, idx) => {
    const gen = unmatchedGenerated[idx]
    if (!gen) return
    matchedIds.add(existingItem.id)
    assignments.push({ id: existingItem.id, gen })
  })
  return {
    assignments,
    unmatchedExisting,
    unmatchedGenerated,
    surplus: unmatchedExisting.slice(unmatchedGenerated.length),
    vacant: unmatchedGenerated.slice(unmatchedExisting.length),
  }
}

// ─── rotate / space a selection (rotateSelection, adjustItemSpacing) ────────

export interface PosItem {
  id: string
  y: number
  x: number
  rotation: number | null
}

export function centroidOf(items: Array<{ y: number; x: number }>): { y: number; x: number } {
  return {
    y: items.reduce((s, i) => s + i.y, 0) / items.length,
    x: items.reduce((s, i) => s + i.x, 0) / items.length,
  }
}

/** Orbit `items` around their centroid by `deltaDegrees` and turn each by the same angle. */
export function rotatePositions(
  items: PosItem[],
  deltaDegrees: number,
  mode: LayoutMode,
): Array<{ id: string; y: number; x: number; rotation: number }> {
  if (items.length === 0) return []
  const isSchematic = mode === 'schematic'
  const { y: centerLat, x: centerLng } = centroidOf(items)
  // Schematic uses SVG Y-down, while the rotation matrix is written for Y-up (geographic): invert the
  // angle so the orbit matches each seat's own CW tilt.
  const rad = (isSchematic ? -deltaDegrees : deltaDegrees) * (Math.PI / 180)
  const metersPerLat = isSchematic ? 1 : 111320
  const metersPerLng = isSchematic ? 1 : 111320 * Math.cos((centerLat * Math.PI) / 180)

  return items.map((item) => {
    let newLatVal = item.y
    let newLngVal = item.x
    if (items.length > 1) {
      const dy = (item.y - centerLat) * metersPerLat
      const dx = (item.x - centerLng) * metersPerLng
      const newLatM = dy * Math.cos(rad) - dx * Math.sin(rad)
      const newLngM = dy * Math.sin(rad) + dx * Math.cos(rad)
      newLatVal = centerLat + newLatM / metersPerLat
      newLngVal = centerLng + newLngM / metersPerLng
    }
    return { id: item.id, y: newLatVal, x: newLngVal, rotation: Math.round((item.rotation ?? 0) + deltaDegrees) }
  })
}

/** Scale the spread of `items` along one axis of their (average) rotation. */
export function spacePositions(
  items: PosItem[],
  axis: 'horizontal' | 'vertical',
  factor: number,
  mode: LayoutMode,
): Array<{ id: string; y: number; x: number }> {
  if (items.length === 0) return []
  const isSchematic = mode === 'schematic'
  const { y: centerLat, x: centerLng } = centroidOf(items)
  const avgRotation = items.reduce((s, i) => s + (i.rotation || 0), 0) / items.length
  const rad = avgRotation * (Math.PI / 180)
  const metersPerLat = isSchematic ? 1 : 111320
  const metersPerLng = isSchematic ? 1 : 111320 * Math.cos((centerLat * Math.PI) / 180)

  return items.map((item) => {
    const dy = (item.y - centerLat) * metersPerLat
    const dx = (item.x - centerLng) * metersPerLng
    // Project onto the rotated axes matching the generateChairs convention.
    const hComponent = -dy * Math.sin(rad) + dx * Math.cos(rad)
    const vComponent = dy * Math.cos(rad) + dx * Math.sin(rad)
    const newH = axis === 'horizontal' ? hComponent * factor : hComponent
    const newV = axis === 'vertical' ? vComponent * factor : vComponent
    const newLatM = newV * Math.cos(rad) - newH * Math.sin(rad)
    const newLngM = newV * Math.sin(rad) + newH * Math.cos(rad)
    return { id: item.id, y: centerLat + newLatM / metersPerLat, x: centerLng + newLngM / metersPerLng }
  })
}

// ─── reverse numbering / orientation ────────────────────────────────────────

/**
 * New seat numbers after reversing the numbering within each row: `number` encodes
 * `${group}${row2}${seat2}`; the seat suffix (last 2 digits) is remapped s_i -> s_(n+1-i) per row.
 */
export function reversedNumbers(items: Array<{ id: string; number: number }>): Array<{ id: string; newNumber: number }> {
  const rowMap = new Map<string, Array<{ id: string; number: number }>>()
  for (const item of items) {
    const rowPrefix = String(item.number).slice(0, -2)
    if (!rowMap.has(rowPrefix)) rowMap.set(rowPrefix, [])
    rowMap.get(rowPrefix)!.push(item)
  }
  const updates: Array<{ id: string; newNumber: number }> = []
  for (const [rowPrefix, rowItems] of rowMap) {
    rowItems.sort((a, b) => a.number - b.number)
    const n = rowItems.length
    for (let i = 0; i < n; i++) {
      const item = rowItems[i]!
      const reversedItem = rowItems[n - 1 - i]!
      updates.push({ id: item.id, newNumber: Number(`${rowPrefix}${String(reversedItem.number).slice(-2)}`) })
    }
  }
  return updates
}

/** Turn a seat 180°, normalised into [0, 360). */
export const flippedRotation = (r: number | null): number => ((((r ?? 0) + 180) % 360) + 360) % 360

/** Normalise a single seat's turn in place into [0, 360) (rotateUnit's loose-seat case). */
export const normalizedRotation = (r: number | null, delta: number): number =>
  ((((r ?? 0) + delta) % 360) + 360) % 360

// ─── metres <-> coordinates ─────────────────────────────────────────────────

/**
 * A move of `dxMetres` east/right and `dyMetres` north/UP expressed as a delta of (y, x) at `atY`.
 * Schematic y grows DOWNWARD, so "up" is a negative y delta.
 */
export function metresToDelta(
  mode: LayoutMode,
  atY: number,
  dxMetres: number,
  dyMetres: number,
): { dy: number; dx: number } {
  if (mode === 'schematic') return { dy: -dyMetres, dx: dxMetres }
  const metersPerLat = 111320
  const metersPerLng = 111320 * Math.cos((atY * Math.PI) / 180)
  return { dy: dyMetres / metersPerLat, dx: dxMetres / metersPerLng }
}
