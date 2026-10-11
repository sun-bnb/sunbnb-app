/**
 * Inventory proposal tools (track 030 S4a): every sunbed-map / schematic operation as a reviewed
 * proposal (kind `inventory_batch`) with a map preview. Model-facing handles only -- parcel NUMBER and
 * seat id ("1-2-3-1", a unit "1-2-3") -- resolved to ids WITHIN the site server-side; the model never
 * supplies a cuid or invents a coordinate (use the page context's map centre or `relative_to_parcel`).
 */
import prisma from '@repo/data/PrismaCient'
import {
  inventoryHandler, planInventory, validatePatch,
  type Anchor, type InvOp, type Target,
} from '../proposals/handlers/inventory'
import { siteLayoutMode } from '../proposals/inventory-sim'
import type { ParcelConfigPatch } from '@/app/sites/[id]/inventory/parcel-config'
import type { AssistantTool, AssistantToolCtx } from './helpers'
import { proposeTool, type Plan } from './propose-core'
import type { InventoryPayload } from '../proposals/handlers/inventory'

type Input = Record<string, unknown>
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const err = (...errors: string[]): { errors: string[] } => ({ errors })

const TARGET_SCHEMA = {
  type: 'object',
  description:
    'What to act on: exactly one of { parcel: <number> } (a whole parcel), { seats: ["1-2-3-1", ...] } (sunbed ids; a unit id "1-2-3" means all its beds), or { selection: true } (the sunbeds the user has selected on the map right now, from the page context).',
  properties: {
    parcel: { type: 'integer', minimum: 1, maximum: 9999 },
    seats: { type: 'array', items: { type: 'string', maxLength: 30 }, minItems: 1, maxItems: 300 },
    selection: { type: 'boolean' },
  },
  additionalProperties: false,
}

type TargetResult = { target: Target } | { errors: string[] }

async function parseTarget(raw: unknown, ctx: AssistantToolCtx): Promise<TargetResult> {
  if (!isObj(raw)) return err('target is required: { parcel } or { seats } or { selection: true }')
  const given = ['parcel', 'seats', 'selection'].filter((k) => raw[k] !== undefined && raw[k] !== false)
  if (given.length !== 1) return err('target must have exactly one of parcel, seats, selection')
  if (raw.parcel !== undefined) {
    if (!Number.isInteger(raw.parcel) || (raw.parcel as number) < 1 || (raw.parcel as number) > 9999) return err('target.parcel must be a parcel number')
    return { target: { parcel: raw.parcel as number } }
  }
  if (raw.seats !== undefined) {
    if (!Array.isArray(raw.seats) || raw.seats.length === 0 || raw.seats.length > 300 || raw.seats.some((s) => typeof s !== 'string')) return err('target.seats must be a list of sunbed ids like "1-2-3-1"')
    return { target: { seats: raw.seats as string[] } }
  }
  // { selection: true }: the client's selected ids, verified IN THIS SITE before they become a target.
  const sel = ctx.pageContext?.selection
  if (sel?.itemIds?.length) {
    const rows = await prisma.inventoryItem.findMany({
      where: { id: { in: sel.itemIds }, siteId: ctx.siteId, status: { not: 'pool' } },
      select: { id: true },
    })
    if (rows.length > 0) return { target: { ids: rows.map((r) => r.id) } }
  }
  if (sel?.parcel !== undefined) {
    const n = await prisma.inventoryItem.count({ where: { siteId: ctx.siteId, group: sel.parcel } })
    if (n > 0) return { target: { parcel: sel.parcel } }
  }
  return err('Nothing is selected on the map. Ask the user to select the sunbeds (or name a parcel number or sunbed ids).')
}

/** Geo: {lat,lng}. Schematic: {x,y} metres. Returns unified (y,x). */
function parsePoint(raw: unknown, mode: 'geo' | 'schematic', what: string): { y: number; x: number } | { errors: string[] } {
  if (!isObj(raw)) return err(`${what} is required`)
  if (mode === 'geo') {
    if (!num(raw.lat) || !num(raw.lng) || Math.abs(raw.lat) > 90 || Math.abs(raw.lng) > 180) return err(`${what} needs lat and lng (this site uses the map)`)
    return { y: raw.lat, x: raw.lng }
  }
  if (!num(raw.x) || !num(raw.y) || Math.abs(raw.x) > 10000 || Math.abs(raw.y) > 10000) return err(`${what} needs x and y in metres (this site uses the schematic layout)`)
  return { y: raw.y, x: raw.x }
}

const metres = (v: unknown, what: string): { dx: number; dy: number } | { errors: string[] } => {
  if (!isObj(v) || !num(v.dx) || !num(v.dy) || Math.abs(v.dx) > 5000 || Math.abs(v.dy) > 5000) return err(`${what} needs dx and dy in metres (at most 5000)`)
  return { dx: v.dx, dy: v.dy }
}

const hasErrors = <T extends object>(v: T | { errors: string[] }): v is { errors: string[] } => 'errors' in v

async function finish(ctx: AssistantToolCtx, ops: InvOp[]): Promise<Plan<InventoryPayload>> {
  return planInventory(ctx.siteId, ops)
}

const ANCHOR_NOTE =
  'Never invent coordinates: use the map centre from the page context (viewport.center) or relative_to_parcel. Ask the user where to put it when unclear.'

export const proposeCreateParcel = proposeTool<InventoryPayload>({
  name: 'propose_create_parcel',
  label: 'Preparing a new parcel',
  description:
    `Propose a NEW parcel (block of sunbeds) as a grid of rows x seats_per_row. anchor = where the first sunbed goes: { lat, lng } on a map site, { x, y } metres on a schematic site, or { relative_to_parcel: <n>, offset_m: { dx, dy } } (metres east/up from that parcel's anchor, its first sunbed). ${ANCHOR_NOTE} paired (default true) places beds in pairs sharing one parasol; gaps in metres (defaults 1 between seats, 1.5 between rows); rotation in degrees. The new parcel number is assigned automatically.`,
  properties: {
    anchor: {
      type: 'object',
      properties: {
        lat: { type: 'number' }, lng: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' },
        relative_to_parcel: { type: 'integer', minimum: 1, maximum: 9999 },
        offset_m: { type: 'object', properties: { dx: { type: 'number' }, dy: { type: 'number' } }, additionalProperties: false },
      },
      additionalProperties: false,
    },
    rows: { type: 'integer', minimum: 1, maximum: 100 },
    seats_per_row: { type: 'integer', minimum: 1, maximum: 100 },
    paired: { type: 'boolean' },
    horizontal_gap_m: { type: 'number', minimum: 0, maximum: 100 },
    vertical_gap_m: { type: 'number', minimum: 0, maximum: 100 },
    rotation: { type: 'number', description: 'Degrees' },
    category: { type: 'string', maxLength: 50 },
    price: { type: 'number', minimum: 0, maximum: 100000, description: 'Gross price per sunbed; omit to use the site price' },
  },
  required: ['anchor', 'rows', 'seats_per_row'],
  handler: inventoryHandler,
  async plan(input: Input, ctx) {
    const mode = await siteLayoutMode(ctx.siteId)
    const a = isObj(input.anchor) ? input.anchor : {}
    let anchor: Anchor
    if (a.relative_to_parcel !== undefined) {
      if (!Number.isInteger(a.relative_to_parcel)) return err('anchor.relative_to_parcel must be a parcel number')
      const off = metres(a.offset_m ?? { dx: 0, dy: 0 }, 'anchor.offset_m')
      if (hasErrors(off)) return off
      anchor = { relativeTo: a.relative_to_parcel as number, dx: off.dx, dy: off.dy }
    } else {
      const pt = parsePoint(a, mode, 'anchor')
      if (hasErrors(pt)) return pt
      anchor = pt
    }
    const patch: ParcelConfigPatch = {
      rows: input.rows as number, seatsPerRow: input.seats_per_row as number,
      ...(input.horizontal_gap_m !== undefined ? { horizontalGap: input.horizontal_gap_m as number } : {}),
      ...(input.vertical_gap_m !== undefined ? { verticalGap: input.vertical_gap_m as number } : {}),
      ...(input.rotation !== undefined ? { rotation: input.rotation as number } : {}),
      ...(input.price !== undefined ? { price: input.price as number } : {}),
      ...(input.category !== undefined ? { category: input.category as string } : {}),
    }
    const invalid = validatePatch(patch)
    if (invalid) return err(invalid)
    if (input.paired !== undefined && typeof input.paired !== 'boolean') return err('paired must be true or false')

    const agg = await prisma.inventoryItem.aggregate({ where: { siteId: ctx.siteId }, _max: { group: true } })
    const op: InvOp = {
      op: 'create_parcel', number: (agg._max.group ?? 0) + 1, anchor,
      rows: patch.rows!, seatsPerRow: patch.seatsPerRow!, paired: input.paired !== false,
      horizontalGap: patch.horizontalGap ?? 1, verticalGap: patch.verticalGap ?? 1.5, rotation: patch.rotation ?? 0,
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.price !== undefined ? { price: patch.price } : {}),
    }
    return finish(ctx, [op])
  },
})

export const proposeEditParcel = proposeTool<InventoryPayload>({
  name: 'propose_edit_parcel',
  label: 'Preparing a parcel change',
  description:
    'Propose re-configuring an existing parcel by its number: rows, seats_per_row, gaps in metres, paired, category, price, rotation (absolute degrees). Give only what changes. Growing adds sunbeds, shrinking removes the last ones (refused over booked sunbeds or sunbeds with a device). Changing the shape can renumber sunbeds, which means their printed QR cards must be reprinted (the warning says how many). Unpairing an existing paired parcel is not supported.',
  properties: {
    parcel: { type: 'integer', minimum: 1, maximum: 9999 },
    rows: { type: 'integer', minimum: 1, maximum: 100 },
    seats_per_row: { type: 'integer', minimum: 1, maximum: 100 },
    horizontal_gap_m: { type: 'number', minimum: 0, maximum: 100 },
    vertical_gap_m: { type: 'number', minimum: 0, maximum: 100 },
    paired: { type: 'boolean' },
    category: { type: 'string', maxLength: 50 },
    price: { type: 'number', minimum: 0, maximum: 100000 },
    rotation: { type: 'number', description: 'Absolute degrees' },
  },
  required: ['parcel'],
  handler: inventoryHandler,
  plan(input: Input, ctx) {
    if (!Number.isInteger(input.parcel) || (input.parcel as number) < 1) return err('parcel must be a parcel number')
    const patch: ParcelConfigPatch = {
      ...(input.rows !== undefined ? { rows: input.rows as number } : {}),
      ...(input.seats_per_row !== undefined ? { seatsPerRow: input.seats_per_row as number } : {}),
      ...(input.horizontal_gap_m !== undefined ? { horizontalGap: input.horizontal_gap_m as number } : {}),
      ...(input.vertical_gap_m !== undefined ? { verticalGap: input.vertical_gap_m as number } : {}),
      ...(input.paired !== undefined ? { pairSeats: input.paired as boolean } : {}),
      ...(input.category !== undefined ? { category: input.category as string } : {}),
      ...(input.price !== undefined ? { price: input.price as number } : {}),
      ...(input.rotation !== undefined ? { rotation: input.rotation as number } : {}),
    }
    if (Object.keys(patch).length === 0) return err('Give at least one field to change')
    const invalid = validatePatch(patch)
    if (invalid) return err(invalid)
    return finish(ctx, [{ op: 'edit_parcel', parcel: input.parcel as number, patch }])
  },
})

export const proposeRotate = proposeTool<InventoryPayload>({
  name: 'propose_rotate',
  label: 'Preparing a rotation',
  description:
    'Propose rotating by `degrees` (positive = clockwise, whole degrees). A parcel target regenerates the whole grid around its centre; seats turn the unit(s) they belong to together (a single bed turns in place); selection rotates the user\'s selected sunbeds as a group around their centre.',
  properties: { target: TARGET_SCHEMA, degrees: { type: 'number', minimum: -360, maximum: 360 } },
  required: ['target', 'degrees'],
  handler: inventoryHandler,
  async plan(input: Input, ctx) {
    const t = await parseTarget(input.target, ctx)
    if (hasErrors(t)) return t
    if (!num(input.degrees)) return err('degrees must be a number')
    return finish(ctx, [{ op: 'rotate', target: t.target, degrees: input.degrees }])
  },
})

export const proposeSpacing = proposeTool<InventoryPayload>({
  name: 'propose_spacing',
  label: 'Preparing spacing',
  description:
    'Propose changing the spacing of the target sunbeds: axis x (along the rows, between seats), y (between rows) or both, scaled by `factor` (1.25 = 25% more room, 0.8 = tighter). Needs at least 2 sunbeds.',
  properties: {
    target: TARGET_SCHEMA,
    axis: { type: 'string', enum: ['x', 'y', 'both'] },
    factor: { type: 'number', minimum: 0.1, maximum: 10 },
  },
  required: ['target', 'axis', 'factor'],
  handler: inventoryHandler,
  async plan(input: Input, ctx) {
    const t = await parseTarget(input.target, ctx)
    if (hasErrors(t)) return t
    if (input.axis !== 'x' && input.axis !== 'y' && input.axis !== 'both') return err('axis must be x, y or both')
    if (!num(input.factor)) return err('factor must be a number')
    return finish(ctx, [{ op: 'spacing', target: t.target, axis: input.axis, factor: input.factor }])
  },
})

export const proposeMove = proposeTool<InventoryPayload>({
  name: 'propose_move',
  label: 'Preparing a move',
  description:
    'Propose moving the target. Give EITHER `to` (an absolute point: { lat, lng } on a map site, { x, y } metres on a schematic; for a parcel it is where the parcel\'s anchor/first sunbed goes, for seats where their centre goes) OR `by_m` ({ dx, dy } metres: dx east/right, dy north/up). Prefer by_m for relative requests ("3 metres towards the sea").',
  properties: {
    target: TARGET_SCHEMA,
    to: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } }, additionalProperties: false },
    by_m: { type: 'object', properties: { dx: { type: 'number' }, dy: { type: 'number' } }, additionalProperties: false },
  },
  required: ['target'],
  handler: inventoryHandler,
  async plan(input: Input, ctx) {
    const t = await parseTarget(input.target, ctx)
    if (hasErrors(t)) return t
    if ((input.to === undefined) === (input.by_m === undefined)) return err('Give exactly one of to or by_m')
    if (input.by_m !== undefined) {
      const by = metres(input.by_m, 'by_m')
      if (hasErrors(by)) return by
      return finish(ctx, [{ op: 'move', target: t.target, by }])
    }
    const mode = await siteLayoutMode(ctx.siteId)
    const to = parsePoint(input.to, mode, 'to')
    if (hasErrors(to)) return to
    return finish(ctx, [{ op: 'move', target: t.target, to }])
  },
})

export const proposeSetStatus = proposeTool<InventoryPayload>({
  name: 'propose_set_status',
  label: 'Preparing a status change',
  description:
    'Propose setting sunbeds active (bookable) or disabled (kept on the map but not bookable, e.g. broken or seasonal). Does not cancel existing reservations.',
  properties: { target: TARGET_SCHEMA, status: { type: 'string', enum: ['active', 'disabled'] } },
  required: ['target', 'status'],
  handler: inventoryHandler,
  async plan(input: Input, ctx) {
    const t = await parseTarget(input.target, ctx)
    if (hasErrors(t)) return t
    if (input.status !== 'active' && input.status !== 'disabled') return err('status must be active or disabled')
    return finish(ctx, [{ op: 'set_status', target: t.target, status: input.status }])
  },
})

export const proposeReverse = proposeTool<InventoryPayload>({
  name: 'propose_reverse',
  label: 'Preparing a reversal',
  description:
    'Propose reversing a parcel: `numbering` counts the seats in each row from the opposite end (beds stay where they are; their QR cards must be reprinted), `orientation` turns every bed 180 degrees.',
  properties: { parcel: { type: 'integer', minimum: 1, maximum: 9999 }, what: { type: 'string', enum: ['numbering', 'orientation'] } },
  required: ['parcel', 'what'],
  handler: inventoryHandler,
  plan(input: Input, ctx) {
    if (!Number.isInteger(input.parcel) || (input.parcel as number) < 1) return err('parcel must be a parcel number')
    if (input.what !== 'numbering' && input.what !== 'orientation') return err('what must be numbering or orientation')
    return finish(ctx, [{ op: 'reverse', parcel: input.parcel as number, what: input.what }])
  },
})

export const proposeDelete = proposeTool<InventoryPayload>({
  name: 'propose_delete',
  label: 'Preparing a deletion',
  description:
    'Propose DELETING a parcel or sunbeds. This cannot be undone: the user must confirm by typing. Refused when a device is mounted on the sunbeds; warns when reservations include them. Always say plainly that it is permanent.',
  properties: { target: TARGET_SCHEMA },
  required: ['target'],
  handler: inventoryHandler,
  async plan(input: Input, ctx) {
    const t = await parseTarget(input.target, ctx)
    if (hasErrors(t)) return t
    return finish(ctx, [{ op: 'delete', target: t.target }])
  },
})

export const inventoryTools: AssistantTool[] = [
  proposeCreateParcel,
  proposeEditParcel,
  proposeRotate,
  proposeSpacing,
  proposeMove,
  proposeSetStatus,
  proposeReverse,
  proposeDelete,
]
