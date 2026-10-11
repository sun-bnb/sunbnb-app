/**
 * Pure helpers for the server-side parcel operations in `parcel-ops.ts`
 * (track 030 S1b). NOT a 'use server' file: a 'use server' module may export
 * async functions only, and these are synchronous + unit-testable.
 *
 * They hold the config-rebuilding logic that used to be duplicated inside the
 * browser editors (`inventory/view.tsx`, `schematic/view.tsx`): turn the
 * persisted ItemGroup (+ live seat count) back into the `ChairConfig` that
 * `syncChairsWithLayout` regenerates a grid from.
 */

import type { ChairConfig } from './chair-util'

/** The fields of an ItemGroup row the rebuild needs. */
export interface ItemGroupLike {
  id: string
  number: number
  seatsPerRow: number
  horizontalGap: number
  verticalGap: number
  rotation: number
  pairGap: number
  category: string | null
  price: number | null
  locationLat: string
  locationLng: string
  schematicX: number | null
  schematicY: number | null
}

/** The seat fields the no-ItemGroup fallback averages over. */
export interface SeatPositionLike {
  rotation: number | null
  locationLat: string
  locationLng: string
  schematicX: number | null
  schematicY: number | null
}

export type LayoutMode = 'geo' | 'schematic'

/**
 * Editable subset of a parcel config. Deliberately has NO group number, base
 * position or itemGroupId: those are server-owned (a client-supplied anchor is
 * exactly the stale-state hazard the server composition removes).
 */
export interface ParcelConfigPatch {
  rows?: number
  seatsPerRow?: number
  horizontalGap?: number
  verticalGap?: number
  rotation?: number
  pairSeats?: boolean
  intraPairGap?: number
  category?: string
  price?: number
}

/** Defaults for a parcel that has no ItemGroup record (legacy data). */
export const FALLBACK_DEFAULTS = {
  seatsPerRow: 4,
  horizontalGap: 1,
  verticalGap: 1.5,
  intraPairGap: 0.4,
} as const

/**
 * Whether a parcel is really PAIRED, read from its actual units (SunbedGroup membership), not from
 * `ItemGroup.pairGap`. `pairGap` is just the stored spacing value: an UNPAIRED parcel still carries
 * the form's default (0.4), so deriving `pairSeats = pairGap > 0` silently re-paired every unpaired
 * parcel on rotate / reorder (track 030 S1 bug). A parcel is paired when some unit has 2+ members;
 * when no seat has a unit (legacy data) it falls back to the old `pairGap > 0` guess.
 */
export function parcelIsPaired(
  seats: Array<{ sunbedGroupId?: string | null }>,
  pairGap: number,
): boolean {
  const members = new Map<string, number>()
  for (const s of seats) {
    if (s.sunbedGroupId) members.set(s.sunbedGroupId, (members.get(s.sunbedGroupId) ?? 0) + 1)
  }
  if (members.size === 0) return pairGap > 0
  return [...members.values()].some((n) => n > 1)
}

/**
 * ItemGroup -> ChairConfig, exactly as the editors built it:
 * rows = ceil(liveSeatCount / seatsPerRow), category/price `|| undefined` (so "unset" never
 * overwrites seat columns). `paired` is the parcel's REAL pairing (see `parcelIsPaired`); omitted =
 * the legacy `pairGap > 0` guess.
 * Schematic parcels keep their anchor in schematicX/Y (baseLng = X, baseLat = Y,
 * the same mapping `syncChairsWithLayout` writes back).
 */
export function configFromItemGroup(
  ig: ItemGroupLike,
  seatCount: number,
  layoutMode: LayoutMode,
  paired?: boolean,
): ChairConfig {
  return {
    itemGroupId: ig.id,
    rows: Math.ceil(seatCount / ig.seatsPerRow),
    seatsPerRow: ig.seatsPerRow,
    horizontalGap: ig.horizontalGap,
    verticalGap: ig.verticalGap,
    rotation: ig.rotation,
    group: ig.number,
    category: ig.category || undefined,
    price: ig.price || undefined,
    pairSeats: paired ?? ig.pairGap > 0,
    intraPairGap: ig.pairGap,
    baseLat: layoutMode === 'schematic' ? (ig.schematicY ?? 0) : parseFloat(ig.locationLat),
    baseLng: layoutMode === 'schematic' ? (ig.schematicX ?? 0) : parseFloat(ig.locationLng),
  }
}

/** Config for a parcel without an ItemGroup: anchor = centroid of its seats. */
export function configFromSeats(
  group: number,
  seats: SeatPositionLike[],
  layoutMode: LayoutMode,
  patch: ParcelConfigPatch = {},
  paired?: boolean,
): ChairConfig {
  const n = seats.length || 1
  const avg = (f: (s: SeatPositionLike) => number) => seats.reduce((s, i) => s + f(i), 0) / n
  const seatsPerRow = patch.seatsPerRow ?? FALLBACK_DEFAULTS.seatsPerRow
  return {
    rows: Math.ceil(seats.length / seatsPerRow),
    seatsPerRow,
    horizontalGap: FALLBACK_DEFAULTS.horizontalGap,
    verticalGap: FALLBACK_DEFAULTS.verticalGap,
    rotation: seats[0]?.rotation || 0,
    group,
    pairSeats: paired ?? true,
    intraPairGap: FALLBACK_DEFAULTS.intraPairGap,
    baseLat:
      layoutMode === 'schematic'
        ? avg((s) => s.schematicY ?? 0)
        : avg((s) => Number(s.locationLat)),
    baseLng:
      layoutMode === 'schematic'
        ? avg((s) => s.schematicX ?? 0)
        : avg((s) => Number(s.locationLng)),
  }
}

const PATCH_KEYS = [
  'rows', 'seatsPerRow', 'horizontalGap', 'verticalGap', 'rotation',
  'pairSeats', 'intraPairGap', 'category', 'price',
] as const

/**
 * Overlay only the DEFINED, WHITELISTED patch fields (undefined = leave the
 * stored value). Anything else a caller smuggles in (group, baseLat, ...) is
 * ignored, so the anchor and parcel number stay server-owned.
 */
export function applyPatch(base: ChairConfig, patch: ParcelConfigPatch): ChairConfig {
  const next: Record<string, unknown> = { ...base }
  for (const key of PATCH_KEYS) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  return next as unknown as ChairConfig
}

const MAX_DIM = 500

/** Returns an error message, or null when the patch is acceptable. */
export function validatePatch(patch: ParcelConfigPatch): string | null {
  const intIn = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

  if (patch.rows !== undefined && !intIn(patch.rows, 1, MAX_DIM)) {
    return `rows must be an integer between 1 and ${MAX_DIM}`
  }
  if (patch.seatsPerRow !== undefined && !intIn(patch.seatsPerRow, 1, MAX_DIM)) {
    return `seatsPerRow must be an integer between 1 and ${MAX_DIM}`
  }
  for (const key of ['horizontalGap', 'verticalGap', 'intraPairGap'] as const) {
    const v = patch[key]
    if (v !== undefined && !(num(v) && v >= 0 && v <= 100)) {
      return `${key} must be a number between 0 and 100`
    }
  }
  if (patch.rotation !== undefined && !num(patch.rotation)) {
    return 'rotation must be a finite number'
  }
  if (patch.price !== undefined && !(num(patch.price) && patch.price >= 0 && patch.price <= 100000)) {
    return 'price must be between 0 and 100,000'
  }
  if (patch.category !== undefined && !(typeof patch.category === 'string' && patch.category.length <= 50)) {
    return 'category must be a string of at most 50 characters'
  }
  if (patch.pairSeats !== undefined && typeof patch.pairSeats !== 'boolean') {
    return 'pairSeats must be a boolean'
  }
  return null
}

/**
 * The ONE place a parcel's regeneration config is rebuilt from the database. `parcel-ops.ts` (the
 * editors + the agent) and the assistant's preview simulation both call it, so the previewed grid is
 * the one `syncChairsWithLayout` will generate. `seats` are the parcel's non-pool seats.
 */
export function buildParcelConfig(args: {
  number: number
  itemGroup: ItemGroupLike | null
  seats: Array<SeatPositionLike & { sunbedGroupId?: string | null }>
  layoutMode: LayoutMode
  patch?: ParcelConfigPatch
}): { config: ChairConfig; paired: boolean } {
  const { number, itemGroup, seats, layoutMode, patch = {} } = args
  const paired = parcelIsPaired(seats, itemGroup?.pairGap ?? 0.4)
  const base = itemGroup
    ? configFromItemGroup(itemGroup, seats.length, layoutMode, paired)
    : configFromSeats(number, seats, layoutMode, patch, paired)
  return { config: applyPatch(base, patch), paired }
}
