/**
 * Inventory proposal simulation (track 030 S4a).
 *
 * `simulate(siteId, ops)` loads the parcels the ops touch, runs every op IN ORDER against an in-memory
 * copy using the SAME pure functions the server actions run (inventory/geometry.ts, parcel-config.ts),
 * and returns everything a proposal needs: the user-facing `Diff` (+ map `geometry`), the exact list of
 * server-action calls apply will make (`calls`), the expected after-state (undo staleness) and the set
 * of touched seats (snapshot). It never writes.
 *
 * Execute re-runs the simulation and performs `calls`, so the previewed arguments and the applied
 * arguments are the same objects by construction. Model-facing handles only (parcel number, seat
 * label); every id is resolved WITHIN the site.
 */
import { createHash } from 'node:crypto'
import prisma from '@repo/data/PrismaCient'
import { formatSeatId } from '@repo/data/seat-label'
import { devicesBlockingSeatRemoval, deviceRemovalError } from '@repo/data/unit'
import { TERMINAL_STATUSES } from '@repo/data/reservation-status'
import { SUNBED_HEIGHT, SUNBED_WIDTH, type ChairConfig } from '@/app/sites/[id]/inventory/chair-util'
import {
  buildItemGroupData,
  centroidOf,
  flippedRotation,
  generateLayout,
  matchSeats,
  metresToDelta,
  normalizedRotation,
  reversedNumbers,
  rotatePositions,
  shiftToExistingCentroid,
  spacePositions,
  type LayoutMode,
  type PosItem,
} from '@/app/sites/[id]/inventory/geometry'
import { buildParcelConfig, type ItemGroupLike, type ParcelConfigPatch } from '@/app/sites/[id]/inventory/parcel-config'
import { storedSeatLabel } from '../tools/helpers'
import { ProposalError, type Change, type Create, type Diff, type GeoPoint, type GeoPose, type InventoryGeometry, type Remove, type Scalar } from './types'

// ─── payload ────────────────────────────────────────────────────────────────

/** What an op acts on. `seats` = seat labels ("1-2-3-1" / unit "1-2-3"); `ids` = a verified selection. */
export type Target = { parcel: number } | { seats: string[] } | { ids: string[] }

/** `y`/`x` = lat/lng (geo) or schematic y/x in metres. `relativeTo` = metres from that parcel's anchor. */
export type Anchor = { y: number; x: number } | { relativeTo: number; dx: number; dy: number }

export type InvOp =
  | { op: 'create_parcel'; number: number; anchor: Anchor; rows: number; seatsPerRow: number; paired: boolean; horizontalGap: number; verticalGap: number; rotation: number; category?: string; price?: number }
  | { op: 'edit_parcel'; parcel: number; patch: ParcelConfigPatch }
  | { op: 'rotate'; target: Target; degrees: number }
  | { op: 'spacing'; target: Target; axis: 'x' | 'y' | 'both'; factor: number }
  | { op: 'move'; target: Target; to?: { y: number; x: number }; by?: { dx: number; dy: number } }
  | { op: 'set_status'; target: Target; status: 'active' | 'disabled' }
  | { op: 'reverse'; parcel: number; what: 'numbering' | 'orientation' }
  | { op: 'delete'; target: Target }

/** After-state of what the ops wrote, for the undo staleness check. */
export interface Expect {
  /** [id, y, x, rotation, status, number, group] */
  seats: Array<[string, number, number, number, string, number, number]>
  /** New seats: [group, number, y, x, rotation] */
  created: Array<[number, number, number, number, number]>
  removed: string[]
}

export interface InventoryPayload {
  ops: InvOp[]
  expect?: Expect
}

/** The server-action calls apply makes, in order (a pure description of the plan). */
export type ExecCall =
  | { fn: 'sync'; config: ChairConfig }
  | { fn: 'applyParcelConfig'; group: number; patch: ParcelConfigPatch }
  | { fn: 'rotateParcel'; group: number; delta: number }
  | { fn: 'rotateUnit'; itemId: string; delta: number }
  | { fn: 'rotateSelection'; ids: string[]; delta: number }
  | { fn: 'adjustItemSpacing'; ids: string[]; axis: 'horizontal' | 'vertical'; factor: number }
  | { fn: 'moveParcel'; group: number; y: number; x: number }
  | { fn: 'moveItems'; ids: string[]; dy: number; dx: number }
  | { fn: 'setSeatsStatus'; ids: string[]; status: 'active' | 'disabled' }
  | { fn: 'reverseParcelNumbering'; group: number }
  | { fn: 'reverseParcelOrientation'; group: number }
  | { fn: 'deleteItemsByGroup'; group: number }
  | { fn: 'deleteInventoryItems'; ids: string[] }

// ─── in-memory model ────────────────────────────────────────────────────────

interface SimSeat {
  key: string
  id: string | null
  number: number
  group: number
  y: number
  x: number
  rotation: number | null
  status: string
  igKey: string | null
  unit: string | null
  seatLabel: string | null
  isNew: boolean
}

interface SimIg {
  id: string | null
  rows: number
  seatsPerRow: number
  horizontalGap: number
  verticalGap: number
  pairGap: number
  rotation: number
  category: string | null
  price: number | null
  y: number
  x: number
}

interface SimParcel {
  number: number
  seats: SimSeat[]
  ig: SimIg | null
  paired: boolean
  isNew: boolean
}

const SEAT_SELECT = {
  id: true, number: true, group: true, status: true, rotation: true,
  locationLat: true, locationLng: true, schematicX: true, schematicY: true,
  itemGroupId: true, sunbedGroupId: true, seatLabel: true,
} as const

/** Most seats one proposal may touch (preview size, payload size, apply time). */
export const MAX_TOUCHED = 1200
const MAX_PREVIEW_SEATS = 400
const MAX_SEAT_LABELS = 300
const MAX_LISTED = 10

const active = (p: SimParcel) => p.seats.filter((s) => s.status !== 'pool')
const seatName = (s: Pick<SimSeat, 'seatLabel' | 'number'>) => formatSeatId({ seatLabel: s.seatLabel, number: s.number })
const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const r2 = (n: number) => Math.round(n * 100) / 100

export interface SimResult {
  diff: Diff
  calls: ExecCall[]
  expect: Expect
  /** Existing seat ids that changed or were removed: what a snapshot must capture. */
  touchedIds: string[]
  /** Parcels that gained seats (create / grow): extras to delete on undo, with their pre-apply seat ids. */
  grownGroups: number[]
  removedCount: number
}

/** A move shorter than this is not applied (invisible on the map). */
export const MIN_MOVE_M = 0.5

export class InventorySim {
  private parcels = new Map<number, SimParcel>()
  private initial = new Map<string, SimSeat>()
  private fingerprints: string[] = []
  private calls: ExecCall[] = []
  private changes: Change[] = []
  private creates: Create[] = []
  private deletes: Remove[] = []
  private warnings: string[] = []
  private removed: SimSeat[] = []
  private moveMetres: number[] = []
  private qr = new Set<string>()
  private touchedParcels = new Set<number>()
  private newKey = 0
  private maxGroup: number | null = null

  constructor(private readonly siteId: string, private readonly mode: LayoutMode) {}

  // ─── loading ──────────────────────────────────────────────────────────────

  private toSim(r: {
    id: string; number: number; group: number; status: string; rotation: number | null
    locationLat: string; locationLng: string; schematicX: number | null; schematicY: number | null
    itemGroupId: string | null; sunbedGroupId: string | null; seatLabel: string | null
  }): SimSeat {
    const schematic = this.mode === 'schematic'
    return {
      key: r.id, id: r.id, number: r.number, group: r.group,
      y: schematic ? (r.schematicY ?? 0) : parseFloat(r.locationLat),
      x: schematic ? (r.schematicX ?? 0) : parseFloat(r.locationLng),
      rotation: r.rotation, status: r.status, igKey: r.itemGroupId, unit: r.sunbedGroupId,
      seatLabel: r.seatLabel, isNew: false,
    }
  }

  private register(rows: Array<Parameters<InventorySim['toSim']>[0]>): SimSeat[] {
    return rows.map((r) => {
      const seat = this.toSim(r)
      this.initial.set(seat.key, { ...seat })
      this.fingerprints.push(JSON.stringify([r.id, r.number, r.group, r.status, r.rotation, r.locationLat, r.locationLng, r.schematicX, r.schematicY, r.itemGroupId, r.sunbedGroupId]))
      return seat
    })
  }

  /** Load a whole parcel (pool extras included) WITHIN the site. Null when it has no seats. */
  private async load(number: number): Promise<SimParcel | null> {
    const cached = this.parcels.get(number)
    if (cached) return cached
    if (!Number.isInteger(number) || number < 1) return null
    const rows = await prisma.inventoryItem.findMany({
      where: { siteId: this.siteId, group: number },
      select: SEAT_SELECT,
      orderBy: { number: 'asc' },
    })
    if (rows.length === 0) return null
    const seats = this.register(rows)
    const igId = rows.find((r) => r.status !== 'pool' && r.itemGroupId)?.itemGroupId ?? null
    let ig: SimIg | null = null
    if (igId) {
      const row = await prisma.itemGroup.findUnique({ where: { id: igId } })
      if (row) {
        const schematic = this.mode === 'schematic'
        ig = {
          id: row.id, rows: row.rows, seatsPerRow: row.seatsPerRow, horizontalGap: row.horizontalGap,
          verticalGap: row.verticalGap, pairGap: row.pairGap, rotation: row.rotation,
          category: row.category, price: row.price,
          y: schematic ? (row.schematicY ?? 0) : parseFloat(row.locationLat),
          x: schematic ? (row.schematicX ?? 0) : parseFloat(row.locationLng),
        }
        this.fingerprints.push(JSON.stringify(['ig', row.id, row.number, row.rows, row.seatsPerRow, row.horizontalGap, row.verticalGap, row.pairGap, row.rotation, row.locationLat, row.locationLng, row.schematicX, row.schematicY, row.category, row.price]))
      }
    }
    const placed = seats.filter((s) => s.status !== 'pool')
    const members = new Map<string, number>()
    for (const s of placed) if (s.unit) members.set(s.unit, (members.get(s.unit) ?? 0) + 1)
    const paired = members.size === 0 ? (ig?.pairGap ?? 0.4) > 0 : [...members.values()].some((n) => n > 1)
    const parcel: SimParcel = { number, seats, ig, paired, isNew: false }
    this.parcels.set(number, parcel)
    return parcel
  }

  private async parcel(number: number): Promise<SimParcel> {
    const p = await this.load(number)
    if (!p) throw new ProposalError(`Parcel ${number} was not found on this site`)
    return p
  }

  private async nextParcelNumber(): Promise<number> {
    if (this.maxGroup === null) {
      const agg = await prisma.inventoryItem.aggregate({ where: { siteId: this.siteId }, _max: { group: true } })
      this.maxGroup = agg._max.group ?? 0
    }
    return this.maxGroup + 1
  }

  /** Resolve a target to sim seats (whole parcels loaded). */
  private async resolve(target: Target): Promise<{ seats: SimSeat[]; parcel?: number }> {
    if ('parcel' in target) {
      const p = await this.parcel(target.parcel)
      this.touchedParcels.add(p.number)
      return { seats: p.seats, parcel: p.number }
    }
    let rows: Array<{ id: string; group: number }>
    if ('seats' in target) {
      if (target.seats.length === 0) throw new ProposalError('No sunbeds given')
      if (target.seats.length > MAX_SEAT_LABELS) throw new ProposalError(`At most ${MAX_SEAT_LABELS} sunbeds per request`)
      rows = []
      for (const raw of target.seats) {
        const stored = storedSeatLabel(String(raw))
        if (!stored) throw new ProposalError(`"${raw}" is not a sunbed id: use parcel-row-unit-member like 1-2-3-1 (or a unit 1-2-3)`)
        const found = await prisma.inventoryItem.findMany({
          where: {
            siteId: this.siteId,
            status: { not: 'pool' },
            seatLabel: stored.label.endsWith('-') ? { startsWith: stored.label } : stored.label,
          },
          select: { id: true, group: true },
        })
        if (found.length === 0) throw new ProposalError(`Sunbed ${raw} was not found on this site`)
        rows.push(...found)
      }
    } else {
      if (target.ids.length === 0) throw new ProposalError('The selection is empty')
      rows = await prisma.inventoryItem.findMany({
        where: { id: { in: target.ids }, siteId: this.siteId, status: { not: 'pool' } },
        select: { id: true, group: true },
      })
      if (rows.length === 0) throw new ProposalError('The selected sunbeds no longer exist on this site')
    }
    const ids = new Set(rows.map((r) => r.id))
    for (const g of new Set(rows.map((r) => r.group))) {
      if (g >= 1) {
        await this.parcel(g)
        this.touchedParcels.add(g)
      }
    }
    // Ungrouped (parcel 0) seats are not part of any parcel: load them individually.
    const loose = rows.filter((r) => r.group < 1 && !this.initial.has(r.id)).map((r) => r.id)
    if (loose.length) {
      const looseRows = await prisma.inventoryItem.findMany({ where: { id: { in: loose }, siteId: this.siteId }, select: SEAT_SELECT })
      const parcel0 = this.parcels.get(0) ?? { number: 0, seats: [], ig: null, paired: false, isNew: false }
      parcel0.seats.push(...this.register(looseRows))
      this.parcels.set(0, parcel0)
    }
    const seats: SimSeat[] = []
    for (const p of this.parcels.values()) for (const s of p.seats) if (s.id && ids.has(s.id)) seats.push(s)
    // Dedupe + keep the order the user gave when it was a label list.
    return { seats }
  }

  // ─── bookkeeping helpers ──────────────────────────────────────────────────

  private pos(y: number, x: number): string {
    return this.mode === 'schematic' ? `x ${r2(x)}, y ${r2(y)}` : `${r6(y)}, ${r6(x)}`
  }

  private push(target: string, field: string, label: string, before: Scalar, after: Scalar) {
    if (before === after) return
    this.changes.push({ target, field, label, before, after })
  }

  private seatTargetLabel(seats: SimSeat[]): string {
    return seats.length === 1 ? `Seat ${seatName(seats[0]!)}` : `${seats.length} sunbeds`
  }

  private ig(p: SimParcel): ItemGroupLike | null {
    if (!p.ig) return null
    const schematic = this.mode === 'schematic'
    return {
      id: p.ig.id ?? `new:${p.number}`, number: p.number, seatsPerRow: p.ig.seatsPerRow,
      horizontalGap: p.ig.horizontalGap, verticalGap: p.ig.verticalGap, rotation: p.ig.rotation,
      pairGap: p.ig.pairGap, category: p.ig.category, price: p.ig.price,
      locationLat: schematic ? '0' : String(p.ig.y), locationLng: schematic ? '0' : String(p.ig.x),
      schematicX: schematic ? p.ig.x : null, schematicY: schematic ? p.ig.y : null,
    }
  }

  private async bookedCount(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    return prisma.reservation.count({
      where: {
        siteId: this.siteId,
        to: { gte: new Date() },
        status: { notIn: [...TERMINAL_STATUSES] },
        items: { some: { id: { in: ids } } },
      },
    })
  }

  private async assertNoDevices(ids: string[]) {
    const blocking = await devicesBlockingSeatRemoval(this.siteId, ids)
    if (blocking.length > 0) throw new ProposalError(deviceRemovalError(blocking))
  }

  // ─── ops ──────────────────────────────────────────────────────────────────

  async run(ops: InvOp[]) {
    this.moveMetres = []
    for (const op of ops) {
      switch (op.op) {
        case 'create_parcel': await this.createParcel(op); break
        case 'edit_parcel': await this.editParcel(op); break
        case 'rotate': await this.rotate(op); break
        case 'spacing': await this.spacing(op); break
        case 'move': await this.move(op); break
        case 'set_status': await this.setStatus(op); break
        case 'reverse': await this.reverse(op); break
        case 'delete': await this.remove(op); break
      }
    }
    // The assistant acts immediately (no review step), so a move that is invisible is refused rather than applied.
    // Only a batch made of nothing but moves is judged: a tiny nudge inside a bigger layout script is legitimate.
    if (ops.length > 0 && ops.every((o) => o.op === 'move') && this.moveMetres.length > 0 && Math.max(...this.moveMetres) < MIN_MOVE_M) {
      throw new ProposalError(`That move is only ${(Math.round(Math.max(...this.moveMetres) * 100) / 100).toString()} m, under ${MIN_MOVE_M} m: not worth doing. Nothing was changed; tell the user how things currently stand instead.`)
    }
  }

  /** Metres moved for a (dy, dx) delta at latitude/row `atY` in this site's coordinate system. */
  private deltaMetres(atY: number, dy: number, dx: number): number {
    if (this.mode === 'schematic') return Math.hypot(dx, dy)
    return Math.hypot(dy * 111320, dx * 111320 * Math.cos((atY * Math.PI) / 180))
  }

  private async createParcel(op: Extract<InvOp, { op: 'create_parcel' }>) {
    if (this.parcels.has(op.number) || (await this.load(op.number)))
      throw new ProposalError(`Parcel ${op.number} already exists: the number is taken`)
    let y: number
    let x: number
    if ('relativeTo' in op.anchor) {
      const ref = await this.parcel(op.anchor.relativeTo)
      const base = ref.ig ?? centroidOf(active(ref))
      const d = metresToDelta(this.mode, base.y, op.anchor.dx, op.anchor.dy)
      y = base.y + d.dy
      x = base.x + d.dx
    } else {
      y = op.anchor.y
      x = op.anchor.x
    }
    const config: ChairConfig = {
      group: op.number, rows: op.rows, seatsPerRow: op.seatsPerRow,
      horizontalGap: op.horizontalGap, verticalGap: op.verticalGap,
      intraPairGap: 0.4, pairSeats: op.paired, rotation: op.rotation,
      baseLat: y, baseLng: x,
      ...(op.category !== undefined ? { category: op.category } : {}),
      ...(op.price !== undefined ? { price: op.price } : {}),
    }
    const generated = generateLayout(config, this.mode)
    if (generated.length > MAX_TOUCHED) throw new ProposalError(`A parcel of ${generated.length} sunbeds is too large for one proposal (max ${MAX_TOUCHED})`)
    const data = buildItemGroupData(config, this.mode)
    const schematic = this.mode === 'schematic'
    const parcel: SimParcel = {
      number: op.number, isNew: true, paired: op.paired,
      ig: {
        id: null, rows: data.rows, seatsPerRow: data.seatsPerRow, horizontalGap: data.horizontalGap,
        verticalGap: data.verticalGap, pairGap: data.pairGap, rotation: data.rotation,
        category: data.category ?? null, price: data.price ?? null,
        y: schematic ? (data.schematicY ?? 0) : parseFloat(data.locationLat),
        x: schematic ? (data.schematicX ?? 0) : parseFloat(data.locationLng),
      },
      seats: generated.map((g) => this.newSeat(op.number, g)),
    }
    this.parcels.set(op.number, parcel)
    this.maxGroup = Math.max(this.maxGroup ?? 0, op.number)
    this.touchedParcels.add(op.number)
    this.calls.push({ fn: 'sync', config })
    this.creates.push({
      target: `Parcel ${op.number}`,
      fields: {
        rows: op.rows, seatsPerRow: op.seatsPerRow, sunbeds: generated.length, paired: op.paired,
        rotation: op.rotation, position: this.pos(y, x),
        ...(op.category !== undefined ? { category: op.category } : {}),
        ...(op.price !== undefined ? { price: op.price } : {}),
      },
    })
  }

  private newSeat(group: number, g: ReturnType<typeof generateLayout>[number]): SimSeat {
    const schematic = this.mode === 'schematic'
    return {
      key: `new:${group}:${g.number}:${this.newKey++}`, id: null, number: g.number, group: g.group,
      y: schematic ? (g.schematicY ?? 0) : parseFloat(g.locationLat),
      x: schematic ? (g.schematicX ?? 0) : parseFloat(g.locationLng),
      rotation: g.rotation, status: 'active', igKey: `new:${group}`, unit: null, seatLabel: null, isNew: true,
    }
  }

  /** Regenerate a parcel on `config` exactly like syncChairsWithLayout(rearrange), in memory. */
  private async rearrange(p: SimParcel, config: ChairConfig) {
    const seatsNow = active(p)
    const schematic = this.mode === 'schematic'
    const existing = seatsNow.map((s) => ({
      id: s.key, number: s.number,
      locationLat: String(schematic ? 0 : s.y), locationLng: String(schematic ? 0 : s.x),
      schematicX: schematic ? s.x : null, schematicY: schematic ? s.y : null,
    }))
    const generated0 = generateLayout(config, this.mode)
    if (generated0.length > MAX_TOUCHED) throw new ProposalError(`A parcel of ${generated0.length} sunbeds is too large for one proposal (max ${MAX_TOUCHED})`)
    const shifted = shiftToExistingCentroid(existing, generated0, buildItemGroupData(config, this.mode), this.mode)
    const m = matchSeats(existing, shifted.generated)
    const byKey = new Map(seatsNow.map((s) => [s.key, s]))

    for (const { id, gen } of m.assignments) {
      const s = byKey.get(id)!
      if (s.number !== gen.number) this.qr.add(s.key)
      s.number = gen.number
      s.group = gen.group
      s.y = schematic ? (gen.schematicY ?? 0) : parseFloat(gen.locationLat)
      s.x = schematic ? (gen.schematicX ?? 0) : parseFloat(gen.locationLng)
      s.rotation = gen.rotation ?? 0
    }

    if (m.surplus.length > 0) {
      const ids = m.surplus.map((e) => byKey.get(e.id)!.id!).filter(Boolean)
      if ((await this.bookedCount(ids)) > 0)
        throw new ProposalError(`Cannot shrink this parcel: ${m.surplus.length} sunbed(s) being removed have current or future reservations. Release them first.`)
      await this.assertNoDevices(ids)
      for (const e of m.surplus) {
        const s = byKey.get(e.id)!
        this.removed.push(s)
        this.deletes.push({ target: `Seat ${seatName(s)}`, label: 'removed by the smaller parcel' })
      }
      const gone = new Set(m.surplus.map((e) => e.id))
      p.seats = p.seats.filter((s) => !gone.has(s.key))
    }
    for (const gen of m.vacant) p.seats.push(this.newSeat(p.number, gen))

    const g = shifted.groupData
    const prev = p.ig
    p.ig = {
      id: prev?.id ?? null, rows: g.rows, seatsPerRow: g.seatsPerRow, horizontalGap: g.horizontalGap,
      verticalGap: g.verticalGap, pairGap: g.pairGap, rotation: g.rotation,
      category: g.category !== undefined ? g.category : (prev?.category ?? null),
      price: g.price !== undefined ? g.price : (prev?.price ?? null),
      y: schematic ? (g.schematicY ?? 0) : parseFloat(g.locationLat),
      x: schematic ? (g.schematicX ?? 0) : parseFloat(g.locationLng),
    }
    if (config.pairSeats !== p.paired) for (const s of active(p)) this.qr.add(s.key)
    p.paired = config.pairSeats
  }

  private async editParcel(op: Extract<InvOp, { op: 'edit_parcel' }>) {
    const p = await this.parcel(op.parcel)
    this.touchedParcels.add(p.number)
    const { config: base } = buildParcelConfig({ number: p.number, itemGroup: this.ig(p), seats: this.cfgSeats(p), layoutMode: this.mode })
    const patch = op.patch
    if (patch.pairSeats === false && p.paired)
      throw new ProposalError('Unpairing the beds of an existing parcel is not supported by the assistant (units keep their pairs). Delete the parcel and create it again unpaired, or use the editor.')
    const { config } = buildParcelConfig({ number: p.number, itemGroup: this.ig(p), seats: this.cfgSeats(p), layoutMode: this.mode, patch })
    const t = `Parcel ${p.number}`
    const fields: Array<[keyof ParcelConfigPatch, string]> = [
      ['rows', 'Rows'], ['seatsPerRow', 'Seats per row'], ['horizontalGap', 'Gap between seats (m)'],
      ['verticalGap', 'Gap between rows (m)'], ['rotation', 'Rotation (deg)'], ['category', 'Category'], ['price', 'Price'],
    ]
    for (const [k, label] of fields) {
      if (patch[k] === undefined) continue
      const before = (base as unknown as Record<string, Scalar>)[k] ?? null
      this.push(t, k, label, before, patch[k] as Scalar)
    }
    if (patch.pairSeats !== undefined) this.push(t, 'pairSeats', 'Paired beds', base.pairSeats, patch.pairSeats)
    const before = active(p).length
    await this.rearrange(p, config)
    this.calls.push({ fn: 'applyParcelConfig', group: p.number, patch })
    const after = active(p).length
    if (before !== after) this.push(t, 'sunbeds', 'Sunbeds', before, after)
  }

  private cfgSeats(p: SimParcel) {
    const schematic = this.mode === 'schematic'
    return active(p).map((s) => ({
      rotation: s.rotation, locationLat: String(schematic ? 0 : s.y), locationLng: String(schematic ? 0 : s.x),
      schematicX: schematic ? s.x : null, schematicY: schematic ? s.y : null, sunbedGroupId: s.unit,
    }))
  }

  // Rotate / space: shared "persist the group when the whole parcel was selected" rule.
  private persistGroup(selected: SimSeat[], apply: (ig: SimIg, members: SimSeat[]) => void) {
    const igKeys = new Set(selected.map((s) => s.igKey).filter((k): k is string => !!k))
    if (igKeys.size !== 1) return
    const key = [...igKeys][0]!
    const all: SimSeat[] = []
    let ig: SimIg | null = null
    for (const p of this.parcels.values()) {
      for (const s of p.seats) if (s.igKey === key) { all.push(s); ig = p.ig }
    }
    const members = selected.filter((s) => s.igKey === key)
    if (!ig || all.length !== members.length) return
    apply(ig, members)
  }

  private rotateSeats(seats: SimSeat[], delta: number) {
    const items = seats.filter((s) => s.status !== 'pool')
    if (items.length === 0) return
    const rotated = rotatePositions(items.map((s) => ({ id: s.key, y: s.y, x: s.x, rotation: s.rotation })), delta, this.mode)
    const byKey = new Map(items.map((s) => [s.key, s]))
    for (const r of rotated) {
      const s = byKey.get(r.id)!
      s.y = r.y; s.x = r.x; s.rotation = r.rotation
    }
    this.persistGroup(seats, (ig, members) => {
      const c = centroidOf(members.filter((s) => s.status !== 'pool'))
      ig.rotation = Math.round(ig.rotation + delta)
      ig.y = c.y
      ig.x = c.x
    })
  }

  private async rotate(op: Extract<InvOp, { op: 'rotate' }>) {
    if (!Number.isFinite(op.degrees) || op.degrees === 0) throw new ProposalError('degrees must be a non-zero number')
    const delta = Math.round(op.degrees)
    if (delta === 0) throw new ProposalError('degrees rounds to 0: the editor rotates in whole degrees')
    const resolved = await this.resolve(op.target)

    if ('parcel' in op.target) {
      const p = await this.parcel(op.target.parcel)
      const t = `Parcel ${p.number}`
      const before = p.ig ? p.ig.rotation : (active(p)[0]?.rotation ?? 0)
      if (p.ig) {
        const { config } = buildParcelConfig({ number: p.number, itemGroup: this.ig(p), seats: this.cfgSeats(p), layoutMode: this.mode })
        await this.rearrange(p, { ...config, rotation: config.rotation + delta })
        this.calls.push({ fn: 'rotateParcel', group: p.number, delta })
      } else {
        const seats = active(p)
        this.rotateSeats(seats, delta)
        this.calls.push({ fn: 'rotateSelection', ids: seats.map((s) => s.id!), delta })
      }
      this.push(t, 'rotation', 'Rotation (deg)', before, before + delta)
      return
    }

    if ('seats' in op.target) {
      // Each distinct unit orbits together; a loose seat turns in place (rotateUnit).
      const done = new Set<string>()
      for (const seat of resolved.seats) {
        if (done.has(seat.key)) continue
        const members = seat.unit ? this.unitMembers(seat.unit) : []
        const group = members.length > 1 ? members : [seat]
        for (const m of group) done.add(m.key)
        const before = seat.rotation ?? 0
        if (group.length > 1) this.rotateSeats(group, delta)
        else seat.rotation = normalizedRotation(seat.rotation, delta)
        this.calls.push({ fn: 'rotateUnit', itemId: seat.id!, delta })
        this.push(`Seat ${seatName(seat)}`, 'rotation', 'Rotation (deg)', before, seat.rotation ?? 0)
      }
      return
    }

    const seats = resolved.seats.filter((s) => s.status !== 'pool')
    if (seats.length === 0) throw new ProposalError('The selection has no placed sunbeds')
    this.recordSeatChanges(seats, 'rotation', 'Rotation (deg)', () => this.rotateSeats(seats, delta), (s) => s.rotation ?? 0)
    this.calls.push({ fn: 'rotateSelection', ids: seats.map((s) => s.id!), delta })
  }

  private unitMembers(unit: string): SimSeat[] {
    const out: SimSeat[] = []
    for (const p of this.parcels.values()) for (const s of p.seats) if (s.unit === unit && s.status !== 'pool') out.push(s)
    return out
  }

  /** Run `mutate` and record one change per seat (up to MAX_LISTED) or a roll-up. */
  private recordSeatChanges(seats: SimSeat[], field: string, label: string, mutate: () => void, read: (s: SimSeat) => Scalar) {
    const before = seats.map((s) => read(s))
    mutate()
    if (seats.length <= MAX_LISTED) {
      seats.forEach((s, i) => this.push(`Seat ${seatName(s)}`, field, label, before[i]!, read(s)))
    } else {
      this.push(`${seats.length} sunbeds`, field, label, `${seats.length} sunbeds`, `${seats.length} sunbeds turned`)
    }
  }

  private async spacing(op: Extract<InvOp, { op: 'spacing' }>) {
    if (!Number.isFinite(op.factor) || op.factor <= 0 || op.factor > 10) throw new ProposalError('factor must be above 0 and at most 10')
    const resolved = await this.resolve(op.target)
    const seats = resolved.seats.filter((s) => s.status !== 'pool')
    if (seats.length < 2) throw new ProposalError('Spacing needs at least 2 sunbeds')
    const axes: Array<'horizontal' | 'vertical'> = op.axis === 'both' ? ['horizontal', 'vertical'] : [op.axis === 'x' ? 'horizontal' : 'vertical']
    const t = 'parcel' in op.target ? `Parcel ${op.target.parcel}` : `${seats.length} sunbeds`
    for (const axis of axes) {
      const gapBefore = this.groupGap(seats, axis)
      const items: PosItem[] = seats.map((s) => ({ id: s.key, y: s.y, x: s.x, rotation: s.rotation }))
      const byKey = new Map(seats.map((s) => [s.key, s]))
      for (const r of spacePositions(items, axis, op.factor, this.mode)) {
        const s = byKey.get(r.id)!
        s.y = r.y; s.x = r.x
      }
      this.persistGroup(resolved.seats, (ig) => {
        if (axis === 'horizontal') ig.horizontalGap = ig.horizontalGap * op.factor
        else ig.verticalGap = ig.verticalGap * op.factor
        const c = centroidOf(seats)
        ig.y = c.y
        ig.x = c.x
      })
      this.calls.push({ fn: 'adjustItemSpacing', ids: seats.map((s) => s.id!), axis, factor: op.factor })
      const gapAfter = this.groupGap(seats, axis)
      const gb = gapBefore ? (axis === 'horizontal' ? gapBefore.h : gapBefore.v) : null
      const ga = gapAfter ? (axis === 'horizontal' ? gapAfter.h : gapAfter.v) : null
      if (gb !== null && ga !== null && r2(gb) !== r2(ga)) {
        this.push(t, axis === 'horizontal' ? 'horizontalGap' : 'verticalGap', axis === 'horizontal' ? 'Gap between seats (m)' : 'Gap between rows (m)', r2(gb), r2(ga))
      } else {
        this.push(t, axis === 'horizontal' ? 'spacingX' : 'spacingY', axis === 'horizontal' ? 'Spacing along the rows' : 'Spacing between rows', 1, op.factor)
      }
    }
  }

  private groupGap(seats: SimSeat[], _axis: 'horizontal' | 'vertical'): { h: number; v: number } | null {
    const key = seats[0]?.igKey
    if (!key) return null
    for (const p of this.parcels.values()) {
      if (p.ig && p.seats.some((s) => s.igKey === key)) return { h: p.ig.horizontalGap, v: p.ig.verticalGap }
    }
    return null
  }

  private async move(op: Extract<InvOp, { op: 'move' }>) {
    if (!op.to && !op.by) throw new ProposalError('Give a destination (to) or an offset in metres (by_m)')
    const resolved = await this.resolve(op.target)

    if ('parcel' in op.target) {
      const p = await this.parcel(op.target.parcel)
      if (!p.ig) throw new ProposalError(`Parcel ${p.number} has no anchor record and cannot be moved by the assistant: use the editor`)
      const before = { y: p.ig.y, x: p.ig.x }
      let dy: number
      let dx: number
      if (op.to) { dy = op.to.y - before.y; dx = op.to.x - before.x }
      else { const d = metresToDelta(this.mode, before.y, op.by!.dx, op.by!.dy); dy = d.dy; dx = d.dx }
      if (!Number.isFinite(dy) || !Number.isFinite(dx)) throw new ProposalError('Invalid move target')
      this.moveMetres.push(this.deltaMetres(before.y, dy, dx))
      for (const s of active(p)) { s.y += dy; s.x += dx }
      p.ig.y += dy
      p.ig.x += dx
      this.calls.push({ fn: 'moveParcel', group: p.number, y: before.y + dy, x: before.x + dx })
      this.push(`Parcel ${p.number}`, 'position', 'Position', this.pos(before.y, before.x), this.pos(p.ig.y, p.ig.x))
      return
    }

    const seats = resolved.seats.filter((s) => s.status !== 'pool')
    if (seats.length === 0) throw new ProposalError('No placed sunbeds to move')
    const c = centroidOf(seats)
    let dy: number
    let dx: number
    if (op.to) { dy = op.to.y - c.y; dx = op.to.x - c.x }
    else { const d = metresToDelta(this.mode, c.y, op.by!.dx, op.by!.dy); dy = d.dy; dx = d.dx }
    if (!Number.isFinite(dy) || !Number.isFinite(dx)) throw new ProposalError('Invalid move target')
    this.moveMetres.push(this.deltaMetres(c.y, dy, dx))
    const before = seats.map((s) => this.pos(s.y, s.x))
    const groups = new Set(resolved.seats.map((s) => s.group))
    const igKeys = new Set(resolved.seats.map((s) => s.igKey).filter(Boolean))
    for (const s of seats) { s.y += dy; s.x += dx }
    // moveItems moves the ItemGroup anchor too whenever the selection lies in one parcel (partial or not).
    if (groups.size === 1 && igKeys.size === 1) {
      for (const p of this.parcels.values()) if (p.ig && seats.some((s) => s.igKey && p.seats.includes(s))) { p.ig.y += dy; p.ig.x += dx }
    }
    this.calls.push({ fn: 'moveItems', ids: seats.map((s) => s.id!), dy, dx })
    if (seats.length <= MAX_LISTED) seats.forEach((s, i) => this.push(`Seat ${seatName(s)}`, 'position', 'Position', before[i]!, this.pos(s.y, s.x)))
    else { const a = centroidOf(seats); this.push(this.seatTargetLabel(seats), 'position', 'Position (centre)', this.pos(a.y - dy, a.x - dx), this.pos(a.y, a.x)) }
  }

  private async setStatus(op: Extract<InvOp, { op: 'set_status' }>) {
    const resolved = await this.resolve(op.target)
    const seats = resolved.seats.filter((s) => s.status !== 'pool')
    if (seats.length === 0) throw new ProposalError('No placed sunbeds to change')
    const changing = seats.filter((s) => s.status !== op.status)
    if (changing.length === 0) return
    const t = 'parcel' in op.target ? `Parcel ${op.target.parcel}` : this.seatTargetLabel(seats)
    if ('parcel' in op.target || changing.length > MAX_LISTED) {
      const kinds = [...new Set(changing.map((s) => s.status))].join('/')
      this.push(t, 'status', 'Status', `${kinds} (${changing.length})`, `${op.status} (${changing.length})`)
    } else {
      for (const s of changing) this.push(`Seat ${seatName(s)}`, 'status', 'Status', s.status, op.status)
    }
    if (op.status === 'disabled') {
      const booked = await this.bookedCount(changing.map((s) => s.id!))
      if (booked > 0) this.warnings.push(`${booked} reservation(s) include these sunbeds: disabling does not cancel them`)
    }
    for (const s of changing) s.status = op.status
    this.calls.push({ fn: 'setSeatsStatus', ids: changing.map((s) => s.id!), status: op.status })
  }

  private async reverse(op: Extract<InvOp, { op: 'reverse' }>) {
    const p = await this.parcel(op.parcel)
    this.touchedParcels.add(p.number)
    const t = `Parcel ${p.number}`
    if (op.what === 'numbering') {
      const ids = new Map(p.seats.map((s) => [s.key, s]))
      let changed = 0
      for (const u of reversedNumbers(p.seats.map((s) => ({ id: s.key, number: s.number })))) {
        const s = ids.get(u.id)!
        if (s.number !== u.newNumber) changed++
        s.number = u.newNumber
      }
      if (changed === 0) throw new ProposalError(`Reversing the numbering of parcel ${p.number} would change nothing (one seat per row)`)
      for (const s of active(p)) this.qr.add(s.key)
      this.calls.push({ fn: 'reverseParcelNumbering', group: p.number })
      this.push(t, 'numbering', 'Seat numbering', 'as is', 'reversed')
    } else {
      for (const s of p.seats) s.rotation = flippedRotation(s.rotation)
      this.calls.push({ fn: 'reverseParcelOrientation', group: p.number })
      this.push(t, 'orientation', 'Bed orientation', 'as is', 'turned 180 degrees')
    }
  }

  private async remove(op: Extract<InvOp, { op: 'delete' }>) {
    const resolved = await this.resolve(op.target)
    const doomed = 'parcel' in op.target ? resolved.seats : resolved.seats.filter((s) => s.status !== 'pool')
    if (doomed.length === 0) throw new ProposalError('Nothing to delete')
    const ids = doomed.map((s) => s.id!).filter(Boolean)
    await this.assertNoDevices(ids)
    const booked = await this.bookedCount(ids)
    if (booked > 0) this.warnings.push(`${booked} current or future reservation(s) include sunbeds being deleted`)
    for (const s of doomed) this.removed.push(s)
    const gone = new Set(doomed.map((s) => s.key))
    if ('parcel' in op.target) {
      this.parcels.delete(op.target.parcel)
      this.calls.push({ fn: 'deleteItemsByGroup', group: op.target.parcel })
      this.deletes.push({ target: `Parcel ${op.target.parcel}`, label: `${doomed.length} sunbed(s)` })
    } else {
      for (const p of this.parcels.values()) p.seats = p.seats.filter((s) => !gone.has(s.key))
      this.calls.push({ fn: 'deleteInventoryItems', ids })
      if (doomed.length <= MAX_LISTED) for (const s of doomed) this.deletes.push({ target: `Seat ${seatName(s)}`, label: 'sunbed' })
      else this.deletes.push({ target: `${doomed.length} sunbeds`, label: 'selected sunbeds' })
    }
    this.warnings.push('Deleted sunbeds cannot be restored and this cannot be undone')
  }

  // ─── result ───────────────────────────────────────────────────────────────

  private pose(s: Pick<SimSeat, 'y' | 'x' | 'rotation'>): GeoPose {
    return this.mode === 'schematic'
      ? { x: r6(s.x), y: r6(s.y), rotation: s.rotation ?? 0 }
      : { lat: s.y, lng: s.x, rotation: s.rotation ?? 0 }
  }

  private footprint(p: SimParcel): GeoPoint[] {
    const seats = active(p)
    if (seats.length === 0) return []
    const ys = seats.map((s) => s.y)
    const xs = seats.map((s) => s.x)
    const y0 = Math.min(...ys), y1 = Math.max(...ys), x0 = Math.min(...xs), x1 = Math.max(...xs)
    const midY = (y0 + y1) / 2
    const half = Math.max(SUNBED_HEIGHT, SUNBED_WIDTH) / 2
    const pad = this.mode === 'schematic' ? { dy: half, dx: half } : { dy: half / 111320, dx: half / (111320 * Math.cos((midY * Math.PI) / 180)) }
    const corners: Array<[number, number]> = [[y0 - pad.dy, x0 - pad.dx], [y0 - pad.dy, x1 + pad.dx], [y1 + pad.dy, x1 + pad.dx], [y1 + pad.dy, x0 - pad.dx]]
    return corners.map(([y, x]) => (this.mode === 'schematic' ? { x, y } : { lat: y, lng: x }))
  }

  finish(): SimResult {
    const final = new Map<string, SimSeat>()
    for (const p of this.parcels.values()) for (const s of p.seats) final.set(s.key, s)
    const removedKeys = new Set(this.removed.map((s) => s.key))
    const created = [...final.values()].filter((s) => s.isNew)

    const changedExisting: SimSeat[] = []
    const moved: InventoryGeometry['moved'] = []
    const EPS = this.mode === 'schematic' ? 1e-6 : 1e-9
    for (const [key, before] of this.initial) {
      if (removedKeys.has(key)) continue
      const now = final.get(key)
      if (!now) continue
      const movedNow = Math.abs(now.y - before.y) > EPS || Math.abs(now.x - before.x) > EPS || (now.rotation ?? 0) !== (before.rotation ?? 0)
      const other = now.status !== before.status || now.number !== before.number || now.group !== before.group
      if (movedNow) moved.push({ id: key, label: seatName(before), before: this.pose(before), after: this.pose(now) })
      if (movedNow || other) changedExisting.push(now)
    }
    const touchedIds = [...changedExisting.map((s) => s.id!), ...this.removed.map((s) => s.id!).filter(Boolean)]
    if (touchedIds.length + created.length > MAX_TOUCHED) {
      throw new ProposalError(`This would touch ${touchedIds.length + created.length} sunbeds: too many for one proposal (max ${MAX_TOUCHED}). Split it per parcel.`)
    }

    if (this.qr.size > 0) {
      const n = [...this.qr].filter((k) => !final.get(k)?.isNew).length
      if (n > 0) this.warnings.push(`QR cards for ${n} seats need reprinting`)
    }

    const expect: Expect = {
      seats: changedExisting.map((s) => [s.id!, s.y, s.x, s.rotation ?? 0, s.status, s.number, s.group]),
      created: created.map((s) => [s.group, s.number, s.y, s.x, s.rotation ?? 0]),
      removed: this.removed.map((s) => s.id!).filter(Boolean),
    }

    const geometry: InventoryGeometry = {
      mode: this.mode,
      moved,
      added: created.map((s) => ({ tempId: s.key, at: this.pose(s), parcel: s.group })),
      removed: this.removed.filter((s) => s.id).map((s) => ({ id: s.id!, label: seatName(s) })),
      parcels: [...this.touchedParcels]
        .map((n) => this.parcels.get(n))
        .filter((p): p is SimParcel => !!p)
        .map((p) => ({ number: p.number, footprint: this.footprint(p) })),
    }
    if (geometry.moved.length > MAX_PREVIEW_SEATS || geometry.added.length > MAX_PREVIEW_SEATS) {
      geometry.moved = []
      geometry.added = []
      geometry.truncated = true
    }

    const basis = createHash('sha256').update([...this.fingerprints].sort().join('\n')).digest('hex').slice(0, 32)

    const grown = new Set<number>(created.map((s) => s.group))
    return {
      diff: {
        changes: this.changes,
        ...(this.creates.length ? { creates: this.creates } : {}),
        ...(this.deletes.length ? { deletes: this.deletes } : {}),
        ...(this.warnings.length ? { warnings: this.warnings } : {}),
        geometry,
        basis,
      },
      calls: this.calls,
      expect,
      touchedIds,
      grownGroups: [...grown],
      removedCount: this.removed.length,
    }
  }
}

export async function siteLayoutMode(siteId: string): Promise<LayoutMode> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { layoutMode: true } })
  return site?.layoutMode === 'schematic' ? 'schematic' : 'geo'
}

/** Load, run the ops in order, return the plan. Throws ProposalError for anything the user must fix. */
export async function simulate(siteId: string, ops: InvOp[]): Promise<SimResult & { mode: LayoutMode }> {
  if (!Array.isArray(ops) || ops.length === 0) throw new ProposalError('Nothing to do')
  const mode = await siteLayoutMode(siteId)
  const sim = new InventorySim(siteId, mode)
  await sim.run(ops)
  return { ...sim.finish(), mode }
}
