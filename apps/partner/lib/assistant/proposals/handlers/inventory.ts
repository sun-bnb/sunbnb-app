/**
 * kind `inventory_batch` -- sunbed map / schematic edits (track 030 S4a). One proposal holds one or
 * more ops applied in order (create / edit / rotate / space / move / status / reverse / delete a
 * parcel or seats), previewed on the map via `Diff.geometry`.
 *
 * Everything is derived from `simulate()` (inventory-sim.ts), which runs the same pure geometry the
 * server actions run: `diff` = its Diff, `execute` = performing its `calls` through the EXISTING
 * (individually authorised) actions, so the previewed arguments ARE the applied arguments.
 *
 *  - Stale (apply): `Diff.basis` fingerprints every loaded seat / ItemGroup row; any change since the
 *    proposal -- positions, rotation, status, numbering, units -- changes it.
 *  - Stale (undo): the touched seats must still equal the after-state stored in the payload (`expect`).
 *  - Snapshot / undo: per-seat position, rotation, status, number, parcel, ItemGroup + unit membership
 *    and the touched ItemGroup configs; undo resets them, deletes seats a create / grow made (unless
 *    they carry reservations or devices) and recomputes the seat labels. Deletions are not undoable.
 */
import prisma from '@repo/data/PrismaCient'
import { recomputeSeatLabels } from '@repo/data/seat-label-db'
import { devicesBlockingSeatRemoval, deviceRemovalError, pruneEmptyUnits } from '@repo/data/unit'
import { requireSiteOwner } from '@/lib/auth-helpers'
import {
  adjustItemSpacing, moveParcel, moveItems, reverseParcelNumbering,
  reverseParcelOrientation, rotateSelection, syncChairsWithLayout,
} from '@/app/sites/[id]/inventory/actions'
import { applyParcelConfig, rotateParcel, rotateUnit, setSeatsStatus } from '@/app/sites/[id]/inventory/parcel-ops'
import { deleteInventoryItems, deleteItemsByGroup } from '@/app/sites/[id]/inventory-actions'
import { validatePatch } from '@/app/sites/[id]/inventory/parcel-config'
import {
  simulate, siteLayoutMode, MAX_TOUCHED,
  type Anchor, type ExecCall, type Expect, type InvOp, type InventoryPayload, type Target,
} from '../inventory-sim'
import { ProposalError, type Diff, type HandlerCtx, type KindHandler } from '../types'

export type { InventoryPayload, InvOp, Target, Anchor } from '../inventory-sim'

// ─── snapshot ───────────────────────────────────────────────────────────────

interface SeatRow {
  id: string; number: number; group: number; status: string; rotation: number | null
  locationLat: string; locationLng: string; schematicX: number | null; schematicY: number | null
  itemGroupId: string | null; sunbedGroupId: string | null
}
interface IgRow {
  id: string; rows: number; seatsPerRow: number; horizontalGap: number; verticalGap: number; pairGap: number
  rotation: number; category: string | null; price: number | null
  locationLat: string; locationLng: string; schematicX: number | null; schematicY: number | null
}
interface UnitRow { id: string; seq: number | null }
export interface InventorySnapshot {
  seats: SeatRow[]
  itemGroups: IgRow[]
  units: UnitRow[]
  /** Parcels that gained seats -> their seat ids BEFORE apply (anything else in them is an extra). */
  grown: Record<string, string[]>
}

const SEAT_COLS = {
  id: true, number: true, group: true, status: true, rotation: true, locationLat: true, locationLng: true,
  schematicX: true, schematicY: true, itemGroupId: true, sunbedGroupId: true,
} as const

// ─── undo staleness ─────────────────────────────────────────────────────────

async function compareExpect(siteId: string, expect: Expect | undefined): Promise<Diff> {
  if (!expect) throw new ProposalError('This proposal has no recorded result to verify')
  const mode = await siteLayoutMode(siteId)
  const eps = mode === 'schematic' ? 1e-4 : 1e-7
  const pos = (r: { locationLat: string; locationLng: string; schematicX: number | null; schematicY: number | null }) =>
    mode === 'schematic' ? { y: r.schematicY ?? 0, x: r.schematicX ?? 0 } : { y: parseFloat(r.locationLat), x: parseFloat(r.locationLng) }
  let differing = 0

  const ids = expect.seats.map((s) => s[0])
  const rows = ids.length ? await prisma.inventoryItem.findMany({ where: { id: { in: ids }, siteId }, select: SEAT_COLS }) : []
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const [id, y, x, rot, status, number, group] of expect.seats) {
    const r = byId.get(id)
    if (!r) { differing++; continue }
    const p = pos(r)
    if (Math.abs(p.y - y) > eps || Math.abs(p.x - x) > eps || (r.rotation ?? 0) !== rot || r.status !== status || r.number !== number || r.group !== group) differing++
  }
  if (expect.removed.length) {
    const left = await prisma.inventoryItem.count({ where: { id: { in: expect.removed }, siteId } })
    differing += left
  }
  if (expect.created.length) {
    const groups = [...new Set(expect.created.map((c) => c[0]))]
    const now = await prisma.inventoryItem.findMany({ where: { siteId, group: { in: groups } }, select: SEAT_COLS })
    const byKey = new Map(now.map((r) => [`${r.group}:${r.number}`, r]))
    for (const [group, number, y, x, rot] of expect.created) {
      const r = byKey.get(`${group}:${number}`)
      if (!r) { differing++; continue }
      const p = pos(r)
      if (Math.abs(p.y - y) > eps || Math.abs(p.x - x) > eps || (r.rotation ?? 0) !== rot) differing++
    }
  }
  if (differing === 0) return { changes: [] }
  return { changes: [{ target: 'Layout', field: 'state', label: 'Sunbeds changed since this was applied', before: 'as applied', after: `${differing} sunbed(s) differ` }] }
}

// ─── execute ────────────────────────────────────────────────────────────────

const errorOf = (res: unknown, fallback: string): string | null => {
  const r = res as { status?: string; errors?: string[] } | undefined | null
  return r?.status === 'error' ? (r.errors?.[0] ?? fallback) : null
}

async function perform(siteId: string, call: ExecCall): Promise<string | null> {
  switch (call.fn) {
    case 'sync': return errorOf(await syncChairsWithLayout(siteId, call.config, 'create'), 'Could not create the parcel')
    case 'applyParcelConfig': return errorOf(await applyParcelConfig(siteId, call.group, call.patch), 'Could not update the parcel')
    case 'rotateParcel': return errorOf(await rotateParcel(siteId, call.group, call.delta), 'Could not rotate the parcel')
    case 'rotateUnit': return errorOf(await rotateUnit(siteId, call.itemId, call.delta), 'Could not rotate the sunbed')
    case 'rotateSelection': return errorOf(await rotateSelection(siteId, call.ids, call.delta), 'Could not rotate the sunbeds')
    case 'adjustItemSpacing': return errorOf(await adjustItemSpacing(siteId, call.ids, call.axis, call.factor), 'Could not change the spacing')
    case 'moveParcel': return errorOf(await moveParcel(siteId, call.group, call.y, call.x), 'Could not move the parcel')
    case 'moveItems': return errorOf(await moveItems(siteId, call.ids, call.dy, call.dx), 'Could not move the sunbeds')
    case 'setSeatsStatus': return errorOf(await setSeatsStatus(siteId, call.ids, call.status), 'Could not change the status')
    case 'reverseParcelNumbering': return errorOf(await reverseParcelNumbering(siteId, call.group), 'Could not reverse the numbering')
    case 'reverseParcelOrientation': return errorOf(await reverseParcelOrientation(siteId, call.group), 'Could not reverse the orientation')
    case 'deleteItemsByGroup': return errorOf(await deleteItemsByGroup(siteId, call.group), 'Could not delete the parcel')
    case 'deleteInventoryItems': return errorOf(await deleteInventoryItems(siteId, call.ids), 'Could not delete the sunbeds')
  }
}

// ─── extras (seats a create / grow made) ────────────────────────────────────

async function extrasOf(siteId: string, grown: Record<string, string[]>): Promise<Array<{ id: string; itemGroupId: string | null }>> {
  const groups = Object.keys(grown).map(Number)
  if (groups.length === 0) return []
  const now = await prisma.inventoryItem.findMany({ where: { siteId, group: { in: groups } }, select: { id: true, group: true, itemGroupId: true } })
  return now.filter((r) => !(grown[String(r.group)] ?? []).includes(r.id)).map((r) => ({ id: r.id, itemGroupId: r.itemGroupId }))
}

// ─── the handler ────────────────────────────────────────────────────────────

export const inventoryHandler: KindHandler<InventoryPayload, InventorySnapshot> = {
  kind: 'inventory_batch',

  async diff(ctx, payload, opts) {
    if (opts?.applied) return compareExpect(ctx.siteId, payload.expect)
    return (await simulate(ctx.siteId, payload.ops)).diff
  },

  async snapshot(ctx, payload) {
    const plan = await simulate(ctx.siteId, payload.ops)
    const grownGroups = plan.grownGroups.filter((g) => g >= 1)

    const grown: Record<string, string[]> = {}
    const grownSeats = grownGroups.length
      ? await prisma.inventoryItem.findMany({ where: { siteId: ctx.siteId, group: { in: grownGroups } }, select: SEAT_COLS })
      : []
    for (const g of grownGroups) grown[String(g)] = []
    for (const r of grownSeats) grown[String(r.group)]!.push(r.id)

    const touched = plan.touchedIds.length
      ? await prisma.inventoryItem.findMany({ where: { id: { in: plan.touchedIds }, siteId: ctx.siteId }, select: SEAT_COLS })
      : []
    const igIds = [...new Set([...touched, ...grownSeats].map((r) => r.itemGroupId).filter((v): v is string => !!v))]
    const itemGroups = igIds.length
      ? await prisma.itemGroup.findMany({
          where: { id: { in: igIds } },
          select: { id: true, rows: true, seatsPerRow: true, horizontalGap: true, verticalGap: true, pairGap: true, rotation: true, category: true, price: true, locationLat: true, locationLng: true, schematicX: true, schematicY: true },
        })
      : []
    const unitIds = [...new Set([...touched, ...grownSeats].map((r) => r.sunbedGroupId).filter((v): v is string => !!v))]
    const units = unitIds.length
      ? await prisma.sunbedGroup.findMany({ where: { id: { in: unitIds }, siteId: ctx.siteId }, select: { id: true, seq: true } })
      : []
    return { seats: touched, itemGroups, units, grown }
  },

  async execute(ctx, payload, done) {
    const { error } = await requireSiteOwner(ctx.siteId)
    if (error) throw new ProposalError(error)
    const plan = await simulate(ctx.siteId, payload.ops)
    for (const [i, call] of plan.calls.entries()) {
      const failure = await perform(ctx.siteId, call)
      if (failure) throw new ProposalError(failure, done)
      done.push(`${i + 1}:${call.fn}`)
    }
  },

  async undoBlocker(ctx, _payload, snapshot) {
    const present = snapshot.seats.length
      ? await prisma.inventoryItem.count({ where: { id: { in: snapshot.seats.map((s) => s.id) }, siteId: ctx.siteId } })
      : 0
    if (present < snapshot.seats.length) {
      return `${snapshot.seats.length - present} sunbed(s) were removed by this change and cannot be restored`
    }
    const extras = await extrasOf(ctx.siteId, snapshot.grown)
    if (extras.length === 0) return null
    const ids = extras.map((e) => e.id)
    const used = await prisma.reservation.count({ where: { siteId: ctx.siteId, items: { some: { id: { in: ids } } } } })
    if (used > 0) return `${used} reservation(s) now include the sunbeds this change added: undo would delete them`
    const blocking = await devicesBlockingSeatRemoval(ctx.siteId, ids)
    if (blocking.length > 0) return deviceRemovalError(blocking)
    return null
  },

  async restore(ctx, _payload, snapshot) {
    const { error } = await requireSiteOwner(ctx.siteId)
    if (error) throw new ProposalError(error)
    const siteId = ctx.siteId

    // 1. Seats this change added (new parcel / grown parcel).
    const extras = await extrasOf(siteId, snapshot.grown)
    const unitsBefore = new Set<string>()
    if (extras.length) {
      const unitRows = await prisma.inventoryItem.findMany({ where: { id: { in: extras.map((e) => e.id) }, siteId }, select: { sunbedGroupId: true } })
      for (const r of unitRows) if (r.sunbedGroupId) unitsBefore.add(r.sunbedGroupId)
      const res = await deleteInventoryItems(siteId, extras.map((e) => e.id))
      const failure = errorOf(res, 'Could not remove the added sunbeds')
      if (failure) throw new ProposalError(failure)
    }

    // 2. Units that apply pruned: bring them back (address is recomputed with the labels below).
    const existingUnits = new Set(
      (await prisma.sunbedGroup.findMany({ where: { id: { in: snapshot.units.map((u) => u.id) }, siteId }, select: { id: true } })).map((u) => u.id),
    )
    const missing = snapshot.units.filter((u) => !existingUnits.has(u.id))
    if (missing.length) {
      await prisma.sunbedGroup.createMany({ data: missing.map((u) => ({ id: u.id, siteId, seq: u.seq })), skipDuplicates: true })
    }

    // 3. Seats back to their pre-apply state (site-scoped; a seat that no longer exists is skipped).
    const current = snapshot.seats.length
      ? await prisma.inventoryItem.findMany({ where: { id: { in: snapshot.seats.map((s) => s.id) }, siteId }, select: { id: true, sunbedGroupId: true } })
      : []
    for (const r of current) if (r.sunbedGroupId) unitsBefore.add(r.sunbedGroupId)
    for (let i = 0; i < snapshot.seats.length; i += 200) {
      await prisma.$transaction(
        snapshot.seats.slice(i, i + 200).map((s) =>
          prisma.inventoryItem.updateMany({
            where: { id: s.id, siteId },
            data: {
              locationLat: s.locationLat, locationLng: s.locationLng, schematicX: s.schematicX, schematicY: s.schematicY,
              rotation: s.rotation, status: s.status, number: s.number, group: s.group,
              itemGroupId: s.itemGroupId, sunbedGroupId: s.sunbedGroupId,
            },
          }),
        ),
      )
    }

    // 4. ItemGroup configs, then the ItemGroups only the added seats pointed at.
    for (const ig of snapshot.itemGroups) {
      const { id, ...data } = ig
      await prisma.itemGroup.updateMany({ where: { id }, data })
    }
    const keep = new Set(snapshot.itemGroups.map((g) => g.id))
    const orphanCandidates = [...new Set(extras.map((e) => e.itemGroupId).filter((v): v is string => !!v && !keep.has(v)))]
    if (orphanCandidates.length) await prisma.itemGroup.deleteMany({ where: { id: { in: orphanCandidates }, items: { none: {} } } })

    // 5. Units left empty by the reset, then labels.
    if (unitsBefore.size) await pruneEmptyUnits(siteId, [...unitsBefore])
    await recomputeSeatLabels(siteId)
  },
}

// ─── planning (tool input -> payload) ───────────────────────────────────────

export type InventoryPlan = { payload: InventoryPayload } | { errors: string[] }

/** Validate the ops with a dry run and attach the after-state (`expect`) used for undo staleness. */
export async function planInventory(siteId: string, ops: InvOp[]): Promise<InventoryPlan> {
  if (ops.some((o) => o.op === 'delete') && ops.length > 1) return { errors: ['Deletions cannot be mixed with other changes: propose the deletion on its own'] }
  try {
    const plan = await simulate(siteId, ops)
    return { payload: { ops, expect: plan.expect } }
  } catch (err) {
    if (err instanceof ProposalError) return { errors: [err.message] }
    throw err
  }
}

export { siteLayoutMode, MAX_TOUCHED, validatePatch }
export type { HandlerCtx }
