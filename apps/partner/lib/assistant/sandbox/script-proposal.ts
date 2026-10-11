/**
 * Turn a run_js script's returned `proposal: { ops, summary }` into `inventory_batch` ops (track 030 G4).
 *
 * The script is untrusted model output, so this is a STRICT parser, not a cast: every op is
 * re-built field by field from an allowlist (unknown keys are errors), numbers are range-checked,
 * parcel references are NUMBERS that must exist on the ctx site (resolved server-side — a script
 * never supplies an id), seat references are seat ids the inventory simulator resolves within the
 * site. Deletion is never available to a script. Coordinates are in the run_js local metre frame
 * (x east, y north) and converted to the site's own coordinates here, so the script never handles
 * lat/lng. The ops then go through the SAME planInventory -> createProposalFor path as the
 * propose_* tools (ghost preview, apply / undo unchanged).
 */
import { toSite, type Frame } from '../geo/frame'
import { validatePatch } from '@/app/sites/[id]/inventory/parcel-config'
import type { ParcelConfigPatch } from '@/app/sites/[id]/inventory/parcel-config'
import type { Anchor, InvOp, Target } from '../proposals/inventory-sim'

export const MAX_SCRIPT_OPS = 50
export const SCRIPT_OPS = ['create_parcel', 'edit_parcel', 'rotate', 'spacing', 'move', 'set_status', 'reverse'] as const

export interface ScriptSiteCtx {
  frame: Frame
  /** Parcel numbers that exist on the ctx site. */
  parcels: ReadonlySet<number>
  /** Number the first created parcel gets (max existing + 1). */
  nextParcelNumber: number
}

export type ScriptProposal = { ops: InvOp[]; summary: string | null } | { errors: string[] }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

class Bad extends Error {}
const fail = (msg: string): never => {
  throw new Bad(msg)
}

function only(o: Obj, allowed: readonly string[], where: string) {
  const extra = Object.keys(o).filter((k) => !allowed.includes(k))
  if (extra.length) fail(`${where}: unknown field(s) ${extra.join(', ')}`)
}
function number(v: unknown, where: string, min: number, max: number): number {
  if (!fin(v) || v < min || v > max) fail(`${where} must be a number between ${min} and ${max}`)
  return v as number
}
function int(v: unknown, where: string, min: number, max: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) fail(`${where} must be a whole number between ${min} and ${max}`)
  return v as number
}

function parcelRef(v: unknown, where: string, sc: ScriptSiteCtx): number {
  const n = int(v, where, 1, 9999)
  if (!sc.parcels.has(n)) fail(`${where}: parcel ${n} does not exist on this site`)
  return n
}

function target(v: unknown, where: string, sc: ScriptSiteCtx): Target {
  if (!isObj(v)) return fail(`${where}.target must be { parcel: <number> } or { seats: ["1-2-3-1", ...] }`)
  only(v, ['parcel', 'seats'], `${where}.target`)
  if ((v.parcel === undefined) === (v.seats === undefined)) fail(`${where}.target needs exactly one of parcel, seats`)
  if (v.parcel !== undefined) return { parcel: parcelRef(v.parcel, `${where}.target.parcel`, sc) }
  const seats = v.seats
  if (!Array.isArray(seats) || seats.length < 1 || seats.length > 300) return fail(`${where}.target.seats must list 1-300 seat ids`)
  for (const s of seats) {
    if (typeof s !== 'string' || !/^\d{1,4}-\d{1,3}-\d{1,2}(-\d{1,2})?$/.test(s)) fail(`${where}.target.seats: "${String(s).slice(0, 20)}" is not a seat id like 1-2-3-1`)
    if (!sc.parcels.has(Number(s.split('-')[0]))) fail(`${where}.target.seats: parcel of ${s} does not exist on this site`)
  }
  return { seats: [...seats] as string[] }
}

const LOCAL_MAX = 10_000
const MOVE_MAX = 5000

/** A local-frame point -> the site's own (y, x): lat/lng on a map site, schematic metres on a plan. */
function sitePoint(v: unknown, where: string, sc: ScriptSiteCtx): { y: number; x: number } {
  if (!isObj(v)) return fail(`${where} must be { x, y } in local metres`)
  only(v, ['x', 'y'], where)
  const x = number(v.x, `${where}.x`, -LOCAL_MAX, LOCAL_MAX)
  const y = number(v.y, `${where}.y`, -LOCAL_MAX, LOCAL_MAX)
  const p = toSite(sc.frame, { x, y })
  return 'lat' in p ? { y: p.lat, x: p.lng } : { y: p.y, x: p.x }
}

function patchFrom(o: Obj, where: string): ParcelConfigPatch {
  const patch: ParcelConfigPatch = {}
  if (o.rows !== undefined) patch.rows = int(o.rows, `${where}.rows`, 1, 100)
  if (o.seats_per_row !== undefined) patch.seatsPerRow = int(o.seats_per_row, `${where}.seats_per_row`, 1, 100)
  if (o.horizontal_gap_m !== undefined) patch.horizontalGap = number(o.horizontal_gap_m, `${where}.horizontal_gap_m`, 0, 100)
  if (o.vertical_gap_m !== undefined) patch.verticalGap = number(o.vertical_gap_m, `${where}.vertical_gap_m`, 0, 100)
  if (o.rotation !== undefined) patch.rotation = number(o.rotation, `${where}.rotation`, -360, 360)
  if (o.price !== undefined) patch.price = number(o.price, `${where}.price`, 0, 100000)
  if (o.category !== undefined) {
    if (typeof o.category !== 'string' || o.category.length > 50) fail(`${where}.category must be a string of at most 50 characters`)
    patch.category = o.category as string
  }
  const invalid = validatePatch(patch)
  if (invalid) fail(`${where}: ${invalid}`)
  return patch
}

const PATCH_KEYS = ['rows', 'seats_per_row', 'horizontal_gap_m', 'vertical_gap_m', 'rotation', 'price', 'category'] as const

function parseOp(raw: unknown, i: number, sc: ScriptSiteCtx, created: { n: number }): InvOp {
  const where = `ops[${i}]`
  if (!isObj(raw)) return fail(`${where} must be an object with an "op"`)
  const op = raw.op
  if (op === 'delete') return fail(`${where}: scripts cannot delete; use propose_delete for that (the user must confirm it by typing)`)
  if (typeof op !== 'string' || !(SCRIPT_OPS as readonly string[]).includes(op)) return fail(`${where}.op must be one of ${SCRIPT_OPS.join(', ')}`)

  switch (op) {
    case 'create_parcel': {
      only(raw, ['op', 'anchor', 'paired', ...PATCH_KEYS], where)
      if (raw.rows === undefined || raw.seats_per_row === undefined) fail(`${where}: create_parcel needs rows and seats_per_row`)
      const patch = patchFrom(raw, where)
      if (raw.paired !== undefined && typeof raw.paired !== 'boolean') fail(`${where}.paired must be true or false`)
      const a = raw.anchor
      if (!isObj(a)) return fail(`${where}.anchor must be { x, y } (local metres) or { relative_to_parcel, offset_m: { dx, dy } }`)
      let anchor: Anchor
      if (a.relative_to_parcel !== undefined) {
        only(a, ['relative_to_parcel', 'offset_m'], `${where}.anchor`)
        const rel = parcelRef(a.relative_to_parcel, `${where}.anchor.relative_to_parcel`, sc)
        const off = a.offset_m ?? { dx: 0, dy: 0 }
        if (!isObj(off)) return fail(`${where}.anchor.offset_m must be { dx, dy }`)
        only(off, ['dx', 'dy'], `${where}.anchor.offset_m`)
        anchor = { relativeTo: rel, dx: number(off.dx, `${where}.anchor.offset_m.dx`, -MOVE_MAX, MOVE_MAX), dy: number(off.dy, `${where}.anchor.offset_m.dy`, -MOVE_MAX, MOVE_MAX) }
      } else {
        anchor = sitePoint(a, `${where}.anchor`, sc)
      }
      const number_ = sc.nextParcelNumber + created.n++
      return {
        op: 'create_parcel', number: number_, anchor, rows: patch.rows!, seatsPerRow: patch.seatsPerRow!, paired: raw.paired !== false,
        horizontalGap: patch.horizontalGap ?? 1, verticalGap: patch.verticalGap ?? 1.5, rotation: patch.rotation ?? 0,
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.price !== undefined ? { price: patch.price } : {}),
      }
    }
    case 'edit_parcel': {
      only(raw, ['op', 'parcel', 'paired', ...PATCH_KEYS], where)
      const parcel = parcelRef(raw.parcel, `${where}.parcel`, sc)
      const patch = patchFrom(raw, where)
      if (raw.paired !== undefined) {
        if (typeof raw.paired !== 'boolean') fail(`${where}.paired must be true or false`)
        patch.pairSeats = raw.paired as boolean
      }
      if (Object.keys(patch).length === 0) fail(`${where}: edit_parcel needs at least one field to change`)
      return { op: 'edit_parcel', parcel, patch }
    }
    case 'rotate':
      only(raw, ['op', 'target', 'degrees'], where)
      return { op: 'rotate', target: target(raw.target, where, sc), degrees: number(raw.degrees, `${where}.degrees`, -360, 360) }
    case 'spacing': {
      only(raw, ['op', 'target', 'axis', 'factor'], where)
      const axis = raw.axis
      if (axis !== 'x' && axis !== 'y' && axis !== 'both') fail(`${where}.axis must be x, y or both`)
      return { op: 'spacing', target: target(raw.target, where, sc), axis: axis as 'x' | 'y' | 'both', factor: number(raw.factor, `${where}.factor`, 0.1, 10) }
    }
    case 'move': {
      only(raw, ['op', 'target', 'by', 'to'], where)
      const t = target(raw.target, where, sc)
      if ((raw.by === undefined) === (raw.to === undefined)) fail(`${where}: move needs exactly one of by ({ dx, dy } metres) or to ({ x, y } local metres)`)
      if (raw.by !== undefined) {
        if (!isObj(raw.by)) return fail(`${where}.by must be { dx, dy }`)
        only(raw.by, ['dx', 'dy'], `${where}.by`)
        const dx = number(raw.by.dx, `${where}.by.dx`, -MOVE_MAX, MOVE_MAX)
        const dy = number(raw.by.dy, `${where}.by.dy`, -MOVE_MAX, MOVE_MAX)
        return { op: 'move', target: t, by: { dx, dy } }
      }
      return { op: 'move', target: t, to: sitePoint(raw.to, `${where}.to`, sc) }
    }
    case 'set_status': {
      only(raw, ['op', 'target', 'status'], where)
      if (raw.status !== 'active' && raw.status !== 'disabled') fail(`${where}.status must be active or disabled`)
      return { op: 'set_status', target: target(raw.target, where, sc), status: raw.status as 'active' | 'disabled' }
    }
    case 'reverse': {
      only(raw, ['op', 'parcel', 'what'], where)
      if (raw.what !== 'numbering' && raw.what !== 'orientation') fail(`${where}.what must be numbering or orientation`)
      return { op: 'reverse', parcel: parcelRef(raw.parcel, `${where}.parcel`, sc), what: raw.what as 'numbering' | 'orientation' }
    }
  }
  return fail(`${where}: unsupported op`)
}

/** Strictly parse a script's `proposal` value. */
export function parseScriptProposal(raw: unknown, sc: ScriptSiteCtx): ScriptProposal {
  try {
    if (!isObj(raw)) fail('proposal must be { ops: [...], summary: "..." }')
    const p = raw as Obj
    only(p, ['ops', 'summary'], 'proposal')
    if (p.summary !== undefined && (typeof p.summary !== 'string' || p.summary.length > 500)) fail('proposal.summary must be a string of at most 500 characters')
    if (!Array.isArray(p.ops) || p.ops.length === 0) fail('proposal.ops must be a non-empty array')
    const ops = p.ops as unknown[]
    if (ops.length > MAX_SCRIPT_OPS) fail(`proposal.ops has ${ops.length} ops; at most ${MAX_SCRIPT_OPS} per proposal -- split it`)
    const created = { n: 0 }
    return { ops: ops.map((o, i) => parseOp(o, i, sc, created)), summary: typeof p.summary === 'string' ? p.summary : null }
  } catch (err) {
    if (err instanceof Bad) return { errors: [err.message] }
    throw err
  }
}
