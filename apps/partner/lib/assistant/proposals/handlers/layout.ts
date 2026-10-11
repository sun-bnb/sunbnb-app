/**
 * kinds `layout_elements` and `layout_canvas` -- schematic layout edits (track 030 S4c).
 *
 * `layout_elements`: add / update / delete the beach furniture of a SCHEMATIC site (water, sand,
 * deck, pool, bar ...) in schematic metres, previewed as ghost rectangles via `Diff.geometry.elements`.
 * Execution is the existing `createLayoutElement` / `updateLayoutElement` / `deleteLayoutElement`
 * (those authorise by id only, so every id is verified IN the site first). The payload stores real
 * ids resolved server-side from the model's short handles; the model never supplies a cuid.
 *
 * Undo: updates are written back from the snapshot, created elements (ids unknown until apply) are
 * found as "in this site, not in the snapshot's id list, same type + rectangle" and deleted.
 * Deletions are never undoable (and so are never mixed with other changes -- the lifecycle refuses
 * to undo a proposal that has no changes/creates).
 *
 * `layout_canvas`: the schematic canvas size (Site.layoutWidth/Height) via `saveLayoutDimensions`.
 */
import prisma from '@repo/data/PrismaCient'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { createLayoutElement, updateLayoutElement, deleteLayoutElement } from '@/app/sites/[id]/schematic/actions'
import { saveLayoutDimensions } from '@/app/sites/[id]/site-actions'
import { elementHandle } from '../../tools/helpers'
import { ProposalError, type Change, type Create, type Diff, type ElementRect, type KindHandler, type Remove, type Scalar } from '../types'

export const LAYOUT_ELEMENTS_KIND = 'layout_elements'
export const LAYOUT_CANVAS_KIND = 'layout_canvas'

/** Canvas size the editor assumes when `Site.layoutWidth/Height` is unset (schematic/view.tsx). */
export const DEFAULT_CANVAS = { width: 50, height: 35 } as const

export type ElementShape = 'rect' | 'ellipse' | 'icon'
export interface LayoutAdd {
  type: string; shape: ElementShape
  x: number; y: number; width: number; height: number; rotation: number
  label: string | null; color: string | null
}
export interface LayoutPatch {
  x?: number; y?: number; width?: number; height?: number; rotation?: number
  label?: string | null; color?: string | null
}
export interface LayoutUpdate { id: string; patch: LayoutPatch }
export interface LayoutElementsPayload {
  add?: LayoutAdd[]
  update?: LayoutUpdate[]
  del?: Array<{ id: string }>
}
export interface CanvasPayload { width: number; height: number }

interface ElRow {
  id: string; type: string; shape: string
  x: number; y: number; width: number; height: number; rotation: number
  label: string | null; color: string | null; z: number; cornerRadius: number | null
}
export interface LayoutSnapshot {
  /** Every element id in the site before apply: anything else matching an `add` was created by it. */
  existingIds: string[]
  /** The updated + deleted elements as they were. */
  rows: ElRow[]
}

const EPS = 1e-4
const NUMERIC = ['x', 'y', 'width', 'height', 'rotation'] as const
const ROW_COLS = { id: true, type: true, shape: true, x: true, y: true, width: true, height: true, rotation: true, label: true, color: true, z: true, cornerRadius: true } as const
const FIELD_LABEL: Record<string, string> = { x: 'X', y: 'Y', width: 'Width', height: 'Height', rotation: 'Rotation', label: 'Label', color: 'Colour' }

const r2 = (n: number): number => Math.round(n * 100) / 100
const same = (a: number, b: number): boolean => Math.abs(a - b) <= EPS
const errorOf = (res: unknown, fallback: string): string | null => {
  const r = res as { status?: string; errors?: string[] } | undefined | null
  return r?.status === 'error' ? (r.errors?.[0] ?? fallback) : null
}

export const rectOf = (e: { x: number; y: number; width: number; height: number; rotation: number }): ElementRect =>
  ({ x: r2(e.x), y: r2(e.y), w: r2(e.width), h: r2(e.height), rotation: r2(e.rotation) })

/** Axis-aligned bounds of a rectangle rotated about its centre (the renderer's convention). */
export function rotatedBounds(e: { x: number; y: number; width: number; height: number; rotation: number }): { minX: number; minY: number; maxX: number; maxY: number } {
  const cx = e.x + e.width / 2
  const cy = e.y + e.height / 2
  const rad = (e.rotation * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const hw = (e.width * c + e.height * s) / 2
  const hh = (e.width * s + e.height * c) / 2
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh }
}

export function outsideCanvas(e: { x: number; y: number; width: number; height: number; rotation: number }, canvas: { width: number; height: number }): boolean {
  const b = rotatedBounds(e)
  return b.minX < -EPS || b.minY < -EPS || b.maxX > canvas.width + EPS || b.maxY > canvas.height + EPS
}

const nameOf = (e: { type: string; label: string | null; id: string }): string =>
  `${e.label ? `"${e.label}" ` : ''}${e.type} (${elementHandle(e.id)})`

async function siteInfo(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { layoutMode: true, layoutWidth: true, layoutHeight: true } })
  if (!site) throw new ProposalError('Site not found')
  if (site.layoutMode !== 'schematic') {
    throw new ProposalError('This site uses the Google Maps layout, not the schematic one: layout elements and the canvas size only exist on schematic sites. Sunbeds are edited on the map instead.')
  }
  return { width: site.layoutWidth ?? DEFAULT_CANVAS.width, height: site.layoutHeight ?? DEFAULT_CANVAS.height }
}

async function loadElements(siteId: string): Promise<ElRow[]> {
  return (await prisma.layoutElement.findMany({ where: { siteId }, select: ROW_COLS, orderBy: [{ z: 'asc' }, { createdAt: 'asc' }], take: 1000 })) as ElRow[]
}

const matchesAdd = (r: ElRow, a: LayoutAdd): boolean =>
  r.type === a.type && same(r.x, a.x) && same(r.y, a.y) && same(r.width, a.width) && same(r.height, a.height) && same(r.rotation, a.rotation)

// ─── elements handler ───────────────────────────────────────────────────────

/** Added elements in the current state that match `payload.add` (each existing row used once). */
function matchAdded(rows: ElRow[], adds: LayoutAdd[], exclude: Set<string> = new Set()): Array<ElRow | null> {
  const used = new Set<string>()
  return adds.map((a) => {
    const hit = rows.find((r) => !exclude.has(r.id) && !used.has(r.id) && matchesAdd(r, a))
    if (hit) used.add(hit.id)
    return hit ?? null
  })
}

async function compareApplied(siteId: string, payload: LayoutElementsPayload): Promise<Diff> {
  const rows = await loadElements(siteId)
  const byId = new Map(rows.map((r) => [r.id, r]))
  let differing = 0
  for (const u of payload.update ?? []) {
    const r = byId.get(u.id)
    if (!r) { differing++; continue }
    for (const f of NUMERIC) {
      const want = u.patch[f]
      if (want !== undefined && !same(r[f], want)) { differing++; break }
    }
    if (u.patch.label !== undefined && (r.label ?? null) !== u.patch.label) differing++
    if (u.patch.color !== undefined && (r.color ?? null) !== u.patch.color) differing++
  }
  for (const d of payload.del ?? []) if (byId.has(d.id)) differing++
  differing += matchAdded(rows, payload.add ?? []).filter((m) => m === null).length
  if (differing === 0) return { changes: [] }
  return { changes: [{ target: 'Layout', field: 'state', label: 'Layout elements changed since this was applied', before: 'as applied', after: `${differing} element(s) differ` }] }
}

export const layoutElementsHandler: KindHandler<LayoutElementsPayload, LayoutSnapshot> = {
  kind: LAYOUT_ELEMENTS_KIND,

  async diff(ctx, payload, opts) {
    if (opts?.applied) {
      await siteInfo(ctx.siteId)
      return compareApplied(ctx.siteId, payload)
    }
    const canvas = await siteInfo(ctx.siteId)
    const rows = await loadElements(ctx.siteId)
    const byId = new Map(rows.map((r) => [r.id, r]))
    const changes: Change[] = []
    const creates: Create[] = []
    const deletes: Remove[] = []
    const warnings: string[] = []
    const added: NonNullable<Diff['geometry']>['elements'] & object = { added: [], moved: [], removed: [] }

    for (const [i, a] of (payload.add ?? []).entries()) {
      creates.push({
        target: `${a.label ? `"${a.label}" ` : ''}${a.type}`,
        fields: { type: a.type, x: r2(a.x), y: r2(a.y), width: r2(a.width), height: r2(a.height), rotation: r2(a.rotation), label: a.label },
      })
      added.added.push({ tempId: `e${i}`, type: a.type, shape: a.shape, label: a.label, x: r2(a.x), y: r2(a.y), w: r2(a.width), h: r2(a.height), rotation: r2(a.rotation) })
      if (outsideCanvas(a, canvas)) warnings.push(`${nameOf({ ...a, id: `new${i}` }).replace(/ \(new\d+\)$/, '')} would extend past the ${canvas.width} x ${canvas.height} m canvas`)
    }

    for (const u of payload.update ?? []) {
      const r = byId.get(u.id)
      if (!r) throw new ProposalError('An element in this proposal no longer exists: ask again')
      const target = `Element ${nameOf(r)}`
      let touched = false
      for (const f of NUMERIC) {
        const want = u.patch[f]
        if (want !== undefined && !same(r[f], want)) {
          changes.push({ target, field: f, label: FIELD_LABEL[f]!, before: r2(r[f]), after: r2(want) })
          touched = true
        }
      }
      for (const f of ['label', 'color'] as const) {
        const want = u.patch[f]
        if (want !== undefined && (r[f] ?? null) !== want) {
          changes.push({ target, field: f, label: FIELD_LABEL[f]!, before: (r[f] ?? null) as Scalar, after: want })
          touched = true
        }
      }
      if (!touched) continue
      const after = { x: u.patch.x ?? r.x, y: u.patch.y ?? r.y, width: u.patch.width ?? r.width, height: u.patch.height ?? r.height, rotation: u.patch.rotation ?? r.rotation }
      added.moved.push({ id: r.id, label: u.patch.label !== undefined ? (u.patch.label ?? r.type) : (r.label ?? r.type), before: rectOf(r), after: rectOf(after) })
      if (outsideCanvas(after, canvas)) warnings.push(`${nameOf(r)} would extend past the ${canvas.width} x ${canvas.height} m canvas`)
    }

    for (const d of payload.del ?? []) {
      const r = byId.get(d.id)
      if (!r) throw new ProposalError('An element in this proposal no longer exists: ask again')
      deletes.push({ target: `Element ${nameOf(r)}`, label: 'removed from the layout' })
      added.removed.push({ id: r.id, label: r.label ?? r.type })
    }

    return {
      changes,
      ...(creates.length ? { creates } : {}),
      ...(deletes.length ? { deletes } : {}),
      ...(warnings.length ? { warnings } : {}),
      geometry: { mode: 'schematic', moved: [], added: [], removed: [], elements: added },
    }
  },

  async snapshot(ctx, payload) {
    const rows = await loadElements(ctx.siteId)
    const touched = new Set([...(payload.update ?? []).map((u) => u.id), ...(payload.del ?? []).map((d) => d.id)])
    return { existingIds: rows.map((r) => r.id), rows: rows.filter((r) => touched.has(r.id)) }
  },

  async execute(ctx, payload, done) {
    const { error } = await requireSiteOwner(ctx.siteId)
    if (error) throw new ProposalError(error)
    const inSite = async (ids: string[]) => new Set((await prisma.layoutElement.findMany({ where: { id: { in: ids }, siteId: ctx.siteId }, select: { id: true } })).map((r) => r.id))
    const ids = [...(payload.update ?? []).map((u) => u.id), ...(payload.del ?? []).map((d) => d.id)]
    const owned = ids.length ? await inSite(ids) : new Set<string>()
    if (ids.some((id) => !owned.has(id))) throw new ProposalError('An element in this proposal no longer exists in this site')

    for (const [i, a] of (payload.add ?? []).entries()) {
      const failure = errorOf(await createLayoutElement(ctx.siteId, a), 'Could not add the element')
      if (failure) throw new ProposalError(failure, done)
      done.push(`add:${i}`)
    }
    for (const [i, u] of (payload.update ?? []).entries()) {
      const failure = errorOf(await updateLayoutElement(u.id, u.patch), 'Could not change the element')
      if (failure) throw new ProposalError(failure, done)
      done.push(`update:${i}`)
    }
    for (const [i, d] of (payload.del ?? []).entries()) {
      const failure = errorOf(await deleteLayoutElement(d.id), 'Could not remove the element')
      if (failure) throw new ProposalError(failure, done)
      done.push(`delete:${i}`)
    }
  },

  async restore(ctx, payload, snapshot, only) {
    const { error } = await requireSiteOwner(ctx.siteId)
    if (error) throw new ProposalError(error)
    const wants = (step: string) => !only || only.includes(step)

    // 1. Created elements: in this site, unknown to the snapshot, same type + rectangle as an add.
    const rows = await loadElements(ctx.siteId)
    const known = new Set(snapshot.existingIds)
    const adds = (payload.add ?? []).map((a, i) => ({ a, i })).filter(({ i }) => wants(`add:${i}`))
    const matched = matchAdded(rows.filter((r) => !known.has(r.id)), adds.map(({ a }) => a))
    for (const m of matched) {
      if (!m) continue
      const failure = errorOf(await deleteLayoutElement(m.id), 'Could not remove the added element')
      if (failure) throw new ProposalError(failure)
    }

    // 2. Updated elements back to their snapshot values (still in this site, else skipped).
    const present = new Set(rows.map((r) => r.id))
    for (const [i, u] of (payload.update ?? []).entries()) {
      if (!wants(`update:${i}`) || !present.has(u.id)) continue
      const before = snapshot.rows.find((r) => r.id === u.id)
      if (!before) continue
      const failure = errorOf(
        await updateLayoutElement(u.id, { x: before.x, y: before.y, width: before.width, height: before.height, rotation: before.rotation, label: before.label, color: before.color }),
        'Could not restore the element',
      )
      if (failure) throw new ProposalError(failure)
    }
    // Deleted elements are never restored.
  },
}

// ─── canvas handler ─────────────────────────────────────────────────────────

export interface CanvasSnapshot { width: number | null; height: number | null }

export const layoutCanvasHandler: KindHandler<CanvasPayload, CanvasSnapshot> = {
  kind: LAYOUT_CANVAS_KIND,

  async diff(ctx, payload, opts) {
    const canvas = await siteInfo(ctx.siteId)
    if (opts?.applied) {
      return same(canvas.width, payload.width) && same(canvas.height, payload.height)
        ? { changes: [] }
        : { changes: [{ target: 'Layout', field: 'state', label: 'Canvas size changed since this was applied', before: 'as applied', after: `${r2(canvas.width)} x ${r2(canvas.height)} m` }] }
    }
    const changes: Change[] = []
    if (!same(canvas.width, payload.width)) changes.push({ target: 'Schematic canvas', field: 'width', label: 'Width (m)', before: r2(canvas.width), after: r2(payload.width) })
    if (!same(canvas.height, payload.height)) changes.push({ target: 'Schematic canvas', field: 'height', label: 'Height (m)', before: r2(canvas.height), after: r2(payload.height) })

    const warnings: string[] = []
    if (changes.length) {
      const [elements, seats] = await Promise.all([
        loadElements(ctx.siteId),
        prisma.inventoryItem.findMany({ where: { siteId: ctx.siteId, status: { not: 'pool' } }, select: { schematicX: true, schematicY: true }, take: 20000 }),
      ])
      const outEls = elements.filter((e) => outsideCanvas(e, payload)).length
      if (outEls) warnings.push(`${outEls} layout element(s) would extend past the new ${payload.width} x ${payload.height} m canvas`)
      const outSeats = seats.filter((s) => s.schematicX != null && s.schematicY != null && (s.schematicX < 0 || s.schematicY < 0 || s.schematicX > payload.width || s.schematicY > payload.height)).length
      if (outSeats) warnings.push(`${outSeats} sunbed(s) would sit outside the new ${payload.width} x ${payload.height} m canvas`)
    }
    return { changes, ...(warnings.length ? { warnings } : {}) }
  },

  async snapshot(ctx) {
    const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { layoutWidth: true, layoutHeight: true } })
    return { width: site?.layoutWidth ?? null, height: site?.layoutHeight ?? null }
  },

  async execute(ctx, payload, done) {
    const failure = errorOf(await saveLayoutDimensions(ctx.siteId, payload.width, payload.height), 'Could not resize the canvas')
    if (failure) throw new ProposalError(failure, done)
    done.push('dimensions')
  },

  async restore(ctx, _payload, snapshot) {
    const failure = errorOf(
      await saveLayoutDimensions(ctx.siteId, snapshot.width ?? DEFAULT_CANVAS.width, snapshot.height ?? DEFAULT_CANVAS.height),
      'Could not restore the canvas size',
    )
    if (failure) throw new ProposalError(failure)
  },
}
